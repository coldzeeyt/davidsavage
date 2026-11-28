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
app.use('/api/nf', require('./lib/novelfolio')(store, SECRET));
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

// ---------- phone alerts ----------
// NTFY_URL = https://ntfy.sh/<your-secret-topic>  (subscribe to the same topic in the ntfy app)
// DISCORD_WEBHOOK_URL = optional Discord webhook, if you'd rather get it there
async function notify(title, message, click) {
  const jobs = [];
  if (process.env.NTFY_URL) {
    jobs.push(fetch(process.env.NTFY_URL, {
      method: 'POST', body: message,
      headers: { Title: title.replace(/[^\x20-\x7E]/g, ''), Tags: 'speech_balloon', Priority: 'high', ...(click ? { Click: click } : {}) }
    }));
  }
  if (process.env.DISCORD_WEBHOOK_URL) {
    jobs.push(fetch(process.env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `**${title}**\n${message}${click ? `\n${click}` : ''}`.slice(0, 1900), allowed_mentions: { parse: [] } }) }));
  }
  const res = await Promise.allSettled(jobs);
  const out = [];
  for (const r of res) {
    if (r.status === 'rejected') { console.warn('[notify] failed:', r.reason?.message); out.push({ ok: false, error: r.reason?.message }); continue; }
    const body = await r.value.text().catch(() => '');
    if (!r.value.ok) console.warn('[notify] got', r.value.status, body.slice(0, 200));
    else console.log('[notify] sent', r.value.status);
    out.push({ ok: r.value.ok, status: r.value.status, body: body.slice(0, 200) });
  }
  if (!jobs.length) console.warn('[notify] no NTFY_URL or DISCORD_WEBHOOK_URL set');
  return out;
}
const originOf = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// ---------- data ----------
// Fill in any section that's missing (e.g. saved by an older editor) so new sections always show up.
function normalize(site) {
  if (!site || !site.sections) return structuredClone(DEFAULTS);
  for (const [k, v] of Object.entries(DEFAULTS.sections)) {
    if (!site.sections[k]) site.sections[k] = structuredClone(v);
    if (!site.order.includes(k)) { const at = DEFAULTS.order.indexOf(k); const prev = DEFAULTS.order[at - 1]; const i = site.order.indexOf(prev); site.order.splice(i >= 0 ? i + 1 : site.order.length, 0, k); }
  }
  for (const k of ['hero', 'nowSpinning', 'rightNow', 'ticker', 'meta']) if (!site[k]) site[k] = structuredClone(DEFAULTS[k]);
  return site;
}
const getLive = async () => normalize(await store.get('site:live', DEFAULTS));
const getDraft = async () => normalize((await store.get('site:draft')) || (await getLive()));
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
  notify(`DavidGPT: ${name} asked`, text, originOf(req) + '/edit').catch(() => {});
  res.json({ ok: true, question: { id: q.id, name, text, at: q.at } });
});

