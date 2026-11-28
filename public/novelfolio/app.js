import { ICONS } from './icons.js';
import { db } from './db.js';
import { epub, docx, printBook, backup, deliver } from './export.js';
import { sync, signIn, signOut, getAccount, onSync, syncState, merge } from './sync.js';

// ---------- small helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const uid = (n = 12) => { const a = crypto.getRandomValues(new Uint8Array(n)); return Array.from(a, (x) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[x % 62]).join(''); };
const fmt = (n) => Number(n || 0).toLocaleString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const countWords = (text) => (text.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
const wordsOfHtml = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return countWords(d.textContent || ''); };
const totalWords = (b) => b.chapters.reduce((n, c) => n + (c.words || 0), 0);
const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
const COVERS = ['oxblood', 'forest', 'navy', 'ochre', 'plum', 'slate', 'linen'];
const ROMAN = (n) => { const m = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s; };
const timeAgo = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today, ' + time;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday, ' + time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
};

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('in'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('in'), 2200); }

// ---------- store ----------
const cache = new Map();
let loaded = false;
const store = {
  async load() { if (loaded) return; (await db.allBooks()).forEach((b) => cache.set(b.id, b)); loaded = true; },
  async all() { await store.load(); return [...cache.values()]; },
  get: (id) => cache.get(id),
  async save(b) { cache.set(b.id, b); await db.putBook(b); }
};
let syncTimer;
function scheduleSync(ms = 3000) { if (!getAccount()) return; clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); }
async function runSync() { try { const changed = await sync(store); if (changed && !editing()) render(); } catch {} }
const editing = () => !!$('.page[contenteditable]');

async function commit(b, { meta = false } = {}) {
  b.updatedAt = Date.now(); if (meta) b.metaAt = b.updatedAt;
  await store.save(b); scheduleSync();
}
const shelf = () => [...cache.values()].filter((b) => !b.deleted).sort((a, b) => b.updatedAt - a.updatedAt);

function newBook({ title, author, cover, coverImage }) {
  const now = Date.now();
  return { id: uid(), uid: crypto.randomUUID?.() || uid(24), title, author, cover, coverImage, notes: '', goal: { on: false, daily: 500, total: 50000 }, chapters: [], tombstones: [], createdAt: now, updatedAt: now, metaAt: now };
}
function newChapter() { return { id: uid(), title: '', html: '', notes: '', words: 0, updatedAt: Date.now() }; }

// daily goal tracking (per device)
async function dayStart(b) {
  const k = 'day:' + b.id; let d = await db.getMeta(k);
  if (!d || d.date !== today()) { d = { date: today(), start: totalWords(b) }; await db.setMeta(k, d); }
  return d.start;
}

// ---------- images ----------
function pickImage() {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = () => res(i.files[0] || null); i.click();
  });
}
async function compress(file, max = 1600, q = .85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  } finally { URL.revokeObjectURL(url); }
}

// ---------- sheets ----------
function sheet({ title = '', body = '', tall = false, onMount, onClose }) {
  const root = $('#sheet-root');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('div'); el.className = 'sheet' + (tall ? ' tall' : '');
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="grab"></div><div class="sh"><h3>${esc(title)}</h3><button class="ib" data-x aria-label="Close">${icon('x')}</button></div><div class="sb">${body}</div>`;
  root.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('in'); el.classList.add('in'); });
  let closed = false;
  const close = () => {
    if (closed) return; closed = true; onClose?.();
    scrim.classList.remove('in'); el.classList.remove('in');
    setTimeout(() => { scrim.remove(); el.remove(); }, 320);
  };
  scrim.onclick = close; $('[data-x]', el).onclick = close;
  // drag down to close
  let y0 = null;
  $('.grab', el).parentElement.addEventListener('touchstart', (e) => { if (e.target.closest('.sb')) return; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) el.style.transform = `translateY(${dy}px)`; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; el.style.transform = ''; if (dy > 90) close(); });
  onMount?.($('.sb', el), close, el);
  return close;
}
function menu(title, items) {
  return sheet({
    title,
    body: `<div class="menu">${items.map((it, i) => `<button data-i="${i}" class="${it.red ? 'red' : ''}">${icon(it.icon)}${esc(it.label)}</button>`).join('')}</div>`,
    onMount: (sb, close) => $$('[data-i]', sb).forEach((b) => b.onclick = () => { close(); setTimeout(() => items[b.dataset.i].run(), 120); })
  });
}
function confirmSheet(title, text, label, run) {
  sheet({ title, body: `<p class="hint">${esc(text)}</p><button class="btn danger wide" data-go>${esc(label)}</button>`, onMount: (sb, close) => { $('[data-go]', sb).onclick = () => { close(); run(); }; } });
}

// ---------- cover ----------
function coverHtml(b, { label = true } = {}) {
  if (b.coverImage) return `<div class="cover"><img src="${b.coverImage}" alt=""></div>`;
  return `<div class="cover cv-${b.cover || 'oxblood'}"><div class="frame">${label ? `<b>${esc(b.title || 'Untitled')}</b><i></i>${b.author ? `<span>${esc(b.author)}</span>` : ''}` : ''}</div></div>`;
}

function bookSheet(existing) {
  const draft = existing ? { title: existing.title, author: existing.author, cover: existing.cover, coverImage: existing.coverImage } : { title: '', author: '', cover: COVERS[Math.floor(Math.random() * 6)], coverImage: '' };
  sheet({
    title: existing ? 'Book details' : 'New book',
    body: `
      <label class="field"><span>Title</span><input data-f="title" maxlength="120" placeholder="Untitled" value="${esc(draft.title)}" autocomplete="off"></label>
      <label class="field"><span>Author</span><input data-f="author" maxlength="80" placeholder="Your name" value="${esc(draft.author)}" autocomplete="off"></label>
      <div class="field"><span>Cover</span>
        <div class="coverpick"><div data-prev></div><div class="btns">
          <button class="btn soft" data-up>${icon('image')}${draft.coverImage ? 'Change photo' : 'Upload photo'}</button>
          <button class="btn soft" data-rm ${draft.coverImage ? '' : 'hidden'}>${icon('x')}Remove photo</button>
        </div></div>
      </div>
      <div class="field" data-cloth ${draft.coverImage ? 'hidden' : ''}><span>Cloth</span><div class="swatches">${COVERS.map((c) => `<button class="sw cv-${c}${c === draft.cover ? ' on' : ''}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div></div>
      <button class="btn wide" data-save>${existing ? 'Save' : 'Start writing'}</button>`,
    onMount(sb, close) {
      const prev = () => { $('[data-prev]', sb).innerHTML = coverHtml(draft); $('[data-rm]', sb).hidden = !draft.coverImage; $('[data-cloth]', sb).hidden = !!draft.coverImage; $('[data-up]', sb).lastChild.textContent = draft.coverImage ? 'Change photo' : 'Upload photo'; };
      prev();
      $$('[data-f]', sb).forEach((i) => i.oninput = () => { draft[i.dataset.f] = i.value; prev(); });
      $$('[data-c]', sb).forEach((s) => s.onclick = () => { draft.cover = s.dataset.c; $$('[data-c]', sb).forEach((x) => x.classList.toggle('on', x === s)); prev(); });
      $('[data-up]', sb).onclick = async () => { const f = await pickImage(); if (!f) return; try { draft.coverImage = await compress(f, 1200, .86); prev(); } catch { toast("That image couldn't be opened"); } };
      $('[data-rm]', sb).onclick = () => { draft.coverImage = ''; prev(); };
      if (!existing) setTimeout(() => $('[data-f=title]', sb).focus(), 350);
      $('[data-save]', sb).onclick = async () => {
        draft.title = draft.title.trim(); draft.author = draft.author.trim();
        if (existing) { Object.assign(existing, draft); await commit(existing, { meta: true }); close(); render(); return; }
        const b = newBook({ ...draft, title: draft.title || 'Untitled' });
        await commit(b, { meta: true }); navigator.storage?.persist?.();
        close(); go(`/b/${b.id}`);
      };
    }
  });
}

