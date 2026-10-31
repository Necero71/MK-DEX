import { describe, expect, it } from "vitest";
import { AndroidKeyCode, AndroidMotionEventButton } from "@yume-chan/scrcpy";
import { codeToAndroid, domButtonToAndroid, domButtonsToAndroid, toVideoPoint } from "../src/dex/input";

describe("pointer mapping", () => {
  const video = { width: 1920, height: 1080 };

  it("maps corners with no letterbox", () => {
    const rect = { left: 0, top: 0, width: 960, height: 540 };
    expect(toVideoPoint(0, 0, rect, video)).toEqual({ x: 0, y: 0 });
    expect(toVideoPoint(480, 270, rect, video)).toEqual({ x: 960, y: 540 });
  });

  it("accounts for letterbox bars on a 4:3 screen", () => {
    // 1024x768 viewport → video scaled to 1024x576, bars of 96px top/bottom
    const rect = { left: 0, top: 0, width: 1024, height: 768 };
    const p = toVideoPoint(512, 96, rect, video)!;
    expect(p.x).toBeCloseTo(960);
    expect(p.y).toBeCloseTo(0);
  });

  it("clamps clicks in the bars to the edge", () => {
    const rect = { left: 0, top: 0, width: 1024, height: 768 };
    expect(toVideoPoint(512, 5, rect, video)!.y).toBe(0);
    expect(toVideoPoint(512, 760, rect, video)!.y).toBe(1079);
  });

  it("maps DOM buttons to Android (middle/right differ)", () => {
    expect(domButtonToAndroid(0)).toBe(AndroidMotionEventButton.Primary);
    expect(domButtonToAndroid(1)).toBe(AndroidMotionEventButton.Tertiary);
    expect(domButtonToAndroid(2)).toBe(AndroidMotionEventButton.Secondary);
    expect(domButtonsToAndroid(1 | 2 | 4)).toBe(
      AndroidMotionEventButton.Primary | AndroidMotionEventButton.Secondary | AndroidMotionEventButton.Tertiary,
    );
  });

  it("maps KeyboardEvent.code to Android keycodes", () => {
    expect(codeToAndroid("KeyA")).toBe(AndroidKeyCode.KeyA);
    expect(codeToAndroid("Enter")).toBe(AndroidKeyCode.Enter);
    expect(codeToAndroid("NotAKey")).toBeUndefined();
  });
});
