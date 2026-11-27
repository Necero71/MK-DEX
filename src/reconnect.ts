/** Remembering the last phone, and retrying when a live link drops. */

export type LastPhone =
  | { kind: "usb"; serial: string; name?: string }
  | { kind: "wifi"; host: string };

const KEY = "mk-dex:last-phone";

export function parseLastPhone(raw: string | null): LastPhone | undefined {
  try {
    const v = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    if (v?.kind === "usb" && typeof v.serial === "string" && v.serial) {
      return { kind: "usb", serial: v.serial, name: typeof v.name === "string" ? v.name : undefined };
    }
    if (v?.kind === "wifi" && typeof v.host === "string" && v.host) return { kind: "wifi", host: v.host };
  } catch { /* corrupt entry */ }
  return undefined;
}

export function loadLastPhone(): LastPhone | undefined {
  try { return parseLastPhone(localStorage.getItem(KEY)); } catch { return undefined; }
}

export function saveLastPhone(phone: LastPhone) {
  try { localStorage.setItem(KEY, JSON.stringify(phone)); } catch { /* no storage */ }
}

/** Seconds-scale backoff: long enough to cover a cable wiggle or a Wi-Fi hop. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/**
 * Call `attempt` after each delay until it returns true, the delays run out,
 * or `signal` aborts. A thrown error counts as a failed attempt.
 */
export async function retry(
  attempt: () => Promise<boolean>,
  signal: AbortSignal,
  onWait: (n: number, total: number, ms: number) => void = () => {},
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<boolean> {
  for (const [i, ms] of delays.entries()) {
    if (signal.aborted) return false;
    onWait(i + 1, delays.length, ms);
    await sleep(ms, signal);
    if (signal.aborted) return false;
    let stop = () => {};
    const aborted = new Promise<false>((resolve) => {
      stop = () => resolve(false);
      signal.addEventListener("abort", stop);
    });
    try {
      // Cancel returns at once, even if the attempt is stuck waiting on the phone.
      if (await Promise.race([attempt(), aborted])) return true;
    } catch { /* try again */ }
    finally { signal.removeEventListener("abort", stop); }
  }
  return false;
}
