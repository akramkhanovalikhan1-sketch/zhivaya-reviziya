/** Hardware scanner (Keyboard Wedge) + broadcast-intent bridge later. */

type Handler = (barcode: string) => void;

let current: Handler | null = null;
let buffer = "";
let lastTs = 0;

export function setScanHandler(handler: Handler | null) {
  current = handler;
}

function flush(code: string) {
  const value = code.trim();
  if (!value || !current) return;
  current(value);
}

function onKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  const isTrap = Boolean(target && target.classList.contains("scan-trap"));
  const typingInField =
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
    !isTrap;

  if (e.key === "Enter") {
    if (isTrap && target instanceof HTMLInputElement) {
      e.preventDefault();
      flush(target.value || buffer);
      target.value = "";
      buffer = "";
      return;
    }
    if (typingInField) {
      buffer = "";
      return;
    }
    if (buffer && Date.now() - lastTs < 80) {
      e.preventDefault();
      flush(buffer);
      buffer = "";
    }
    return;
  }
  if (e.key.length !== 1) return;
  const now = Date.now();
  if (now - lastTs > 80) buffer = "";
  lastTs = now;
  buffer += e.key;
  if (!typingInField && buffer.length > 3) {
    // wedge scanners fire very fast; keep accumulating until Enter
  }
}

window.addEventListener("keydown", onKeyDown);

/**
 * DataWedge / Urovo Intent:
 * android.intent.action.SCANNER_RESULT
 * When wrapped in a WebView later, inject:
 *   window.dispatchEvent(new CustomEvent("tsd-scan", { detail: barcode }))
 */
window.addEventListener("tsd-scan", ((e: CustomEvent<string>) => {
  flush(String(e.detail || ""));
}) as EventListener);

export function simulateScan(code: string) {
  flush(code);
}
