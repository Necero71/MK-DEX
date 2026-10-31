import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({}) }));

const { b64ToBytes, bytesToB64, isAdbAlternate } = await import("../src/usb/native-usb");

describe("native usb shim helpers", () => {
  it("round-trips binary through base64, incl. large buffers", () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) & 0xff);
    expect(b64ToBytes(bytesToB64(big))).toEqual(big);
    expect(bytesToB64(new Uint8Array())).toBe("");
  });

  it("recognises the ADB interface triple", () => {
    expect(isAdbAlternate({ interfaceClass: 255, interfaceSubclass: 66, interfaceProtocol: 1 })).toBe(true);
    expect(isAdbAlternate({ interfaceClass: 255, interfaceSubclass: 66, interfaceProtocol: 3 })).toBe(false);
  });
});