// ---------- router ----------
const go = (path) => { location.hash = '#' + path; };
let cleanup = null;
async function render() {
  await store.load();
  if (cleanup) { const c = cleanup; cleanup = null; await c(); }
  $$('#sheet-root > *').forEach((e) => e.remove());
  document.body.classList.remove('focus', 'kb', 'editing');
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'b' && parts[1]) {
    const b = store.get(parts[1]);
    if (!b || b.deleted) return go('/');
    if (parts[2] === 'c' && parts[3]) return editorView(b, parts[3]);
    if (parts[2] === 'read') return readerView(b);
    return bookView(b);
  }
  libraryView();
}
addEventListener('hashchange', render);

// ---------- library ----------
function syncIcon() {
  if (!getAccount()) return '';
  const s = syncState.status;
  return `<button class="ib${s === 'error' ? ' dim' : ''}" data-sync aria-label="Sync now">${icon(s === 'error' ? 'cloud-off' : s === 'busy' ? 'refresh-cw' : 'cloud')}</button>`;
}
function libraryView() {
  document.title = 'Novelfolio';
  const books = shelf();
  app.innerHTML = `<div class="lib">
    <div class="lib-head"><div class="word">Novel<i>folio</i></div><span data-syncslot>${syncIcon()}</span><button class="ib" data-set aria-label="Settings">${icon('settings-2')}</button></div>
    ${books.length ? `<div class="shelf">${books.map((b) => `<a class="bk" href="#/b/${b.id}">${coverHtml(b)}<div class="meta"><b>${esc(b.title || 'Untitled')}</b><span>${b.chapters.length ? plural(b.chapters.length, 'chapter') : 'No chapters yet'}</span></div></a>`).join('')}
      <button class="bk newbk" data-new><div class="cover">${icon('plus')}</div><div class="meta"><b>New book</b></div></button></div>`
    : `<div class="empty"><h2>A blank first page.</h2><p>Name your book, pick a cover, and add chapters as you go.</p><button class="btn" data-new>${icon('book-plus')}Start a book</button></div>`}
  </div>`;
  $$('[data-new]').forEach((b) => b.onclick = () => bookSheet());
  $('[data-set]').onclick = settingsSheet;
  const wire = () => { const s = $('[data-sync]'); if (s) s.onclick = () => runSync(); };
  wire();
  cleanup = onSync(() => { const slot = $('[data-syncslot]'); if (slot) { slot.innerHTML = syncIcon(); wire(); } });
}

// ---------- settings ----------
function applyTheme() {
  const t = localStorage.getItem('nf_theme') || 'auto';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $$('meta[name=theme-color]').forEach((m) => m.setAttribute('content', dark ? '#16110d' : '#ece2cc'));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
function themeSeg() {
  const t = localStorage.getItem('nf_theme') || 'auto';
  return `<div class="seg" data-theme-seg>${[['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['auto', 'sun-moon', 'Auto']].map(([v, i, l]) => `<button data-v="${v}" class="${t === v ? 'on' : ''}">${icon(i)}${l}</button>`).join('')}</div>`;
}
function wireLook(sb) {
  $$('[data-theme-seg] button', sb).forEach((b) => b.onclick = () => { localStorage.setItem('nf_theme', b.dataset.v); applyTheme(); $$('[data-theme-seg] button', sb).forEach((x) => x.classList.toggle('on', x === b)); });
  const r = $('[data-size]', sb);
  if (r) r.oninput = () => { document.documentElement.style.setProperty('--fs', r.value + 'px'); localStorage.setItem('nf_size', r.value); };
}
const sizeVal = () => parseInt(localStorage.getItem('nf_size') || '18', 10);
const lookBody = () => `
  <div class="field"><span>Appearance</span>${themeSeg()}</div>
  <div class="field"><span>Text size</span><input type="range" min="15" max="24" step="1" value="${sizeVal()}" data-size></div>`;

function settingsSheet() {
  sheet({
    title: 'Settings', tall: false,
    body: `${lookBody()}<div class="field"><span>Account</span><div data-acct></div></div>
      <div class="field"><span>Backup</span><button class="btn soft wide" data-import>${icon('download')}Import a backup file</button></div>`,
    onMount(sb, close) {
      wireLook(sb);
      const acct = $('[data-acct]', sb);
      const draw = () => {
        const a = getAccount();
        if (a) {
          acct.innerHTML = `<div class="row"><div class="lbl">${esc(a.username)}<small>Your books sync to every device you sign in on.</small></div></div>
            <div class="acts" style="margin:6px 0 0"><button class="btn soft" data-now>${icon('refresh-cw')}Sync now</button><button class="btn soft" data-out>${icon('log-out')}Sign out</button></div>`;
          $('[data-now]', acct).onclick = async () => { try { await sync(store); toast('Up to date'); } catch (e) { toast(e.message); } };
          $('[data-out]', acct).onclick = () => { signOut(); draw(); toast('Signed out. Your books stay on this device.'); };
        } else {
          acct.innerHTML = `<p class="hint">Sign in to keep your books on your phone, laptop, and anywhere else.</p>
            <label class="field"><input data-u placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
            <label class="field"><input data-p type="password" placeholder="Password" autocomplete="current-password"></label>
            <p class="err" data-err hidden></p>
            <div class="acts" style="margin:0"><button class="btn" data-in>Sign in</button><button class="btn soft" data-up>Create account</button></div>`;
          const doIt = async (mode) => {
            const err = $('[data-err]', acct); err.hidden = true;
            try { await signIn(mode, $('[data-u]', acct).value, $('[data-p]', acct).value); draw(); toast('Syncing your books'); await sync(store); render(); }
            catch (e) { err.textContent = e.message; err.hidden = false; }
          };
          $('[data-in]', acct).onclick = () => doIt('login');
          $('[data-up]', acct).onclick = () => doIt('signup');
        }
      };
      draw();
      $('[data-import]', sb).onclick = async () => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
        i.onchange = async () => {
          try {
            const j = JSON.parse(await i.files[0].text()); const b = j.book;
            if (!j.novelfolio || !b?.id || !Array.isArray(b.chapters)) throw 0;
            const merged = merge(store.get(b.id), { ...b, deleted: false }); merged.deleted = false;
            await commit(merged, { meta: true }); close(); toast(`Imported "${merged.title}"`); render();
          } catch { toast("That file isn't a Novelfolio backup"); }
        };
        i.click();
      };
    }
  });
}

