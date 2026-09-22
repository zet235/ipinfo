# ipinfo — Design

Date: 2026-09-22
Target: Raycast extension, run in both Raycast and Tinycast (Tinycast plugins are Raycast extensions byte-for-byte).

## Purpose

One command, `Show IP Info`, that answers two questions in one screen:

1. What is my public IP right now (via `https://ip.zet.tw/json`)?
2. Which local interfaces have an IPv4 address, and for Wi-Fi, which SSID/router?

Every row's title is a value the user wants to copy; Enter copies it.

## Non-goals

- MAC addresses, IPv6, DNS servers.
- Caching, background/interval refresh, menu-bar mode.
- Preferences (no configurable endpoint; `ip.zet.tw` is hard-coded).
- Windows/Linux support (Raycast/Tinycast are macOS-only for this use).

## Layout

```
src/
  ipinfo.tsx      # the command: List with three sections
  lib/public.ts   # fetchPublicInfo(): Promise<PublicInfo>
  lib/local.ts    # getLocalInterfaces(): LocalInterface[] (sync)
test/
  local.test.ts   # node --test, fixture strings for the parsers
```

`lib/*` never imports `@raycast/api` so it can be unit-tested with plain
`node --test`. `ipinfo.tsx` does layout only.

## Data

### `lib/public.ts`

```ts
export interface PublicInfo {
  ip: string; asn: string; org: string;
  country: string; country_code: string; city: string;
}
export async function fetchPublicInfo(timeoutMs = 5000): Promise<PublicInfo>
```

`fetch("https://ip.zet.tw/json")` with an `AbortController` timeout.
Throws on network error, non-2xx, or malformed JSON; the caller renders the
error. (Tinycast note: `AbortSignal` does not cancel the underlying
URLSession task, but the promise still rejects on time, which is all the UI
needs.)

### `lib/local.ts`

```ts
export type InterfaceKind = "wifi" | "ethernet" | "other";
export interface LocalInterface {
  device: string;          // en0, en3, utun4, bridge100
  kind: InterfaceKind;
  label: string;           // "Wi-Fi", "Ethernet Adapter (en3)", or device name
  ipv4: string;
  ssid?: string;           // wifi only
  router?: string;         // wifi only
}
export function getLocalInterfaces(): LocalInterface[]
```

Pipeline (all via `execFileSync`, no shell):

1. `networksetup -listallhardwareports` → `Map<device, hardwarePortName>`.
   Port name containing `Wi-Fi` ⇒ `wifi`; name containing `Ethernet` or
   `Thunderbolt Ethernet` ⇒ `ethernet`.
2. `ifconfig` → for each interface block, first `inet ` line (IPv4).
   Skip `lo0` and interfaces with no `inet`.
3. Devices not in the hardware-port map (utun*, bridge*, …) ⇒ `other`.
4. For each `wifi` device: `ipconfig getsummary <dev>` → `SSID :` and
   `Router :` lines.

Order: wifi, ethernet, other; stable by device name inside each group.

Parsers are exported separately (`parseHardwarePorts`, `parseIfconfig`,
`parseWifiSummary`) so tests feed them fixture strings.

## UI (`ipinfo.tsx`)

`List` with `isLoading` bound to the public fetch. Three
`List.Section`s:

| Section | Rows (title = copied value) | subtitle / accessory |
|---|---|---|
| Public | `ip` | `ip.zet.tw` |
| | `asn` | `org` |
| | `city, country (country_code)` | — |
| Wi-Fi (en0) | `ipv4` | `SSID: … · Router …` |
| Ethernet (en3) | `ipv4` | — |
| Other Interfaces | `ipv4` | `device` |

Wi-Fi and Ethernet sections are one per interface, titled `label (device)`.
Sections with no rows are omitted.

Actions on every row:

- `Copy` (Enter) — `Action.CopyToClipboard` of the title.
- `Copy All as Text` (⌘⇧C) — whole screen as plain `key: value` lines.
- `Open ip.zet.tw` — `Action.OpenInBrowser`.

## Error handling

- Public fetch fails/times out: Public section shows one row
  `Unavailable` with the error message as subtitle. No toast. Local
  sections render regardless (they are computed synchronously before
  first paint).
- A local command fails: that section is omitted; others render. Never
  throw out of the component.

## Testing

- `node --test test/` — parsers against fixture strings captured from this
  machine (Wi-Fi + two Ethernet adapters + utun + bridge).
- Headless render: `node <tinycast>/Scripts/raycast-runtime/test.mjs build/`
  must show the three section types.
- Manual: `npx ray build -e dist -o build`, Tinycast → Settings →
  Extensions → Add Folder → `build/`, launch, eyeball, copy a value.

## Build / install

- `npm i`, `npx ray build -e dist -o build`. Never `-e dev` (that installs
  into Raycast's dev slot instead of producing a folder).
- `build/` is git-ignored.
