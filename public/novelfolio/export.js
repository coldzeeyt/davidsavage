// Book export: EPUB, Word (.docx), print-to-PDF, and JSON backup. No dependencies.

// ---------- tiny zip writer (stored, no compression) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const enc = new TextEncoder();
function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((n, p) => n + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)]);
}

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => (String(s || 'book').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book').slice(0, 60);
function dataUrlBytes(url) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url); if (!m) return null;
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes: u8, ext: m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : m[1].includes('gif') ? 'gif' : 'jpg' };
}
const chapterName = (c, i) => c.title?.trim() || `Chapter ${i + 1}`;
const liveChapters = (book) => book.chapters;

// ---------- EPUB ----------
export function epub(book) {
  const doc = document.implementation.createHTMLDocument('');
  const ser = new XMLSerializer();
  const files = [{ name: 'mimetype', data: 'application/epub+zip' }];
  const images = []; let imgN = 0;
  const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
  const takeImg = (url) => { const d = dataUrlBytes(url); if (!d) return null; const name = `images/img${++imgN}.${d.ext}`; images.push({ name, ...d }); return name; };

  let cover = '';
  if (book.coverImage) { const n = takeImg(book.coverImage); if (n) { cover = n; images[images.length - 1].cover = true; } }
  const chapters = liveChapters(book).map((c, i) => {
    const box = doc.createElement('div'); box.innerHTML = c.html || '';
    box.querySelectorAll('img').forEach((im) => { const n = takeImg(im.getAttribute('src') || ''); if (n) im.setAttribute('src', n); else im.remove(); im.setAttribute('alt', ''); });
    box.querySelectorAll('hr').forEach((h) => h.setAttribute('class', 'break'));
    const body = Array.from(box.childNodes).map((n) => ser.serializeToString(n).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')).join('');
    const title = chapterName(c, i);
    return { file: `ch${i + 1}.xhtml`, title, html: xhtml(title, `<section epub:type="chapter"><p class="lb">Chapter ${i + 1}</p><h1>${esc(title)}</h1>${body}</section>`) };
  });

  const css = `body{font-family:serif;line-height:1.55}h1{text-align:center;font-weight:normal;margin:2em 0 1em}.lb{text-align:center;font-variant:small-caps;letter-spacing:.2em;text-indent:0;margin-top:3em}p{margin:0;text-indent:1.4em}h1+p,hr+p,h2+p,figure+p{text-indent:0}h2{text-align:center;font-weight:normal}hr.break{border:0;text-align:center;margin:1em 0}hr.break:after{content:"\\2042"}figure{text-align:center;margin:1em auto}figure img{max-width:100%}figure.s{width:38%}figure.m{width:62%}figure.l{width:86%}blockquote{margin:.6em 1.5em;font-style:italic}.tp{text-align:center;margin-top:30%}.tp h1{font-size:2em}.tp p{text-indent:0;font-style:italic}`;
  const id = 'urn:uuid:' + (book.uid || book.id);
  const title = book.title || 'Untitled';
  const tp = xhtml(title, `<div class="tp"><h1>${esc(title)}</h1>${book.author ? `<p>${esc(book.author)}</p>` : ''}</div>`);
  const nav = xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters.map((c) => `<li><a href="${c.file}">${esc(c.title)}</a></li>`).join('')}</ol></nav>`);
  const ncx = `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${chapters.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`).join('')}</navMap></ncx>`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">${id}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language>${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>${cover ? '<meta name="cover" content="cover-img"/>' : ''}</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="tp" href="title.xhtml" media-type="application/xhtml+xml"/>${chapters.map((c, i) => `<item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('')}${images.map((im, i) => `<item id="${im.cover ? 'cover-img' : 'i' + i}" href="${im.name}" media-type="${im.mime}"${im.cover ? ' properties="cover-image"' : ''}/>`).join('')}</manifest>
<spine toc="ncx"><itemref idref="tp"/>${chapters.map((c, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`;
  files.push(
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opf }, { name: 'OEBPS/nav.xhtml', data: nav }, { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/style.css', data: css }, { name: 'OEBPS/title.xhtml', data: tp },
    ...chapters.map((c) => ({ name: 'OEBPS/' + c.file, data: c.html })),
    ...images.map((im) => ({ name: 'OEBPS/' + im.name, data: im.bytes }))
  );
  return new File([zip(files)], slug(title) + '.epub', { type: 'application/epub+zip' });
}

// ---------- DOCX ----------
const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function imgSize(url) { return new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth || 800, i.naturalHeight || 600]); i.onerror = () => r([800, 600]); i.src = url; }); }

export async function docx(book) {
  const media = [], rels = []; let rid = 10, pid = 1;
  const body = [];
  const run = (text, f) => `<w:r><w:rPr>${f.b ? '<w:b/>' : ''}${f.i ? '<w:i/>' : ''}${f.u ? '<w:u w:val="single"/>' : ''}${f.s ? '<w:strike/>' : ''}</w:rPr><w:t xml:space="preserve">${xe(text)}</w:t></w:r>`;
  const para = (runs, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.pageBreak ? '<w:pageBreakBefore/>' : ''}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}${o.ind ? `<w:ind w:left="${o.ind}"/>` : ''}${o.first ? '<w:ind w:firstLine="400"/>' : ''}</w:pPr>${runs}</w:p>`;
  async function image(url, cls) {
    const d = dataUrlBytes(url); if (!d || d.ext === 'webp') return '';
    const [w, h] = await imgSize(url);
    const frac = { s: .38, m: .62, l: .86, f: 1 }[cls] || .62;
    const cx = Math.round(5486400 * frac), cy = Math.round(cx * h / w);
    const name = `image${media.length + 1}.${d.ext}`; media.push({ name, bytes: d.bytes }); const id = 'rId' + (++rid);
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    const n = pid++;
    return `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  function runsOf(node, f = {}) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { if (n.textContent) out += run(n.textContent.replace(/\s+/g, ' '), f); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName;
      if (t === 'BR') { out += '<w:r><w:br/></w:r>'; return; }
      const g = { ...f };
      if (t === 'B' || t === 'STRONG') g.b = 1; if (t === 'I' || t === 'EM') g.i = 1; if (t === 'U') g.u = 1; if (t === 'S' || t === 'STRIKE' || t === 'DEL') g.s = 1;
      out += runsOf(n, g);
    });
    return out;
  }
  const jcOf = (el) => { const a = el.style?.textAlign; return a === 'center' ? 'center' : a === 'right' ? 'right' : a === 'justify' ? 'both' : ''; };

  body.push(para(run(book.title || 'Untitled', {}), { style: 'Title', jc: 'center' }));
  if (book.author) body.push(para(run(book.author, { i: 1 }), { jc: 'center' }));
  for (const [i, c] of book.chapters.entries()) {
    body.push(para(run(`Chapter ${i + 1}`.toUpperCase(), {}), { pageBreak: true, jc: 'center', style: 'Label' }));
    body.push(para(run(chapterName(c, i), {}), { style: 'Heading1', jc: 'center' }));
    const box = document.createElement('div'); box.innerHTML = c.html || '';
    let first = true;
    for (const el of Array.from(box.childNodes)) {
      if (el.nodeType === 3) { if (el.textContent.trim()) { body.push(para(run(el.textContent, {}), { first: !first })); first = false; } continue; }
      if (el.nodeType !== 1) continue;
      const t = el.tagName;
      if (t === 'H2' || t === 'H3') { body.push(para(runsOf(el), { style: t === 'H2' ? 'Heading2' : 'Heading3', jc: t === 'H2' ? 'center' : '' })); first = true; }
      else if (t === 'HR') { body.push(para(run('⁂', {}), { jc: 'center' })); first = true; }
      else if (t === 'FIGURE' || t === 'IMG') { const im = t === 'IMG' ? el : el.querySelector('img'); if (im) body.push(para(await image(im.getAttribute('src'), el.className), { jc: 'center' })); first = true; }
      else if (t === 'BLOCKQUOTE') { const kids = el.querySelectorAll('p'); (kids.length ? Array.from(kids) : [el]).forEach((p) => body.push(para(runsOf(p, { i: 1 }), { ind: 720 }))); first = true; }
      else if (t === 'UL' || t === 'OL') { Array.from(el.children).forEach((li, k) => body.push(para(run(t === 'OL' ? `${k + 1}. ` : '• ', {}) + runsOf(li), { ind: 500 }))); first = true; }
      else { const jc = jcOf(el); body.push(para(runsOf(el), { first: !first && !jc, jc })); first = false; }
    }
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="3600" w:after="240"/></w:pPr><w:rPr><w:sz w:val="64"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Label"><w:name w:val="Chapter Label"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="1800" w:after="120"/></w:pPr><w:rPr><w:spacing w:val="40"/><w:color w:val="777777"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="600"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="200"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:i/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const files = [
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>` },
    ...media.map((m) => ({ name: 'word/media/' + m.name, data: m.bytes }))
  ];
  return new File([zip(files)], slug(book.title) + '.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---------- PDF via the print sheet ----------
export function printBook(book) {
  const el = document.getElementById('print');
  el.innerHTML = `<div class="tp"><h1>${esc(book.title || 'Untitled')}</h1>${book.author ? `<p>${esc(book.author)}</p>` : ''}</div>` +
    book.chapters.map((c, i) => `<section><div class="lb">Chapter ${i + 1}</div><h1>${esc(chapterName(c, i))}</h1>${c.html || ''}</section>`).join('');
  const done = () => { el.innerHTML = ''; removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

export function backup(book) {
  return new File([JSON.stringify({ novelfolio: 1, book })], slug(book.title) + '.novelfolio.json', { type: 'application/json' });
}

export async function deliver(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
