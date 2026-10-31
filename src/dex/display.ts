export interface DisplaySpec {
  width: number;
  height: number;
  dpi: number;
}

export interface Preset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const PRESETS: Preset[] = [
  { id: "auto", label: "Auto — fit this screen", width: 0, height: 0 },
  { id: "720p", label: "1280×720 (HD, low lag)", width: 1280, height: 720 },
  { id: "1080p", label: "1920×1080 (Full HD)", width: 1920, height: 1080 },
  { id: "1200p", label: "1920×1200 (16:10 tablet)", width: 1920, height: 1200 },
  { id: "1440p", label: "2560×1440 (QHD)", width: 2560, height: 1440 },
  { id: "1600p", label: "2560×1600 (16:10 QHD)", width: 2560, height: 1600 },
  { id: "uw", label: "3440×1440 (Ultrawide)", width: 3440, height: 1440 },
];

/** UI scale → DPI. DeX reads like a normal desktop around 200dpi at 1080p. */
export const SCALES = [
  { id: "compact", label: "Compact", factor: 0.8 },
  { id: "normal", label: "Normal", factor: 1 },
  { id: "large", label: "Large", factor: 1.3 },
] as const;

export type ScaleId = (typeof SCALES)[number]["id"];

/** Video encoders want even dimensions; multiples of 8 are safest across Samsung SoCs. */
export function align8(n: number): number {
  return Math.max(8, Math.round(n / 8) * 8);
}

/**
 * Work out the virtual display size for this screen.
 * Physical pixels, landscape, capped so phone encoders keep up.
 */
export function autoSize(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  maxLongEdge = 2560,
): { width: number; height: number } {
  let w = cssWidth * pixelRatio;
  let h = cssHeight * pixelRatio;
  if (h > w) [w, h] = [h, w]; // DeX is a landscape desktop
  const scale = Math.min(1, maxLongEdge / w);
  return { width: align8(w * scale), height: align8(h * scale) };
}

/** Baseline: 200dpi at 1080 lines tall (≈1536×864dp workspace), scaled with the display height. */
export function dpiFor(height: number, scale: ScaleId): number {
  const factor = SCALES.find((s) => s.id === scale)?.factor ?? 1;
  return Math.round(200 * (height / 1080) * factor);
}

export function resolveDisplay(
  presetId: string,
  scale: ScaleId,
  screen: { cssWidth: number; cssHeight: number; pixelRatio: number },
): DisplaySpec {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const size =
    preset.id === "auto"
      ? autoSize(screen.cssWidth, screen.cssHeight, screen.pixelRatio)
      : { width: preset.width, height: preset.height };
  return { ...size, dpi: dpiFor(size.height, scale) };
}
