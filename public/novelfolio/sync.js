// Optional account sync. Books always live on the device; when signed in they are merged with the server copy.
const API = '/api/nf';
let account = null;
try { account = JSON.parse(localStorage.getItem('nf_account') || 'null'); } catch {}
const listeners = new Set();
export const syncState = { status: 'off' }; // off | idle | busy | error
const emit = () => listeners.forEach((f) => f(syncState));
export const onSync = (f) => { listeners.add(f); return () => listeners.delete(f); };
const set = (s) => { syncState.status = s; emit(); };
if (account) syncState.status = 'idle';

export const getAccount = () => account;

async function call(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: 'Bearer ' + account.token } : {}), ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && account && !path.startsWith('/log') && !path.startsWith('/sign')) { signOut(); throw new Error('Signed out. Sign in again to keep syncing.'); }
  if (!r.ok) throw new Error(j.error || 'Could not reach the server.');
  return j;
}

export async function signIn(mode, username, password) {
  const j = await call(mode === 'signup' ? '/signup' : '/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  account = { token: j.token, username: j.username };
  localStorage.setItem('nf_account', JSON.stringify(account));
  set('idle');
}
export function signOut() { account = null; localStorage.removeItem('nf_account'); set('off'); }

// Merge two copies of the same book. Newest wins per chapter; book details come from the newer copy.
export function merge(a, b) {
  if (!a) return b; if (!b) return a;
  const [base, other] = (a.metaAt || a.updatedAt) >= (b.metaAt || b.updatedAt) ? [a, b] : [b, a];
  const tomb = new Map();
  [...(a.tombstones || []), ...(b.tombstones || [])].forEach((t) => { if (!tomb.has(t.id) || tomb.get(t.id) < t.at) tomb.set(t.id, t.at); });
  const byId = new Map();
  for (const c of [...base.chapters, ...other.chapters]) { const cur = byId.get(c.id); if (!cur || c.updatedAt > cur.updatedAt) byId.set(c.id, c); }
  const order = [...base.chapters.map((c) => c.id), ...other.chapters.map((c) => c.id)];
  const seen = new Set(), chapters = [];
  for (const id of order) {
    if (seen.has(id)) continue; seen.add(id);
    const c = byId.get(id); if (tomb.has(id) && tomb.get(id) >= c.updatedAt) continue;
    chapters.push(c);
  }
  return { ...base, chapters, tombstones: [...tomb].map(([id, at]) => ({ id, at })).slice(-500), updatedAt: Math.max(a.updatedAt, b.updatedAt), deleted: !!(a.deleted || b.deleted) };
}

let running = null, again = false;
export function sync(store) {
  if (!account || !navigator.onLine) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    set('busy');
    try {
      const remote = await call('/books');
      const local = await store.all();
      const localById = new Map(local.map((b) => [b.id, b]));
      const ids = new Set([...Object.keys(remote), ...localById.keys()]);
      let changed = false;
      for (const id of ids) {
        const l = localById.get(id), r = remote[id];
        if (l && r && l.updatedAt === r.updatedAt && l.syncedAt === r.updatedAt) continue;
        let merged = l;
        if (r && (!l || r.updatedAt !== l.syncedAt)) {
          const rb = await call('/books/' + id);
          merged = merge(l, rb);
        }
        if (!r || merged.updatedAt !== r.updatedAt || (l && l.updatedAt > (l.syncedAt || 0))) {
          {
            if (r && merged.updatedAt <= r.updatedAt) merged = { ...merged, updatedAt: r.updatedAt + 1 };
            const { syncedAt, ...clean } = merged;
            await call('/books/' + id, { method: 'PUT', body: JSON.stringify({ book: clean }) });
          }
        }
        merged = { ...merged, syncedAt: merged.updatedAt };
        if (!l || JSON.stringify(l) !== JSON.stringify(merged)) { await store.save(merged); changed = true; }
      }
      set('idle');
      return changed;
    } catch (e) { console.warn('[sync]', e); set(account ? 'error' : 'off'); throw e; }
    finally {
      running = null;
      if (again) { again = false; setTimeout(() => sync(store).catch(() => {}), 500); }
    }
  })();
  return running;
}
