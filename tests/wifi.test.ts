import { describe, expect, it } from "vitest";
import { parseHostPort, parseIpv4, pickPhoneIp } from "../src/net/wifi";

const IP_OUT = `1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever
14: rmnet_data0    inet 10.144.22.7/30 scope global rmnet_data0\\       valid_lft forever preferred_lft forever
31: wlan0    inet 192.168.0.12/24 brd 192.168.0.255 scope global wlan0\\       valid_lft forever preferred_lft forever
40: tun0    inet 10.8.0.2/24 scope global tun0\\       valid_lft forever preferred_lft forever
`;

describe("Wi-Fi helpers", () => {
  it("parses ip -o -4 addr output", () => {
    expect(parseIpv4(IP_OUT)).toEqual([
      { iface: "lo", ip: "127.0.0.1" },
      { iface: "rmnet_data0", ip: "10.144.22.7" },
      { iface: "wlan0", ip: "192.168.0.12" },
      { iface: "tun0", ip: "10.8.0.2" },
    ]);
  });

  it("picks Wi-Fi over mobile data / VPN", () => {
    expect(pickPhoneIp(parseIpv4(IP_OUT))).toBe("192.168.0.12");
  });

  it("falls back to the phone's hotspot", () => {
    expect(pickPhoneIp([
      { iface: "rmnet_data0", ip: "10.1.1.1" },
      { iface: "swlan0", ip: "192.168.43.1" },
    ])).toBe("192.168.43.1");
  });

  it("returns undefined with no LAN interface", () => {
    expect(pickPhoneIp([{ iface: "rmnet_data0", ip: "10.1.1.1" }])).toBeUndefined();
  });

  it("parses host[:port]", () => {
    expect(parseHostPort("192.168.0.12")).toEqual({ host: "192.168.0.12", port: 5555 });
    expect(parseHostPort(" 192.168.0.12:37011 ")).toEqual({ host: "192.168.0.12", port: 37011 });
    expect(parseHostPort("galaxy.lan")).toEqual({ host: "galaxy.lan", port: 5555 });
    expect(parseHostPort("192.168.0.12:99999")).toBeUndefined();
    expect(parseHostPort("not an ip!")).toBeUndefined();
  });
});
