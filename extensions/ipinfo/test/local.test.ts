import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHardwarePorts,
  parseIfconfig,
  parseWifiSummary,
  parseVpnList,
  parseVpnStatus,
  parseNamedServices,
  parsePrimaryInterface,
  parseWarpOrganization,
  getLocalInterfaces,
  type Runner,
} from "../src/lib/local.ts";

const HW = `
Hardware Port: Ethernet Adapter (en3)
Device: en3
Ethernet Address: 00:00:00:00:00:03

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: 00:00:00:00:00:10

Hardware Port: Wi-Fi
Device: en0
Ethernet Address: 00:00:00:00:00:00

VLAN Configurations
===================
`;

const IFCONFIG = `lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
\toptions=1203<RXCSUM,TXCSUM,TXSTATUS,SW_TIMESTAMP>
\tinet 127.0.0.1 netmask 0xff000000
\tinet6 ::1 prefixlen 128
en3: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tether 00:00:00:00:00:03
\tinet 10.0.0.5 netmask 0xffffff00 broadcast 10.0.0.255
\tstatus: active
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tether 00:00:00:00:00:00
\tinet6 fe80::1%en0 prefixlen 64 scopeid 0x4
\tinet 192.168.0.42 netmask 0xffffff00 broadcast 192.168.0.255
\tstatus: active
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1500
\tinet 100.64.0.9 --> 100.64.0.9 netmask 0xffffffff
bridge100: flags=8a63<UP,BROADCAST,SMART,RUNNING,ALLMULTI,SIMPLEX,MULTICAST> mtu 1500
\tinet 172.30.31.3 netmask 0xfffffe00 broadcast 172.30.31.255
\tstatus: active
awdl0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tstatus: active
`;

/** Wi-Fi plus two tunnels, for the multi-profile cases. */
const IFCONFIG_TUNNELS = `en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tether 00:00:00:00:00:00
\tinet 192.168.0.42 netmask 0xffffff00 broadcast 192.168.0.255
\tstatus: active
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1500
\tinet 10.8.0.2 --> 10.8.0.2 netmask 0xffffffff
utun5: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1500
\tinet 10.8.0.3 --> 10.8.0.3 netmask 0xffffffff
`;

const SUMMARY = `<dictionary> {
  BSSID : 00:00:00:00:00:99
  ConnectionID : 104
  IPv4 : <array> {
    0 : <dictionary> {
      Addresses : <array> {
        0 : 192.168.0.42
      }
      Router : 192.168.0.1
    }
  }
  SSID : ExampleWiFi
  Security : WPA2 Personal
}
`;

const WG_ID = "08D43042-2601-4F2B-A9B6-1AE8A7260E27";
const WARP_ID = "11111111-2222-3333-4444-555555555555";
const IKEV2_ID = "22222222-2222-3333-4444-555555555555";

const NC_LIST = `Available network connection services in the current set (*=enabled):
* (Disconnected)   74068C02-2D15-4235-A282-37A89EFD4A70 PPP --> ChameleonUltra: hw_v1, fw_v512 "ChameleonUltra: hw_v1, fw_v512" [PPP:Modem]
* (Disconnected)   951AD3B4-DAF2-4405-B8F7-96658B50457D VPN (com.wireguard.macos) "home"                            [VPN:com.wireguard.macos]
* (Connected)      ${WG_ID} VPN (com.wireguard.macos) "office-vpn"                      [VPN:com.wireguard.macos]
* (Connected)      ${WARP_ID} VPN (com.cloudflare.1dot1dot1dot1.macos) "Cloudflare WARP" [VPN:com.cloudflare.1dot1dot1dot1.macos]
  (Connected)      ${IKEV2_ID} IPSec "Office IKEv2"                                       [VPN:IPSec]
`;

/** macOS drops the closing quote when the service name contains a comma. */
const NC_LIST_UNTERMINATED = `Available network connection services in the current set (*=enabled):
* (Connected)   1DA56645-7350-49ED-9D79-275DAC53903D PPP --> ChameleonUltra: hw_v1, fw_v256 "ChameleonUltra: hw_v1, fw_v256  [PPP:Modem]
`;

