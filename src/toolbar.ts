/** Draggable, collapsible HUD. Position is stored as 0..1 fractions so it survives resizes. */

const KEY = "mk-dex:toolbar";
const DRAG_THRESHOLD_PX = 6;
const MARGIN = 6;

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface ToolbarState { pos?: Point; collapsed: boolean }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Pixel top-left → fraction of the free space. */
export function toFraction(px: Point, area: Size, bar: Size): Point {
  const freeX = area.width - bar.width - MARGIN * 2;
  const freeY = area.height - bar.height - MARGIN * 2;
  return {
    x: freeX > 0 ? clamp01((px.x - MARGIN) / freeX) : 0,
    y: freeY > 0 ? clamp01((px.y - MARGIN) / freeY) : 0,
  };
}

/** Fraction of the free space → pixel top-left, always on screen. */
export function toPixels(f: Point, area: Size, bar: Size): Point {
  return {
    x: MARGIN + clamp01(f.x) * Math.max(0, area.width - bar.width - MARGIN * 2),
    y: MARGIN + clamp01(f.y) * Math.max(0, area.height - bar.height - MARGIN * 2),
  };
}

export function parseToolbarState(raw: string | null): ToolbarState {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<ToolbarState> | null;
    const p = v?.pos;
    return {
      collapsed: v?.collapsed === true,
      pos: p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : undefined,
    };
  } catch {
    return { collapsed: false };
  }
}

export function attachToolbar(hud: HTMLElement, grip: HTMLElement, area: HTMLElement) {
  let state: ToolbarState = { collapsed: false };
  try { state = parseToolbarState(localStorage.getItem(KEY)); } catch { /* no storage */ }

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* no storage */ }
  };
  const sizes = () => [
    { width: area.clientWidth, height: area.clientHeight },
    { width: hud.offsetWidth, height: hud.offsetHeight },
  ] as const;

  /** Re-place the bar. Call after it becomes visible. */
  function apply() {
    hud.classList.toggle("collapsed", state.collapsed);
    grip.setAttribute("aria-expanded", String(!state.collapsed));
    if (!state.pos || !area.clientWidth) return; // default CSS position
    const p = toPixels(state.pos, ...sizes());
    Object.assign(hud.style, { left: `${p.x}px`, top: `${p.y}px`, right: "auto", transform: "none" });
  }

  let drag: { id: number; startX: number; startY: number; offX: number; offY: number; moved: boolean } | undefined;
  let swallowClick = false;

  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = hud.getBoundingClientRect();
    swallowClick = false;
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, moved: false };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const a = area.getBoundingClientRect();
    state.pos = toFraction({ x: e.clientX - a.left - drag.offX, y: e.clientY - a.top - drag.offY }, ...sizes());
    apply();
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) {
      swallowClick = true;
      save();
    }
    drag = undefined;
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);

  // A tap (or Enter/Space) toggles; a drag doesn't.
  grip.addEventListener("click", () => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    state.collapsed = !state.collapsed;
    save();
    apply();
  });

  new ResizeObserver(apply).observe(area);
  return { apply };
}
