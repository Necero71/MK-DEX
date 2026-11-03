/** TCP sockets for the APK via the MkTcp Capacitor plugin (WebViews have no raw sockets). */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { ReadableStream, type ReadableStreamDefaultController } from "@yume-chan/stream-extra";
import type { AdbDaemonConnection } from "@yume-chan/adb";
import { b64ToBytes, bytesToB64 } from "../usb/native-usb";
import type { PhoneLink } from "../link/types";
import { adbConnectionFromSocket, type ByteSocket } from "./adb-stream";

export interface MkTcpPlugin {
  connect(o: { host: string; port: number; timeoutMs?: number }): Promise<{ id: number }>;
  startReading(o: { id: number }): Promise<void>;
  write(o: { id: number; data: string }): Promise<void>;
  close(o: { id: number }): Promise<void>;
  addListener(event: "data", cb: (e: { id: number; data: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "closed", cb: (e: { id: number; error?: string }) => void): Promise<PluginListenerHandle>;
}

export const MkTcp = registerPlugin<MkTcpPlugin>("MkTcp");

const sinks = new Map<number, ReadableStreamDefaultController<Uint8Array>>();
let listening: Promise<unknown> | undefined;

function listen() {
  listening ??= Promise.all([
    MkTcp.addListener("data", ({ id, data }) => sinks.get(id)?.enqueue(b64ToBytes(data))),
    MkTcp.addListener("closed", ({ id, error }) => {
      const c = sinks.get(id);
      sinks.delete(id);
      if (!c) return;
      try {
        if (error) c.error(new Error(error));
        else c.close();
      } catch { /* already closed */ }
    }),
  ]);
  return listening;
}

export async function openNativeSocket(host: string, port: number, timeoutMs = 5000): Promise<ByteSocket> {
  await listen();
  const { id } = await MkTcp.connect({ host, port, timeoutMs });
  const readable = new ReadableStream<Uint8Array>({
    start: (controller) => { sinks.set(id, controller); },
    cancel: () => { sinks.delete(id); void MkTcp.close({ id }).catch(() => {}); },
  });
  await MkTcp.startReading({ id });
  return {
    readable,
    write: (data) => MkTcp.write({ id, data: bytesToB64(data) }),
    close: async () => { sinks.delete(id); await MkTcp.close({ id }); },
  };
}

export class TcpPhone implements PhoneLink {
  readonly kind = "wifi" as const;
  constructor(readonly host: string, readonly port = 5555) {}
  get serial() { return `${this.host}:${this.port}`; }
  get name() { return this.serial; }
  async connect(): Promise<AdbDaemonConnection> {
    return adbConnectionFromSocket(await openNativeSocket(this.host, this.port));
  }
}
