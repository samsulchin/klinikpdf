/* ==========================================================
   TTD.in — Alat PDF lengkap (100% diproses di browser)
   Gabung, pisah, kompres, konversi, kunci, OCR, watermark, dll.
   Bergantung pada API kecil dari app.js (window.TTDIN).
   ========================================================== */
(() => {
  'use strict';
  const T = window.TTDIN;
  if (!T) return;
  const { $, $$, clamp, uid, toast, loadScript, ensureLibs, download, loadImage, canvasToBlob, dataUrlToBytes, svg } = T;
  const lib = () => window.PDFLib;
  const MM = 72 / 25.4;
  const PAPER = {
    A4: [595.28, 841.89], A3: [841.89, 1190.55], A5: [419.53, 595.28], B5: [498.9, 708.66],
    F4: [609.45, 935.43], Letter: [612, 792], Legal: [612, 1008],
  };
  const PAPER_CHOICES = [['A4', 'A4 (210 × 297 mm)'], ['F4', 'F4 / Folio (215 × 330 mm)'], ['A3', 'A3 (297 × 420 mm)'], ['A5', 'A5 (148 × 210 mm)'],
    ['B5', 'B5 (176 × 250 mm)'], ['Letter', 'Letter (8,5 × 11 in)'], ['Legal', 'Legal (8,5 × 14 in)']];

  // ==========================================================
  // UTIL
  // ==========================================================
  const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(n < 10485760 ? 2 : 1).replace('.', ',') + ' MB');
  const baseOf = (name) => (String(name || 'dokumen').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'dokumen');
  const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });
  const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  const num = (v, d = 0) => (Number.isFinite(+v) && String(v).trim() !== '' ? +v : d);
  const today = () => new Date().toISOString().slice(0, 10);
  const idDate = (iso) => {
    const d = iso ? new Date(iso + 'T00:00:00') : new Date();
    return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const rupiah = (v) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(v || 0));
  function userErr(msg) { const e = new Error(msg); e.user = true; return e; }

  function kindOf(f) {
    const e = extOf(f.name), t = f.type || '';
    if (t === 'application/pdf' || e === 'pdf') return 'pdf';
    if (/^image\/(png|jpe?g|webp|gif|bmp)$/.test(t) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(e)) return 'img';
    if (e === 'docx' || t.includes('wordprocessingml')) return 'docx';
    if (/^text\//.test(t) || ['txt', 'md', 'csv', 'log', 'json', 'xml'].includes(e)) return 'txt';
    return null;
  }
  const ACCEPT = {
    pdf: '.pdf,application/pdf',
    img: '.jpg,.jpeg,.png,.webp,.gif,.bmp,image/*',
    docx: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: '.txt,.md,.csv,.log,.json,.xml,text/plain',
  };
  const KIND_LABEL = { pdf: ['PDF'], img: ['JPG', 'PNG', 'WEBP'], docx: ['DOCX'], txt: ['TXT'] };

  async function pdfjsDoc(bytes) {
    await ensureLibs();
    return window.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  }
  async function loadDoc(bytes) {
    await ensureLibs();
    return lib().PDFDocument.load(bytes, { updateMetadata: false });
  }
  async function newDoc() {
    await ensureLibs();
    const d = await lib().PDFDocument.create();
    d.setProducer('TTD.in');
    d.setCreator('TTD.in');
    return d;
  }
  async function saveDoc(doc, opts) { return pdfBlob(await doc.save(opts)); }

  async function renderPage(page, scale, opts = {}) {
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width));
    c.height = Math.max(1, Math.floor(vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    const params = { canvasContext: ctx, viewport: vp };
    if (opts.forms) params.annotationMode = window.pdfjsLib.AnnotationMode.ENABLE_STORAGE;
    await page.render(params).promise;
    return c;
  }
  function scaleFor(page, dpi, maxPx = 5000) {
    const vp = page.getViewport({ scale: 1 });
    return Math.min(dpi / 72, maxPx / Math.max(vp.width, vp.height));
  }
  async function canvasBytes(c, type = 'image/jpeg', q = 0.9) {
    return new Uint8Array(await (await canvasToBlob(c, type, q)).arrayBuffer());
  }
  async function zipBlob(files) {
    await loadScript('vendor/jszip.min.js');
    const zip = new window.JSZip();
    const used = new Set();
    for (const f of files) {
      let n = f.name, k = 2;
      while (used.has(n)) n = f.name.replace(/(\.[^.]+)?$/, `-${k++}$1`);
      used.add(n);
      zip.file(n, f.blob);
    }
    return zip.generateAsync({ type: 'blob', compression: 'STORE' });
  }

  /** "1-3, 5, 8-" → [[0,1,2],[4],[7..]] */
  function parseRanges(text, total) {
    const groups = [];
    for (const part of String(text || '').split(/[,;]+/)) {
      const s = part.trim();
      if (!s) continue;
      const m = s.match(/^(\d*)\s*[-–]\s*(\d*)$/);
      let a, b;
      if (m && (m[1] || m[2])) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
      else if (/^\d+$/.test(s)) { a = b = +s; }
      else throw userErr(`Format halaman tidak dikenali: "${s}". Contoh yang benar: 1-3, 5, 8-10`);
      if (a > total && b > total) throw userErr(`Halaman ${a} tidak ada. Dokumen ini hanya ${total} halaman.`);
      a = clamp(a, 1, total); b = clamp(b, 1, total);
      const g = [];
      if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1);
      else for (let i = a; i >= b; i--) g.push(i - 1);
      groups.push(g);
    }
    return groups;
  }
  function pageList(text, total) {
    if (!String(text || '').trim()) return range(0, total);
    return [...new Set(parseRanges(text, total).flat())].sort((a, b) => a - b);
  }

  // Huruf standar PDF hanya mendukung WinAnsi (Latin). Karakter lain diganti agar tidak gagal.
  const WIN_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  function winAnsi(s) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[^\n\x20-\x7e\xa0-\xff]/g, (ch) => {
      if (WIN_EXTRA.includes(ch)) return ch;
      return { '\t': '    ', '−': '-', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ' }[ch] ?? '?';
    });
  }
  function rgbHex(h) {
    const n = parseInt(String(h || '#000000').replace('#', ''), 16) || 0;
    return lib().rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  function wrapText(text, font, size, maxW) {
    const W = (s) => font.widthOfTextAtSize(s, size);
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (let word of words) {
        while (word && W(word) > maxW) {
          let k = word.length;
          while (k > 1 && W(word.slice(0, k)) > maxW) k--;
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, k));
          word = word.slice(k);
        }
        const test = line ? line + ' ' + word : word;
        if (W(test) <= maxW) line = test;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }

  // ---------- Geometri halaman (termasuk halaman yang diputar) ----------
  function geom(page) {
    const b = page.getCropBox();
    const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    return {
      x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height, rot,
      w: b.width, h: b.height,
      vw: rot % 180 ? b.height : b.width,
      vh: rot % 180 ? b.width : b.height,
    };
  }
  /** Titik visual (kiri-atas, sumbu y ke bawah) → koordinat PDF. */
  function toUser(g, u, v) {
    switch (g.rot) {
      case 90: return { x: g.x0 + v, y: g.y0 + u };
      case 180: return { x: g.x1 - u, y: g.y0 + v };
      case 270: return { x: g.x1 - v, y: g.y1 - u };
      default: return { x: g.x0 + u, y: g.y1 - v };
    }
  }
  function visToUser(g) {
    switch (g.rot) {
      case 90: return [0, 1, -1, 0, g.x1, g.y0];
      case 180: return [-1, 0, 0, -1, g.x1, g.y1];
      case 270: return [0, -1, 1, 0, g.x0, g.y1];
      default: return [1, 0, 0, 1, g.x0, g.y0];
    }
  }
  function srcVisual(ew, eh, sr) {
    switch (sr) {
      case 90: return { m: [0, -1, 1, 0, 0, ew], w: eh, h: ew };
      case 180: return { m: [-1, 0, 0, -1, ew, eh], w: ew, h: eh };
      case 270: return { m: [0, 1, -1, 0, eh, 0], w: eh, h: ew };
      default: return { m: [1, 0, 0, 1, 0, 0], w: ew, h: eh };
    }
  }
  function mul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  const cropBB = (page) => { const g = geom(page); return { left: g.x0, bottom: g.y0, right: g.x1, top: g.y1 }; };

  /**
   * Gambar halaman lain (hasil embedPage, rotasi asal `sr`) ke dalam kotak visual pada halaman target.
   * box: { x, y, w, h } dari kiri-atas halaman yang terlihat.
   */
  function placeEmbedded(page, emb, sr, box, o = {}) {
    const L = lib();
    const g = geom(page);
    const sv = srcVisual(emb.width, emb.height, sr);
    let sx, sy;
    if (o.scale) sx = sy = o.scale;
    else if (o.stretch) { sx = box.w / sv.w; sy = box.h / sv.h; }
    else sx = sy = Math.min(box.w / sv.w, box.h / sv.h);
    const left = box.x + (box.w - sv.w * sx) / 2;
    const bottom = g.vh - box.y - box.h + (box.h - sv.h * sy) / 2;
    const M = mul(visToUser(g), mul([sx, 0, 0, sy, left, bottom], sv.m));
    const node = page.node;
    if (!node.get(L.PDFName.of('Contents'))) node.set(L.PDFName.of('Contents'), page.doc.context.obj([]));
    node.normalize();
    const name = node.newXObject('TTDp', emb.ref);
    const ops = [L.pushGraphicsState()];
    if (o.opacity != null && o.opacity < 1) {
      const gs = node.newExtGState('TTDg', page.doc.context.obj({ Type: 'ExtGState', ca: o.opacity, CA: o.opacity }));
      ops.push(L.setGraphicsState(gs));
    }
    ops.push(L.concatTransformationMatrix(...M), L.drawObject(name), L.popGraphicsState());
    if (o.behind) {
      const ref = page.doc.context.register(page.doc.context.contentStream(ops));
      node.Contents().insert(0, ref);
    } else {
      page.pushOperators(...ops);
    }
  }

  // ---------- Gambar ke halaman PDF ----------
  function jpegOrientation(b) {
    if (b[0] !== 0xff || b[1] !== 0xd8) return 0;
    let p = 2;
    while (p + 4 < b.length) {
      if (b[p] !== 0xff) return 0;
      const marker = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (marker === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
        const t = p + 10;
        const le = b[t] === 0x49;
        const r16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
        const r32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0;
        const ifd = t + r32(t + 4);
        const n = r16(ifd);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (r16(e) === 0x0112) return r16(e + 8);
        }
        return 0;
      }
      if (marker === 0xda) return 0;
      p += 2 + len;
    }
    return 0;
  }
  function canvasHasAlpha(img) {
    const c = document.createElement('canvas');
    const k = Math.min(1, 160 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * k));
    c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * k));
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }
  async function embedImageFile(doc, file) {
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    const w = img.naturalWidth, h = img.naturalHeight;
    const raw = new Uint8Array(await file.arrayBuffer());
    const e = extOf(file.name);
    try {
      if ((file.type === 'image/jpeg' || e === 'jpg' || e === 'jpeg') && jpegOrientation(raw) <= 1) return { img: await doc.embedJpg(raw), w, h };
      if (file.type === 'image/png' || e === 'png') return { img: await doc.embedPng(raw), w, h };
    } catch (_) { /* jatuh ke kanvas */ }
    const k = Math.min(1, 6000 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext('2d');
    if (canvasHasAlpha(img)) {
      x.drawImage(img, 0, 0, c.width, c.height);
      return { img: await doc.embedPng(await canvasBytes(c, 'image/png')), w, h };
    }
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    return { img: await doc.embedJpg(await canvasBytes(c, 'image/jpeg', 0.92)), w, h };
  }
  async function addImagePage(doc, file, o = {}) {
    const { img, w, h } = await embedImageFile(doc, file);
    const size = o.size || 'fit';
    if (size === 'fit') {
      const pw = 595.28, ph = (pw * h) / w;
      doc.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
      return;
    }
    let [pw, ph] = PAPER[size] || PAPER.A4;
    const land = o.orient === 'landscape' || ((!o.orient || o.orient === 'auto') && w > h);
    if (land) [pw, ph] = [ph, pw];
    const m = num(o.margin) * MM;
    const s = Math.min((pw - 2 * m) / w, (ph - 2 * m) / h);
    doc.addPage([pw, ph]).drawImage(img, { x: (pw - w * s) / 2, y: (ph - h * s) / 2, width: w * s, height: h * s });
  }

  async function textToPdf(text) {
    const L = lib();
    const doc = await newDoc();
    const font = await doc.embedFont(L.StandardFonts.Helvetica);
    const size = 11, lh = size * 1.45;
    const [W, H] = PAPER.A4;
    const m = 20 * MM;
    const lines = wrapText(winAnsi(String(text).replace(/\t/g, '    ')), font, size, W - 2 * m);
    let page = null, y = 0;
    for (const line of lines) {
      if (!page || y < m) { page = doc.addPage([W, H]); y = H - m - size; }
      if (line) page.drawText(line, { x: m, y, size, font, color: L.rgb(0.07, 0.09, 0.15) });
      y -= lh;
    }
    if (!page) doc.addPage([W, H]);
    return doc.save();
  }

  async function rasterize(bytes, dpi, quality, progress, label = 'Menyusun halaman') {
    const pdf = await pdfjsDoc(bytes);
    const out = await newDoc();
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        progress(`${label} ${i}/${pdf.numPages}…`, (i - 1) / pdf.numPages);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const c = await renderPage(page, scaleFor(page, dpi, 5000), { forms: true });
        const jpg = await canvasBytes(c, 'image/jpeg', quality);
        out.addPage([vp.width, vp.height]).drawImage(await out.embedJpg(jpg), { x: 0, y: 0, width: vp.width, height: vp.height });
        c.width = c.height = 0;
        page.cleanup();
      }
    } finally { pdf.destroy(); }
    return out;
  }

  /** Hapus objek yang tidak lagi dipakai (sisa revisi lama, dll). */
  function collectGarbage(doc) {
    const { PDFRef, PDFDict, PDFArray } = lib();
    const ctx = doc.context;
    const seen = new Set();
    const queue = [];
    const mark = (v) => {
      if (v instanceof PDFRef) {
        if (!seen.has(v)) { seen.add(v); const o = ctx.lookup(v); if (o) queue.push(o); }
      } else if (v) queue.push(v);
    };
    [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt, ctx.trailerInfo.ID].forEach(mark);
    let guard = 0;
    while (queue.length && guard++ < 5e6) {
      const o = queue.pop();
      if (o instanceof PDFDict) { for (const [, v] of o.entries()) if (v instanceof PDFRef || v instanceof PDFDict || v instanceof PDFArray) mark(v); }
      else if (o instanceof PDFArray) { for (const v of o.asArray()) if (v instanceof PDFRef || v instanceof PDFDict || v instanceof PDFArray) mark(v); }
      else if (o && o.dict instanceof PDFDict) mark(o.dict);
    }
    let removed = 0;
    for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) { ctx.delete(ref); removed++; }
    return removed;
  }
  function stripMetadata(doc) {
    const { PDFName } = lib();
    const ctx = doc.context;
    const info = ctx.trailerInfo.Info;
    ctx.trailerInfo.Info = undefined;
    if (info instanceof lib().PDFRef) ctx.delete(info);
    doc.catalog.delete(PDFName.of('Metadata'));
    doc.catalog.delete(PDFName.of('PieceInfo'));
    for (const p of doc.getPages()) { p.node.delete(PDFName.of('Metadata')); p.node.delete(PDFName.of('PieceInfo')); }
  }

  /** Kompres ulang gambar di dalam PDF tanpa mengubah teks & vektor. */
  async function recompressImages(doc, cfg, progress) {
    const { PDFName, PDFRawStream, PDFArray, PDFDict, PDFRef, decodePDFRawStream } = lib();
    const ctx = doc.context;
    const N = (k) => PDFName.of(k);
    const list = ctx.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(N('Subtype')) === N('Image'));
    let count = 0;
    const csComponents = (cs) => {
      cs = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
      if (!cs) return 0;
      const s = String(cs);
      if (s === '/DeviceRGB' || s === '/CalRGB') return 3;
      if (s === '/DeviceGray' || s === '/CalGray') return 1;
      if (cs instanceof PDFArray) {
        const kind = String(cs.get(0));
        if (kind === '/ICCBased') {
          const st = ctx.lookup(cs.get(1));
          const n = st && st.dict ? st.dict.get(N('N')) : null;
          const v = n ? n.asNumber() : 0;
          return v === 1 || v === 3 ? v : 0;
        }
        if (kind === '/CalRGB') return 3;
        if (kind === '/CalGray') return 1;
      }
      return 0;
    };
    for (let k = 0; k < list.length; k++) {
      const [ref, s] = list[k];
      progress(`Mengompres gambar ${k + 1}/${list.length}…`, k / Math.max(1, list.length));
      try {
        const d = s.dict;
        const get = (key) => { const v = d.get(N(key)); return v instanceof PDFRef ? ctx.lookup(v) : v; };
        if (String(get('ImageMask')) === 'true' || d.has(N('Decode')) || get('Mask') instanceof PDFArray) continue;
        const W = get('Width') ? get('Width').asNumber() : 0;
        const H = get('Height') ? get('Height').asNumber() : 0;
        const bpc = get('BitsPerComponent') ? get('BitsPerComponent').asNumber() : 8;
        if (W * H < 40000 || !W || !H) continue;
        const n = csComponents(d.get(N('ColorSpace')));
        if (!n) continue;
        const f = get('Filter');
        const filters = f instanceof PDFArray ? f.asArray().map(String) : f ? [String(f)] : [];
        let source;
        if (filters.length === 1 && filters[0] === '/DCTDecode') {
          source = await createImageBitmap(new Blob([s.contents], { type: 'image/jpeg' }));
        } else if (filters.length === 1 && filters[0] === '/FlateDecode' && bpc === 8 && !d.has(N('DecodeParms'))) {
          const raw = decodePDFRawStream(s).decode();
          if (raw.length < W * H * n) continue;
          const c0 = document.createElement('canvas');
          c0.width = W; c0.height = H;
          const x0 = c0.getContext('2d');
          const id = x0.createImageData(W, H);
          const px = id.data;
          for (let i = 0, j = 0; i < W * H; i++) {
            if (n === 3) { px[i * 4] = raw[j++]; px[i * 4 + 1] = raw[j++]; px[i * 4 + 2] = raw[j++]; }
            else { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = raw[j++]; }
            px[i * 4 + 3] = 255;
          }
          x0.putImageData(id, 0, 0);
          source = c0;
        } else continue;
        const sc = Math.min(1, cfg.max / Math.max(W, H));
        const nw = Math.max(1, Math.round(W * sc)), nh = Math.max(1, Math.round(H * sc));
        const c = document.createElement('canvas');
        c.width = nw; c.height = nh;
        const x = c.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(0, 0, nw, nh);
        x.imageSmoothingQuality = 'high';
        x.drawImage(source, 0, 0, nw, nh);
        if (source.close) source.close();
        const jpg = await canvasBytes(c, 'image/jpeg', cfg.q);
        c.width = c.height = 0;
        if (jpg.length >= s.contents.length * 0.92) continue;
        const nd = ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: nw, Height: nh, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
        for (const key of ['SMask', 'Mask', 'Interpolate', 'Intent', 'OC']) { const v = d.get(N(key)); if (v) nd.set(N(key), v); }
        ctx.assign(ref, PDFRawStream.of(nd, jpg));
        count++;
      } catch (e) { console.warn('Gambar dilewati:', e); }
    }
    return count;
  }

  // ---------- Bookmark (outline) ----------
  function writeOutline(doc, items, openPanel) {
    const { PDFName, PDFHexString } = lib();
    const ctx = doc.context;
    const pages = doc.getPages();
    doc.catalog.delete(PDFName.of('Outlines'));
    if (!items.length) return;
    const root = { children: [], ref: ctx.nextRef() };
    const stack = [{ node: root, level: -1 }];
    for (const it of items) {
      const lvl = Math.max(0, it.level | 0);
      while (stack.length > 1 && stack[stack.length - 1].level >= lvl) stack.pop();
      const node = { it, children: [], ref: ctx.nextRef() };
      stack[stack.length - 1].node.children.push(node);
      stack.push({ node, level: lvl });
    }
    const count = (n) => n.children.reduce((s, c) => s + 1 + count(c), 0);
    const emit = (n) => n.children.forEach((c, i) => {
      const page = pages[clamp(c.it.page | 0, 0, pages.length - 1)];
      const d = {
        Title: PDFHexString.fromText(String(c.it.title || 'Tanpa judul').slice(0, 300)),
        Parent: n.ref,
        Dest: ctx.obj([page.ref, 'XYZ', null, null, null]),
      };
      if (i > 0) d.Prev = n.children[i - 1].ref;
      if (i < n.children.length - 1) d.Next = n.children[i + 1].ref;
      if (c.children.length) { d.First = c.children[0].ref; d.Last = c.children[c.children.length - 1].ref; d.Count = count(c); }
      ctx.assign(c.ref, ctx.obj(d));
      emit(c);
    });
    emit(root);
    ctx.assign(root.ref, ctx.obj({ Type: 'Outlines', First: root.children[0].ref, Last: root.children[root.children.length - 1].ref, Count: count(root) }));
    doc.catalog.set(PDFName.of('Outlines'), root.ref);
    if (openPanel) doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  }
  async function readOutline(pdf) {
    const out = [];
    let outline = null;
    try { outline = await pdf.getOutline(); } catch (_) { /* tanpa outline */ }
    const walk = async (items, level) => {
      for (const it of items || []) {
        let page = 0;
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await pdf.getDestination(dest);
          if (Array.isArray(dest) && dest[0] != null) page = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
        } catch (_) { /* tujuan tidak valid */ }
        out.push({ title: it.title || '', page: page + 1, level });
        await walk(it.items, level + 1);
      }
    };
    await walk(outline, 0);
    return out;
  }

  // ---------- Ekstraksi teks (untuk Word, TXT, bandingkan) ----------
  async function pageLines(page) {
    const tc = await page.getTextContent();
    const vp = page.getViewport({ scale: 1 });
    const U = window.pdfjsLib.Util;
    const items = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const tx = U.transform(vp.transform, it.transform);
      const size = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 10;
      items.push({ str: it.str, x: tx[4], y: tx[5], w: it.width || size * it.str.length * 0.5, size });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(it.y - last.y) < Math.max(2, Math.min(it.size, last.size) * 0.5)) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      let text = '', end = null;
      for (const it of l.items) {
        if (end != null) {
          const gap = it.x - end;
          if (gap > it.size * 2.5) text += '\t';
          else if (gap > it.size * 0.18 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
        }
        text += it.str;
        end = it.x + it.w;
      }
      l.text = text.replace(/\s+$/, '');
      l.x = l.items[0].x;
      l.right = end;
      l.size = Math.max(...l.items.map((i) => i.size));
    }
    return { lines: lines.filter((l) => l.text.trim()), width: vp.width, height: vp.height };
  }
  function toParagraphs(pg) {
    const L = pg.lines;
    if (!L.length) return { paras: [], minX: 0 };
    const sizes = L.map((l) => l.size).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)];
    const minX = Math.min(...L.map((l) => l.x));
    const maxR = Math.max(...L.map((l) => l.right));
    const paras = [];
    let cur = null;
    for (let i = 0; i < L.length; i++) {
      const l = L[i], prev = L[i - 1];
      const gap = prev ? l.y - prev.y : 0;
      const center = Math.abs((l.x + l.right) / 2 - pg.width / 2) < pg.width * 0.04 && l.x - minX > pg.width * 0.1;
      const join = cur && prev && !cur.center && !center && !cur.tab && !/\t/.test(l.text) &&
        Math.abs(l.size - prev.size) < 0.8 && gap > 0 && gap < prev.size * 1.8 &&
        Math.abs(l.x - cur.x) < prev.size * 1.6 && prev.right > maxR - prev.size * 7;
      if (join) {
        if (/[a-z]-$/.test(cur.text) && /^[a-z]/.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text;
        else cur.text += ' ' + l.text;
      } else {
        cur = { text: l.text, size: l.size, x: l.x, center, tab: /\t/.test(l.text), heading: l.size > body * 1.25, gap: prev ? Math.max(0, gap - prev.size * 1.3) : 0 };
        paras.push(cur);
      }
    }
    return { paras, minX };
  }

  // ---------- Word (.docx) ----------
  const xmlEsc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  async function buildDocx(bodyXml, sect, images, title) {
    await loadScript('vendor/jszip.min.js');
    const zip = new window.JSZip();
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    zip.file('[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
    zip.file('_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    zip.file('docProps/core.xml', X + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>TTD.in</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
    zip.file('word/styles.xml', X + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>');
    let rels = '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    images.forEach((im, i) => {
      zip.file(`word/media/image${i + 1}.jpeg`, im);
      rels += `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.jpeg"/>`;
    });
    zip.file('word/_rels/document.xml.rels', X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
    const tw = (pt) => Math.round(pt * 20);
    const orient = sect.w > sect.h ? ' w:orient="landscape"' : '';
    zip.file('word/document.xml', X + `<w:document ${W_NS}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="${tw(sect.w)}" w:h="${tw(sect.h)}"${orient}/><w:pgMar w:top="${tw(sect.mt)}" w:right="${tw(sect.mr)}" w:bottom="${tw(sect.mb)}" w:left="${tw(sect.ml)}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }
  function runXml(text, size, bold) {
    const rpr = `<w:rPr>${bold ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/></w:rPr>`;
    return text.split('\t').map((part, i) => `${i ? `<w:r>${rpr}<w:tab/></w:r>` : ''}${part ? `<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(part)}</w:t></w:r>` : ''}`).join('');
  }
  async function pdfToDocx(f, o, progress) {
    const pdf = await pdfjsDoc(f.bytes);
    try {
      const n = pdf.numPages;
      const idx = pageList(o.pages, n);
      const first = (await pdf.getPage(idx[0] + 1)).getViewport({ scale: 1 });
      let body = '';
      if (o.docx === 'layout') {
        const images = [];
        for (let k = 0; k < idx.length; k++) {
          progress(`Menyusun halaman ${k + 1}/${idx.length}…`, k / idx.length);
          const page = await pdf.getPage(idx[k] + 1);
          const vp = page.getViewport({ scale: 1 });
          const c = await renderPage(page, scaleFor(page, 150, 3000));
          images.push(await canvasBytes(c, 'image/jpeg', 0.85));
          const s = Math.min(first.width / vp.width, (first.height - 6) / vp.height);
          const cx = Math.round(vp.width * s * 12700), cy = Math.round(vp.height * s * 12700);
          const id = k + 1;
          body += `<w:p><w:pPr>${k ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Halaman ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="halaman${id}.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
          c.width = c.height = 0;
        }
        return buildDocx(body, { w: first.width, h: first.height, mt: 0, mr: 0, mb: 0, ml: 0 }, images, baseOf(f.name));
      }
      let margin = 56.7, anyText = false;
      for (let k = 0; k < idx.length; k++) {
        progress(`Membaca teks halaman ${k + 1}/${idx.length}…`, k / idx.length);
        const page = await pdf.getPage(idx[k] + 1);
        const pg = await pageLines(page);
        const { paras, minX } = toParagraphs(pg);
        if (k === 0 && paras.length) margin = clamp(minX, 36, 110);
        if (k) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        for (const p of paras) {
          anyText = true;
          const ind = p.center ? 0 : Math.max(0, p.x - minX);
          const ppr = `<w:pPr><w:spacing w:before="${Math.round(Math.min(p.gap, 24) * 20)}" w:after="0"/>${p.center ? '<w:jc w:val="center"/>' : ''}${ind > 8 ? `<w:ind w:left="${Math.round(ind * 20)}"/>` : ''}</w:pPr>`;
          body += `<w:p>${ppr}${runXml(p.text, clamp(Math.round(p.size * 2) / 2, 6, 48), p.heading)}</w:p>`;
        }
        page.cleanup();
      }
      if (!anyText) throw userErr('Tidak ada teks yang bisa dibaca di PDF ini (kemungkinan hasil scan). Gunakan alat OCR PDF dulu, atau pilih mode "Tata letak persis".');
      return buildDocx(body, { w: first.width, h: first.height, mt: 56.7, mr: margin, mb: 56.7, ml: margin }, [], baseOf(f.name));
    } finally { pdf.destroy(); }
  }
  async function pdfToText(f, o, progress) {
    const pdf = await pdfjsDoc(f.bytes);
    try {
      const idx = pageList(o.pages, pdf.numPages);
      const parts = [];
      for (let k = 0; k < idx.length; k++) {
        progress(`Membaca teks halaman ${k + 1}/${idx.length}…`, k / idx.length);
        const page = await pdf.getPage(idx[k] + 1);
        const pg = await pageLines(page);
        parts.push(pg.lines.map((l) => l.text.replace(/\t/g, '    ')).join('\n'));
        page.cleanup();
      }
      const text = parts.join('\n\n');
      if (!text.trim()) throw userErr('Tidak ada teks yang bisa dibaca di PDF ini (kemungkinan hasil scan). Gunakan alat OCR PDF.');
      return new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
    } finally { pdf.destroy(); }
  }
  async function pdfToImages(f, o, progress) {
    const pdf = await pdfjsDoc(f.bytes);
    const fmt = o.format === 'png' ? 'png' : 'jpg';
    const outs = [];
    try {
      const idx = pageList(o.pages, pdf.numPages);
      for (let k = 0; k < idx.length; k++) {
        progress(`Membuat gambar ${k + 1}/${idx.length}…`, k / idx.length);
        const page = await pdf.getPage(idx[k] + 1);
        const c = await renderPage(page, scaleFor(page, num(o.dpi, 150), 8000));
        const blob = await canvasToBlob(c, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92);
        outs.push({ name: `${baseOf(f.name)}-hal${idx[k] + 1}.${fmt}`, blob });
        c.width = c.height = 0;
        page.cleanup();
      }
    } finally { pdf.destroy(); }
    return outs;
  }

  // ---------- Ekstrak gambar ----------
  function objOf(page, id) {
    const store = String(id).startsWith('g_') ? page.commonObjs : page.objs;
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 8000);
      try {
        store.get(id, (o) => { if (!done) { done = true; clearTimeout(t); resolve(o); } });
      } catch (_) { clearTimeout(t); resolve(null); }
    });
  }
  function pdfImageToCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    if (img.bitmap) { x.drawImage(img.bitmap, 0, 0); return c; }
    if (!img.data) return null;
    const id = x.createImageData(img.width, img.height);
    const d = id.data, s = img.data, n = img.width * img.height;
    if (img.kind === 3) d.set(s.subarray(0, n * 4));
    else if (img.kind === 2) for (let i = 0, j = 0; i < n; i++, j += 3) { d[i * 4] = s[j]; d[i * 4 + 1] = s[j + 1]; d[i * 4 + 2] = s[j + 2]; d[i * 4 + 3] = 255; }
    else if (img.kind === 1) {
      const rb = (img.width + 7) >> 3;
      for (let y = 0; y < img.height; y++) for (let xx = 0; xx < img.width; xx++) {
        const v = ((s[y * rb + (xx >> 3)] >> (7 - (xx & 7))) & 1) ? 255 : 0;
        const i = (y * img.width + xx) * 4;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
    } else return null;
    x.putImageData(id, 0, 0);
    return c;
  }

  // ---------- Diff (algoritma Myers) ----------
  function diffSeq(a, b, maxD = 3000) {
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const A = a.slice(s, ea), B = b.slice(s, eb);
    const N = A.length, M = B.length, MAX = N + M;
    const mid = [];
    if (!N || !M) {
      for (let i = 0; i < N; i++) mid.push(['-', s + i, -1]);
      for (let j = 0; j < M; j++) mid.push(['+', -1, s + j]);
    } else {
      const off = MAX + 1;
      const v = new Int32Array(2 * MAX + 3);
      const trace = [];
      let found = false;
      for (let d = 0; d <= MAX && d <= maxD; d++) {
        trace.push(v.slice(off - d - 1, off + d + 2));
        for (let k = -d; k <= d; k += 2) {
          let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
          let y = x - k;
          while (x < N && y < M && A[x] === B[y]) { x++; y++; }
          v[off + k] = x;
          if (x >= N && y >= M) { found = true; break; }
        }
        if (found) break;
      }
      if (!found) {
        for (let i = 0; i < N; i++) mid.push(['-', s + i, -1]);
        for (let j = 0; j < M; j++) mid.push(['+', -1, s + j]);
      } else {
        let x = N, y = M;
        const rev = [];
        for (let d = trace.length - 1; d >= 0; d--) {
          const V = trace[d], base = d + 1, k = x - y;
          const prevK = (k === -d || (k !== d && V[k - 1 + base] < V[k + 1 + base])) ? k + 1 : k - 1;
          const px = V[prevK + base], py = px - prevK;
          while (x > px && y > py) { rev.push(['=', s + x - 1, s + y - 1]); x--; y--; }
          if (d > 0) { if (x === px) rev.push(['+', -1, s + y - 1]); else rev.push(['-', s + x - 1, -1]); }
          x = px; y = py;
        }
        mid.push(...rev.reverse());
      }
    }
    const out = [];
    for (let i = 0; i < s; i++) out.push(['=', i, i]);
    out.push(...mid);
    for (let i = 0; i < a.length - ea; i++) out.push(['=', ea + i, eb + i]);
    return out;
  }
  function wordDiffHtml(a, b) {
    const ta = a.split(/(\s+)/), tb = b.split(/(\s+)/);
    const ops = diffSeq(ta, tb, 800);
    let ha = '', hb = '';
    for (const [op, i, j] of ops) {
      if (op === '=') { ha += esc(ta[i]); hb += esc(tb[j]); }
      else if (op === '-') ha += `<del>${esc(ta[i])}</del>`;
      else hb += `<ins>${esc(tb[j])}</ins>`;
    }
    return [ha, hb];
  }

  // ==========================================================
  // OPERASI SETIAP ALAT
  // ==========================================================
  const OPS = {};

  OPS.merge = async (ctx) => {
    const out = await newDoc();
    const starts = [];
    for (let i = 0; i < ctx.files.length; i++) {
      const f = ctx.files[i];
      ctx.progress(`Menggabungkan ${f.name}…`, i / ctx.files.length);
      starts.push(out.getPageCount());
      if (f.kind === 'pdf') {
        const src = await loadDoc(f.bytes);
        (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      } else await addImagePage(out, f.file, { size: 'fit' });
    }
    if (ctx.opt.bookmarks) writeOutline(out, ctx.files.map((f, i) => ({ title: baseOf(f.name), page: starts[i], level: 0 })), true);
    return [{ name: `gabungan-${ctx.files.length}-file.pdf`, blob: await saveDoc(out) }];
  };

  OPS.split = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    const src = await loadDoc(f.bytes);
    const n = src.getPageCount();
    let groups;
    if (o.mode === 'each') groups = range(0, n).map((i) => [i]);
    else if (o.mode === 'every') {
      const k = clamp(Math.round(num(o.every, 1)), 1, n);
      groups = [];
      for (let i = 0; i < n; i += k) groups.push(range(i, Math.min(n, i + k)));
    } else {
      groups = parseRanges(o.ranges, n);
      if (!groups.length) throw userErr('Isi rentang halaman terlebih dahulu, misalnya 1-3, 4-6.');
    }
    if (n === 1) throw userErr('PDF ini hanya 1 halaman, tidak ada yang bisa dipisah.');
    const outs = [];
    for (let gi = 0; gi < groups.length; gi++) {
      ctx.progress(`Membuat file ${gi + 1}/${groups.length}…`, gi / groups.length);
      const g = groups[gi];
      const d = await newDoc();
      (await d.copyPages(src, g)).forEach((p) => d.addPage(p));
      const label = g.length === 1 ? `hal${g[0] + 1}` : `hal${g[0] + 1}-${g[g.length - 1] + 1}`;
      outs.push({ name: `${baseOf(f.name)}-${label}.pdf`, blob: await saveDoc(d) });
    }
    return outs;
  };

  /** Susun PDF baru dari daftar halaman (urutan, rotasi, halaman kosong). */
  async function buildFromItems(ctx, items) {
    const out = await newDoc();
    const byFile = new Map();
    items.forEach((it, k) => {
      if (it.blank) return;
      if (!byFile.has(it.fid)) byFile.set(it.fid, []);
      byFile.get(it.fid).push(k);
    });
    const copied = new Array(items.length);
    let done = 0;
    for (const [fid, ks] of byFile) {
      ctx.progress('Menyusun halaman…', done++ / Math.max(1, byFile.size));
      const src = await loadDoc(ctx.file(fid).bytes);
      const pages = await out.copyPages(src, ks.map((k) => items[k].i));
      ks.forEach((k, j) => { copied[k] = pages[j]; });
    }
    items.forEach((it, k) => {
      if (it.blank) { out.addPage([it.w, it.h]); return; }
      const p = out.addPage(copied[k]);
      if (it.rot) p.setRotation(lib().degrees((((p.getRotation().angle + it.rot) % 360) + 360) % 360));
    });
    return out;
  }
  OPS.organize = async (ctx) => {
    const items = ctx.pages;
    if (!items.length) throw userErr('Tidak ada halaman tersisa. Tambahkan PDF atau halaman kosong.');
    const out = await buildFromItems(ctx, items);
    return [{ name: `${baseOf(ctx.files[0] ? ctx.files[0].name : 'dokumen')}-diatur.pdf`, blob: await saveDoc(out) }];
  };
  OPS.sort = async (ctx) => {
    const out = await buildFromItems(ctx, ctx.pages);
    return [{ name: `${baseOf(ctx.files[0].name)}-diurutkan.pdf`, blob: await saveDoc(out) }];
  };
  OPS.rotate = async (ctx) => {
    const f = ctx.files[0];
    if (!ctx.pages.some((it) => it.rot)) throw userErr('Belum ada halaman yang diputar. Klik tombol putar pada halaman, atau "Putar semua".');
    const doc = await loadDoc(f.bytes);
    for (const it of ctx.pages) {
      if (!it.rot) continue;
      const p = doc.getPage(it.i);
      p.setRotation(lib().degrees((((p.getRotation().angle + it.rot) % 360) + 360) % 360));
    }
    return [{ name: `${baseOf(f.name)}-diputar.pdf`, blob: await saveDoc(doc) }];
  };
  OPS.remove = async (ctx) => {
    const f = ctx.files[0];
    const del = ctx.pages.filter((it) => it.del).map((it) => it.i).sort((a, b) => b - a);
    if (!del.length) throw userErr('Klik halaman yang ingin dihapus terlebih dahulu.');
    if (del.length >= ctx.pages.length) throw userErr('Tidak bisa menghapus semua halaman. Sisakan minimal satu halaman.');
    const doc = await loadDoc(f.bytes);
    del.forEach((i) => doc.removePage(i));
    return [{ name: `${baseOf(f.name)}-dihapus-${del.length}-hal.pdf`, blob: await saveDoc(doc) }];
  };
  OPS.extract = async (ctx) => {
    const f = ctx.files[0];
    const sel = ctx.pages.filter((it) => it.sel);
    if (!sel.length) throw userErr('Klik halaman yang ingin diambil terlebih dahulu.');
    if (ctx.opt.out === 'each') {
      const src = await loadDoc(f.bytes);
      const outs = [];
      for (let k = 0; k < sel.length; k++) {
        ctx.progress(`Membuat file ${k + 1}/${sel.length}…`, k / sel.length);
        const d = await newDoc();
        d.addPage((await d.copyPages(src, [sel[k].i]))[0]);
        outs.push({ name: `${baseOf(f.name)}-hal${sel[k].i + 1}.pdf`, blob: await saveDoc(d) });
      }
      return outs;
    }
    const out = await buildFromItems(ctx, sel);
    return [{ name: `${baseOf(f.name)}-ambil-${sel.length}-hal.pdf`, blob: await saveDoc(out) }];
  };

  OPS.nup = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    const src = await loadDoc(f.bytes);
    const N = num(o.per, 2);
    const grid = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3], 16: [4, 4] }[N] || [2, 1];
    const [pw, ph] = PAPER[o.paper] || PAPER.A4;
    const m = num(o.margin, 5) * MM, gap = num(o.gap, 3) * MM;
    const first = geom(src.getPage(0));
    const fit = (land) => {
      const W = land ? Math.max(pw, ph) : Math.min(pw, ph), H = land ? Math.min(pw, ph) : Math.max(pw, ph);
      const [c, r] = land ? grid : [grid[1], grid[0]];
      const cw = (W - 2 * m - gap * (c - 1)) / c, ch = (H - 2 * m - gap * (r - 1)) / r;
      return { W, H, c, r, cw, ch, s: Math.min(cw / first.vw, ch / first.vh) };
    };
    let Lay;
    if (o.orient === 'portrait') Lay = fit(false);
    else if (o.orient === 'landscape') Lay = fit(true);
    else { const a = fit(false), b = fit(true); Lay = b.s > a.s * 1.01 ? b : a; }
    if (Lay.cw < 20 || Lay.ch < 20) throw userErr('Margin atau jarak terlalu besar untuk ukuran kertas ini.');
    const out = await newDoc();
    const pages = src.getPages();
    const embeds = await out.embedPages(pages, pages.map(cropBB));
    for (let i = 0; i < pages.length; i += N) {
      ctx.progress(`Menyusun lembar ${i / N + 1}/${Math.ceil(pages.length / N)}…`, i / pages.length);
      const sheet = out.addPage([Lay.W, Lay.H]);
      for (let j = 0; j < N && i + j < pages.length; j++) {
        const col = o.order === 'col' ? Math.floor(j / Lay.r) : j % Lay.c;
        const row = o.order === 'col' ? j % Lay.r : Math.floor(j / Lay.c);
        const box = { x: m + col * (Lay.cw + gap), y: m + row * (Lay.ch + gap), w: Lay.cw, h: Lay.ch };
        placeEmbedded(sheet, embeds[i + j], geom(pages[i + j]).rot, box);
        if (o.border) sheet.drawRectangle({ x: box.x, y: Lay.H - box.y - box.h, width: box.w, height: box.h, borderColor: lib().rgb(0.6, 0.62, 0.66), borderWidth: 0.5 });
      }
    }
    return [{ name: `${baseOf(f.name)}-${N}-per-lembar.pdf`, blob: await saveDoc(out) }];
  };

  OPS.resize = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    let [tw, th] = o.paper === 'custom' ? [num(o.cw, 210) * MM, num(o.ch, 297) * MM] : (PAPER[o.paper] || PAPER.A4);
    if (tw < 20 || th < 20) throw userErr('Ukuran kertas terlalu kecil.');
    const src = await loadDoc(f.bytes);
    const out = await newDoc();
    const pages = src.getPages();
    const embeds = await out.embedPages(pages, pages.map(cropBB));
    pages.forEach((sp, i) => {
      ctx.progress(`Mengubah ukuran halaman ${i + 1}/${pages.length}…`, i / pages.length);
      const g = geom(sp);
      const land = o.orient === 'landscape' || (o.orient === 'same' && g.vw > g.vh);
      const W = land ? Math.max(tw, th) : Math.min(tw, th), H = land ? Math.min(tw, th) : Math.max(tw, th);
      const pg = out.addPage([W, H]);
      const mg = num(o.margin, 0) * MM;
      placeEmbedded(pg, embeds[i], g.rot, { x: mg, y: mg, w: W - 2 * mg, h: H - 2 * mg }, o.mode === 'center' ? { scale: 1 } : {});
    });
    return [{ name: `${baseOf(f.name)}-${o.paper === 'custom' ? 'ukuran-baru' : o.paper}.pdf`, blob: await saveDoc(out) }];
  };

  async function contentBox(page) {
    const vp = page.getViewport({ scale: 1 });
    const c = await renderPage(page, Math.min(2, 700 / Math.max(vp.width, vp.height)));
    const { width: w, height: h } = c;
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i] < 238 || d[i + 1] < 238 || d[i + 2] < 238) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    c.width = c.height = 0;
    if (x1 < 0) return null;
    return { l: x0 / w, t: y0 / h, r: (x1 + 1) / w, b: (y1 + 1) / h };
  }
  OPS.crop = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    const doc = await loadDoc(f.bytes);
    const n = doc.getPageCount();
    const idx = pageList(o.pages, n);
    const pdf = o.mode === 'auto' ? await pdfjsDoc(f.bytes) : null;
    try {
      for (let k = 0; k < idx.length; k++) {
        ctx.progress(`Memotong halaman ${k + 1}/${idx.length}…`, k / idx.length);
        const i = idx[k];
        const page = doc.getPage(i);
        const g = geom(page);
        let m;
        if (pdf) {
          const bb = await contentBox(await pdf.getPage(i + 1));
          if (!bb) continue;
          const pad = num(o.pad, 3) * MM;
          m = { l: Math.max(0, bb.l * g.vw - pad), t: Math.max(0, bb.t * g.vh - pad), r: Math.max(0, (1 - bb.r) * g.vw - pad), b: Math.max(0, (1 - bb.b) * g.vh - pad) };
        } else {
          m = { t: num(o.t) * MM, r: num(o.r) * MM, b: num(o.b) * MM, l: num(o.l) * MM };
        }
        let L, R, B, Tp;
        switch (g.rot) {
          case 90: L = m.t; B = m.l; Tp = m.r; R = m.b; break;
          case 180: L = m.r; R = m.l; B = m.t; Tp = m.b; break;
          case 270: R = m.t; Tp = m.l; B = m.r; L = m.b; break;
          default: L = m.l; R = m.r; Tp = m.t; B = m.b;
        }
        const w = g.w - L - R, h = g.h - B - Tp;
        if (w < 10 || h < 10) throw userErr(`Margin terlalu besar untuk halaman ${i + 1}.`);
        page.setCropBox(g.x0 + L, g.y0 + B, w, h);
      }
    } finally { if (pdf) pdf.destroy(); }
    return [{ name: `${baseOf(f.name)}-dipotong.pdf`, blob: await saveDoc(doc) }];
  };

  OPS.toPdf = async (ctx) => {
    const parts = [];
    for (let i = 0; i < ctx.files.length; i++) {
      const f = ctx.files[i];
      ctx.progress(`Mengonversi ${f.name}…`, i / ctx.files.length);
      let bytes;
      if (f.kind === 'docx') bytes = await T.docxToPdf(f.file, (a, b) => ctx.progress(`Mengonversi ${f.name} (${a}/${b})…`, i / ctx.files.length));
      else if (f.kind === 'txt') bytes = await textToPdf(await f.file.text());
      else if (f.kind === 'img') { const d = await newDoc(); await addImagePage(d, f.file, { size: 'fit' }); bytes = await d.save(); }
      else bytes = f.bytes;
      parts.push({ name: f.name, bytes });
    }
    if (parts.length > 1 && ctx.opt.merge) {
      const out = await newDoc();
      for (const p of parts) {
        const src = await loadDoc(p.bytes);
        (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg));
      }
      return [{ name: 'hasil-konversi.pdf', blob: await saveDoc(out) }];
    }
    return parts.map((p) => ({ name: baseOf(p.name) + '.pdf', blob: pdfBlob(p.bytes) }));
  };

  OPS.img2pdf = async (ctx) => {
    const o = ctx.opt;
    const opts = { size: o.size, orient: o.orient, margin: o.margin };
    if (o.merge || ctx.files.length === 1) {
      const out = await newDoc();
      for (let i = 0; i < ctx.files.length; i++) {
        ctx.progress(`Menambahkan gambar ${i + 1}/${ctx.files.length}…`, i / ctx.files.length);
        await addImagePage(out, ctx.files[i].file, opts);
      }
      const name = ctx.files.length === 1 ? baseOf(ctx.files[0].name) + '.pdf' : `gambar-${ctx.files.length}-halaman.pdf`;
      return [{ name, blob: await saveDoc(out) }];
    }
    const outs = [];
    for (let i = 0; i < ctx.files.length; i++) {
      ctx.progress(`Mengonversi gambar ${i + 1}/${ctx.files.length}…`, i / ctx.files.length);
      const d = await newDoc();
      await addImagePage(d, ctx.files[i].file, opts);
      outs.push({ name: baseOf(ctx.files[i].name) + '.pdf', blob: await saveDoc(d) });
    }
    return outs;
  };

  OPS.fromPdf = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    if (o.target === 'docx') return [{ name: baseOf(f.name) + '.docx', blob: await pdfToDocx(f, o, ctx.progress) }];
    if (o.target === 'txt') return [{ name: baseOf(f.name) + '.txt', blob: await pdfToText(f, o, ctx.progress) }];
    return pdfToImages(f, { ...o, format: o.target }, ctx.progress);
  };
  OPS.toImages = (ctx) => pdfToImages(ctx.files[0], ctx.opt, ctx.progress);

  OPS.extractImages = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    const pdf = await pdfjsDoc(f.bytes);
    const P = window.pdfjsLib.OPS;
    const seen = new Set();
    const outs = [];
    const min = num(o.min, 40);
    const fmt = o.format === 'jpg' ? 'jpg' : 'png';
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        ctx.progress(`Memindai halaman ${i}/${pdf.numPages}…`, (i - 1) / pdf.numPages);
        const page = await pdf.getPage(i);
        const ops = await page.getOperatorList();
        for (let k = 0; k < ops.fnArray.length; k++) {
          const fn = ops.fnArray[k];
          let img = null;
          if (fn === P.paintImageXObject || fn === P.paintImageXObjectRepeat) {
            const id = ops.argsArray[k][0];
            if (seen.has(id)) continue;
            seen.add(id);
            img = await objOf(page, id);
          } else if (fn === P.paintInlineImageXObject) img = ops.argsArray[k][0];
          else continue;
          if (!img || img.width < min || img.height < min) continue;
          const c = pdfImageToCanvas(img);
          if (!c) continue;
          if (fmt === 'jpg') {
            const x = c.getContext('2d');
            x.globalCompositeOperation = 'destination-over';
            x.fillStyle = '#fff';
            x.fillRect(0, 0, c.width, c.height);
          }
          const blob = await canvasToBlob(c, fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
          outs.push({ name: `${baseOf(f.name)}-gambar${String(outs.length + 1).padStart(2, '0')}-hal${i}.${fmt}`, blob });
          c.width = c.height = 0;
        }
      }
    } finally { pdf.destroy(); }
    if (!outs.length) throw userErr('Tidak ditemukan gambar di PDF ini (atau semua gambarnya lebih kecil dari batas minimum).');
    return outs;
  };

  OPS.ocr = async (ctx) => {
    if (T.IS_FILE) throw userErr('OCR memerlukan TTD.in versi online atau yang sudah dipasang sebagai aplikasi (tidak bisa dari file lokal).');
    const o = ctx.opt;
    ctx.progress('Memuat mesin OCR…');
    await loadScript('vendor/tesseract/tesseract.min.js');
    const base = new URL('vendor/tesseract/', location.href).href;
    let curPage = 0, total = 1;
    const worker = await window.Tesseract.createWorker(String(o.lang || 'ind+eng').split('+'), 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base.replace(/\/$/, ''),
      workerBlobURL: false,
      gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text') ctx.progress(`Mengenali teks halaman ${curPage}/${total}… ${Math.round(m.progress * 100)}%`, (curPage - 1 + m.progress) / total);
        else if (curPage === 0) ctx.progress('Memuat mesin OCR & data bahasa (pertama kali agak lama)…', typeof m.progress === 'number' ? m.progress * 0.1 : undefined);
      },
    });
    try {
      let bytes;
      const first = ctx.files[0];
      if (first.kind === 'img') {
        const d = await newDoc();
        for (const x of ctx.files) await addImagePage(d, x.file, { size: 'fit' });
        bytes = await d.save();
      } else bytes = first.bytes;
      const doc = await loadDoc(bytes);
      const pdf = await pdfjsDoc(bytes);
      const idx = pageList(o.pages, pdf.numPages);
      total = idx.length;
      const dpi = 300;
      await worker.setParameters({ user_defined_dpi: String(dpi) });
      const wantPdf = o.out !== 'txt', wantTxt = o.out !== 'pdf';
      const texts = [];
      for (let k = 0; k < idx.length; k++) {
        curPage = k + 1;
        ctx.progress(`Mengenali teks halaman ${curPage}/${total}…`, k / total);
        const page = await pdf.getPage(idx[k] + 1);
        const c = await renderPage(page, scaleFor(page, dpi, 4200));
        const { data } = await worker.recognize(c, { pdfTitle: baseOf(first.name), pdfTextOnly: true }, { pdf: wantPdf, text: true });
        texts.push((data.text || '').trim());
        c.width = c.height = 0;
        page.cleanup();
        if (wantPdf && data.pdf) {
          const od = await lib().PDFDocument.load(new Uint8Array(data.pdf));
          const [emb] = await doc.embedPdf(od, [0]);
          const target = doc.getPage(idx[k]);
          const g = geom(target);
          placeEmbedded(target, emb, 0, { x: 0, y: 0, w: g.vw, h: g.vh }, { stretch: true });
        }
      }
      pdf.destroy();
      const outs = [];
      const name = baseOf(first.name);
      if (wantPdf) outs.push({ name: `${name}-ocr.pdf`, blob: await saveDoc(doc) });
      if (wantTxt) outs.push({ name: `${name}-ocr.txt`, blob: new Blob(['﻿' + texts.map((t, k) => `--- Halaman ${idx[k] + 1} ---\n${t}`).join('\n\n')], { type: 'text/plain;charset=utf-8' }) });
      if (!texts.some((t) => t)) outs.note = 'OCR selesai, tetapi tidak ada teks yang terbaca. Pastikan hasil scan cukup jelas dan bahasanya sesuai.';
      return outs;
    } finally { await worker.terminate(); }
  };

  function drawStamp(sp, vw, vh, o) {
    const L = lib();
    const ang = num(o.angle, 0);
    const rad = (ang * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const at = (cx, cy, w, h, fn) => fn(cx - cos * w / 2 + sin * h / 2, cy - sin * w / 2 - cos * h / 2);
    let w, h, draw;
    if (o.image) {
      w = vw * clamp(num(o.scale, 50), 5, 100) / 100;
      h = (w * o.image.height) / o.image.width;
      draw = (x, y) => sp.drawImage(o.image, { x, y, width: w, height: h, rotate: L.degrees(ang), opacity: o.opacityV });
    } else {
      const size = clamp(num(o.size, 60), 6, 300);
      const text = winAnsi(o.text || 'RAHASIA').replace(/\n/g, ' ');
      w = o.font.widthOfTextAtSize(text, size);
      h = size * 0.72;
      draw = (x, y) => sp.drawText(text, { x, y, size, font: o.font, color: rgbHex(o.color), opacity: o.opacityV, rotate: L.degrees(ang) });
    }
    const margin = 24;
    const bw = Math.abs(w * cos) + Math.abs(h * sin), bh = Math.abs(w * sin) + Math.abs(h * cos);
    if (o.pos === 'tile') {
      const sx = bw + Math.max(40, w * 0.35), sy = bh + Math.max(40, h * 2.2);
      let row = 0;
      for (let y = -sy; y < vh + sy; y += sy, row++) {
        for (let x = (row % 2 ? sx / 2 : 0) - sx; x < vw + sx; x += sx) at(x, y, w, h, draw);
      }
    } else if (o.pos === 'top') at(vw / 2, vh - margin - bh / 2, w, h, draw);
    else if (o.pos === 'bottom') at(vw / 2, margin + bh / 2, w, h, draw);
    else at(vw / 2, vh / 2, w, h, draw);
  }
  OPS.watermark = async (ctx) => {
    const L = lib(), o = ctx.opt;
    if (o.type === 'image' && !ctx.extra.wmImage) throw userErr('Pilih gambar untuk watermark terlebih dahulu.');
    if (o.type === 'text' && !String(o.text || '').trim()) throw userErr('Isi teks watermark terlebih dahulu.');
    const outs = [];
    for (let fi = 0; fi < ctx.files.length; fi++) {
      const f = ctx.files[fi];
      ctx.progress(`Menambahkan watermark ke ${f.name}…`, fi / ctx.files.length);
      const doc = await loadDoc(f.bytes);
      const idx = pageList(o.pages, doc.getPageCount());
      const stampDoc = await L.PDFDocument.create();
      const st = { ...o, opacityV: clamp(num(o.opacity, 25), 1, 100) / 100 };
      if (o.type === 'image') {
        const file = ctx.extra.wmImage;
        st.image = (await embedImageFile(stampDoc, file)).img;
      } else st.font = await stampDoc.embedFont(L.StandardFonts.HelveticaBold);
      const keys = [];
      const sizes = new Map();
      for (const i of idx) {
        const g = geom(doc.getPage(i));
        const key = `${g.vw.toFixed(1)}x${g.vh.toFixed(1)}`;
        keys.push(key);
        if (!sizes.has(key)) { sizes.set(key, sizes.size); drawStamp(stampDoc.addPage([g.vw, g.vh]), g.vw, g.vh, st); }
      }
      const sd = await L.PDFDocument.load(await stampDoc.save());
      const embs = await doc.embedPages(sd.getPages());
      idx.forEach((i, k) => {
        const page = doc.getPage(i);
        const g = geom(page);
        placeEmbedded(page, embs[sizes.get(keys[k])], 0, { x: 0, y: 0, w: g.vw, h: g.vh }, { stretch: true, behind: o.layer === 'back' });
      });
      outs.push({ name: `${baseOf(f.name)}-watermark.pdf`, blob: await saveDoc(doc) });
    }
    return outs;
  };

  OPS.pagenum = async (ctx) => {
    const L = lib(), o = ctx.opt;
    const f = ctx.files[0];
    const doc = await loadDoc(f.bytes);
    const font = await doc.embedFont(L.StandardFonts[o.font] || L.StandardFonts.Helvetica);
    const n = doc.getPageCount();
    const from = clamp(Math.round(num(o.from, 1)), 1, n);
    const start = Math.round(num(o.start, 1));
    const totalNum = start + (n - from);
    const fmt = o.format === 'custom' ? (o.custom || '{n}') : o.format;
    const size = clamp(num(o.size, 11), 5, 72);
    const m = clamp(num(o.margin, 12), 0, 100) * MM;
    const [vpos, hpos] = String(o.pos || 'bottom-center').split('-');
    for (let i = from - 1; i < n; i++) {
      const nr = start + (i - (from - 1));
      const text = winAnsi(fmt.replace(/\{n\}/g, nr).replace(/\{total\}/g, totalNum));
      const page = doc.getPage(i);
      const g = geom(page);
      const tw = font.widthOfTextAtSize(text, size);
      let side = hpos;
      if (o.mirror && hpos !== 'center' && nr % 2 === 0) side = hpos === 'left' ? 'right' : 'left';
      const u = side === 'left' ? m : side === 'right' ? g.vw - m - tw : (g.vw - tw) / 2;
      const v = vpos === 'top' ? m + size * 0.75 : g.vh - m;
      const p = toUser(g, u, v);
      page.drawText(text, { x: p.x, y: p.y, size, font, color: rgbHex(o.color), rotate: L.degrees(g.rot) });
    }
    return [{ name: `${baseOf(f.name)}-bernomor.pdf`, blob: await saveDoc(doc) }];
  };

  OPS.overlay = async (ctx) => {
    const o = ctx.opt;
    const [main, ov] = ctx.files;
    const doc = await loadDoc(main.bytes);
    const odoc = await loadDoc(ov.bytes);
    const opages = odoc.getPages();
    const embs = await doc.embedPages(opages, opages.map(cropBB));
    const n = doc.getPageCount();
    const idx = o.apply === 'first' ? [0] : o.apply === 'custom' ? pageList(o.pages, n) : range(0, n);
    idx.forEach((i, k) => {
      ctx.progress(`Menempel lapisan ${k + 1}/${idx.length}…`, k / idx.length);
      const j = o.which === 'match' ? Math.min(i, embs.length - 1) : 0;
      const page = doc.getPage(i);
      const g = geom(page);
      const op = clamp(num(o.opacity, 100), 1, 100) / 100;
      placeEmbedded(page, embs[j], geom(opages[j]).rot, { x: 0, y: 0, w: g.vw, h: g.vh }, {
        stretch: o.fit === 'stretch', scale: o.fit === 'original' ? 1 : undefined, behind: o.layer === 'back', opacity: op < 1 ? op : undefined,
      });
    });
    return [{ name: `${baseOf(main.name)}-overlay.pdf`, blob: await saveDoc(doc) }];
  };

  OPS.compare = async (ctx) => {
    const o = ctx.opt;
    const [A, B] = ctx.files;
    const pa = await pdfjsDoc(A.bytes), pb = await pdfjsDoc(B.bytes);
    let html = '';
    try {
      if (o.mode !== 'visual') {
        const read = async (pdf, label) => {
          const out = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            ctx.progress(`Membaca teks ${label} halaman ${i}/${pdf.numPages}…`);
            const pg = await pageLines(await pdf.getPage(i));
            for (const l of pg.lines) out.push({ t: l.text.replace(/\s+/g, ' ').trim(), p: i });
          }
          return out;
        };
        const la = await read(pa, 'A'), lb = await read(pb, 'B');
        ctx.progress('Membandingkan teks…');
        const ops = diffSeq(la.map((x) => x.t), lb.map((x) => x.t));
        let add = 0, del = 0, chg = 0;
        const rows = [];
        for (let k = 0; k < ops.length; k++) {
          const [op, i, j] = ops[k];
          if (op === '=') { rows.push({ t: 'eq', a: la[i], b: lb[j] }); continue; }
          if (op === '-' && ops[k + 1] && ops[k + 1][0] === '+') {
            const [ha, hb] = wordDiffHtml(la[i].t, lb[ops[k + 1][2]].t);
            rows.push({ t: 'chg', a: la[i], b: lb[ops[k + 1][2]], ha, hb });
            chg++; k++;
            continue;
          }
          if (op === '-') { rows.push({ t: 'del', a: la[i] }); del++; }
          else { rows.push({ t: 'add', b: lb[j] }); add++; }
        }
        let body = '';
        for (let k = 0; k < rows.length; k++) {
          const r = rows[k];
          if (r.t === 'eq') {
            let e = k;
            while (e < rows.length && rows[e].t === 'eq') e++;
            const len = e - k;
            const show = (x) => `<tr class="eq"><td class="pn">${x.a.p}</td><td>${esc(x.a.t)}</td><td class="pn">${x.b.p}</td><td>${esc(x.b.t)}</td></tr>`;
            if (len > 6) {
              const headN = k === 0 ? 0 : 2, tailN = e === rows.length ? 0 : 2;
              for (let q = k; q < k + headN; q++) body += show(rows[q]);
              body += `<tr class="skip"><td colspan="4">… ${len - headN - tailN} baris sama …</td></tr>`;
              for (let q = e - tailN; q < e; q++) body += show(rows[q]);
            } else for (let q = k; q < e; q++) body += show(rows[q]);
            k = e - 1;
          } else if (r.t === 'chg') body += `<tr class="chg"><td class="pn">${r.a.p}</td><td>${r.ha}</td><td class="pn">${r.b.p}</td><td>${r.hb}</td></tr>`;
          else if (r.t === 'del') body += `<tr class="del"><td class="pn">${r.a.p}</td><td><del>${esc(r.a.t)}</del></td><td class="pn"></td><td></td></tr>`;
          else body += `<tr class="add"><td class="pn"></td><td></td><td class="pn">${r.b.p}</td><td><ins>${esc(r.b.t)}</ins></td></tr>`;
        }
        const same = !add && !del && !chg;
        html += `<section class="cmp-sec"><h3>Perbandingan teks</h3>
          <div class="cmp-stats"><span class="st-chg">${chg} baris diubah</span><span class="st-add">${add} ditambahkan</span><span class="st-del">${del} dihapus</span></div>
          ${!la.length && !lb.length ? '<p class="cmp-empty">Kedua dokumen tidak memiliki teks yang bisa dibaca (kemungkinan hasil scan). Gunakan perbandingan visual.</p>'
    : same ? '<p class="cmp-same">Teks kedua dokumen sama persis.</p>'
      : `<div class="cmp-table-wrap"><table class="cmp-table"><thead><tr><th class="pn">Hal</th><th>${esc(A.name)}</th><th class="pn">Hal</th><th>${esc(B.name)}</th></tr></thead><tbody>${body}</tbody></table></div>`}</section>`;
      }
      if (o.mode !== 'text') {
        const n = Math.min(Math.max(pa.numPages, pb.numPages), 40);
        let cards = '', diffPages = 0;
        for (let i = 1; i <= n; i++) {
          ctx.progress(`Membandingkan tampilan halaman ${i}/${n}…`, (i - 1) / n);
          if (i > pa.numPages || i > pb.numPages) {
            cards += `<figure class="cmp-card only"><div class="cmp-miss">Hanya ada di dokumen ${i > pa.numPages ? 'B' : 'A'}</div><figcaption>Halaman ${i}</figcaption></figure>`;
            diffPages++;
            continue;
          }
          const p1 = await pa.getPage(i), p2 = await pb.getPage(i);
          const v1 = p1.getViewport({ scale: 1 });
          const sc = 620 / v1.width;
          const c1 = await renderPage(p1, sc), c2 = await renderPage(p2, sc * (v1.width / p2.getViewport({ scale: 1 }).width));
          const w = Math.min(c1.width, c2.width), h = Math.min(c1.height, c2.height);
          const d1 = c1.getContext('2d').getImageData(0, 0, w, h).data;
          const d2 = c2.getContext('2d').getImageData(0, 0, w, h).data;
          const out = document.createElement('canvas');
          out.width = c2.width; out.height = c2.height;
          const ox = out.getContext('2d');
          ox.drawImage(c2, 0, 0);
          const od = ox.getImageData(0, 0, out.width, out.height);
          const px = od.data;
          let changed = 0;
          for (let y = 0; y < out.height; y++) {
            for (let x = 0; x < out.width; x++) {
              const q = (y * out.width + x) * 4;
              const l = 0.3 * px[q] + 0.59 * px[q + 1] + 0.11 * px[q + 2];
              let diff = x >= w || y >= h;
              if (!diff) {
                const s = (y * w + x) * 4;
                diff = Math.abs(d1[s] - d2[s]) + Math.abs(d1[s + 1] - d2[s + 1]) + Math.abs(d1[s + 2] - d2[s + 2]) > 90;
              }
              if (diff) { changed++; px[q] = 239; px[q + 1] = 68; px[q + 2] = 68; }
              else { const g = 255 - (255 - l) * 0.35; px[q] = px[q + 1] = px[q + 2] = g; }
            }
          }
          ox.putImageData(od, 0, 0);
          const pct = (changed / (out.width * out.height)) * 100;
          if (pct > 0.01) diffPages++;
          cards += `<figure class="cmp-card${pct > 0.01 ? ' diff' : ''}"><img src="${out.toDataURL('image/jpeg', 0.8)}" alt="Perbedaan halaman ${i}"><figcaption>Halaman ${i} · ${pct > 0.01 ? `berbeda ${pct < 0.1 ? '< 0,1' : pct.toFixed(1).replace('.', ',')}%` : 'sama'}</figcaption></figure>`;
          [c1, c2, out].forEach((c) => { c.width = c.height = 0; });
        }
        const more = Math.max(pa.numPages, pb.numPages) > 40 ? '<p class="cmp-note">Perbandingan visual dibatasi 40 halaman pertama.</p>' : '';
        html += `<section class="cmp-sec"><h3>Perbandingan visual</h3><p class="cmp-note">Bagian berwarna <b class="red">merah</b> menandai area yang berbeda (ditampilkan di atas dokumen B). ${diffPages ? `${diffPages} halaman berbeda.` : 'Tidak ada perbedaan tampilan.'}</p>${more}<div class="cmp-grid">${cards}</div></section>`;
      }
    } finally { pa.destroy(); pb.destroy(); }
    return { html };
  };

  OPS.flatten = async (ctx) => {
    const f = ctx.files[0];
    if (ctx.opt.mode === 'form') {
      const doc = await loadDoc(f.bytes);
      let form;
      try { form = doc.getForm(); } catch (_) { form = null; }
      const fields = form ? form.getFields() : [];
      if (!fields.length) throw userErr('PDF ini tidak memiliki kolom formulir. Pilih mode "Seluruh halaman jadi gambar" untuk meratakan anotasi/komentar.');
      try { form.flatten(); } catch (e) {
        console.warn(e);
        throw userErr('Formulir ini tidak bisa diratakan otomatis. Coba mode "Seluruh halaman jadi gambar".');
      }
      return [{ name: `${baseOf(f.name)}-rata.pdf`, blob: await saveDoc(doc) }];
    }
    const out = await rasterize(f.bytes, num(ctx.opt.dpi, 150), 0.88, ctx.progress, 'Meratakan halaman');
    return [{ name: `${baseOf(f.name)}-rata.pdf`, blob: await saveDoc(out) }];
  };

  async function compressBytes(f, cfg, o, progress) {
    if (o.raster) {
      const out = await rasterize(f.bytes, cfg.dpi, cfg.q, progress, 'Mengompres halaman');
      return out.save({ useObjectStreams: true });
    }
    const doc = await loadDoc(f.bytes);
    await recompressImages(doc, cfg, progress);
    if (o.strip) stripMetadata(doc);
    progress('Merapikan struktur PDF…');
    collectGarbage(doc);
    return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  }
  function sizeNote(before, after) {
    const pct = Math.round((1 - after / before) * 100);
    return `Ukuran ${fmtSize(before)} → ${fmtSize(after)} (${pct > 0 ? `lebih kecil ${pct}%` : 'tidak berubah'}).`;
  }
  OPS.compress = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    const cfg = { low: { max: 2400, q: 0.85, dpi: 150 }, mid: { max: 1600, q: 0.72, dpi: 110 }, high: { max: 1100, q: 0.55, dpi: 80 } }[o.level] || { max: 1600, q: 0.72, dpi: 110 };
    const bytes = await compressBytes(f, cfg, o, ctx.progress);
    if (bytes.length >= f.bytes.length * 0.98) {
      const res = [{ name: `${baseOf(f.name)}-kompres.pdf`, blob: pdfBlob(f.bytes) }];
      res.note = `PDF ini sudah cukup optimal (${fmtSize(f.bytes.length)}), tidak bisa dikecilkan lagi dengan pengaturan ini.${o.raster ? '' : ' Coba tingkat "Kuat", atau centang "Ubah semua halaman jadi gambar".'}`;
      return res;
    }
    const res = [{ name: `${baseOf(f.name)}-kompres.pdf`, blob: pdfBlob(bytes) }];
    res.note = sizeNote(f.bytes.length, bytes.length);
    return res;
  };
  OPS.optimize = async (ctx) => {
    const f = ctx.files[0];
    const bytes = await compressBytes(f, { max: 1800, q: 0.78, dpi: 120 }, { strip: ctx.opt.strip }, ctx.progress);
    const best = bytes.length < f.bytes.length ? bytes : f.bytes;
    const res = [{ name: `${baseOf(f.name)}-web.pdf`, blob: pdfBlob(best) }];
    res.note = sizeNote(f.bytes.length, best.length) + ' Gambar diperkecil untuk layar dan struktur dipadatkan agar cepat dibuka di web/WhatsApp.';
    return res;
  };

  OPS.repair = async (ctx) => {
    const f = ctx.files[0];
    try {
      ctx.progress('Membaca ulang struktur PDF…');
      const doc = await lib().PDFDocument.load(f.bytes, { updateMetadata: false, throwOnInvalidObject: false, ignoreEncryption: false });
      if (!doc.getPageCount()) throw new Error('Tidak ada halaman');
      collectGarbage(doc);
      const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
      const test = await pdfjsDoc(bytes);
      await test.getPage(1);
      const pages = test.numPages;
      test.destroy();
      const res = [{ name: `${baseOf(f.name)}-diperbaiki.pdf`, blob: pdfBlob(bytes) }];
      res.note = `Struktur PDF ditulis ulang (${pages} halaman). Teks tetap bisa dipilih dan dicari.`;
      return res;
    } catch (e) {
      console.warn('Perbaikan struktur gagal, beralih ke mode gambar:', e);
      let out;
      try { out = await rasterize(f.bytes, 150, 0.88, ctx.progress, 'Menyelamatkan halaman'); }
      catch (e2) { console.error(e2); throw userErr('File ini rusak terlalu parah dan tidak bisa diperbaiki di browser.'); }
      const res = [{ name: `${baseOf(f.name)}-diperbaiki.pdf`, blob: await saveDoc(out) }];
      res.note = 'Struktur file rusak berat, jadi halaman yang masih terbaca disusun ulang sebagai gambar.';
      return res;
    }
  };

  OPS.protect = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    if (!o.pw) throw userErr('Isi kata sandi terlebih dahulu.');
    if (o.pw !== o.pw2) throw userErr('Konfirmasi kata sandi tidak sama.');
    if (o.owner && o.owner === o.pw) throw userErr('Kata sandi pemilik sebaiknya berbeda dari kata sandi membuka.');
    await loadScript('js/pdfcrypt.js');
    ctx.progress('Mengenkripsi PDF (AES-256)…');
    const bytes = await window.PDFCrypt.encrypt(f.bytes, {
      userPassword: o.pw, ownerPassword: o.owner || '',
      permissions: { print: o.print, copy: o.copy, modify: o.modify, annotate: o.annotate },
    });
    const res = [{ name: `${baseOf(f.name)}-terkunci.pdf`, blob: pdfBlob(bytes) }];
    res.note = 'PDF dikunci dengan AES-256. Simpan kata sandinya baik-baik: tanpa kata sandi, file tidak bisa dibuka (juga oleh TTD.in).';
    return res;
  };
  OPS.unlock = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    await loadScript('js/pdfcrypt.js');
    ctx.progress('Membuka kunci PDF…');
    let r;
    try {
      r = await window.PDFCrypt.decrypt(f.bytes, o.pw || '');
    } catch (e) {
      if (e.code === 'PASSWORD') throw userErr(o.pw ? 'Kata sandi salah. Periksa huruf besar/kecil lalu coba lagi.' : 'PDF ini memerlukan kata sandi untuk dibuka. Isi kolom kata sandi lalu coba lagi.');
      console.warn('Dekripsi langsung gagal, mencoba mode gambar:', e);
      await ensureLibs();
      let pdf;
      try { pdf = await window.pdfjsLib.getDocument({ data: f.bytes.slice(), password: o.pw || '', isEvalSupported: false }).promise; }
      catch (e2) { if (e2 && e2.name === 'PasswordException') throw userErr('Kata sandi salah atau belum diisi.'); throw e2; }
      const out = await newDoc();
      for (let i = 1; i <= pdf.numPages; i++) {
        ctx.progress(`Menyusun halaman ${i}/${pdf.numPages}…`, (i - 1) / pdf.numPages);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const c = await renderPage(page, scaleFor(page, 170, 5000), { forms: true });
        out.addPage([vp.width, vp.height]).drawImage(await out.embedJpg(await canvasBytes(c, 'image/jpeg', 0.9)), { x: 0, y: 0, width: vp.width, height: vp.height });
        c.width = c.height = 0;
      }
      pdf.destroy();
      const res = [{ name: `${baseOf(f.name)}-terbuka.pdf`, blob: await saveDoc(out) }];
      res.note = 'Metode enkripsi file ini tidak umum, jadi halaman disusun ulang sebagai gambar (teks tidak bisa dipilih).';
      return res;
    }
    if (!r.wasEncrypted) throw userErr('PDF ini tidak terkunci, jadi tidak ada yang perlu dibuka.');
    const res = [{ name: `${baseOf(f.name)}-terbuka.pdf`, blob: pdfBlob(r.bytes) }];
    res.note = 'Kunci dan pembatasan (cetak, salin, edit) sudah dilepas.';
    return res;
  };

  const META_FIELDS = [['title', 'Judul', 'Title'], ['author', 'Penulis', 'Author'], ['subject', 'Subjek', 'Subject'], ['keywords', 'Kata kunci', 'Keywords'], ['creator', 'Aplikasi pembuat', 'Creator'], ['producer', 'Produser PDF', 'Producer']];
  OPS.editMeta = async (ctx) => {
    const f = ctx.files[0], o = ctx.opt;
    const doc = await loadDoc(f.bytes);
    const clean = (s) => String(s || '').trim();
    doc.setTitle(clean(o.title), { showInWindowTitleBar: !!clean(o.title) });
    doc.setAuthor(clean(o.author));
    doc.setSubject(clean(o.subject));
    doc.setKeywords(clean(o.keywords) ? clean(o.keywords).split(/\s*[,;]\s*/).filter(Boolean) : []);
    doc.setCreator(clean(o.creator));
    doc.setProducer(clean(o.producer));
    doc.setModificationDate(new Date());
    doc.catalog.delete(lib().PDFName.of('Metadata'));
    return [{ name: `${baseOf(f.name)}-metadata.pdf`, blob: await saveDoc(doc) }];
  };
  OPS.removeMeta = async (ctx) => {
    const f = ctx.files[0];
    const doc = await loadDoc(f.bytes);
    stripMetadata(doc);
    collectGarbage(doc);
    const res = [{ name: `${baseOf(f.name)}-tanpa-metadata.pdf`, blob: await saveDoc(doc, { updateFieldAppearances: false }) }];
    res.note = 'Judul, penulis, aplikasi pembuat, tanggal, dan metadata XMP sudah dihapus.';
    return res;
  };

  const VIEW_FLAGS = [['HideToolbar', 'Sembunyikan toolbar'], ['HideMenubar', 'Sembunyikan menu'], ['HideWindowUI', 'Sembunyikan panel & navigasi'],
    ['FitWindow', 'Sesuaikan jendela dengan halaman'], ['CenterWindow', 'Tampilkan jendela di tengah layar'], ['DisplayDocTitle', 'Tampilkan judul dokumen (bukan nama file)']];
  OPS.viewer = async (ctx) => {
    const { PDFName, PDFDict } = lib();
    const f = ctx.files[0], o = ctx.opt;
    const doc = await loadDoc(f.bytes);
    const cat = doc.catalog;
    const setName = (key, v) => (v ? cat.set(PDFName.of(key), PDFName.of(v)) : cat.delete(PDFName.of(key)));
    setName('PageLayout', o.layout);
    setName('PageMode', o.mode);
    let vp = cat.lookup(PDFName.of('ViewerPreferences'));
    if (!(vp instanceof PDFDict)) { vp = doc.context.obj({}); cat.set(PDFName.of('ViewerPreferences'), vp); }
    for (const [key] of VIEW_FLAGS) {
      if (o['vf' + key]) vp.set(PDFName.of(key), doc.context.obj(true));
      else vp.delete(PDFName.of(key));
    }
    const setVp = (key, v) => (v ? vp.set(PDFName.of(key), PDFName.of(v)) : vp.delete(PDFName.of(key)));
    setVp('Direction', o.direction === 'R2L' ? 'R2L' : '');
    setVp('PrintScaling', o.printScaling === 'None' ? 'None' : '');
    setVp('Duplex', o.duplex);
    return [{ name: `${baseOf(f.name)}-tampilan.pdf`, blob: await saveDoc(doc) }];
  };

  OPS.bookmarks = async (ctx) => {
    const f = ctx.files[0];
    const doc = await loadDoc(f.bytes);
    const n = doc.getPageCount();
    const items = (ctx.extra.bm || []).filter((b) => String(b.title).trim()).map((b) => ({ title: b.title.trim(), page: clamp(Math.round(num(b.page, 1)), 1, n) - 1, level: b.level }));
    writeOutline(doc, items, ctx.opt.open && items.length > 0);
    const res = [{ name: `${baseOf(f.name)}-bookmark.pdf`, blob: await saveDoc(doc) }];
    res.note = items.length ? `${items.length} bookmark disimpan.` : 'Semua bookmark dihapus dari dokumen.';
    return res;
  };

  // ---------- Dokumen baru: invoice & surat lamaran ----------
  /** Penulis paragraf sederhana dengan pindah halaman otomatis. */
  function writer(doc, o) {
    const L = lib();
    const [W, H] = PAPER.A4;
    const st = { doc, page: null, y: 0, W, H, ...o };
    st.newPage = () => { st.page = doc.addPage([W, H]); st.y = H - st.top; };
    st.ensure = (h) => { if (!st.page || st.y - h < st.bottom) st.newPage(); };
    st.text = (s, x, y, f = {}) => {
      s = winAnsi(s);
      const font = f.bold ? st.bold : st.font;
      const size = f.size || st.size;
      let xx = x;
      if (f.align === 'right') xx = x - font.widthOfTextAtSize(s, size);
      else if (f.align === 'center') xx = x - font.widthOfTextAtSize(s, size) / 2;
      st.page.drawText(s, { x: xx, y, size, font, color: f.color || st.color || L.rgb(0, 0, 0) });
    };
    /** Tulis paragraf (mendukung tab "Label\t: isi", daftar bernomor, dan rata kiri-kanan). */
    st.para = (text, f = {}) => {
      const font = f.bold ? st.bold : st.font;
      const size = f.size || st.size;
      const lh = size * (f.lh || st.lh || 1.5);
      const x = st.left, maxW = st.W - st.left - st.right;
      // Tab dibaca sebelum dibersihkan winAnsi (yang mengubah tab menjadi spasi).
      for (const src of String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')) {
        if (!src.trim()) { st.y -= lh * 0.55; continue; }
        const tab = src.indexOf('\t');
        const raw = winAnsi(src);
        if (tab >= 0) {
          const label = winAnsi(src.slice(0, tab)), rest = winAnsi(src.slice(tab + 1).replace(/\t/g, ' '));
          const tx = x + (f.tab || 150);
          const lines = wrapText(rest, font, size, maxW - (tx - x));
          lines.forEach((ln, i) => {
            st.ensure(lh);
            if (i === 0) st.page.drawText(label, { x: x + (f.indent || 0), y: st.y - size, size, font, color: st.color });
            st.page.drawText(ln, { x: tx, y: st.y - size, size, font, color: st.color });
            st.y -= lh;
          });
          continue;
        }
        const mk = raw.match(/^(\s*(?:\d+[.)]|[-•]))\s+/);
        const hang = mk ? font.widthOfTextAtSize(mk[0], size) : 0;
        const lines = wrapText(mk ? raw.slice(mk[0].length) : raw, font, size, maxW - hang);
        lines.forEach((ln, i) => {
          st.ensure(lh);
          const y = st.y - size;
          if (mk && i === 0) st.page.drawText(mk[1], { x, y, size, font, color: st.color });
          const words = ln.split(' ');
          const last = i === lines.length - 1;
          if (f.justify && !last && words.length > 1) {
            const ww = words.reduce((s, w) => s + font.widthOfTextAtSize(w, size), 0);
            const gap = (maxW - hang - ww) / (words.length - 1);
            let cx = x + hang;
            for (const w of words) { st.page.drawText(w, { x: cx, y, size, font, color: st.color }); cx += font.widthOfTextAtSize(w, size) + gap; }
          } else st.page.drawText(ln, { x: x + hang, y, size, font, color: st.color });
          st.y -= lh;
        });
      }
    };
    return st;
  }
  async function signatureImage(doc, id) {
    const sig = (T.loadSaved() || []).find((s) => s.id === id);
    if (!sig) return null;
    try { return await doc.embedPng(dataUrlToBytes(sig.src)); } catch (_) { return null; }
  }

  async function buildInvoice(d) {
    const L = lib();
    const doc = await newDoc();
    doc.setTitle(`Invoice ${d.no || ''}`.trim());
    const F = await doc.embedFont(L.StandardFonts.Helvetica), FB = await doc.embedFont(L.StandardFonts.HelveticaBold);
    const brand = rgbHex(d.color || '#4f46e5');
    const ink = L.rgb(0.06, 0.09, 0.16), mute = L.rgb(0.39, 0.45, 0.55), line = L.rgb(0.88, 0.9, 0.93), zebra = L.rgb(0.97, 0.98, 0.99);
    const M = 48;
    const st = writer(doc, { font: F, bold: FB, size: 10, color: ink, top: M, bottom: 60, left: M, right: M, lh: 1.4 });
    st.newPage();
    const { W } = st;
    let y = st.y;
    let lx = M;
    if (d.logo) {
      try {
        const img = d.logo.startsWith('data:image/png') ? await doc.embedPng(dataUrlToBytes(d.logo)) : await doc.embedJpg(dataUrlToBytes(d.logo));
        const s = Math.min(54 / img.height, 140 / img.width);
        st.page.drawImage(img, { x: M, y: y - img.height * s, width: img.width * s, height: img.height * s });
        lx = M + img.width * s + 14;
      } catch (_) { /* logo dilewati */ }
    }
    st.text(d.seller || 'Nama Usaha Anda', lx, y - 14, { bold: true, size: 14 });
    let sy = y - 30;
    for (const ln of wrapText(winAnsi(d.sellerInfo || ''), F, 9, 250)) { st.text(ln, lx, sy, { size: 9, color: mute }); sy -= 12; }
    st.text('INVOICE', W - M, y - 24, { bold: true, size: 26, color: brand, align: 'right' });
    let my = y - 44;
    const meta = [['No. Invoice', d.no], ['Tanggal', idDate(d.date)], d.due ? ['Jatuh tempo', idDate(d.due)] : null].filter(Boolean);
    for (const [k, v] of meta) {
      st.text(k, W - M - 110, my, { size: 9, color: mute, align: 'right' });
      st.text(v || '-', W - M, my, { size: 9.5, bold: true, align: 'right' });
      my -= 14;
    }
    y = Math.min(sy, my, y - 60) - 14;
    st.page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line });
    y -= 22;
    st.text('DITAGIHKAN KEPADA', M, y, { size: 8, bold: true, color: mute });
    y -= 15;
    st.text(d.buyer || '-', M, y, { bold: true, size: 11.5 });
    y -= 14;
    for (const ln of wrapText(winAnsi(d.buyerInfo || ''), F, 9.5, 300)) { st.text(ln, M, y, { size: 9.5, color: mute }); y -= 12.5; }
    y -= 16;
    // Tabel item
    const cols = [{ k: 'no', w: 26, t: 'No', a: 'left' }, { k: 'desc', w: 0, t: 'Deskripsi', a: 'left' }, { k: 'qty', w: 46, t: 'Qty', a: 'right' }, { k: 'price', w: 96, t: 'Harga', a: 'right' }, { k: 'sum', w: 100, t: 'Jumlah', a: 'right' }];
    const tw = W - 2 * M;
    cols[1].w = tw - cols.reduce((s, c) => s + c.w, 0);
    let cx = M;
    cols.forEach((c) => { c.x = cx; cx += c.w; });
    const cell = (c, s, yy, f) => st.text(s, c.a === 'right' ? c.x + c.w - 8 : c.x + 8, yy, { ...f, align: c.a === 'right' ? 'right' : undefined });
    const header = () => {
      st.page.drawRectangle({ x: M, y: y - 22, width: tw, height: 22, color: brand });
      cols.forEach((c) => cell(c, c.t, y - 15, { bold: true, size: 9, color: L.rgb(1, 1, 1) }));
      y -= 22;
    };
    header();
    let subtotal = 0;
    d.items.forEach((it, i) => {
      const qty = num(it.qty, 0), price = num(it.price, 0), sum = qty * price;
      subtotal += sum;
      const lines = wrapText(winAnsi(it.desc || '-'), F, 9.5, cols[1].w - 16);
      const h = Math.max(24, lines.length * 12.5 + 11);
      if (y - h < st.bottom) { st.newPage(); y = st.y; header(); }
      if (i % 2) st.page.drawRectangle({ x: M, y: y - h, width: tw, height: h, color: zebra });
      cell(cols[0], String(i + 1), y - 15.5, { size: 9.5, color: mute });
      lines.forEach((ln, k) => cell(cols[1], ln, y - 15.5 - k * 12.5, { size: 9.5 }));
      cell(cols[2], String(qty).replace('.', ','), y - 15.5, { size: 9.5 });
      cell(cols[3], rupiah(price), y - 15.5, { size: 9.5 });
      cell(cols[4], rupiah(sum), y - 15.5, { size: 9.5, bold: true });
      y -= h;
      st.page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line });
    });
    // Ringkasan
    const disc = (subtotal * clamp(num(d.discount), 0, 100)) / 100;
    const ship = num(d.shipping);
    const tax = ((subtotal - disc) * clamp(num(d.tax), 0, 100)) / 100;
    const total = subtotal - disc + tax + ship;
    const rows = [['Subtotal', subtotal]];
    if (disc) rows.push([`Diskon (${String(d.discount).replace('.', ',')}%)`, -disc]);
    if (tax) rows.push([`Pajak (${String(d.tax).replace('.', ',')}%)`, tax]);
    if (ship) rows.push(['Ongkos kirim / lainnya', ship]);
    if (y - (rows.length * 18 + 50) < st.bottom) { st.newPage(); y = st.y; }
    y -= 10;
    const bx = W - M - 230;
    for (const [k, v] of rows) {
      y -= 18;
      st.text(k, bx, y, { size: 9.5, color: mute });
      st.text((v < 0 ? '- ' : '') + rupiah(Math.abs(v)), W - M - 8, y, { size: 9.5, align: 'right' });
    }
    y -= 14;
    st.page.drawRectangle({ x: bx - 10, y: y - 26, width: 240, height: 30, color: brand });
    st.text('TOTAL', bx, y - 16, { bold: true, size: 11, color: L.rgb(1, 1, 1) });
    st.text(rupiah(total), W - M - 8, y - 16, { bold: true, size: 12.5, color: L.rgb(1, 1, 1), align: 'right' });
    y -= 50;
    // Catatan & tanda tangan
    const sig = d.sigId ? await signatureImage(doc, d.sigId) : null;
    const notes = String(d.notes || '').trim();
    const noteLines = notes ? wrapText(winAnsi(notes), F, 9.5, tw - 200) : [];
    if (y - Math.max(noteLines.length * 13 + 20, sig || d.signer ? 110 : 0) < st.bottom) { st.newPage(); y = st.y; }
    const topY = y;
    if (noteLines.length) {
      st.text('CATATAN & PEMBAYARAN', M, y, { size: 8, bold: true, color: mute });
      y -= 15;
      for (const ln of noteLines) { st.text(ln, M, y, { size: 9.5 }); y -= 13; }
    }
    if (sig || d.signer) {
      const sx = W - M - 150;
      let yy = topY;
      st.text(`${d.city ? d.city + ', ' : ''}${idDate(d.date)}`, sx + 75, yy, { size: 9.5, align: 'center' });
      yy -= 14;
      st.text('Hormat kami,', sx + 75, yy, { size: 9.5, align: 'center', color: mute });
      yy -= 8;
      if (sig) {
        const s = Math.min(60 / sig.height, 140 / sig.width);
        st.page.drawImage(sig, { x: sx + 75 - (sig.width * s) / 2, y: yy - sig.height * s, width: sig.width * s, height: sig.height * s });
      }
      yy -= 66;
      st.page.drawLine({ start: { x: sx + 10, y: yy }, end: { x: sx + 140, y: yy }, thickness: 0.6, color: line });
      st.text(d.signer || d.seller || '', sx + 75, yy - 13, { size: 10, bold: true, align: 'center' });
    }
    return doc.save();
  }

  const LAMPIRAN = ['Daftar Riwayat Hidup (CV)', 'Fotokopi KTP', 'Fotokopi ijazah terakhir', 'Fotokopi transkrip nilai', 'Pas foto terbaru', 'Fotokopi sertifikat pendukung', 'Surat Keterangan Catatan Kepolisian (SKCK)', 'Surat keterangan sehat'];
  function lamaranBody(d) {
    const lamp = (d.lampiran || []).filter(Boolean);
    const src = String(d.source || '').trim();
    return [
      'Dengan hormat,',
      '',
      `${src ? `Berdasarkan informasi lowongan pekerjaan yang saya peroleh dari ${src}` : 'Melalui surat ini'}, saya bermaksud mengajukan lamaran pekerjaan di ${d.company || '[nama perusahaan]'} sebagai ${d.position || '[posisi]'}. Adapun data diri saya sebagai berikut:`,
      '',
      `Nama\t: ${d.name || ''}`,
      `Tempat, tanggal lahir\t: ${d.birth || ''}`,
      `Pendidikan terakhir\t: ${d.education || ''}`,
      `Alamat\t: ${d.address || ''}`,
      `Nomor HP\t: ${d.phone || ''}`,
      `Email\t: ${d.email || ''}`,
      '',
      'Saya memiliki motivasi tinggi untuk terus belajar, mampu bekerja sama dalam tim maupun secara mandiri, serta terbiasa bekerja dengan target. Saya yakin dapat memberikan kontribusi yang baik bagi perusahaan.',
      ...(lamp.length ? ['', 'Sebagai bahan pertimbangan, bersama surat ini saya lampirkan:', ...lamp.map((x, i) => `${i + 1}. ${x}`)] : []),
      '',
      'Demikian surat lamaran ini saya buat dengan sebenar-benarnya. Besar harapan saya untuk dapat diberikan kesempatan wawancara agar dapat menjelaskan lebih lanjut mengenai diri saya. Atas perhatian Bapak/Ibu, saya ucapkan terima kasih.',
    ].join('\n');
  }
  async function buildLamaran(d, attachments, progress) {
    const L = lib();
    const doc = await newDoc();
    doc.setTitle(`Surat Lamaran Kerja - ${d.name || ''}`.trim());
    doc.setAuthor(d.name || '');
    const F = await doc.embedFont(L.StandardFonts.TimesRoman), FB = await doc.embedFont(L.StandardFonts.TimesRomanBold);
    const st = writer(doc, { font: F, bold: FB, size: 12, color: L.rgb(0, 0, 0), top: 2.5 * 72 / 2.54, bottom: 2.5 * 72 / 2.54, left: 3 * 72 / 2.54, right: 2.5 * 72 / 2.54, lh: 1.45 });
    st.newPage();
    const lamp = (d.lampiran || []).filter(Boolean);
    const right = st.W - st.right;
    st.text(`${d.city ? d.city + ', ' : ''}${idDate(d.date)}`, right, st.y - 12, { align: 'right' });
    st.y -= 30;
    st.para(`Perihal\t: Lamaran Pekerjaan sebagai ${d.position || '-'}${lamp.length ? `\nLampiran\t: ${lamp.length} berkas` : ''}`, { tab: 62 });
    st.y -= 10;
    st.para(['Kepada Yth.', d.recipient || 'Bapak/Ibu HRD', d.company || '', d.companyAddress || ''].filter((x) => String(x).trim()).join('\n'));
    st.y -= 12;
    st.para(d.body || lamaranBody(d), { justify: true, tab: 150 });
    st.y -= 14;
    st.ensure(120);
    const cx = right - 90;
    st.text('Hormat saya,', cx, st.y - 12, { align: 'center' });
    st.y -= 20;
    const sig = d.sigId ? await signatureImage(doc, d.sigId) : null;
    if (sig) {
      const s = Math.min(62 / sig.height, 150 / sig.width);
      st.page.drawImage(sig, { x: cx - (sig.width * s) / 2, y: st.y - sig.height * s - 2, width: sig.width * s, height: sig.height * s });
    }
    st.y -= 72;
    st.text(d.name || '', cx, st.y - 12, { align: 'center', bold: true });
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      progress(`Menambahkan lampiran ${i + 1}/${attachments.length}…`, i / attachments.length);
      if (a.kind === 'pdf') {
        const bytes = await T.unlockPdf(new Uint8Array(await a.file.arrayBuffer()), a.file.name).catch(() => new Uint8Array(0));
        if (!bytes.length) continue;
        const src = await loadDoc(bytes);
        (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p));
      } else await addImagePage(doc, a.file, { size: 'A4', orient: 'auto', margin: 15 });
    }
    return doc.save();
  }

  // ==========================================================
  // DAFTAR ALAT
  // ==========================================================
  const I = {
    organize: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    merge: '<path d="M8 7H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1"/><rect x="9" y="3" width="11" height="14" rx="2"/><path d="M14.5 7.5v5M12 10h5"/>',
    split: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    edit: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h5"/><path d="M14 2v6h6"/><path d="M18.4 12.6a2 2 0 0 1 2.8 2.8L15.5 21 12 22l1-3.5z"/>',
    toPdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15l3 3 3-3"/>',
    fromPdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 14h8M13 11l3 3-3 3"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/><path d="M12 15v2"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    removePages: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/>',
    extractPages: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 17l5-5M11 12h4v4"/>',
    sort: '<path d="M3 6h10M3 12h7M3 18h4"/><path d="M18 4v16M15 17l3 3 3-3"/>',
    images: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    toImages: '<rect x="3" y="7" width="14" height="14" rx="2"/><circle cx="8" cy="12" r="1.5"/><path d="m17 17-3-3-6 7"/><path d="M8 3h11a2 2 0 0 1 2 2v11"/>',
    extractImages: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="10" cy="13" r="1.5"/><path d="m20 18-3-3-7 7"/>',
    ocr: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 9h10M7 12h10M7 15h6"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    watermark: '<path d="M12 2.7 6.3 9.4a7 7 0 1 0 11.4 0z"/>',
    pagenum: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 13v5M8 14l2-1M14 15h-1.5a1.5 1.5 0 0 0 0 3H14"/>',
    overlay: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    compare: '<rect x="3" y="3" width="7" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="18" rx="1.5"/><path d="M6 8h1M6 12h1M17 8h1M17 12h1M17 16h1"/>',
    sign: '<path d="M3 17c3-3 4-9 6-9s1 7 3 7 2-4 4-4 2 3 5 3"/><path d="M3 21h18"/>',
    annotate: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
    redact: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10" stroke-width="3"/><path d="M7 14h6" stroke-width="3"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    flatten: '<path d="m12 3 9 5-9 5-9-5z"/><path d="M3 17h18M3 21h18"/>',
    invoice: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
    removeMeta: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="m8 8 5 5M13 8l-5 5"/>',
    editMeta: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    viewer: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8M12 18v4M6 8h5M6 11h3"/>',
    nup: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>',
    resize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    repair: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    form: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h4"/><rect x="7" y="15" width="3" height="3" rx=".5"/><path d="M13 16.5h4"/>',
    job: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
  };
  const CATS = [['atur', 'Atur & Gabung'], ['konversi', 'Konversi'], ['edit', 'Edit & Tanda Tangan'], ['aman', 'Optimasi & Keamanan'], ['info', 'Properti Dokumen'], ['buat', 'Buat Dokumen']];
  const PAGES_OPT = (label = 'Halaman yang diproses') => ({ id: 'pages', type: 'text', label, placeholder: 'Kosongkan untuk semua, mis. 1-3, 5', value: '' });

  const TOOLS = [
    { id: 'atur-pdf', cat: 'atur', icon: 'organize', name: 'Atur PDF', desc: 'Urutkan, putar, hapus halaman & gabungkan beberapa PDF sekaligus.', accept: ['pdf'], multiple: true, view: 'pages', mode: 'organize', run: OPS.organize, runLabel: 'Simpan PDF' },
    { id: 'gabung-pdf', cat: 'atur', icon: 'merge', name: 'Gabung PDF', desc: 'Satukan beberapa PDF (dan gambar) menjadi satu file.', accept: ['pdf', 'img'], multiple: true, min: 2, view: 'files', run: OPS.merge, runLabel: 'Gabungkan PDF',
      options: [{ id: 'bookmarks', type: 'check', label: 'Buat bookmark untuk setiap file', value: false }] },
    { id: 'pisah-pdf', cat: 'atur', icon: 'split', name: 'Pisah PDF', desc: 'Pecah PDF per halaman, per beberapa halaman, atau rentang tertentu.', accept: ['pdf'], view: 'pages', mode: 'view', run: OPS.split, runLabel: 'Pisahkan PDF',
      options: [
        { id: 'mode', type: 'seg', label: 'Cara memisah', choices: [['each', 'Per halaman'], ['every', 'Per N halaman'], ['ranges', 'Rentang']], value: 'each' },
        { id: 'every', type: 'number', label: 'Jumlah halaman per file', min: 1, value: 2, show: (o) => o.mode === 'every' },
        { id: 'ranges', type: 'text', label: 'Rentang halaman', placeholder: 'mis. 1-3, 4-6, 7', help: 'Setiap rentang menjadi satu file PDF.', value: '', show: (o) => o.mode === 'ranges' },
      ] },
    { id: 'putar-pdf', cat: 'atur', icon: 'rotate', name: 'Putar Halaman', desc: 'Putar halaman PDF yang miring atau terbalik.', accept: ['pdf'], view: 'pages', mode: 'rotate', run: OPS.rotate, runLabel: 'Simpan PDF' },
    { id: 'hapus-halaman', cat: 'atur', icon: 'removePages', name: 'Hapus Halaman', desc: 'Buang halaman yang tidak diperlukan dari PDF.', accept: ['pdf'], view: 'pages', mode: 'remove', run: OPS.remove, runLabel: 'Hapus Halaman' },
    { id: 'ambil-halaman', cat: 'atur', icon: 'extractPages', name: 'Ambil Halaman', desc: 'Ambil halaman tertentu menjadi PDF baru.', accept: ['pdf'], view: 'pages', mode: 'extract', run: OPS.extract, runLabel: 'Ambil Halaman',
      options: [{ id: 'out', type: 'seg', label: 'Hasil', choices: [['one', 'Satu PDF'], ['each', 'PDF per halaman']], value: 'one' }] },
    { id: 'urutkan-halaman', cat: 'atur', icon: 'sort', name: 'Urutkan Halaman', desc: 'Ubah urutan halaman, balik urutan, atau rapikan hasil scan bolak-balik.', accept: ['pdf'], view: 'pages', mode: 'sort', run: OPS.sort, runLabel: 'Simpan PDF' },
    { id: 'halaman-per-lembar', cat: 'atur', icon: 'nup', name: 'Halaman per Lembar', desc: 'Cetak 2, 4, 6, 9, atau 16 halaman dalam satu lembar kertas.', accept: ['pdf'], view: 'single', run: OPS.nup, runLabel: 'Buat PDF',
      options: [
        { id: 'per', type: 'seg', label: 'Halaman per lembar', choices: [['2', '2'], ['4', '4'], ['6', '6'], ['8', '8'], ['9', '9'], ['16', '16']], value: '2' },
        { id: 'paper', type: 'select', label: 'Ukuran kertas', choices: PAPER_CHOICES, value: 'A4' },
        { id: 'orient', type: 'seg', label: 'Orientasi', choices: [['auto', 'Otomatis'], ['portrait', 'Tegak'], ['landscape', 'Mendatar']], value: 'auto' },
        { id: 'order', type: 'seg', label: 'Urutan', choices: [['row', 'Mendatar'], ['col', 'Menurun']], value: 'row' },
        { type: 'row', items: [{ id: 'margin', type: 'number', label: 'Margin (mm)', min: 0, value: 5 }, { id: 'gap', type: 'number', label: 'Jarak (mm)', min: 0, value: 3 }] },
        { id: 'border', type: 'check', label: 'Beri garis tepi tiap halaman', value: false },
      ] },
    { id: 'ubah-ukuran-halaman', cat: 'atur', icon: 'resize', name: 'Ubah Ukuran Halaman', desc: 'Ubah ukuran kertas PDF ke A4, F4, Letter, dan lainnya.', accept: ['pdf'], view: 'single', run: OPS.resize, runLabel: 'Ubah Ukuran',
      options: [
        { id: 'paper', type: 'select', label: 'Ukuran baru', choices: [...PAPER_CHOICES, ['custom', 'Ukuran khusus…']], value: 'A4' },
        { type: 'row', show: (o) => o.paper === 'custom', items: [{ id: 'cw', type: 'number', label: 'Lebar (mm)', min: 20, value: 210 }, { id: 'ch', type: 'number', label: 'Tinggi (mm)', min: 20, value: 297 }] },
        { id: 'orient', type: 'seg', label: 'Orientasi', choices: [['same', 'Ikuti halaman'], ['portrait', 'Tegak'], ['landscape', 'Mendatar']], value: 'same' },
        { id: 'mode', type: 'seg', label: 'Isi halaman', choices: [['fit', 'Skala agar pas'], ['center', 'Tanpa skala']], value: 'fit' },
        { id: 'margin', type: 'number', label: 'Margin (mm)', min: 0, value: 0 },
      ] },
    { id: 'potong-pdf', cat: 'atur', icon: 'crop', name: 'Potong (Crop) PDF', desc: 'Pangkas tepi halaman secara manual atau otomatis.', accept: ['pdf'], view: 'single', preview: 'crop', run: OPS.crop, runLabel: 'Potong PDF',
      options: [
        { id: 'mode', type: 'seg', label: 'Cara memotong', choices: [['manual', 'Manual'], ['auto', 'Otomatis (buang tepi putih)']], value: 'manual' },
        { type: 'row', show: (o) => o.mode === 'manual', items: [{ id: 't', type: 'number', label: 'Atas (mm)', min: 0, value: 10 }, { id: 'b', type: 'number', label: 'Bawah (mm)', min: 0, value: 10 }] },
        { type: 'row', show: (o) => o.mode === 'manual', items: [{ id: 'l', type: 'number', label: 'Kiri (mm)', min: 0, value: 10 }, { id: 'r', type: 'number', label: 'Kanan (mm)', min: 0, value: 10 }] },
        { id: 'pad', type: 'number', label: 'Sisakan tepi (mm)', min: 0, value: 3, show: (o) => o.mode === 'auto' },
        PAGES_OPT(),
      ] },

    { id: 'konversi-ke-pdf', cat: 'konversi', icon: 'toPdf', name: 'Konversi ke PDF', desc: 'Ubah Word (DOCX), gambar, dan teks menjadi PDF.', accept: ['docx', 'img', 'txt'], multiple: true, view: 'files', run: OPS.toPdf, runLabel: 'Konversi ke PDF',
      options: [{ id: 'merge', type: 'check', label: 'Gabungkan semua menjadi satu PDF', value: true, show: (o, c) => c.files.length > 1 }] },
    { id: 'gambar-ke-pdf', cat: 'konversi', icon: 'images', name: 'Gambar ke PDF', desc: 'Ubah foto JPG, PNG, atau WEBP menjadi PDF rapi.', accept: ['img'], multiple: true, view: 'files', run: OPS.img2pdf, runLabel: 'Buat PDF',
      options: [
        { id: 'size', type: 'select', label: 'Ukuran halaman', choices: [['A4', 'A4'], ['F4', 'F4 / Folio'], ['Letter', 'Letter'], ['A5', 'A5'], ['fit', 'Sesuai gambar']], value: 'A4' },
        { id: 'orient', type: 'seg', label: 'Orientasi', choices: [['auto', 'Otomatis'], ['portrait', 'Tegak'], ['landscape', 'Mendatar']], value: 'auto', show: (o) => o.size !== 'fit' },
        { id: 'margin', type: 'seg', label: 'Margin', choices: [['0', 'Tanpa'], ['10', 'Kecil'], ['20', 'Besar']], value: '10', show: (o) => o.size !== 'fit' },
        { id: 'merge', type: 'check', label: 'Gabungkan menjadi satu PDF', value: true, show: (o, c) => c.files.length > 1 },
      ] },
    { id: 'konversi-dari-pdf', cat: 'konversi', icon: 'fromPdf', name: 'PDF ke Word / Teks', desc: 'Ubah PDF menjadi Word (DOCX), teks, atau gambar.', accept: ['pdf'], view: 'single', run: OPS.fromPdf, runLabel: 'Konversi',
      options: [
        { id: 'target', type: 'seg', label: 'Ubah menjadi', choices: [['docx', 'Word'], ['txt', 'Teks'], ['jpg', 'JPG'], ['png', 'PNG']], value: 'docx' },
        { id: 'docx', type: 'seg', label: 'Mode Word', choices: [['text', 'Teks bisa diedit'], ['layout', 'Tata letak persis']], value: 'text', show: (o) => o.target === 'docx',
          help: (o) => (o.docx === 'layout' ? 'Setiap halaman menjadi gambar di Word: tampilan sama persis, tetapi teks tidak bisa diedit.' : 'Teks & paragraf bisa diedit. Tata letak rumit (tabel, kolom) bisa bergeser.') },
        { id: 'dpi', type: 'seg', label: 'Kualitas gambar', choices: [['72', 'Rendah'], ['150', 'Sedang'], ['300', 'Tinggi']], value: '150', show: (o) => o.target === 'jpg' || o.target === 'png' },
        PAGES_OPT(),
      ] },
    { id: 'pdf-ke-gambar', cat: 'konversi', icon: 'toImages', name: 'PDF ke Gambar', desc: 'Simpan setiap halaman PDF sebagai JPG atau PNG.', accept: ['pdf'], view: 'single', run: OPS.toImages, runLabel: 'Buat Gambar',
      options: [
        { id: 'format', type: 'seg', label: 'Format', choices: [['jpg', 'JPG'], ['png', 'PNG']], value: 'jpg' },
        { id: 'dpi', type: 'seg', label: 'Kualitas', choices: [['72', 'Rendah (72 dpi)'], ['150', 'Sedang (150 dpi)'], ['300', 'Tinggi (300 dpi)']], value: '150' },
        PAGES_OPT(),
      ] },
    { id: 'ekstrak-gambar', cat: 'konversi', icon: 'extractImages', name: 'Ekstrak Gambar', desc: 'Ambil semua foto & gambar yang ada di dalam PDF.', accept: ['pdf'], view: 'single', run: OPS.extractImages, runLabel: 'Ekstrak Gambar',
      options: [
        { id: 'format', type: 'seg', label: 'Format', choices: [['png', 'PNG'], ['jpg', 'JPG']], value: 'png' },
        { id: 'min', type: 'number', label: 'Abaikan gambar lebih kecil dari (piksel)', min: 0, value: 40 },
      ] },
    { id: 'ocr-pdf', cat: 'konversi', icon: 'ocr', name: 'OCR PDF', desc: 'Kenali teks pada hasil scan agar bisa dicari & disalin.', accept: ['pdf', 'img'], multiple: true, view: 'files', run: OPS.ocr, runLabel: 'Jalankan OCR',
      validate: (c) => (c.files.length > 1 && c.files.some((f) => f.kind === 'pdf') ? 'Untuk OCR, pilih satu PDF atau beberapa gambar (tidak dicampur).' : ''),
      options: [
        { id: 'lang', type: 'select', label: 'Bahasa dokumen', choices: [['ind+eng', 'Indonesia + Inggris'], ['ind', 'Indonesia'], ['eng', 'Inggris']], value: 'ind+eng' },
        { id: 'out', type: 'seg', label: 'Hasil', choices: [['pdf', 'PDF bisa dicari'], ['txt', 'Teks (.txt)'], ['both', 'Keduanya']], value: 'pdf' },
        PAGES_OPT(),
        { type: 'note', html: 'Pertama kali dipakai, data bahasa (±4 MB) dimuat lalu disimpan untuk penggunaan offline berikutnya. Dokumen tetap tidak diunggah.' },
      ] },

    { id: 'tanda-tangan-pdf', cat: 'edit', icon: 'sign', name: 'Tanda Tangan PDF', desc: 'Bubuhkan tanda tangan, paraf, atau TTD QR Code.', view: 'editor', mode: 'sign' },
    { id: 'edit-pdf', cat: 'edit', icon: 'edit', name: 'Edit PDF', desc: 'Tambah teks & gambar, tutup tulisan lama dengan kotak putih.', view: 'editor', mode: 'edit' },
    { id: 'anotasi-pdf', cat: 'edit', icon: 'annotate', name: 'Anotasi PDF', desc: 'Coret dengan pena, stabilo, kotak, dan catatan.', view: 'editor', mode: 'annotate' },
    { id: 'sensor-pdf', cat: 'edit', icon: 'redact', name: 'Sensor (Hitamkan) PDF', desc: 'Tutup data rahasia dengan kotak hitam secara permanen.', view: 'editor', mode: 'redact' },
    { id: 'buat-formulir-pdf', cat: 'edit', icon: 'form', name: 'Buat Formulir PDF', desc: 'Tambahkan kolom isian & kotak centang agar PDF bisa diisi.', view: 'editor', mode: 'form' },
    { id: 'watermark-pdf', cat: 'edit', icon: 'watermark', name: 'Tambah Watermark', desc: 'Beri tanda air teks atau logo di setiap halaman.', accept: ['pdf'], multiple: true, view: 'files', run: OPS.watermark, runLabel: 'Tambah Watermark',
      options: [
        { id: 'type', type: 'seg', label: 'Jenis', choices: [['text', 'Teks'], ['image', 'Gambar / logo']], value: 'text' },
        { id: 'text', type: 'text', label: 'Teks watermark', value: 'RAHASIA', show: (o) => o.type === 'text' },
        { id: 'wmImage', type: 'file', label: 'Gambar watermark', accept: 'image/*', show: (o) => o.type === 'image' },
        { type: 'row', items: [
          { id: 'size', type: 'number', label: 'Ukuran huruf', min: 6, value: 60, show: (o) => o.type === 'text' },
          { id: 'scale', type: 'number', label: 'Lebar (% halaman)', min: 5, max: 100, value: 40, show: (o) => o.type === 'image' },
          { id: 'color', type: 'color', label: 'Warna', value: '#dc2626', show: (o) => o.type === 'text' },
        ] },
        { id: 'opacity', type: 'range', label: 'Transparansi', min: 5, max: 100, value: 25, suffix: '%' },
        { id: 'angle', type: 'seg', label: 'Kemiringan', choices: [['45', '45°'], ['0', 'Datar'], ['-45', '-45°'], ['90', '90°']], value: '45' },
        { id: 'pos', type: 'seg', label: 'Posisi', choices: [['center', 'Tengah'], ['tile', 'Berulang'], ['top', 'Atas'], ['bottom', 'Bawah']], value: 'center' },
        { id: 'layer', type: 'seg', label: 'Lapisan', choices: [['front', 'Di atas isi'], ['back', 'Di belakang isi']], value: 'front' },
        PAGES_OPT(),
      ] },
    { id: 'nomor-halaman', cat: 'edit', icon: 'pagenum', name: 'Nomor Halaman', desc: 'Tambahkan nomor halaman dengan posisi & format pilihan.', accept: ['pdf'], view: 'single', run: OPS.pagenum, runLabel: 'Tambah Nomor',
      options: [
        { id: 'pos', type: 'select', label: 'Posisi', choices: [['bottom-center', 'Bawah tengah'], ['bottom-right', 'Bawah kanan'], ['bottom-left', 'Bawah kiri'], ['top-center', 'Atas tengah'], ['top-right', 'Atas kanan'], ['top-left', 'Atas kiri']], value: 'bottom-center' },
        { id: 'format', type: 'select', label: 'Format', choices: [['{n}', '1, 2, 3'], ['Halaman {n}', 'Halaman 1'], ['{n} / {total}', '1 / 10'], ['Halaman {n} dari {total}', 'Halaman 1 dari 10'], ['- {n} -', '- 1 -'], ['custom', 'Format sendiri…']], value: '{n}' },
        { id: 'custom', type: 'text', label: 'Format sendiri', placeholder: 'Pakai {n} dan {total}', value: 'Hal. {n}', show: (o) => o.format === 'custom' },
        { type: 'row', items: [{ id: 'start', type: 'number', label: 'Nomor awal', value: 1 }, { id: 'from', type: 'number', label: 'Mulai di halaman ke-', min: 1, value: 1 }] },
        { type: 'row', items: [{ id: 'size', type: 'number', label: 'Ukuran huruf', min: 5, value: 11 }, { id: 'margin', type: 'number', label: 'Jarak tepi (mm)', min: 0, value: 12 }] },
        { type: 'row', items: [{ id: 'font', type: 'select', label: 'Huruf', choices: [['Helvetica', 'Sans (Helvetica)'], ['TimesRoman', 'Serif (Times)'], ['Courier', 'Mono (Courier)']], value: 'Helvetica' }, { id: 'color', type: 'color', label: 'Warna', value: '#111827' }] },
        { id: 'mirror', type: 'check', label: 'Kiri-kanan bergantian (untuk cetak bolak-balik)', value: false, show: (o) => !/center/.test(o.pos) },
      ] },
    { id: 'overlay-pdf', cat: 'edit', icon: 'overlay', name: 'Overlay / Kop Surat', desc: 'Tumpuk PDF lain (kop surat, stempel, template) ke dokumen.', accept: ['pdf'], multiple: true, min: 2, max: 2, view: 'files', labels: ['Dokumen utama', 'Lapisan (kop / stempel)'], run: OPS.overlay, runLabel: 'Gabungkan Lapisan',
      options: [
        { id: 'layer', type: 'seg', label: 'Letak lapisan', choices: [['back', 'Di belakang (kop surat)'], ['front', 'Di depan (stempel)']], value: 'back' },
        { id: 'which', type: 'seg', label: 'Halaman lapisan', choices: [['first', 'Halaman 1 untuk semua'], ['match', 'Halaman ke-n ke ke-n']], value: 'first' },
        { id: 'apply', type: 'seg', label: 'Diterapkan ke', choices: [['all', 'Semua'], ['first', 'Halaman 1'], ['custom', 'Pilih…']], value: 'all' },
        { ...PAGES_OPT('Halaman dokumen'), show: (o) => o.apply === 'custom' },
        { id: 'fit', type: 'seg', label: 'Ukuran lapisan', choices: [['fit', 'Sesuaikan'], ['stretch', 'Regangkan'], ['original', 'Asli']], value: 'fit' },
        { id: 'opacity', type: 'range', label: 'Ketebalan lapisan', min: 5, max: 100, value: 100, suffix: '%' },
      ] },
    { id: 'ratakan-pdf', cat: 'edit', icon: 'flatten', name: 'Ratakan (Flatten) PDF', desc: 'Kunci isian formulir & anotasi agar tidak bisa diubah.', accept: ['pdf'], view: 'single', run: OPS.flatten, runLabel: 'Ratakan PDF',
      options: [
        { id: 'mode', type: 'seg', label: 'Mode', choices: [['form', 'Formulir saja'], ['raster', 'Seluruh halaman']], value: 'form',
          help: (o) => (o.mode === 'form' ? 'Isian formulir menjadi teks biasa. Teks lain tetap bisa dipilih.' : 'Semua halaman (termasuk komentar & formulir) dijadikan gambar.') },
        { id: 'dpi', type: 'seg', label: 'Kualitas', choices: [['110', 'Sedang'], ['150', 'Tinggi'], ['220', 'Sangat tinggi']], value: '150', show: (o) => o.mode === 'raster' },
      ] },

    { id: 'kompres-pdf', cat: 'aman', icon: 'compress', name: 'Kompres PDF', desc: 'Perkecil ukuran PDF agar mudah dikirim lewat WhatsApp & email.', accept: ['pdf'], view: 'single', run: OPS.compress, runLabel: 'Kompres PDF',
      options: [
        { id: 'level', type: 'seg', label: 'Tingkat kompresi', choices: [['low', 'Ringan'], ['mid', 'Sedang'], ['high', 'Kuat']], value: 'mid',
          help: (o) => ({ low: 'Kualitas gambar hampir sama, ukuran sedikit berkurang.', mid: 'Seimbang antara ukuran dan kualitas (disarankan).', high: 'Ukuran paling kecil, gambar terlihat lebih buram.' }[o.level]) },
        { id: 'strip', type: 'check', label: 'Hapus metadata (judul, penulis, dll.)', value: false },
        { id: 'raster', type: 'check', label: 'Ubah semua halaman jadi gambar (paling kecil, teks tidak bisa dipilih)', value: false },
      ] },
    { id: 'optimasi-web', cat: 'aman', icon: 'web', name: 'Optimasi untuk Web', desc: 'Siapkan PDF ringan untuk diunggah ke situs, LMS, atau dibagikan online.', accept: ['pdf'], view: 'single', run: OPS.optimize, runLabel: 'Optimasi PDF',
      options: [{ id: 'strip', type: 'check', label: 'Hapus metadata', value: false }] },
    { id: 'kunci-pdf', cat: 'aman', icon: 'lock', name: 'Kunci PDF', desc: 'Lindungi PDF dengan kata sandi (enkripsi AES-256).', accept: ['pdf'], view: 'single', run: OPS.protect, runLabel: 'Kunci PDF',
      options: [
        { id: 'pw', type: 'password', label: 'Kata sandi untuk membuka', value: '' },
        { id: 'pw2', type: 'password', label: 'Ulangi kata sandi', value: '' },
        { id: 'owner', type: 'password', label: 'Kata sandi pemilik (opsional)', help: 'Dipakai untuk mengubah izin. Jika kosong, dibuat acak.', value: '' },
        { type: 'note', html: '<b>Izin untuk pembaca:</b>' },
        { id: 'print', type: 'check', label: 'Boleh mencetak', value: true },
        { id: 'copy', type: 'check', label: 'Boleh menyalin teks', value: true },
        { id: 'annotate', type: 'check', label: 'Boleh memberi komentar & mengisi formulir', value: true },
        { id: 'modify', type: 'check', label: 'Boleh mengubah isi dokumen', value: false },
      ] },
    { id: 'buka-kunci-pdf', cat: 'aman', icon: 'unlock', name: 'Buka Kunci PDF', desc: 'Hapus kata sandi & batasan cetak/salin dari PDF milik Anda.', accept: ['pdf'], view: 'single', rawInput: true, run: OPS.unlock, runLabel: 'Buka Kunci',
      options: [
        { id: 'pw', type: 'password', label: 'Kata sandi PDF', help: 'Kosongkan jika PDF bisa dibuka tanpa kata sandi tetapi tidak bisa dicetak/disalin.', value: '' },
        { type: 'note', html: 'Gunakan hanya untuk dokumen milik Anda sendiri atau yang Anda berhak buka.' },
      ] },
    { id: 'perbaiki-pdf', cat: 'aman', icon: 'repair', name: 'Perbaiki PDF', desc: 'Coba pulihkan PDF yang rusak atau gagal dibuka.', accept: ['pdf'], view: 'single', rawInput: true, run: OPS.repair, runLabel: 'Perbaiki PDF' },
    { id: 'bandingkan-pdf', cat: 'aman', icon: 'compare', name: 'Bandingkan PDF', desc: 'Temukan perbedaan teks & tampilan antara dua PDF.', accept: ['pdf'], multiple: true, min: 2, max: 2, view: 'files', labels: ['Dokumen A (lama)', 'Dokumen B (baru)'], run: OPS.compare, runLabel: 'Bandingkan',
      options: [{ id: 'mode', type: 'seg', label: 'Bandingkan', choices: [['both', 'Teks & visual'], ['text', 'Teks'], ['visual', 'Visual']], value: 'both' }] },

    { id: 'edit-metadata', cat: 'info', icon: 'editMeta', name: 'Edit Metadata', desc: 'Ubah judul, penulis, subjek, dan kata kunci PDF.', accept: ['pdf'], view: 'single', run: OPS.editMeta, runLabel: 'Simpan Metadata',
      options: META_FIELDS.map(([id, label]) => ({ id, type: 'text', label, value: '' })),
      prepare: async (c) => {
        const doc = await loadDoc(c.files[0].bytes);
        const get = { title: doc.getTitle(), author: doc.getAuthor(), subject: doc.getSubject(), keywords: doc.getKeywords(), creator: doc.getCreator(), producer: doc.getProducer() };
        for (const [id] of META_FIELDS) c.opt[id] = get[id] || '';
      } },
    { id: 'hapus-metadata', cat: 'info', icon: 'removeMeta', name: 'Hapus Metadata', desc: 'Bersihkan info tersembunyi (penulis, aplikasi, tanggal) dari PDF.', accept: ['pdf'], view: 'single', run: OPS.removeMeta, runLabel: 'Hapus Metadata',
      options: (c) => [{ type: 'note', html: c.extra.metaHtml || 'Metadata yang akan dihapus akan tampil setelah file dipilih.' }],
      prepare: async (c) => {
        const doc = await loadDoc(c.files[0].bytes);
        const rows = [['Judul', doc.getTitle()], ['Penulis', doc.getAuthor()], ['Subjek', doc.getSubject()], ['Kata kunci', doc.getKeywords()], ['Pembuat', doc.getCreator()], ['Produser', doc.getProducer()],
          ['Dibuat', doc.getCreationDate() && doc.getCreationDate().toLocaleString('id-ID')], ['Diubah', doc.getModificationDate() && doc.getModificationDate().toLocaleString('id-ID')]].filter(([, v]) => v);
        const xmp = !!doc.catalog.get(lib().PDFName.of('Metadata'));
        c.extra.metaHtml = rows.length || xmp
          ? `<b>Metadata yang ditemukan:</b><dl class="meta-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}${xmp ? '<dt>XMP</dt><dd>Ada (metadata tersembunyi)</dd>' : ''}</dl>`
          : 'PDF ini tidak memiliki metadata yang terlihat. Struktur tetap akan dibersihkan.';
      } },
    { id: 'preferensi-tampilan', cat: 'info', icon: 'viewer', name: 'Preferensi Tampilan', desc: 'Atur cara PDF terbuka: tata letak, panel, layar penuh.', accept: ['pdf'], view: 'single', run: OPS.viewer, runLabel: 'Simpan Pengaturan',
      options: [
        { id: 'layout', type: 'select', label: 'Tata letak halaman', choices: [['', 'Bawaan aplikasi'], ['SinglePage', 'Satu halaman'], ['OneColumn', 'Bergulir (satu kolom)'], ['TwoColumnLeft', 'Dua kolom (ganjil di kiri)'], ['TwoColumnRight', 'Dua kolom (ganjil di kanan)'], ['TwoPageLeft', 'Dua halaman (ganjil di kiri)'], ['TwoPageRight', 'Dua halaman (ganjil di kanan)']], value: '' },
        { id: 'mode', type: 'select', label: 'Saat dibuka tampilkan', choices: [['', 'Bawaan aplikasi'], ['UseNone', 'Dokumen saja'], ['UseOutlines', 'Panel bookmark'], ['UseThumbs', 'Panel thumbnail'], ['FullScreen', 'Layar penuh'], ['UseAttachments', 'Panel lampiran']], value: '' },
        ...VIEW_FLAGS.map(([k, label]) => ({ id: 'vf' + k, type: 'check', label, value: false })),
        { id: 'direction', type: 'seg', label: 'Arah baca', choices: [['L2R', 'Kiri ke kanan'], ['R2L', 'Kanan ke kiri']], value: 'L2R' },
        { id: 'printScaling', type: 'seg', label: 'Skala cetak', choices: [['AppDefault', 'Bawaan'], ['None', 'Ukuran asli (tanpa skala)']], value: 'AppDefault' },
        { id: 'duplex', type: 'select', label: 'Cetak bolak-balik', choices: [['', 'Bawaan printer'], ['Simplex', 'Satu sisi'], ['DuplexFlipLongEdge', 'Bolak-balik (sisi panjang)'], ['DuplexFlipShortEdge', 'Bolak-balik (sisi pendek)']], value: '' },
      ],
      prepare: async (c) => {
        const { PDFName, PDFDict } = lib();
        const doc = await loadDoc(c.files[0].bytes);
        const cat = doc.catalog;
        const nm = (v) => (v ? String(v).replace(/^\//, '') : '');
        c.opt.layout = nm(cat.get(PDFName.of('PageLayout')));
        c.opt.mode = nm(cat.get(PDFName.of('PageMode')));
        const vp = cat.lookup(PDFName.of('ViewerPreferences'));
        if (vp instanceof PDFDict) {
          for (const [k] of VIEW_FLAGS) c.opt['vf' + k] = String(vp.get(PDFName.of(k))) === 'true';
          c.opt.direction = nm(vp.get(PDFName.of('Direction'))) === 'R2L' ? 'R2L' : 'L2R';
          c.opt.printScaling = nm(vp.get(PDFName.of('PrintScaling'))) === 'None' ? 'None' : 'AppDefault';
          c.opt.duplex = nm(vp.get(PDFName.of('Duplex')));
        }
      } },
    { id: 'edit-bookmark', cat: 'info', icon: 'bookmark', name: 'Edit Bookmark', desc: 'Tambah, ubah, atau hapus daftar isi (bookmark) PDF.', accept: ['pdf'], view: 'single', custom: 'bookmarks', run: OPS.bookmarks, runLabel: 'Simpan Bookmark',
      options: [{ id: 'open', type: 'check', label: 'Tampilkan panel bookmark saat PDF dibuka', value: true }],
      prepare: async (c) => { c.extra.bm = await readOutline(c.files[0].pdf); } },

    { id: 'buat-invoice', cat: 'buat', icon: 'invoice', name: 'Buat Invoice', desc: 'Buat invoice/tagihan profesional dalam Rupiah, langsung jadi PDF.', input: 'none', custom: 'invoice', runLabel: 'Buat Invoice PDF',
      run: async (c) => {
        const d = c.extra.inv;
        if (!d.items.some((it) => String(it.desc).trim() && num(it.qty) > 0)) throw userErr('Isi minimal satu item (deskripsi & jumlah).');
        saveForm('ttdin.invoice.v1', { seller: d.seller, sellerInfo: d.sellerInfo, city: d.city, signer: d.signer, notes: d.notes, color: d.color, logo: d.logo && d.logo.length < 400000 ? d.logo : '' });
        return [{ name: `Invoice-${(d.no || 'baru').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`, blob: pdfBlob(await buildInvoice(d)) }];
      } },
    { id: 'surat-lamaran-kerja', cat: 'buat', icon: 'job', name: 'Surat Lamaran Kerja', desc: 'Buat surat lamaran rapi + gabungkan CV, ijazah & lampiran jadi satu PDF.', input: 'none', custom: 'lamaran', runLabel: 'Buat PDF Lamaran',
      run: async (c) => {
        const d = c.extra.lam;
        if (!String(d.name).trim() || !String(d.position).trim() || !String(d.company).trim()) throw userErr('Isi minimal nama, posisi yang dilamar, dan nama perusahaan.');
        saveForm('ttdin.lamaran.v1', { name: d.name, birth: d.birth, education: d.education, address: d.address, phone: d.phone, email: d.email, city: d.city });
        const bytes = await buildLamaran(d, c.extra.lamFiles || [], c.progress);
        return [{ name: `Surat Lamaran - ${baseOf(d.name)} - ${baseOf(d.position)}.pdf`, blob: pdfBlob(bytes) }];
      } },
  ];
  TOOLS.forEach((t) => { t.accept = t.accept || []; t.input = t.input || (t.view === 'editor' ? 'editor' : 'file'); });

  function loadForm(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (_) { return {}; } }
  function saveForm(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* abaikan */ } }

  // ==========================================================
  // ANTARMUKA
  // ==========================================================
  const icon = (name, w = 1.8) => svg(I[name] || I.toPdf, w);
  const view = $('#toolView');
  const scroller = $('#tvScroll');
  const input = $('#toolInput');
  const ORIGINAL_TITLE = document.title;
  let cur = null;

  // ---------- Grid alat di landing page ----------
  function cardHtml(t, small) {
    return `<a class="tcard${small ? ' tcard-sm' : ''}" href="#alat/${t.id}" data-tool="${t.id}">
      <span class="tcard-icon cat-${t.cat}">${icon(t.icon)}</span>
      <span class="tcard-text"><b>${esc(t.name)}</b>${small ? '' : `<small>${esc(t.desc)}</small>`}</span></a>`;
  }
  let gridCat = 'semua', gridQuery = '';
  function renderGrid() {
    const host = $('#toolGrid');
    if (!host) return;
    const q = gridQuery.trim().toLowerCase();
    const match = (t) => (gridCat === 'semua' || t.cat === gridCat) && (!q || (t.name + ' ' + t.desc).toLowerCase().includes(q));
    let html = '';
    for (const [cat, label] of CATS) {
      const list = TOOLS.filter((t) => t.cat === cat && match(t));
      if (!list.length) continue;
      html += `<div class="tgroup"><h3 class="tgroup-title">${label}</h3><div class="tcards">${list.map((t) => cardHtml(t)).join('')}</div></div>`;
    }
    host.innerHTML = html || `<p class="tgrid-empty">Tidak ada alat yang cocok dengan "${esc(gridQuery)}".</p>`;
  }
  function initGrid() {
    const chips = $('#toolCats');
    if (chips) {
      chips.innerHTML = [['semua', 'Semua'], ...CATS].map(([k, l]) => `<button class="tchip${k === 'semua' ? ' active' : ''}" data-cat="${k}">${l}</button>`).join('');
      chips.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        gridCat = b.dataset.cat;
        $$('.tchip', chips).forEach((x) => x.classList.toggle('active', x === b));
        renderGrid();
      });
    }
    const search = $('#toolSearch');
    if (search) search.addEventListener('input', () => { gridQuery = search.value; renderGrid(); });
    const count = $('#toolCount');
    if (count) count.textContent = TOOLS.length;
    renderGrid();
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-tool]');
    if (!a) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    openTool(a.dataset.tool);
  });

  // ---------- Buka / tutup alat ----------
  function defaultsOf(tool) {
    const o = {};
    const walk = (list) => (list || []).forEach((x) => { if (x.type === 'row') walk(x.items); else if (x.id && x.type !== 'file') o[x.id] = x.value; });
    walk(typeof tool.options === 'function' ? [] : tool.options);
    return o;
  }
  function openTool(id, push = true) {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) return;
    if (tool.view === 'editor') { T.pickForEditor(tool.mode); return; }
    if (cur && cur.tool.id === id && document.body.classList.contains('tooling')) return;
    disposeCur();
    cur = { tool, files: [], pages: [], opt: defaultsOf(tool), extra: {}, state: 'drop', thumbs: new Map(), busy: false };
    if (tool.input === 'none') { cur.state = 'work'; initCustomState(); }
    document.body.classList.add('tooling');
    if (push) history.pushState({ ttdin: 'tool', id }, '', '#alat/' + id);
    document.title = `${tool.name} — TTD.in`;
    render();
    scroller.scrollTop = 0;
  }
  function disposeCur() {
    if (!cur) return;
    cur.files.forEach((f) => { if (f.pdf) f.pdf.destroy(); if (f.url) URL.revokeObjectURL(f.url); });
    if (cur.io) cur.io.disconnect();
    cur = null;
  }
  function closeTool() {
    disposeCur();
    document.body.classList.remove('tooling');
    document.title = ORIGINAL_TITLE;
  }
  function leaveTool() {
    if (cur && cur.busy && !confirm('Proses sedang berjalan. Tetap keluar?')) return;
    if (history.state && history.state.ttdin === 'tool') history.back();
    else { closeTool(); history.replaceState(null, '', location.pathname + location.search + '#alat'); }
    setTimeout(() => { const s = $('#alat'); if (s) s.scrollIntoView({ block: 'start' }); }, 30);
  }
  window.addEventListener('popstate', () => {
    const m = location.hash.match(/^#alat\/([\w-]+)/);
    if (m && !document.body.classList.contains('editing')) openTool(m[1], false);
    else if (!m && document.body.classList.contains('tooling')) closeTool();
  });
  $('#tvBack').addEventListener('click', leaveTool);
  $('#tvHome').addEventListener('click', (e) => { e.preventDefault(); leaveTool(); });

  // ---------- Status sibuk ----------
  let busyShown = false;
  function showBusy(text, frac) {
    $('#tvBusyText').textContent = text || 'Memproses…';
    const bar = $('#tvBusyBar');
    if (typeof frac === 'number' && Number.isFinite(frac)) { bar.parentElement.classList.remove('indet'); bar.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%'; }
    else bar.parentElement.classList.add('indet');
    if (!busyShown) { view.classList.add('busy'); busyShown = true; }
  }
  function hideBusy() { view.classList.remove('busy'); busyShown = false; }

  // ---------- File ----------
  function acceptOf(tool) { return tool.accept.map((k) => ACCEPT[k]).join(','); }
  function pick(extraKinds) {
    if (!cur) return;
    input.accept = extraKinds ? extraKinds.map((k) => ACCEPT[k]).join(',') : acceptOf(cur.tool);
    input.multiple = !!cur.tool.multiple;
    input.value = '';
    input.click();
  }
  input.addEventListener('change', () => { if (input.files.length) addFiles(input.files); });

  async function ensureUnlocked(entry) {
    if (!T.bytesInclude(entry.bytes, '/Encrypt')) return true;
    try {
      entry.bytes = await T.unlockPdf(entry.bytes, entry.name);
      entry.unlocked = true;
      return true;
    } catch (e) {
      if (e.code === 'CANCELLED') return false;
      console.warn(e);
      toast(`${entry.name}: enkripsi tidak didukung. Coba alat "Buka Kunci PDF".`, 'error');
      return false;
    }
  }
  async function addFiles(list) {
    const t = cur.tool;
    let arr = Array.from(list);
    if (!arr.length) return;
    if (!t.multiple) { arr = arr.slice(0, 1); }
    if (t.max && cur.files.length + arr.length > t.max) {
      if (t.max === 2 && arr.length >= 2) cur.files = [];
      arr = arr.slice(0, t.max - cur.files.length);
      if (!arr.length) { toast(`Alat ini memakai tepat ${t.max} file. Hapus salah satu file dulu.`, 'error'); return; }
    }
    showBusy('Membuka file…');
    const added = [];
    try {
      for (const file of arr) {
        const kind = kindOf(file);
        if (!kind || !t.accept.includes(kind)) {
          toast(`"${file.name}" tidak didukung di alat ini. Gunakan ${t.accept.flatMap((k) => KIND_LABEL[k]).join(', ')}.`, 'error');
          continue;
        }
        const entry = { id: uid(), file, name: file.name, size: file.size, kind };
        if (kind === 'pdf') {
          entry.bytes = new Uint8Array(await file.arrayBuffer());
          if (!t.rawInput && !(await ensureUnlocked(entry))) continue;
          try {
            entry.pdf = await pdfjsDoc(entry.bytes);
            entry.numPages = entry.pdf.numPages;
          } catch (e) {
            if (!t.rawInput) {
              toast(e && e.name === 'PasswordException' ? `"${file.name}" dikunci kata sandi.` : `"${file.name}" tidak dapat dibaca. Coba alat "Perbaiki PDF".`, 'error');
              continue;
            }
          }
        } else if (kind === 'img') entry.url = URL.createObjectURL(file);
        if (!t.multiple) { cur.files.forEach((f) => f.pdf && f.pdf.destroy()); cur.files = []; cur.pages = []; cur.thumbs.clear(); }
        cur.files.push(entry);
        added.push(entry);
      }
      if (!added.length) return;
      if (t.view === 'pages') syncPages();
      if (t.prepare) {
        cur.opt = Object.assign(defaultsOf(t), cur.opt);
        await t.prepare(ctx());
      }
      cur.state = 'work';
    } catch (e) {
      console.error(e);
      toast(e.user ? e.message : 'File tidak dapat dibuka.', 'error');
    } finally {
      hideBusy();
      render();
    }
  }
  function removeFile(id) {
    const f = cur.files.find((x) => x.id === id);
    if (f) { if (f.pdf) f.pdf.destroy(); if (f.url) URL.revokeObjectURL(f.url); }
    cur.files = cur.files.filter((x) => x.id !== id);
    if (cur.tool.view === 'pages') syncPages();
    if (!cur.files.length && cur.tool.input !== 'none') cur.state = 'drop';
    render();
  }
  function syncPages() {
    const have = new Set(cur.pages.map((p) => p.fid));
    for (const f of cur.files) {
      if (have.has(f.id) || !f.numPages) continue;
      for (let i = 0; i < f.numPages; i++) cur.pages.push({ id: uid(), fid: f.id, i, rot: 0, sel: false, del: false });
    }
    cur.pages = cur.pages.filter((p) => p.blank || cur.files.some((f) => f.id === p.fid));
  }
  function ctx() {
    return {
      tool: cur.tool, files: cur.files, pages: cur.pages, opt: cur.opt, extra: cur.extra,
      file: (id) => cur.files.find((f) => f.id === id),
      progress: (text, frac) => showBusy(text, frac),
    };
  }

  // Tarik & lepas file langsung ke tampilan alat
  let dragN = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!cur || !hasFiles(e) || !document.body.classList.contains('tooling')) return; dragN++; view.classList.add('dragover'); });
  window.addEventListener('dragleave', (e) => { if (!cur || !hasFiles(e)) return; dragN = Math.max(0, dragN - 1); if (!dragN) view.classList.remove('dragover'); });
  window.addEventListener('drop', (e) => {
    if (!cur || !hasFiles(e) || !document.body.classList.contains('tooling')) return;
    e.preventDefault();
    dragN = 0;
    view.classList.remove('dragover');
    if (cur.busy || cur.tool.input === 'none' || $('.modal.open')) return;
    if (cur.state === 'done') cur.state = 'work';
    addFiles(e.dataTransfer.files);
  });

  // ---------- Render ----------
  function render() {
    if (!cur) return;
    const t = cur.tool;
    $('#tvIcon').innerHTML = icon(t.icon);
    $('#tvIcon').className = 'tv-icon cat-' + t.cat;
    $('#tvTitle').textContent = t.name;
    $('#tvDesc').textContent = t.desc;
    const drop = $('#tvDrop'), work = $('#tvWork'), done = $('#tvDone');
    drop.hidden = cur.state !== 'drop';
    work.hidden = cur.state !== 'work';
    done.hidden = cur.state !== 'done';
    if (cur.state === 'drop') {
      const only = t.accept.length === 1 ? t.accept[0] : '';
      $('#tvDropTitle').textContent = `Pilih ${only === 'pdf' ? 'file PDF' : only === 'img' ? 'gambar' : 'file'}`;
      $('#tvDropSub').textContent = t.multiple ? 'atau tarik & lepas beberapa file sekaligus ke sini' : 'atau tarik & lepas file ke sini';
      $('#tvFormats').innerHTML = t.accept.flatMap((k) => KIND_LABEL[k]).map((x) => `<span>${x}</span>`).join('');
    }
    if (cur.state === 'work') renderWork();
    if (cur.state === 'done') renderDone();
    const related = TOOLS.filter((x) => x.cat === t.cat && x.id !== t.id).concat(TOOLS.filter((x) => x.cat !== t.cat && ['gabung-pdf', 'kompres-pdf', 'tanda-tangan-pdf', 'konversi-dari-pdf'].includes(x.id))).slice(0, 8);
    $('#tvRelated').innerHTML = related.map((x) => cardHtml(x, true)).join('');
  }
  $('#tvDrop').addEventListener('click', () => pick());
  $('#tvDrop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });

  function renderWork() {
    const t = cur.tool;
    const main = $('#tvMain');
    main.innerHTML = '';
    if (cur.io) { cur.io.disconnect(); cur.io = null; }
    if (t.view === 'files') renderFiles(main);
    else if (t.view === 'pages') renderPages(main);
    else if (t.view === 'single' && cur.files[0]) renderSingle(main);
    if (t.custom) CUSTOM[t.custom](main);
    renderOptions();
    $('#tvRun').innerHTML = `${svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.2)}<span>${esc(t.runLabel || 'Proses')}</span>`;
  }

  // Thumbnail halaman (dirender bergiliran agar ringan)
  const queue = [];
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const job = queue.shift();
      if (!job.host.isConnected) continue;
      try { await job.run(); } catch (e) { console.warn(e); }
    }
    pumping = false;
  }
  function thumbInto(host, f, i) {
    const key = `${f.id}:${i}`;
    const cached = cur.thumbs.get(key);
    if (cached) { host.innerHTML = ''; host.appendChild(cached); return; }
    host.innerHTML = '<span class="th-spin"></span>';
    const run = async () => {
      if (!cur || !f.pdf) return;
      const page = await f.pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const c = await renderPage(page, (150 * Math.min(2, window.devicePixelRatio || 1)) / Math.max(vp.width, vp.height));
      cur.thumbs.set(key, c);
      if (host.isConnected) { host.innerHTML = ''; host.appendChild(c); }
    };
    if (!cur.io) {
      cur.io = new IntersectionObserver((ents) => {
        for (const en of ents) {
          if (!en.isIntersecting) continue;
          cur.io.unobserve(en.target);
          const job = en.target._job;
          if (job) { queue.push(job); pump(); }
        }
      }, { root: scroller, rootMargin: '400px 0px' });
    }
    host._job = { host, run };
    cur.io.observe(host);
  }

  function fileMeta(f) {
    const bits = [fmtSize(f.size)];
    if (f.numPages) bits.unshift(`${f.numPages} halaman`);
    if (f.unlocked) bits.push('kunci dibuka');
    return bits.join(' · ');
  }
  function renderFiles(main) {
    const t = cur.tool;
    const wrap = document.createElement('div');
    wrap.className = 'flist';
    cur.files.forEach((f, k) => {
      const row = document.createElement('div');
      row.className = 'frow';
      row.dataset.id = f.id;
      const label = t.labels ? `<span class="flabel">${esc(t.labels[k] || '')}</span>` : '';
      row.innerHTML = `<span class="grip" title="Seret untuk mengubah urutan">${T.ICON.grip}</span>
        <div class="fthumb"></div>
        <div class="finfo">${label}<b title="${esc(f.name)}">${esc(f.name)}</b><small>${fileMeta(f)}</small></div>
        <div class="facts">
          <button class="icon-btn" data-act="up" title="Naikkan" aria-label="Naikkan">${svg('<path d="m18 15-6-6-6 6"/>')}</button>
          <button class="icon-btn" data-act="down" title="Turunkan" aria-label="Turunkan">${svg('<path d="m6 9 6 6 6-6"/>')}</button>
          <button class="icon-btn danger" data-act="del" title="Hapus" aria-label="Hapus">${T.ICON.x}</button>
        </div>`;
      const th = row.querySelector('.fthumb');
      if (f.kind === 'pdf' && f.pdf) thumbInto(th, f, 0);
      else if (f.kind === 'img') th.innerHTML = `<img src="${f.url}" alt="">`;
      else th.innerHTML = `<span class="fbadge">${f.kind.toUpperCase()}</span>`;
      wrap.appendChild(row);
    });
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('.frow').dataset.id;
      const i = cur.files.findIndex((x) => x.id === id);
      if (b.dataset.act === 'del') return removeFile(id);
      const j = b.dataset.act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= cur.files.length) return;
      [cur.files[i], cur.files[j]] = [cur.files[j], cur.files[i]];
      renderWork();
    });
    sortable(wrap, '.frow', 'y', (from, to, after) => { moveItem(cur.files, from, to, after); renderWork(); });
    main.appendChild(wrap);
    const canAdd = t.multiple && (!t.max || cur.files.length < t.max);
    const bar = document.createElement('div');
    bar.className = 'fbar';
    bar.innerHTML = `${canAdd ? `<button class="btn btn-outline btn-sm" data-add>${svg('<path d="M12 5v14M5 12h14"/>', 2.2)}Tambah file</button>` : ''}
      ${t.labels && cur.files.length === 2 ? `<button class="btn btn-ghost btn-sm" data-swap>${svg('<path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4"/>')}Tukar urutan</button>` : ''}
      <span class="fbar-hint">${t.labels ? (cur.files.length < 2 ? `Tambahkan ${t.labels[1].toLowerCase()}.` : '') : cur.files.length > 1 ? 'Seret atau pakai panah untuk mengatur urutan.' : t.min > 1 ? `Tambahkan minimal ${t.min} file.` : ''}</span>`;
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) pick();
      if (e.target.closest('[data-swap]')) { cur.files.reverse(); renderWork(); }
    });
    main.appendChild(bar);
  }
  function moveItem(list, fromId, toId, after) {
    const i = list.findIndex((x) => x.id === fromId);
    if (i < 0) return;
    const [it] = list.splice(i, 1);
    let j = list.findIndex((x) => x.id === toId);
    if (j < 0) { list.splice(i, 0, it); return; }
    if (after) j++;
    list.splice(j, 0, it);
  }

  function renderSingle(main) {
    const f = cur.files[0];
    const card = document.createElement('div');
    card.className = 'fsingle';
    card.innerHTML = `<div class="fthumb fthumb-lg"></div>
      <div class="finfo"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${fileMeta(f)}</small>
      <button class="btn btn-outline btn-sm" data-change>${svg('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>')}Ganti file</button></div>`;
    card.querySelector('[data-change]').addEventListener('click', () => pick());
    const th = card.querySelector('.fthumb');
    if (f.pdf) thumbInto(th, f, 0); else th.innerHTML = '<span class="fbadge">PDF</span>';
    main.appendChild(card);
    if (cur.tool.preview === 'crop' && f.pdf) {
      const pv = document.createElement('div');
      pv.className = 'crop-prev';
      pv.innerHTML = '<div class="crop-page"><div class="crop-canvas"></div><div class="crop-box"></div></div><p class="crop-cap">Pratinjau halaman 1. Area di luar kotak akan dipotong.</p>';
      main.appendChild(pv);
      (async () => {
        const page = await f.pdf.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const c = await renderPage(page, Math.min(2, 520 / vp.width) * Math.min(2, window.devicePixelRatio || 1));
        const host = pv.querySelector('.crop-canvas');
        if (!host.isConnected) return;
        host.appendChild(c);
        pv.querySelector('.crop-page').style.aspectRatio = `${vp.width} / ${vp.height}`;
        cur.extra.cropVp = { w: vp.width, h: vp.height, page };
        updateCropPreview();
      })().catch(console.warn);
    }
  }
  let cropTimer;
  function updateCropPreview() {
    clearTimeout(cropTimer);
    cropTimer = setTimeout(async () => {
      const box = $('.crop-box');
      const vp = cur && cur.extra.cropVp;
      if (!box || !vp) return;
      const o = cur.opt;
      let m;
      if (o.mode === 'auto') {
        if (!cur.extra.autoBox) cur.extra.autoBox = (await contentBox(vp.page)) || { l: 0, t: 0, r: 1, b: 1 };
        const bb = cur.extra.autoBox, pad = num(o.pad, 3) * MM;
        m = { l: Math.max(0, bb.l * vp.w - pad), t: Math.max(0, bb.t * vp.h - pad), r: Math.max(0, (1 - bb.r) * vp.w - pad), b: Math.max(0, (1 - bb.b) * vp.h - pad) };
      } else m = { t: num(o.t) * MM, r: num(o.r) * MM, b: num(o.b) * MM, l: num(o.l) * MM };
      Object.assign(box.style, {
        left: (m.l / vp.w) * 100 + '%', top: (m.t / vp.h) * 100 + '%',
        right: (m.r / vp.w) * 100 + '%', bottom: (m.b / vp.h) * 100 + '%',
      });
    }, 60);
  }

  // ---------- Grid halaman ----------
  const PAGE_MODES = {
    organize: { reorder: true, rotate: true, remove: true, add: true, blank: true, hint: 'Seret halaman untuk mengubah urutan. Putar atau hapus lewat tombol di setiap halaman.' },
    sort: { reorder: true, sorters: true, hint: 'Seret halaman untuk mengubah urutan, atau gunakan urutan cepat.' },
    rotate: { rotate: true, select: 'sel', hint: 'Putar halaman satu per satu, atau klik beberapa halaman lalu putar sekaligus.' },
    remove: { select: 'del', hint: 'Klik halaman yang ingin dihapus.' },
    extract: { select: 'sel', hint: 'Klik halaman yang ingin diambil.' },
    view: { hint: '' },
  };
  function renderPages(main) {
    const M = PAGE_MODES[cur.tool.mode] || PAGE_MODES.view;
    const bar = document.createElement('div');
    bar.className = 'pbar';
    const btn = (act, label, ico) => `<button class="btn btn-outline btn-sm" data-pact="${act}">${ico ? svg(ico, 2) : ''}${label}</button>`;
    const ROT_L = '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>', ROT_R = '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>';
    let html = '';
    if (M.add) html += btn('add', 'Tambah PDF', '<path d="M12 5v14M5 12h14"/>');
    if (M.blank) html += btn('blank', 'Halaman kosong', '<rect x="5" y="3" width="14" height="18" rx="2"/>');
    if (M.rotate && !M.select) html += btn('rotall-l', 'Putar semua', ROT_L) + btn('rotall-r', '', ROT_R);
    if (M.select) {
      const n = cur.pages.filter((p) => p[M.select]).length;
      html += btn('all', 'Pilih semua') + btn('odd', 'Ganjil') + btn('even', 'Genap') + (n ? btn('none', 'Batal pilih') : '');
      if (M.rotate) html += btn('rotsel-l', n ? 'Putar terpilih' : 'Putar semua', ROT_L) + btn('rotsel-r', '', ROT_R);
      html += `<span class="pcount">${n ? `${n} halaman ${M.select === 'del' ? 'akan dihapus' : 'dipilih'}` : ''}</span>`;
    }
    if (M.sorters) html += btn('reverse', 'Balik urutan') + btn('oddfirst', 'Ganjil dulu') + btn('duplex', 'Rapikan scan bolak-balik') + btn('reset', 'Urutan awal');
    bar.innerHTML = html;
    if (html) main.appendChild(bar);
    if (M.hint) {
      const hint = document.createElement('p');
      hint.className = 'phint';
      hint.textContent = M.hint;
      main.appendChild(hint);
    }
    const grid = document.createElement('div');
    grid.className = 'pgrid' + (M.select ? ' selectable' : '') + (M.reorder ? ' reorder' : '');
    const multi = cur.files.length > 1;
    cur.pages.forEach((p, k) => {
      const el = document.createElement('div');
      el.className = 'pg' + (p.sel ? ' sel' : '') + (p.del ? ' del' : '');
      el.dataset.id = p.id;
      const f = p.blank ? null : cur.files.find((x) => x.id === p.fid);
      let tools = '';
      if (M.rotate) tools += `<button data-iact="rl" title="Putar ke kiri" aria-label="Putar ke kiri">${svg(ROT_L, 2)}</button><button data-iact="rr" title="Putar ke kanan" aria-label="Putar ke kanan">${svg(ROT_R, 2)}</button>`;
      if (M.remove) tools += `<button data-iact="x" class="danger" title="Hapus halaman" aria-label="Hapus halaman">${T.ICON.trash}</button>`;
      el.innerHTML = `<div class="pg-box"><div class="pg-thumb${p.rot % 180 ? ' sideways' : ''}" style="--rot:${p.rot}deg"></div>${M.select === 'del' ? `<span class="pg-mark">${T.ICON.x}</span>` : M.select ? `<span class="pg-mark">${svg('<path d="M20 6 9 17l-5-5"/>', 3)}</span>` : ''}${M.reorder ? `<span class="grip">${T.ICON.grip}</span>` : ''}</div>
        <div class="pg-foot"><span class="pg-num">${k + 1}</span>${multi && f ? `<span class="pg-src" title="${esc(f.name)}">${esc(baseOf(f.name))} · ${p.i + 1}</span>` : ''}${tools ? `<span class="pg-tools">${tools}</span>` : ''}</div>`;
      const th = el.querySelector('.pg-thumb');
      if (p.blank) th.innerHTML = '<span class="pg-blank">Kosong</span>';
      else if (f) thumbInto(th, f, p.i);
      grid.appendChild(el);
    });
    let lastDrag = 0;
    grid.addEventListener('click', (e) => {
      if (Date.now() - lastDrag < 250) return;
      const el = e.target.closest('.pg');
      if (!el) return;
      const p = cur.pages.find((x) => x.id === el.dataset.id);
      const b = e.target.closest('[data-iact]');
      if (b) {
        if (b.dataset.iact === 'x') { cur.pages = cur.pages.filter((x) => x !== p); renderWork(); return; }
        p.rot = (((p.rot + (b.dataset.iact === 'rr' ? 90 : -90)) % 360) + 360) % 360;
        const th = el.querySelector('.pg-thumb');
        th.style.setProperty('--rot', p.rot + 'deg');
        th.classList.toggle('sideways', p.rot % 180 !== 0);
        return;
      }
      if (M.select) { p[M.select] = !p[M.select]; renderWork(); }
    });
    if (M.reorder) sortable(grid, '.pg', 'x', (from, to, after) => { lastDrag = Date.now(); moveItem(cur.pages, from, to, after); renderWork(); });
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pact]');
      if (!b) return;
      const a = b.dataset.pact;
      const P = cur.pages;
      const rotAll = (list, d) => list.forEach((p) => { p.rot = (((p.rot + d) % 360) + 360) % 360; });
      if (a === 'add') return pick(['pdf']);
      if (a === 'blank') {
        const last = P[P.length - 1];
        let w = 595.28, h = 841.89;
        if (last && !last.blank) { const f = cur.files.find((x) => x.id === last.fid); const th = cur.thumbs.get(`${f.id}:${last.i}`); if (th) { const r = th.width / th.height; h = w / r; } }
        else if (last) { w = last.w; h = last.h; }
        P.push({ id: uid(), blank: true, w, h, rot: 0 });
      }
      if (a === 'rotall-l') rotAll(P, -90);
      if (a === 'rotall-r') rotAll(P, 90);
      if (a === 'all') P.forEach((p) => { p[M.select] = true; });
      if (a === 'none') P.forEach((p) => { p[M.select] = false; });
      if (a === 'odd') P.forEach((p, k) => { p[M.select] = k % 2 === 0; });
      if (a === 'even') P.forEach((p, k) => { p[M.select] = k % 2 === 1; });
      if (a === 'rotsel-l' || a === 'rotsel-r') { const s = P.filter((p) => p.sel); rotAll(s.length ? s : P, a === 'rotsel-r' ? 90 : -90); }
      if (a === 'reverse') P.reverse();
      if (a === 'oddfirst') { const odd = P.filter((_, k) => k % 2 === 0), even = P.filter((_, k) => k % 2 === 1); cur.pages = odd.concat(even); }
      if (a === 'duplex') {
        const half = Math.ceil(P.length / 2);
        const fronts = P.slice(0, half), backs = P.slice(half).reverse();
        const out = [];
        fronts.forEach((p, k) => { out.push(p); if (backs[k]) out.push(backs[k]); });
        cur.pages = out;
        toast('Halaman depan & belakang digabung berselang-seling (halaman belakang dibaca terbalik).');
      }
      if (a === 'reset') cur.pages.sort((x, y) => cur.files.findIndex((f) => f.id === x.fid) - cur.files.findIndex((f) => f.id === y.fid) || x.i - y.i);
      renderWork();
    });
    main.appendChild(grid);
  }

  /** Urutkan item dengan seret (mouse & sentuh lewat pegangan). */
  function sortable(container, sel, axis, onMove) {
    container.addEventListener('pointerdown', (e) => {
      const item = e.target.closest(sel);
      if (!item || e.target.closest('button, input, a, select')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType !== 'mouse' && !e.target.closest('.grip')) return;
      const sx = e.clientX, sy = e.clientY;
      const r0 = item.getBoundingClientRect();
      let dragging = false, ghost = null, target = null, after = false;
      const clear = () => $$('.drop-before, .drop-after', container).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      const move = (ev) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          dragging = true;
          item.classList.add('dragging');
          ghost = item.cloneNode(true);
          ghost.classList.add('sort-ghost');
          ghost.style.width = r0.width + 'px';
          const cv = item.querySelector('canvas');
          const gc = ghost.querySelector('canvas');
          if (cv && gc) { gc.width = cv.width; gc.height = cv.height; gc.getContext('2d').drawImage(cv, 0, 0); }
          document.body.appendChild(ghost);
        }
        ev.preventDefault();
        ghost.style.transform = `translate(${ev.clientX - (sx - r0.left)}px, ${ev.clientY - (sy - r0.top)}px)`;
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const over = hit && hit.closest(sel);
        clear();
        target = null;
        if (over && over !== item && container.contains(over)) {
          const r = over.getBoundingClientRect();
          after = axis === 'x' ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
          over.classList.add(after ? 'drop-after' : 'drop-before');
          target = over;
        }
        const sr = scroller.getBoundingClientRect();
        if (ev.clientY < sr.top + 70) scroller.scrollTop -= 14;
        else if (ev.clientY > sr.bottom - 70) scroller.scrollTop += 14;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!dragging) return;
        item.classList.remove('dragging');
        if (ghost) ghost.remove();
        clear();
        if (target) onMove(item.dataset.id, target.dataset.id, after);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  // ---------- Opsi ----------
  function optionList() {
    const t = cur.tool;
    return typeof t.options === 'function' ? t.options(ctx()) : (t.options || []);
  }
  function renderOptions() {
    const host = $('#tvOpts');
    const list = optionList();
    const c = ctx();
    const o = cur.opt;
    const field = (x) => {
      if (x.show && !x.show(o, c)) return '';
      const help = typeof x.help === 'function' ? x.help(o) : x.help;
      const helpHtml = help ? `<small class="opt-help">${esc(help)}</small>` : '';
      const v = o[x.id];
      switch (x.type) {
        case 'row': {
          const inner = x.items.map(field).filter(Boolean);
          return inner.length ? `<div class="opt-row">${inner.join('')}</div>` : '';
        }
        case 'note': return `<div class="opt-note">${x.html}</div>`;
        case 'check': return `<label class="opt check"><input type="checkbox" data-opt="${x.id}" ${v ? 'checked' : ''}> <span>${esc(x.label)}</span></label>`;
        case 'seg': return `<div class="opt"><span class="opt-label">${esc(x.label)}</span><div class="seg" role="radiogroup">${x.choices.map(([val, l]) => `<button type="button" role="radio" aria-checked="${String(v) === val}" class="${String(v) === val ? 'on' : ''}" data-seg="${x.id}" data-val="${esc(val)}">${esc(l)}</button>`).join('')}</div>${helpHtml}</div>`;
        case 'select': return `<label class="opt"><span class="opt-label">${esc(x.label)}</span><select class="field" data-opt="${x.id}">${x.choices.map(([val, l]) => `<option value="${esc(val)}" ${String(v) === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${helpHtml}</label>`;
        case 'number': return `<label class="opt"><span class="opt-label">${esc(x.label)}</span><input class="field" type="number" inputmode="decimal" data-opt="${x.id}" value="${esc(v ?? '')}" ${x.min != null ? `min="${x.min}"` : ''} ${x.max != null ? `max="${x.max}"` : ''} step="any">${helpHtml}</label>`;
        case 'text': case 'password': return `<label class="opt"><span class="opt-label">${esc(x.label)}</span><input class="field" type="${x.type}" data-opt="${x.id}" value="${esc(v ?? '')}" placeholder="${esc(x.placeholder || '')}" ${x.type === 'password' ? 'autocomplete="new-password"' : 'autocomplete="off"'}>${helpHtml}</label>`;
        case 'color': return `<label class="opt opt-color"><span class="opt-label">${esc(x.label)}</span><input type="color" data-opt="${x.id}" value="${esc(v)}"></label>`;
        case 'range': return `<label class="opt"><span class="opt-label">${esc(x.label)} <b data-range-val="${x.id}">${esc(v)}${x.suffix || ''}</b></span><input type="range" data-opt="${x.id}" min="${x.min}" max="${x.max}" value="${esc(v)}"></label>`;
        case 'file': {
          const f = cur.extra[x.id];
          return `<div class="opt"><span class="opt-label">${esc(x.label)}</span><button type="button" class="btn btn-outline btn-sm opt-file" data-file="${x.id}" data-accept="${esc(x.accept || '')}">${f ? esc(f.name) : 'Pilih gambar…'}</button></div>`;
        }
        default: return '';
      }
    };
    host.innerHTML = list.map(field).join('') || (cur.tool.input === 'none' ? '' : '<p class="opt-empty">Tidak ada pengaturan tambahan. Langsung klik tombol di bawah.</p>');
  }
  const optsHost = $('#tvOpts');
  const onOpt = (e) => {
    const el = e.target;
    if (!cur) return;
    if (el.dataset.opt) {
      const id = el.dataset.opt;
      cur.opt[id] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'range') { const b = $(`[data-range-val="${id}"]`); const x = findOpt(id); if (b) b.textContent = el.value + ((x && x.suffix) || ''); }
      if (e.type === 'change' && (el.type === 'checkbox' || el.tagName === 'SELECT')) renderOptions();
      if (cur.tool.preview === 'crop') updateCropPreview();
    }
  };
  function findOpt(id) {
    let found = null;
    const walk = (l) => l.forEach((x) => { if (x.type === 'row') walk(x.items); else if (x.id === id) found = x; });
    walk(optionList());
    return found;
  }
  optsHost.addEventListener('input', onOpt);
  optsHost.addEventListener('change', onOpt);
  optsHost.addEventListener('click', (e) => {
    const s = e.target.closest('[data-seg]');
    if (s) {
      cur.opt[s.dataset.seg] = s.dataset.val;
      if (s.dataset.seg === 'mode' && cur.tool.preview === 'crop') cur.extra.autoBox = cur.extra.autoBox || null;
      renderOptions();
      if (cur.tool.preview === 'crop') updateCropPreview();
      return;
    }
    const fb = e.target.closest('[data-file]');
    if (fb) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = fb.dataset.accept || '';
      inp.addEventListener('change', () => { if (inp.files[0]) { cur.extra[fb.dataset.file] = inp.files[0]; renderOptions(); } });
      inp.click();
    }
  });

  // ---------- Jalankan ----------
  $('#tvRun').addEventListener('click', run);
  async function run() {
    if (!cur || cur.busy) return;
    const t = cur.tool;
    if (t.input !== 'none') {
      if (!cur.files.length) { toast('Pilih file terlebih dahulu.', 'error'); return; }
      if (t.min && cur.files.length < t.min) { toast(t.labels ? `Tambahkan ${t.labels[cur.files.length].toLowerCase()} terlebih dahulu.` : `Pilih minimal ${t.min} file.`, 'error'); return; }
    }
    if (t.validate) { const msg = t.validate(ctx()); if (msg) { toast(msg, 'error'); return; } }
    const active = document.activeElement;
    if (active && active.blur) active.blur();
    cur.busy = true;
    showBusy('Memproses…');
    try {
      await ensureLibs();
      const res = await t.run(ctx());
      if (!cur) return;
      cur.result = Array.isArray(res) ? { files: res, note: res.note } : res;
      cur.state = 'done';
      render();
      scroller.scrollTop = 0;
      const files = cur.result.files || [];
      if (files.length === 1) download(files[0].blob, files[0].name);
    } catch (e) {
      console.error(e);
      const msg = e.user ? e.message
        : e.code === 'NO_CRYPTO' ? e.message
          : /Gagal memuat/.test(e.message || '') ? 'Gagal memuat komponen. Periksa koneksi lalu muat ulang halaman.'
            : 'Gagal memproses file. Pastikan file tidak rusak, lalu coba lagi.';
      toast(msg, 'error');
    } finally {
      if (cur) cur.busy = false;
      hideBusy();
    }
  }

  function renderDone() {
    const r = cur.result || {};
    const files = r.files || [];
    const host = $('#tvDone');
    const total = files.reduce((s, f) => s + f.blob.size, 0);
    const fileRow = (f, i) => `<div class="drow"><span class="dicon">${icon(/\.pdf$/i.test(f.name) ? 'toPdf' : /\.(jpe?g|png)$/i.test(f.name) ? 'images' : 'fromPdf', 1.8)}</span>
      <div class="dinfo"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${fmtSize(f.blob.size)}</small></div>
      <div class="dacts">${/\.pdf$/i.test(f.name) ? `<button class="btn btn-ghost btn-sm" data-sign="${i}" title="Buka di editor untuk ditandatangani">${svg(I.sign, 1.8)}<span>Tanda tangani</span></button>` : ''}
      <button class="btn btn-primary btn-sm" data-dl="${i}">${svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2)}<span>Unduh</span></button></div></div>`;
    host.innerHTML = `<div class="done-card${r.html ? ' wide' : ''}">
      <div class="done-head"><span class="done-icon">${svg('<path d="M20 6 9 17l-5-5"/>', 3)}</span>
      <div><h2>${r.html ? 'Perbandingan selesai' : files.length === 1 ? 'Selesai! File sudah diunduh.' : `Selesai! ${files.length} file siap diunduh.`}</h2>
      ${r.note ? `<p>${esc(r.note)}</p>` : files.length === 1 ? '<p>Jika unduhan tidak muncul, klik tombol Unduh di bawah.</p>' : ''}</div></div>
      ${files.length ? `<div class="dlist">${files.slice(0, 200).map(fileRow).join('')}${files.length > 200 ? `<p class="dmore">…dan ${files.length - 200} file lainnya (ada di ZIP).</p>` : ''}</div>` : ''}
      ${r.html ? `<div class="cmp">${r.html}</div>` : ''}
      <div class="done-actions">
        ${files.length > 1 ? `<button class="btn btn-primary" data-zip>${svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2)}Unduh semua (ZIP, ${fmtSize(total)})</button>` : ''}
        <button class="btn btn-outline" data-back>${svg('<path d="M19 12H5M11 18l-6-6 6-6"/>', 2)}Ubah pengaturan</button>
        <button class="btn btn-ghost" data-again>${svg('<path d="M12 5v14M5 12h14"/>', 2)}${cur.tool.input === 'none' ? 'Buat baru' : 'Proses file lain'}</button>
      </div></div>`;
  }
  $('#tvDone').addEventListener('click', async (e) => {
    const files = (cur && cur.result && cur.result.files) || [];
    const dl = e.target.closest('[data-dl]');
    if (dl) { const f = files[+dl.dataset.dl]; download(f.blob, f.name); return; }
    const sg = e.target.closest('[data-sign]');
    if (sg) { const f = files[+sg.dataset.sign]; T.openInEditor(new File([f.blob], f.name, { type: 'application/pdf' }), 'sign'); return; }
    if (e.target.closest('[data-zip]')) {
      showBusy('Menyiapkan ZIP…');
      try { download(await zipBlob(files), `${baseOf(cur.files[0] ? cur.files[0].name : cur.tool.id)}-${cur.tool.id}.zip`); }
      catch (err) { console.error(err); toast('Gagal membuat ZIP.', 'error'); }
      finally { hideBusy(); }
      return;
    }
    if (e.target.closest('[data-back]')) { cur.state = 'work'; render(); return; }
    if (e.target.closest('[data-again]')) {
      const id = cur.tool.id;
      disposeCur();
      cur = null;
      openTool(id, false);
    }
  });

  // ==========================================================
  // TAMPILAN KHUSUS (bookmark, invoice, surat lamaran)
  // ==========================================================
  function initCustomState() {
    const t = cur.tool;
    if (t.custom === 'invoice') {
      const saved = loadForm('ttdin.invoice.v1');
      const d = new Date();
      cur.extra.inv = {
        seller: '', sellerInfo: '', city: '', signer: '', notes: '', color: '#4f46e5', logo: '',
        ...saved,
        no: `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-001`,
        date: today(), due: '', buyer: '', buyerInfo: '', discount: '0', tax: '0', shipping: '0', sigId: '',
        items: [{ desc: '', qty: '1', price: '' }],
      };
    }
    if (t.custom === 'lamaran') {
      const saved = loadForm('ttdin.lamaran.v1');
      cur.extra.lam = {
        name: '', birth: '', education: '', address: '', phone: '', email: '', city: '',
        ...saved,
        position: '', company: '', recipient: 'Bapak/Ibu HRD', companyAddress: '', source: '', date: today(),
        lampiran: LAMPIRAN.slice(0, 5), sigId: '', body: '', bodyEdited: false,
      };
      cur.extra.lamFiles = [];
    }
  }
  const fieldHtml = (key, label, v, o = {}) => o.area
    ? `<label class="opt${o.wide ? ' wide' : ''}"><span class="opt-label">${label}</span><textarea class="field area" data-k="${key}" rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}">${esc(v || '')}</textarea></label>`
    : `<label class="opt${o.wide ? ' wide' : ''}"><span class="opt-label">${label}</span><input class="field" type="${o.type || 'text'}" data-k="${key}" value="${esc(v || '')}" placeholder="${esc(o.ph || '')}" ${o.type === 'number' ? 'step="any" inputmode="decimal"' : ''}></label>`;
  function sigPicker(selected) {
    const list = T.loadSaved() || [];
    if (!list.length) return '<p class="opt-help">Belum ada tanda tangan tersimpan. Siapkan di menu "Tanda Tangan Saya" agar bisa dibubuhkan otomatis.</p>';
    return `<div class="sigpick"><button type="button" class="${selected ? '' : 'on'}" data-sig="">Tanpa TTD</button>${list.map((s) => `<button type="button" class="${selected === s.id ? 'on' : ''}" data-sig="${s.id}"><img src="${s.src}" alt="Tanda tangan"></button>`).join('')}</div>`;
  }

  const CUSTOM = {
    bookmarks(main) {
      const box = document.createElement('div');
      box.className = 'bm';
      const n = (cur.files[0] && cur.files[0].numPages) || 1;
      const draw = () => {
        const bm = cur.extra.bm || [];
        box.innerHTML = `<div class="bm-bar">
            <button class="btn btn-primary btn-sm" data-bm="add">${svg('<path d="M12 5v14M5 12h14"/>', 2.2)}Tambah bookmark</button>
            <button class="btn btn-outline btn-sm" data-bm="auto">Buat per halaman</button>
            ${bm.length ? '<button class="btn btn-ghost btn-sm" data-bm="clear">Hapus semua</button>' : ''}
          </div>
          ${bm.length ? `<div class="bm-list">${bm.map((b, i) => `<div class="bm-row" style="--lvl:${b.level}" data-i="${i}">
              <span class="bm-indent"><button class="icon-btn" data-bm="out" title="Naikkan level" aria-label="Naikkan level" ${b.level ? '' : 'disabled'}>${svg('<path d="m15 18-6-6 6-6"/>')}</button><button class="icon-btn" data-bm="in" title="Jadikan sub-bookmark" aria-label="Jadikan sub-bookmark" ${i && b.level <= bm[i - 1].level ? '' : 'disabled'}>${svg('<path d="m9 18 6-6-6-6"/>')}</button></span>
              <input class="field bm-title" data-bmk="title" value="${esc(b.title)}" placeholder="Judul bookmark">
              <label class="bm-page">Hal. <input class="field" type="number" min="1" max="${n}" data-bmk="page" value="${b.page}"></label>
              <span class="bm-acts"><button class="icon-btn" data-bm="up" title="Naikkan" aria-label="Naikkan">${svg('<path d="m18 15-6-6-6 6"/>')}</button><button class="icon-btn" data-bm="down" title="Turunkan" aria-label="Turunkan">${svg('<path d="m6 9 6 6 6-6"/>')}</button><button class="icon-btn danger" data-bm="del" title="Hapus" aria-label="Hapus">${T.ICON.x}</button></span>
            </div>`).join('')}</div>` : '<p class="bm-empty">PDF ini belum punya bookmark. Klik "Tambah bookmark" untuk membuat daftar isi.</p>'}`;
      };
      box.addEventListener('input', (e) => {
        const k = e.target.dataset.bmk;
        if (!k) return;
        const i = +e.target.closest('.bm-row').dataset.i;
        cur.extra.bm[i][k] = k === 'page' ? e.target.value : e.target.value;
      });
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-bm]');
        if (!b) return;
        const bm = cur.extra.bm = cur.extra.bm || [];
        const row = b.closest('.bm-row');
        const i = row ? +row.dataset.i : -1;
        const a = b.dataset.bm;
        if (a === 'add') bm.push({ title: '', page: Math.min(n, (bm.length ? +bm[bm.length - 1].page : 0) + 1), level: 0 });
        if (a === 'auto') { if (!bm.length || confirm('Ganti semua bookmark dengan satu bookmark per halaman?')) cur.extra.bm = range(1, n + 1).map((p) => ({ title: `Halaman ${p}`, page: p, level: 0 })); }
        if (a === 'clear' && confirm('Hapus semua bookmark?')) cur.extra.bm = [];
        if (a === 'del') bm.splice(i, 1);
        if (a === 'up' && i > 0) [bm[i - 1], bm[i]] = [bm[i], bm[i - 1]];
        if (a === 'down' && i < bm.length - 1) [bm[i + 1], bm[i]] = [bm[i], bm[i + 1]];
        if (a === 'in') bm[i].level++;
        if (a === 'out') bm[i].level = Math.max(0, bm[i].level - 1);
        if ((a === 'up' || a === 'down' || a === 'del') && bm.length) {
          bm[0].level = 0;
          for (let k = 1; k < bm.length; k++) bm[k].level = Math.min(bm[k].level, bm[k - 1].level + 1);
        }
        draw();
        if (a === 'add') { const inputs = $$('.bm-title', box); if (inputs.length) inputs[inputs.length - 1].focus(); }
      });
      draw();
      main.appendChild(box);
    },

    invoice(main) {
      const d = cur.extra.inv;
      const box = document.createElement('div');
      box.className = 'cform';
      const draw = () => {
        const subtotal = d.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0);
        const disc = subtotal * clamp(num(d.discount), 0, 100) / 100;
        const total = subtotal - disc + (subtotal - disc) * clamp(num(d.tax), 0, 100) / 100 + num(d.shipping);
        box.innerHTML = `
          <section class="cf-sec"><h3>Dari (usaha Anda)</h3><div class="cf-grid">
            ${fieldHtml('seller', 'Nama usaha / nama Anda', d.seller, { ph: 'Toko Maju Jaya' })}
            ${fieldHtml('city', 'Kota', d.city, { ph: 'Bandung' })}
            ${fieldHtml('sellerInfo', 'Alamat & kontak', d.sellerInfo, { area: true, wide: true, rows: 2, ph: 'Jl. Merdeka No. 1, Bandung · 0812-xxxx · email@usaha.com' })}
            <div class="opt"><span class="opt-label">Logo (opsional)</span><div class="cf-logo">${d.logo ? `<img src="${d.logo}" alt="Logo">` : ''}<button type="button" class="btn btn-outline btn-sm" data-inv="logo">${d.logo ? 'Ganti' : 'Pilih logo'}</button>${d.logo ? '<button type="button" class="btn btn-ghost btn-sm" data-inv="nologo">Hapus</button>' : ''}</div></div>
            <label class="opt opt-color"><span class="opt-label">Warna tema</span><input type="color" data-k="color" value="${esc(d.color)}"></label>
          </div></section>
          <section class="cf-sec"><h3>Kepada (pelanggan)</h3><div class="cf-grid">
            ${fieldHtml('buyer', 'Nama pelanggan / perusahaan', d.buyer, { ph: 'PT Pelanggan Setia' })}
            ${fieldHtml('no', 'Nomor invoice', d.no)}
            ${fieldHtml('buyerInfo', 'Alamat pelanggan', d.buyerInfo, { area: true, wide: true, rows: 2 })}
            ${fieldHtml('date', 'Tanggal', d.date, { type: 'date' })}
            ${fieldHtml('due', 'Jatuh tempo (opsional)', d.due, { type: 'date' })}
          </div></section>
          <section class="cf-sec"><h3>Item</h3>
            <div class="items"><div class="items-head"><span>Deskripsi</span><span>Qty</span><span>Harga satuan (Rp)</span><span>Jumlah</span><span></span></div>
            ${d.items.map((it, i) => `<div class="items-row" data-i="${i}">
              <input class="field" data-it="desc" value="${esc(it.desc)}" placeholder="Nama barang / jasa" aria-label="Deskripsi">
              <input class="field" data-it="qty" type="number" step="any" inputmode="decimal" value="${esc(it.qty)}" aria-label="Qty">
              <input class="field" data-it="price" type="number" step="any" inputmode="numeric" value="${esc(it.price)}" placeholder="0" aria-label="Harga satuan">
              <span class="items-sum" data-sum="${i}">${rupiah(num(it.qty) * num(it.price))}</span>
              <button type="button" class="icon-btn danger" data-inv="del" aria-label="Hapus item" ${d.items.length > 1 ? '' : 'disabled'}>${T.ICON.x}</button>
            </div>`).join('')}</div>
            <button type="button" class="btn btn-outline btn-sm" data-inv="add">${svg('<path d="M12 5v14M5 12h14"/>', 2.2)}Tambah item</button>
            <div class="cf-grid cf-grid-3">
              ${fieldHtml('discount', 'Diskon (%)', d.discount, { type: 'number' })}
              ${fieldHtml('tax', 'Pajak / PPN (%)', d.tax, { type: 'number' })}
              ${fieldHtml('shipping', 'Ongkir / biaya lain (Rp)', d.shipping, { type: 'number' })}
            </div>
            <div class="inv-total">Total: <b data-total>${rupiah(total)}</b></div>
          </section>
          <section class="cf-sec"><h3>Catatan & tanda tangan</h3><div class="cf-grid">
            ${fieldHtml('notes', 'Catatan / info pembayaran', d.notes, { area: true, wide: true, rows: 3, ph: 'Transfer ke BCA 1234567890 a.n. Toko Maju Jaya. Terima kasih atas kepercayaan Anda.' })}
            ${fieldHtml('signer', 'Nama penanda tangan', d.signer, { ph: 'Nama & jabatan' })}
            <div class="opt wide"><span class="opt-label">Tanda tangan</span>${sigPicker(d.sigId)}</div>
          </div></section>`;
      };
      const recalc = () => {
        d.items.forEach((it, i) => { const el = box.querySelector(`[data-sum="${i}"]`); if (el) el.textContent = rupiah(num(it.qty) * num(it.price)); });
        const subtotal = d.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0);
        const disc = subtotal * clamp(num(d.discount), 0, 100) / 100;
        const total = subtotal - disc + (subtotal - disc) * clamp(num(d.tax), 0, 100) / 100 + num(d.shipping);
        const t = box.querySelector('[data-total]');
        if (t) t.textContent = rupiah(total);
      };
      box.addEventListener('input', (e) => {
        const k = e.target.dataset.k, it = e.target.dataset.it;
        if (k) d[k] = e.target.value;
        if (it) d.items[+e.target.closest('.items-row').dataset.i][it] = e.target.value;
        recalc();
      });
      box.addEventListener('click', (e) => {
        const s = e.target.closest('[data-sig]');
        if (s) { d.sigId = s.dataset.sig; draw(); return; }
        const b = e.target.closest('[data-inv]');
        if (!b) return;
        const a = b.dataset.inv;
        if (a === 'add') { d.items.push({ desc: '', qty: '1', price: '' }); draw(); const rows = $$('.items-row [data-it="desc"]', box); rows[rows.length - 1].focus(); }
        if (a === 'del') { d.items.splice(+b.closest('.items-row').dataset.i, 1); draw(); }
        if (a === 'nologo') { d.logo = ''; draw(); }
        if (a === 'logo') {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp';
          inp.addEventListener('change', async () => {
            const f = inp.files[0];
            if (!f) return;
            const url = URL.createObjectURL(f);
            try {
              const img = await loadImage(url);
              const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
              const c = document.createElement('canvas');
              c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              d.logo = canvasHasAlpha(img) ? c.toDataURL('image/png') : (() => { const x = c.getContext('2d'); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.9); })();
              draw();
            } catch (_) { toast('Logo tidak dapat dibaca.', 'error'); } finally { URL.revokeObjectURL(url); }
          });
          inp.click();
        }
      });
      draw();
      main.appendChild(box);
    },

    lamaran(main) {
      const d = cur.extra.lam;
      const box = document.createElement('div');
      box.className = 'cform';
      const syncBody = () => { if (!d.bodyEdited) { d.body = lamaranBody(d); const ta = box.querySelector('[data-k="body"]'); if (ta) ta.value = d.body; } };
      const draw = () => {
        if (!d.bodyEdited) d.body = lamaranBody(d);
        const files = cur.extra.lamFiles;
        box.innerHTML = `
          <section class="cf-sec"><h3>Data diri</h3><div class="cf-grid">
            ${fieldHtml('name', 'Nama lengkap *', d.name)}
            ${fieldHtml('birth', 'Tempat, tanggal lahir', d.birth, { ph: 'Bandung, 17 Agustus 2000' })}
            ${fieldHtml('education', 'Pendidikan terakhir', d.education, { ph: 'S1 Teknik Informatika, Universitas …' })}
            ${fieldHtml('phone', 'Nomor HP', d.phone, { type: 'tel' })}
            ${fieldHtml('email', 'Email', d.email, { type: 'email' })}
            ${fieldHtml('address', 'Alamat', d.address, { wide: true })}
          </div></section>
          <section class="cf-sec"><h3>Lowongan yang dilamar</h3><div class="cf-grid">
            ${fieldHtml('position', 'Posisi yang dilamar *', d.position, { ph: 'Staf Administrasi' })}
            ${fieldHtml('company', 'Nama perusahaan *', d.company, { ph: 'PT Sukses Bersama' })}
            ${fieldHtml('recipient', 'Ditujukan kepada', d.recipient)}
            ${fieldHtml('source', 'Sumber info lowongan', d.source, { ph: 'situs resmi perusahaan / LinkedIn / JobStreet' })}
            ${fieldHtml('companyAddress', 'Alamat perusahaan', d.companyAddress, { wide: true })}
            ${fieldHtml('city', 'Kota pembuatan surat', d.city, { ph: 'Bandung' })}
            ${fieldHtml('date', 'Tanggal surat', d.date, { type: 'date' })}
          </div></section>
          <section class="cf-sec"><h3>Daftar lampiran</h3>
            <div class="chips">${LAMPIRAN.map((x) => `<label class="chipcheck"><input type="checkbox" data-lamp="${esc(x)}" ${d.lampiran.includes(x) ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div>
          </section>
          <section class="cf-sec"><h3>Isi surat <small>(otomatis dari data di atas, boleh diedit)</small></h3>
            ${fieldHtml('body', '', d.body, { area: true, wide: true, rows: 16 })}
            ${d.bodyEdited ? '<button type="button" class="btn btn-ghost btn-sm" data-lam="regen">Buat ulang dari data</button>' : ''}
          </section>
          <section class="cf-sec"><h3>Tanda tangan</h3>${sigPicker(d.sigId)}</section>
          <section class="cf-sec"><h3>Berkas lampiran <small>(CV, ijazah, sertifikat — PDF/JPG/PNG)</small></h3>
            ${files.length ? `<div class="flist">${files.map((f, i) => `<div class="frow" data-i="${i}"><div class="fthumb">${f.url ? `<img src="${f.url}" alt="">` : '<span class="fbadge">PDF</span>'}</div><div class="finfo"><b>${esc(f.file.name)}</b><small>${fmtSize(f.file.size)}</small></div><div class="facts"><button class="icon-btn" data-lam="up" aria-label="Naikkan">${svg('<path d="m18 15-6-6-6 6"/>')}</button><button class="icon-btn" data-lam="down" aria-label="Turunkan">${svg('<path d="m6 9 6 6 6-6"/>')}</button><button class="icon-btn danger" data-lam="del" aria-label="Hapus">${T.ICON.x}</button></div></div>`).join('')}</div>` : ''}
            <button type="button" class="btn btn-outline btn-sm" data-lam="add">${svg('<path d="M12 5v14M5 12h14"/>', 2.2)}Tambah berkas lampiran</button>
            <p class="opt-help">Berkas digabung setelah surat lamaran, sesuai urutan di atas. Semua diproses di perangkat Anda.</p>
          </section>`;
      };
      box.addEventListener('input', (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        d[k] = e.target.value;
        if (k === 'body') { if (!d.bodyEdited) { d.bodyEdited = true; } return; }
        syncBody();
      });
      box.addEventListener('change', (e) => {
        if (e.target.dataset.k === 'body' && d.bodyEdited && !box.querySelector('[data-lam="regen"]')) draw();
        const l = e.target.dataset.lamp;
        if (l == null) return;
        d.lampiran = LAMPIRAN.filter((x) => (x === l ? e.target.checked : d.lampiran.includes(x)));
        syncBody();
      });
      box.addEventListener('click', (e) => {
        const s = e.target.closest('[data-sig]');
        if (s) { d.sigId = s.dataset.sig; draw(); return; }
        const b = e.target.closest('[data-lam]');
        if (!b) return;
        const files = cur.extra.lamFiles;
        const i = b.closest('.frow') ? +b.closest('.frow').dataset.i : -1;
        const a = b.dataset.lam;
        if (a === 'regen') { d.bodyEdited = false; draw(); }
        if (a === 'del') { if (files[i].url) URL.revokeObjectURL(files[i].url); files.splice(i, 1); draw(); }
        if (a === 'up' && i > 0) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); }
        if (a === 'down' && i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; draw(); }
        if (a === 'add') {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.multiple = true; inp.accept = `${ACCEPT.pdf},${ACCEPT.img}`;
          inp.addEventListener('change', () => {
            for (const f of inp.files) {
              const kind = kindOf(f);
              if (kind !== 'pdf' && kind !== 'img') { toast(`"${f.name}" tidak didukung. Gunakan PDF, JPG, atau PNG.`, 'error'); continue; }
              files.push({ file: f, kind, url: kind === 'img' ? URL.createObjectURL(f) : '' });
            }
            draw();
          });
          inp.click();
        }
      });
      draw();
      main.appendChild(box);
    },
  };

  // ---------- Mulai ----------
  initGrid();
  const m = location.hash.match(/^#alat\/([\w-]+)/);
  if (m && TOOLS.some((t) => t.id === m[1] && t.view !== 'editor')) {
    history.replaceState(null, '', location.pathname + location.search + '#alat');
    openTool(m[1]);
  }
  T.tools = { list: TOOLS, open: openTool };
})();
