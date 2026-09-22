# ipinfo

Raycast / Tinycast extension. One command, `ipinfo`, lists:

- Public IP, ASN + org, and city/country from <https://ip.zet.tw/json>
- Wi-Fi: IPv4, SSID, router
- Ethernet: IPv4
- VPN (WireGuard, Cloudflare WARP, IPSec, …): IPv4, the connected profile name, and a "default route" tag on the primary interface
- Other interfaces with an IPv4 (unnamed `utun*`, VM `bridge*`, …)

Enter copies the highlighted value; ⌘⇧C copies everything as text.

## Build

    npm install
    npm run build        # → build/  (ray build -e dist -o build)
    npm test             # node --test, no network or root needed
    npm run lint

## Install

- **Tinycast**: Settings → Extensions → Install → Add Folder… → `build/`.
  Rebuild + re-add after changes (Tinycast has no hot reload).
- **Raycast**: `npx ray develop` from the project root.

Local data comes from `networksetup -listallhardwareports`, `ifconfig`,
`ipconfig getsummary <wifi-device>`, `scutil` (`--nc list/status` for VPN profiles,
`State:/Network/Service/*` for system-extension tunnels such as Cloudflare WARP,
`State:/Network/Global/IPv4` for the default route) and `warp-cli registration show`
for the Zero Trust org; none need sudo.

Every tool is invoked by absolute path (`/usr/sbin`, `/sbin`), never through `PATH`,
so a GUI host's environment cannot substitute a different binary; `warp-cli` is read
from `/usr/local/bin` only, and the extension works without it.
