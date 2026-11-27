import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from "@yume-chan/adb-scrcpy";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import { DefaultServerPath, ScrcpyNewDisplay } from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import { ReadableStream, WritableStream } from "@yume-chan/stream-extra";
import { attachInput, type InputHandle } from "./input";
import type { DisplaySpec } from "./display";
import { credentialStore } from "./credentials";
import type { PhoneLink } from "../link/types";

export interface SessionOptions {
  display: DisplaySpec;
  /** Video bitrate in bits/s. */
  bitRate: number;
  maxFps: number;
  codec: "h264" | "h265";
  log: (line: string) => void;
}

/**
 * One live DeX session: ADB over USB or Wi-Fi → scrcpy server with a virtual display
 * → WebCodecs decode into a canvas, with mouse/touch/keyboard sent back.
 */
export class DexSession {
  #adb?: Adb;
  #client?: AdbScrcpyClient<AdbScrcpyOptions3_3_3<true>>;
  #decoder?: WebCodecsVideoDecoder;
  #input?: InputHandle;
  #closed = false;

  readonly closed: Promise<void>;
  #resolveClosed!: () => void;

  constructor(
    private readonly device: PhoneLink,
    private readonly opts: SessionOptions,
  ) {
    this.closed = new Promise((r) => (this.#resolveClosed = r));
  }

  get deviceName(): string {
    return this.device.name || this.device.serial;
  }

  get controller() {
    return this.#client?.controller;
  }

  async start(host: HTMLElement): Promise<HTMLCanvasElement> {
    const { log } = this.opts;

    const wifi = this.device.kind === "wifi";
    log(`Opening ${wifi ? "Wi-Fi" : "USB"} link to ${this.deviceName}…`);
    const connection = await this.device.connect();

    log(wifi
      ? "Authenticating — if the phone asks, allow debugging from this device."
      : "Authenticating — accept the “Allow USB debugging” prompt on the phone.");
    const transport = await AdbDaemonTransport.authenticate({
      serial: this.device.serial,
      connection,
      credentialStore,
    });
    this.#adb = new Adb(transport);
    void transport.disconnected.then(() => {
      log("Phone disconnected.");
      void this.stop();
    });

    const model = (await this.#adb.getProp("ro.product.model")).trim();
    const sdk = Number((await this.#adb.getProp("ro.build.version.sdk")).trim());
    const oneUi = (await this.#adb.getProp("ro.build.version.oneui")).trim();
    log(`Connected: ${model} · Android API ${sdk}${oneUi ? ` · One UI ${formatOneUi(oneUi)}` : ""}`);
    if (sdk < 36) {
      log("⚠ DeX on a virtual display needs One UI 8 / Android 16+. You'll get a plain Android desktop or blank screen on older firmware.");
    }

    log(`Pushing scrcpy server v${VERSION}…`);
    const server = new Uint8Array((await (await fetch(BIN)).arrayBuffer()) as ArrayBuffer);
    await AdbScrcpyClient.pushServer(
      this.#adb,
      new ReadableStream({
        start(controller) {
          controller.enqueue(server);
          controller.close();
        },
      }),
    );

    const { width, height, dpi } = this.opts.display;
    log(`Creating virtual display ${width}×${height} @ ${dpi}dpi…`);
    const options = new AdbScrcpyOptions3_3_3(
      {
        newDisplay: new ScrcpyNewDisplay(width, height, dpi),
        videoCodec: this.opts.codec,
        videoBitRate: this.opts.bitRate,
        maxFps: this.opts.maxFps,
        audio: false,
        control: true,
        stayAwake: true,
        clipboardAutosync: true,
      },
      { version: VERSION },
    );

    this.#client = await AdbScrcpyClient.start(this.#adb, DefaultServerPath, options);
    void this.#client.output
      .pipeTo(new WritableStream<string>({ write: (line) => log(`[scrcpy] ${line}`) }))
      .catch(() => {});
    void this.#client.exited.then(() => {
      log("scrcpy server exited.");
      void this.stop();
    });

    const video = await this.#client.videoStream;
    if (!WebCodecsVideoDecoder.isSupported) {
      throw new Error("This browser/WebView has no WebCodecs video decoder. Use Chrome 94+ or update Android System WebView.");
    }
    const renderer = WebGLVideoFrameRenderer.isSupported
      ? new WebGLVideoFrameRenderer()
      : new BitmapVideoFrameRenderer();
    this.#decoder = new WebCodecsVideoDecoder({
      codec: video.metadata.codec,
      renderer,
      hardwareAcceleration: "prefer-hardware",
    });

    const canvas = renderer.canvas as HTMLCanvasElement;
    canvas.className = "dex-canvas";
    canvas.tabIndex = 0;
    if (this.#closed) {
      await this.#release();
      throw new Error("Connection cancelled.");
    }
    host.replaceChildren(canvas);

    void video.stream.pipeTo(this.#decoder.writable).catch((e) => {
      if (!this.#closed) log(`Video stream ended: ${String(e)}`);
    });

    const controller = this.#client.controller!;
    this.#input = attachInput(canvas, controller, () => ({
      width: this.#decoder?.width || width,
      height: this.#decoder?.height || height,
    }));
    canvas.focus();

    // Disconnected while we were still setting up: release what was created since.
    if (this.#closed) {
      await this.#release();
      throw new Error("Connection cancelled.");
    }

    log("DeX is live. Mouse, touch and keyboard are forwarded to the phone.");
    return canvas;
  }

  /** Send Android text (used by the on-screen keyboard field on touch-only screens). */
  async typeText(text: string) {
    await this.#client?.controller?.injectText(text);
  }

  async stop() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#release();
    this.#resolveClosed();
  }

  async #release() {
    this.#input?.detach();
    try { await this.#client?.close(); } catch { /* already gone */ }
    this.#decoder?.dispose();
    try { await this.#adb?.close(); } catch { /* already gone */ }
  }
}

/** ro.build.version.oneui is e.g. "80000" → "8.0". */
export function formatOneUi(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10000) return raw;
  const major = Math.floor(n / 10000);
  const minor = Math.floor((n % 10000) / 100);
  return `${major}.${minor}`;
}
