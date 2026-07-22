// IndexedDB-backed local cache of the last MAX_STORED_BLOCKS verified block
// headers for this Light Node. Previously nothing persisted beyond
// currentHeight + lastHash (see STORAGE_KEY in client.ts) — enough to resume
// verifying the chain, but nothing another peer could actually be served
// from. This is what lets lightnode-to-lightnode WebRTC gossip (see
// webrtc-peer.ts) answer a real "does anyone have #X-#Y" request instead of
// only ever broadcasting the live tip.
//
// This is a ROLLING WINDOW, not a full archive — that's what a validator's
// local-ledger.js (Termux/VPS, full-node-sync.js) is for. 1000 blocks is
// meant to cover the overwhelming majority of real catch-up gaps (a node
// that was offline for a while); anything bigger falls through to a
// validator or the Postgres archive, same as before.
//
// Every method is best-effort: IndexedDB isn't available during SSR
// (isAvailable() guards that), and a write/read failure here should never
// break sync — the caller never awaits putBlock() for correctness, only
// for the fact that it eventually happens.

const DB_NAME = "eastchain-lightnode";
const DB_VERSION = 1;
const STORE_NAME = "blocks";
export const MAX_STORED_BLOCKS = 1000;

function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!isAvailable()) return Promise.reject(new Error("IndexedDB not available"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "height" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Stores one verified header and prunes anything older than the newest
// MAX_STORED_BLOCKS heights. Fire-and-forget from the caller's side.
export async function putBlock(header: any): Promise<void> {
  if (!isAvailable() || typeof header?.height !== "number") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(header);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await pruneOlderThan(db, header.height - MAX_STORED_BLOCKS);
  } catch {
    // Best-effort — see file header.
  }
}

async function pruneOlderThan(db: IDBDatabase, cutoffHeight: number): Promise<void> {
  if (cutoffHeight < 0) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const range = IDBKeyRange.upperBound(cutoffHeight);
    const req = store.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(); // pruning is housekeeping, not correctness — never throw
  });
}

export async function getBlock(height: number): Promise<any | null> {
  if (!isAvailable()) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(height);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// Inclusive range, only the blocks actually present (gaps just get
// skipped) — same contract as the validator daemon's local-ledger.js
// getRange(), so both sides of a peer gap-fill behave the same way.
export async function getRange(fromHeight: number, toHeight: number): Promise<any[]> {
  if (!isAvailable() || toHeight < fromHeight) return [];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const range = IDBKeyRange.bound(fromHeight, toHeight);
      const req = store.getAll(range);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

// Highest height currently stored, or -1 if empty/unavailable — lets a
// peer answer "what's your local tip" without a full range scan.
export async function getHighestStoredHeight(): Promise<number> {
  if (!isAvailable()) return -1;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor(null, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        resolve(cursor ? (cursor.key as number) : -1);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return -1;
  }
}
