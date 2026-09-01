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

function join(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(join(baseUrl, path), { signal: ctrl.signal });
    return (await res.json()) as T;
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
    return (await res.json()) as T;
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
    postJson<{ ok: boolean; error?: string; message?: string }>(base, "/hs/tsd/finishZone", {
      zoneId,
      userId,
      sessionNum,
    }),
  ping: (base: string) => getJson<{ ok: boolean }>(base, "/hs/tsd/ping"),
  sessionLines: (base: string, zoneId: string, sessionNum: number) =>
    getJson<{ ok: boolean; error?: string; message?: string; lines: ScanLine[] }>(
      base,
      `/hs/tsd/sessionLines?zoneId=${encodeURIComponent(zoneId)}&sessionNum=${sessionNum}`,
    ),
  undoLast: (base: string, zoneId: string, userId: string, sessionNum: number) =>
    postJson<{ ok: boolean; error?: string; message?: string; lines?: ScanLine[] }>(base, "/hs/tsd/undoLast", {
      zoneId,
      userId,
      sessionNum,
    }),
};
