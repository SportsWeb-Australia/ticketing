// Best-effort offline queue: scans that fail to reach the server are stored
// and retried when back online. The server RPC is still the source of truth.
const KEY = 'tk_scan_queue';

export interface QueuedScan { qr: string; gate: string | null; ts: number; }

export function loadQueue(): QueuedScan[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function saveQueue(q: QueuedScan[]) {
  localStorage.setItem(KEY, JSON.stringify(q));
}
export function enqueue(s: QueuedScan) {
  const q = loadQueue(); q.push(s); saveQueue(q);
}
