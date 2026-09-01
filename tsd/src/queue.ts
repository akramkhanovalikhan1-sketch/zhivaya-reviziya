import { api } from "./api";

export type QueuedScan = {
  id: string;
  barcode: string;
  qty: number;
  zoneId: string;
  userId: string;
  sessionNum: number;
  deviceId: string;
};

const KEY = "tsdScanQueue";

export function readQueue(): QueuedScan[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedScan[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedScan[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function enqueueScan(item: Omit<QueuedScan, "id">): QueuedScan {
  const row: QueuedScan = {
    ...item,
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  };
  writeQueue([...readQueue(), row]);
  return row;
}

export async function flushQueue(baseUrl: string): Promise<{ sent: number; left: number; lastName?: string }> {
  const items = readQueue();
  if (!items.length) return { sent: 0, left: 0 };

  const remain: QueuedScan[] = [];
  let sent = 0;
  let lastName: string | undefined;

  for (const item of items) {
    try {
      const res = await api.scanItem(baseUrl, item);
      if (res.ok && !res.alarm) {
        sent += 1;
        if ("name" in res && res.name) lastName = res.name;
        continue;
      }
      if ("error" in res && (res.error === "unknown_barcode" || res.error === "zone_not_started")) {
        continue;
      }
      remain.push(item);
    } catch {
      remain.push(item);
      remain.push(...items.slice(items.indexOf(item) + 1));
      break;
    }
  }

  writeQueue(remain);
  return { sent, left: remain.length, lastName };
}
