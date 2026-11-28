// Novelfolio sync: accounts + per-book storage on top of the shared key/value store.
const express = require('express');
const crypto = require('crypto');

module.exports = function novelfolio(store, secret) {
  const r = express.Router();
  r.use(express.json({ limit: '40mb' }));

  const sign = (v) => crypto.createHmac('sha256', 'nf:' + secret).update(v).digest('base64url');
  const tokenFor = (user) => { const body = Buffer.from(JSON.stringify({ u: user, e: Date.now() + 365 * 864e5 })).toString('base64url'); return body + '.' + sign(body); };
  function userOf(req) {
    const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const [body, sig] = t.split('.');
    if (!body || !sig) return null;
    const a = Buffer.from(sig), b = Buffer.from(sign(body));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.e > Date.now() ? p.u : null; } catch { return null; }
  }
  const auth = (req, res, next) => { const u = userOf(req); if (!u) return res.status(401).json({ error: 'Sign in again.' }); req.nfUser = u; next(); };

  const hits = new Map();
  const slow = (n, ms) => (req, res, next) => {
    const k = req.ip + req.path; const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < ms);
    if (arr.length >= n) return res.status(429).json({ error: 'Too many tries. Wait a minute.' });
    arr.push(now); hits.set(k, arr); next();
  };

  const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('base64url');
  const normName = (s) => String(s || '').trim().toLowerCase();
  const validName = (s) => /^[a-z0-9_.-]{3,24}$/.test(s);
  const validId = (s) => /^[A-Za-z0-9_-]{6,40}$/.test(s);

  r.post('/signup', slow(5, 6e5), async (req, res) => {
    const name = normName(req.body.username), pw = String(req.body.password || '');
    if (!validName(name)) return res.status(400).json({ error: 'Usernames are 3–24 letters, numbers, dots or dashes.' });
    if (pw.length < 6) return res.status(400).json({ error: 'Use at least 6 characters for your password.' });
    let taken = false;
    await store.update('nf:users', {}, (users) => {
      if (users[name]) { taken = true; return users; }
      const salt = crypto.randomBytes(16).toString('base64url');
      users[name] = { salt, hash: hash(pw, salt), at: Date.now() };
      return users;
    });
    if (taken) return res.status(409).json({ error: 'That username is taken.' });
    res.json({ token: tokenFor(name), username: name });
  });

  r.post('/login', slow(10, 6e5), async (req, res) => {
    const name = normName(req.body.username), pw = String(req.body.password || '');
    const users = await store.get('nf:users', {});
    const u = users[name];
    if (!u) return res.status(401).json({ error: 'Wrong username or password.' });
    const a = Buffer.from(hash(pw, u.salt)), b = Buffer.from(u.hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong username or password.' });
    res.json({ token: tokenFor(name), username: name });
  });

  r.get('/books', auth, async (req, res) => {
    res.json(await store.get('nf:idx:' + req.nfUser, {}));
  });

  r.get('/books/:id', auth, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const b = await store.get(`nf:b:${req.nfUser}:${req.params.id}`);
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.json(b);
  });

  r.put('/books/:id', auth, async (req, res) => {
    const id = req.params.id, book = req.body && req.body.book;
    if (!validId(id) || !book || book.id !== id || typeof book.updatedAt !== 'number') return res.status(400).json({ error: 'Bad book' });
    await store.set(`nf:b:${req.nfUser}:${id}`, book);
    await store.update('nf:idx:' + req.nfUser, {}, (idx) => { idx[id] = { updatedAt: book.updatedAt, deleted: !!book.deleted }; return idx; });
    res.json({ ok: true });
  });

  // Proofreading: forwards text to LanguageTool (set LT_URL to use your own server)
  const LT = (process.env.LT_URL || 'https://api.languagetool.org/v2/check').trim();
  r.post('/proofread', slow(40, 6e4), async (req, res) => {
    const text = String(req.body.text || '').slice(0, 20000);
    const language = /^[a-z]{2}(-[A-Z]{2})?$|^auto$/.test(req.body.language || '') ? req.body.language : 'en-US';
    if (!text.trim()) return res.json({ matches: [] });
    try {
      const body = new URLSearchParams({ text, language, level: 'default' });
      const lt = await fetch(LT, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (lt.status === 429) return res.status(429).json({ error: 'The proofreader is busy. Try again in a minute.' });
      if (!lt.ok) return res.status(502).json({ error: "The proofreader didn't answer. Try again soon." });
      const j = await lt.json();
      res.json({ matches: (j.matches || []).map((m) => ({
        offset: m.offset, length: m.length, message: m.message, short: m.shortMessage || '',
        replacements: (m.replacements || []).slice(0, 5).map((x) => x.value),
        type: m.rule?.issueType || '', category: m.rule?.category?.id || '', rule: m.rule?.id || ''
      })) });
    } catch (e) {
      console.warn('[proofread]', e.message);
      res.status(502).json({ error: "The proofreader didn't answer. Try again soon." });
    }
  });

  return r;
};
