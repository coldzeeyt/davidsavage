{
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(window.ICONS || {})[n] || ''}</svg>`;
const paintIcons = (root = document) => root.querySelectorAll('[data-i]').forEach((el) => { el.outerHTML = icon(el.dataset.i); });
paintIcons();

const store = { get(k, d) { try { return JSON.parse(localStorage.getItem('facet:' + k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('facet:' + k, JSON.stringify(v)); } catch {} } };
const prefs = Object.assign({ hair: 'short', beard: 'full' }, store.get('prefs', {}));

const el = { stage: $('#stage'), idle: $('#idle'), video: $('#video'), guide: $('#guide'), canvas: $('#canvas'), busy: $('#busy'), busyText: $('#busyText'), err: $('#err'),
  actions: $('#actions'), camActions: $('#camActions'), views: $('#views'), intro: $('#intro'), results: $('#results'), reset: $('#resetBtn'), amb: $('#ambPhoto') };

// ---------- model ----------
let modelReady = null;
const loadModels = () => modelReady ||= (async () => {
  const fa = window.faceapi;
  try { await fa.tf.setBackend('webgl'); } catch {}
  await fa.tf.ready();
  if (fa.tf.getBackend() !== 'webgl') { try { await fa.tf.setBackend('cpu'); await fa.tf.ready(); } catch {} }
  await Promise.all([fa.nets.ssdMobilenetv1.loadFromUri('models'), fa.nets.faceLandmark68Net.loadFromUri('models')]);
  // Run once on a blank image so the first real photo doesn't pay for shader setup.
  try { const w = document.createElement('canvas'); w.width = w.height = 160; await fa.detectAllFaces(w, new fa.SsdMobilenetv1Options({ minConfidence: .5 })); } catch {}
})();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
loadModels().catch(() => {});

// ---------- geometry ----------
const mean = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (r) => r * 180 / Math.PI;
// The 68-point model places eye corners and nostril points slightly inside the true anatomical points.
// These factors bring its raw ratios onto the clinical scale the typical ranges use.
const CAL = { thirds: 1.1, spacing: 1 / 1.5, nose: 1 / .63 };
const PAIRS = [[0,16],[1,15],[2,14],[3,13],[4,12],[5,11],[6,10],[7,9],[17,26],[18,25],[19,24],[20,23],[21,22],[36,45],[37,44],[38,43],[39,42],[40,47],[41,46],[31,35],[32,34],[48,54],[49,53],[50,52],[59,55],[58,56]];
const GROUPS = { brows: [8,9,10,11,12], eyes: [13,14,15,16,17,18], nose: [19,20], mouth: [21,22,23,24,25], jaw: [0,1,2,3,4,5,6,7] };

function measure(raw, imgW) {
  const eL0 = mean(raw.slice(36, 42)), eR0 = mean(raw.slice(42, 48));
  const roll = Math.atan2(eR0.y - eL0.y, eR0.x - eL0.x);
  const c = { x: (eL0.x + eR0.x) / 2, y: (eL0.y + eR0.y) / 2 };
  const cos = Math.cos(-roll), sin = Math.sin(-roll);
  const P = raw.map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }));
  const back = (p) => { const co = Math.cos(roll), si = Math.sin(roll); return { x: c.x + (p.x - c.x) * co - (p.y - c.y) * si, y: c.y + (p.x - c.x) * si + (p.y - c.y) * co }; };

  const eL = mean(P.slice(36, 42)), eR = mean(P.slice(42, 48));
  const ipd = eR.x - eL.x;
  const faceW = P[16].x - P[0].x;
  const cheekW = dist(P[1], P[15]);
  const jawW = dist(P[4], P[12]);
  const gl = mean([P[21], P[22]]), sn = P[33], me = P[8], st = mean([P[62], P[66]]);
  const mid = sn.y - gl.y, lower = me.y - sn.y;
  const icd = P[42].x - P[39].x;
  const eyeW = ((P[39].x - P[36].x) + (P[45].x - P[42].x)) / 2;
  const tiltA = deg(Math.atan2(P[39].y - P[36].y, P[39].x - P[36].x));
  const tiltB = deg(Math.atan2(P[42].y - P[45].y, P[45].x - P[42].x));
  const noseW = dist(P[31], P[35]);
  const mouthW = dist(P[48], P[54]);
  const upLip = P[62].y - P[51].y, loLip = P[57].y - P[66].y;
  const eyeY = (eL.y + eR.y) / 2;

  const midX = mean([27, 28, 29, 30, 33, 51, 57, 62, 66, 8].map((i) => P[i])).x;
  const devs = PAIRS.map(([a, b]) => Math.hypot((2 * midX - P[b].x) - P[a].x, P[b].y - P[a].y) / faceW);
  const sym = devs.reduce((s, d) => s + d, 0) / devs.length * 100;
  const grp = Object.fromEntries(Object.entries(GROUPS).map(([k, ix]) => [k, ix.reduce((s, i) => s + devs[i], 0) / ix.length * 100]));
  const worst = Object.entries(grp).sort((a, b) => b[1] - a[1])[0];
  const browDiff = (mean(P.slice(17, 22)).y - mean(P.slice(22, 27)).y) / faceW * 100;
  const eyeDiff = (eL.y - eR.y) / faceW * 100;
  const mouthDiff = (P[48].y - P[54].y) / faceW * 100;

  const yaw = (P[30].x - (P[0].x + P[16].x) / 2) / faceW;
  const lenEst = (me.y - gl.y) * 1.5;
  return {
    P, back, midX, eL, eR, gl, sn, me, st, roll: deg(roll), yaw, faceWpx: faceW, imgW,
    v: {
      sym, symGroups: grp, worst, browDiff, eyeDiff, mouthDiff,
      tilt: (tiltA + tiltB) / 2, tiltA, tiltB,
      thirds: lower / mid * CAL.thirds,
      chin: (me.y - st.y) / (st.y - sn.y),
      spacing: icd / eyeW * CAL.spacing,
      midface: ipd / (P[51].y - eyeY),
      fwhr: cheekW / (P[51].y - gl.y),
      nose: noseW / icd * CAL.nose,
      mouth: mouthW / noseW,
      lips: loLip / Math.max(upLip, 1),
      jaw: jawW / cheekW,
      lw: lenEst / cheekW,
      brow: dist(P[17], P[26]) / cheekW
    }
  };
}

function faceShape(v) {
  if (v.lw > 1.5 && v.jaw >= .84) return 'oblong';
  if (v.lw > 1.45) return v.jaw < .8 ? 'oval' : 'oblong';
  if (v.lw < 1.28) return v.jaw >= .86 ? 'square' : 'round';
  if (v.jaw < .78 && v.brow > .84) return 'heart';
  if (v.jaw < .78 && v.brow < .74) return 'diamond';
  if (v.jaw >= .88) return 'square';
  return 'oval';
}

// ---------- copy ----------
const SHAPES = {
  oval: { line: 'Length a little over width, jaw narrower than the cheekbones. The most forgiving shape for hair and frames.',
    hair: ['Almost any cut works, so pick by hair type, not face shape.', 'Keep the sides tidier than the top so the shape stays balanced.', 'If you want an edge, a textured crop or a mid fade adds definition without changing the balance.'],
    beard: 'Short boxed beard or heavy stubble keeps the natural shape. Avoid anything that adds a lot of width at the cheeks.',
    frames: 'Most frames fit. Match the frame width to your face width.' },
  round: { line: 'Width close to length with soft angles at the jaw. Structure comes from adding height and corners.',
    hair: ['Build height on top: quiff, textured pomp or a crop pushed up.', 'Go tight on the sides — a low or mid fade.', 'Skip heavy fringes and bowl shapes, they make the face read wider.'],
    beard: 'Keep cheeks short and let the chin run a bit longer to add length and an edge to the jaw.',
    frames: 'Rectangular or squared frames, slightly wider than your cheekbones.' },
  square: { line: 'Strong, wide jaw close to the cheekbone width. Lean into it instead of hiding it.',
    hair: ['Textured top with some movement softens the corners.', 'A short side part or a crew cut both suit this shape.', 'Avoid very flat, blunt cuts that repeat the square lines.'],
    beard: 'Stubble or a short beard. You already have the jaw, so keep it close and clean at the neckline.',
    frames: 'Round or oval frames to balance the angles.' },
  oblong: { line: 'Noticeably longer than wide. The goal is adding width and breaking up the length.',
    hair: ['Bring some fringe forward to shorten the forehead.', 'Keep volume at the sides; skip tall quiffs and high-skin fades.', 'Medium-length layers work better than very short sides.'],
    beard: 'Fuller on the cheeks, shorter at the chin. A long chin beard makes the face look longer.',
    frames: 'Deep frames with some height, or bold top bars.' },
  heart: { line: 'Wider at the forehead and cheekbones, tapering to a narrower chin.',
    hair: ['A fringe or side-swept top takes width off the forehead.', 'Medium length on the sides balances a narrow chin.', 'Avoid very tight sides with a big top, that exaggerates the taper.'],
    beard: 'A fuller beard at the chin and jaw fills out the lower face.',
    frames: 'Bottom-heavy, round or rimless frames.' },
  diamond: { line: 'Cheekbones are the widest point, with a narrower forehead and jaw.',
    hair: ['Add width at the forehead with a textured fringe.', 'Keep some fullness at the sides rather than a skin fade.', 'Slicked-back styles show off the cheekbones but expose a narrow forehead.'],
    beard: 'A beard that is fuller at the chin widens the lower face to match the cheeks.',
    frames: 'Oval or browline frames.' }
};
const fmt = { pct: (v) => v.toFixed(1) + '%', deg: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '°', x: (v) => v.toFixed(2) + '×' };
const side = (d, a, b) => (d < 0 ? a : b);

const METRICS = [
  { k: 'sym', name: 'Symmetry', f: fmt.pct, band: [0, 3.5], dom: [0, 9], w: .6, unit: 'average mismatch, % of face width',
    read: (v, m) => m.turned ? 'Not reliable on this photo — your head is turned.' : v <= 3.5 ? 'Typical. Most faces sit around 2–4%, and nobody notices under that.' : `More uneven than average, mostly in the ${m.v.worst[0]}.`,
    explain: 'How far each point on one side lands from its mirror on the other side.',
    fix: (v, m) => {
      if (m.turned) return null;
      const g = m.v.worst[0];
      const steps = [];
      if (g === 'brows') steps.push(`Your brow on the ${side(m.v.browDiff, 'left', 'right')} of the photo sits higher. Groom or fill the lower brow's arch slightly higher to even them out.`);
      if (g === 'eyes') steps.push('One eye sits a touch higher. Sleep on your back for a few weeks; side-sleeping causes morning puffiness on one side.');
      if (g === 'mouth') steps.push(`The mouth corner on the ${side(m.v.mouthDiff, 'right', 'left')} of the photo sits lower. Chew on both sides, and check your resting expression in a mirror.`);
      if (g === 'jaw' || g === 'nose') steps.push('Part your hair on the fuller side; it draws the eye across the face evenly.');
      steps.push('Retake once with your head perfectly level. A slight turn adds a lot of fake asymmetry.');
      steps.push('If one side of your jaw clicks, hurts or is clearly bigger, see a dentist — clenching can enlarge one jaw muscle.');
      return { t: 'Even out the asymmetry', why: 'Bone asymmetry stays, but brows, sleep and chewing habits move the parts people actually notice.', steps };
    } },
  { k: 'tilt', name: 'Eye tilt', f: fmt.deg, band: [1, 8], dom: [-8, 14], w: .8, unit: 'outer eye corner above the inner corner',
    read: (v) => v < 1 ? (v < -1 ? 'Negative tilt — the outer corners sit lower.' : 'Neutral, close to flat.') : v > 8 ? 'Strongly positive.' : 'Positive, the most common range.',
    explain: 'The angle from the inner corner of each eye to the outer corner, measured against your eye line.',
    fix: (v) => v >= 1 ? null : { t: 'Lift the eye area', why: 'Tilt is bone and lid shape, but the brows and skin around the eye change how lifted the area reads.',
      steps: ['Shape your brows so the tail ends slightly higher than the start, and remove hairs that droop below the tail.', 'Sleep 7–9 hours and cut late salt and alcohol; under-eye puffiness pulls the outer corners down.', 'Use an eye cream with caffeine or a cold compress in the morning for puffiness.', 'Lasting change here is only surgical. Treat the internet\'s canthoplasty hype with a lot of caution.'] } },
  { k: 'thirds', name: 'Lower vs middle third', f: fmt.x, band: [.93, 1.1], dom: [.7, 1.35], w: 1, unit: 'nose-to-chin ÷ brow-to-nose',
    read: (v) => v < .93 ? 'Your lower face is shorter than your midface.' : v > 1.1 ? 'Your lower face is longer than your midface.' : 'Balanced.',
    explain: 'Faces read as balanced when brow-to-nose and nose-to-chin are roughly equal.',
    fix: (v) => v >= .93 && v <= 1.1 ? null : v < .93
      ? { t: 'Add length to the lower face', why: 'A short lower third often goes with a less defined chin. Facial hair and fat loss are your levers.',
        steps: [prefs.beard === 'none' ? 'Keep the jawline clean-shaven and sharp; stubble shadow at the chin adds length.' : 'Grow the chin a little longer than the cheeks so the beard adds length downward.', 'Lower body fat sharpens the chin and jaw more than anything else on this list.', 'Practice good posture: forward head posture squashes the lower face in photos.'] }
      : { t: 'Shorten a long lower face', why: 'Balance it by adding visual weight up top and keeping the chin short.',
        steps: [prefs.beard === 'none' ? 'Stay clean-shaven at the chin; a goatee adds length.' : 'Keep the chin short and the cheeks fuller. Avoid a long, pointed beard.', 'Add volume to the sides of your hair rather than height on top.', 'Close your lips at rest; mouth breathing lengthens the lower face over time and in photos.'] } },
  { k: 'chin', name: 'Chin to upper lip', f: fmt.x, band: [1.7, 2.4], dom: [1, 3.2], w: .7, unit: 'lips-to-chin ÷ nose-to-lips',
    read: (v) => v < 1.7 ? 'Chin is short compared with the upper lip.' : v > 2.4 ? 'Chin is long compared with the upper lip.' : 'Close to the classic 1 : 2.',
    explain: 'Inside the lower third, the chin is usually about twice the height of the upper lip.',
    fix: (v) => v >= 1.7 && v <= 2.4 ? null : v < 1.7
      ? { t: 'Build up the chin', why: 'A short chin is the most common thing a beard can genuinely fix.',
        steps: [prefs.beard === 'none' ? 'Your only non-surgical option is body fat and posture: tuck your chin slightly back and down in photos, never up.' : 'Let the beard grow longest right at the chin point and trim the neck line one finger above the Adam\'s apple.', 'Keep the mustache trimmed off the lip so the upper lip looks shorter.', 'Lean out — a soft chin is often fat under the jaw, not bone.'] }
      : { t: 'Balance a long chin', why: 'Visually move weight upward.',
        steps: ['Let the mustache be a bit fuller to add height to the upper lip area.', 'Keep any beard short at the chin.', 'A bit of fringe or side volume balances the face top to bottom.'] } },
  { k: 'spacing', name: 'Eye spacing', f: fmt.x, band: [.9, 1.15], dom: [.6, 1.5], w: .5, unit: 'gap between eyes ÷ eye width',
    read: (v) => v < .9 ? 'Eyes sit a little close.' : v > 1.15 ? 'Eyes sit a little wide.' : 'About one eye-width apart, the classic spacing.',
    explain: 'The gap between the inner corners compared with the width of one eye.',
    fix: (v) => v >= .9 && v <= 1.15 ? null : v < .9
      ? { t: 'Open up close-set eyes', why: 'Framing changes the read more than people expect.', steps: ['Tidy the space between your brows so they start a little further apart.', 'Choose glasses with a thin or clear bridge.', 'Keep your fringe off the inner corners of your eyes.'] }
      : { t: 'Pull wide-set eyes together', why: 'Strong brows and a darker frame bridge narrow the gap visually.', steps: ['Let your brows start a little closer to the nose; don\'t over-pluck the inner ends.', 'Pick glasses with a darker, thicker bridge.', 'A side part draws attention toward the centre of the face.'] } },
  { k: 'midface', name: 'Midface ratio', f: fmt.x, band: [.94, 1.12], dom: [.7, 1.4], w: .5, unit: 'pupil distance ÷ pupils-to-lip',
    read: (v) => v < .94 ? 'Midface is long compared with eye spacing.' : v > 1.12 ? 'Compact midface.' : 'Balanced.',
    explain: 'How the distance between your pupils compares with the drop from pupils to the top lip.',
    fix: (v) => v >= .94 ? null : { t: 'Shorten a long midface', why: 'The mustache area and cheek fullness are what change the read here.', steps: [prefs.beard === 'none' ? 'Light stubble across the upper lip visually shortens it.' : 'Keep a fuller mustache that covers part of the upper lip.', 'Volume at the sides of your hair adds width, which makes the midface read shorter.', 'Don\'t go too lean in the face; some cheek fullness helps here.'] } },
  { k: 'fwhr', name: 'Width to height', f: fmt.x, band: [1.65, 2.0], dom: [1.3, 2.4], w: .6, unit: 'cheek width ÷ brow-to-lip',
    read: (v) => v < 1.65 ? 'Narrow, longer upper face.' : v > 2.0 ? 'Wide upper face.' : 'In the typical range.',
    explain: 'Facial width-to-height ratio. Wider faces tend to read as more dominant, narrower ones as softer.',
    fix: (v) => v >= 1.65 && v <= 2.0 ? null : v < 1.65
      ? { t: 'Add width', why: 'Hair and beard placement can change perceived width a lot.', steps: ['Skip tall styles and skin fades; keep a bit of length at the sides.', prefs.beard === 'none' ? 'Clean jawline and no long sideburn-to-chin lines.' : 'Grow the beard fuller at the cheeks and jaw, shorter at the chin.', 'Wider frames than your face add width too.'] }
      : { t: 'Add height', why: 'Balance width by building upward.', steps: ['Height on top, tight sides.', prefs.beard === 'none' ? 'Stay clean-shaven at the cheeks.' : 'Keep cheeks short, let the chin run longer.', 'Narrower, deeper frames.'] } },
  { k: 'nose', name: 'Nose width', f: fmt.x, band: [.85, 1.12], dom: [.6, 1.5], w: .4, unit: 'nostril width ÷ gap between eyes',
    read: (v, m) => v > 1.12 ? 'Wider than the gap between your eyes.' : v < .85 ? 'Narrow.' : 'About as wide as the gap between your eyes.',
    explain: 'The base of the nose usually lines up with the inner corners of the eyes.',
    fix: (v) => v <= 1.12 ? null : { t: 'Make the nose read narrower', why: 'Camera distance is the biggest factor here, then framing.', steps: ['Retake with the phone further away or on the 2× lens. Close selfies can add up to a third to nose width.', 'A well-shaped beard or stubble frames the lower face and shrinks the nose by contrast.', 'Clean up nose hair and blackheads on the nose; texture draws the eye.'] } },
  { k: 'lips', name: 'Lip balance', f: fmt.x, band: [1.2, 2.1], dom: [.6, 2.8], w: .3, unit: 'lower lip ÷ upper lip',
    read: (v) => v < 1.2 ? 'Upper lip is close to the lower lip in height.' : v > 2.1 ? 'Upper lip is thin next to the lower lip.' : 'Classic ratio, lower lip about 1.6× the upper.',
    explain: 'Lower lip height compared with upper lip height.',
    fix: (v) => v <= 2.1 ? null : { t: 'Bring out the upper lip', why: 'Small effect, but cheap.', steps: ['Keep the mustache trimmed off the lip line so it doesn\'t hide the upper lip.', 'Daily lip balm with SPF; dry, cracked lips look thinner.', 'Fillers are a real option at a licensed clinic. Never buy injectables online.'] } },
  { k: 'jaw', name: 'Jaw to cheek width', f: fmt.x, band: [.78, .92], dom: [.6, 1.05], w: .8, unit: 'jaw width ÷ cheek width',
    read: (v) => v < .78 ? 'Jaw tapers a lot from the cheeks.' : v > .92 ? 'Very wide jaw.' : 'Defined but not blocky.',
    explain: 'How wide your jaw is at the angles compared with your cheekbones.',
    fix: (v) => v >= .78 ? null : { t: 'Square off the jaw', why: 'The jaw is where fat loss, posture and facial hair stack up the most.', steps: ['Lower body fat gradually; the angle of the jaw shows up fast as you lean out.', prefs.beard === 'none' ? 'Keep a sharp, clean shave line so the jaw edge reads crisp.' : 'Trim the beard into a boxed shape: fuller at the jaw angles, a clean straight neckline.', 'Fix forward head posture: chin tucks, and raise your screens to eye level.'] } }
];

