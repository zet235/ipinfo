import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNetstat, measureRates } from "../src/lib/local.ts";

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

test("measureRates divides the byte delta by the time that actually passed", async () => {
  const samples = [sample([1_000_000, 50_000], [500, 500]), sample([3_500_000, 135_000], [900, 400])];
  const clock = [0, 2000];
  const run = async () => samples.shift() ?? "";
  const rates = await measureRates(run, { sleep: async () => {}, now: () => clock.shift() ?? 0 });
  // utun5's sent counter went backwards (the tunnel was recreated), so it says nothing about a rate
  assert.deepEqual([...rates], [["en0", { down: 1_250_000, up: 42_500 }]]);
});

test("measureRates leaves out an interface that only appears in the second sample", async () => {
  const samples = [`${NETSTAT.split("\n")[0]}\n`, sample([10, 10], [10, 10])];
  const clock = [0, 1000];
  const run = async () => samples.shift() ?? "";
  const rates = await measureRates(run, { sleep: async () => {}, now: () => clock.shift() ?? 0 });
  assert.equal(rates.size, 0);
});
