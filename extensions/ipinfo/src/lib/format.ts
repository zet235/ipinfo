import type { PublicInfo } from "./public";
import type { LocalInterface } from "./local";
import type { Rate } from "./local";

export type PublicState =
  { status: "loading" } | { status: "ok"; info: PublicInfo } | { status: "error"; message: string };

export type LocalState =
  { status: "loading" } | { status: "ok"; ifaces: LocalInterface[] } | { status: "error"; message: string };

export type RowIcon = "ip" | "asn" | "location" | "error" | "wifi" | "ethernet" | "tether" | "vpn" | "other";

export interface Row {
  key: string;
  title: string;
  icon: RowIcon;
  subtitle?: string;
  tag?: string;
  accessory?: string;
  connected?: boolean;
  primary?: boolean;
  /** What Enter copies, when that is not the title. */
  copy?: string;
}

/**
 * Strip control and format characters. An SSID, a GeoIP org string or a subprocess error
 * message is attacker-influenced text: it must not carry ESC/OSC or U+202E into the list
 * or into the clipboard.
 */
export const clean = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, "");

/** `city, country (CC)`, skipping whichever parts the endpoint left empty. */
function locationOf(city: string, country: string, countryCode: string): string {
  const place = [city, country].filter(Boolean).join(", ");
  return (place + (countryCode ? ` (${countryCode})` : "")).trim();
}

export function publicRows(state: PublicState): Row[] {
  if (state.status === "loading") return [];
  if (state.status === "error") {
    const message = clean(state.message);
    return [{ key: "pub-err", title: "Unavailable", icon: "error", subtitle: message, copy: message }];
  }
  const ip = clean(state.info.ip);
  const asn = clean(state.info.asn);
  const org = clean(state.info.org);
  const location = locationOf(clean(state.info.city), clean(state.info.country), clean(state.info.country_code));

  const rows: Row[] = [{ key: "pub-ip", title: ip, icon: "ip", accessory: "ip.zet.tw" }];
  if (asn) rows.push({ key: "pub-asn", title: asn, icon: "asn", subtitle: org || undefined });
  else if (org) rows.push({ key: "pub-asn", title: org, icon: "asn" });
  if (location) rows.push({ key: "pub-loc", title: location, icon: "location" });
  return rows;
}

/** Below this many bytes a second in both directions a link is idle: mDNS and ARP chatter never stops. */
const IDLE_BYTES_PER_SECOND = 1000;

const UNITS = ["B", "KB", "MB", "GB"];

/** One decimal below 10 (bytes always whole); rounding first, so 999.6 KB/s reads 1.0 MB/s. */
function bytesPerSecond(n: number): string {
  let value = n;
  for (let unit = 0; ; unit++) {
    const text = unit > 0 && value < 9.95 ? value.toFixed(1) : String(Math.round(value));
    if (Number(text) < 1000 || unit === UNITS.length - 1) return `${text} ${UNITS[unit]}/s`;
    value /= 1000;
  }
}

/** `↓ 1.2 MB/s  ↑ 85 KB/s`, or `idle`. Decimal units, as Finder and Activity Monitor use. */
export function rateText(rate: Rate): string {
  if (rate.down < IDLE_BYTES_PER_SECOND && rate.up < IDLE_BYTES_PER_SECOND) return "idle";
  return `↓ ${bytesPerSecond(rate.down)}  ↑ ${bytesPerSecond(rate.up)}`;
}

/** `rate` is "measuring" until the samples are in, then the interface's rate (none if netstat had no row for it). */
export function interfaceRow(i: LocalInterface, rate?: Rate | "measuring"): Row {
  const parts: string[] = [];
  if (i.ssid) parts.push(`SSID: ${clean(i.ssid)}`);
  if (i.router) parts.push(`Router ${clean(i.router)}`);
  if (i.profile) parts.push(`Profile: ${clean(i.profile)}`);
  const row: Row = {
    key: `if-${i.device}`,
    title: clean(i.ipv4),
    icon: i.kind,
    subtitle: parts.join(" · ") || undefined,
    tag: clean(i.device),
  };
  // A decoration: "…" while measured, rather than holding the list's spinner.
  if (rate) row.accessory = rate === "measuring" ? "…" : rateText(rate);
  // A vpn row only exists because the tunnel has an IPv4, so it is up by construction.
  if (i.kind === "vpn") row.connected = true;
  if (i.primary) row.primary = true;
  return row;
}

export function localErrorRow(message: string): Row {
  const text = clean(message);
  return { key: "local-err", title: "Unavailable", icon: "error", subtitle: text, copy: text };
}

export function asText(pub: PublicState, local: LocalState): string {
  const lines: string[] = [];
  if (pub.status === "ok") {
    const ip = clean(pub.info.ip);
    const asn = clean(pub.info.asn);
    const org = clean(pub.info.org);
    const location = locationOf(clean(pub.info.city), clean(pub.info.country), clean(pub.info.country_code));
    lines.push(`Public IP: ${ip}`);
    if (asn) lines.push(`ASN: ${asn}`);
    if (org) lines.push(`Org: ${org}`);
    if (location) lines.push(`Location: ${location}`);
  } else if (pub.status === "error") {
    lines.push(`Public IP: Unavailable (${clean(pub.message)})`);
  }
  if (local.status === "error") {
    lines.push(`Local interfaces: Unavailable (${clean(local.message)})`);
  } else if (local.status === "ok") {
    for (const i of local.ifaces) {
      const extra = [
        i.ssid && `SSID ${clean(i.ssid)}`,
        i.router && `Router ${clean(i.router)}`,
        i.profile && `Profile ${clean(i.profile)}`,
      ]
        .filter(Boolean)
        .join(", ");
      const device = clean(i.device);
      const label = clean(i.label);
      const head = label === device ? `${device}: ${clean(i.ipv4)}` : `${label} (${device}): ${clean(i.ipv4)}`;
      lines.push(`${head}${extra ? ` [${extra}]` : ""}`);
    }
  }
  return lines.join("\n");
}