function rate(mt, v) {
  const [lo, hi] = mt.band; const half = (hi - lo) / 2 || 1;
  const d = v < lo ? (lo - v) / half : v > hi ? (v - hi) / half : 0;
  return d;
}

// 100 at the centre of the typical range, 85 at its edges, falling off outside it.
function closeness(mt, v) {
  const [lo, hi] = mt.band; const mid = (lo + hi) / 2, half = (hi - lo) / 2 || 1;
  const c = mt.k === 'sym' ? Math.max(0, v - 1) / (hi - 1) : Math.abs(v - mid) / half;
  return c <= 1 ? 100 - 15 * c : Math.max(0, 85 - (c - 1) * 35);
}

// ---------- photo + analysis ----------
let current = null, view = 'mesh';

async function analyse(img) {
  showErr('');
  el.busy.hidden = false; el.busyText.textContent = 'Mapping your face';
  el.actions.hidden = true; el.idle.hidden = true;
  const fail = (msg) => {
    showErr(msg);
    el.actions.hidden = false;
    if (current) { el.canvas.hidden = false; draw(); } else { el.canvas.hidden = true; el.idle.hidden = false; }
  };
  try {
    { // show the photo right away so nothing looks stuck
      const c = el.canvas, cx = c.getContext('2d'), W = el.stage.clientWidth * Math.min(2, window.devicePixelRatio || 1);
      c.width = W; c.height = W * 1.25; const s = Math.max(c.width / img.width, c.height / img.height);
      cx.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s); c.hidden = false;
    }
    await withTimeout(loadModels(), 45000);
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const fa = window.faceapi;
    const found = await withTimeout(fa.detectAllFaces(cv, new fa.SsdMobilenetv1Options({ minConfidence: .4 })).withFaceLandmarks(), 40000);
    if (!found.length) { el.busy.hidden = true; return fail('No face found. Try a straight-on photo with your whole face in frame and even light.'); }
    const best = found.sort((a, b) => b.detection.box.area - a.detection.box.area)[0];
    const m = measure(best.landmarks.positions.map((p) => ({ x: p.x, y: p.y })), cv.width);
    current = { img: cv, m, many: found.length > 1 };
    try { el.amb.style.backgroundImage = `url(${cv.toDataURL('image/jpeg', .5)})`; el.amb.classList.add('on'); } catch {}
    draw(); renderResults();
    el.idle.hidden = true; el.canvas.hidden = false; el.views.hidden = false; el.reset.hidden = false; el.actions.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error(e); fail(e && e.message === 'timeout' ? 'This is taking too long on this device. Try again, or upload a smaller photo.' : 'Something went wrong reading that photo. Try another one.');
  }
  el.busy.hidden = true;
}