const NC_STATUS = `Connected
Extended Status <dictionary> {
  DNSServers : <array> {
    0 : 1.1.1.1
  }
  IPv4 : <dictionary> {
    Addresses : <array> {
      0 : 10.8.0.2
    }
    InterfaceName : utun4
    Router : 10.8.0.2
  }
}
`;

const SERVICES = `  subKey [0] = State:/Network/Service/4A3A6315-490C-4ACD-88A0-C5232EF53B60/IPv4
  subKey [1] = State:/Network/Service/CloudflareWARP/IPv4
`;

const WARP_IPV4 = `<dictionary> {
  Addresses : <array> {
    0 : 172.16.0.2
  }
  InterfaceName : utun4
  Router : 172.16.0.2
}
`;

const WARP_REG = `Account type: Team
ID: 00000000-0000-0000-0000-000000000000
Organization: example-team
`;

const GLOBAL_IPV4 = `<dictionary> {
  PrimaryInterface : utun4
  PrimaryService : 4A3A6315-490C-4ACD-88A0-C5232EF53B60
  Router : 10.8.0.1
}
`;

/** `scutil --nc list` subKey dump for the given service ids. */
const serviceList = (...ids: string[]) =>
  ids.map((id, n) => `  subKey [${n}] = State:/Network/Service/${id}/IPv4\n`).join("");

/** A `show …/IPv4` or `--nc status` dump naming one interface. */
const namesInterface = (device: string) => `<dictionary> {
  Addresses : <array> {
    0 : 10.8.0.9
  }
  InterfaceName : ${device}
}
`;

interface Stubs {
  networksetup?: string;
  ifconfig?: string;
  ipconfig?: string;
  ncList?: string;
  ncStatus?: Record<string, string>;
  serviceList?: string;
  serviceShow?: Record<string, string>;
  globalIpv4?: string;
  warp?: string;
}

/**
 * A Runner over fixture strings, dispatching on the tool's basename so the production
 * code keeps its absolute paths. Anything a test leaves unstubbed rejects, exactly as a
 * missing or failing tool would.
 */
function stubRunner(stubs: Stubs, calls: string[] = []): Runner {
  return async (file, args, input) => {
    const tool = file.split("/").pop();
    calls.push([tool, ...args, ...(input ? [`<${input.trim()}`] : [])].join(" "));
    if (tool === "networksetup" && stubs.networksetup !== undefined) return stubs.networksetup;
    if (tool === "ifconfig" && stubs.ifconfig !== undefined) return stubs.ifconfig;
    if (tool === "ipconfig" && stubs.ipconfig !== undefined) return stubs.ipconfig;
    if (tool === "warp-cli" && stubs.warp !== undefined) return stubs.warp;
    if (tool === "scutil") {
      if (args[1] === "list" && stubs.ncList !== undefined) return stubs.ncList;
      const status = args[1] === "status" ? stubs.ncStatus?.[args[2]] : undefined;
      if (status !== undefined) return status;
      if (input?.startsWith("list ") && stubs.serviceList !== undefined) return stubs.serviceList;
      if (input === "show State:/Network/Global/IPv4\n" && stubs.globalIpv4 !== undefined) return stubs.globalIpv4;
      const show = input?.match(/^show State:\/Network\/Service\/([^/]+)\/IPv4$/m);
      const dump = show ? stubs.serviceShow?.[show[1]] : undefined;
      if (dump !== undefined) return dump;
    }
    throw new Error(`${tool} exited with 1`);
  };
}

const find = (ifaces: { device: string }[], device: string) => ifaces.find((i) => i.device === device);

test("parseVpnList keeps only connected services, with id, name and provider", () => {
  assert.deepEqual(parseVpnList(NC_LIST), [
    { id: WG_ID, name: "office-vpn", provider: "WireGuard" },
    { id: WARP_ID, name: "Cloudflare WARP", provider: "Cloudflare WARP" },
    { id: IKEV2_ID, name: "Office IKEv2", provider: "IPSec" },
  ]);
});

test("parseVpnList tolerates an unterminated quote", () => {
  assert.deepEqual(parseVpnList(NC_LIST_UNTERMINATED), [
    {
      id: "1DA56645-7350-49ED-9D79-275DAC53903D",
      name: "ChameleonUltra: hw_v1, fw_v256",
      provider: "PPP",
    },
  ]);
});

test("parseNamedServices skips UUID services", () => {
  assert.deepEqual(parseNamedServices(SERVICES), ["CloudflareWARP"]);
});

