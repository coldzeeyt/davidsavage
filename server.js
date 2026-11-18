const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./lib/store');
const DEFAULTS = require('./lib/defaults');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('ds:' + ADMIN_PASSWORD).digest('hex');
const COOKIE = 'ds_admin';
const SESSION_DAYS = 30;

if (!ADMIN_PASSWORD) console.warn('[warn] ADMIN_PASSWORD is not set — the editor is locked until you set it.');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// ---------- helpers ----------
const uid = () => crypto.randomBytes(6).toString('base64url');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ipOf = (req) => req.ip || 'x';
const ipHash = (req) => crypto.createHash('sha256').update(SECRET + ipOf(req)).digest('base64url').slice(0, 16);

function sign(value) { return crypto.createHmac('sha256', SECRET).update(value).digest('base64url'); }
function makeToken() { const exp = String(Date.now() + SESSION_DAYS * 864e5); return exp + '.' + sign(exp); }
function validToken(tok) {
  if (!tok || !ADMIN_PASSWORD) return false;
  const [exp, sig] = tok.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const isAdmin = (req) => validToken(cookies(req)[COOKIE]);
function requireAdmin(req, res, next) { if (isAdmin(req)) return next(); res.status(401).json({ error: 'Not signed in' }); }

// Simple in-memory rate limiter: max `n` hits per `ms` per ip+bucket
const hits = new Map();
function limit(bucket, n, ms) {
  return (req, res, next) => {
    const k = bucket + ':' + ipOf(req); const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < ms);
    if (arr.length >= n) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
    arr.push(now); hits.set(k, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 36e5)) hits.delete(k); }, 6e5).unref();

// Same-origin check for state-changing requests (blocks cross-site form posts)
function sameOrigin(req, res, next) {
  if (req.method === 'GET') return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try { if (new URL(origin).host === req.headers.host) return next(); } catch {}
  return res.status(403).json({ error: 'Bad origin' });
}
app.use('/api', sameOrigin);

// Reaction dedupe (per ip, per item). Kept in memory; resets on restart — fine for hearts.
const reacted = new Set();

// ---------- data ----------
const getLive = () => store.get('site:live', DEFAULTS);
const getDraft = async () => (await store.get('site:draft')) || getLive();
const publicComment = (c) => ({ id: c.id, name: c.name, text: c.text, react: c.react, at: c.at, hearts: c.hearts || 0, reply: c.reply || '' });
const publicQuestion = (q) => ({ id: q.id, name: q.name, text: q.text, at: q.at, answer: q.answer, answeredAt: q.answeredAt, pinned: !!q.pinned });

// ---------- public API ----------
app.get('/api/site', async (req, res) => {
  const site = req.query.draft && isAdmin(req) ? await getDraft() : await getLive();
  const [comments, questions, flames] = await Promise.all([store.get('guestbook', []), store.get('questions', []), store.get('flames', {})]);
  const approved = comments.filter((c) => c.status === 'approved').sort((a, b) => b.at - a.at);
  const answered = questions.filter((q) => q.status === 'answered' && !q.hiddenFromSite)
    .sort((a, b) => (b.pinned - a.pinned) || (b.answeredAt - a.answeredAt));
  res.set('Cache-Control', 'no-store');
  res.json({
    site,
    guestbook: { count: approved.length, items: approved.slice(0, 30).map(publicComment) },
    questions: answered.slice(0, 20).map(publicQuestion),
    flames
  });
});

app.post('/api/guestbook', limit('gb', 4, 6e5), async (req, res) => {
  const name = clean(req.body.name, 40), text = clean(req.body.text, 600);
  const react = ['flame', 'heart', 'disc-3', 'gamepad-2'].includes(req.body.react) ? req.body.react : '';
  if (req.body.website) return res.json({ ok: true, status: 'pending' }); // honeypot
  if (!name || !text) return res.status(400).json({ error: 'Add your name and a note.' });
  const site = await getLive();
  const status = site.sections.guestbook.requireApproval ? 'pending' : 'approved';
  const c = { id: uid(), name, text, react, at: Date.now(), status, hearts: 0, ip: ipHash(req) };
  await store.update('guestbook', [], (list) => { list.push(c); return list.slice(-2000); });
  res.json({ ok: true, status, comment: status === 'approved' ? publicComment(c) : null });
});

app.post('/api/guestbook/:id/heart', limit('react', 40, 6e4), async (req, res) => {
  const key = 'h:' + req.params.id + ':' + ipHash(req);
  if (reacted.has(key)) return res.json({ ok: true, dup: true });
  let hearts = 0;
  await store.update('guestbook', [], (list) => { const c = list.find((x) => x.id === req.params.id && x.status === 'approved'); if (c) { c.hearts = (c.hearts || 0) + 1; hearts = c.hearts; } return list; });
  reacted.add(key);
  res.json({ ok: true, hearts });
});