function showErr(t) { el.err.hidden = !t; el.err.innerHTML = t ? icon('triangle-alert', 18) + `<span>${esc(t)}</span>` : ''; }

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return showErr('That file isn\'t an image.');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { analyse(img); URL.revokeObjectURL(url); };
  img.onerror = () => showErr('Couldn\'t open that image. HEIC from some phones may need converting to JPG.');
  img.src = url;
}
$('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
el.stage.addEventListener('dragover', (e) => e.preventDefault());
el.stage.addEventListener('drop', (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

// camera
let stream = null;
$('#camBtn').addEventListener('click', async () => {
  showErr('');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1600 } }, audio: false });
    el.video.srcObject = stream; await el.video.play();
    el.video.hidden = false; el.guide.hidden = false; el.idle.hidden = true; el.canvas.hidden = true;
    el.actions.hidden = true; el.camActions.hidden = false;
  } catch { showErr('Camera is blocked or unavailable. Upload a photo instead.'); }
});
const stopCam = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; el.video.hidden = true; el.guide.hidden = true; el.camActions.hidden = true; };
$('#camCancel').addEventListener('click', () => { stopCam(); el.actions.hidden = false; if (!current) el.idle.hidden = false; else el.canvas.hidden = false; });
$('#snapBtn').addEventListener('click', () => {
  const v = el.video; if (!v.videoWidth) return showErr('The camera isn\'t ready yet. Give it a second and try again.');
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const x = c.getContext('2d'); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(v, 0, 0);
  stopCam(); analyse(c);
});

