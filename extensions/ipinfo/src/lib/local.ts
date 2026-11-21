import { spawn } from "node:child_process";

export type InterfaceKind = "wifi" | "ethernet" | "tether" | "vpn" | "other";

export interface LocalInterface {
  device: string;
  kind: InterfaceKind;
  label: string;
  ipv4: string;
  ssid?: string;
  router?: string;
  profile?: string;
  primary?: boolean;
}

export interface VpnService {
  provider: string;
  profile?: string;
}

export interface VpnProfile {
  id: string;
  name: string;
  provider: string;
}

export type Runner = (file: string, args: string[], input?: string) => Promise<string>;

// Absolute paths only: GUI hosts (Tinycast, Raycast) inherit a minimal PATH, and a
// relative name would let anything earlier on that PATH answer for a system tool.
const NETWORKSETUP = "/usr/sbin/networksetup";
const IFCONFIG = "/sbin/ifconfig";
const IPCONFIG = "/usr/sbin/ipconfig";
const SCUTIL = "/usr/sbin/scutil";
/** Root-owned symlink created by the Cloudflare WARP installer; no PATH fallback. */
const WARP_CLI = "/usr/local/bin/warp-cli";
const NETSTAT = "/usr/sbin/netstat";

const TIMEOUT_MS = 2000;
const MAX_OUTPUT = 1 << 20;
/** Upper bound on how many services a single enumeration will interrogate. */
const MAX_ITEMS = 16;

/** Runs one tool by absolute path with a hard kill timeout and an output cap; exported for its own tests. */
export const runTool: Runner = (file, args, input) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "ignore"], timeout: TIMEOUT_MS, killSignal: "SIGKILL" });
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    // The host's child_process shim honours `timeout` but not `killSignal`, so carry our own timer.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${file} timed out after ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_OUTPUT) {
        child.kill("SIGKILL");
        finish(new Error(`${file} output exceeded ${MAX_OUTPUT} bytes`));
        return;
      }
      chunks.push(buf);
    });
    // `exit` can fire while stdout still holds unread data; only `close` guarantees the pipe drained.
    let exitCode: number | null = null;
    child.on("error", finish);
    child.on("exit", (code) => {
      exitCode = code;
    });
    child.on("close", (code) => {
      const status = code ?? exitCode;
      finish(status === 0 ? undefined : new Error(`${file} exited with ${status}`));
    });
    // An unhandled "error" on stdin would take the host down; a broken pipe (child exited early) is not a failure.
    child.stdin?.on("error", () => {});
    // scutil reads its command from stdin to EOF; closing stdin is also what starts the process in the shim.
    try {
      child.stdin?.end(input ?? "");
    } catch (err) {
      child.kill("SIGKILL");
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });

const defaultRunner: Runner = runTool;

/** `networksetup -listallhardwareports` → device → "Hardware Port" name. */
export function parseHardwarePorts(text: string): Map<string, string> {
  const ports = new Map<string, string>();
  let port: string | undefined;
  for (const line of text.split("\n")) {
    const p = line.match(/^Hardware Port: (.+)$/);
    if (p) {
      port = p[1].trim();
      continue;
    }
    const d = line.match(/^Device: (\S+)$/);
    if (d && port) {
      ports.set(d[1], port);
      port = undefined;
    }
  }
  return ports;
}

export interface IfconfigEntry {
  ipv4: string;
  /** macOS's own word for the link ("Wi-Fi", "USB Ethernet", …), from `ifconfig -v`. */
  type?: string;
}

/** `ifconfig -v` → device → first IPv4 and link type; interfaces without an IPv4 (and lo0) are omitted. */
export function parseIfconfig(text: string): Map<string, IfconfigEntry> {
  const ipv4s = new Map<string, string>();
  const types = new Map<string, string>();
  let device: string | undefined;
  for (const line of text.split("\n")) {
    const head = line.match(/^([A-Za-z0-9._-]+): flags=/);
    if (head) {
      device = head[1];
      continue;
    }
    if (!device) continue;
    const inet = line.match(/^\s+inet (\d+\.\d+\.\d+\.\d+)/);
    if (inet && !ipv4s.has(device)) ipv4s.set(device, inet[1]);
    const type = line.match(/^\s+type: (.+)$/);
    if (type) types.set(device, type[1].trim());
  }
  const result = new Map<string, IfconfigEntry>();
  for (const [dev, ipv4] of ipv4s) {
    if (dev === "lo0") continue;
    const type = types.get(dev);
    result.set(dev, type ? { ipv4, type } : { ipv4 });
  }
  return result;
}