// ---------- book ----------
async function bookView(b) {
  document.title = b.title + ' · Novelfolio';
  const total = totalWords(b);
  const start = b.goal?.on ? await dayStart(b) : 0;
  const todayW = Math.max(0, total - start);
  app.innerHTML = `
  <div class="bar"><a class="ib" href="#/" aria-label="Library">${icon('chevron-left')}</a><div class="grow"></div>
    <button class="ib" data-search aria-label="Search">${icon('search')}</button>
    <button class="ib" data-notes aria-label="Notes">${icon('notebook-pen')}</button>
    <button class="ib" data-more aria-label="More">${icon('ellipsis')}</button></div>
  <div class="bookv">
    <div class="bhead"><button data-edit aria-label="Edit book details">${coverHtml(b)}</button>
      <div><h1>${esc(b.title || 'Untitled')}</h1>${b.author ? `<div class="by">${esc(b.author)}</div>` : ''}
      <div class="stat">${b.chapters.length ? `${plural(b.chapters.length, 'chapter')} · ${plural(total, 'word')}` : 'No chapters yet'}</div></div></div>
    <div class="acts"><button class="btn" data-add>${icon('plus')}Add chapter</button>${b.chapters.length ? `<a class="btn soft" href="#/b/${b.id}/read">${icon('book-open')}Read</a>` : ''}</div>
    ${b.goal?.on ? goalCard(b, todayW, total) : ''}
    <div class="contents">${b.chapters.length ? `<h2>Contents</h2><div class="orn">· ⁂ ·</div><div data-list>${b.chapters.map((c, i) => `
      <div class="ch" data-id="${c.id}"><a href="#/b/${b.id}/c/${c.id}"><span class="n">${ROMAN(i + 1)}</span><span class="nm${c.title ? '' : ' u'}">${esc(c.title || 'Untitled')}</span><span class="dots"></span><span class="w">${fmt(c.words)}</span></a><span class="grip" aria-label="Drag to reorder">${icon('grip-vertical')}</span></div>`).join('')}</div>
      ${b.chapters.length > 6 ? `<div class="addrow"><button class="btn soft" data-add>${icon('plus')}Add chapter</button></div>` : ''}` : `<p class="noch">Your first chapter is one tap away.</p>`}</div>
  </div>`;
  $$('[data-add]').forEach((x) => x.onclick = async () => { const c = newChapter(); b.chapters.push(c); await commit(b); go(`/b/${b.id}/c/${c.id}`); });
  $('[data-edit]').onclick = () => bookSheet(b);
  $('[data-notes]').onclick = () => notesSheet(b, null);
  $('[data-search]').onclick = () => searchSheet(b);
  $('[data-more]').onclick = () => menu(b.title || 'Book', [
    { icon: 'pencil', label: 'Book details & cover', run: () => bookSheet(b) },
    { icon: 'target', label: 'Writing goal', run: () => goalSheet(b) },
    { icon: 'share', label: 'Export', run: () => exportSheet(b) },
    { icon: 'trash-2', label: 'Delete book', red: true, run: () => confirmSheet('Delete this book?', `"${b.title}" and all ${plural(b.chapters.length, 'chapter')} will be gone. Export a backup first if you might want it later.`, 'Delete book', async () => { b.deleted = true; b.chapters = []; b.coverImage = ''; b.notes = ''; await commit(b, { meta: true }); toast('Book deleted'); go('/'); }) }
  ]);
  const g = $('[data-goal]'); if (g) g.onclick = () => goalSheet(b);
  const list = $('[data-list]'); if (list) reorder(list, b);
}
function goalCard(b, todayW, total) {
  const d = b.goal.daily || 0, t = b.goal.total || 0;
  const p = d ? Math.min(100, Math.round(todayW / d * 100)) : 0;
  return `<button class="goal" data-goal style="width:100%;text-align:left"><div class="ring" style="--p:${p}">${p >= 100 ? icon('check') : ''}</div><div><b>${fmt(todayW)}${d ? ` of ${fmt(d)}` : ''} words today</b>${t ? `<span>${fmt(total)} of ${fmt(t)} for the book · ${Math.min(100, Math.round(total / t * 100))}%</span>` : ''}</div></button>`;
}
function goalSheet(b) {
  const g = b.goal || (b.goal = { on: false, daily: 500, total: 50000 });
  sheet({
    title: 'Writing goal',
    body: `<div class="row"><div class="lbl">Track a goal for this book</div><button class="toggle${g.on ? ' on' : ''}" data-on role="switch" aria-checked="${g.on}"></button></div>
      <div data-fields ${g.on ? '' : 'hidden'} style="margin-top:12px">
      <label class="field"><span>Words per day</span><input type="number" inputmode="numeric" min="0" data-d value="${g.daily || ''}" placeholder="500"></label>
      <label class="field"><span>Words for the whole book</span><input type="number" inputmode="numeric" min="0" data-t value="${g.total || ''}" placeholder="50000"></label></div>
      <button class="btn wide" data-save>Done</button>`,
    onMount(sb, close) {
      let on = g.on;
      $('[data-on]', sb).onclick = (e) => { on = !on; e.currentTarget.classList.toggle('on', on); e.currentTarget.setAttribute('aria-checked', on); $('[data-fields]', sb).hidden = !on; };
      $('[data-save]', sb).onclick = async () => {
        b.goal = { on, daily: Math.max(0, parseInt($('[data-d]', sb).value, 10) || 0), total: Math.max(0, parseInt($('[data-t]', sb).value, 10) || 0) };
        await commit(b, { meta: true }); close(); render();
      };
    }
  });
}
function exportSheet(b) {
  if (!b.chapters.length) return toast('Add a chapter first');
  menu('Export', [
    { icon: 'book-open', label: 'EPUB ebook', run: () => deliver(epub(b)) },
    { icon: 'file-text', label: 'PDF', run: () => printBook(b) },
    { icon: 'type', label: 'Word document (.docx)', run: async () => deliver(await docx(b)) },
    { icon: 'download', label: 'Backup file', run: () => deliver(backup(b)) }
  ]);
}

// drag to reorder chapters
function reorder(list, b) {
  $$('.grip', list).forEach((grip) => {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const row = grip.closest('.ch'), rows = $$('.ch', list), from = rows.indexOf(row);
      const h = row.getBoundingClientRect().height, y0 = e.clientY; let to = from;
      grip.setPointerCapture(e.pointerId); row.classList.add('drag');
      rows.forEach((r) => r !== row && r.classList.add('shift'));
      navigator.vibrate?.(8);
      const move = (ev) => {
        const dy = ev.clientY - y0; row.style.transform = `translateY(${dy}px)`;
        to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
        rows.forEach((r, i) => { if (r === row) return; let s = 0; if (from < to && i > from && i <= to) s = -h; if (from > to && i < from && i >= to) s = h; r.style.transform = s ? `translateY(${s}px)` : ''; });
      };
      const up = async () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        rows.forEach((r) => { r.style.transform = ''; r.classList.remove('shift', 'drag'); });
        if (to !== from) { const [c] = b.chapters.splice(from, 1); b.chapters.splice(to, 0, c); await commit(b, { meta: true }); render(); }
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
  });
}