app.post('/api/applications', limit('apply', 3, 9e5), async (req, res) => {
  if (req.body.website) return res.json({ ok: true });
  const site = await getLive();
  if (!site.sections.label || !site.sections.label.formOpen) return res.status(403).json({ error: 'Applications are closed right now.' });
  const a = {
    id: uid(), at: Date.now(), status: 'new', ip: ipHash(req),
    artist: clean(req.body.artist, 60), email: clean(req.body.email, 120), link: clean(req.body.link, 300),
    genre: clean(req.body.genre, 60), about: clean(req.body.about, 1500)
  };
  if (!a.artist || !a.email || !a.link) return res.status(400).json({ error: 'Add your artist name, email, and a link to your music.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) return res.status(400).json({ error: "That email doesn't look right." });
  await store.update('applications', [], (list) => { list.push(a); return list.slice(-2000); });
  notify(`Same Room Records: ${a.artist} applied`, `${a.genre ? a.genre + ' · ' : ''}${a.link}\n${a.about}`.slice(0, 900), originOf(req) + '/edit').catch(() => {});
  res.json({ ok: true });
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
  const [comments, questions, applications] = await Promise.all([store.get('guestbook', []), store.get('questions', []), store.get('applications', [])]);
  const strip = (x) => { const { ip, ...rest } = x; return rest; };
  res.json({
    comments: comments.slice().sort((a, b) => b.at - a.at).slice(0, 300).map(strip),
    questions: questions.slice().sort((a, b) => b.at - a.at).slice(0, 300).map(strip),
    applications: applications.slice().sort((a, b) => b.at - a.at).slice(0, 300).map(strip)
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

app.post('/api/admin/applications/:id', requireAdmin, async (req, res) => {
  const { action } = req.body; let found = false;
  await store.update('applications', [], (list) => {
    const i = list.findIndex((a) => a.id === req.params.id);
    if (i < 0) return list; found = true;
    if (action === 'status' && ['new', 'maybe', 'signed', 'pass'].includes(req.body.status)) list[i].status = req.body.status;
    else if (action === 'delete') list.splice(i, 1);
    return list;
  });
  res.status(found ? 200 : 404).json({ ok: found });
});

app.post('/api/admin/test-alert', requireAdmin, async (req, res) => {
  const out = await notify('Test alert', 'If you see this, your site alerts are working.', originOf(req) + '/edit');
  res.json({ results: out, configured: !!(process.env.NTFY_URL || process.env.DISCORD_WEBHOOK_URL) });
});

// ---------- pages ----------
app.get('/healthz', (req, res) => res.send('ok'));
const indexHtml = require('fs').readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
app.get(['/', '/index.html'], (req, res) => {
  const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.type('html').set('Cache-Control', 'no-cache').send(indexHtml.replace(/__ORIGIN__/g, origin));
});
app.get(/^\/novelfolio$/, (req, res) => res.redirect(301, '/novelfolio/'));
app.get('/novelfolio/sw.js', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'novelfolio', 'sw.js')));
app.get(['/edit', '/edit/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.redirect('/'));

// One-time cleanups. Each runs once, then is remembered in the store.
async function migrate() {
  const done = await store.get('migrations', []);
  if (!done.includes('clear-comments-2026-11-17')) {
    await store.set('guestbook', []);
    for (const key of ['site:live', 'site:draft']) {
      const site = await store.get(key);
      if (site?.sections?.notes) { site.sections.notes.posts = site.sections.notes.posts.filter((p) => !['n1', 'n2', 'n3'].includes(p.id)); await store.set(key, site); }
    }
    await store.set('flames', {});
    for (const key of ['site:live', 'site:draft']) {
      const site = await store.get(key);
      if (site?.hero && /wadsworth|ohio/i.test(site.hero.eyebrow || '')) { site.hero.eyebrow = 'Music · Apps · Everything else'; await store.set(key, site); }
    }
    done.push('clear-comments-2026-11-17'); await store.set('migrations', done);
    console.log('[migrate] cleared guestbook + starter posts');
  }
}

async function migrateLabel() {
  const done = await store.get('migrations', []);
  if (done.includes('add-label-2026-11-17')) return;
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    if (!site || site.sections.label) continue;
    site.sections.label = structuredClone(DEFAULTS.sections.label);
    const i = site.order.indexOf('music');
    site.order.splice(i >= 0 ? i + 1 : site.order.length, 0, 'label');
    await store.set(key, site);
  }
  done.push('add-label-2026-11-17'); await store.set('migrations', done);
}

async function migrateCrossjam() {
  const done = await store.get('migrations', []);
  if (done.includes('remove-crossjam')) return;
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    if (!site?.sections?.projects) continue;
    const items = site.sections.projects.items.filter((p) => !/crossjam/i.test(p.title || ''));
    const byId = Object.fromEntries(items.map((p) => [p.id, p]));
    if (byId.p2) byId.p2.width = 'xl';
    if (byId.p5) byId.p5.width = 'l';
    if (byId.p3) byId.p3.width = 'half';
    if (byId.p4) byId.p4.width = 'half';
    if (byId.p5 && byId.p2) { items.splice(items.indexOf(byId.p5), 1); items.splice(items.indexOf(byId.p2) + 1, 0, byId.p5); }
    site.sections.projects.items = items;
    await store.set(key, site);
  }
  done.push('remove-crossjam'); await store.set('migrations', done);
  console.log('[migrate] removed Crossjam');
  // one-time alert so you can see notifications are connected
  notify('davidsavage.xyz', 'Alerts are connected. You\'ll get one of these for every DavidGPT question and label application.').catch(() => {});
}

async function migrateMatchbook() {
  const done = await store.get('migrations', []);
  if (done.includes('matchbook-5-songs')) return;
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    const items = site?.sections?.music?.items; if (!items) continue;
    items.forEach((m) => { if (/matchbook/i.test(m.title || '')) m.sub = String(m.sub || '').replace(/\b6 songs\b/i, '5 songs'); });
    await store.set(key, site);
  }
  done.push('matchbook-5-songs'); await store.set('migrations', done);
}

async function migrateDontDie() {
  const done = await store.get('migrations', []);
  if (done.includes('add-dont-die-on-me')) return;
  const rel = DEFAULTS.sections.music.items.find((m) => m.id === 'm4');
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    const items = site?.sections?.music?.items; if (!items || items.some((m) => m.id === 'm4')) continue;
    items.unshift(structuredClone(rel));
    await store.set(key, site);
  }
  done.push('add-dont-die-on-me'); await store.set('migrations', done);
}

async function migrateNewProjects() {
  const done = await store.get('migrations', []);
  if (done.includes('add-ringfall-tubegrid-runout')) return;
  const add = DEFAULTS.sections.projects.items.filter((p) => ['p10', 'p11', 'p12'].includes(p.id));
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    const items = site?.sections?.projects?.items; if (!items) continue;
    const fresh = add.filter((a) => !items.some((p) => p.id === a.id || (p.title || '').toLowerCase() === a.title.toLowerCase()));
    if (!fresh.length) continue;
    const at = items.findIndex((p) => p.id === 'p4');
    items.splice(at >= 0 ? at + 1 : items.length, 0, ...structuredClone(fresh));
    await store.set(key, site);
  }
  done.push('add-ringfall-tubegrid-runout'); await store.set('migrations', done);
  console.log('[migrate] added Ringfall, Tube Grid, Runout');
}

async function migrateBongotronics() {
  const done = await store.get('migrations', []);
  if (done.includes('add-bongotronics')) return;
  const link = DEFAULTS.sections.socials.items.find((l) => l.id === 'l5');
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    const items = site?.sections?.socials?.items;
    if (!items || items.some((l) => l.id === 'l5' || /bongotronics/i.test((l.label || '') + (l.link || '')))) continue;
    items.push(structuredClone(link));
    await store.set(key, site);
  }
  done.push('add-bongotronics'); await store.set('migrations', done);
  console.log('[migrate] added Bongotronics');
}

