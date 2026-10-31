import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  ScrcpyPointerId,
  type ScrcpyControlMessageWriter,
} from "@yume-chan/scrcpy";

export interface InputHandle {
  detach(): void;
}

type VideoSize = () => { width: number; height: number };

/**
 * Map a client point to video pixels, accounting for object-fit: contain letterboxing.
 * Exported for tests.
 */
export function toVideoPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  video: { width: number; height: number },
): { x: number; y: number } | undefined {
  const scale = Math.min(rect.width / video.width, rect.height / video.height);
  if (!scale) return undefined;
  const offX = (rect.width - video.width * scale) / 2;
  const offY = (rect.height - video.height * scale) / 2;
  const x = (clientX - rect.left - offX) / scale;
  const y = (clientY - rect.top - offY) / scale;
  return {
    x: Math.min(video.width - 1, Math.max(0, x)),
    y: Math.min(video.height - 1, Math.max(0, y)),
  };
}

/** DOM MouseEvent.button → Android action button. */
export function domButtonToAndroid(button: number): number {
  switch (button) {
    case 0: return AndroidMotionEventButton.Primary;
    case 1: return AndroidMotionEventButton.Tertiary;
    case 2: return AndroidMotionEventButton.Secondary;
    case 3: return AndroidMotionEventButton.Back;
    case 4: return AndroidMotionEventButton.Forward;
    default: return AndroidMotionEventButton.None;
  }
}

/** DOM MouseEvent.buttons bitmask → Android buttons bitmask (middle/right are swapped). */
export function domButtonsToAndroid(buttons: number): number {
  let out = 0;
  if (buttons & 1) out |= AndroidMotionEventButton.Primary;
  if (buttons & 2) out |= AndroidMotionEventButton.Secondary;
  if (buttons & 4) out |= AndroidMotionEventButton.Tertiary;
  if (buttons & 8) out |= AndroidMotionEventButton.Back;
  if (buttons & 16) out |= AndroidMotionEventButton.Forward;
  return out;
}

export function metaState(e: KeyboardEvent): number {
  let m = AndroidKeyEventMeta.None as number;
  if (e.shiftKey) m |= AndroidKeyEventMeta.Shift;
  if (e.ctrlKey) m |= AndroidKeyEventMeta.Ctrl;
  if (e.altKey) m |= AndroidKeyEventMeta.Alt;
  if (e.metaKey) m |= AndroidKeyEventMeta.Meta;
  if (e.getModifierState?.("CapsLock")) m |= AndroidKeyEventMeta.CapsLock;
  if (e.getModifierState?.("NumLock")) m |= AndroidKeyEventMeta.NumLock;
  return m;
}

/** KeyboardEvent.code → Android keycode. Tango names its keycodes after DOM codes. */
export function codeToAndroid(code: string): number | undefined {
  return (AndroidKeyCode as Record<string, number>)[code];
}

export function attachInput(
  canvas: HTMLCanvasElement,
  controller: ScrcpyControlMessageWriter,
  videoSize: VideoSize,
): InputHandle {
  const send = (p: Promise<void>) => p.catch(() => { /* session closing */ });

  const point = (e: { clientX: number; clientY: number }) =>
    toVideoPoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), videoSize());

  const onPointer = (e: PointerEvent) => {
    e.preventDefault();
    const p = point(e);
    if (!p) return;
    const { width, height } = videoSize();
    const isMouse = e.pointerType === "mouse";

    let action: number;
    switch (e.type) {
      case "pointerdown":
        canvas.focus();
        canvas.setPointerCapture(e.pointerId);
        action = AndroidMotionEventAction.Down;
        break;
      case "pointerup":
        action = AndroidMotionEventAction.Up;
        break;
      case "pointercancel":
        action = AndroidMotionEventAction.Cancel;
        break;
      default: // pointermove
        action = isMouse && e.buttons === 0
          ? AndroidMotionEventAction.HoverMove
          : AndroidMotionEventAction.Move;
    }
    // Touch/pen with no contact doesn't move anything on Android.
    if (!isMouse && action === AndroidMotionEventAction.Move && e.buttons === 0) return;

    send(controller.injectTouch({
      action: action as never,
      pointerId: isMouse ? ScrcpyPointerId.Mouse : BigInt(e.pointerId),
      pointerX: p.x,
      pointerY: p.y,
      videoWidth: width,
      videoHeight: height,
      pressure: action === AndroidMotionEventAction.Up ? 0 : (isMouse ? (e.buttons ? 1 : 0) : e.pressure || 1),
      actionButton: isMouse && (e.type === "pointerdown" || e.type === "pointerup") ? domButtonToAndroid(e.button) : 0,
      buttons: isMouse ? domButtonsToAndroid(e.buttons) : 0,
    }));
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = point(e);
    if (!p) return;
    const { width, height } = videoSize();
    const unit = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100; // lines / pages / pixels per notch
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    send(controller.injectScroll({
      pointerX: p.x,
      pointerY: p.y,
      videoWidth: width,
      videoHeight: height,
      scrollX: clamp(-e.deltaX / unit),
      scrollY: clamp(-e.deltaY / unit),
      buttons: domButtonsToAndroid(e.buttons),
    }));
  };

  const onKey = (e: KeyboardEvent) => {
    const keyCode = codeToAndroid(e.code);
    if (keyCode === undefined) return;
    // Let the user escape fullscreen with F11 on desktop browsers.
    if (e.code === "F11") return;
    e.preventDefault();
    send(controller.injectKeyCode({
      action: e.type === "keydown" ? AndroidKeyEventAction.Down : AndroidKeyEventAction.Up,
      keyCode: keyCode as never,
      repeat: e.repeat ? 1 : 0,
      metaState: metaState(e) as never,
    }));
  };

  const block = (e: Event) => e.preventDefault();

  const pointerEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
  pointerEvents.forEach((t) => canvas.addEventListener(t, onPointer));
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("keyup", onKey);
  canvas.addEventListener("contextmenu", block);

  return {
    detach() {
      pointerEvents.forEach((t) => canvas.removeEventListener(t, onPointer));
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("keyup", onKey);
      canvas.removeEventListener("contextmenu", block);
    },
  };
}

/** Android nav keys for the on-screen toolbar (touch-only display devices). */
export async function pressKey(controller: ScrcpyControlMessageWriter, key: "back" | "home" | "recents") {
  const keyCode = {
    back: AndroidKeyCode.AndroidBack,
    home: AndroidKeyCode.AndroidHome,
    recents: AndroidKeyCode.AndroidAppSwitch,
  }[key];
  for (const action of [AndroidKeyEventAction.Down, AndroidKeyEventAction.Up]) {
    await controller.injectKeyCode({ action, keyCode, repeat: 0, metaState: AndroidKeyEventMeta.None });
  }
}