// ---------- notes ----------
function notesSheet(b, chapter, onChange) {
  let tab = chapter ? 'chapter' : 'book';
  sheet({
    title: 'Notes', tall: true,
    body: `${chapter ? `<div class="seg"><button data-t="chapter" class="on">This chapter</button><button data-t="book">Whole book</button></div>` : ''}<textarea class="notes" data-n></textarea>`,
    onMount(sb) {
      sb.classList.add('fill');
      const ta = $('[data-n]', sb);
      const load = () => { ta.value = tab === 'chapter' ? chapter.notes || '' : b.notes || ''; ta.placeholder = tab === 'chapter' ? 'Ideas, reminders, what happens next…' : 'Characters, places, plot threads…'; };
      load();
      let t;
      ta.oninput = () => {
        if (tab === 'chapter') { chapter.notes = ta.value; chapter.updatedAt = Date.now(); } else { b.notes = ta.value; b.metaAt = Date.now(); }
        clearTimeout(t); t = setTimeout(() => { commit(b); onChange?.(); }, 500);
      };
      $$('[data-t]', sb).forEach((x) => x.onclick = () => { tab = x.dataset.t; $$('[data-t]', sb).forEach((y) => y.classList.toggle('on', y === x)); load(); });
    },
    onClose: () => commit(b)
  });
}

// ---------- search ----------
let pendingFind = '';
function searchSheet(b) {
  sheet({
    title: 'Search', tall: true,
    body: `<div class="searchin">${icon('search')}<input data-q placeholder="Find in this book" enterkeyhint="search" autocomplete="off"></div><div data-res></div>`,
    onMount(sb, close) {
      const q = $('[data-q]', sb), res = $('[data-res]', sb);
      setTimeout(() => q.focus(), 350);
      const texts = b.chapters.map((c) => { const d = document.createElement('div'); d.innerHTML = c.html; return d.textContent || ''; });
      q.oninput = () => {
        const term = q.value.trim(); if (term.length < 2) { res.innerHTML = ''; return; }
        const low = term.toLowerCase(); const out = [];
        b.chapters.forEach((c, i) => {
          const t = texts[i], tl = t.toLowerCase(); let at = tl.indexOf(low), n = 0; const first = at;
          while (at >= 0) { n++; at = tl.indexOf(low, at + low.length); }
          const inTitle = (c.title || '').toLowerCase().includes(low);
          if (!n && !inTitle) return;
          let snip = '';
          if (first >= 0) { const s = Math.max(0, first - 50); snip = (s ? '…' : '') + esc(t.slice(s, first)) + '<mark>' + esc(t.slice(first, first + term.length)) + '</mark>' + esc(t.slice(first + term.length, first + term.length + 80)) + '…'; }
          out.push(`<button class="sres" data-c="${c.id}"><b>${ROMAN(i + 1)}. ${esc(c.title || 'Untitled')}${n > 1 ? ` <span style="color:var(--ink3);font-size:15px">· ${n} matches</span>` : ''}</b>${snip ? `<p>${snip}</p>` : ''}</button>`);
        });
        res.innerHTML = out.join('') || `<p class="hint" style="margin-top:12px">Nothing found for "${esc(term)}".</p>`;
        $$('[data-c]', res).forEach((x) => x.onclick = () => { pendingFind = term; close(); go(`/b/${b.id}/c/${x.dataset.c}`); });
      };
    }
  });
}
function highlight(page, term) {
  const low = term.toLowerCase();
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) {
    const i = n.textContent.toLowerCase().indexOf(low);
    if (i < 0) continue;
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + term.length);
    const m = document.createElement('mark'); r.surroundContents(m);
    m.scrollIntoView({ block: 'center' });
    setTimeout(() => { if (m.parentNode) { m.replaceWith(...m.childNodes); } }, 3500);
    return;
  }
}

// ---------- paste cleanup ----------
const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'HR', 'FIGURE', 'IMG']);
function sanitize(html) {
  const d = new DOMParser().parseFromString(html, 'text/html').body;
  const walk = (el) => {
    Array.from(el.childNodes).forEach((n) => {
      if (n.nodeType === 8) return n.remove();
      if (n.nodeType !== 1) return;
      let t = n.tagName;
      if (t === 'H1') { const h = document.createElement('h2'); h.append(...n.childNodes); n.replaceWith(h); n = h; t = 'H2'; }
      if (/^H[4-6]$/.test(t)) { const h = document.createElement('h3'); h.append(...n.childNodes); n.replaceWith(h); n = h; t = 'H3'; }
      if (t === 'DIV') { const p = document.createElement('p'); p.append(...n.childNodes); n.replaceWith(p); n = p; t = 'P'; }
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'IFRAME', 'OBJECT', 'SVG', 'VIDEO', 'AUDIO', 'TITLE'].includes(t)) return n.remove();
      if (!ALLOWED.has(t)) { walk(n); n.replaceWith(...n.childNodes); return; }
      const align = n.style?.textAlign; const src = n.getAttribute('src'); const cls = n.getAttribute('class');
      Array.from(n.attributes).forEach((a) => n.removeAttribute(a.name));
      if (t === 'IMG') { if (src && /^(data:image\/|https:)/.test(src)) n.setAttribute('src', src); else return n.remove(); }
      if (t === 'FIGURE' && /^(s|m|l|f)$/.test(cls || '')) n.className = cls;
      if (['P', 'H2', 'H3'].includes(t) && ['center', 'right', 'justify'].includes(align)) n.style.textAlign = align;
      walk(n);
    });
  };
  walk(d);
  d.querySelectorAll('img').forEach((im) => { if (im.parentElement.tagName !== 'FIGURE') { const f = document.createElement('figure'); f.className = 'm'; im.replaceWith(f); f.append(im); } });
  return d.innerHTML;
}
const BLOCKS = /^(P|H2|H3|BLOCKQUOTE|UL|OL|HR|FIGURE)$/;
function wrapLoose(root) {
  // browsers sometimes nest lists or breaks inside a <p>; lift them back out
  let bad;
  while ((bad = Array.from(root.querySelectorAll('p')).find((x) => Array.from(x.children).some((k) => BLOCKS.test(k.tagName))))) bad.replaceWith(...bad.childNodes);
  let p = null;
  Array.from(root.childNodes).forEach((n) => {
    const block = n.nodeType === 1 && BLOCKS.test(n.tagName);
    if (block || (n.nodeType === 3 && !n.textContent.trim() && !p)) { p = null; return; }
    if (n.nodeType === 1 && n.tagName === 'DIV') { const q = document.createElement('p'); q.append(...n.childNodes); n.replaceWith(q); p = null; return; }
    if (!p) { p = document.createElement('p'); n.before(p); }
    p.append(n);
  });
}
const cleanHtml = (page) => {
  const c = page.cloneNode(true);
  wrapLoose(c);
  c.querySelectorAll('mark').forEach((m) => m.replaceWith(...m.childNodes));
  const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let tn; const zs = [];
  while ((tn = tw.nextNode())) if (tn.data.includes('\u200B')) zs.push(tn);
  zs.forEach((t) => { t.data = t.data.replace(/\u200B/g, ''); });
  c.querySelectorAll('b,strong,i,em,u,s').forEach((x) => { if (!x.textContent && !x.querySelector('img,br')) x.remove(); });
  c.querySelectorAll('figure.sel').forEach((f) => f.classList.remove('sel'));
  c.querySelectorAll('[class=""]').forEach((x) => x.removeAttribute('class'));
  const h = c.innerHTML.trim();
  return h === '<br>' || h === '<p><br></p>' ? '' : h;
};