test("parseWarpOrganization reads the org", () => {
  assert.equal(parseWarpOrganization(WARP_REG), "example-team");
  assert.equal(parseWarpOrganization("Account type: Free\n"), undefined);
});

test("parsePrimaryInterface reads the default-route device", () => {
  assert.equal(parsePrimaryInterface("  PrimaryInterface : utun4\n"), "utun4");
  assert.equal(parsePrimaryInterface(GLOBAL_IPV4), "utun4");
  assert.equal(parsePrimaryInterface("<dictionary> {\n}\n"), undefined);
});

test("parseVpnStatus reads the tunnel interface name", () => {
  assert.equal(parseVpnStatus(NC_STATUS), "utun4");
  assert.equal(parseVpnStatus("Disconnected\n"), undefined);
});

test("parseHardwarePorts maps device to port name", () => {
  assert.deepEqual(
    [...parseHardwarePorts(HW)],
    [
      ["en3", "Ethernet Adapter (en3)"],
      ["bridge0", "Thunderbolt Bridge"],
      ["en0", "Wi-Fi"],
    ],
  );
});

test("parseIfconfig keeps only interfaces with an IPv4, skips lo0", () => {
  assert.deepEqual(
    [...parseIfconfig(IFCONFIG)],
    [
      ["en3", "10.0.0.5"],
      ["en0", "192.168.0.42"],
      ["utun4", "100.64.0.9"],
      ["bridge100", "172.30.31.3"],
    ],
  );
});

test("parseIfconfig keeps the first of several inet lines on one device", () => {
  const text = `en0: flags=8863<UP> mtu 1500
\tinet 192.168.0.42 netmask 0xffffff00 broadcast 192.168.0.255
\tinet 169.254.1.1 netmask 0xffff0000 broadcast 169.254.255.255
`;
  assert.deepEqual([...parseIfconfig(text)], [["en0", "192.168.0.42"]]);
});

test("parseWifiSummary reads SSID and Router", () => {
  assert.deepEqual(parseWifiSummary(SUMMARY), { ssid: "ExampleWiFi", router: "192.168.0.1" });
});

test("parseWifiSummary tolerates missing fields", () => {
  assert.deepEqual(parseWifiSummary("<dictionary> {\n}\n"), {});
});

test("getLocalInterfaces orders wifi, ethernet, vpn, other and enriches wifi and vpn", async () => {
  const calls: string[] = [];
  const run = stubRunner(
    { networksetup: HW, ifconfig: IFCONFIG, ipconfig: SUMMARY, ncList: NC_LIST, ncStatus: { [WG_ID]: NC_STATUS } },
    calls,
  );
  assert.deepEqual(await getLocalInterfaces(run), [
    {
      device: "en0",
      kind: "wifi",
      label: "Wi-Fi",
      ipv4: "192.168.0.42",
      ssid: "ExampleWiFi",
      router: "192.168.0.1",
    },
    { device: "en3", kind: "ethernet", label: "Ethernet Adapter (en3)", ipv4: "10.0.0.5" },
    { device: "utun4", kind: "vpn", label: "WireGuard", ipv4: "100.64.0.9", profile: "office-vpn" },
    { device: "bridge100", kind: "other", label: "bridge100", ipv4: "172.30.31.3" },
  ]);
  assert.ok(calls.includes("ipconfig getsummary en0"));
});

test("getLocalInterfaces labels a Cloudflare WARP tunnel from the named service", async () => {
  const run = stubRunner({
    networksetup: HW,
    ifconfig: IFCONFIG,
    ipconfig: SUMMARY,
    warp: WARP_REG,
    ncList: "Available network connection services in the current set (*=enabled):\n",
    serviceList: SERVICES,
    serviceShow: { CloudflareWARP: WARP_IPV4 },
  });
  assert.deepEqual(find(await getLocalInterfaces(run), "utun4"), {
    device: "utun4",
    kind: "vpn",
    label: "Cloudflare WARP",
    ipv4: "100.64.0.9",
    profile: "example-team",
  });
});

