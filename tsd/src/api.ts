export type AuthOk = { ok: true; userId: string; userName: string };
export type AuthFail = { ok: false; error?: string; message?: string };

export type StartZoneOk = {
  ok: true;
  zoneId: string;
  zoneName: string;
  sessionNum: number;
  startTime: string;
  recheck: boolean;
  needsConfirm?: boolean;
  previousUserName?: string;
  freezeSku?: string;
  freezeUntil?: string;
  message?: string;
};
export type StartZoneFail = { ok: false; error?: string; message?: string };

export type ScanLine = {
  sku: string;
  name: string;
  qty: number;
  lastBarcode?: string;
};

export type FinishZoneOk = {
  ok: true;
  zoneId?: string;
  zoneName?: string;
  sessionNum?: number;
  lines?: ScanLine[];
  closedZones?: number;
  totalZones?: number;
  coveragePercent?: number;
  message?: string;
};

export type ScanOk = {
  ok: true;
  alarm: boolean;
  name: string;
  sku: string;
  qty: number;
  warning?: string | null;
  message?: string | null;
  lines?: ScanLine[];
};
export type ScanFail = {
  ok: false;
  alarm: boolean;
  error?: string;
  message?: string;
};

/** Пусто = тот же origin (прокси Vite на :5173 или mock на /tsd/). */
export function normalizeBaseUrl(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return "";
  if (/192\.168\.x\.x/i.test(s) || /example\.com/i.test(s)) return "";
  s = s.replace(/\/+$/, "");
  s = s.replace(/\/tsd$/i, "");
  s = s.replace(/\/hs\/tsd$/i, "");
  s = s.replace(/\/+$/, "");
  return s;
}

export function connectionHint(raw: string): string {
  if (/\/tsd/i.test(raw) || /192\.168\.x\.x/i.test(raw)) {
    return "Неверный адрес сервера. Очистите поле «Сервер 1С / mock» (на :5173 оно должно быть пустым) и войдите снова.";
  }
  return "Нет связи с сервером 1С. На localhost:5173 оставьте поле сервера пустым.";
}

function join(base: string, path: string) {
  return `${normalizeBaseUrl(base)}${path}`;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("server_not_json");
  }
}

export async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(join(baseUrl, path), { signal: ctrl.signal });
    return await readJson<T>(res);
  } finally {
    clearTimeout(t);
  }
}

export async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(join(baseUrl, path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await readJson<T>(res);
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  auth: (base: string, barcode: string) =>
    postJson<AuthOk | AuthFail>(base, "/hs/tsd/auth", { barcode }),
  startZone: (base: string, zoneId: string, userId: string, sessionNum = 0, confirmRecheck = false) =>
    postJson<StartZoneOk | StartZoneFail>(base, "/hs/tsd/startZone", {
      zoneId,
      userId,
      sessionNum,
      confirmRecheck,
    }),
  scanItem: (
    base: string,
    payload: {
      barcode: string;
      zoneId: string;
      qty: number;
      userId: string;
      sessionNum: number;
      deviceId: string;
    },
  ) => postJson<ScanOk | ScanFail>(base, "/hs/tsd/scanItem", payload),
  finishZone: (base: string, zoneId: string, userId: string, sessionNum: number) =>
    postJson<FinishZoneOk | { ok: false; error?: string; message?: string }>(base, "/hs/tsd/finishZone", {
      zoneId,
      userId,
      sessionNum,
    }),
  ping: (base: string) => getJson<{ ok: boolean; finalized?: boolean }>(base, "/hs/tsd/ping"),
  resetDemo: (base: string) => postJson<{ ok: boolean }>(base, "/hs/tsd/arm/reset", {}),
  sessionLines: (base: string, zoneId: string, sessionNum: number) =>
    getJson<{ ok: boolean; error?: string; message?: string; lines: ScanLine[] }>(
      base,
      `/hs/tsd/sessionLines?zoneId=${encodeURIComponent(zoneId)}&sessionNum=${sessionNum}`,
    ),
  zones: (base: string) =>
    getJson<{ ok: boolean; zones: { zoneId: string; name: string; status: string; quarantine?: boolean }[] }>(
      base,
      "/hs/tsd/zones",
    ),
  info: (base: string) =>
    getJson<{ ok: boolean; tsdLocal?: string; tsdBuilt?: string; tsdLan?: string[] }>(base, "/hs/tsd/info"),
  undoLast: (base: string, zoneId: string, userId: string, sessionNum: number) =>
    postJson<{ ok: boolean; error?: string; message?: string; lines?: ScanLine[] }>(base, "/hs/tsd/undoLast", {
      zoneId,
      userId,
      sessionNum,
    }),
};
