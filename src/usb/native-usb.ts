/**
 * A WebUSB-compatible façade over the MkUsb Capacitor plugin.
 *
 * Android's WebView has no `navigator.usb`, so inside the APK we hand Tango
 * this object instead. It only implements the slice of WebUSB that
 * @yume-chan/adb-daemon-webusb actually calls.
 */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface NativeEndpoint { endpointNumber: number; direction: "in" | "out"; packetSize: number; type: string }
interface NativeAlternate {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  endpoints: NativeEndpoint[];
}
interface NativeInterface { interfaceNumber: number; alternates: NativeAlternate[] }
interface NativeConfiguration { configurationValue: number; interfaces: NativeInterface[] }
export interface NativeDeviceInfo {
  deviceId: number;
  vendorId: number;
  productId: number;
  productName: string | null;
  manufacturerName: string | null;
  serialNumber: string | null;
  hasPermission: boolean;
  configurations: NativeConfiguration[];
}

export interface MkUsbPlugin {
  list(): Promise<{ devices: NativeDeviceInfo[] }>;
  requestPermission(o: { deviceId: number }): Promise<{ granted: boolean }>;
  open(o: { deviceId: number }): Promise<void>;
  close(o: { deviceId: number }): Promise<void>;
  claimInterface(o: { deviceId: number; interfaceNumber: number }): Promise<void>;
  releaseInterface(o: { deviceId: number; interfaceNumber: number }): Promise<void>;
  transferIn(o: { deviceId: number; endpointNumber: number; length: number }): Promise<{ data: string }>;
  transferOut(o: { deviceId: number; endpointNumber: number; data: string }): Promise<{ bytesWritten: number }>;
  addListener(
    event: "attached" | "detached",
    cb: (e: { deviceId: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export const MkUsb = registerPlugin<MkUsbPlugin>("MkUsb");

// ---- base64 helpers (Capacitor bridge is JSON) ----
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function toBytes(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data as ArrayBuffer);
}

class NativeUsbDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly manufacturerName?: string;
  readonly serialNumber?: string;
  readonly configurations: USBConfiguration[];
  configuration: USBConfiguration | null;
  opened = false;

  constructor(readonly deviceId: number, info: NativeDeviceInfo) {
    this.vendorId = info.vendorId;
    this.productId = info.productId;
    this.productName = info.productName ?? undefined;
    this.manufacturerName = info.manufacturerName ?? undefined;
    this.serialNumber = info.serialNumber ?? undefined;
    this.configurations = info.configurations.map((c) => ({
      configurationValue: c.configurationValue,
      configurationName: undefined,
      interfaces: c.interfaces.map((i) => {
        const alternates = i.alternates.map((a) => ({
          ...a,
          interfaceName: undefined,
          endpoints: a.endpoints.map((e) => ({ ...e })),
        }));
        return {
          interfaceNumber: i.interfaceNumber,
          alternate: alternates[0],
          alternates,
          claimed: false,
        };
      }),
    })) as unknown as USBConfiguration[];
    this.configuration = this.configurations[0] ?? null;
  }

  async open() {
    await MkUsb.open({ deviceId: this.deviceId });
    this.opened = true;
  }

  async close() {
    this.opened = false;
    await MkUsb.close({ deviceId: this.deviceId });
  }

  async selectConfiguration(value: number) {
    // Android exposes ADB on the default configuration; switching isn't needed.
    const c = this.configurations.find((x) => x.configurationValue === value);
    if (!c) throw new DOMException("No such configuration", "NotFoundError");
    this.configuration = c;
  }

  async claimInterface(interfaceNumber: number) {
    await MkUsb.claimInterface({ deviceId: this.deviceId, interfaceNumber });
    const iface = this.configuration?.interfaces.find((i) => i.interfaceNumber === interfaceNumber);
    if (iface) (iface as { claimed: boolean }).claimed = true;
  }

  async releaseInterface(interfaceNumber: number) {
    await MkUsb.releaseInterface({ deviceId: this.deviceId, interfaceNumber });
  }

  async selectAlternateInterface() { /* ADB has a single alternate */ }

  async transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult> {
    const { data } = await MkUsb.transferIn({ deviceId: this.deviceId, endpointNumber, length });
    const bytes = b64ToBytes(data);
    return { data: new DataView(bytes.buffer), status: "ok" } as USBInTransferResult;
  }

  async transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult> {
    const { bytesWritten } = await MkUsb.transferOut({
      deviceId: this.deviceId,
      endpointNumber,
      data: bytesToB64(toBytes(data)),
    });
    return { bytesWritten, status: "ok" } as USBOutTransferResult;
  }
}

/** Minimal `USB` implementation backed by Android's UsbManager. */
export class NativeUsb extends EventTarget {
  #devices = new Map<number, NativeUsbDevice>();

  constructor() {
    super();
    void MkUsb.addListener("detached", ({ deviceId }) => {
      const device = this.#devices.get(deviceId);
      if (!device) return;
      this.#devices.delete(deviceId);
      const ev = new Event("disconnect") as Event & { device: NativeUsbDevice };
      ev.device = device;
      this.dispatchEvent(ev);
    });
    void MkUsb.addListener("attached", () => this.dispatchEvent(new Event("devicelistchange")));
  }

  /** Devices we already hold permission for. */
  async getDevices(): Promise<USBDevice[]> {
    const { devices } = await MkUsb.list();
    return devices.filter((d) => d.hasPermission).map((d) => this.#wrap(d)) as unknown as USBDevice[];
  }

  /**
   * Native stand-in for the WebUSB chooser: pick the first ADB-capable
   * device and ask Android for permission.
   */
  async requestAdbDevice(): Promise<NativeDeviceInfo | undefined> {
    const { devices } = await MkUsb.list();
    const adb = devices.find((d) =>
      d.configurations.some((c) => c.interfaces.some((i) => i.alternates.some(isAdbAlternate))),
    );
    if (!adb) return undefined;
    if (!adb.hasPermission) {
      const { granted } = await MkUsb.requestPermission({ deviceId: adb.deviceId });
      if (!granted) throw new Error("USB permission denied.");
    }
    return adb;
  }

  #wrap(info: NativeDeviceInfo): NativeUsbDevice {
    let d = this.#devices.get(info.deviceId);
    if (!d) {
      d = new NativeUsbDevice(info.deviceId, info);
      this.#devices.set(info.deviceId, d);
    }
    return d;
  }
}

export function isAdbAlternate(a: { interfaceClass: number; interfaceSubclass: number; interfaceProtocol: number }) {
  return a.interfaceClass === 0xff && a.interfaceSubclass === 0x42 && a.interfaceProtocol === 1;
}
