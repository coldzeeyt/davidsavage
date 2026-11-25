import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const safeUrl = (u) => { u = String(u || '').trim(); if (!u) return ''; if (/^(https?:|mailto:|#|\/)/i.test(u)) return u; return 'https://' + u; };
const ext = (u) => /^https?:/i.test(u);
const linkAttrs = (u) => { const h = safeUrl(u); return h ? `href="${esc(h)}"${ext(h) ? ' target="_blank" rel="noopener"' : ''}` : ''; };
const bgImg = (u) => { const h = safeUrl(u); return h && /^https?:|^\//.test(h) ? `background-image:url('${esc(h).replace(/'/g, '%27')}')` : ''; };

export function ago(ts) {
  const s = Math.max(1, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return Math.floor(m) + 'm ago';
  const h = m / 60; if (h < 24) return Math.floor(h) + 'h ago';
  const d = h / 24; if (d < 2) return 'yesterday'; if (d < 7) return Math.floor(d) + ' days ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const GRADS = [['#6de4e4', '#5b3df0'], ['#c8a84b', '#8a3d1c'], ['#fa2d48', '#c8a84b'], ['#4ade80', '#14304a'], ['#b0a6ff', '#2a1d6a'], ['#ff7a59', '#5b1d3a']];
const grad = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const g = GRADS[h % GRADS.length]; return `linear-gradient(135deg,${g[0]},${g[1]})`; };
let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

// ---------- project thumbnails ----------
export const THUMBS = ['turntable', 'playlists', 'eq', 'tiles', 'dial', 'aperture', 'number', 'cube', 'rings', 'tubes', 'pressing', 'text', 'image'];
function thumb(p) {
  seed = 7;
  if (p.thumb === 'image' && p.image) return `<div class="thumb" style="${bgImg(p.image)}"></div>`;
  switch (p.thumb) {
    case 'turntable': return `<div class="thumb" style="background:radial-gradient(circle at 25% 50%,rgba(91,61,240,.45),transparent 60%),#0d0d17"><div class="tt"></div><div class="arm"></div>
      <div class="room"><div class="listen"><i style="background:#6de4e4"></i><i style="background:#c8a84b"></i><i style="background:#fa2d48"></i><span style="margin-left:20px">3 listening in “late night”</span></div>
      <div class="msg"><i style="background:#c8a84b"></i>queue up the next one</div><div class="msg"><i style="background:#6de4e4"></i>this transition is insane</div></div></div>`;
    case 'playlists': { const rows = '<div></div>'.repeat(5); return `<div class="thumb"><div class="pl" style="left:22px"><b><i style="background:#1db954"></i>Spotify</b>${rows}</div><div class="swap">⇄</div><div class="pl" style="right:22px"><b><i style="background:#fa2d48"></i>Apple Music</b>${rows}</div></div>`; }
    case 'eq': return `<div class="thumb" style="background:radial-gradient(circle at 50% 120%,rgba(255,122,89,.35),transparent 60%),#0d0d17"><div class="eq">${Array.from({ length: 22 }, (_, i) => `<i style="height:${18 + Math.abs(Math.sin(i * .7 + 1)) * 70 + rnd() * 12}%;opacity:${.55 + rnd() * .45};animation-delay:-${(rnd() * 1.2).toFixed(2)}s"></i>`).join('')}</div></div>`;
    case 'tiles': return `<div class="thumb" style="background:linear-gradient(180deg,#141432,#0d0d17)"><div class="tiles">${Array.from({ length: 14 * 8 }, (_, i) => { const r = Math.floor(i / 14), c = i % 14; let s = ''; if (r >= 6) s = 'background:#3b2a6a'; if (r === 5 && (c < 3 || c > 9)) s = 'background:#5b3df0'; if (r === 3 && c > 5 && c < 9) s = 'background:#5b3df0'; if (r === 2 && c === 7) s = 'background:var(--gold);border-radius:3px'; if (r === 4 && c === 2) s = 'background:var(--cyan)'; return `<i style="${s}"></i>`; }).join('')}</div></div>`;
    case 'dial': return `<div class="thumb" style="background:radial-gradient(circle at 58% 30%,rgba(255,77,77,.2),transparent 50%),#0d0d17"><div class="dial"></div><div class="needle"></div><div class="stations"><span>Comedy</span><span>Skate</span><b>Gaming</b><span>Music</span><span>IRL</span></div></div>`;
    case 'rings': return `<div class="thumb" style="background:radial-gradient(circle at 50% 50%,rgba(0,220,255,.18),transparent 60%),#0d0d17"><div class="rings"><i></i><i></i><i></i><b></b></div></div>`;
    case 'pressing': return `<div class="thumb" style="background:radial-gradient(circle at 70% 50%,rgba(255,159,46,.22),transparent 55%),#0d0d17"><div class="press"><div class="lbl"><b>${esc(p.thumbText || '#048')}</b><span>of 100</span></div></div></div>`;
    case 'tubes': return `<div class="thumb" style="background:radial-gradient(circle at 50% 120%,rgba(255,59,74,.28),transparent 60%),#0d0d17"><div class="tubes">${Array.from({ length: 24 }, (_, i) => `<i style="animation-delay:${(i * .09).toFixed(2)}s"></i>`).join('')}</div></div>`;
    case 'aperture': return `<div class="thumb"><div class="icon" style="color:var(--soft)">${icon('aperture', 64)}</div></div>`;
    case 'number': return `<div class="thumb"><div class="icon" style="font-family:var(--display);font-size:64px;color:var(--gold)">${esc(p.thumbText || '1,024')}</div></div>`;
    case 'cube': return `<div class="thumb" style="background:linear-gradient(180deg,#1c0f3a,#0d0d17)"><div class="icon"><div class="cube"></div></div></div>`;
    case 'text': return `<div class="thumb"><div class="icon" style="font-family:var(--display);font-size:30px;letter-spacing:2px;color:var(--soft)">${esc(p.thumbText || '')}</div></div>`;
    default: return '';
  }
}

// ---------- blocks ----------
function nav(site) {
  const map = { projects: ['builds', 'Builds'], notes: ['notes', 'Notes'], gpt: ['ask', 'DavidGPT'], music: ['music', 'Music'], label: ['label', 'Label'], guestbook: ['guestbook', 'Guestbook'] };
  const links = site.order.filter((k) => map[k] && !site.sections[k].hidden).map((k) => `<a href="#${map[k][0]}">${map[k][1]}</a>`).join('');
  const parts = String(site.hero.name || '').trim().split(/\s+/);
  const logo = parts.length > 1 ? `${esc(parts[0])}<span>.</span>${esc(parts.slice(1).join(' '))}` : esc(parts[0] || '');
  return `<nav class="glass top"><a class="logo" href="#top"><img src="/logo.svg" alt="" width="38" height="38"><span class="lt">${logo}</span></a><div class="links"><a href="#top" class="on">Home</a>${links}</div><a class="go" href="/edit" aria-label="Edit site">${icon('pencil', 16)}</a></nav>`;
}

function hero(site) {
  const h = site.hero, n = site.nowSpinning;
  const words = String(h.name || '').trim().split(/\s+/);
  const name = words.length > 1 ? esc(words[0]) + '<br>' + esc(words.slice(1).join(' ')) : esc(h.name);
  const sleeveStyle = n.image ? bgImg(n.image) : '';
  return `<section class="hero" id="top">
  <div class="glass heroL rv" data-block="hero">
    ${h.eyebrow ? `<div class="tag"><span class="dot"></span>${esc(h.eyebrow)}</div>` : ''}
    <h1>${h.kicker ? `<em>${esc(h.kicker)}</em>` : ''}${name}</h1>
    <p class="bio">${md(h.bio)}</p>
    <div class="cta">
      ${h.primary?.label ? `<a class="btnp" ${linkAttrs(h.primary.link)}>${esc(h.primary.label)} ${icon('arrow-down', 15)}</a>` : ''}
      ${h.secondary?.label ? `<a class="btng" ${linkAttrs(h.secondary.link)}>${icon('play', 14)} ${esc(h.secondary.label)}</a>` : ''}
    </div>
  </div>
  <div class="heroR">
    <div class="glass nowplay rv" data-block="nowSpinning">
      <div class="label">${esc(n.label)}</div>
      <div class="deck"><div class="vinyl"></div><div class="sleeve ${n.image ? '' : 'cv-' + esc(n.cover)}" style="${sleeveStyle}">${n.image ? '' : `<small>${esc(n.coverLabel)}</small><b>${esc(n.coverText)}</b>`}</div></div>
      <div class="np"><div><b>${esc(n.title)}</b><small>${esc(n.sub)}</small></div>${n.link ? `<a class="go" ${linkAttrs(n.link)} aria-label="Listen">${icon('play', 16)}</a>` : ''}</div>
    </div>
    ${rightNow(site)}
  </div>
</section>`;
}

export function activeStatus(rn) {
  const s = rn.statuses.find((x) => x.id === rn.activeId);
  if (!s) return null;
  if (rn.clearAfterHours > 0 && Date.now() - (rn.setAt || 0) > rn.clearAfterHours * 36e5) return null;
  return s;
}
function rightNow(site) {
  const rn = site.rightNow; const a = activeStatus(rn); const p = rn.statuses.find((x) => x.id === rn.previousId && x.id !== rn.activeId);
  return `<div class="glass now rv" data-block="rightNow">
      <div class="srch"><span class="label">${esc(rn.label)}</span>${a ? `<span class="label" style="letter-spacing:1.5px">set ${ago(rn.setAt)}</span>` : ''}</div>
      ${a ? `<div class="st big"><div class="emo2">${icon(a.icon, 22)}</div><div><b>${esc(a.text)}</b>${a.note ? `<small>${esc(a.note)}</small>` : ''}</div></div>`
          : `<div class="st big empty"><div class="emo2">${icon('moon', 22)}</div><div><b>Off the grid</b><small>Nothing going on right now</small></div></div>`}
      ${p ? `<div class="st"><div class="emo2 c">${icon(p.icon, 20)}</div><div><b>${esc(p.text)}</b><small>Earlier</small></div></div>` : ''}
    </div>`;
}

function ticker(site) {
  const t = site.ticker; if (t.hidden) return '';
  const items = [...t.items];
  const a = activeStatus(site.rightNow);
  if (site.rightNow.showInTicker && a) { const [v, ...rest] = a.text.split(' '); items.unshift({ icon: a.icon, verb: v, text: rest.join(' '), when: ago(site.rightNow.setAt) }); }
  if (!items.length) return '';
  const one = items.map((i) => `<span class="it"><span class="ti">${icon(i.icon, 15)}</span><b>${esc(i.verb)}</b> ${esc(i.text)}${i.when ? `<small>${esc(i.when)}</small>` : ''}</span>`).join('<em>✦</em>') + '<em>✦</em>';
  const dur = Math.max(20, items.length * 9);
  return `<div class="glass ticker rv" data-block="ticker"><div class="live"><i></i>${esc(t.label)}</div><div class="track"><div class="belt" style="--dur:${dur}s"><div>${one}</div><div aria-hidden="true">${one}</div></div></div></div>`;
}

function head(s, right = '') { return `<div class="sechead"><h2>${esc(s.title)}${s.em ? `<em>${esc(s.em)}</em>` : ''}</h2>${right}</div>`; }

function projects(site) {
  const s = site.sections.projects; const items = s.items.filter((p) => !p.hidden);
  const counts = {}; items.forEach((p) => (p.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const tags = Object.keys(counts).filter((t) => counts[t] > 1).slice(0, 6);
  const filters = tags.length ? `<div class="glass filters"><button class="on" data-filter="">All</button>${tags.map((t) => `<button data-filter="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : '';
  const cards = items.map((p) => {
    const tag = p.link ? 'a' : 'div';
    return `<${tag} class="glass card w-${esc(p.width || 'm')} rv" data-block="project:${esc(p.id)}" data-tags="${esc((p.tags || []).join('|'))}" ${p.link ? linkAttrs(p.link) : ''}>
      ${thumb(p)}<h3>${esc(p.title)}</h3>${p.desc ? `<p>${esc(p.desc)}</p>` : ''}
      <div class="meta"><div class="tags">${(p.tags || []).map((t, i) => `<span class="pill${/progress|soon|client/i.test(t) || i > 0 ? ' g' : ''}">${esc(t)}</span>`).join('')}</div>${p.link ? `<span class="go">${icon('arrow-up-right', 17)}</span>` : ''}</div>
    </${tag}>`;
  }).join('');
  return `<section class="sec" id="builds" data-block="section:projects">${head(s, filters)}<div class="grid">${cards}</div></section>`;
}

function notes(site, data) {
  const s = site.sections.notes; const posts = [...s.posts].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const flames = data.flames || {};
  const tagOn = (t) => /music/i.test(t) ? ' g' : '';
  return `<section class="sec" id="notes" data-block="section:notes">${head(s)}
  <div class="notes">
    <div class="glass pin rv"><div style="display:flex;justify-content:space-between;align-items:center"><span class="label">Pinned</span><span class="pill g">${icon('pin', 12)}</span></div>
      <div class="q">${esc(s.pinned)}</div>
      <div class="sig"><div class="av">${esc((site.hero.name || 'D')[0])}</div><div><b>${esc(site.hero.name)}</b><small>${esc(s.handle)}</small></div></div></div>
    <div class="posts">${posts.length ? '' : `<div class="glass post rv" style="display:block;color:var(--dim);font-size:13px">Nothing posted yet.</div>`}${posts.map((p) => { const d = new Date(p.date + 'T12:00:00'); const ok = !isNaN(d);
      return `<div class="glass post rv"><div class="date"><b>${ok ? d.getDate() : ''}</b><span>${ok ? d.toLocaleString('en', { month: 'short' }).toUpperCase() : ''}</span></div><div>
        ${p.tag ? `<span class="pill${tagOn(p.tag)}">${esc(p.tag)}</span>` : ''}<p>${esc(p.text)}</p>
        ${p.attach && p.attach.title ? `<div class="att"><i class="cv-${esc(p.attach.cover || 'ember')}"></i><div>${esc(p.attach.title)}<small>${esc(p.attach.sub)}</small></div></div>` : ''}
        <div class="rx"><button data-flame="${esc(p.id)}" aria-label="Fire">${icon('flame', 14)} <span>${flames[p.id] || 0}</span></button></div></div></div>`; }).join('')}</div>
  </div></section>`;
}

function gpt(site, data, mine) {
  const s = site.sections.gpt;
  const answered = [...(data.questions || [])].sort((a, b) => (b.pinned - a.pinned) || (a.answeredAt - b.answeredAt));
  const initial = esc((site.hero.name || 'D')[0]);
  const first = esc(String(site.hero.name || 'David').split(' ')[0]);
  let msgs = answered.map((q) => `<div class="you"><small>${esc(q.name)}${q.pinned ? ' · pinned' : ''}</small>${esc(q.text)}</div>
      <div class="bot"><p>${esc(q.answer)}</p><div class="by"><span class="dl xs">${initial}</span>${first} · answered ${ago(q.answeredAt)}</div></div>`).join('');
  const answeredIds = new Set(answered.map((q) => q.id));
  msgs += (mine || []).filter((q) => !answeredIds.has(q.id)).map((q) => `<div class="you"><small>${esc(q.name)}</small>${esc(q.text)}</div><div class="sent">${icon('check', 13)} Sent. ${first} will answer right here</div>`).join('');
  if (!msgs) msgs = `<div class="emptyq">No questions yet. Ask ${first} anything and the answer shows up right here.</div>`;
  return `<section class="sec" id="ask" data-block="section:gpt">${head(s)}
  <div class="gpt">
    <div class="glass gl rv">
      <div class="orb"><span class="dl">${initial}</span></div>
      <h3>${esc(s.head1)}<br><span>${esc(s.head2)}</span></h3>
      <p>${esc(s.blurb)}</p>
      ${s.starters.length ? `<div class="label" style="margin-top:26px">Try asking</div><div class="sugg">${s.starters.map((q) => `<button class="sq" data-ask="${esc(q.text)}">${icon(q.icon, 16)}${esc(q.text)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="glass chat rv">
      <div class="ch"><div class="orb s"><span class="dl">${initial}</span></div><div><b>${esc(s.title)}</b><small><i></i>Real human · ${esc(s.replyTime)}</small></div></div>
      <div class="msgs" id="msgs">${msgs}</div>
      <form class="ask" id="askform" autocomplete="off">
        <input class="qin" name="text" maxlength="500" placeholder="Ask ${first} anything…" required>
        <label class="nm">${icon('user', 14)}<input name="name" maxlength="40" placeholder="${s.allowAnonymous ? 'Name (optional)' : 'Your name'}" ${s.allowAnonymous ? '' : 'required'}></label>
        <input class="hp" name="website" tabindex="-1" aria-hidden="true">
        <button class="sendb" aria-label="Send">${icon('send', 17)}</button>
      </form>
    </div>
  </div></section>`;
}

function music(site) {
  const s = site.sections.music;
  return `<section class="sec" id="music" data-block="section:music">${head(s)}<div class="music" style="--n:${Math.min(Math.max(s.items.length, 1), 4)}">${s.items.map((m) => {
    const tag = m.link ? 'a' : 'div';
    return `<${tag} class="glass rel rv" ${m.link ? linkAttrs(m.link) : ''}>
      <div class="cover ${m.image ? '' : 'cv-' + esc(m.cover)}" style="${m.image ? bgImg(m.image) : ''}">${m.image ? '' : `<small>${esc(m.coverLabel)}</small><b>${esc(m.coverText)}</b>`}${m.badge ? `<span class="pill${/out|new/i.test(m.badge) ? ' g' : ''}">${esc(m.badge)}</span>` : ''}</div>
      <h4>${esc(m.title)}</h4><small class="s">${esc(m.sub)}</small>
      ${(m.tracks || []).map((t) => `<div class="tr">${esc(t.name)}<span>${esc(t.meta)}</span></div>`).join('')}
    </${tag}>`; }).join('')}</div></section>`;
}

function label(site) {
  const s = site.sections.label; if (!s) return '';
  const roster = s.artists.map((a) => {
    const tag = a.link ? 'a' : 'div';
    return `<${tag} class="glass artist rv" ${a.link ? linkAttrs(a.link) : ''}>
      <div class="acov ${a.image ? '' : 'cv-' + esc(a.cover || 'mono')}" style="${a.image ? bgImg(a.image) : ''}">${a.image ? '' : `<b>${esc(a.name)}</b>`}</div>
      <div class="ainfo"><span class="pill g">Signed</span><h4>${esc(a.name)}</h4><small>${esc(a.genre)}</small>${a.desc ? `<p>${esc(a.desc)}</p>` : ''}</div>
      ${a.link ? `<span class="go">${icon('arrow-up-right', 17)}</span>` : ''}
    </${tag}>`;
  }).join('');
  const form = s.formOpen ? `<form class="glass apply rv" id="applyform" autocomplete="off">
      <div class="label">Applications open</div>
      <h3>${esc(s.formTitle)}</h3><p>${esc(s.formSub)}</p>
      <div class="arow"><input class="input" name="artist" maxlength="60" placeholder="Artist name" required><input class="input" name="email" type="email" maxlength="120" placeholder="Email" required></div>
      <div class="arow"><input class="input" name="link" maxlength="300" placeholder="Link to your music" required><input class="input" name="genre" maxlength="60" placeholder="Genre"></div>
      <textarea class="input" name="about" maxlength="1500" placeholder="Tell us about you and what you're working on…"></textarea>
      <input class="hp" name="website" tabindex="-1" aria-hidden="true">
      <div class="send"><span class="formmsg" id="applymsg"></span><button class="btnp">Send application ${icon('send', 14)}</button></div>
    </form>`
    : `<div class="glass apply rv"><div class="label">Applications</div><h3>${esc(s.formTitle)}</h3><p>${esc(s.closedText)}</p></div>`;
  return `<section class="sec" id="label" data-block="section:label">${head(s)}
    ${s.blurb ? `<p class="lblurb rv">${esc(s.blurb)}</p>` : ''}
    <div class="labelgrid"><div class="roster"><div class="label" style="margin-bottom:2px">Current roster · ${s.artists.length}</div>${roster}</div>${form}</div></section>`;
}

function socials(site) {
  const s = site.sections.socials;
  return `<section class="sec" id="links" data-block="section:socials">${head(s)}<div class="socials">${s.items.map((l) =>
    `<a class="glass soc rv" ${linkAttrs(l.link)}><div class="si">${icon(l.icon, 22)}</div><div><b>${esc(l.label)}</b><small>${esc(l.sub)}</small></div><span class="go">${icon('arrow-up-right', 17)}</span></a>`).join('')}</div></section>`;
}

function guestbook(site, data) {
  const s = site.sections.guestbook; const g = data.guestbook || { count: 0, items: [] };
  const first = esc(String(site.hero.name || 'David').split(' ')[0]);
  const list = g.items.length ? g.items.map((c) => `<div class="cm"><div class="av" style="background:${grad(c.name)}">${esc((c.name || '?')[0].toUpperCase())}</div><div>
      <b>${esc(c.name)}</b><time>${ago(c.at)}</time>${c.react ? `<span style="color:var(--gold);margin-left:8px;display:inline-block;vertical-align:-3px">${icon(c.react, 14)}</span>` : ''}<p>${esc(c.text)}</p>
      ${c.reply ? `<div class="reply"><b>${first}</b> · ${esc(c.reply)}</div>` : ''}
      <div class="rx"><button data-heart="${esc(c.id)}" aria-label="Like">${icon('heart', 13)} <span>${c.hearts || 0}</span></button></div></div></div>`).join('')
    : `<div class="empty">No notes yet. Be the first one.</div>`;
  return `<section class="sec" id="guestbook" data-block="section:guestbook">${head(s, `<div class="label">${g.count} note${g.count === 1 ? '' : 's'}</div>`)}
  <div class="comments">
    <form class="glass compose rv" id="gbform" autocomplete="off">
      <h3>${esc(s.head)}</h3><p>${esc(s.sub)}</p>
      <input class="input" name="name" maxlength="40" placeholder="Your name" required>
      <textarea class="input" name="text" maxlength="600" placeholder="What's up ${first}…" required></textarea>
      <input class="hp" name="website" tabindex="-1" aria-hidden="true">
      <div class="send"><div class="emo" role="radiogroup">${['flame', 'heart', 'disc-3', 'gamepad-2'].map((r, i) => `<button type="button" data-react="${r}" class="${i === 0 ? 'on' : ''}" aria-label="${r}">${icon(r, 17)}</button>`).join('')}</div><button class="btnp">Post it</button></div>
      <div class="formmsg" id="gbmsg"></div>
    </form>
    <div class="glass feed rv" id="gbfeed">${list}</div>
  </div></section>`;
}

export function renderSite(data, { mine = [] } = {}) {
  const site = data.site;
  const blocks = { projects, notes: (s) => notes(s, data), gpt: (s) => gpt(s, data, mine), music, label, socials, guestbook: (s) => guestbook(s, data) };
  const body = site.order.filter((k) => blocks[k] && !site.sections[k].hidden).map((k) => blocks[k](site)).join('\n');
  return `<div class="wrap">${nav(site)}${hero(site)}${ticker(site)}${body}</div>`;
}
