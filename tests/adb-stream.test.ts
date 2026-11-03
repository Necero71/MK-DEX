import { describe, expect, it } from "vitest";
import { AdbCommand, AdbPacketSerializeStream, type AdbPacketData } from "@yume-chan/adb";
import { Consumable, ReadableStream } from "@yume-chan/stream-extra";
import { AdbPacketParseStream, adbConnectionFromSocket } from "../src/net/adb-stream";

const packets: AdbPacketData[] = [
  { command: AdbCommand.Connect, arg0: 0x01000001, arg1: 1024 * 1024, payload: new TextEncoder().encode("host::features=shell_v2\0") },
  { command: AdbCommand.Okay, arg0: 1, arg1: 2, payload: new Uint8Array(0) },
  { command: AdbCommand.Write, arg0: 3, arg1: 4, payload: Uint8Array.from({ length: 70_000 }, (_, i) => i & 0xff) },
];

async function serialize(list: AdbPacketData[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const ser = new AdbPacketSerializeStream();
  const w = ser.writable.getWriter();
  const done = (async () => {
    const r = ser.readable.getReader();
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      parts.push(value.value.slice());
      value.consume();
    }
  })();
  for (const p of list) {
    const c = new Consumable({ ...p, checksum: 0, magic: p.command ^ 0xffffffff } as never);
    await w.write(c as never);
  }
  await w.close();
  await done;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function chunked(bytes: Uint8Array, sizes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      let i = 0, k = 0;
      while (i < bytes.length) {
        const n = sizes[k++ % sizes.length];
        c.enqueue(bytes.slice(i, i + n));
        i += n;
      }
      c.close();
    },
  });
}

async function collect<T>(s: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const r = s.getReader();
  for (;;) {
    const { value, done } = await r.read();
    if (done) return out;
    out.push(value);
  }
}

describe("ADB over TCP framing", () => {
  for (const sizes of [[1], [7, 3, 24], [24], [65536], [5, 100_000]]) {
    it(`reassembles packets from ${sizes.join("/")}-byte chunks`, async () => {
      const bytes = await serialize(packets);
      const got = await collect(chunked(bytes, sizes).pipeThrough(new AdbPacketParseStream()));
      expect(got).toHaveLength(packets.length);
      got.forEach((p, i) => {
        expect(p.command).toBe(packets[i].command);
        expect(p.arg0).toBe(packets[i].arg0);
        expect(p.arg1).toBe(packets[i].arg1);
        expect(Array.from(p.payload)).toEqual(Array.from(packets[i].payload));
      });
    });
  }

  it("rejects a corrupt header", async () => {
    const bytes = await serialize(packets.slice(1, 2));
    bytes[20] ^= 0xff; // magic
    await expect(collect(chunked(bytes, [24]).pipeThrough(new AdbPacketParseStream()))).rejects.toThrow(/magic/);
  });

  it("writes serialized packets to the socket and reads them back", async () => {
    const written: Uint8Array[] = [];
    const wire = await serialize(packets.slice(0, 2));
    const conn = adbConnectionFromSocket({
      readable: chunked(wire, [13]),
      write: async (d) => { written.push(d.slice()); },
      close: async () => {},
    });
    const w = conn.writable.getWriter();
    await w.write(new Consumable({ ...packets[1], checksum: 0, magic: packets[1].command ^ 0xffffffff } as never) as never);
    expect(written.reduce((n, p) => n + p.length, 0)).toBe(24);
    const got = await collect(conn.readable as unknown as ReadableStream<AdbPacketData>);
    expect(got.map((p) => p.command)).toEqual([AdbCommand.Connect, AdbCommand.Okay]);
  });
});
