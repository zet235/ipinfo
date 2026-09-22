import { test } from "node:test";
import assert from "node:assert/strict";
import { publicRows, interfaceRow, localErrorRow, asText, type PublicState } from "../src/lib/format.ts";
import type { LocalInterface } from "../src/lib/local.ts";

const OK: PublicState = {
  status: "ok",
  info: {
    ip: "1.2.3.4",
    asn: "AS123",
    org: "Some Org",
    country: "Taiwan",
    country_code: "TW",
    city: "Taipei",
  },
};

const WIFI: LocalInterface = {
  device: "en0",
  kind: "wifi",
  label: "Wi-Fi",
  ipv4: "192.168.0.42",
  ssid: "ExampleWiFi",
  router: "192.168.0.1",
};

const ETHERNET: LocalInterface = {
  device: "en3",
  kind: "ethernet",
  label: "Ethernet Adapter (en3)",
  ipv4: "10.0.0.5",
};

const OTHER: LocalInterface = {
  device: "utun4",
  kind: "other",
  label: "utun4",
  ipv4: "100.64.0.9",
};

const VPN: LocalInterface = {
  device: "utun5",
  kind: "vpn",
  label: "WireGuard",
  ipv4: "10.8.0.2",
  profile: "office-vpn",
};

test("asText ok-state with wifi, vpn and other ifaces", () => {
  assert.equal(
    asText(OK, { status: "ok", ifaces: [WIFI, VPN, OTHER] }),
    [
      "Public IP: 1.2.3.4",
      "ASN: AS123",
      "Org: Some Org",
      "Location: Taipei, Taiwan (TW)",
      "Wi-Fi (en0): 192.168.0.42 [SSID ExampleWiFi, Router 192.168.0.1]",
      "WireGuard (utun5): 10.8.0.2 [Profile office-vpn]",
      "utun4: 100.64.0.9",
    ].join("\n"),
  );
});

test("interfaceRow for vpn shows the profile as subtitle and is connected", () => {
  const row = interfaceRow(VPN);
  assert.equal(row.subtitle, "Profile: office-vpn");
  assert.equal(row.icon, "vpn");
  assert.equal(row.tag, "utun5");
  assert.equal(row.connected, true);
  assert.equal(row.primary, undefined);
});

test("interfaceRow marks the default-route interface as primary", () => {
  assert.equal(interfaceRow({ ...WIFI, primary: true }).primary, true);
});

test("asText error-state includes the message and interface lines", () => {
  const text = asText({ status: "error", message: "boom" }, { status: "ok", ifaces: [OTHER] });
  assert.match(text, /^Public IP: Unavailable \(boom\)/);
  assert.match(text, /utun4: 100\.64\.0\.9$/);
});

test("asText loading-state with no interfaces is empty", () => {
  assert.equal(asText({ status: "loading" }, { status: "loading" }), "");
});

test("asText reports an unavailable local enumeration after the public lines", () => {
  const text = asText(OK, { status: "error", message: "boom" });
  assert.equal(text.split("\n").at(-1), "Local interfaces: Unavailable (boom)");
  assert.match(text, /^Public IP: 1\.2\.3\.4/);
});

test("localErrorRow carries the message as subtitle and as the copied value", () => {
  assert.deepEqual(localErrorRow("boom"), {
    key: "local-err",
    title: "Unavailable",
    icon: "error",
    subtitle: "boom",
    copy: "boom",
  });
});

test("publicRows for error returns a single unavailable row", () => {
  assert.deepEqual(publicRows({ status: "error", message: "boom" }), [
    { key: "pub-err", title: "Unavailable", icon: "error", subtitle: "boom", copy: "boom" },
  ]);
});

test("publicRows for loading returns no rows", () => {
  assert.deepEqual(publicRows({ status: "loading" }), []);
});

test("publicRows and asText skip an empty ASN and build the location from what is there", () => {
  const state: PublicState = {
    status: "ok",
    info: { ip: "1.2.3.4", asn: "", org: "", city: "", country: "Taiwan", country_code: "TW" },
  };
  assert.deepEqual(publicRows(state), [
    { key: "pub-ip", title: "1.2.3.4", icon: "ip", accessory: "ip.zet.tw" },
    { key: "pub-loc", title: "Taiwan (TW)", icon: "location" },
  ]);
  assert.equal(asText(state, { status: "loading" }), "Public IP: 1.2.3.4\nLocation: Taiwan (TW)");
});

test("publicRows shows the org alone when only the ASN is missing", () => {
  const state: PublicState = {
    status: "ok",
    info: { ip: "1.2.3.4", asn: "", org: "Some Org", city: "", country: "", country_code: "" },
  };
  assert.deepEqual(publicRows(state), [
    { key: "pub-ip", title: "1.2.3.4", icon: "ip", accessory: "ip.zet.tw" },
    { key: "pub-asn", title: "Some Org", icon: "asn" },
  ]);
});

test("publicRows and asText omit the location when every location field is empty", () => {
  const state: PublicState = {
    status: "ok",
    info: { ip: "1.2.3.4", asn: "AS123", org: "Some Org", city: "", country: "", country_code: "" },
  };
  assert.deepEqual(publicRows(state), [
    { key: "pub-ip", title: "1.2.3.4", icon: "ip", accessory: "ip.zet.tw" },
    { key: "pub-asn", title: "AS123", icon: "asn", subtitle: "Some Org" },
  ]);
  assert.equal(asText(state, { status: "loading" }), "Public IP: 1.2.3.4\nASN: AS123\nOrg: Some Org");
});

test("interfaceRow for wifi with ssid and router", () => {
  const row = interfaceRow(WIFI);
  assert.equal(row.subtitle, "SSID: ExampleWiFi · Router 192.168.0.1");
});

test("interfaceRow for ethernet shows the device as tag with no subtitle", () => {
  const row = interfaceRow(ETHERNET);
  assert.equal(row.tag, "en3");
  assert.equal(row.icon, "ethernet");
  assert.equal(row.subtitle, undefined);
  assert.equal(row.connected, undefined);
});

test("interfaceRow for other shows device as tag with no subtitle", () => {
  const row = interfaceRow(OTHER);
  assert.equal(row.tag, "utun4");
  assert.equal(row.icon, "other");
  assert.equal(row.subtitle, undefined);
});

test("control and bidi characters never reach a row or the clipboard", () => {
  const hostile: LocalInterface = { ...WIFI, ssid: "\x1b]0;x\x07Caf‮evil" };
  assert.equal(interfaceRow(hostile).subtitle, "SSID: ]0;xCafevil · Router 192.168.0.1");
  const text = asText(OK, { status: "ok", ifaces: [hostile] });
  assert.doesNotMatch(text, /[\x1b\x07‮]/u);
  assert.match(text, /SSID \]0;xCafevil/);
});

test("a hostile public payload is sanitised too", () => {
  const rows = publicRows({
    status: "ok",
    info: {
      ip: "1.2.3.4",
      asn: "AS123",
      org: "Evil‮Org",
      city: "Taipei",
      country: "Taiwan",
      country_code: "TW",
    },
  });
  assert.equal(rows[1].subtitle, "EvilOrg");
});
