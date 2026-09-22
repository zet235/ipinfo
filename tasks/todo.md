# ipinfo — implementation

Plan: docs/superpowers/plans/2026-09-22-ipinfo.md

- [x] Task 1: Scaffold a building extension
- [x] Task 2: `lib/public.ts` — fetch ip.zet.tw
- [x] Task 3: `lib/local.ts` — parse local interfaces
- [x] Task 4: `ipinfo.tsx` — the List
- [x] Task 5: README
- [x] Final whole-branch review
- [x] Follow-ups: command title `ipinfo`, real icon, VPN detection (WireGuard via `scutil --nc`, Cloudflare WARP via named `State:` service + `warp-cli`), icons/tags/"Connected"
- [x] Final code review + security review fix wave

## Review

- 53 tests (`node --test`), `ray lint` 0 errors (1 accepted warning: the lowercase `ipinfo` command title), `ray build` OK, headless Tinycast render exercised the async subprocess + stdin path.
- Deviations from the original plan, all spec- or review-driven: `res.json()` replaced by a size-capped `text()` + `JSON.parse` with `malformed …` errors and `redirect: "error"`; `"type": "module"` in package.json; empty `Public` section omitted while loading; Copy-All text mirrors the screen incl. error rows; pure formatting in `src/lib/format.ts` (control/bidi characters stripped, empty public fields skipped); local enumeration is async (`spawn`, 2 s hard SIGKILL timeout, 1 MiB output cap, absolute tool paths, per-item best-effort, capped fan-out) and reports its own `Unavailable` row; only `ip` is a required public field.
- Test fixtures use documentation-range addresses and placeholder names; history was squashed to a single commit so no real network data exists in any reachable commit.
- Not verified by automation: the manual Tinycast GUI pass (Enter copy, ⌘⇧C, Wi-Fi-off error path, WARP/WireGuard rows) and the Raycast host itself.