test("getLocalInterfaces maps the profiles whose status works and drops the ones that fail", async () => {
  const run = stubRunner({
    networksetup: HW,
    ifconfig: IFCONFIG_TUNNELS,
    ipconfig: SUMMARY,
    ncList: `* (Connected)      AAAAAAAA-0000-0000-0000-000000000001 VPN (com.wireguard.macos) "alpha" [VPN:com.wireguard.macos]
* (Connected)      BBBBBBBB-0000-0000-0000-000000000002 VPN (com.wireguard.macos) "beta"  [VPN:com.wireguard.macos]
`,
    ncStatus: { "BBBBBBBB-0000-0000-0000-000000000002": namesInterface("utun5") },
  });
  const ifaces = await getLocalInterfaces(run);
  assert.deepEqual(find(ifaces, "utun5"), {
    device: "utun5",
    kind: "vpn",
    label: "WireGuard",
    ipv4: "10.8.0.3",
    profile: "beta",
  });
  assert.deepEqual(find(ifaces, "utun4"), { device: "utun4", kind: "other", label: "utun4", ipv4: "10.8.0.2" });
});

test("getLocalInterfaces asks for the status of each id when two profiles share a name", async () => {
  const calls: string[] = [];
  const run = stubRunner(
    {
      networksetup: HW,
      ifconfig: IFCONFIG_TUNNELS,
      ipconfig: SUMMARY,
      ncList: `* (Connected)      AAAAAAAA-0000-0000-0000-000000000001 VPN (com.wireguard.macos) "home" [VPN:com.wireguard.macos]
* (Connected)      BBBBBBBB-0000-0000-0000-000000000002 VPN (com.wireguard.macos) "home" [VPN:com.wireguard.macos]
`,
      ncStatus: {
        "AAAAAAAA-0000-0000-0000-000000000001": namesInterface("utun4"),
        "BBBBBBBB-0000-0000-0000-000000000002": namesInterface("utun5"),
      },
    },
    calls,
  );
  const ifaces = await getLocalInterfaces(run);
  assert.deepEqual(
    calls.filter((c) => c.startsWith("scutil --nc status")),
    [
      "scutil --nc status AAAAAAAA-0000-0000-0000-000000000001",
      "scutil --nc status BBBBBBBB-0000-0000-0000-000000000002",
    ],
  );
  assert.deepEqual(
    ifaces.filter((i) => i.kind === "vpn").map((i) => i.device),
    ["utun4", "utun5"],
  );
});

test("getLocalInterfaces ignores a profile whose status names no interface", async () => {
  const run = stubRunner({
    networksetup: HW,
    ifconfig: IFCONFIG,
    ipconfig: SUMMARY,
    ncList: NC_LIST,
    ncStatus: { [WG_ID]: "Connected\n" },
  });
  assert.deepEqual(find(await getLocalInterfaces(run), "utun4"), {
    device: "utun4",
    kind: "other",
    label: "utun4",
    ipv4: "100.64.0.9",
  });
});

test("getLocalInterfaces never lets a named service claim a physical port", async () => {
  const run = stubRunner({
    networksetup: HW,
    ifconfig: IFCONFIG,
    ipconfig: SUMMARY,
    serviceList: serviceList("SomeCorpAgent"),
    serviceShow: { SomeCorpAgent: namesInterface("en0") },
  });
  assert.deepEqual(find(await getLocalInterfaces(run), "en0"), {
    device: "en0",
    kind: "wifi",
    label: "Wi-Fi",
    ipv4: "192.168.0.42",
    ssid: "ExampleWiFi",
    router: "192.168.0.1",
  });
});

test("getLocalInterfaces labels an unknown named service on a tunnel as a generic VPN", async () => {
  const calls: string[] = [];
  const run = stubRunner(
    {
      networksetup: HW,
      ifconfig: IFCONFIG,
      ipconfig: SUMMARY,
      warp: WARP_REG,
      serviceList: serviceList("SomeCorpAgent"),
      serviceShow: { SomeCorpAgent: namesInterface("utun4") },
    },
    calls,
  );
  assert.deepEqual(find(await getLocalInterfaces(run), "utun4"), {
    device: "utun4",
    kind: "vpn",
    label: "VPN",
    ipv4: "100.64.0.9",
    profile: "SomeCorpAgent",
  });
  assert.equal(calls.filter((c) => c.startsWith("warp-cli")).length, 0);
});

