// Keeps the reference picture in the browser's own database (IndexedDB), as
// pictures are too big for ordinary page storage. If the browser won't store
// it, the picture simply lasts for this visit.

const DB = 'incised-lettering';
const STORE = 'files';
const KEY = 'refImage';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveImage(blob: Blob | null): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (blob) tx.objectStore(STORE).put(blob, KEY);
      else tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* not stored: lasts for this visit only */
  }
}

export async function loadImage(): Promise<Blob | null> {
  try {
    const db = await open();
    return await new Promise<Blob | null>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