/** `ipconfig getsummary <dev>` → SSID and Router if present. */
export function parseWifiSummary(text: string): { ssid?: string; router?: string } {
  const out: { ssid?: string; router?: string } = {};
  const ssid = text.match(/^\s*SSID : (.+)$/m);
  if (ssid) out.ssid = ssid[1].trim();
  const router = text.match(/^\s*Router : (\S+)$/m);
  if (router) out.router = router[1];
  return out;
}

const PROVIDERS: [RegExp, string][] = [
  [/wireguard/i, "WireGuard"],
  [/cloudflare/i, "Cloudflare WARP"],
  [/tailscale/i, "Tailscale"],
  [/openvpn/i, "OpenVPN"],
  [/ipsec|ike/i, "IPSec"],
];

function providerOf(fallback: string, id: string): string {
  for (const [re, name] of PROVIDERS) if (re.test(id)) return name;
  return fallback;
}

/**
 * `scutil --nc list` → connected services, in listed order.
 * Tolerates the unterminated quote macOS emits for services whose name contains a comma.
 */
export function parseVpnList(text: string): VpnProfile[] {
  const out: VpnProfile[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\*?\s*\(Connected\)\s+(\S+)\s+([A-Za-z]+)[^"]*"([^"[]+?)"?\s*\[([^\]]+)\]\s*$/);
    if (m) out.push({ id: m[1], name: m[3].trim(), provider: providerOf(m[2], m[4]) });
  }
  return out;
}

/** `scutil --nc status <id>` or a `show …/IPv4` dump → the tunnel's interface name. */
export function parseVpnStatus(text: string): string | undefined {
  return text.match(/^\s*InterfaceName : (\S+)$/m)?.[1];
}

/** `scutil` `show State:/Network/Global/IPv4` → the device carrying the default route. */
export function parsePrimaryInterface(text: string): string | undefined {
  return text.match(/^\s*PrimaryInterface : (\S+)$/m)?.[1];
}

// `scutil` has no argv form for `list`/`show` on the dynamic store, so these two commands go in on stdin.
const SERVICE_LIST = "list State:/Network/Service/[^/]+/IPv4\n";
const GLOBAL_IPV4 = "show State:/Network/Global/IPv4\n";

/** `scutil` `list State:/Network/Service/…/IPv4` → service ids that are names rather than UUIDs (e.g. CloudflareWARP). */
export function parseNamedServices(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(/State:\/Network\/Service\/([^/\s]+)\/IPv4/g)) {
    if (!/^[0-9a-f-]{36}$/i.test(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** `warp-cli registration show` → the Zero Trust organization, if enrolled. */
export function parseWarpOrganization(text: string): string | undefined {
  return text.match(/^Organization: (.+)$/m)?.[1].trim();
}

/**
 * Only a networksetup port is classified: VM bridges and Apple's internal links report Ethernet or
 * Wi-Fi types too. The name decides first, because an iPhone's USB link also reports "USB Ethernet";
 * the type then catches adapters named after their chip or speed ("AX88179A", "USB 10/100/1G/2.5G LAN").
 */
function kindOf(portName: string | undefined, type: string | undefined): InterfaceKind {
  if (!portName) return "other";
  if (/Wi-Fi/i.test(portName)) return "wifi";
  // "iPhone USB", "iPad USB", "Bluetooth PAN": a phone sharing its cellular connection
  if (/iPhone|iPad|Bluetooth PAN/i.test(portName)) return "tether";
  if (/Ethernet/i.test(portName)) return "ethernet";
  if (type === "Wi-Fi") return "wifi";
  if (type === "Ethernet" || type === "USB Ethernet") return "ethernet";
  return "other";
}

const ORDER: Record<InterfaceKind, number> = { wifi: 0, ethernet: 1, tether: 2, vpn: 3, other: 4 };

/** Self-assigned 169.254/16: the device got no DHCP lease, so the address is useless to copy. */
const LINK_LOCAL = /^169\.254\./;

/** Named services we are willing to label; anything else stays a generic "VPN". */
const NAMED_SERVICES: [RegExp, string][] = [[/^CloudflareWARP$/i, "Cloudflare WARP"]];
const WARP_LABEL = "Cloudflare WARP";
/** A named service may only claim a tunnel device — it must never relabel Wi-Fi or Ethernet. */
const TUNNEL_DEVICE = /^(utun|ipsec|ppp)\d*$/;

async function warpOrganization(run: Runner): Promise<string | undefined> {
  try {
    return parseWarpOrganization(await run(WARP_CLI, ["registration", "show"]));
  } catch {
    // best-effort: the tunnel is still labelled, just without the Zero Trust org
    return undefined;
  }
}

const fulfilled = (r: PromiseSettledResult<string>): string | undefined =>
  r.status === "fulfilled" ? r.value : undefined;

async function vpnsByDevice(run: Runner, ncList?: string, serviceList?: string): Promise<Map<string, VpnService>> {
  const vpns = new Map<string, VpnService>();

  const profiles = ncList ? parseVpnList(ncList).slice(0, MAX_ITEMS) : [];
  const statuses = await Promise.allSettled(profiles.map((p) => run(SCUTIL, ["--nc", "status", p.id])));
  statuses.forEach((res, i) => {
    // one unreachable profile skips only itself
    if (res.status !== "fulfilled") return;
    const device = parseVpnStatus(res.value);
    const p = profiles[i];
    if (device && !vpns.has(device)) vpns.set(device, { provider: p.provider, profile: p.name });
  });

  // System-extension tunnels (Cloudflare WARP) never appear in `--nc list`; they register a named service instead.
  const ids = serviceList ? parseNamedServices(serviceList).slice(0, MAX_ITEMS) : [];
  const shows = await Promise.allSettled(ids.map((id) => run(SCUTIL, [], `show State:/Network/Service/${id}/IPv4\n`)));
  const warpDevices: string[] = [];
  shows.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const device = parseVpnStatus(res.value);
    // a device already claimed from `--nc list` wins; the named branch never overwrites it
    if (!device || vpns.has(device) || !TUNNEL_DEVICE.test(device)) return;
    const id = ids[i];
    const known = NAMED_SERVICES.find(([re]) => re.test(id));
    if (!known) {
      // an unknown id is never run through providerOf — it only names the profile
      vpns.set(device, { provider: "VPN", profile: id });
      return;
    }
    vpns.set(device, { provider: known[1] });
    if (known[1] === WARP_LABEL) warpDevices.push(device);
  });

  // at most one warp-cli invocation per enumeration, and only for an accepted WARP service
  if (warpDevices.length > 0) {
    const org = await warpOrganization(run);
    if (org) {
      for (const device of warpDevices) {
        const vpn = vpns.get(device);
        if (vpn) vpn.profile = org;
      }
    }
  }

  return vpns;
}

export async function getLocalInterfaces(run: Runner = defaultRunner): Promise<LocalInterface[]> {
  const [hardware, ifconfig, ncList, serviceList, globalIpv4] = await Promise.allSettled([
    run(NETWORKSETUP, ["-listallhardwareports"]),
    run(IFCONFIG, ["-v"]),
    run(SCUTIL, ["--nc", "list"]),
    run(SCUTIL, [], SERVICE_LIST),
    run(SCUTIL, [], GLOBAL_IPV4),
  ]);
  // ifconfig is the only hard dependency: without it there is nothing to show
  if (ifconfig.status === "rejected") {
    throw ifconfig.reason instanceof Error ? ifconfig.reason : new Error(String(ifconfig.reason));
  }
  // networksetup is best-effort; every device just becomes "other" without it
  const ports = hardware.status === "fulfilled" ? parseHardwarePorts(hardware.value) : new Map<string, string>();
  const links = parseIfconfig(ifconfig.value);
  const primary = globalIpv4.status === "fulfilled" ? parsePrimaryInterface(globalIpv4.value) : undefined;
  const vpns = await vpnsByDevice(run, fulfilled(ncList), fulfilled(serviceList));

  const result: LocalInterface[] = [];
  const summaryDevices: string[] = [];
  for (const [device, { ipv4, type }] of links) {
    const vpn = vpns.get(device);
    if (vpn) {
      // A VPN row is "up" by construction: it only exists because ifconfig gave the tunnel an IPv4.
      const iface: LocalInterface = { device, kind: "vpn", label: vpn.provider, ipv4 };
      if (vpn.profile) iface.profile = vpn.profile;
      if (device === primary) iface.primary = true;
      result.push(iface);
      continue;
    }
    const port = ports.get(device);
    const kind = kindOf(port, type);
    // Unnamed link-local interfaces (an iPhone's companion link, idle adapters) are noise; on a
    // named Wi-Fi/Ethernet port the same address is a useful "no DHCP lease" signal, so keep it.
    if (kind === "other" && LINK_LOCAL.test(ipv4) && device !== primary) continue;
    const iface: LocalInterface = { device, kind, label: port ?? device, ipv4 };
    if (device === primary) iface.primary = true;
    if (kind !== "other") summaryDevices.push(device);
    result.push(iface);
  }

  const summaries = await Promise.allSettled(summaryDevices.map((d) => run(IPCONFIG, ["getsummary", d])));
  summaries.forEach((res, i) => {
    // ipconfig is best-effort; the IP row is still useful without SSID or router
    if (res.status !== "fulfilled") return;
    const iface = result.find((x) => x.device === summaryDevices[i]);
    if (iface) Object.assign(iface, parseWifiSummary(res.value));
  });

  return result.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.device.localeCompare(b.device));
}

// MARK: - Traffic

/** The first rate comes quickly; after that the rows refresh at a calmer pace while the view is open. */
const FIRST_RATE_MS = 1000;
const REFRESH_MS = 3000;

interface Counters {
  rx: number;
  tx: number;
}

/** Bytes per second. */
export interface Rate {
  down: number;
  up: number;
}

/**
 * `netstat -ibn` → device → cumulative bytes received and sent, from each interface's `<Link#>` row.
 * The link-address column is blank for tunnels, so the counters are read from the right.
 */
export function parseNetstat(text: string): Map<string, Counters> {
  const counters = new Map<string, Counters>();
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (!fields[2]?.startsWith("<Link#") || fields.length < 10) continue;
    // … Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
    const rx = Number(fields[fields.length - 5]);
    const tx = Number(fields[fields.length - 2]);
    if (!Number.isSafeInteger(rx) || !Number.isSafeInteger(tx)) continue;
    counters.set(fields[0].replace(/\*$/, ""), { rx, tx });
  }
  return counters;
}