// ---------- editor ----------
async function editorView(b, cid) {
  let idx = b.chapters.findIndex((c) => c.id === cid);
  if (idx < 0) return go(`/b/${b.id}`);
  const c = b.chapters[idx];
  document.title = (c.title || `Chapter ${idx + 1}`) + ' · ' + b.title;
  const start = b.goal?.on ? await dayStart(b) : 0;
  const last = idx === b.chapters.length - 1;
  app.innerHTML = `<div class="edwrap" data-wrap>
  <div class="bar"><a class="ib" href="#/b/${b.id}" aria-label="Back to contents">${icon('chevron-left')}</a><div class="grow tt"><b>${esc(b.title)}</b><span data-wc></span></div>
    ${b.goal?.on && b.goal.daily ? `<button class="ib" data-goal aria-label="Today's goal"><div class="ring" data-ring style="--p:0;width:28px;height:28px"></div></button>` : ''}
    <button class="ib" data-proof aria-label="Proofread">${icon('spell-check')}</button>
    <button class="ib" data-notes aria-label="Notes">${icon('notebook-pen')}</button>
    <button class="ib" data-more aria-label="More">${icon('ellipsis')}</button></div>
  <div class="edscroll" data-scroll><div class="ed">
    <div class="chlabel">Chapter ${ROMAN(idx + 1)}</div>
    <textarea class="chtitle" data-title rows="1" placeholder="Untitled" maxlength="140" enterkeyhint="next">${esc(c.title)}</textarea>
    <div class="flr">⁂</div>
    <div class="page" contenteditable="true" spellcheck="true" data-ph="Begin here…" role="textbox" aria-multiline="true" aria-label="Chapter text">${c.html}</div>
    <div class="endnav"><button data-prev ${idx ? '' : 'disabled'}>${icon('chevron-left')}${idx ? 'Previous' : ''}</button>
      <button data-next>${last ? `${icon('plus')}New chapter` : `Next${icon('chevron-right')}`}</button></div>
  </div></div>
  <div class="tools" data-tools>
    <button class="ib" data-cmd="undo" aria-label="Undo">${icon('undo-2')}</button>
    <button class="ib" data-cmd="redo" aria-label="Redo">${icon('redo-2')}</button><span class="sep"></span>
    <button class="ib" data-cmd="h2" aria-label="Heading">${icon('heading-2')}</button>
    <button class="ib" data-cmd="bold" aria-label="Bold">${icon('bold')}</button>
    <button class="ib" data-cmd="italic" aria-label="Italic">${icon('italic')}</button>
    <button class="ib" data-cmd="underline" aria-label="Underline">${icon('underline')}</button>
    <button class="ib" data-cmd="strikeThrough" aria-label="Strikethrough">${icon('strikethrough')}</button><span class="sep"></span>
    <button class="ib" data-cmd="blockquote" aria-label="Quote">${icon('text-quote')}</button>
    <button class="ib" data-cmd="insertUnorderedList" aria-label="Bullet list">${icon('list')}</button>
    <button class="ib" data-cmd="insertOrderedList" aria-label="Numbered list">${icon('list-ordered')}</button>
    <button class="ib" data-cmd="justifyCenter" aria-label="Center">${icon('align-center')}</button>
    <button class="ib" data-cmd="break" aria-label="Scene break">${icon('separator-horizontal')}</button>
    <button class="ib" data-cmd="image" aria-label="Insert image">${icon('image')}</button>
  </div></div>`;
  const page = $('.page'), title = $('[data-title]'), wc = $('[data-wc]'), tools = $('[data-tools]');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
  const fit = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  fit();

  // saving + versions
  let saveT, dirty = false, firstEdit = true, lastSnap = Date.now(), snapHtml = c.html;
  const latest = async () => (await db.versions(c.id)).sort((x, y) => y.at - x.at)[0];
  const snapshot = async (html) => { if (!html) return; const l = await latest(); if (l && l.html === html) return; await db.addVersion({ id: uid(), chapterId: c.id, bookId: b.id, at: Date.now(), html, words: wordsOfHtml(html) }); };
  const updateCount = () => {
    const tw = totalWords(b);
    wc.textContent = plural(c.words, 'word');
    const r = $('[data-ring]'); if (r) r.style.setProperty('--p', Math.min(100, Math.round(Math.max(0, tw - start) / b.goal.daily * 100)));
  };
  const save = async () => {
    clearTimeout(saveT); if (!dirty) return; dirty = false;
    const html = cleanHtml(page);
    c.html = html; c.title = title.value.trim(); c.words = countWords(page.innerText || ''); c.updatedAt = Date.now();
    await commit(b);
    if (Date.now() - lastSnap > 5 * 60e3 && html !== snapHtml) { lastSnap = Date.now(); snapHtml = html; snapshot(html); }
  };
  const changed = () => {
    if (firstEdit) { firstEdit = false; snapshot(c.html); }
    dirty = true; c.words = countWords(page.innerText || ''); updateCount();
    clearTimeout(saveT); saveT = setTimeout(save, 700);
  };
  updateCount();
  page.addEventListener('focus', () => { if (!page.textContent.trim() && !page.querySelector('img,hr')) { page.innerHTML = '<p><br></p>'; placeCaret(page.firstChild, true); } });
  page.addEventListener('blur', () => { if (!page.textContent.trim() && !page.querySelector('img,hr')) page.innerHTML = ''; });
  page.addEventListener('input', changed);
  title.addEventListener('input', () => { fit(); changed(); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); page.focus(); placeCaret(page, false); } });
  page.addEventListener('paste', (e) => {
    const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
    const files = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (files.length && !html) { files.forEach(async (f) => insertImage(await compress(f))); return; }
    if (html) document.execCommand('insertHTML', false, sanitize(html));
    else document.execCommand('insertHTML', false, text.split(/\n{2,}|\r\n\r\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
  });
  page.addEventListener('drop', (e) => { const f = Array.from(e.dataTransfer.files).filter((x) => x.type.startsWith('image/')); if (f.length) { e.preventDefault(); f.forEach(async (x) => insertImage(await compress(x))); } });

  // toolbar
  let savedRange = null;
  const keepRange = () => { const s = getSelection(); if (document.activeElement === page && s.rangeCount && page.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); };
  document.addEventListener('selectionchange', onSel);
  function onSel() { keepRange(); refreshState(); }
  const blockOf = () => { const s = getSelection(); let n = s.anchorNode; while (n && n !== page) { if (n.nodeType === 1 && /^(P|H2|H3|BLOCKQUOTE|LI|FIGURE)$/.test(n.tagName)) return n; n = n.parentNode; } return null; };
  function refreshState() {
    if (!page.contains(getSelection().anchorNode)) return;
    const blk = blockOf(), inQuote = !!(blk && blk.closest('blockquote'));
    $$('[data-cmd]', tools).forEach((bt) => {
      const k = bt.dataset.cmd; let on = false;
      try {
        if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyCenter'].includes(k)) on = document.queryCommandState(k);
        else if (k === 'h2') on = !!(blk && blk.closest('h2'));
        else if (k === 'blockquote') on = inQuote;
      } catch {}
      bt.classList.toggle('on', on);
    });
  }
  function restore() { page.focus({ preventScroll: true }); if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); } }
  // keep the text selection when tapping the toolbar (iOS drops it on touchstart)
  ['pointerdown', 'mousedown', 'touchstart'].forEach((ev) => tools.addEventListener(ev, (e) => { if (e.target.closest('[data-cmd]')) e.preventDefault(); }, { passive: false }));
  tools.addEventListener('touchend', (e) => { const bt = e.target.closest('[data-cmd]'); if (!bt) return; e.preventDefault(); bt.click(); }, { passive: false });
  const INLINE = { bold: 'B,STRONG', italic: 'I,EM', underline: 'U', strikeThrough: 'S,STRIKE,DEL' };
  function toggleInline(k) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    if (!sel.isCollapsed) { document.execCommand(k); return; }
    const tags = INLINE[k].split(',');
    let n = sel.anchorNode;
    while (n && n !== page) { if (n.nodeType === 1 && tags.includes(n.tagName)) break; n = n.parentNode; }
    const put = (node, off) => { const r = document.createRange(); r.setStart(node, off); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); };
    if (n && n !== page) {
      // at the end of a formatted run: step out so the next words are plain
      const r = document.createRange(); r.selectNodeContents(n); r.setStart(sel.anchorNode, sel.anchorOffset);
      if (!r.toString().replace(/\u200B/g, '')) { const z = document.createTextNode('\u200B'); n.after(z); put(z, 1); return; }
      // inside the run: remove the formatting from the whole run
      const anchor = sel.anchorNode, off = sel.anchorOffset;
      n.replaceWith(...n.childNodes);
      try { put(anchor, off); } catch {}
      return;
    }
    // nothing selected: start formatting at the caret
    const el = document.createElement(tags[0].toLowerCase()); const z = document.createTextNode('\u200B'); el.append(z);
    sel.getRangeAt(0).insertNode(el); put(z, 1);
  }
  tools.addEventListener('click', async (e) => {
    const bt = e.target.closest('[data-cmd]'); if (!bt) return;
    const k = bt.dataset.cmd;
    if (k === 'image') { keepRange(); const f = await pickImage(); if (!f) return; try { insertImage(await compress(f)); } catch { toast("That image couldn't be opened"); } return; }
    restore();
    if (k === 'h2') { const on = !!blockOf()?.closest('h2'); document.execCommand('formatBlock', false, on ? 'p' : 'h2'); }
    else if (k === 'blockquote') { const on = !!blockOf()?.closest('blockquote'); document.execCommand('formatBlock', false, on ? 'p' : 'blockquote'); }
    else if (k === 'justifyCenter') { document.execCommand(document.queryCommandState('justifyCenter') ? 'justifyLeft' : 'justifyCenter'); }
    else if (k === 'break') document.execCommand('insertHTML', false, '<hr><p><br></p>');
    else if (INLINE[k]) toggleInline(k);
    else document.execCommand(k);
    changed(); refreshState();
  });
  function insertImage(src) {
    restore();
    const s = getSelection();
    if (!s.rangeCount || !page.contains(s.anchorNode)) placeCaret(page, false);
    document.execCommand('insertHTML', false, `<figure class="m"><img src="${src}" alt=""></figure><p><br></p>`);
    changed();
  }

  // image controls
  let bar = null, selFig = null;
  const closeBar = () => { bar?.remove(); bar = null; selFig?.classList.remove('sel'); selFig = null; };
  page.addEventListener('click', (e) => {
    const fig = e.target.closest('figure'); closeBar();
    if (!fig || e.target.tagName !== 'IMG') return;
    selFig = fig; fig.classList.add('sel');
    bar = document.createElement('div'); bar.className = 'imgbar'; bar.contentEditable = 'false';
    const sz = (fig.className.match(/\b(s|m|l|f)\b/) || [])[1] || 'm';
    bar.innerHTML = ['s', 'm', 'l', 'f'].map((k) => `<button data-s="${k}" class="${k === sz ? 'on' : ''}">${{ s: 'S', m: 'M', l: 'L', f: 'Full' }[k]}</button>`).join('') + `<button data-del aria-label="Remove image">${icon('trash-2')}</button>`;
    const r = fig.getBoundingClientRect(), er = $('.ed').getBoundingClientRect();
    bar.style.left = (r.left - er.left + r.width / 2) + 'px'; bar.style.top = (r.top - er.top - 52) + 'px';
    $('.ed').style.position = 'relative'; $('.ed').append(bar);
    bar.addEventListener('pointerdown', (ev) => ev.preventDefault());
    bar.onclick = (ev) => {
      const s = ev.target.closest('[data-s]'), d = ev.target.closest('[data-del]');
      if (s) { fig.className = s.dataset.s + ' sel'; $$('[data-s]', bar).forEach((x) => x.classList.toggle('on', x === s)); const nr = fig.getBoundingClientRect(); bar.style.top = (nr.top - $('.ed').getBoundingClientRect().top - 52) + 'px'; changed(); }
      if (d) { fig.remove(); closeBar(); changed(); }
    };
  });
  const outside = (e) => { if (bar && !e.target.closest('.imgbar') && !e.target.closest('figure')) closeBar(); };
  document.addEventListener('pointerdown', outside);

  // The editor fills exactly the visible area above the keyboard, so the toolbar
  // sits on the keyboard and only the writing area scrolls.
  const vv = window.visualViewport, wrap = $('[data-wrap]'), scroller = $('[data-scroll]');
  document.body.classList.add('editing');
  let raf = 0;
  const onVV = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const h = vv ? vv.height : innerHeight, top = vv ? vv.offsetTop : 0;
      wrap.style.height = h + 'px'; wrap.style.transform = `translateY(${top}px)`;
      document.body.classList.toggle('kb', innerHeight - h > 120);
      if (document.activeElement === page || document.activeElement === title) keepCaret();
    });
  };
  // keep the caret in view above the toolbar
  function keepCaret() {
    const sel = getSelection(); if (!sel.rangeCount || !scroller.contains(sel.anchorNode)) return;
    let rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.height) { const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement; rect = el.getBoundingClientRect(); }
    if (!rect.height) return;
    const box = scroller.getBoundingClientRect(), pad = 28;
    if (rect.bottom > box.bottom - pad) scroller.scrollTop += rect.bottom - box.bottom + pad + 12;
    else if (rect.top < box.top + pad) scroller.scrollTop -= box.top + pad - rect.top;
  }
  vv?.addEventListener('resize', onVV); vv?.addEventListener('scroll', onVV); addEventListener('resize', onVV); onVV();
  // iOS sometimes pans the whole page when the keyboard opens; pull it back
  const unpan = () => { if (scrollY) scrollTo(0, 0); };
  addEventListener('scroll', unpan);
  page.addEventListener('input', () => requestAnimationFrame(keepCaret));
  page.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key.startsWith('Arrow')) keepCaret(); });

  // nav + menus
  $('[data-prev]').onclick = () => idx && go(`/b/${b.id}/c/${b.chapters[idx - 1].id}`);
  $('[data-next]').onclick = async () => {
    if (!last) return go(`/b/${b.id}/c/${b.chapters[idx + 1].id}`);
    await save(); const n = newChapter(); b.chapters.push(n); await commit(b); go(`/b/${b.id}/c/${n.id}`);
  };
  $('[data-notes]').onclick = () => { save(); notesSheet(b, c); };
  $('[data-proof]').onclick = () => { closeBar(); proofSheet(b, page, changed); };
  const gb = $('[data-goal]'); if (gb) gb.onclick = () => toast(`${fmt(Math.max(0, totalWords(b) - start))} of ${fmt(b.goal.daily)} words today`);
  const focusOn = () => {
    document.body.classList.add('focus');
    const x = document.createElement('button'); x.className = 'ib focusx'; x.setAttribute('aria-label', 'Leave focus mode'); x.innerHTML = icon('minimize-2');
    x.onclick = () => { document.body.classList.remove('focus'); x.remove(); }; document.body.append(x);
    page.focus();
  };
  $('[data-more]').onclick = () => { save(); menu(c.title || `Chapter ${idx + 1}`, [
    { icon: 'spell-check', label: 'Proofread chapter', run: () => proofSheet(b, page, changed) },
    { icon: 'maximize-2', label: 'Focus mode', run: focusOn },
    { icon: 'history', label: 'Earlier versions', run: () => versionsSheet(b, c, (html) => { page.innerHTML = html; dirty = true; save(); updateCount(); }) },
    { icon: 'a-large-small', label: 'Text & appearance', run: () => sheet({ title: 'Text & appearance', body: lookBody(), onMount: wireLook }) },
    { icon: 'copy', label: 'Duplicate chapter', run: async () => { const d = { ...newChapter(), title: (c.title || 'Untitled') + ' (copy)', html: c.html, notes: c.notes, words: c.words }; b.chapters.splice(idx + 1, 0, d); await commit(b, { meta: true }); toast('Chapter duplicated'); go(`/b/${b.id}/c/${d.id}`); } },
    { icon: 'arrow-up', label: 'Move up', run: async () => { if (!idx) return; b.chapters.splice(idx, 1); b.chapters.splice(idx - 1, 0, c); await commit(b, { meta: true }); render(); } },
    { icon: 'arrow-down', label: 'Move down', run: async () => { if (last) return; b.chapters.splice(idx, 1); b.chapters.splice(idx + 1, 0, c); await commit(b, { meta: true }); render(); } },
    { icon: 'trash-2', label: 'Delete chapter', red: true, run: () => confirmSheet('Delete this chapter?', `"${c.title || 'Untitled'}" and its notes will be removed from the book.`, 'Delete chapter', async () => {
      dirty = false; b.chapters.splice(b.chapters.indexOf(c), 1); (b.tombstones ||= []).push({ id: c.id, at: Date.now() }); await commit(b, { meta: true }); toast('Chapter deleted'); go(`/b/${b.id}`);
    }) }
  ]); };

  const onHide = () => { if (document.visibilityState === 'hidden') save(); };
  document.addEventListener('visibilitychange', onHide);
  cleanup = async () => {
    document.removeEventListener('selectionchange', onSel); document.removeEventListener('pointerdown', outside); document.removeEventListener('visibilitychange', onHide);
    vv?.removeEventListener('resize', onVV); vv?.removeEventListener('scroll', onVV); removeEventListener('resize', onVV); removeEventListener('scroll', unpan);
    document.body.classList.remove('editing');
    $('.focusx')?.remove();
    await save();
    if (!firstEdit) snapshot(c.html);
  };

  window.scrollTo(0, 0);
  if (pendingFind) { const t = pendingFind; pendingFind = ''; setTimeout(() => highlight(page, t), 80); }
  else if (!c.html && !c.title) setTimeout(() => title.focus(), 60);
}
// ---------- proofreading ----------
const BLOCK_SEL = 'p,h2,h3,li,blockquote,figure';
function textMap(page) {
  let text = '', prevBlock = null; const segs = [];
  const tw = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    if (n.parentElement.closest('.imgbar')) continue;
    const blk = n.parentElement.closest(BLOCK_SEL) || page;
    if (prevBlock && blk !== prevBlock) text += '\n\n';
    prevBlock = blk;
    segs.push({ node: n, start: text.length }); text += n.data;
  }
  return { text, segs };
}
function rangeAt(map, offset, length) {
  const segs = map.segs; if (!segs.length) return null;
  const startAt = (pos) => { for (const s of segs) if (pos >= s.start && pos < s.start + s.node.length) return [s.node, pos - s.start]; for (let k = segs.length - 1; k >= 0; k--) if (pos === segs[k].start + segs[k].node.length) return [segs[k].node, segs[k].node.length]; return null; };
  const endAt = (pos) => { for (const s of segs) if (pos > s.start && pos <= s.start + s.node.length) return [s.node, pos - s.start]; return startAt(pos); };
  const a = startAt(offset), z = length ? endAt(offset + length) : a;
  if (!a || !z) return null;
  const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(z[0], z[1]); return r;
}
const KIND = { misspelling: 'Spelling', grammar: 'Grammar', typographical: 'Punctuation', whitespace: 'Spacing', style: 'Style', duplication: 'Repeated word', uncategorized: 'Suggestion', locale_violation: 'Spelling' };

