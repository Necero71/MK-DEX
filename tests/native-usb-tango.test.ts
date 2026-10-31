import { describe, expect, it, vi } from "vitest";

// Fake MkUsb plugin: one Galaxy exposing MTP + ADB interfaces.
const calls: string[] = [];
const fakeDevice = {
  deviceId: 1002,
  vendorId: 0x04e8,
  productId: 0x6860,
  productName: "SAMSUNG_Android",
  manufacturerName: "SAMSUNG",
  serialNumber: "R5CX123ABC",
  hasPermission: true,
  configurations: [{
    configurationValue: 1,
    interfaces: [
      { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 6, interfaceSubclass: 1, interfaceProtocol: 1, endpoints: [] }] },
      { interfaceNumber: 1, alternates: [{ alternateSetting: 0, interfaceClass: 255, interfaceSubclass: 66, interfaceProtocol: 1, endpoints: [
        { endpointNumber: 1, direction: "in", packetSize: 512, type: "bulk" },
        { endpointNumber: 2, direction: "out", packetSize: 512, type: "bulk" },
      ] }] },
    ],
  }],
};

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    list: async () => ({ devices: [fakeDevice] }),
    requestPermission: async () => ({ granted: true }),
    open: async () => { calls.push("open"); },
    close: async () => { calls.push("close"); },
    claimInterface: async ({ interfaceNumber }: { interfaceNumber: number }) => { calls.push(`claim:${interfaceNumber}`); },
    releaseInterface: async () => {},
    transferIn: async () => new Promise(() => {}), // never resolves; we only test setup
    transferOut: async ({ data }: { data: string }) => ({ bytesWritten: atob(data).length }),
    addListener: async () => ({ remove: async () => {} }),
  }),
}));

const { NativeUsb } = await import("../src/usb/native-usb");
const { AdbDaemonWebUsbDeviceManager } = await import("@yume-chan/adb-daemon-webusb");

describe("NativeUsb as a WebUSB backend for Tango", () => {
  it("is discovered and opened by AdbDaemonWebUsbDeviceManager", async () => {
    const usb = new NativeUsb();
    expect(await usb.requestAdbDevice()).toMatchObject({ deviceId: 1002 });

    const manager = new AdbDaemonWebUsbDeviceManager(usb as unknown as USB);
    const [device] = await manager.getDevices();
    expect(device.serial).toBe("R5CX123ABC");
    expect(device.name).toBe("SAMSUNG_Android");

    const conn = await device.connect();
    expect(calls).toEqual(["open", "claim:1"]);
    expect(conn.inEndpoint.endpointNumber).toBe(1);
    expect(conn.outEndpoint.endpointNumber).toBe(2);
  });
});