test("getLocalInterfaces keeps the WARP label when warp-cli is missing", async () => {
  const run = stubRunner({
    networksetup: HW,
    ifconfig: IFCONFIG,
    ipconfig: SUMMARY,
    serviceList: serviceList("CloudflareWARP"),
    serviceShow: { CloudflareWARP: WARP_IPV4 },
  });
  assert.deepEqual(find(await getLocalInterfaces(run), "utun4"), {
    device: "utun4",
    kind: "vpn",
    label: "Cloudflare WARP",
    ipv4: "100.64.0.9",
  });
});

test("getLocalInterfaces calls warp-cli once even when WARP is listed twice", async () => {
  const calls: string[] = [];
  const run = stubRunner(
    {
      networksetup: HW,
      ifconfig: IFCONFIG,
      ipconfig: SUMMARY,
      warp: WARP_REG,
      serviceList: serviceList("CloudflareWARP", "CloudflareWARP"),
      serviceShow: { CloudflareWARP: WARP_IPV4 },
    },
    calls,
  );
  assert.deepEqual(find(await getLocalInterfaces(run), "utun4"), {
    device: "utun4",
    kind: "vpn",
    label: "Cloudflare WARP",
    ipv4: "100.64.0.9",
    profile: "example-team",
  });
  assert.deepEqual(
    calls.filter((c) => c.startsWith("warp-cli")),
    ["warp-cli registration show"],
  );
});

test("getLocalInterfaces lets the --nc profile win over a named service on the same device", async () => {
  const calls: string[] = [];
  const run = stubRunner(
    {
      networksetup: HW,
      ifconfig: IFCONFIG,
      ipconfig: SUMMARY,
      warp: WARP_REG,
      ncList: NC_LIST,
      ncStatus: { [WG_ID]: NC_STATUS },
      serviceList: serviceList("CloudflareWARP"),
      serviceShow: { CloudflareWARP: WARP_IPV4 },
    },
    calls,
  );
  assert.deepEqual(find(await getLocalInterfaces(run), "utun4"), {
    device: "utun4",
    kind: "vpn",
    label: "WireGuard",
    ipv4: "100.64.0.9",
    profile: "office-vpn",
  });
  assert.equal(calls.filter((c) => c.startsWith("warp-cli")).length, 0);
});

test("getLocalInterfaces marks only the default-route device as primary", async () => {
  const run = stubRunner({
    networksetup: HW,
    ifconfig: IFCONFIG,
    ipconfig: SUMMARY,
    globalIpv4: GLOBAL_IPV4,
    ncList: NC_LIST,
    ncStatus: { [WG_ID]: NC_STATUS },
  });
  const ifaces = await getLocalInterfaces(run);
  assert.deepEqual(
    ifaces.filter((i) => i.primary).map((i) => i.device),
    ["utun4"],
  );
  assert.equal(find(ifaces, "utun4")?.primary, true);
  assert.equal(find(ifaces, "en0")?.primary, undefined);
});

test("getLocalInterfaces rejects when ifconfig fails", async () => {
  const run = stubRunner({ networksetup: HW, ipconfig: SUMMARY });
  await assert.rejects(getLocalInterfaces(run), /ifconfig exited with 1/);
});

test("getLocalInterfaces survives a failing scutil", async () => {
  const run = stubRunner({ networksetup: HW, ifconfig: IFCONFIG, ipconfig: SUMMARY });
  assert.deepEqual(find(await getLocalInterfaces(run), "utun4"), {
    device: "utun4",
    kind: "other",
    label: "utun4",
    ipv4: "100.64.0.9",
  });
});

test("getLocalInterfaces survives a failing ipconfig", async () => {
  const run = stubRunner({ networksetup: HW, ifconfig: IFCONFIG });
  assert.deepEqual(find(await getLocalInterfaces(run), "en0"), {
    device: "en0",
    kind: "wifi",
    label: "Wi-Fi",
    ipv4: "192.168.0.42",
  });
});

test("getLocalInterfaces survives a failing networksetup", async () => {
  const run = stubRunner({ ifconfig: IFCONFIG });
  const result = await getLocalInterfaces(run);
  assert.deepEqual(
    result.map((i) => i.device),
    ["bridge100", "en0", "en3", "utun4"],
  );
  for (const i of result) {
    assert.equal(i.kind, "other");
    assert.equal(i.label, i.device);
  }
});
