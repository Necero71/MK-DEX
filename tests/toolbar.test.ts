import { describe, expect, it } from "vitest";
import { parseToolbarState, toFraction, toPixels } from "../src/toolbar";

const area = { width: 1000, height: 600 };
const bar = { width: 56, height: 300 };

describe("toolbar position", () => {
  it("round-trips", () => {
    const p = toPixels(toFraction({ x: 400, y: 120 }, area, bar), area, bar);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(120);
  });
  it("stays on screen", () => {
    expect(toPixels(toFraction({ x: 5000, y: -50 }, area, bar), area, bar)).toEqual({ x: 938, y: 6 });
  });
  it("copes with a bar bigger than the area", () => {
    expect(toPixels({ x: 1, y: 1 }, { width: 40, height: 40 }, bar)).toEqual({ x: 6, y: 6 });
  });
  it("ignores corrupt state", () => {
    expect(parseToolbarState("{")).toEqual({ collapsed: false });
    expect(parseToolbarState('{"collapsed":true,"pos":{"x":"a"}}')).toEqual({ collapsed: true, pos: undefined });
  });
});
