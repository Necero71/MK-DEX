import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import { credentialStore } from "../dex/credentials";
import type { PhoneLink } from "../link/types";

export const ADB_WIFI_PORT = 5555;

export interface IfaceAddr { iface: string; ip: string }

/** Parse `ip -o -4 addr show` output. */
export function parseIpv4(text: string): IfaceAddr[] {
  const out: IfaceAddr[] = [];
  for (const line of text.split("\n")) {
    const m = /^\d+:\s+(\S+?)(?:@\S+)?\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})\//.exec(line.trim());
    if (m) out.push({ iface: m[1], ip: m[2] });
  }
  return out;
}

/**
 * Pick the address the display device can reach: Wi-Fi client first, then the
 * phone's own hotspot (so a tablet on the phone's hotspot works with no router).
 * Mobile data, VPN and loopback are skipped.
 */
export function pickPhoneIp(addrs: IfaceAddr[]): string | undefined {
  const rank = (iface: string) =>
    /^wlan\d/.test(iface) ? 0
    : /^(swlan|ap|softap|wigig)\d/.test(iface) ? 1
    : /^(eth|usb|rndis)\d/.test(iface) ? 2
    : -1;
  return addrs
    .filter((a) => rank(a.iface) >= 0 && !a.ip.startsWith("127."))
    .sort((a, b) => rank(a.iface) - rank(b.iface))[0]?.ip;
}

/** "192.168.0.12", "192.168.0.12:5555" → {host, port}. */
export function parseHostPort(input: string): { host: string; port: number } | undefined {
  const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9.-]+)(?::(\d{1,5}))?\s*$/i.exec(input);
  if (!m) return undefined;
  const port = m[2] ? Number(m[2]) : ADB_WIFI_PORT;
  if (port < 1 || port > 65535) return undefined;
  return { host: m[1], port };
}

/**
 * Over a USB link: find the phone's Wi-Fi IP and switch adbd to TCP 5555.
 * Lasts until the phone reboots (or USB debugging is toggled).
 */
export async function enableWifi(link: PhoneLink, log: (l: string) => void): Promise<string> {
  log(`Opening ${link.kind.toUpperCase()} link to ${link.name || link.serial}…`);
  const transport = await AdbDaemonTransport.authenticate({
    serial: link.serial,
    connection: await link.connect(),
    credentialStore,
  });
  const adb = new Adb(transport);
  try {
    const text = await adb.subprocess.noneProtocol.spawnWaitText(["ip", "-o", "-4", "addr", "show"]);
    const ip = pickPhoneIp(parseIpv4(text));
    if (!ip) {
      throw new Error("Phone has no Wi-Fi address. Join the same Wi-Fi as this device (or turn on the phone's hotspot and join it).");
    }
    log(`Phone Wi-Fi IP: ${ip}`);
    const res = await adb.tcpip.setPort(ADB_WIFI_PORT);
    log(res.trim() || `adbd listening on ${ADB_WIFI_PORT}`);
    return ip;
  } finally {
    // adbd restarts into TCP mode and drops the USB link anyway.
    await adb.close().catch(() => {});
  }
}
