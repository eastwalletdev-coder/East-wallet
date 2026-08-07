/**
 * IndexedDB persistence for browser full-lightnode balance replica.
 * In-memory Map stays the hot path (RPC answers); IDB is cold storage so
 * reload / Mini App reopen does not wipe the replica.
 *
 * Memory notes:
 * - One Map in RAM (same as before) for O(1) reads
 * - Writes are debounced and batched (not per every balance:update)
 * - Optional soft cap: if entry count exceeds MAX_ENTRIES, drop oldest
 *   by lastUpdated (still complete for active network traffic)
 */

const DB_NAME = "east_fullnode_replica_v1";
const DB_VERSION = 1;
const STORE = "balances";
const META = "meta";
const DEBOUNCE_MS = 800;
/** Soft cap to protect low-end devices; raise if network grows */
const MAX_ENTRIES = 50_000;

export type BalanceRow = {
  address: string; // lowercase
  balance: string; // decimal string from hub
  updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("idb open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "address" });
        os.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb request failed"));
  });
}

export async function loadBalanceReplica(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const all = await idbReq(store.getAll() as IDBRequest<BalanceRow[]>);
    db.close();
    for (const row of all || []) {
      if (row?.address && row.balance != null) {
        map.set(String(row.address).toLowerCase(), String(row.balance));
      }
    }
  } catch {
    /* private mode / quota — empty map */
  }
  return map;
}

export async function clearBalanceReplica(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function setFullNodePref(enabled: boolean): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put({ key: "fullNodeEnabled", value: enabled, at: Date.now() });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function getFullNodePref(): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(META, "readonly");
    const row = await idbReq(tx.objectStore(META).get("fullNodeEnabled") as IDBRequest<{ value?: boolean } | undefined>);
    db.close();
    return !!row?.value;
  } catch {
    return false;
  }
}

/**
 * Debounced batch writer. Call put() on every balance:update; flush coalesces.
 */
export class BalanceReplicaWriter {
  private pending = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  put(address: string, balance: string) {
    this.pending.set(address.toLowerCase(), balance);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.pending.size === 0) return;
    this.flushing = true;
    const batch = new Map(this.pending);
    this.pending.clear();
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const now = Date.now();
      for (const [address, balance] of batch) {
        store.put({ address, balance, updatedAt: now } satisfies BalanceRow);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // Soft cap: if too many keys, delete oldest by updatedAt
      const countReq = db.transaction(STORE, "readonly").objectStore(STORE).count();
      const count = await idbReq(countReq);
      if (count > MAX_ENTRIES) {
        const tx2 = db.transaction(STORE, "readwrite");
        const idx = tx2.objectStore(STORE).index("updatedAt");
        const toDelete = count - MAX_ENTRIES;
        let deleted = 0;
        await new Promise<void>((resolve, reject) => {
          const cursorReq = idx.openCursor(); // ascending = oldest first
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor || deleted >= toDelete) {
              resolve();
              return;
            }
            cursor.delete();
            deleted++;
            cursor.continue();
          };
          cursorReq.onerror = () => reject(cursorReq.error);
        });
      }
      db.close();
    } catch {
      // put back so next flush retries
      for (const [k, v] of batch) {
        if (!this.pending.has(k)) this.pending.set(k, v);
      }
    } finally {
      this.flushing = false;
    }
  }
}
