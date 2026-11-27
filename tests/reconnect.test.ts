import { describe, expect, it, vi } from "vitest";
import { parseLastPhone, retry } from "../src/reconnect";

describe("parseLastPhone", () => {
  it("accepts USB and Wi-Fi entries", () => {
    expect(parseLastPhone('{"kind":"usb","serial":"R5","name":"S25"}')).toEqual({ kind: "usb", serial: "R5", name: "S25" });
    expect(parseLastPhone('{"kind":"wifi","host":"192.168.0.12"}')).toEqual({ kind: "wifi", host: "192.168.0.12" });
  });
  it("rejects junk", () => {
    for (const raw of [null, "", "{", "null", '{"kind":"usb"}', '{"kind":"wifi","host":""}']) {
      expect(parseLastPhone(raw)).toBeUndefined();
    }
  });
});

describe("retry", () => {
  it("stops at the first success and treats errors as failures", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new Error("nope")).mockResolvedValueOnce(true);
    await expect(retry(attempt, new AbortController().signal, undefined, [0, 0, 0])).resolves.toBe(true);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it("gives up when the delays run out", async () => {
    const attempt = vi.fn().mockResolvedValue(false);
    await expect(retry(attempt, new AbortController().signal, undefined, [0, 0])).resolves.toBe(false);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it("cancels while an attempt is stuck", async () => {
    const ac = new AbortController();
    const done = retry(() => new Promise<boolean>(() => {}), ac.signal, undefined, [0]);
    setTimeout(() => ac.abort(), 10);
    await expect(done).resolves.toBe(false);
  });
  it("cancels during a wait", async () => {
    const ac = new AbortController();
    const attempt = vi.fn();
    const done = retry(attempt, ac.signal, undefined, [60_000]);
    ac.abort();
    await expect(done).resolves.toBe(false);
    expect(attempt).not.toHaveBeenCalled();
  });
});
