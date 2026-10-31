import { describe, expect, it } from "vitest";
import { align8, autoSize, dpiFor, resolveDisplay } from "../src/dex/display";

describe("display sizing", () => {
  it("aligns to multiples of 8", () => {
    expect(align8(1080)).toBe(1080);
    expect(align8(1083)).toBe(1080);
    expect(align8(1086)).toBe(1088);
  });

  it("forces landscape and uses physical pixels", () => {
    // Portrait phone-sized CSS viewport at 2x
    expect(autoSize(400, 800, 2)).toEqual({ width: 1600, height: 800 });
  });

  it("caps the long edge so phone encoders keep up", () => {
    const s = autoSize(1440, 900, 3); // 4320x2700 physical
    expect(s.width).toBe(2560);
    expect(s.height).toBe(align8(2700 * (2560 / 4320)));
  });

  it("scales dpi with height and UI scale", () => {
    expect(dpiFor(1080, "normal")).toBe(200);
    expect(dpiFor(1440, "normal")).toBe(267);
    expect(dpiFor(1080, "large")).toBe(260);
    expect(dpiFor(1080, "compact")).toBe(160);
  });

  it("resolves presets", () => {
    const screen = { cssWidth: 1280, cssHeight: 800, pixelRatio: 2 };
    expect(resolveDisplay("1080p", "normal", screen)).toEqual({ width: 1920, height: 1080, dpi: 200 });
    expect(resolveDisplay("auto", "normal", screen)).toEqual({ width: 2560, height: 1600, dpi: 296 });
    expect(resolveDisplay("nope", "normal", screen).width).toBe(2560); // falls back to auto
  });
});
