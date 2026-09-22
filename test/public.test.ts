import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPublicInfo, PUBLIC_URL } from "../src/lib/public.ts";

const body = {
  ip: "203.0.113.10",
  asn: "AS64496",
  org: "Example Fiber Networks Ltd.",
  country: "Taiwan",
  country_code: "TW",
  city: "Taipei",
  ua: "curl/8.22.0",
};

const fakeFetch = (status: number, json: unknown): typeof fetch =>
  (async (url) => {
    assert.equal(String(url), PUBLIC_URL);
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;

test("parses a 200 JSON body and drops ua", async () => {
  const info = await fetchPublicInfo({ fetchImpl: fakeFetch(200, body) });
  assert.deepEqual(info, {
    ip: "203.0.113.10",
    asn: "AS64496",
    org: "Example Fiber Networks Ltd.",
    country: "Taiwan",
    country_code: "TW",
    city: "Taipei",
  });
});

test("refuses to follow redirects", async () => {
  let init: RequestInit | undefined;
  const capturing: typeof fetch = (async (_url: unknown, i?: RequestInit) => {
    init = i;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  await fetchPublicInfo({ fetchImpl: capturing });
  assert.equal(init?.redirect, "error");
});

test("rejects on non-2xx", async () => {
  await assert.rejects(fetchPublicInfo({ fetchImpl: fakeFetch(503, {}) }), /HTTP 503/);
});

test("rejects when the body lacks ip", async () => {
  await assert.rejects(fetchPublicInfo({ fetchImpl: fakeFetch(200, { hello: 1 }) }), /malformed/i);
});

test("rejects on timeout", async () => {
  const never: typeof fetch = ((_url: unknown, init?: RequestInit) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  await assert.rejects(fetchPublicInfo({ timeoutMs: 10, fetchImpl: never }), /timed out/i);
});

test("rejects on non-JSON body", async () => {
  const htmlFetch: typeof fetch = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
  await assert.rejects(fetchPublicInfo({ fetchImpl: htmlFetch }), /malformed/i);
});

test("rejects a body announced as larger than the cap", async () => {
  const hugeHeader: typeof fetch = (async () =>
    new Response("{}", { status: 200, headers: { "content-length": "100000" } })) as typeof fetch;
  await assert.rejects(fetchPublicInfo({ fetchImpl: hugeHeader }), /too large/);
});

test("rejects a body that turns out to be larger than the cap", async () => {
  const huge = JSON.stringify({ ip: "203.0.113.10", pad: "x".repeat(70000) });
  const hugeBody: typeof fetch = (async () => new Response(huge, { status: 200 })) as typeof fetch;
  await assert.rejects(fetchPublicInfo({ fetchImpl: hugeBody }), /too large/);
});

test("resolves with empty strings for null/missing fields other than ip", async () => {
  const info = await fetchPublicInfo({
    fetchImpl: fakeFetch(200, { ip: "203.0.113.10", city: null }),
  });
  assert.deepEqual(info, {
    ip: "203.0.113.10",
    asn: "",
    org: "",
    country: "",
    country_code: "",
    city: "",
  });
});

test("rejects when JSON body is null", async () => {
  const nullFetch: typeof fetch = (async () => new Response("null", { status: 200 })) as typeof fetch;
  await assert.rejects(fetchPublicInfo({ fetchImpl: nullFetch }), /malformed/i);
});
