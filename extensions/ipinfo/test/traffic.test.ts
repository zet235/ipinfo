import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNetstat, watchRates } from "../src/lib/local.ts";

// Captured shape of `netstat -ibn`: one <Link#> row per interface, then one row per address.
// Tunnels have no link address, so that column is blank; a trailing `*` marks a down interface.
const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                       9040478     0 3016347392  9040478     0 3016347392     0
lo0        16384 127           127.0.0.1        9040478     -  3016347392  9040478     -  3016347392     -
gif0*      1280  <Link#2>                             0     0          0        0     0          0     0
en0        1500  <Link#11>   02:00:00:00:00:00 21470357     0 24248285022  7697539     0 2466915474     0
en0        1500  192.168.7     192.168.7.82     21470357     - 24248285022  7697539     - 2466915474     -
utun5      1380  <Link#21>                           56     0      17368       35     0       5014     0
`;

test("parseNetstat reads received and sent bytes from each interface's link row", () => {
  assert.deepEqual(
    [...parseNetstat(NETSTAT)],
    [
      ["lo0", { rx: 3016347392, tx: 3016347392 }],
      ["gif0", { rx: 0, tx: 0 }],
      ["en0", { rx: 24248285022, tx: 2466915474 }],
      ["utun5", { rx: 17368, tx: 5014 }],
    ],
  );
});

test("parseNetstat ignores a header-only or garbled table", () => {
  assert.equal(parseNetstat("Name Mtu Network\n").size, 0);
  assert.equal(parseNetstat("en0 1500 <Link#11> x y z\n").size, 0);
});

const sample = (en0: [number, number], utun5: [number, number]) =>
  `${NETSTAT.split("\n")[0]}
en0        1500  <Link#11>   02:00:00:00:00:00        1     0 ${en0[0]}        1     0 ${en0[1]}     0
utun5      1380  <Link#21>                            1     0 ${utun5[0]}        1     0 ${utun5[1]}     0
`;

/** Drives watchRates by hand: each `step()` fires the pending timer and lets the sample settle. */
function harness(samples: (string | Error | Promise<string>)[], clock: number[], onRates?: () => void) {
  const updates: Map<string, unknown>[] = [];
  const delays: number[] = [];
  let pending: (() => void) | undefined;
  let cancelled = 0;
  const run = async () => {
    const next = samples.shift();
    if (next instanceof Error) throw next;
    return (await next) ?? "";
  };
  const report = (rates: Map<string, unknown>) => {
    updates.push(rates);
    onRates?.();
  };
  const stop = watchRates(report, run, {
    now: () => clock.shift() ?? 0,
    schedule: (fn, ms) => {
      pending = fn;
      delays.push(ms);
      return () => cancelled++;
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const step = async () => {
    const fn = pending;
    pending = undefined;
    fn?.();
    await settle();
  };
  return {
    updates,
    delays,
    stop,
    step,
    settle,
    cancelledCount: () => cancelled,
    hasPending: () => pending !== undefined,
  };
}

test("watchRates reports the first rate after one second, then every three, each against the previous sample", async () => {
  const h = harness(
    [
      sample([1_000_000, 50_000], [500, 500]),
      sample([3_500_000, 135_000], [900, 400]),
      sample([6_500_000, 135_000], [900, 400]),
    ],
    [0, 2000, 5000],
  );
  await h.settle();
  assert.equal(h.updates.length, 0);
  await h.step();
  // divided by the time that really passed (2 s), not the 1 s asked for; utun5's sent counter went
  // backwards (the tunnel was recreated), so it says nothing about a rate
  assert.deepEqual([...h.updates[0]], [["en0", { down: 1_250_000, up: 42_500 }]]);
  await h.step();
  assert.deepEqual(h.updates[1].get("en0"), { down: 1_000_000, up: 0 });
  assert.deepEqual(h.delays, [1000, 3000, 3000]);
});

test("watchRates leaves out an interface missing from the earlier sample", async () => {
  const h = harness([`${NETSTAT.split("\n")[0]}\n`, sample([10, 10], [10, 10])], [0, 1000]);
  await h.settle();
  await h.step();
  assert.equal(h.updates[0].size, 0);
});

test("a failed sample shows no rate, and the next one is measured against the last good sample", async () => {
  const h = harness(
    [sample([0, 0], [0, 0]), new Error("netstat timed out"), sample([3000, 0], [0, 0]), sample([9000, 0], [0, 0])],
    [0, 1000, 4000, 7000],
  );
  await h.settle();
  await h.step();
  assert.equal(h.updates[0].size, 0);
  await h.step();
  // against the sample taken at 0 s, four seconds earlier
  assert.deepEqual(h.updates[1].get("en0"), { down: 750, up: 0 });
  await h.step();
  assert.deepEqual(h.updates[2].get("en0"), { down: 2000, up: 0 });
});

test("a callback that throws does not end the refresh", async () => {
  const h = harness(
    [sample([0, 0], [0, 0]), sample([1000, 0], [0, 0]), sample([4000, 0], [0, 0])],
    [0, 1000, 4000],
    () => {
      throw new Error("render failed");
    },
  );
  await h.settle();
  await h.step();
  await h.step();
  assert.equal(h.updates.length, 2);
});

test("stopping while a sample is still running reports nothing and schedules nothing", async () => {
  let release: (text: string) => void = () => {};
  const h = harness([new Promise<string>((resolve) => (release = resolve))], [0]);
  h.stop();
  release(sample([0, 0], [0, 0]));
  await h.settle();
  assert.equal(h.updates.length, 0);
  assert.equal(h.delays.length, 0);
});

test("watchRates stops scheduling and reporting once stopped", async () => {
  const h = harness([sample([0, 0], [0, 0]), sample([1000, 0], [0, 0])], [0, 1000]);
  await h.settle();
  h.stop();
  assert.equal(h.cancelledCount(), 1);
  await h.step();
  assert.equal(h.updates.length, 0);
  assert.equal(h.hasPending(), false);
});
