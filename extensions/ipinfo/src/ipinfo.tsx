import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { fetchPublicInfo } from "./lib/public";
import { getLocalInterfaces, type LocalInterface } from "./lib/local";
import {
  type LocalState,
  type PublicState,
  type Row,
  type RowIcon,
  publicRows,
  interfaceRow,
  localErrorRow,
  asText,
  clean,
} from "./lib/format";

const ICONS: Record<RowIcon, Icon> = {
  ip: Icon.Globe,
  asn: Icon.Network,
  location: Icon.Pin,
  error: Icon.Warning,
  wifi: Icon.Wifi,
  ethernet: Icon.Plug,
  tether: Icon.Mobile,
  vpn: Icon.Shield,
  other: Icon.Dot,
};

const TINTS: Partial<Record<RowIcon, Color>> = { vpn: Color.Green, error: Color.Orange };
const TAG_COLORS: Partial<Record<RowIcon, Color>> = {
  vpn: Color.Green,
  wifi: Color.Blue,
  ethernet: Color.Blue,
  tether: Color.Blue,
};
const CONNECTED: List.Item.Accessory = {
  icon: { source: Icon.CircleFilled, tintColor: Color.Green },
  text: { value: "Connected", color: Color.Green },
};
const PRIMARY: List.Item.Accessory = { tag: { value: "default route", color: Color.Purple } };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Command() {
  const [pub, setPub] = useState<PublicState>({ status: "loading" });
  const [local, setLocal] = useState<LocalState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchPublicInfo()
      .then((info) => !cancelled && setPub({ status: "ok", info }))
      .catch((e: unknown) => !cancelled && setPub({ status: "error", message: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLocalInterfaces()
      .then((ifaces) => !cancelled && setLocal({ status: "ok", ifaces }))
      .catch((e: unknown) => !cancelled && setLocal({ status: "error", message: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const allText = asText(pub, local);
  const actions = (value: string) => (
    <ActionPanel>
      <Action.CopyToClipboard title="Copy" content={value} />
      <Action.CopyToClipboard title="Copy All as Text" content={allText} shortcut={Keyboard.Shortcut.Common.Copy} />
      {/* eslint-disable-next-line @raycast/prefer-title-case -- domain name */}
      <Action.OpenInBrowser title="Open ip.zet.tw" url="https://ip.zet.tw" icon={Icon.Globe} />
    </ActionPanel>
  );

  const renderRow = (r: Row) => {
    const accessories: List.Item.Accessory[] = [];
    if (r.connected) accessories.push(CONNECTED);
    if (r.primary) accessories.push(PRIMARY);
    if (r.tag) accessories.push({ tag: { value: r.tag, color: TAG_COLORS[r.icon] ?? Color.SecondaryText } });
    if (r.accessory) accessories.push({ text: r.accessory });
    return (
      <List.Item
        key={r.key}
        icon={{ source: ICONS[r.icon], tintColor: TINTS[r.icon] }}
        title={r.title}
        subtitle={r.subtitle}
        accessories={accessories.length > 0 ? accessories : undefined}
        actions={actions(r.copy ?? r.title)}
      />
    );
  };

  const ifaces = local.status === "ok" ? local.ifaces : [];
  const named = ifaces.filter((i) => i.kind !== "other");
  const others = ifaces.filter((i) => i.kind === "other");
  // Two adapters can share a hardware-port name; disambiguate those section titles by device.
  const labelCounts = new Map<string, number>();
  for (const i of named) labelCounts.set(i.label, (labelCounts.get(i.label) ?? 0) + 1);
  const sectionTitle = (i: LocalInterface) =>
    clean((labelCounts.get(i.label) ?? 0) > 1 ? `${i.label} (${i.device})` : i.label);

  const pubRows = publicRows(pub);

  return (
    <List
      navigationTitle="IP Info"
      isLoading={pub.status === "loading" || local.status === "loading"}
      searchBarPlaceholder="Filter…"
    >
      {pubRows.length > 0 && <List.Section title="Public">{pubRows.map(renderRow)}</List.Section>}
      {local.status === "error" && <List.Section title="Local">{renderRow(localErrorRow(local.message))}</List.Section>}
      {named.map((i) => (
        <List.Section key={i.device} title={sectionTitle(i)}>
          {renderRow(interfaceRow(i))}
        </List.Section>
      ))}
      {others.length > 0 && (
        <List.Section title="Other Interfaces">{others.map((i) => renderRow(interfaceRow(i)))}</List.Section>
      )}
    </List>
  );
}