el.reset.addEventListener('click', () => {
  current = null; el.canvas.hidden = true; el.idle.hidden = false; el.views.hidden = true; el.reset.hidden = true; el.actions.hidden = false;
  el.results.hidden = true; el.intro.hidden = false; el.amb.classList.remove('on'); showErr('');
});

el.views.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  view = b.dataset.v; el.views.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); draw();
});

// ---------- overlay ----------
function draw() {
  if (!current) return;
  const { img, m } = current;
  const xs = m.P.map((p) => m.back(p).x), ys = m.P.map((p) => m.back(p).y);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  let w = (bx1 - bx0) * 1.7, h = w * 1.25;
  h = Math.max(h, (by1 - by0) * 1.9); w = h / 1.25;
  if (w > img.width) { w = img.width; h = w * 1.25; }
  if (h > img.height) { h = img.height; w = h / 1.25; }
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2 - (by1 - by0) * .12;
  const sx = Math.max(0, Math.min(img.width - w, cx - w / 2)), sy = Math.max(0, Math.min(img.height - h, cy - h / 2));
  const cv = el.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(el.stage.clientWidth * dpr), H = Math.round(W * 1.25);
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d'); const k = W / w;
  x.drawImage(img, sx, sy, w, h, 0, 0, W, H);
  x.fillStyle = 'rgba(10,10,12,.28)'; x.fillRect(0, 0, W, H);
  const T = (p) => { const q = m.back(p); return [(q.x - sx) * k, (q.y - sy) * k]; };
  const u = W / 400;
  const ACC = '#ff5b2e', INK = 'rgba(255,255,255,.92)';
  const line = (a, b, col = INK, wd = 1.2, dash) => { x.beginPath(); x.setLineDash(dash || []); x.strokeStyle = col; x.lineWidth = wd * u; x.moveTo(...T(a)); x.lineTo(...T(b)); x.stroke(); x.setLineDash([]); };
  const poly = (ix, close, col = 'rgba(255,255,255,.55)') => { x.beginPath(); x.strokeStyle = col; x.lineWidth = 1 * u; ix.forEach((i, n) => (n ? x.lineTo : x.moveTo).call(x, ...T(m.P[i]))); if (close) x.closePath(); x.stroke(); };
  const dot = (p, r = 2.2, col = INK) => { x.beginPath(); x.fillStyle = col; x.arc(...T(p), r * u, 0, 7); x.fill(); };
  const tag = (p, txt, dx = 8, dy = 0) => { const [px, py] = T(p); x.font = `500 ${12 * u}px Geist Mono, monospace`; const tw = x.measureText(txt).width; const X = Math.min(W - tw - 10 * u, Math.max(6 * u, px + dx * u)), Y = py + dy * u; x.fillStyle = 'rgba(10,10,12,.72)'; x.beginPath(); x.roundRect(X - 6 * u, Y - 10 * u, tw + 12 * u, 20 * u, 10 * u); x.fill(); x.fillStyle = INK; x.textBaseline = 'middle'; x.fillText(txt, X, Y); };
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const P = m.P, v = m.v;

  if (view === 'mesh') {
    [range(0, 16), range(17, 21), range(22, 26), range(27, 30), range(31, 35)].forEach((ix) => poly(ix));
    poly(range(36, 41), true); poly(range(42, 47), true); poly(range(48, 59), true); poly(range(60, 67), true);
    P.forEach((p, i) => dot(p, i === 8 || i === 27 ? 3 : 2, i >= 36 && i <= 47 ? ACC : INK));
  }
  if (view === 'thirds') {
    const L = P[0].x - (P[16].x - P[0].x) * .15, R = P[16].x + (P[16].x - P[0].x) * .15;
    [m.gl.y, m.sn.y, m.me.y].forEach((y) => line({ x: L, y }, { x: R, y }, ACC, 1.4, [6 * u, 5 * u]));
    line({ x: L, y: m.st.y }, { x: R, y: m.st.y }, 'rgba(255,255,255,.5)', 1, [3 * u, 4 * u]);
    const mid = m.sn.y - m.gl.y, low = m.me.y - m.sn.y;
    tag({ x: R, y: (m.gl.y + m.sn.y) / 2 }, 'middle 1.00', -110);
    tag({ x: R, y: (m.sn.y + m.me.y) / 2 }, `lower ${(low / mid).toFixed(2)}`, -110);
    tag({ x: L, y: (m.st.y + m.me.y) / 2 }, `chin ${v.chin.toFixed(1)}× lip`, 0);
  }
  if (view === 'sym') {
    const top = { x: m.midX, y: P[27].y - (P[8].y - P[27].y) * .5 }, bot = { x: m.midX, y: P[8].y + 20 };
    line(top, bot, ACC, 1.4, [6 * u, 5 * u]);
    PAIRS.forEach(([a, b]) => { const mir = { x: 2 * m.midX - P[b].x, y: P[b].y }; line(P[a], mir, 'rgba(255,91,46,.85)', 1.2); dot(P[a], 2, INK); dot(mir, 2, ACC); });
    tag({ x: m.midX, y: P[8].y }, `${v.sym.toFixed(1)}% mismatch`, 10, 18);
  }
  if (view === 'eyes') {
    const ext = (a, b, f) => ({ x: b.x + (b.x - a.x) * f, y: b.y + (b.y - a.y) * f });
    line(ext(P[36], P[39], -.4), ext(P[36], P[39], .15), ACC, 1.6); line(ext(P[42], P[45], -.15), ext(P[42], P[45], .4), ACC, 1.6);
    line({ x: P[36].x - 20, y: m.eL.y }, { x: P[45].x + 20, y: m.eR.y }, 'rgba(255,255,255,.4)', 1, [3 * u, 4 * u]);
    [36, 39, 42, 45].forEach((i) => dot(P[i], 3, INK));
    tag(P[36], fmt.deg(v.tiltA), -70, -22); tag(P[45], fmt.deg(v.tiltB), 6, -22);
    const yb = Math.max(P[40].y, P[47].y) + (P[33].y - P[40].y) * .45;
    line({ x: P[39].x, y: yb }, { x: P[42].x, y: yb }, INK, 1.4); line({ x: P[36].x, y: yb }, { x: P[39].x, y: yb }, 'rgba(255,255,255,.5)', 1.4);
    tag({ x: (P[39].x + P[42].x) / 2, y: yb }, `gap ${v.spacing.toFixed(2)}× eye`, -40, 18);
  }
}
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(draw, 120); });