async function migrateRunoutLive() {
  const done = await store.get('migrations', []);
  if (done.includes('runout-live')) return;
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    const p = site?.sections?.projects?.items?.find((x) => x.id === 'p12');
    if (!p || p.link) continue;
    p.link = 'https://site-production-c239c98a.up.railway.app';
    p.tags = (p.tags || []).map((t) => (/coming soon/i.test(t) ? 'New' : t));
    await store.set(key, site);
  }
  done.push('runout-live'); await store.set('migrations', done);
  console.log('[migrate] Runout is live');
}

async function migrateFacet() {
  const done = await store.get('migrations', []);
  if (done.includes('add-facet')) return;
  const add = DEFAULTS.sections.projects.items.find((p) => p.id === 'p13');
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    const items = site?.sections?.projects?.items; if (!items) continue;
    if (items.some((p) => p.id === add.id || (p.title || '').toLowerCase() === 'facet')) continue;
    const at = items.findIndex((p) => p.id === 'p12');
    items.splice(at >= 0 ? at + 1 : items.length, 0, structuredClone(add));
    await store.set(key, site);
  }
  done.push('add-facet'); await store.set('migrations', done);
  console.log('[migrate] added Facet');
}

async function migrateNovelfolio() {
  const done = await store.get('migrations', []);
  if (done.includes('add-novelfolio')) return;
  const add = DEFAULTS.sections.projects.items.find((p) => p.id === 'p14');
  for (const key of ['site:live', 'site:draft']) {
    const site = await store.get(key);
    const items = site?.sections?.projects?.items; if (!items) continue;
    if (items.some((p) => p.id === add.id || (p.title || '').toLowerCase() === 'novelfolio')) continue;
    const at = items.findIndex((p) => p.id === 'p13');
    items.splice(at >= 0 ? at + 1 : items.length, 0, structuredClone(add));
    await store.set(key, site);
  }
  done.push('add-novelfolio'); await store.set('migrations', done);
  console.log('[migrate] added Novelfolio');
}

store.init().then(migrate).then(migrateLabel).then(migrateCrossjam).then(migrateMatchbook).then(migrateDontDie).then(migrateNewProjects).then(migrateBongotronics).then(migrateRunoutLive).then(migrateFacet).then(migrateNovelfolio).then(() => {
  app.listen(PORT, () => console.log(`davidsavage.xyz on :${PORT} (store: ${store.kind()})`));
}).catch((e) => { console.error('Store failed to start', e); process.exit(1); });