interface Sample {
  at: number;
  counters: Map<string, Counters>;
}

/** Bytes per second between two samples; an interface missing from either, or whose counter went backwards, is left out. */
function ratesBetween(before: Sample, after: Sample): Map<string, Rate> {
  const rates = new Map<string, Rate>();
  // Divide by the time that really passed: timers wake late on a busy host.
  const seconds = (after.at - before.at) / 1000;
  if (seconds <= 0) return rates;
  for (const [device, latest] of after.counters) {
    const begin = before.counters.get(device);
    if (!begin) continue;
    const down = latest.rx - begin.rx;
    const up = latest.tx - begin.tx;
    // A counter that went backwards means the interface was recreated between samples.
    if (down < 0 || up < 0) continue;
    rates.set(device, { down: down / seconds, up: up / seconds });
  }
  return rates;
}

interface WatchOptions {
  now?: () => number;
  /** Runs `fn` after `ms` and returns a canceller; setTimeout by default. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

/**
 * Samples the counters now, after FIRST_RATE_MS, then every REFRESH_MS, and reports each interface's
 * rate against the last good sample. A failed sample reports an empty map (no rates). Returns a stop
 * function that cancels the pending timer and silences any sample in flight.
 */
export function watchRates(
  onRates: (rates: Map<string, Rate>) => void,
  run: Runner = defaultRunner,
  options: WatchOptions = {},
): () => void {
  // Date.now, not performance.now: the Tinycast host is not Node and may lack `performance`.
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });

  let stopped = false;
  let cancelTimer = () => {};
  let previous: Sample | undefined;

  const tick = async (delay: number) => {
    // Stamp the sample as netstat starts, so a late exit on a busy host does not skew the interval.
    const at = now();
    const counters = await run(NETSTAT, ["-ibn"])
      .then(parseNetstat)
      .catch(() => undefined);
    if (stopped) return;
    // Scheduled before reporting, so nothing the callback does can end the refresh.
    cancelTimer = schedule(() => void tick(REFRESH_MS), delay);

    let rates: Map<string, Rate> | undefined;
    if (!counters) {
      // Show no rate rather than a stale one, but keep the last good sample so the next one
      // yields a rate straight away.
      rates = new Map();
    } else {
      const current = { at, counters };
      if (previous) rates = ratesBetween(previous, current);
      previous = current;
    }
    try {
      if (rates) onRates(rates);
    } catch {
      // The view's setState; a throw there is not ours to handle.
    }
  };
  void tick(FIRST_RATE_MS);

  return () => {
    stopped = true;
    cancelTimer();
  };
}