// ---------- results ----------
function renderResults() {
  const m = current.m, v = m.v; const shape = faceShape(v); const S = SHAPES[shape];
  const warns = [];
  if (Math.abs(m.yaw) > .06) warns.push('Your head is turned a little. Symmetry and widths will be off; retake facing the lens squarely.');
  if (Math.abs(m.roll) > 12) warns.push('Your head was tilted. Facet corrected for it, but a level photo is more accurate.');
  if (m.faceWpx < 220) warns.push('Your face is small in the frame. Move closer or crop the photo for sharper measurements.');
  if (current.many) warns.push('More than one face found. Measured the largest one.');

  m.turned = Math.abs(m.yaw) > .08;
  const rows = METRICS.map((mt) => ({ mt, val: v[mt.k], d: mt.k === 'sym' && m.turned ? 0 : rate(mt, v[mt.k]) }));
  const todo = rows.filter((r) => r.d > 0 && r.mt.fix(r.val, m)).sort((a, b) => b.d * b.mt.w - a.d * a.mt.w).slice(0, 3);
  const hairSteps = prefs.hair === 'thinning'
    ? ['Go shorter overall: a buzz, crop or short textured cut hides thinning better than length.', 'Ask a doctor about minoxidil and finasteride, the two treatments with real evidence. Earlier works better.', ...S.hair.slice(1, 2)]
    : prefs.hair === 'long' ? [S.hair[0], 'Get the ends trimmed every 8–10 weeks; shape at the sides matters more than length.', 'Tie it back off your face for photos if your forehead is not part of the issue.'] : S.hair;
  const cards = [
    { t: `Haircut for ${/^[aeiou]/.test(shape) ? 'an' : 'a'} ${shape} face`, ic: 'scissors', why: S.beard && prefs.beard !== 'none' ? `${S.beard} Frames: ${S.frames}` : `Frames: ${S.frames}`, steps: hairSteps },
    ...todo.map((r) => ({ ...r.mt.fix(r.val, m), ic: 'sparkles' }))
  ];

  const scored = rows.filter((r) => !(r.mt.k === 'sym' && m.turned));
  const wsum = scored.reduce((a, r) => a + r.mt.w, 0);
  const score = Math.round(scored.reduce((a, r) => a + r.mt.w * closeness(r.mt, r.val), 0) / wsum);
  const inRange = scored.filter((r) => r.d === 0).length;
  const chip = (key, val, label) => `<button data-pk="${key}" data-pv="${val}" class="${prefs[key] === val ? 'on' : ''}">${label}</button>`;
  el.results.innerHTML = `
    <div class="shape glass">
      <div class="score"><div><div class="k">Proportion score</div><div class="big">${score}<span>%</span></div><div class="k">${inRange} of ${scored.length} measurements in the typical range</div></div>
        <div class="ring" style="--p:${score}"></div></div>
      <div class="k" style="margin-top:22px">Closest face shape</div>
      <h2>${shape[0].toUpperCase() + shape.slice(1)}</h2>
      <p>${esc(S.line)}</p>
      ${warns.length ? `<div class="warns">${warns.map((w) => `<div class="warn">${icon('info', 18)}<span>${esc(w)}</span></div>`).join('')}</div>` : ''}
    </div>

    <div class="sec">
      <h3>What to work on</h3>
      <p class="sub">${todo.length ? 'Ranked by how far each measurement is from typical, and how much you can change it.' : 'Your proportions all sit in typical ranges. What\'s left to gain is in the haircut and the basics.'}</p>
      <div class="chips">
        <div class="row"><span class="lbl">Your hair</span><div class="grp">${chip('hair', 'short', 'Short')}${chip('hair', 'long', 'Long')}${chip('hair', 'thinning', 'Thinning')}</div></div>
        <div class="row"><span class="lbl">Facial hair</span><div class="grp">${chip('beard', 'full', 'Can grow one')}${chip('beard', 'none', 'Clean-shaven')}</div></div>
      </div>
      <div class="cards">${cards.map((c) => `<article class="card glass"><div class="hd">${icon(c.ic)}<h4>${esc(c.t)}</h4></div><p class="why">${esc(c.why)}</p><ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></article>`).join('')}</div>
    </div>

    <div class="sec">
      <h3>Measurements</h3>
      <p class="sub">Green is the typical range. Tap one to see what it measures.</p>
      <div class="metrics">${rows.map(({ mt, val, d }) => {
        const [a, b] = mt.dom; const pos = (x) => Math.max(0, Math.min(100, (x - a) / (b - a) * 100));
        return `<details class="metric ${d > 0 ? 'off' : ''}"><summary>
          <span class="nm">${esc(mt.name)}</span><span class="val">${esc(mt.f(val))}</span><span class="chev">${icon('chevron-down', 18)}</span>
          <span class="bar"><span class="band" style="left:${pos(mt.band[0])}%;width:${pos(mt.band[1]) - pos(mt.band[0])}%"></span><span class="dot" style="left:${pos(val)}%"></span></span>
          <span class="rd"><b>${mt.k === 'sym' && m.turned ? 'Skipped' : d > 0 ? 'Outside typical' : 'Typical'}</b> · ${esc(mt.read(val, m))}</span>
        </summary><div class="more"><p>${esc(mt.explain)}</p><p class="typ">${esc(mt.unit)} · typical ${esc(mt.f(mt.band[0]))} to ${esc(mt.f(mt.band[1]))}</p></div></details>`;
      }).join('')}</div>
    </div>

    <div class="sec">
      <h3>The basics</h3>
      <p class="sub">These move how you look more than any ratio above.</p>
      <div class="basics">
        ${[['droplets', 'Skin', 'SPF 30+ every morning, a gentle cleanser and moisturizer, and adapalene at night a few times a week. See a dermatologist for acne that won\'t clear.'],
           ['dumbbell', 'Body fat', 'The jaw, cheekbones and eyes all sharpen as you lean out. Lift 3× a week, walk daily, eat enough protein, and go slowly.'],
           ['moon', 'Sleep', '7–9 hours. Short sleep shows up as puffiness, dark circles and dull skin within days.'],
           ['person-standing', 'Posture', 'Forward head posture softens the jaw and neck. Chin tucks, and screens at eye level.'],
           ['eye', 'Brows & grooming', 'Clean up between the brows without over-thinning. Nose and ear hair, nails, teeth whitening strips.'],
           ['camera', 'Photos', 'Use the 2× lens or stand back, face a window, and hold the camera at eye level.']]
          .map(([i, t, p]) => `<div class="card glass"><div class="hd">${icon(i)}<h4>${t}</h4></div><p>${p}</p></div>`).join('')}
      </div>
    </div>

    <div class="sec">
      <h3>Skip these</h3>
      <div class="skip">
        <div>${icon('ban', 18)}<span><b>Mewing for a new jaw.</b> Good tongue posture is fine, but it won't reshape adult bone.</span></div>
        <div>${icon('ban', 18)}<span><b>Bone smashing.</b> Hitting your face doesn't grow bone. It causes fractures and nerve damage.</span></div>
        <div>${icon('ban', 18)}<span><b>Peptides, SARMs and tanning injections from the internet.</b> Unregulated, and the side effects are real.</span></div>
        <div>${icon('ban', 18)}<span><b>Mail-order filler or DIY injections.</b> If you want a procedure, see a board-certified doctor.</span></div>
      </div>
    </div>`;
  el.intro.hidden = true; el.results.hidden = false;
}
el.results.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pk]'); if (!b) return;
  prefs[b.dataset.pk] = b.dataset.pv; store.set('prefs', prefs); const y = window.scrollY; renderResults(); window.scrollTo(0, y);
});

window.__facet = { analyse, get current() { return current; } };
}
