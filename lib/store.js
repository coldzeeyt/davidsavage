// Tiny key/value document store.
// Uses Postgres when DATABASE_URL is set (Railway Postgres), otherwise a JSON file
// in DATA_DIR (mount a Railway volume there so it survives redeploys).
const fs = require('fs');
const path = require('path');

let queue = Promise.resolve();
// Serialize every write so read-modify-write updates never clobber each other.
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function fileBackend() {
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'store.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = {}; }
  return {
    kind: 'file:' + file,
    async init() {},
    async get(key) { return cache[key] === undefined ? undefined : structuredClone(cache[key]); },
    async set(key, value) {
      cache[key] = structuredClone(value);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cache));
      fs.renameSync(tmp, file);
    }
  };
}

function pgBackend() {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString: url,
    ssl: /railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }
  });
  return {
    kind: 'postgres',
    async init() {
      await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())');
    },
    async get(key) {
      const r = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
      return r.rows[0] ? r.rows[0].value : undefined;
    },
    async set(key, value) {
      await pool.query(
        'INSERT INTO kv(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()',
        [key, JSON.stringify(value)]
      );
    }
  };
}

const backend = process.env.DATABASE_URL ? pgBackend() : fileBackend();

module.exports = {
  kind: () => backend.kind,
  init: () => backend.init(),
  get: async (key, fallback) => {
    const v = await backend.get(key);
    return v === undefined ? structuredClone(fallback) : v;
  },
  set: (key, value) => serial(() => backend.set(key, value)),
  // Atomic read-modify-write
  update: (key, fallback, fn) => serial(async () => {
    let v = await backend.get(key);
    if (v === undefined) v = structuredClone(fallback);
    const out = await fn(v);
    const next = out === undefined ? v : out;
    await backend.set(key, next);
    return next;
  })
};