app.post('/api/notes/:id/flame', limit('react', 40, 6e4), async (req, res) => {
  const id = clean(req.params.id, 40);
  const key = 'f:' + id + ':' + ipHash(req);
  if (reacted.has(key)) return res.json({ ok: true, dup: true });
  const site = await getLive();
  if (!site.sections.notes.posts.some((p) => p.id === id)) return res.status(404).json({ error: 'Not found' });
  const flames = await store.update('flames', {}, (f) => { f[id] = (f[id] || 0) + 1; return f; });
  reacted.add(key);
  res.json({ ok: true, flames: flames[id] });
});

app.post('/api/questions', limit('ask', 5, 6e5), async (req, res) => {
  const site = await getLive();
  let name = clean(req.body.name, 40); const text = clean(req.body.text, 500);
  if (req.body.website) return res.json({ ok: true });
  if (!text) return res.status(400).json({ error: 'Type a question first.' });
  if (!name) { if (site.sections.gpt.allowAnonymous) name = 'anon'; else return res.status(400).json({ error: 'Add your name so David knows who asked.' }); }
  const q = { id: uid(), name, text, at: Date.now(), status: 'waiting', ip: ipHash(req) };
  await store.update('questions', [], (list) => { list.push(q); return list.slice(-2000); });
  res.json({ ok: true, question: { id: q.id, name, text, at: q.at } });
});

// Visitors can poll their own question to see when David answers
app.get('/api/questions/:id', async (req, res) => {
  const list = await store.get('questions', []);
  const q = list.find((x) => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Not found' });
  res.json(q.status === 'answered' ? publicQuestion(q) : { id: q.id, status: 'waiting' });
});

// ---------- admin API ----------
app.post('/api/admin/login', limit('login', 8, 9e5), (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Set ADMIN_PASSWORD on the server first.' });
  const a = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong password.' });
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req), configured: !!ADMIN_PASSWORD }));

app.get('/api/admin/draft', requireAdmin, async (req, res) => {
  const [draft, live] = await Promise.all([getDraft(), getLive()]);
  res.json({ draft, unpublished: JSON.stringify(draft) !== JSON.stringify(live) });
});
app.put('/api/admin/draft', requireAdmin, async (req, res) => {
  const d = req.body && req.body.draft;
  if (!d || typeof d !== 'object' || !d.sections || !d.hero) return res.status(400).json({ error: 'Bad draft' });
  await store.set('site:draft', d);
  res.json({ ok: true, savedAt: Date.now() });
});
app.post('/api/admin/publish', requireAdmin, async (req, res) => {
  const d = await getDraft();
  await store.set('site:live', d);
  res.json({ ok: true, publishedAt: Date.now() });
});
app.post('/api/admin/discard', requireAdmin, async (req, res) => {
  const live = await getLive();
  await store.set('site:draft', live);
  res.json({ ok: true, draft: live });
});

app.get('/api/admin/inbox', requireAdmin, async (req, res) => {
  const [comments, questions] = await Promise.all([store.get('guestbook', []), store.get('questions', [])]);
  const strip = (x) => { const { ip, ...rest } = x; return rest; };
  res.json({
    comments: comments.slice().sort((a, b) => b.at - a.at).slice(0, 300).map(strip),
    questions: questions.slice().sort((a, b) => b.at - a.at).slice(0, 300).map(strip)
  });
});
app.post('/api/admin/comments/:id', requireAdmin, async (req, res) => {
  const { action } = req.body; let found = false;
  await store.update('guestbook', [], (list) => {
    const i = list.findIndex((c) => c.id === req.params.id);
    if (i < 0) return list; found = true;
    if (action === 'approve') list[i].status = 'approved';
    else if (action === 'hide') list[i].status = 'hidden';
    else if (action === 'delete') list.splice(i, 1);
    else if (action === 'reply') { list[i].reply = clean(req.body.reply, 400); if (list[i].status === 'pending') list[i].status = 'approved'; }
    return list;
  });
  res.status(found ? 200 : 404).json({ ok: found });
});
app.post('/api/admin/questions/:id', requireAdmin, async (req, res) => {
  const { action } = req.body; let found = false;
  await store.update('questions', [], (list) => {
    const i = list.findIndex((q) => q.id === req.params.id);
    if (i < 0) return list; found = true; const q = list[i];
    if (action === 'answer') { q.answer = clean(req.body.answer, 1500); q.status = q.answer ? 'answered' : 'waiting'; q.answeredAt = Date.now(); if ('pinned' in req.body) q.pinned = !!req.body.pinned; }
    else if (action === 'pin') q.pinned = !!req.body.pinned;
    else if (action === 'hide') q.hiddenFromSite = !q.hiddenFromSite;
    else if (action === 'delete') list.splice(i, 1);
    return list;
  });
  res.status(found ? 200 : 404).json({ ok: found });
});

// ---------- pages ----------
app.get('/healthz', (req, res) => res.send('ok'));
const indexHtml = require('fs').readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
app.get(['/', '/index.html'], (req, res) => {
  const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.type('html').set('Cache-Control', 'no-cache').send(indexHtml.replace(/__ORIGIN__/g, origin));
});
app.get(['/edit', '/edit/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.redirect('/'));

store.init().then(() => {
  app.listen(PORT, () => console.log(`davidsavage.xyz on :${PORT} (store: ${store.kind()})`));
}).catch((e) => { console.error('Store failed to start', e); process.exit(1); });
