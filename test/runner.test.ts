import { test } from "node:test";
import assert from "node:assert/strict";
import { runTool } from "../src/lib/local.ts";

test("runTool returns the complete stdout of a chatty process", async () => {
  const out = await runTool("/bin/dd", ["if=/dev/zero", "bs=1000", "count=200"]);
  assert.equal(out.length, 200_000);
});

test("runTool feeds stdin to the child", async () => {
  assert.equal(await runTool("/bin/cat", [], "hello\n"), "hello\n");
});

test("runTool rejects on a non-zero exit", async () => {
  await assert.rejects(runTool("/usr/bin/false", []), /exited with 1/);
});

test("runTool rejects when the binary does not exist", async () => {
  await assert.rejects(runTool("/nonexistent/tool", []), /ENOENT/);
});

test("runTool caps runaway output and kills the child", async () => {
  await assert.rejects(runTool("/usr/bin/yes", []), /output exceeded/);
});

test("runTool kills a hung child after the timeout", async () => {
  const started = Date.now();
  await assert.rejects(runTool("/bin/sleep", ["30"]), /timed out/);
  assert.ok(Date.now() - started < 5000);
});
