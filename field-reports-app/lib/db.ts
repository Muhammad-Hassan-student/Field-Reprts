// IndexedDB wrapper for the offline report queue.
// Every report is written here BEFORE any network call.
// This is what survives a hard close / relaunch.

export type ReportStatus = "queued" | "sending" | "sent" | "failed";

export type QueuedReport = {
  // Our own stable ID. Generated ONCE when the user hits submit.
  // Every retry uses this exact value so the server can dedupe.
  client_report_id: string;

  outlet_name: string;
  finding: string;
  action_needed: string;
  captured_at: string; // ISO-8601, when the worker filled the form
  lat: number;
  lng: number;

  // Queue bookkeeping
  status: ReportStatus;
  attempts: number;
  last_error: string | null;
  server_report_id: string | null;
  next_attempt_at: number; // epoch ms; 0 = send now
  created_at: number;
};

const DB_NAME = "field-reports";
const DB_VERSION = 1;
const STORE = "queue";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "client_report_id",
        });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("next_attempt_at", "next_attempt_at", {
          unique: false,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addReport(
  report: Omit<
    QueuedReport,
    | "status"
    | "attempts"
    | "last_error"
    | "server_report_id"
    | "next_attempt_at"
    | "created_at"
  >
): Promise<QueuedReport> {
  const full: QueuedReport = {
    ...report,
    status: "queued",
    attempts: 0,
    last_error: null,
    server_report_id: null,
    next_attempt_at: 0,
    created_at: Date.now(),
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return full;
}

export async function getAllReports(): Promise<QueuedReport[]> {
  const db = await openDB();
  const all = await new Promise<QueuedReport[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedReport[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all.sort((a, b) => a.created_at - b.created_at);
}

export async function updateReport(
  client_report_id: string,
  patch: Partial<QueuedReport>
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(client_report_id);
    getReq.onsuccess = () => {
      const existing = getReq.result as QueuedReport | undefined;
      if (!existing) return;
      store.put({ ...existing, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}