import { renderSite, esc } from './render.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');
const MINE_KEY = 'ds_my_questions';

let data = null;
let selected = null;

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const mine = () => store.get(MINE_KEY, []);

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}

function render() {
  if (!data) return;
  const keepScroll = document.getElementById('msgs')?.scrollTop;
  app.innerHTML = renderSite(data, { mine: mine() });
  document.title = data.site.meta?.title || data.site.hero.name;
  wire();
  const msgs = document.getElementById('msgs');
  if (msgs) msgs.scrollTop = keepScroll ?? msgs.scrollHeight;
  if (PREVIEW) markSelected();
  reveal();
}

function reveal() {
  const els = document.querySelectorAll('.rv:not(.in)');
  if (PREVIEW || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}

function wire() {
  // project filters
  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
    const f = b.dataset.filter;
    document.querySelectorAll('.card[data-tags]').forEach((c) => c.classList.toggle('gone', !!f && !c.dataset.tags.split('|').includes(f)));
  }));

  // fire on notes
  document.querySelectorAll('[data-flame]').forEach((b) => {
    const id = b.dataset.flame; const done = store.get('ds_flamed', []);
    if (done.includes(id)) b.classList.add('done');
    b.addEventListener('click', async (e) => {
      e.preventDefault(); if (PREVIEW || b.classList.contains('done')) return;
      b.classList.add('done', 'pop'); const n = b.querySelector('span'); n.textContent = +n.textContent + 1;
      store.set('ds_flamed', [...store.get('ds_flamed', []), id]);
      try { const r = await api(`/api/notes/${encodeURIComponent(id)}/flame`, { method: 'POST' }); if (r.flames) { n.textContent = r.flames; data.flames[id] = r.flames; } } catch {}
    });
  });

  // hearts on guestbook
  document.querySelectorAll('[data-heart]').forEach((b) => {
    const id = b.dataset.heart; if (store.get('ds_hearted', []).includes(id)) b.classList.add('done');
    b.addEventListener('click', async () => {
      if (PREVIEW || b.classList.contains('done')) return;
      b.classList.add('done', 'pop'); const n = b.querySelector('span'); n.textContent = +n.textContent + 1;
      store.set('ds_hearted', [...store.get('ds_hearted', []), id]);
      try { await api(`/api/guestbook/${encodeURIComponent(id)}/heart`, { method: 'POST' }); } catch {}
    });
  });

  // guestbook form
  const gb = document.getElementById('gbform');
  if (gb) {
    let react = 'flame';
    gb.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', () => { react = b.dataset.react; gb.querySelectorAll('[data-react]').forEach((x) => x.classList.toggle('on', x === b)); }));
    gb.addEventListener('submit', async (e) => {
      e.preventDefault(); if (PREVIEW) return;
      const msg = document.getElementById('gbmsg'); const btn = gb.querySelector('.btnp'); btn.disabled = true; msg.className = 'formmsg';
      try {
        const f = new FormData(gb);
        const r = await api('/api/guestbook', { method: 'POST', body: { name: f.get('name'), text: f.get('text'), website: f.get('website'), react } });
        gb.reset();
        if (r.comment) { data.guestbook.items.unshift(r.comment); data.guestbook.count++; render(); document.getElementById('gbmsg').textContent = 'Posted. Thanks for stopping by.'; }
        else msg.textContent = `Got it. It'll show up once ${firstName()} gives it a look.`;
      } catch (err) { msg.textContent = err.message; msg.classList.add('err'); }
      btn.disabled = false;
    });
  }

  // DavidGPT
  const ask = document.getElementById('askform');
  if (ask) {
    const saved = store.get('ds_name', '');
    if (saved) ask.elements.name.value = saved;
    document.querySelectorAll('[data-ask]').forEach((b) => b.addEventListener('click', () => { ask.elements.text.value = b.dataset.ask; ask.elements.text.focus(); }));
    ask.addEventListener('submit', async (e) => {
      e.preventDefault(); if (PREVIEW) return;
      const btn = ask.querySelector('.sendb'); btn.disabled = true;
      try {
        const name = ask.elements.name.value.trim();
        const r = await api('/api/questions', { method: 'POST', body: { name, text: ask.elements.text.value, website: ask.elements.website.value } });
        if (name) store.set('ds_name', name);
        store.set(MINE_KEY, [...mine(), r.question].slice(-20));
        render();
        const m = document.getElementById('msgs'); m.scrollTop = m.scrollHeight;
      } catch (err) { alertIn(ask, err.message); }
      btn.disabled = false;
    });
  }

  if (PREVIEW) {
    document.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
    document.querySelectorAll('[data-block]').forEach((el) => el.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      parent.postMessage({ type: 'select', id: el.dataset.block }, location.origin);
    }));
  }
}

function alertIn(form, text) {
  let el = form.parentElement.querySelector('.asknote');
  if (!el) { el = document.createElement('div'); el.className = 'asknote formmsg err'; el.style.margin = '-6px 24px 14px'; form.after(el); }
  el.textContent = text; setTimeout(() => el.remove(), 4000);
}
const firstName = () => String(data?.site?.hero?.name || 'David').split(' ')[0];

// check if any of my questions got answered
async function pollMine() {
  const pending = mine().filter((q) => !(data.questions || []).some((a) => a.id === q.id));
  if (!pending.length) return;
  let changed = false;
  for (const q of pending.slice(-5)) {
    try { const r = await api(`/api/questions/${q.id}`); if (r.answer) { data.questions.push(r); changed = true; } }
    catch (e) { if (/not found/i.test(e.message)) { store.set(MINE_KEY, mine().filter((x) => x.id !== q.id)); changed = true; } }
  }
  if (changed) render();
}

// ---------- editor preview bridge ----------
function markSelected() {
  document.querySelectorAll('[data-block].sel').forEach((e) => e.classList.remove('sel'));
  if (!selected) return;
  const el = document.querySelector(`[data-block="${CSS.escape(selected)}"]`);
  if (el) el.classList.add('sel');
}
if (PREVIEW) {
  document.body.classList.add('preview');
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'draft') { data = { ...(data || {}), ...e.data.payload }; render(); }
    if (e.data.type === 'select') {
      selected = e.data.id; markSelected();
      const el = selected && document.querySelector(`[data-block="${CSS.escape(selected)}"]`);
      if (el && e.data.scroll) { const r = el.getBoundingClientRect(); window.scrollTo({ top: r.top + scrollY - Math.max(40, (innerHeight - r.height) / 2), behavior: 'smooth' }); }
    }
  });
  parent.postMessage({ type: 'ready' }, location.origin);
}

(async function boot() {
  try {
    data = await api('/api/site' + (PREVIEW ? '?draft=1' : ''));
    render();
    if (!PREVIEW) { pollMine(); setInterval(pollMine, 60000); }
  } catch (e) {
    app.innerHTML = `<div class="wrap"><div class="glass" style="padding:40px;margin-top:40px">Couldn't load the page. ${esc(e.message)}</div></div>`;
  }
})();
