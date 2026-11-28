// IndexedDB storage: books, chapter versions, and small key/value meta.
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('novelfolio', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('books', { keyPath: 'id' });
      const v = db.createObjectStore('versions', { keyPath: 'id' });
      v.createIndex('chapter', 'chapterId');
      db.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  allBooks: () => tx('books', 'readonly', (s) => req(s.getAll())),
  getBook: (id) => tx('books', 'readonly', (s) => req(s.get(id))),
  putBook: (b) => tx('books', 'readwrite', (s) => { s.put(b); }),
  delBook: (id) => tx('books', 'readwrite', (s) => { s.delete(id); }),
  versions: (chapterId) => tx('versions', 'readonly', (s) => req(s.index('chapter').getAll(chapterId))),
  addVersion: (v) => tx('versions', 'readwrite', async (s) => {
    s.put(v);
    const all = await req(s.index('chapter').getAll(v.chapterId));
    all.sort((a, b) => b.at - a.at).slice(40).forEach((x) => s.delete(x.id));
  }),
  getMeta: (k) => tx('meta', 'readonly', (s) => req(s.get(k))),
  setMeta: (k, v) => tx('meta', 'readwrite', (s) => { s.put(v, k); })
};
