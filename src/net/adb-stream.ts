/**
 * ADB over a plain byte stream (TCP). USB delivers each packet header and
 * payload as separate transfers; TCP is just bytes, so we re-frame here.
 */
import {
  AdbPacketHeader,
  AdbPacketSerializeStream,
  toLocalUint8Array,
  type AdbDaemonConnection,
  type AdbPacketData,
} from "@yume-chan/adb";
import {
  DuplexStreamFactory,
  MaybeConsumable,
  TransformStream,
  pipeFrom,
  type ReadableStream,
} from "@yume-chan/stream-extra";
import { EmptyUint8Array, Uint8ArrayExactReadable } from "@yume-chan/struct";

export const ADB_HEADER_SIZE = 24;

export interface ByteSocket {
  readonly readable: ReadableStream<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** Bytes in → whole ADB packets out, regardless of how TCP chunks them. */
export class AdbPacketParseStream extends TransformStream<Uint8Array, AdbPacketData> {
  constructor() {
    let buf: Uint8Array = EmptyUint8Array;
    let header: (AdbPacketHeader & { payloadLength: number }) | undefined;

    super({
      transform(chunk, controller) {
        buf = buf.length ? concat(buf, chunk) : chunk;
        for (;;) {
          if (!header) {
            if (buf.length < ADB_HEADER_SIZE) return;
            const h = AdbPacketHeader.deserialize(
              new Uint8ArrayExactReadable(buf.subarray(0, ADB_HEADER_SIZE)),
            );
            if (h.magic !== (h.command ^ 0xffffffff)) {
              throw new Error("Corrupt ADB stream from phone (bad packet magic).");
            }
            header = h;
            buf = buf.subarray(ADB_HEADER_SIZE);
          }
          if (buf.length < header.payloadLength) return;
          const payload = header.payloadLength ? buf.slice(0, header.payloadLength) : EmptyUint8Array;
          buf = buf.subarray(header.payloadLength);
          controller.enqueue({ command: header.command, arg0: header.arg0, arg1: header.arg1, payload });
          header = undefined;
        }
      },
    });
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Wrap a raw socket into the packet pair Tango's AdbDaemonTransport expects. */
export function adbConnectionFromSocket(socket: ByteSocket): AdbDaemonConnection {
  let closed = false;
  const duplex = new DuplexStreamFactory<AdbPacketData, MaybeConsumable<Uint8Array>>({
    close: async () => {
      closed = true;
      await socket.close().catch(() => {});
    },
    dispose: () => {
      closed = true;
    },
  });

  const readable = duplex.wrapReadable(socket.readable.pipeThrough(new AdbPacketParseStream()));
  const writable = pipeFrom(
    duplex.createWritable(
      new MaybeConsumable.WritableStream<Uint8Array>({
        write: async (chunk) => {
          try {
            await socket.write(toLocalUint8Array(chunk));
          } catch (e) {
            if (!closed) throw e;
          }
        },
      }),
    ),
    new AdbPacketSerializeStream(),
  );

  return { readable, writable } as unknown as AdbDaemonConnection;
}