async function proofSheet(b, page, changed) {
  // clear any formatting placeholders so offsets line up
  const tw = document.createTreeWalker(page, NodeFilter.SHOW_TEXT); let n; const zs = [];
  while ((n = tw.nextNode())) if (n.data.includes('​')) zs.push(n);
  zs.forEach((t) => { t.data = t.data.replace(/​/g, ''); });
  let map = textMap(page);
  if (!map.text.trim()) return toast('Write something first');
  const hl = window.CSS?.highlights ? new Highlight() : null;
  if (hl) CSS.highlights.set('proof', hl);
  let matches = [], i = 0, closeIt, fixed = 0, seen = 0;
  const dict = new Set((b.dictionary || []).map((w) => w.toLowerCase()));
  closeIt = sheet({
    title: 'Proofread',
    body: `<div data-pf><p class="hint" style="display:flex;align-items:center;gap:10px"><span class="spin"></span>Reading your chapter…</p></div>`,
    onClose: () => { if (hl) CSS.highlights.delete('proof'); },
    async onMount(sb) {
      const box = $('[data-pf]', sb);
      try {
        // split long chapters into pieces the checker accepts
        const chunks = []; let start = 0;
        while (start < map.text.length) {
          let end = Math.min(map.text.length, start + 18000);
          if (end < map.text.length) { const k = map.text.lastIndexOf('\n\n', end); if (k > start) end = k; }
          chunks.push([start, map.text.slice(start, end)]); start = end;
        }
        for (const [off, t] of chunks) {
          const r = await fetch('/api/nf/proofread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, language: 'en-US' }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'The proofreader didn’t answer. Try again soon.');
          matches.push(...j.matches.map((m) => ({ ...m, offset: m.offset + off })));
        }
      } catch (e) {
        box.innerHTML = `<p class="hint">${navigator.onLine ? esc(e.message) : 'Proofreading needs an internet connection.'}</p>`; return;
      }
      matches = matches.filter((m) => !(m.type === 'misspelling' && dict.has(map.text.substr(m.offset, m.length).toLowerCase())));
      seen = matches.length;
      const shift = (from, delta) => matches.forEach((m) => { if (m.offset > from) m.offset += delta; });
      const show = () => {
        if (hl) hl.clear();
        if (i >= matches.length) {
          box.innerHTML = `<div class="pfdone">${icon('check-check')}<b>${seen ? 'All done' : 'No issues found'}</b><span>${seen ? (fixed ? `Fixed ${plural(fixed, 'issue')}.` : 'You went through every suggestion.') : 'This chapter reads clean.'}</span></div><button class="btn wide" data-close>Back to writing</button>`;
          $('[data-close]', box).onclick = () => closeIt(); return;
        }
        const m = matches[i]; map = textMap(page);
        const word = map.text.substr(m.offset, m.length);
        const r = rangeAt(map, m.offset, m.length);
        if (r && hl) hl.add(r);
        if (r) { const sc = $('[data-scroll]'), rect = r.getBoundingClientRect(); if (sc) sc.scrollBy({ top: rect.top - sc.getBoundingClientRect().top - sc.clientHeight * .22, behavior: 'smooth' }); else scrollTo({ top: scrollY + rect.top - innerHeight * .28, behavior: 'smooth' }); }
        const ctxS = Math.max(0, m.offset - 60), ctxE = Math.min(map.text.length, m.offset + m.length + 60);
        const ctx = (ctxS ? '…' : '') + esc(map.text.slice(ctxS, m.offset).replace(/\n+/g, ' ')) + `<mark class="${m.type === 'misspelling' ? 'sp' : ''}">${esc(word) || '&nbsp;'}</mark>` + esc(map.text.slice(m.offset + m.length, ctxE).replace(/\n+/g, ' ')) + (ctxE < map.text.length ? '…' : '');
        box.innerHTML = `<div class="pfhead"><span>${KIND[m.type] || 'Suggestion'}</span><span>${i + 1} of ${matches.length}</span></div>
          <p class="pfmsg">${esc(m.message)}</p>
          <p class="pfctx">${ctx}</p>
          ${m.replacements.length ? `<div class="pffix">${m.replacements.slice(0, 4).map((x, k) => `<button class="btn${k ? ' soft' : ''}" data-r="${k}">${esc(x) || '<i>remove</i>'}</button>`).join('')}</div>` : ''}
          <div class="pfacts"><button data-prev ${i ? '' : 'disabled'} aria-label="Previous">${icon('chevron-left')}</button>
            ${m.type === 'misspelling' && word ? `<button data-dict>${icon('book-a')}Add to dictionary</button>` : '<span></span>'}
            <button data-skip>Skip${icon('chevron-right')}</button></div>`;
        $$('[data-r]', box).forEach((bt) => bt.onclick = () => {
          const rep = m.replacements[+bt.dataset.r]; map = textMap(page);
          const rr = rangeAt(map, m.offset, m.length); if (!rr) { i++; return show(); }
          rr.deleteContents(); if (rep) rr.insertNode(document.createTextNode(rep));
          page.normalize();
          shift(m.offset, rep.length - m.length);
          matches.splice(i, 1); fixed++; changed(); show();
        });
        $('[data-skip]', box).onclick = () => { i++; show(); };
        const pv = $('[data-prev]', box); if (pv) pv.onclick = () => { if (i) { i--; show(); } };
        const dv = $('[data-dict]', box);
        if (dv) dv.onclick = async () => {
          const w = word.toLowerCase(); dict.add(w); (b.dictionary ||= []).includes(word) || b.dictionary.push(word);
          await commit(b, { meta: true });
          matches = matches.filter((x, k) => k < i || !(x.type === 'misspelling' && map.text.substr(x.offset, x.length).toLowerCase() === w));
          toast(`"${word}" added to this book's dictionary`); show();
        };
      };
      show();
    }
  });
}

function placeCaret(el, atStart) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(atStart); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

function versionsSheet(b, c, restore) {
  sheet({
    title: 'Earlier versions', tall: true, body: '<div data-v></div>',
    async onMount(sb, close) {
      const list = (await db.versions(c.id)).sort((x, y) => y.at - x.at);
      const box = $('[data-v]', sb);
      if (!list.length) { box.innerHTML = '<p class="hint">Versions are saved as you write. Come back after an editing session to roll back.</p>'; return; }
      box.innerHTML = list.map((v, i) => `<div class="ver"><div class="lbl"><b>${timeAgo(v.at)}</b><small>${plural(v.words, 'word')}</small></div><button data-p="${i}">Preview</button></div><div data-pv="${i}" hidden></div>`).join('');
      $$('[data-p]', box).forEach((bt) => bt.onclick = () => {
        const i = +bt.dataset.p, pv = $(`[data-pv="${i}"]`, box);
        if (!pv.hidden) { pv.hidden = true; return; }
        $$('[data-pv]', box).forEach((x) => x.hidden = true);
        pv.hidden = false; pv.innerHTML = `<div class="preview page">${list[i].html}</div><button class="btn wide" data-r style="margin-bottom:12px">${icon('rotate-ccw')}Restore this version</button>`;
        $('[data-r]', pv).onclick = async () => {
          await db.addVersion({ id: uid(), chapterId: c.id, bookId: b.id, at: Date.now(), html: c.html, words: c.words });
          restore(list[i].html); close(); toast('Version restored');
        };
      });
    }
  });
}

// ---------- reader ----------
async function readerView(b) {
  document.title = b.title + ' · Novelfolio';
  app.innerHTML = `
  <div class="rprog" data-prog></div>
  <div class="bar rbar" data-rbar><a class="ib" href="#/b/${b.id}" aria-label="Close reader">${icon('x')}</a><div class="grow t" style="font-size:17px;color:var(--ink2);font-style:italic">${esc(b.title)}</div>
    <button class="ib" data-look aria-label="Text and appearance">${icon('a-large-small')}</button>
    <button class="ib" data-toc aria-label="Contents">${icon('list')}</button></div>
  <article class="reader">
    <div class="tp">${coverHtml(b)}<h1>${esc(b.title || 'Untitled')}</h1>${b.author ? `<p>${esc(b.author)}</p>` : ''}</div>
    ${b.chapters.map((c, i) => `<section id="r-${c.id}"><div class="chlabel">Chapter ${ROMAN(i + 1)}</div><h1>${esc(c.title || 'Untitled')}</h1><div class="flr">⁂</div><div class="page">${c.html || '<p style="text-align:center;color:var(--ink3);font-style:italic">This chapter is still blank.</p>'}</div></section>`).join('')}
    <div class="fin">The End</div>
  </article>`;
  const prog = $('[data-prog]'), rbar = $('[data-rbar]');
  let lastY = 0, saveT;
  const onScroll = () => {
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    prog.style.width = (max > 0 ? y / max * 100 : 0) + '%';
    rbar.classList.toggle('hide', y > lastY && y > 120); lastY = y;
    clearTimeout(saveT); saveT = setTimeout(() => db.setMeta('read:' + b.id, max > 0 ? y / max : 0), 400);
  };
  addEventListener('scroll', onScroll, { passive: true });
  $('.reader').addEventListener('click', (e) => { if (!e.target.closest('a,button')) rbar.classList.toggle('hide'); });
  $('[data-look]').onclick = () => sheet({ title: 'Text & appearance', body: lookBody(), onMount: wireLook });
  $('[data-toc]').onclick = () => menu('Contents', b.chapters.map((c, i) => ({ icon: 'chevron-right', label: `${ROMAN(i + 1)}. ${c.title || 'Untitled'}`, run: () => document.getElementById('r-' + c.id).scrollIntoView() })));
  cleanup = () => removeEventListener('scroll', onScroll);
  const pos = await db.getMeta('read:' + b.id);
  requestAnimationFrame(() => { if (pos) scrollTo(0, pos * (document.documentElement.scrollHeight - innerHeight)); else scrollTo(0, 0); onScroll(); });
}

// ---------- boot ----------
onSync(() => {});
addEventListener('online', () => scheduleSync(200));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
render().then(() => scheduleSync(400));
