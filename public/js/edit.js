import { icon, ICON_NAMES } from './icons.js';
import { esc, ago, THUMBS } from './render.js';

const root = document.getElementById('root');
const S = {
  draft: null, unpublished: false, sel: 'hero', tab: 'blocks', device: 'desktop',
  inbox: { comments: [], questions: [] }, pub: {}, hist: [], fut: [], snap: '',
  save: 'saved', open: {}, expanded: { projects: true }, addMenu: false, q: '',
  gptTab: 'waiting', qSel: null, ansDraft: {}, pinNext: false, replyOpen: null
};
const DEVICES = { desktop: 1440, tablet: 834, phone: 390 };
const COVERS = ['ember', 'ocean', 'prism', 'violet', 'mono', 'sunset'];
const SECTION_META = {
  projects: ['layout-grid', 'Builds'], notes: ['pencil', "David's comments"], gpt: ['sparkles', 'DavidGPT'],
  music: ['music', 'Music'], socials: ['link', 'Find me'], guestbook: ['message-circle', 'Guestbook']
};
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- api ----------
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined, keepalive: !!opts.keepalive });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.endsWith('/login')) { showLogin('Your session ended. Sign in again.'); throw new Error('Signed out'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
function toast(msg) {
  let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---------- path helpers ----------
function getP(path, obj = S.draft) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setP(path, val, obj = S.draft) {
  const ks = path.split('.'); let o = obj;
  ks.slice(0, -1).forEach((k, i) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; });
  o[ks.at(-1)] = val;
}
const projIdx = (id) => S.draft.sections.projects.items.findIndex((p) => p.id === id);

// ---------- change pipeline ----------
let saveT, histT, prevT;
function changed({ full = true } = {}) {
  S.unpublished = true;
  clearTimeout(histT); histT = setTimeout(commitHistory, 450);
  clearTimeout(saveT); saveT = setTimeout(saveNow, 700); setSave('busy');
  clearTimeout(prevT); prevT = setTimeout(pushPreview, 120);
  if (full) renderAll(); else renderTop();
}
function commitHistory() {
  const now = JSON.stringify(S.draft);
  if (now !== S.snap) { S.hist.push(S.snap); if (S.hist.length > 100) S.hist.shift(); S.snap = now; S.fut = []; renderTop(); }
}
async function saveNow(keepalive = false) {
  clearTimeout(saveT);
  try { await api('/api/admin/draft', { method: 'PUT', body: { draft: S.draft }, keepalive }); setSave('saved'); }
  catch (e) { if (e.message !== 'Signed out') setSave('err'); }
}
function setSave(s) { S.save = s; const el = document.getElementById('savestate'); if (el) { el.className = 'saved ' + (s === 'saved' ? '' : s); el.lastChild.textContent = s === 'busy' ? 'Saving…' : s === 'err' ? 'Not saved' : (S.unpublished ? 'Draft saved' : 'Published'); } }
function undo() { commitHistory(); if (!S.hist.length) return; S.fut.push(JSON.stringify(S.draft)); S.snap = S.hist.pop(); S.draft = JSON.parse(S.snap); afterJump(); }
function redo() { if (!S.fut.length) return; S.hist.push(JSON.stringify(S.draft)); S.snap = S.fut.pop(); S.draft = JSON.parse(S.snap); afterJump(); }
function afterJump() { if (S.sel.startsWith('project:') && projIdx(S.sel.slice(8)) < 0) S.sel = 'section:projects'; clearTimeout(saveT); saveT = setTimeout(saveNow, 300); setSave('busy'); S.unpublished = true; pushPreview(); renderAll(); }
addEventListener('beforeunload', () => { if (S.save === 'busy') saveNow(true); });

// ---------- preview ----------
let frame, ready = false;
function pushPreview() { if (ready) frame.contentWindow.postMessage({ type: 'draft', payload: { site: S.draft, ...S.pub } }, location.origin); }
function selectPreview(scroll) { if (ready) frame.contentWindow.postMessage({ type: 'select', id: S.sel, scroll }, location.origin); }
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data) return;
  if (e.data.type === 'ready') { ready = true; pushPreview(); selectPreview(false); }
  if (e.data.type === 'select') { S.sel = e.data.id; S.tab = 'blocks'; if (S.sel.startsWith('project:')) S.expanded.projects = true; renderAll(); selectPreview(false); }
});
function layoutFrame() {
  const box = document.getElementById('frame'); if (!box || !frame) return;
  const w = box.clientWidth, h = box.clientHeight, dw = DEVICES[S.device];
  const sc = Math.min(1, w / dw);
  Object.assign(frame.style, { width: dw + 'px', height: h / sc + 'px', transform: `scale(${sc})`, left: (w - dw * sc) / 2 + 'px' });
  const z = document.getElementById('zoom'); if (z) z.textContent = Math.round(sc * 100) + '%';
}
async function refreshPublic() {
  try { const d = await api('/api/site?draft=1'); S.pub = { guestbook: d.guestbook, questions: d.questions, flames: d.flames }; pushPreview(); } catch {}
}
async function refreshInbox() { try { S.inbox = await api('/api/admin/inbox'); } catch {} renderAll(); }

// ---------- field builders ----------
const F = {
  text: (label, path, ph = '', type = 'text') => `<div class="f"><label>${esc(label)}</label><input class="in" type="${type}" data-path="${path}" value="${esc(getP(path) ?? '')}" placeholder="${esc(ph)}"></div>`,
  area: (label, path, ph = '', hint = '', rows = 3) => `<div class="f"><label>${esc(label)}</label><textarea class="in" rows="${rows}" data-path="${path}" placeholder="${esc(ph)}">${esc(getP(path) ?? '')}</textarea>${hint ? `<div class="hint" style="margin-top:6px">${hint}</div>` : ''}</div>`,
  csv: (label, path, ph = '') => `<div class="f"><label>${esc(label)}</label><input class="in" data-path="${path}" data-kind="csv" value="${esc((getP(path) || []).join(', '))}" placeholder="${esc(ph)}"></div>`,
  select: (label, path, opts) => `<div class="f"><label>${esc(label)}</label><select class="in" data-path="${path}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(getP(path)) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`,
  seg: (label, path, opts, num = false) => `<div class="f"><label>${esc(label)}</label><div class="seg c">${opts.map(([v, l]) => `<button data-act="setv" data-path="${path}" data-v="${esc(v)}" ${num ? 'data-num="1"' : ''} class="${String(getP(path)) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div></div>`,
  toggle: (label, path, inv = false) => { const v = !!getP(path); const on = inv ? !v : v; return `<div class="tg" data-act="toggle" data-path="${path}">${esc(label)}<div class="sw ${on ? 'on' : ''}"></div></div>`; },
  icon: (label, path) => `<div class="f"><label>${esc(label)}</label><div class="iconpick"><div class="pv">${icon(getP(path) || 'sparkles', 18)}</div><select class="in" data-path="${path}">${ICON_NAMES.map((n) => `<option ${getP(path) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>`
};
const coverOpts = COVERS.map((c) => [c, c[0].toUpperCase() + c.slice(1)]);

function listEditor(path, { title, ic, fields, kind, addLabel }) {
  const arr = getP(path) || [];
  return `<div class="list">${arr.map((it, i) => {
    const key = path + ':' + (it.id || i); const open = S.open[key];
    return `<div class="item ${open ? 'open' : ''}"><div class="ihd" data-act="item-open" data-key="${esc(key)}">
      <span class="ic2">${icon(ic ? ic(it) : 'grip-vertical', 14)}</span><span class="t">${esc(title(it) || 'Untitled')}</span>
      <span class="tools"><button class="ib sm" data-act="item-move" data-path="${path}" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Move up">${icon('chevron-down', 14, 'flip')}</button>
      <button class="ib sm" data-act="item-move" data-path="${path}" data-i="${i}" data-d="1" ${i === arr.length - 1 ? 'disabled' : ''} title="Move down">${icon('chevron-down', 14)}</button>
      <button class="ib sm" data-act="item-del" data-path="${path}" data-i="${i}" title="Delete">${icon('trash-2', 13)}</button></span></div>
      ${open ? `<div class="ibd">${fields(`${path}.${i}`, it)}</div>` : ''}</div>`;
  }).join('')}<button class="addrow" data-act="item-add" data-path="${path}" data-kind="${kind}">${icon('plus', 14)} ${esc(addLabel)}</button></div>`;
}
const MAKE = {
  status: () => ({ id: uid(), icon: 'sparkles', text: 'Doing something new', note: '' }),
  tick: () => ({ id: uid(), icon: 'sparkles', verb: 'Doing', text: 'something new', when: 'today' }),
  post: () => ({ id: uid(), date: today(), tag: 'Random', text: '', attach: null }),
  starter: () => ({ icon: 'sparkles', text: 'New question' }),
  release: () => ({ id: uid(), coverLabel: '', coverText: 'NEW\nRELEASE', cover: 'violet', image: '', badge: 'Coming soon', title: 'New release', sub: '', link: '', tracks: [] }),
  social: () => ({ id: uid(), icon: 'link', label: 'New link', sub: '', link: '' }),
  project: () => ({ id: uid(), title: 'New project', desc: '', link: '', tags: [], width: 'm', thumb: 'text', thumbText: 'NEW', image: '', hidden: false })
};

// ---------- inspectors ----------
function inspector() {
  const s = S.sel, d = S.draft;
  const wrap = (kind, title, body, extra = '') => `<div class="ih"><div><div class="label">${esc(kind)}</div><h3>${esc(title)}</h3></div>${extra}</div><div class="ibody" id="ibody">${body}</div>`;
  if (s === 'hero') return wrap('Top block', 'Hero', [
    F.text('Small line on top', 'hero.eyebrow', 'Wadsworth, Ohio'), F.text('Gold intro', 'hero.kicker', 'the homepage of'),
    F.text('Name', 'hero.name'), F.area('Bio', 'hero.bio', '', 'Wrap words in **double stars** to make them bold.', 5),
    `<div class="two">${F.text('Gold button', 'hero.primary.label')}${F.text('Goes to', 'hero.primary.link', '#builds')}</div>`,
    `<div class="two">${F.text('Second button', 'hero.secondary.label')}${F.text('Goes to', 'hero.secondary.link', 'https://')}</div>`
  ].join(''));
  if (s === 'nowSpinning') return wrap('Record player', 'Now spinning', [
    F.text('Label', 'nowSpinning.label'), F.text('Song', 'nowSpinning.title'), F.text('Under the song', 'nowSpinning.sub'),
    F.text('Play button link', 'nowSpinning.link', 'https://open.spotify.com/...'),
    F.select('Cover color', 'nowSpinning.cover', coverOpts),
    `<div class="two">${F.text('Cover top text', 'nowSpinning.coverLabel')}${F.area('Cover big text', 'nowSpinning.coverText', '', '', 2)}</div>`,
    F.text('Or use an image (URL)', 'nowSpinning.image', 'https://… .jpg')
  ].join(''));
  if (s === 'rightNow') {
    const rn = d.rightNow;
    return wrap('Your status', 'Right now', [
      `<div><div class="flabel">Tap to set what you're doing</div>${rn.statuses.map((st) => `<div class="stl ${st.id === rn.activeId ? 'on' : ''}" data-act="status-set" data-id="${esc(st.id)}"><span class="ic2" style="display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,.06)">${icon(st.icon, 14)}</span>${esc(st.text)}<span class="rad"></span></div>`).join('')}
      <div class="stl ${rn.activeId ? '' : 'on'}" data-act="status-set" data-id=""><span style="width:26px;display:grid;place-items:center">${icon('moon', 14)}</span>Nothing right now<span class="rad"></span></div></div>`,
      F.seg('Clear my status after', 'rightNow.clearAfterHours', [[1, '1h'], [4, '4h'], [24, '24h'], [0, 'Never']], true),
      F.toggle('Also show it in the ticker', 'rightNow.showInTicker'),
      `<div><div class="flabel">Edit statuses</div>${listEditor('rightNow.statuses', { title: (x) => x.text, ic: (x) => x.icon, kind: 'status', addLabel: 'New status', fields: (b) => F.icon('Icon', b + '.icon') + F.text('What you\'re doing', b + '.text') + F.text('Small note (optional)', b + '.note') })}</div>`,
      F.text('Card label', 'rightNow.label')
    ].join(''));
  }
  if (s === 'ticker') return wrap('Scrolling strip', 'Ticker', [
    F.toggle('Show the ticker', 'ticker.hidden', true), F.text('Label', 'ticker.label'),
    `<div class="hint">Your current status from "Right now" shows up first automatically.</div>`,
    listEditor('ticker.items', { title: (x) => `${x.verb} ${x.text}`, ic: (x) => x.icon, kind: 'tick', addLabel: 'Add ticker item', fields: (b) => F.icon('Icon', b + '.icon') + `<div class="two">${F.text('Big word', b + '.verb')}${F.text('When', b + '.when')}</div>` + F.text('Rest of it', b + '.text') })
  ].join(''));
  if (s === 'section:projects') {
    const p = d.sections.projects;
    return wrap('Section', p.title, [
      F.toggle('Show this section', 'sections.projects.hidden', true),
      `<div class="two">${F.text('Title', 'sections.projects.title')}${F.text('Gold part', 'sections.projects.em')}</div>`,
      `<div><div class="flabel">Projects · drag them in the list on the left</div><div class="list">${p.items.map((x) => `<div class="item"><div class="ihd" data-act="select" data-id="project:${esc(x.id)}"><span class="ic2">${icon('layout-grid', 14)}</span><span class="t">${esc(x.title)}</span>${x.hidden ? `<span class="hint">hidden</span>` : ''}${icon('chevron-right', 14)}</div></div>`).join('')}
      <button class="addrow" data-act="add" data-kind="project">${icon('plus', 14)} Add project</button></div></div>`
    ].join(''));
  }
  if (s.startsWith('project:')) {
    const i = projIdx(s.slice(8)); if (i < 0) { S.sel = 'section:projects'; return inspector(); }
    const b = `sections.projects.items.${i}`, p = d.sections.projects.items[i];
    return wrap('Project card', p.title, [
      F.text('Title', b + '.title'), F.area('Description', b + '.desc'), F.text('Link', b + '.link', 'https://'),
      F.csv('Tags (comma separated)', b + '.tags', 'Live, Halfbyte'),
      F.seg('Width', b + '.width', [['s', 'S'], ['m', 'M'], ['l', 'L'], ['half', 'Half'], ['xl', 'XL'], ['full', 'Full']]),
      F.select('Picture', b + '.thumb', THUMBS.map((t) => [t, { turntable: 'Turntable', playlists: 'Playlists', eq: 'EQ bars', tiles: 'Game tiles', dial: 'Radio dial', aperture: 'Camera', number: 'Big number', cube: 'Bouncing cube', text: 'Big text', image: 'My own image' }[t]])),
      p.thumb === 'number' || p.thumb === 'text' ? F.text('Picture text', b + '.thumbText') : '',
      p.thumb === 'image' ? F.text('Image URL', b + '.image', 'https://… .png') : '',
      F.toggle('Show on homepage', b + '.hidden', true),
      `<div class="foot"><button data-act="proj-dup">${icon('copy', 14)} Duplicate</button><button class="d" data-act="proj-del">${icon('trash-2', 14)} Delete</button></div>`
    ].join(''));
  }
  if (s === 'section:notes') return wrap('Section', d.sections.notes.title, [
    F.toggle('Show this section', 'sections.notes.hidden', true),
    `<div class="two">${F.text('Title', 'sections.notes.title')}${F.text('Gold part', 'sections.notes.em')}</div>`,
    F.area('Pinned quote', 'sections.notes.pinned'), F.text('Handle under your name', 'sections.notes.handle'),
    `<div><div class="flabel">Posts</div>${listEditor('sections.notes.posts', { title: (x) => x.text || 'New post', ic: () => 'pen-line', kind: 'post', addLabel: 'Write a post', fields: (b, x) =>
      `<div class="two">${F.text('Date', b + '.date', '', 'date')}${F.text('Tag', b + '.tag', 'Builds')}</div>` + F.area('Post', b + '.text', 'What\'s on your mind?', '', 4) +
      (x.attach ? `<div class="two">${F.text('Attached title', b + '.attach.title')}${F.text('Attached sub', b + '.attach.sub')}</div>${F.select('Attached cover', b + '.attach.cover', coverOpts)}<button class="addrow" data-act="attach" data-path="${b}" data-on="0">${icon('trash-2', 13)} Remove attachment</button>`
        : `<button class="addrow" data-act="attach" data-path="${b}" data-on="1">${icon('disc-3', 13)} Attach a release</button>`) })}</div>`
  ].join(''));
  if (s === 'section:gpt') return gptInspector(wrap);
  if (s === 'section:music') return wrap('Section', d.sections.music.title, [
    F.toggle('Show this section', 'sections.music.hidden', true),
    `<div class="two">${F.text('Title', 'sections.music.title')}${F.text('Gold part', 'sections.music.em')}</div>`,
    `<div><div class="flabel">Releases</div>${listEditor('sections.music.items', { title: (x) => x.title, ic: () => 'disc-3', kind: 'release', addLabel: 'Add release', fields: (b, x) =>
      F.text('Title', b + '.title') + F.text('Under the title', b + '.sub') + `<div class="two">${F.text('Badge', b + '.badge', 'Out now')}${F.select('Cover color', b + '.cover', coverOpts)}</div>` +
      `<div class="two">${F.text('Cover top text', b + '.coverLabel')}${F.area('Cover big text', b + '.coverText', '', '', 2)}</div>` + F.text('Or cover image URL', b + '.image') + F.text('Link', b + '.link', 'https://') +
      `<div class="f"><label>Tracks · one per line, "name | label"</label><textarea class="in" rows="4" data-path="${b}.tracks" data-kind="tracks">${esc((x.tracks || []).map((t) => t.meta ? `${t.name} | ${t.meta}` : t.name).join('\n'))}</textarea></div>` })}</div>`
  ].join(''));
  if (s === 'section:socials') return wrap('Section', d.sections.socials.title, [
    F.toggle('Show this section', 'sections.socials.hidden', true),
    `<div class="two">${F.text('Title', 'sections.socials.title')}${F.text('Gold part', 'sections.socials.em')}</div>`,
    listEditor('sections.socials.items', { title: (x) => x.label, ic: (x) => x.icon, kind: 'social', addLabel: 'Add link', fields: (b) => F.icon('Icon', b + '.icon') + `<div class="two">${F.text('Name', b + '.label')}${F.text('Under it', b + '.sub')}</div>` + F.text('Link', b + '.link', 'https://') })
  ].join(''));
  if (s === 'section:guestbook') return guestbookInspector(wrap);
  S.sel = 'hero'; return inspector();
}

function gptInspector(wrap) {
  const qs = S.inbox.questions; const waiting = qs.filter((q) => q.status !== 'answered'); const done = qs.filter((q) => q.status === 'answered');
  const tabs = `<div class="seg c" style="width:100%">${[['waiting', `Waiting ${waiting.length}`], ['done', 'Answered'], ['text', 'Text']].map(([k, l]) => `<button data-act="gtab" data-v="${k}" class="${S.gptTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  let body = tabs;
  if (S.gptTab === 'text') {
    body += [F.toggle('Show this section', 'sections.gpt.hidden', true),
      `<div class="two">${F.text('Title', 'sections.gpt.title')}${F.text('Gold part', 'sections.gpt.em')}</div>`,
      `<div class="two">${F.text('Big line 1', 'sections.gpt.head1')}${F.text('Big line 2', 'sections.gpt.head2')}</div>`,
      F.area('Blurb', 'sections.gpt.blurb'), F.text('Reply time', 'sections.gpt.replyTime'),
      F.toggle('Let people ask without a name', 'sections.gpt.allowAnonymous'),
      `<div><div class="flabel">Starter questions</div>${listEditor('sections.gpt.starters', { title: (x) => x.text, ic: (x) => x.icon, kind: 'starter', addLabel: 'Add starter', fields: (b) => F.icon('Icon', b + '.icon') + F.text('Question', b + '.text') })}</div>`].join('');
  } else {
    const list = S.gptTab === 'waiting' ? waiting : done;
    if (!list.length) body += `<div class="empty">${S.gptTab === 'waiting' ? 'No questions waiting. Nice.' : 'Nothing answered yet.'}</div>`;
    else {
      if (!list.some((q) => q.id === S.qSel)) { S.qSel = list[0].id; S.pinNext = !!list[0].pinned; }
      const cur = list.find((q) => q.id === S.qSel);
      body += `<div class="qs">${list.map((q) => `<button class="q ${q.id === S.qSel ? 'on' : ''}" data-act="qsel" data-id="${esc(q.id)}"><div class="qa">${icon('user', 13)}</div><div><b>${esc(q.name)}</b>${q.pinned ? ` <span style="color:var(--gold)">${icon('pin', 11)}</span>` : ''}${q.hiddenFromSite ? ' <span class="hint">hidden</span>' : ''}<p>${esc(q.text)}</p></div><span class="when">${ago(q.at)}</span></button>`).join('')}</div>
      <div class="f"><label>Your answer to ${esc(cur.name)}</label><textarea class="in" id="ansbox" rows="5" placeholder="Type it like you'd text it…">${esc(S.ansDraft[cur.id] ?? cur.answer ?? '')}</textarea></div>
      <div class="two"><button class="tb2 ${S.pinNext ? 'on' : ''}" data-act="qpin">${icon('pin', 14)} ${S.pinNext ? 'Pinned' : 'Pin it'}</button><button class="ans" data-act="qanswer">${icon('send', 14)} ${cur.status === 'answered' ? 'Update' : 'Answer'}</button></div>
      <div class="acts">${cur.status === 'answered' ? `<button data-act="qhide">${icon(cur.hiddenFromSite ? 'eye' : 'eye-off', 13)} ${cur.hiddenFromSite ? 'Show on site' : 'Hide from site'}</button>` : ''}<button class="del" data-act="qdel">${icon('trash-2', 13)} Delete</button></div>`;
    }
  }
  return wrap('Your inbox', S.draft.sections.gpt.title, body);
}

function guestbookInspector(wrap) {
  const cs = S.inbox.comments; const pending = cs.filter((c) => c.status === 'pending');
  const rest = cs.filter((c) => c.status !== 'pending');
  const card = (c) => `<div class="mod"><div class="hd"><b style="font-size:12.5px;font-weight:500">${esc(c.name)}</b><span class="pill ${c.status === 'pending' ? 'g' : ''}">${c.status === 'pending' ? 'waiting' : c.status}</span></div>
    <p>${esc(c.text)}</p>${c.reply ? `<p style="color:var(--gold)">↳ ${esc(c.reply)}</p>` : ''}<p class="hint" style="margin-top:6px">${ago(c.at)} · ${c.hearts || 0} likes</p>
    ${S.replyOpen === c.id ? `<textarea class="in" id="reply-${esc(c.id)}" rows="2" style="margin-top:10px" placeholder="Reply as David…">${esc(c.reply || '')}</textarea><div class="acts"><button data-act="cm" data-id="${esc(c.id)}" data-a="reply" class="ok">${icon('send', 13)} Post reply</button><button data-act="replyopen" data-id="">Cancel</button></div>`
      : `<div class="acts">${c.status !== 'approved' ? `<button class="ok" data-act="cm" data-id="${esc(c.id)}" data-a="approve">${icon('check', 13)} Approve</button>` : ''}<button data-act="replyopen" data-id="${esc(c.id)}">${icon('message-circle', 13)} Reply</button>${c.status !== 'hidden' ? `<button data-act="cm" data-id="${esc(c.id)}" data-a="hide">${icon('eye-off', 13)} Hide</button>` : ''}<button class="del" data-act="cm" data-id="${esc(c.id)}" data-a="delete">${icon('trash-2', 13)}</button></div>`}</div>`;
  return wrap('Section', S.draft.sections.guestbook.title, [
    F.toggle('Show this section', 'sections.guestbook.hidden', true),
    F.toggle('Approve notes before they show', 'sections.guestbook.requireApproval'),
    `<div class="two">${F.text('Title', 'sections.guestbook.title')}${F.text('Gold part', 'sections.guestbook.em')}</div>`,
    `<div class="two">${F.text('Box title', 'sections.guestbook.head')}${F.text('Box text', 'sections.guestbook.sub')}</div>`,
    `<div class="flabel">Waiting (${pending.length})</div>${pending.length ? pending.map(card).join('') : '<div class="empty" style="padding:10px">Nothing waiting.</div>'}`,
    rest.length ? `<div class="flabel">Everything else</div>${rest.slice(0, 50).map(card).join('')}` : ''
  ].join(''));
}

// ---------- side ----------
function tree() {
  const d = S.draft, q = S.q.toLowerCase();
  const waitingQ = S.inbox.questions.filter((x) => x.status !== 'answered').length;
  const pendingC = S.inbox.comments.filter((x) => x.status === 'pending').length;
  const match = (t) => !q || t.toLowerCase().includes(q);
  const row = ({ id, name, ic, drag, hidePath, inv = true, extra = '', sub = false, chev = '' }) => {
    if (!match(name)) return '';
    const hidden = hidePath ? !!getP(hidePath) : false;
    return `<div class="row ${sub ? 'sub' : ''} ${S.sel === id ? 'sel' : ''} ${hidden ? 'off' : ''}" data-act="select" data-id="${esc(id)}" ${drag ? `draggable="true" data-drag="${esc(drag)}"` : ''}>
      ${drag ? `<span class="h">${icon('grip-vertical', 14)}</span>` : '<span style="width:14px"></span>'}${chev}${sub ? '' : `<span class="ic2">${icon(ic, 13)}</span>`}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
      <span class="e">${extra}${hidePath ? `<button data-act="toggle" data-path="${hidePath}" title="${hidden ? 'Show' : 'Hide'}">${icon(hidden ? 'eye-off' : 'eye', 14)}</button>` : ''}</span></div>`;
  };
  let html = row({ id: 'hero', name: 'Hero', ic: 'house' }) + row({ id: 'nowSpinning', name: 'Now spinning', ic: 'disc-3' }) + row({ id: 'rightNow', name: 'Right now', ic: 'clock' }) + row({ id: 'ticker', name: 'Ticker', ic: 'audio-lines', hidePath: 'ticker.hidden' });
  for (const k of d.order) {
    const [ic] = SECTION_META[k]; const sec = d.sections[k];
    const badge = k === 'gpt' && waitingQ ? `<span class="badge">${waitingQ} new</span>` : k === 'guestbook' && pendingC ? `<span class="badge">${pendingC} new</span>` : k === 'projects' ? `<span>${sec.items.length}</span>` : '';
    const chev = k === 'projects' ? `<button class="chev" data-act="expand" data-k="projects">${icon(S.expanded.projects ? 'chevron-down' : 'chevron-right', 13)}</button>` : '';
    html += row({ id: 'section:' + k, name: sec.title || SECTION_META[k][1], ic, drag: 'section:' + k, hidePath: `sections.${k}.hidden`, extra: badge, chev });
    if (k === 'projects' && (S.expanded.projects || q)) html += sec.items.map((p) => row({ id: 'project:' + p.id, name: p.title, sub: true, drag: 'project:' + p.id, hidePath: `sections.projects.items.${projIdx(p.id)}.hidden` })).join('');
  }
  return html;
}
function side() {
  const pendingC = S.inbox.comments.filter((x) => x.status === 'pending');
  const waitingQ = S.inbox.questions.filter((x) => x.status !== 'answered');
  const n = pendingC.length + waitingQ.length;
  const tabs = `<div class="tabs">${[['blocks', 'layout-grid', 'Blocks'], ['inbox', 'inbox', 'Inbox'], ['settings', 'settings-2', 'Settings']].map(([k, ic, t]) => `<button data-act="tab" data-v="${k}" class="${S.tab === k ? 'on' : ''}" title="${t}">${icon(ic, 16)}${k === 'inbox' && n ? `<sup>${n}</sup>` : ''}</button>`).join('')}</div>`;
  if (S.tab === 'inbox') {
    const items = [...pendingC.map((c) => ({ t: 'c', ...c })), ...waitingQ.map((q) => ({ t: 'q', ...q }))].sort((a, b) => b.at - a.at);
    return tabs + `<div class="scroll"><div class="qs">${items.length ? items.map((x) => `<button class="q" data-act="${x.t === 'q' ? 'goq' : 'goc'}" data-id="${esc(x.id)}"><div class="qa">${icon(x.t === 'q' ? 'sparkles' : 'message-circle', 13)}</div><div><b>${esc(x.name)}</b> <span class="hint">${x.t === 'q' ? 'asked' : 'signed the guestbook'}</span><p>${esc(x.text)}</p></div><span class="when">${ago(x.at)}</span></button>`).join('') : '<div class="empty">Inbox zero. Nothing waiting on you.</div>'}</div></div>`;
  }
  if (S.tab === 'settings') {
    return tabs + `<div class="scroll" style="display:flex;flex-direction:column;gap:14px">${F.text('Browser tab title', 'meta.title')}${F.area('Search / share description', 'meta.description')}
      <button class="tb" data-act="discard">${icon('undo-2', 14)} Throw away unpublished changes</button>
      <button class="tb" data-act="logout">${icon('log-out', 14)} Sign out</button></div>`;
  }
  const first = pendingC[0];
  return tabs + `<label class="search">${icon('search', 14)}<input id="treeq" placeholder="Find a block" value="${esc(S.q)}"></label>
    <div class="scroll"><div class="tree">${tree()}</div></div>
    <div style="position:relative">${S.addMenu ? `<div class="menu" style="position:absolute;bottom:52px;left:0;right:0;z-index:5">${[['project', 'layout-grid', 'Project'], ['post', 'pen-line', 'Post'], ['release', 'disc-3', 'Release'], ['social', 'link', 'Link'], ['status', 'clock', 'Status'], ['tick', 'audio-lines', 'Ticker item']].map(([k, ic, l]) => `<button data-act="add" data-kind="${k}">${icon(ic, 14)} ${l}</button>`).join('')}</div>` : ''}
    <button class="add" data-act="addmenu">${icon('plus', 15)} Add block</button></div>
    ${first ? `<div class="mod"><div class="hd"><span class="label">Waiting for you</span><span class="pill g">${pendingC.length} new</span></div><p><b>${esc(first.name)}</b> — ${esc(first.text.slice(0, 90))}${first.text.length > 90 ? '…' : ''}</p>
      <div class="acts"><button class="ok" data-act="cm" data-id="${esc(first.id)}" data-a="approve">Approve</button><button data-act="goc" data-id="${esc(first.id)}">Reply</button><button data-act="cm" data-id="${esc(first.id)}" data-a="hide">Hide</button></div></div>` : ''}`;
}

// ---------- top ----------
function top() {
  return `<div class="brand"><img class="mark" src="/logo.svg" alt=""><div class="crumb">${esc(location.host)} / <b>Editor</b></div></div>
    <div class="mid"><div class="seg">${[['desktop', 'monitor', 'Desktop'], ['tablet', 'tablet', 'Tablet'], ['phone', 'smartphone', 'Phone']].map(([k, ic, l]) => `<button data-act="device" data-v="${k}" class="${S.device === k ? 'on' : ''}">${icon(ic, 14)}<span>${l}</span></button>`).join('')}</div></div>
    <div class="right"><div class="saved ${S.save === 'saved' ? '' : S.save}" id="savestate"><i></i><span>${S.save === 'busy' ? 'Saving…' : S.save === 'err' ? 'Not saved' : S.unpublished ? 'Draft saved' : 'Published'}</span></div>
      <button class="ib" data-act="undo" ${S.hist.length ? '' : 'disabled'} title="Undo">${icon('undo-2', 16)}</button><button class="ib" data-act="redo" ${S.fut.length ? '' : 'disabled'} title="Redo">${icon('redo-2', 16)}</button>
      <a class="tb" href="/" target="_blank" rel="noopener">View site ${icon('arrow-up-right', 15)}</a>
      <button class="pub" data-act="publish" ${S.unpublished ? '' : 'disabled'}>${S.unpublished ? 'Publish' : 'Live'}</button></div>`;
}

// ---------- render ----------
function renderTop() { const el = document.getElementById('top'); if (el) el.innerHTML = top(); }
function renderAll() {
  if (!document.getElementById('top')) return;
  renderTop();
  const sc = document.querySelector('.side .scroll')?.scrollTop;
  document.getElementById('side').innerHTML = side();
  const s2 = document.querySelector('.side .scroll'); if (s2 && sc) s2.scrollTop = sc;
  const ib = document.getElementById('ibody')?.scrollTop;
  document.getElementById('insp').innerHTML = inspector();
  const ib2 = document.getElementById('ibody'); if (ib2 && ib) ib2.scrollTop = ib;
}
function shell() {
  root.innerHTML = `<div class="app"><header class="glass top" id="top"></header><div class="main">
    <aside class="glass side" id="side"></aside>
    <section class="glass canvas"><div class="chrome"><div class="lights"><i></i><i></i><i></i></div><div class="url">${icon('shield-check', 13)} <b>${esc(location.host)}</b></div><div class="zoom" id="zoom"></div></div>
      <div class="frame" id="frame"><iframe id="pv" src="/?preview=1" title="Preview"></iframe></div></section>
    <aside class="glass insp" id="insp"></aside></div></div>`;
  frame = document.getElementById('pv');
  new ResizeObserver(layoutFrame).observe(document.getElementById('frame'));
  renderAll(); layoutFrame();
}

// ---------- events ----------
function select(id) { S.sel = id; S.replyOpen = null; renderAll(); selectPreview(true); }
const ACT = {
  select: (el) => select(el.dataset.id),
  tab: (el) => { S.tab = el.dataset.v; S.addMenu = false; renderAll(); },
  expand: (el, e) => { e.stopPropagation(); S.expanded[el.dataset.k] = !S.expanded[el.dataset.k]; renderAll(); },
  device: (el) => { S.device = el.dataset.v; renderTop(); layoutFrame(); },
  undo, redo,
  toggle: (el, e) => { e.stopPropagation(); setP(el.dataset.path, !getP(el.dataset.path)); changed(); },
  setv: (el) => { setP(el.dataset.path, el.dataset.num ? Number(el.dataset.v) : el.dataset.v); changed(); },
  'item-open': (el) => { S.open[el.dataset.key] = !S.open[el.dataset.key]; renderAll(); },
  'item-move': (el, e) => { e.stopPropagation(); const a = getP(el.dataset.path); const i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; changed(); },
  'item-del': (el, e) => { e.stopPropagation(); const a = getP(el.dataset.path); const it = a[+el.dataset.i]; if (!confirm(`Delete "${it.text || it.title || it.label || it.verb || 'this'}"?`)) return; a.splice(+el.dataset.i, 1); if (el.dataset.path === 'rightNow.statuses') { if (S.draft.rightNow.activeId === it.id) S.draft.rightNow.activeId = ''; } changed(); },
  'item-add': (el) => { const it = MAKE[el.dataset.kind](); getP(el.dataset.path).push(it); S.open[el.dataset.path + ':' + (it.id || getP(el.dataset.path).length - 1)] = true; changed(); },
  addmenu: () => { S.addMenu = !S.addMenu; renderAll(); },
  add: (el) => {
    const k = el.dataset.kind; S.addMenu = false; const d = S.draft;
    const targets = { project: null, post: ['sections.notes.posts', 'section:notes'], release: ['sections.music.items', 'section:music'], social: ['sections.socials.items', 'section:socials'], status: ['rightNow.statuses', 'rightNow'], tick: ['ticker.items', 'ticker'] };
    if (k === 'project') { const p = MAKE.project(); d.sections.projects.items.push(p); S.expanded.projects = true; S.sel = 'project:' + p.id; }
    else { const [path, sel] = targets[k]; const it = MAKE[k](); const arr = getP(path); if (k === 'post') arr.unshift(it); else arr.push(it); S.open[path + ':' + it.id] = true; S.sel = sel; }
    changed(); selectPreview(true);
  },
  attach: (el) => { setP(el.dataset.path + '.attach', el.dataset.on === '1' ? { title: '', sub: '', cover: 'ember' } : null); changed(); },
  'status-set': (el) => { const rn = S.draft.rightNow; const id = el.dataset.id; if (rn.activeId && rn.activeId !== id) rn.previousId = rn.activeId; rn.activeId = id; rn.setAt = Date.now(); changed(); },
  'proj-dup': () => { const i = projIdx(S.sel.slice(8)); const items = S.draft.sections.projects.items; const c = { ...structuredClone(items[i]), id: uid(), title: items[i].title + ' copy' }; items.splice(i + 1, 0, c); S.sel = 'project:' + c.id; changed(); },
  'proj-del': () => { const i = projIdx(S.sel.slice(8)); const items = S.draft.sections.projects.items; if (!confirm(`Delete "${items[i].title}"?`)) return; items.splice(i, 1); S.sel = 'section:projects'; changed(); },
  gtab: (el) => { S.gptTab = el.dataset.v; S.qSel = null; renderAll(); },
  qsel: (el) => { S.qSel = el.dataset.id; const q = S.inbox.questions.find((x) => x.id === S.qSel); S.pinNext = !!q?.pinned; renderAll(); },
  qpin: async () => { S.pinNext = !S.pinNext; const q = S.inbox.questions.find((x) => x.id === S.qSel); if (q && q.status === 'answered') { await api(`/api/admin/questions/${q.id}`, { method: 'POST', body: { action: 'pin', pinned: S.pinNext } }); q.pinned = S.pinNext; refreshPublic(); } renderAll(); },
  qanswer: async (el) => {
    const text = document.getElementById('ansbox').value.trim(); if (!text) return toast('Type an answer first.');
    el.disabled = true; const wasWaiting = S.gptTab === 'waiting';
    try { await api(`/api/admin/questions/${S.qSel}`, { method: 'POST', body: { action: 'answer', answer: text, pinned: S.pinNext } }); delete S.ansDraft[S.qSel]; toast('Answered. It\'s on the site now.'); if (wasWaiting) S.qSel = null; await refreshInbox(); refreshPublic(); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  qhide: async () => { await api(`/api/admin/questions/${S.qSel}`, { method: 'POST', body: { action: 'hide' } }); await refreshInbox(); refreshPublic(); },
  qdel: async () => { if (!confirm('Delete this question?')) return; await api(`/api/admin/questions/${S.qSel}`, { method: 'POST', body: { action: 'delete' } }); S.qSel = null; await refreshInbox(); refreshPublic(); },
  replyopen: (el) => { S.replyOpen = el.dataset.id || null; renderAll(); if (S.replyOpen) document.getElementById('reply-' + S.replyOpen)?.focus(); },
  cm: async (el) => {
    const a = el.dataset.a, id = el.dataset.id; if (a === 'delete' && !confirm('Delete this note for good?')) return;
    const body = { action: a }; if (a === 'reply') body.reply = document.getElementById('reply-' + id)?.value || '';
    try { await api(`/api/admin/comments/${id}`, { method: 'POST', body }); S.replyOpen = null; toast({ approve: 'Approved.', hide: 'Hidden.', delete: 'Deleted.', reply: 'Reply posted.' }[a]); await refreshInbox(); refreshPublic(); } catch (e) { toast(e.message); }
  },
  goq: (el) => { S.tab = 'blocks'; S.sel = 'section:gpt'; S.gptTab = 'waiting'; S.qSel = el.dataset.id; renderAll(); selectPreview(true); },
  goc: (el) => { S.tab = 'blocks'; S.sel = 'section:guestbook'; S.replyOpen = el.dataset.id; renderAll(); selectPreview(true); },
  publish: async (el) => {
    el.disabled = true; el.textContent = 'Publishing…';
    try { await saveNow(); await api('/api/admin/publish', { method: 'POST' }); S.unpublished = false; toast('Published. It\'s live.'); } catch (e) { toast(e.message); }
    renderTop();
  },
  discard: async () => { if (!confirm('Throw away everything you haven\'t published?')) return; const r = await api('/api/admin/discard', { method: 'POST' }); S.draft = r.draft; S.snap = JSON.stringify(S.draft); S.hist = []; S.fut = []; S.unpublished = false; pushPreview(); renderAll(); toast('Back to the live version.'); },
  logout: async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); }
};
root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
  if (el.tagName === 'A') return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
});
function readField(el) {
  const k = el.dataset.kind;
  if (k === 'csv') return el.value.split(',').map((x) => x.trim()).filter(Boolean);
  if (k === 'tracks') return el.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, ...m] = l.split('|'); return { name: name.trim(), meta: m.join('|').trim() }; });
  return el.value;
}
root.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'ansbox') { S.ansDraft[S.qSel] = el.value; return; }
  if (el.id === 'treeq') { S.q = el.value; const t = document.querySelector('.tree'); if (t) t.innerHTML = tree(); return; }
  if (!el.dataset.path || el.tagName === 'SELECT') return;
  setP(el.dataset.path, readField(el)); changed({ full: false });
});
let labelT;
root.addEventListener('change', (e) => {
  const el = e.target; if (!el.dataset.path) return;
  setP(el.dataset.path, readField(el));
  if (el.tagName === 'SELECT') return changed();
  // Text fields: don't rebuild the panel (it would eat the click that caused the blur); just refresh list labels.
  changed({ full: false });
  clearTimeout(labelT); labelT = setTimeout(() => { const t = document.querySelector('.tree'); if (t) t.innerHTML = tree(); }, 250);
});
// drag to reorder (sections + projects)
let dragId = null;
root.addEventListener('dragstart', (e) => { const r = e.target.closest('[data-drag]'); if (!r) return; dragId = r.dataset.drag; e.dataTransfer.effectAllowed = 'move'; });
root.addEventListener('dragover', (e) => {
  const r = e.target.closest('[data-drag]'); if (!r || !dragId) return;
  if (r.dataset.drag.split(':')[0] !== dragId.split(':')[0]) return;
  e.preventDefault(); document.querySelectorAll('.row.drop').forEach((x) => x !== r && x.classList.remove('drop')); r.classList.add('drop');
});
root.addEventListener('dragleave', (e) => { const r = e.target.closest('[data-drag]'); if (r) r.classList.remove('drop'); });
root.addEventListener('drop', (e) => {
  const r = e.target.closest('[data-drag]'); if (!r || !dragId) return; e.preventDefault();
  const [type, from] = [dragId.split(':')[0], dragId.slice(dragId.indexOf(':') + 1)]; const to = r.dataset.drag.slice(r.dataset.drag.indexOf(':') + 1);
  if (type === 'section') { const o = S.draft.order; const i = o.indexOf(from); o.splice(i, 1); o.splice(o.indexOf(to), 0, from); }
  if (type === 'project') { const a = S.draft.sections.projects.items; const i = a.findIndex((p) => p.id === from); const [it] = a.splice(i, 1); a.splice(a.findIndex((p) => p.id === to), 0, it); }
  dragId = null; changed();
});
root.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.row.drop').forEach((x) => x.classList.remove('drop')); });
addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || !S.draft) return;
  if (e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if (e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
});

// ---------- login / boot ----------
function showLogin(msg = '') {
  root.innerHTML = `<div class="login"><form class="glass lcard" id="login"><img class="mark" src="/logo.svg" alt="" style="width:64px;height:64px;border-radius:18px"><h1>EDIT<br><span>THE SITE</span></h1><p>Only David gets past this part.</p>
    <input class="in" type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus>
    <button class="btnp" style="justify-content:center">Sign in</button><div class="err">${esc(msg)}</div></form></div>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('/api/admin/login', { method: 'POST', body: { password: f.password.value } }); boot(); }
    catch (err) { f.querySelector('.err').textContent = err.message; }
  });
}
async function boot() {
  const me = await api('/api/admin/me');
  if (!me.configured) { root.innerHTML = `<div class="login"><div class="glass lcard"><h1>ALMOST<br><span>THERE</span></h1><p>Set an <b>ADMIN_PASSWORD</b> variable on Railway, then reload this page.</p></div></div>`; return; }
  if (!me.admin) return showLogin();
  const [{ draft, unpublished }, inbox] = await Promise.all([api('/api/admin/draft'), api('/api/admin/inbox')]);
  Object.assign(S, { draft, unpublished, inbox, snap: JSON.stringify(draft) });
  shell(); refreshPublic();
  setInterval(async () => { try { S.inbox = await api('/api/admin/inbox'); if (!document.activeElement || !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) renderAll(); } catch {} }, 45000);
}
boot().catch((e) => { root.innerHTML = `<div class="login"><div class="glass lcard"><p>Couldn't load the editor: ${esc(e.message)}</p></div></div>`; });
