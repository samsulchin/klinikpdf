/* ==========================================================
   KlinikPDF — Konversi Excel (XLSX / CSV) & PowerPoint (PPTX) ke PDF
   100% di browser: file dibaca dengan JSZip, PDF ditulis dengan pdf-lib.
   - Excel/CSV : digambar ulang sebagai tabel vektor (teks tetap bisa dipilih & dicari)
   - PowerPoint: tiap slide digambar di canvas, disimpan sebagai halaman PDF,
                 ditambah lapisan teks tak terlihat agar PDF bisa dicari.
   Bergantung pada window.JSZip dan window.PDFLib (dimuat oleh tools.js).
   ========================================================== */
(() => {
  'use strict';
  const PL = () => window.PDFLib;
  const EMU = 12700; // EMU per poin
  const MM = 72 / 25.4;

  function userErr(msg) { const e = new Error(msg); e.user = true; return e; }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  /** Beri kesempatan layar memperbarui progres (MessageChannel tidak diperlambat seperti setTimeout di tab latar). */
  let lastYield = 0;
  function yieldUI(force) {
    const now = performance.now();
    if (!force && now - lastYield < 80) return null;
    lastYield = now;
    return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
  }

  // ==========================================================
  // XML & paket ZIP (OOXML)
  // ==========================================================
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const parser = new DOMParser();
  function parseXml(text) {
    if (text == null) return null;
    const d = parser.parseFromString(text.replace(/^﻿/, ''), 'application/xml');
    const root = d.documentElement;
    if (!root || root.localName === 'parsererror' || root.getElementsByTagName('parsererror').length) return null;
    return root;
  }
  function kids(el, name) {
    const o = [];
    if (!el) return o;
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) o.push(c);
    return o;
  }
  function kid(el, name) {
    if (!el) return null;
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
    return null;
  }
  function at(el, ...names) {
    let e = el;
    for (const n of names) { e = kid(e, n); if (!e) return null; }
    return e;
  }
  const desc = (el, name) => (el ? Array.from(el.getElementsByTagNameNS('*', name)) : []);
  function attr(el, n, d = null) {
    if (!el) return d;
    const v = el.getAttribute(n);
    return v == null ? d : v;
  }
  function nAttr(el, n, d = null) {
    const v = attr(el, n);
    return v == null || v === '' || Number.isNaN(+v) ? d : +v;
  }
  function bAttr(el, n, d = false) {
    const v = attr(el, n);
    return v == null ? d : v === '1' || v === 'true' || v === 'on';
  }
  const rid = (el, n) => (el ? el.getAttributeNS(R_NS, n) || el.getAttribute('r:' + n) : null);

  function normPath(p) {
    const out = [];
    for (const s of String(p).split('/')) {
      if (s === '..') out.pop();
      else if (s && s !== '.') out.push(s);
    }
    return out.join('/');
  }
  const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };

  async function openZip(file, label) {
    let zip;
    try { zip = await window.JSZip.loadAsync(file); }
    catch (_) { const x = label === 'Excel' ? ['.xls', '.xlsx'] : ['.ppt', '.pptx']; throw userErr(`"${file.name}" bukan file ${label} yang valid atau rusak. File ${x[0]} (format lama) perlu dibuka di ${label} lalu disimpan ulang sebagai ${x[1]}.`); }
    const lower = new Map();
    zip.forEach((p, f) => lower.set(p.toLowerCase(), f));
    const find = (p) => zip.file(p) || lower.get(String(p).toLowerCase()) || null;
    const xmlCache = new Map(), relCache = new Map();
    const pkg = {
      has: (p) => !!find(p),
      text(p) { const f = find(p); return f ? f.async('string') : Promise.resolve(null); },
      bytes(p) { const f = find(p); return f ? f.async('uint8array') : Promise.resolve(null); },
      xml(p) {
        if (!p) return Promise.resolve(null);
        if (!xmlCache.has(p)) xmlCache.set(p, pkg.text(p).then(parseXml));
        return xmlCache.get(p);
      },
      rels(p) {
        if (!relCache.has(p)) {
          const d = dirOf(p);
          relCache.set(p, pkg.xml(d + '_rels/' + p.slice(d.length) + '.rels').then((x) => {
            const map = {};
            for (const r of kids(x, 'Relationship')) {
              const t = attr(r, 'Target') || '';
              const ext = attr(r, 'TargetMode') === 'External';
              map[attr(r, 'Id')] = { type: (attr(r, 'Type') || '').split('/').pop(), target: ext ? t : t.startsWith('/') ? normPath(t) : normPath(d + t), external: ext };
            }
            return map;
          }));
        }
        return relCache.get(p);
      },
    };
    return pkg;
  }
  const relOfType = (rels, type) => Object.values(rels || {}).find((r) => r.type === type && !r.external) || null;

  // ==========================================================
  // Warna
  // ==========================================================
  const BLACK = { r: 0, g: 0, b: 0, a: 1 };
  function hexColor(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 8) h = h.slice(2);
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  function rgb2hsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return { h, s, l };
  }
  function hsl2rgb({ h, s, l }, a = 1) {
    const f = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let r, g, b;
    if (s === 0) r = g = b = l;
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a };
  }
  const css = (c) => (c ? `rgba(${c.r},${c.g},${c.b},${c.a == null ? 1 : +c.a.toFixed(3)})` : 'transparent');
  const pdfRgb = (c) => PL().rgb(c.r / 255, c.g / 255, c.b / 255);
  const mix = (c, w, t) => ({ r: Math.round(c.r * t + w.r * (1 - t)), g: Math.round(c.g * t + w.g * (1 - t)), b: Math.round(c.b * t + w.b * (1 - t)), a: c.a });

  // ==========================================================
  // Teks PDF (huruf standar = WinAnsi)
  // ==========================================================
  const WIN_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const SAFE_MAP = { '\t': ' ', '−': '-', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '­': '' };
  const isWinAnsi = (s) => /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/.test(s);
  function winAnsi(s) {
    return String(s == null ? '' : s).replace(/[^\x20-\x7e\xa0-\xff]/g, (ch) => (WIN_EXTRA.includes(ch) ? ch : SAFE_MAP[ch] ?? '?'));
  }
  const cleanText = (s) => String(s == null ? '' : s).replace(/[\t   ]/g, ' ').replace(/[​­]/g, '').replace(/[−‐‑]/g, '-');

  function sniffImage(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'webp';
    const head = new TextDecoder().decode(bytes.slice(0, 200)).trimStart();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
    return null;
  }
  const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
  async function decodeImage(bytes) {
    const kind = sniffImage(bytes);
    if (!kind) return null;
    const blob = new Blob([bytes], { type: IMG_MIME[kind] });
    if (kind !== 'svg' && window.createImageBitmap) {
      try { return await createImageBitmap(blob); } catch (_) { /* coba cara lain */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const im = new Image();
      im.decoding = 'async';
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
      if (kind === 'svg' && (!im.naturalWidth || !im.naturalHeight)) { im.width = 512; im.height = 512; }
      return im;
    } catch (_) { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }
  const imgW = (im) => im.naturalWidth || im.width;
  const imgH = (im) => im.naturalHeight || im.height;
  function canvasToBlob(c, type, q) {
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Canvas kosong'))), type, q));
  }
  async function canvasBytes(c, type = 'image/jpeg', q = 0.92) {
    return new Uint8Array(await (await canvasToBlob(c, type, q)).arrayBuffer());
  }
  /** Sematkan gambar apa pun ke PDF (PNG/JPEG langsung, format lain lewat canvas). */
  async function embedAnyImage(doc, bytes) {
    const k = sniffImage(bytes);
    try {
      if (k === 'png') return await doc.embedPng(bytes);
      if (k === 'jpg') return await doc.embedJpg(bytes);
    } catch (_) { /* format rusak: coba lewat canvas */ }
    const im = await decodeImage(bytes);
    if (!im) return null;
    const c = document.createElement('canvas');
    c.width = Math.max(1, imgW(im)); c.height = Math.max(1, imgH(im));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return doc.embedPng(await canvasBytes(c, 'image/png'));
  }

  // ==========================================================
  // EXCEL — format angka & tanggal
  // ==========================================================
  const LOC = {
    id: { dec: ',', grp: '.', months: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
      mon: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'], days: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'], dy: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
      d14: 'dd/mm/yyyy', d22: 'dd/mm/yyyy h:mm', long: 'dddd, dd mmmm yyyy', time: 'h:mm:ss' },
    en: { dec: '.', grp: ',', months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], dy: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      d14: 'm/d/yyyy', d22: 'm/d/yyyy h:mm', long: 'dddd, mmmm dd, yyyy', time: 'h:mm:ss AM/PM' },
  };
  const BUILTIN_FMT = {
    0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)', 7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
    9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: '@D14', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
    18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: '@D22', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
    39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 41: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)', 42: '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)',
    43: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)', 44: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
  };
  const NAMED_COLORS = { black: '000000', blue: '0000FF', cyan: '00FFFF', green: '00FF00', magenta: 'FF00FF', red: 'FF0000', white: 'FFFFFF', yellow: 'FFFF00' };

  function splitSections(code) {
    const out = [];
    let cur = '';
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"') { const j = code.indexOf('"', i + 1); const e = j < 0 ? code.length - 1 : j; cur += code.slice(i, e + 1); i = e; continue; }
      if (ch === '\\' || ch === '_' || ch === '*') { cur += ch + (code[i + 1] ?? ''); i++; continue; }
      if (ch === '[') { const j = code.indexOf(']', i); if (j > 0) { cur += code.slice(i, j + 1); i = j; continue; } }
      if (ch === ';') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function tokenize(sec) {
    const toks = [];
    const S = { toks, color: null, cond: null, lang: null, date: false, general: false, text: false };
    const lit = (s) => { const l = toks[toks.length - 1]; if (l && l.k === 'lit') l.s += s; else toks.push({ k: 'lit', s }); };
    for (let i = 0; i < sec.length; i++) {
      const ch = sec[i], lo = ch.toLowerCase();
      if (ch === '"') { const j = sec.indexOf('"', i + 1); const e = j < 0 ? sec.length : j; lit(sec.slice(i + 1, e)); i = e; continue; }
      if (ch === '\\') { lit(sec[i + 1] ?? ''); i++; continue; }
      if (ch === '_') { lit(' '); i++; continue; }
      if (ch === '*') { toks.push({ k: 'fill' }); i++; continue; }
      if (ch === '[') {
        const j = sec.indexOf(']', i);
        if (j > 0) {
          const b = sec.slice(i + 1, j);
          i = j;
          if (NAMED_COLORS[b.toLowerCase()]) S.color = hexColor(NAMED_COLORS[b.toLowerCase()]);
          else if (/^color\s*\d+$/i.test(b)) S.color = INDEXED[+b.replace(/\D/g, '') - 1] ? hexColor(INDEXED[+b.replace(/\D/g, '') - 1]) : null;
          else if (/^[<>=]/.test(b)) { const m = b.match(/^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)/); if (m) S.cond = { op: m[1], v: +m[2] }; }
          else if (b[0] === '$') {
            const m = b.slice(1).split('-');
            if (m[0]) lit(m[0]);
            const code = (m[1] || '').toUpperCase();
            if (code === 'F800') { S.special = 'long'; } else if (code === 'F400') { S.special = 'time'; }
            else if (/409$|809$|C09$|1009$/.test(code)) S.lang = 'en';
            else if (/421$|43E$/.test(code)) S.lang = 'id';
          } else if (/^(h+|m+|s+)$/i.test(b)) { toks.push({ k: 'el', c: b[0].toLowerCase(), n: b.length }); S.date = true; }
          continue;
        }
      }
      if (sec.slice(i, i + 7).toLowerCase() === 'general') { toks.push({ k: 'gen' }); S.general = true; i += 6; continue; }
      if (sec.slice(i, i + 5).toUpperCase() === 'AM/PM') { toks.push({ k: 'ampm', s: 'AM/PM' }); S.date = true; i += 4; continue; }
      if (sec.slice(i, i + 3).toUpperCase() === 'A/P') { toks.push({ k: 'ampm', s: sec.slice(i, i + 3) }); S.date = true; i += 2; continue; }
      if ('ymdhs'.includes(lo)) {
        let j = i;
        while (j < sec.length && sec[j].toLowerCase() === lo) j++;
        toks.push({ k: 'd', c: lo, n: j - i });
        S.date = true;
        i = j - 1;
        continue;
      }
      if (ch === '0' || ch === '#' || ch === '?') { toks.push({ k: 'ph', c: ch }); continue; }
      if (ch === '.') {
        if (S.date && /0/.test(sec[i + 1] || '')) { let j = i + 1; while (sec[j] === '0') j++; toks.push({ k: 'fs', n: j - i - 1 }); i = j - 1; continue; }
        toks.push({ k: 'dot' }); continue;
      }
      if (ch === ',') { toks.push({ k: 'comma' }); continue; }
      if (ch === '%') { toks.push({ k: 'pct' }); continue; }
      if ((ch === 'E' || ch === 'e') && (sec[i + 1] === '+' || sec[i + 1] === '-')) { toks.push({ k: 'exp', s: sec[i + 1] }); i++; continue; }
      if (ch === '/' && !S.date) { toks.push({ k: 'slash' }); continue; }
      if (ch === '@') { toks.push({ k: 'at' }); S.text = true; continue; }
      if (lo === 'b' && /[12]/.test(sec[i + 1] || '')) { i++; continue; } // kalender Buddha/Hijriah: abaikan
      lit(ch);
    }
    // Bedakan "m" bulan vs menit
    const dt = toks.filter((t) => t.k === 'd' || t.k === 'el' || t.k === 'fs');
    dt.forEach((t, k) => {
      if (t.k !== 'd' || t.c !== 'm' || t.n > 2) return;
      const prev = dt[k - 1], next = dt[k + 1];
      if ((prev && (prev.c === 'h')) || (next && (next.c === 's'))) t.c = 'M';
    });
    S.hasAmPm = toks.some((t) => t.k === 'ampm');
    return S;
  }

  function roundTo(x, dec) {
    if (!Number.isFinite(x)) return x;
    if (Math.abs(x) >= 1e21) return x;
    const p = x.toPrecision(15);
    return Number(Math.round(Number(p + 'e' + dec)) + 'e-' + dec);
  }
  function fixed(x, dec) {
    const r = roundTo(x, dec);
    let s = Math.abs(r) >= 1e21 ? r.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: dec }) : r.toFixed(dec);
    return s;
  }

  function fmtGeneral(v, loc) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    let s;
    if (a >= 1e11 || a < 1e-9) {
      const [m, e] = v.toExponential(5).split('e');
      s = m.replace(/\.?0+$/, '') + 'E' + (e[0] === '-' ? '-' : '+') + e.replace(/^[+-]/, '').padStart(2, '0');
    } else {
      const d = Math.floor(Math.log10(a)) + 1;
      const dec = clamp(10 - Math.max(d, 1), 0, 10);
      s = fixed(v, dec);
      if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
      if (s === '-0') s = '0';
    }
    return s.replace('.', loc.dec);
  }

  function fmtDate(v, S, loc) {
    const hasFs = S.toks.find((t) => t.k === 'fs');
    const fsN = hasFs ? hasFs.n : 0;
    const unit = 86400 * Math.pow(10, fsN);
    const tick = Math.round(v * unit);
    let days = Math.floor(tick / unit);
    const rem = tick - days * unit;
    const secTot = Math.floor(rem / Math.pow(10, fsN));
    const frac = rem - secTot * Math.pow(10, fsN);
    let Y, Mo, D, wd;
    if (days === 60) { Y = 1900; Mo = 1; D = 29; wd = 3; }
    else {
      const base = days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
      const dt = new Date(base + days * 864e5);
      Y = dt.getUTCFullYear(); Mo = dt.getUTCMonth(); D = dt.getUTCDate(); wd = dt.getUTCDay();
      if (days === 0) { Y = 1900; Mo = 0; D = 0; }
    }
    const H = Math.floor(secTot / 3600), Mi = Math.floor((secTot % 3600) / 60), Se = secTot % 60;
    const pad = (n, l) => String(n).padStart(l, '0');
    let out = '';
    for (const t of S.toks) {
      if (t.k === 'lit') out += t.s;
      else if (t.k === 'd') {
        switch (t.c) {
          case 'y': out += t.n <= 2 ? pad(Y % 100, 2) : pad(Y, 4); break;
          case 'm': out += t.n === 1 ? Mo + 1 : t.n === 2 ? pad(Mo + 1, 2) : t.n === 3 ? loc.mon[Mo] : t.n === 5 ? loc.months[Mo][0] : loc.months[Mo]; break;
          case 'M': out += t.n === 1 ? Mi : pad(Mi, 2); break;
          case 'd': out += t.n === 1 ? D : t.n === 2 ? pad(D, 2) : t.n === 3 ? loc.dy[wd] : loc.days[wd]; break;
          case 'h': { let h = H; if (S.hasAmPm) h = h % 12 || 12; out += t.n === 1 ? h : pad(h, 2); break; }
          case 's': out += t.n === 1 ? Se : pad(Se, 2); break;
          default: break;
        }
      } else if (t.k === 'el') {
        const tot = v * 24;
        const n = t.c === 'h' ? Math.floor(roundTo(tot, 9)) : t.c === 'm' ? Math.floor(roundTo(tot * 60, 7)) : Math.round(tot * 3600);
        out += pad(n, t.n);
      } else if (t.k === 'fs') out += loc.dec + pad(frac, t.n);
      else if (t.k === 'ampm') {
        const pm = H >= 12;
        out += t.s.length > 3 ? (pm ? 'PM' : 'AM') : t.s[0] === 'a' ? (pm ? 'p' : 'a') : (pm ? 'P' : 'A');
      } else if (t.k === 'ph' || t.k === 'dot' || t.k === 'comma' || t.k === 'slash') out += t.k === 'ph' ? t.c : t.k === 'dot' ? '.' : t.k === 'comma' ? ',' : '/';
    }
    return out;
  }

  function bestFraction(x, maxDen) {
    let best = [Math.round(x), 1], err = Math.abs(x - best[0]);
    for (let d = 1; d <= maxDen; d++) {
      const n = Math.round(x * d), e = Math.abs(x - n / d);
      if (e < err - 1e-12) { best = [n, d]; err = e; if (e < 1e-12) break; }
    }
    return best;
  }

  /** Format angka (bukan tanggal). x ≥ 0 bila section menangani tanda sendiri. */
  function fmtNumber(x, S, loc) {
    const T = S.toks;
    const pcts = T.filter((t) => t.k === 'pct').length;
    if (pcts) x *= Math.pow(100, pcts);
    const numIdx = T.map((t, i) => (['ph', 'dot', 'comma', 'exp', 'slash'].includes(t.k) ? i : -1)).filter((i) => i >= 0);
    if (!numIdx.length) {
      // Tidak ada placeholder angka: tampilkan literal saja (mis. "-" pada section nol)
      let t = '', fill = -1;
      for (const k of T) { if (k.k === 'lit') t += k.s; else if (k.k === 'pct') t += '%'; else if (k.k === 'fill') fill = t.length; }
      return { t, fill };
    }
    const first = numIdx[0], last = numIdx[numIdx.length - 1];
    let num = '';
    const expI = T.findIndex((t) => t.k === 'exp');
    const slashI = T.findIndex((t) => t.k === 'slash');
    if (slashI >= 0) {
      // Pecahan: [bilangan bulat] pembilang/penyebut
      const before = T.slice(first, slashI), after = T.slice(slashI + 1, last + 1);
      const denPh = after.filter((t) => t.k === 'ph').length;
      const fixedDen = T.slice(slashI + 1).find((t) => t.k === 'lit' && /^\s*\d+/.test(t.s));
      const groups = [];
      let g = null;
      for (const t of before) { if (t.k === 'ph') { if (!g) groups.push((g = [])); g.push(t); } else g = null; }
      const hasWhole = groups.length > 1 || (groups.length === 1 && before.some((t) => t.k === 'lit'));
      const whole = hasWhole ? Math.floor(x) : 0;
      const fr = x - whole;
      let n, d;
      if (fixedDen && !denPh) { d = parseInt(fixedDen.s, 10) || 1; n = Math.round(fr * d); }
      else [n, d] = bestFraction(fr, Math.pow(10, Math.max(1, denPh)) - 1);
      if (hasWhole) num = (n === 0 ? String(whole) : (whole ? whole + ' ' : '') + n + '/' + d);
      else num = n + '/' + d;
      const pre = T.slice(0, first).filter((t) => t.k === 'lit').map((t) => t.s).join('');
      const post = T.slice(last + 1).filter((t) => t.k === 'lit' && !(fixedDen && t === fixedDen)).map((t) => t.s).join('');
      return { t: pre + num + post, fill: -1 };
    }
    const dotI = T.findIndex((t, i) => t.k === 'dot' && i >= first && (expI < 0 || i < expI));
    const intEnd = dotI >= 0 ? dotI : expI >= 0 ? expI : last + 1;
    const intToks = T.slice(first, intEnd);
    const decEnd = expI >= 0 ? expI : last + 1;
    const decToks = dotI >= 0 ? T.slice(dotI + 1, decEnd).filter((t) => t.k === 'ph') : [];
    // Koma di akhir bagian bulat = pembagi 1000
    let scaleCommas = 0;
    for (let i = intToks.length - 1; i >= 0 && intToks[i].k === 'comma'; i--) scaleCommas++;
    if (dotI < 0 && expI < 0) { for (let i = last + 1; i < T.length && T[i].k === 'comma'; i++) scaleCommas++; }
    const intPh = intToks.filter((t) => t.k === 'ph');
    const group = intToks.slice(0, intToks.length - scaleCommas).some((t) => t.k === 'comma');
    if (scaleCommas) x /= Math.pow(1000, scaleCommas);
    const dec = decToks.length;
    if (expI >= 0) {
      const expDigits = T.slice(expI + 1).filter((t) => t.k === 'ph').length || 1;
      let e = x === 0 ? 0 : Math.floor(Math.log10(x));
      const ip = Math.max(1, intPh.length);
      if (ip > 1 && intPh.some((t) => t.c === '#')) e = Math.floor(e / ip) * ip;
      let m = x === 0 ? 0 : x / Math.pow(10, e);
      if (roundTo(m, dec) >= Math.pow(10, ip > 1 && intPh.some((t) => t.c === '#') ? ip : 1)) { m /= 10; e += 1; }
      let ms = fixed(m, dec).replace('.', loc.dec);
      num = ms + 'E' + (e < 0 ? '-' : T[expI].s === '+' ? '+' : '') + String(Math.abs(e)).padStart(expDigits, '0');
    } else {
      let s = fixed(x, dec);
      let [ip, fp = ''] = s.split('.');
      // Bagian desimal
      let fo = '';
      if (dec) {
        const chars = fp.split('');
        for (let k = dec - 1; k >= 0; k--) {
          const ph = decToks[k].c;
          if (chars[k] !== '0' || ph === '0') break;
          chars[k] = ph === '?' ? ' ' : '';
        }
        fo = chars.join('');
      }
      const minInt = intPh.filter((t) => t.c === '0').length;
      const qInt = intPh.filter((t) => t.c === '?').length;
      if (ip === '0' && minInt === 0) ip = '';
      ip = ip.padStart(minInt, '0');
      if (qInt && ip.length < minInt + qInt) ip = ip.padStart(minInt + qInt, ' ');
      const intLits = intToks.filter((t) => t.k === 'lit');
      if (group) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, loc.grp);
      else if (intLits.length) {
        // Literal di tengah placeholder (mis. 000-000): isi digit dari kanan
        let digits = ip, out = '';
        const phs = intToks.filter((t) => t.k === 'ph' || t.k === 'lit');
        let phLeft = intPh.length;
        for (let k = phs.length - 1; k >= 0; k--) {
          const t = phs[k];
          if (t.k === 'lit') { out = t.s + out; continue; }
          phLeft--;
          if (phLeft === 0) { out = digits + out; digits = ''; }
          else { out = (digits.slice(-1) || (t.c === '0' ? '0' : t.c === '?' ? ' ' : '')) + out; digits = digits.slice(0, -1); }
        }
        ip = out;
      }
      num = ip + (dotI >= 0 ? loc.dec + fo : '');
    }
    let t = '', fill = -1;
    for (let i = 0; i < T.length; i++) {
      const k = T[i];
      if (i === first) t += num;
      if (i >= first && i <= last) continue;
      if (k.k === 'lit') t += k.s;
      else if (k.k === 'pct') t += '%';
      else if (k.k === 'fill') fill = t.length;
    }
    return { t, fill };
  }

  const fmtCache = new Map();
  function compileFmt(code) {
    if (fmtCache.has(code)) return fmtCache.get(code);
    const secs = splitSections(code).map(tokenize);
    fmtCache.set(code, secs);
    return secs;
  }
  function testCond(c, v) {
    switch (c.op) {
      case '<': return v < c.v; case '>': return v > c.v; case '<=': return v <= c.v; case '>=': return v >= c.v;
      case '=': return v === c.v; case '<>': return v !== c.v; default: return false;
    }
  }
  /** Hasil: { t: teks, color, fill: posisi isian "*" atau -1 } */
  function formatValue(v, code, locKey) {
    if (typeof v !== 'number') {
      const s = String(v ?? '');
      if (!code || code === 'General' || code === '@') return { t: s };
      const secs = compileFmt(code);
      const ts = secs.length >= 4 ? secs[3] : secs.find((x) => x.text);
      if (!ts) return { t: s };
      let t = '', fill = -1;
      for (const k of ts.toks) { if (k.k === 'lit') t += k.s; else if (k.k === 'at') t += s; else if (k.k === 'fill') fill = t.length; }
      return { t, color: ts.color, fill };
    }
    if (!code) code = 'General';
    let lk = locKey;
    if (code === '@D14' || code === '@D22') code = LOC[lk][code === '@D14' ? 'd14' : 'd22'];
    const secs = compileFmt(code);
    let S, neg = false;
    const numSecs = secs.length >= 4 ? secs.slice(0, 3) : secs.filter((x, i) => !(x.text && i > 0 && !x.toks.some((t) => t.k === 'ph')));
    if (secs[0].cond || (numSecs[1] && numSecs[1].cond)) {
      if (secs[0].cond && testCond(secs[0].cond, v)) S = secs[0];
      else if (numSecs[1] && (!numSecs[1].cond || testCond(numSecs[1].cond, v))) S = numSecs[1];
      else S = numSecs[2] || numSecs[1] || secs[0];
      neg = v < 0 && !(S === numSecs[1] && !S.cond);
      if (S === numSecs[1] && numSecs[1].cond) neg = false;
    } else if (numSecs.length === 1 || v > 0 || (v === 0 && numSecs.length === 2)) { S = numSecs[0]; neg = v < 0; }
    else if (v < 0) S = numSecs[1];
    else S = numSecs[2];
    if (S.lang) lk = S.lang;
    const loc = LOC[lk];
    if (S.special) S = tokenize(loc[S.special]);
    const a = Math.abs(v);
    let r;
    if (S.general || (S.text && !S.toks.some((t) => t.k === 'ph'))) {
      if (!S.general) return { t: (v < 0 ? '-' : '') + fmtGeneral(a, loc) };
      const g = fmtGeneral(a, loc);
      let t = '';
      for (const k of S.toks) { if (k.k === 'lit') t += k.s; else if (k.k === 'gen') t += g; }
      r = { t, fill: -1 };
    } else if (S.date) {
      if (v < 0 || v > 2958465) return { t: '#'.repeat(6) };
      r = { t: fmtDate(v, S, loc), fill: -1 };
      neg = false;
    } else r = fmtNumber(a, S, loc);
    if (neg && /[1-9]/.test(r.t)) r.t = '-' + r.t;
    if (neg && r.fill >= 0) r.fill++;
    r.color = S.color;
    return r;
  }

  // ==========================================================
  // EXCEL — membaca XLSX
  // ==========================================================
  const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
    '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
    '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
    '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];
  const DEFAULT_THEME = { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' };

  function themeColorsOf(themeXml) {
    const out = {};
    for (const [k, v] of Object.entries(DEFAULT_THEME)) out[k] = hexColor(v);
    const cs = at(themeXml, 'themeElements', 'clrScheme');
    for (const e of kids(cs)) {
      const c = kid(e, 'srgbClr'), s = kid(e, 'sysClr');
      const h = c ? attr(c, 'val') : s ? attr(s, 'lastClr') || (attr(s, 'val') === 'window' ? 'FFFFFF' : '000000') : null;
      if (h && hexColor(h)) out[e.localName] = hexColor(h);
    }
    return out;
  }
  function xlTint(c, tint) {
    if (!tint) return c;
    const hsl = rgb2hsl(c);
    hsl.l = tint < 0 ? hsl.l * (1 + tint) : hsl.l * (1 - tint) + tint;
    return hsl2rgb(hsl);
  }
  function xlColor(el, theme) {
    if (!el || bAttr(el, 'auto')) return null;
    let c = null;
    const rgbA = attr(el, 'rgb'), th = attr(el, 'theme'), ix = attr(el, 'indexed');
    if (rgbA) c = hexColor(rgbA);
    else if (th != null) {
      const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
      c = theme[order[+th]] || null;
    } else if (ix != null) {
      const i = +ix;
      c = i === 64 ? null : i === 65 ? hexColor('FFFFFF') : INDEXED[i] ? hexColor(INDEXED[i]) : null;
    }
    if (c) c = xlTint(c, nAttr(el, 'tint', 0));
    return c;
  }
  const siText = (si) => {
    if (!si) return '';
    const t = kid(si, 't');
    let s = t ? t.textContent : kids(si, 'r').map((r) => (kid(r, 't') ? kid(r, 't').textContent : '')).join('');
    return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  };

  function parseStyles(x, theme) {
    const numFmts = {};
    for (const f of kids(at(x, 'numFmts'), 'numFmt')) numFmts[attr(f, 'numFmtId')] = attr(f, 'formatCode') || 'General';
    const flag = (e) => !!e && attr(e, 'val') !== '0' && attr(e, 'val') !== 'false';
    const fonts = kids(at(x, 'fonts'), 'font').map((f) => ({
      name: attr(kid(f, 'name'), 'val', 'Calibri'), sz: nAttr(kid(f, 'sz'), 'val', 11),
      b: flag(kid(f, 'b')), i: flag(kid(f, 'i')), u: !!kid(f, 'u') && attr(kid(f, 'u'), 'val') !== 'none', strike: flag(kid(f, 'strike')),
      color: xlColor(kid(f, 'color'), theme), va: attr(kid(f, 'vertAlign'), 'val'),
    }));
    if (!fonts.length) fonts.push({ name: 'Calibri', sz: 11 });
    const PAT = { solid: 1, darkGray: 0.75, mediumGray: 0.5, lightGray: 0.25, gray125: 0.125, gray0625: 0.0625 };
    const fills = kids(at(x, 'fills'), 'fill').map((f) => {
      const p = kid(f, 'patternFill');
      if (p) {
        const t = attr(p, 'patternType', kid(p, 'fgColor') ? 'solid' : 'none');
        if (t === 'none') return null;
        const fg = xlColor(kid(p, 'fgColor'), theme) || BLACK, bg = xlColor(kid(p, 'bgColor'), theme) || hexColor('FFFFFF');
        if (t === 'solid') return fg;
        return mix(fg, bg, PAT[t] ?? 0.5);
      }
      const g = kid(f, 'gradientFill');
      if (g) { const st = kids(g, 'stop'); if (st.length) return xlColor(kid(st[0], 'color'), theme); }
      return null;
    });
    const side = (e) => {
      const s = attr(e, 'style');
      if (!s || s === 'none') return null;
      return { s, c: xlColor(kid(e, 'color'), theme) || BLACK };
    };
    const borders = kids(at(x, 'borders'), 'border').map((b) => ({
      l: side(kid(b, 'left') || kid(b, 'start')), r: side(kid(b, 'right') || kid(b, 'end')), t: side(kid(b, 'top')), b: side(kid(b, 'bottom')),
    }));
    const xfs = kids(at(x, 'cellXfs'), 'xf').map((xf) => {
      const al = kid(xf, 'alignment');
      const id = nAttr(xf, 'numFmtId', 0);
      return {
        fmt: numFmts[id] ?? BUILTIN_FMT[id] ?? ((id >= 27 && id <= 36) || (id >= 50 && id <= 58) ? '@D14' : 'General'),
        font: fonts[nAttr(xf, 'fontId', 0)] || fonts[0], fill: fills[nAttr(xf, 'fillId', 0)] || null, border: borders[nAttr(xf, 'borderId', 0)] || null,
        h: attr(al, 'horizontal', 'general'), v: attr(al, 'vertical', 'bottom'), wrap: bAttr(al, 'wrapText'), indent: nAttr(al, 'indent', 0), shrink: bAttr(al, 'shrinkToFit'),
      };
    });
    if (!xfs.length) xfs.push({ fmt: 'General', font: fonts[0], fill: null, border: null, h: 'general', v: 'bottom' });
    return { xfs };
  }

  const colIndex = (letters) => { let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  function parseRef(ref) {
    const m = String(ref || '').replace(/\$/g, '').match(/^([A-Z]+)?(\d+)?$/i);
    if (!m) return null;
    return { c: m[1] ? colIndex(m[1]) : null, r: m[2] ? +m[2] - 1 : null };
  }
  function parseRange(ref) {
    const [a, b] = String(ref || '').replace(/^.*!/, '').split(':');
    const p = parseRef(a), q = parseRef(b || a);
    if (!p || !q) return null;
    return { r0: p.r ?? 0, c0: p.c ?? 0, r1: q.r ?? 1048575, c1: q.c ?? 16383 };
  }
  const key = (r, c) => r * 16384 + c;
  const PAPER_ID = { 1: 'Letter', 5: 'Legal', 8: 'A3', 9: 'A4', 11: 'A5', 13: 'B5', 14: 'F4', 34: 'B5' };

  async function readXlsx(file, opt, progress) {
    const pkg = await openZip(file, 'Excel');
    const root = await pkg.rels('');
    const wbPath = (relOfType(root, 'officeDocument') || {}).target || 'xl/workbook.xml';
    const wb = await pkg.xml(wbPath);
    if (!wb || wb.localName !== 'workbook') throw userErr(`"${file.name}" tidak dapat dibaca sebagai file Excel (.xlsx).`);
    const wbRels = await pkg.rels(wbPath);
    const date1904 = bAttr(at(wb, 'workbookPr'), 'date1904');
    const activeTab = nAttr(at(wb, 'bookViews', 'workbookView'), 'activeTab', 0);
    const themeRel = relOfType(wbRels, 'theme');
    const theme = themeColorsOf(themeRel ? await pkg.xml(themeRel.target) : null);
    const ssRel = relOfType(wbRels, 'sharedStrings');
    const strings = ssRel ? kids(await pkg.xml(ssRel.target), 'si').map(siText) : [];
    const stRel = relOfType(wbRels, 'styles');
    const styles = parseStyles(stRel ? await pkg.xml(stRel.target) : null, theme);
    const names = kids(at(wb, 'definedNames'), 'definedName').map((d) => ({ name: attr(d, 'name'), sheet: nAttr(d, 'localSheetId', -1), text: d.textContent }));
    const list = kids(at(wb, 'sheets'), 'sheet').map((s, i) => ({ name: attr(s, 'name') || `Sheet${i + 1}`, state: attr(s, 'state') || 'visible', rel: wbRels[rid(s, 'id')], index: i }));
    let pick = list.filter((s) => s.state === 'visible' && s.rel);
    if (opt.sheets === 'active') pick = pick.filter((s) => s.index === activeTab).concat(pick).slice(0, 1);
    const sheets = [];
    for (let k = 0; k < pick.length; k++) {
      progress && progress(`Membaca sheet "${pick[k].name}"…`, k / pick.length);
      const sh = await readSheet(pkg, pick[k], { strings, styles, date1904, names, theme });
      if (sh) sheets.push(sh);
    }
    return sheets;
  }

  async function readSheet(pkg, info, W) {
    const path = info.rel.target;
    const x = await pkg.xml(path);
    if (!x || x.localName !== 'worksheet') return null;
    const fp = at(x, 'sheetFormatPr');
    const defRowH = nAttr(fp, 'defaultRowHeight', 15);
    const defColPx = fp && attr(fp, 'defaultColWidth') ? Math.trunc(nAttr(fp, 'defaultColWidth') * 7 + 0.49) : fp && attr(fp, 'baseColWidth') ? Math.trunc(nAttr(fp, 'baseColWidth') * 7 + 5 + 3) : 64;
    const colDefs = kids(at(x, 'cols'), 'col').map((c) => ({
      min: nAttr(c, 'min', 1) - 1, max: Math.min(16383, nAttr(c, 'max', 1) - 1),
      w: attr(c, 'width') != null ? Math.trunc(nAttr(c, 'width', 8.43) * 7 + 0.49) * 0.75 : defColPx * 0.75,
      hidden: bAttr(c, 'hidden') || nAttr(c, 'width', 1) === 0,
    }));
    const colW = (c) => {
      for (const d of colDefs) if (c >= d.min && c <= d.max) return d.hidden ? 0 : d.w;
      return defColPx * 0.75;
    };
    const rowInfo = new Map();
    const cells = new Map();
    let r1 = -1, c1 = -1, r0 = Infinity, c0 = Infinity;
    const xfs = W.styles.xfs;
    const touch = (r, c) => { if (r > r1) r1 = r; if (c > c1) c1 = c; if (r < r0) r0 = r; if (c < c0) c0 = c; };
    let lastRow = -1;
    for (const row of kids(at(x, 'sheetData'), 'row')) {
      const r = attr(row, 'r') ? +attr(row, 'r') - 1 : lastRow + 1;
      lastRow = r;
      const ri = { h: attr(row, 'ht') != null ? nAttr(row, 'ht', defRowH) : null, hidden: bAttr(row, 'hidden') };
      rowInfo.set(r, ri);
      let lastCol = -1;
      for (const cEl of kids(row, 'c')) {
        const ref = attr(cEl, 'r');
        const c = ref ? (parseRef(ref) || {}).c ?? lastCol + 1 : lastCol + 1;
        lastCol = c;
        const st = xfs[nAttr(cEl, 's', 0)] || xfs[0];
        const t = attr(cEl, 't', 'n');
        const vEl = kid(cEl, 'v');
        let v = null;
        if (t === 's') v = vEl ? W.strings[+vEl.textContent] ?? '' : null;
        else if (t === 'inlineStr') v = siText(kid(cEl, 'is'));
        else if (t === 'str') v = vEl ? vEl.textContent : null;
        else if (t === 'b') v = vEl ? (vEl.textContent === '1' ? 'TRUE' : 'FALSE') : null;
        else if (t === 'e') v = vEl ? vEl.textContent : null;
        else if (t === 'd') { if (vEl) { const d = new Date(vEl.textContent); v = Number.isNaN(d.getTime()) ? vEl.textContent : (d.getTime() - Date.UTC(1899, 11, 30)) / 864e5; } }
        else if (vEl && vEl.textContent !== '') { v = +vEl.textContent; if (!Number.isFinite(v)) v = vEl.textContent; }
        const hasLook = st.fill || (st.border && (st.border.l || st.border.r || st.border.t || st.border.b));
        if (v == null || v === '') { if (!hasLook) continue; v = null; }
        if (typeof v === 'number' && W.date1904 && /[ymdhs]/i.test(st.fmt.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) v += 1462;
        cells.set(key(r, c), { v, st, type: t, num: typeof v === 'number', bool: t === 'b', err: t === 'e' });
        touch(r, c);
      }
    }
    const merges = kids(at(x, 'mergeCells'), 'mergeCell').map((m) => parseRange(attr(m, 'ref'))).filter(Boolean);
    for (const m of merges) { if (m.r1 < 100000 && m.c1 < 2000) { touch(m.r0, m.c0); touch(m.r1, m.c1); } }
    // Pengaturan cetak
    const ps = at(x, 'pageSetup'), pm = at(x, 'pageMargins'), po = at(x, 'printOptions');
    const fitToPage = bAttr(at(x, 'sheetPr', 'pageSetUpPr'), 'fitToPage');
    const page = {
      paper: PAPER_ID[nAttr(ps, 'paperSize', 9)] || 'A4', orient: attr(ps, 'orientation') === 'landscape' ? 'landscape' : attr(ps, 'orientation') === 'portrait' ? 'portrait' : null,
      scale: nAttr(ps, 'scale', 100), fit: fitToPage, fitW: nAttr(ps, 'fitToWidth', 1), fitH: nAttr(ps, 'fitToHeight', 1),
      m: pm ? { l: nAttr(pm, 'left', 0.7) * 72, r: nAttr(pm, 'right', 0.7) * 72, t: nAttr(pm, 'top', 0.75) * 72, b: nAttr(pm, 'bottom', 0.75) * 72 } : { l: 50.4, r: 50.4, t: 54, b: 54 },
      grid: bAttr(po, 'gridLines'), hCenter: bAttr(po, 'horizontalCentered'), vCenter: bAttr(po, 'verticalCentered'),
      rowBreaks: new Set(kids(at(x, 'rowBreaks'), 'brk').map((b) => nAttr(b, 'id', 0))), colBreaks: new Set(kids(at(x, 'colBreaks'), 'brk').map((b) => nAttr(b, 'id', 0))),
    };
    // Area cetak & judul yang diulang
    let area = null, titleRows = null;
    for (const d of W.names) {
      if (d.sheet !== info.index) continue;
      if (d.name === '_xlnm.Print_Area') area = parseRange(d.text.split(',')[0]);
      if (d.name === '_xlnm.Print_Titles') {
        for (const part of d.text.split(',')) {
          const m = part.replace(/^.*!/, '').replace(/\$/g, '').match(/^(\d+):(\d+)$/);
          if (m) titleRows = [+m[1] - 1, +m[2] - 1];
        }
      }
    }
    // Gambar (drawing)
    const images = [];
    const drawingEl = at(x, 'drawing');
    if (drawingEl) {
      try {
        const rels = await pkg.rels(path);
        const dr = rels[rid(drawingEl, 'id')];
        if (dr) {
          const dx = await pkg.xml(dr.target), drels = await pkg.rels(dr.target);
          for (const anc of kids(dx)) {
            const pic = desc(anc, 'pic')[0];
            if (!pic) continue;
            const blip = desc(pic, 'blip')[0];
            const im = blip && drels[rid(blip, 'embed')];
            if (!im) continue;
            const bytes = await pkg.bytes(im.target);
            if (!bytes) continue;
            const pt = (el) => ({ c: +(kid(el, 'col') || {}).textContent || 0, co: (+(kid(el, 'colOff') || {}).textContent || 0) / EMU, r: +(kid(el, 'row') || {}).textContent || 0, ro: (+(kid(el, 'rowOff') || {}).textContent || 0) / EMU });
            const ext = kid(anc, 'ext');
            const it = { bytes };
            if (anc.localName === 'twoCellAnchor') { it.from = pt(kid(anc, 'from')); it.to = pt(kid(anc, 'to')); }
            else if (anc.localName === 'oneCellAnchor') { it.from = pt(kid(anc, 'from')); it.w = nAttr(ext, 'cx', 0) / EMU; it.h = nAttr(ext, 'cy', 0) / EMU; }
            else if (anc.localName === 'absoluteAnchor') { const p = kid(anc, 'pos'); it.abs = { x: nAttr(p, 'x', 0) / EMU, y: nAttr(p, 'y', 0) / EMU }; it.w = nAttr(ext, 'cx', 0) / EMU; it.h = nAttr(ext, 'cy', 0) / EMU; }
            else continue;
            if (it.from) { touch(it.from.r, it.from.c); if (it.to) touch(it.to.r, it.to.c); }
            images.push(it);
          }
        }
      } catch (e) { console.warn('Gambar sheet dilewati', e); }
    }
    if (r1 < 0) return null;
    return {
      name: info.name, cells, merges, images, page, titleRows,
      area: area ? { r0: area.r0, c0: area.c0, r1: Math.min(area.r1, r1), c1: Math.min(area.c1, c1) } : { r0, c0, r1, c1 },
      colW, rowH: (r) => { const ri = rowInfo.get(r); if (ri && ri.hidden) return 0; return ri && ri.h != null ? ri.h : null; }, defRowH,
      fontScale: 1, csv: false,
    };
  }

  // ==========================================================
  // CSV
  // ==========================================================
  function decodeText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
    catch (_) { return new TextDecoder('windows-1252').decode(bytes); }
  }
  function detectDelimiter(text) {
    const m = text.match(/^sep=(.)\r?\n/);
    if (m) return { d: m[1], skip: m[0].length };
    const lines = [];
    let q = false, cur = '';
    for (let i = 0; i < text.length && lines.length < 30; i++) {
      const ch = text[i];
      if (ch === '"') q = !q;
      if (!q && (ch === '\n' || ch === '\r')) { if (cur) lines.push(cur); cur = ''; } else if (!q) cur += ch;
    }
    if (cur) lines.push(cur);
    let best = ',', score = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map((l) => l.split(d).length - 1);
      const min = Math.min(...counts), avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
      const s = min > 0 ? min * 10 + avg : avg;
      if (s > score) { score = s; best = d; }
    }
    return { d: best, skip: 0 };
  }
  function parseCsv(text, d) {
    const rows = [];
    let row = [], f = '', q = false, i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
        f += ch; i++; continue;
      }
      if (ch === '"' && f === '') { q = true; i++; continue; }
      if (ch === d) { row.push(f); f = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        row.push(f); rows.push(row); row = []; f = '';
        if (ch === '\r' && text[i + 1] === '\n') i++;
        i++; continue;
      }
      f += ch; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop();
    return rows;
  }
  async function readCsv(file, opt) {
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    const isTsv = /\.tsv$/i.test(file.name);
    const det = isTsv ? { d: '\t', skip: 0 } : detectDelimiter(text);
    const rows = parseCsv(text.slice(det.skip), det.d);
    if (!rows.length) throw userErr(`"${file.name}" kosong.`);
    const header = opt.header !== false;
    const base = { name: 'Arial', sz: 10, b: false, color: null };
    const headFont = { ...base, b: true };
    const headFill = hexColor('E8EDF5');
    const numRe = /^\s*[-+(]?\s*(Rp\.?\s*|\$\s*)?(\d{1,3}([.,\s]\d{3})+|\d+)([.,]\d+)?\s*%?\)?\s*$/i;
    const cells = new Map();
    let c1 = 0;
    rows.forEach((row, r) => row.forEach((v, c) => {
      if (v === '') return;
      if (c > c1) c1 = c;
      const isHead = header && r === 0;
      const num = !isHead && numRe.test(v);
      cells.set(key(r, c), { v, st: { fmt: '@', font: isHead ? headFont : base, fill: isHead ? headFill : null, border: null, h: num ? 'right' : 'general', v: 'center', wrap: true }, num: false, csvNum: num });
    }));
    // Lebar kolom otomatis dari isi
    const doc = await PL().PDFDocument.create();
    const H = await doc.embedFont(PL().StandardFonts.Helvetica), HB = await doc.embedFont(PL().StandardFonts.HelveticaBold);
    const widths = [];
    for (let c = 0; c <= c1; c++) {
      let w = 24;
      for (let r = 0; r < rows.length && r < 2000; r++) {
        const v = rows[r][c];
        if (!v) continue;
        const f = header && r === 0 ? HB : H;
        const longest = v.split(/\r?\n/).reduce((m, s) => Math.max(m, f.widthOfTextAtSize(winAnsi(s), 10)), 0);
        if (longest > w) w = longest;
      }
      widths.push(Math.min(w + 8, 230));
    }
    return [{
      name: file.name, cells, merges: [], images: [], titleRows: header ? [0, 0] : null,
      area: { r0: 0, c0: 0, r1: rows.length - 1, c1 },
      page: { paper: 'A4', orient: null, scale: 100, fit: false, m: { l: 15 * MM, r: 15 * MM, t: 15 * MM, b: 15 * MM }, grid: true, rowBreaks: new Set(), colBreaks: new Set() },
      colW: (c) => widths[c] ?? 48, rowH: () => null, defRowH: 16, fontScale: 1, csv: true,
    }];
  }

  // ==========================================================
  // EXCEL/CSV → PDF (vektor)
  // ==========================================================
  const PAPER = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A5: [419.53, 595.28], B5: [498.9, 708.66], F4: [609.45, 935.43], Letter: [612, 792], Legal: [612, 1008] };
  const BORDER_W = { hair: 0.25, thin: 0.5, dotted: 0.5, dashed: 0.5, dashDot: 0.5, dashDotDot: 0.5, slantDashDot: 1, medium: 1.1, mediumDashed: 1.1, mediumDashDot: 1.1, mediumDashDotDot: 1.1, thick: 1.6, double: 1.4 };
  const BORDER_DASH = { dotted: [0.6, 1.2], dashed: [3, 1.5], mediumDashed: [4, 2], dashDot: [3, 1.5, 0.8, 1.5], mediumDashDot: [4, 2, 1, 2], dashDotDot: [3, 1, 1, 1, 1, 1], mediumDashDotDot: [4, 1.5, 1, 1.5, 1, 1.5], hair: [0.5, 0.5] };

  class FontKit {
    constructor(doc) { this.doc = doc; this.cache = {}; }
    async get(f) {
      const L = PL(), n = String(f.name || '');
      const fam = /times|cambria|georgia|garamond|book antiqua|palatino|serif|constantia/i.test(n) && !/sans/i.test(n) ? 'T' : /courier|consolas|mono|lucida console/i.test(n) ? 'C' : 'H';
      const k = fam + (f.b ? 'B' : '') + (f.i ? 'I' : '');
      if (!this.cache[k]) {
        const SF = L.StandardFonts;
        const name = { H: 'Helvetica', HB: 'HelveticaBold', HI: 'HelveticaOblique', HBI: 'HelveticaBoldOblique', T: 'TimesRoman', TB: 'TimesRomanBold', TI: 'TimesRomanItalic', TBI: 'TimesRomanBoldItalic', C: 'Courier', CB: 'CourierBold', CI: 'CourierOblique', CBI: 'CourierBoldOblique' }[k];
        this.cache[k] = this.doc.embedFont(SF[name]);
      }
      const font = await this.cache[k];
      const scale = fam === 'H' && !/arial|helvetica|verdana|tahoma|liberation sans|arimo/i.test(n) ? 0.9 : 1;
      return { font, scale, fam, css: fam === 'T' ? '"Times New Roman", Times, serif' : fam === 'C' ? '"Courier New", monospace' : 'Arial, Helvetica, sans-serif' };
    }
  }

  /** Teks di luar WinAnsi (mis. huruf Yunani, simbol) digambar lewat canvas agar tidak berubah menjadi "?". */
  async function textImage(doc, cache, text, sizePt, fk, bold, italic, color) {
    const k = [text, sizePt, fk.css, bold, italic, color && css(color)].join('|');
    if (!cache.has(k)) {
      cache.set(k, (async () => {
        const S = 4;
        const c = document.createElement('canvas');
        const x = c.getContext('2d');
        const font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${sizePt * S}px ${fk.css}`;
        x.font = font;
        const w = Math.ceil(x.measureText(text).width) + 2;
        c.width = Math.max(1, w); c.height = Math.ceil(sizePt * S * 1.3);
        x.font = font;
        x.fillStyle = color ? css(color) : '#000';
        x.textBaseline = 'alphabetic';
        x.fillText(text, 1, sizePt * S * 1.02);
        return { img: await doc.embedPng(await canvasBytes(c, 'image/png')), w: c.width / S, h: c.height / S, base: sizePt * 1.02 };
      })());
    }
    return cache.get(k);
  }

  function computeLayout(sheet, opt) {
    const A = sheet.area;
    const cols = [], rows = [];
    for (let c = A.c0; c <= A.c1; c++) { const w = sheet.colW(c); if (w > 0) cols.push({ c, w }); }
    for (let r = A.r0; r <= A.r1; r++) {
      let h = sheet.rowH(r);
      if (h === 0) continue;
      rows.push({ r, h, auto: h == null });
    }
    return { cols, rows };
  }

  /** Tinggi baris otomatis (baris tanpa tinggi tersimpan): ikuti ukuran huruf & teks yang dibungkus. */
  function autoRowHeights(sheet, L, fontsInfo, measure) {
    const colWOf = new Map(L.cols.map((x) => [x.c, x.w]));
    for (const row of L.rows) {
      if (!row.auto) continue;
      let h = sheet.defRowH;
      for (const col of L.cols) {
        const cell = sheet.cells.get(key(row.r, col.c));
        if (!cell || cell.v == null) continue;
        const f = cell.st.font || {};
        const sz = (f.sz || 11) * sheet.fontScale;
        let lines = 1;
        if (cell.st.wrap && !cell.num) {
          const txt = String(cell.v), maxW = (colWOf.get(col.c) || 48) - 4;
          if (txt.length * sz > maxW || txt.includes('\n')) lines = measure(txt, f, sz, maxW);
        }
        h = Math.max(h, lines * sz * 1.22 + 3);
      }
      row.h = h;
    }
  }

  async function sheetsToPdf(sheets, opt, progress, doc) {
    const L = PL();
    const fk = new FontKit(doc);
    const imgCache = new Map(), txtImgCache = new Map();
    const loc = opt.locale === 'en' ? 'en' : 'id';
    // Pengukur cepat untuk tinggi baris otomatis
    const H = await fk.get({ name: 'Arial' });
    const measureLines = (txt, f, sz, maxW) => {
      let n = 0;
      for (const para of String(txt).split(/\r?\n/)) {
        const w = H.font.widthOfTextAtSize(winAnsi(para), sz) * (f.b ? 1.05 : 1);
        n += Math.max(1, Math.ceil(w / Math.max(10, maxW)));
      }
      return n;
    };
    let pagesMade = 0;
    for (let si = 0; si < sheets.length; si++) {
      const sh = sheets[si];
      progress && progress(`Menyusun "${sh.name}"…`, si / sheets.length);
      const Lay = computeLayout(sh, opt);
      if (!Lay.cols.length || !Lay.rows.length) continue;
      autoRowHeights(sh, Lay, null, measureLines);
      // Kertas & orientasi
      const paperKey = opt.paper && opt.paper !== 'auto' ? opt.paper : sh.page.paper;
      let [pw, ph] = PAPER[paperKey] || PAPER.A4;
      const totalW = Lay.cols.reduce((s, x) => s + x.w, 0);
      const totalH = Lay.rows.reduce((s, x) => s + x.h, 0);
      const m = sh.page.m;
      const fit = opt.fit || 'width';
      let orient = opt.orient && opt.orient !== 'auto' ? opt.orient : null;
      if (!orient) {
        if (fit === 'file' || fit === 'none') orient = sh.page.orient || 'portrait';
        else if (sh.page.orient === 'landscape') orient = 'landscape';
        else {
          // Otomatis: pilih mendatar bila tabel terlalu lebar untuk kertas tegak
          const sP = (pw - m.l - m.r) / totalW, sL = (ph - m.l - m.r) / totalW;
          orient = sP < 0.85 && sL > sP * 1.1 ? 'landscape' : 'portrait';
        }
      }
      if (orient === 'landscape') [pw, ph] = [ph, pw];
      const aw = pw - m.l - m.r, ah = ph - m.t - m.b;
      // Judul yang diulang
      const tr = sh.titleRows;
      const titleRows = tr ? Lay.rows.filter((x) => x.r >= tr[0] && x.r <= tr[1]) : [];
      const titleH = titleRows.reduce((s, x) => s + x.h, 0);
      // Skala
      let s = 1;
      if (fit === 'file') {
        if (sh.page.fit) {
          const sw = sh.page.fitW ? (sh.page.fitW * aw) / totalW : Infinity;
          const shh = sh.page.fitH ? (sh.page.fitH * ah) / totalH : Infinity;
          s = Math.min(1, sw, shh);
        } else s = clamp(sh.page.scale / 100, 0.1, 4);
      } else if (fit === 'width') s = Math.min(1, aw / totalW);
      else if (fit === 'page') s = Math.min(1, aw / totalW, ah / totalH);
      s = clamp(s, 0.1, 4);
      // Pembagian kolom & baris ke halaman
      const colGroups = [], rowGroups = [];
      let g = [], acc = 0;
      for (const col of Lay.cols) {
        if (g.length && (acc + col.w > aw / s + 0.01 || sh.page.colBreaks.has(col.c))) { colGroups.push(g); g = []; acc = 0; }
        g.push(col); acc += col.w;
      }
      if (g.length) colGroups.push(g);
      g = []; acc = 0;
      const bodyRows = Lay.rows;
      for (const row of bodyRows) {
        const isTitle = titleRows.includes(row);
        const lim = ah / s - (rowGroups.length && !isTitle ? titleH : 0) + 0.01;
        if (g.length && (acc + row.h > lim || sh.page.rowBreaks.has(row.r))) { rowGroups.push(g); g = []; acc = 0; }
        g.push(row); acc += row.h;
      }
      if (g.length) rowGroups.push(g);
      // Gabungan sel (merge)
      const mergeOf = new Map();
      for (const mg of sh.merges) {
        const area = (mg.r1 - mg.r0 + 1) * (mg.c1 - mg.c0 + 1);
        if (area > 200000) continue;
        for (let r = mg.r0; r <= mg.r1; r++) for (let c = mg.c0; c <= mg.c1; c++) mergeOf.set(key(r, c), mg);
      }
      const grid = opt.grid === 'on' ? true : opt.grid === 'off' ? false : sh.page.grid;
      for (const cg of colGroups) {
        for (let ri = 0; ri < rowGroups.length; ri++) {
          let rg = rowGroups[ri];
          if (ri > 0 && titleRows.length && !titleRows.includes(rg[0])) rg = titleRows.concat(rg);
          const page = doc.addPage([pw, ph]);
          pagesMade++;
          const y = yieldUI();
          if (y) { progress && progress(`Menyusun "${sh.name}" — halaman ${pagesMade}…`, si / sheets.length); await y; }
          await drawSheetPage(page, sh, cg, rg, s, { pw, ph, m, aw, ah, grid, loc, fk, mergeOf, imgCache, txtImgCache, doc });
        }
      }
    }
    return pagesMade;
  }

  async function drawSheetPage(page, sh, cols, rows, s, E) {
    const L = PL();
    const { pw, ph, m, fk, mergeOf, loc } = E;
    const cw = cols.reduce((a, x) => a + x.w, 0) * s, chh = rows.reduce((a, x) => a + x.h, 0) * s;
    const ox = m.l + (sh.page.hCenter ? Math.max(0, (E.aw - cw) / 2) : 0);
    const oy = m.t + (sh.page.vCenter ? Math.max(0, (E.ah - chh) / 2) : 0);
    const X = [], Y = [];
    let a = 0;
    cols.forEach((x, i) => { X[i] = a; a += x.w; }); X[cols.length] = a;
    a = 0;
    rows.forEach((x, i) => { Y[i] = a; a += x.h; }); Y[rows.length] = a;
    const ci = new Map(cols.map((x, i) => [x.c, i]));
    const rIdx = new Map(rows.map((x, i) => [x.r, i]));
    // Sel di koordinat halaman (y PDF ke atas)
    const px = (x) => ox + x * s;
    const py = (y) => ph - oy - y * s;
    const blocks = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < cols.length; j++) {
        const r = rows[i].r, c = cols[j].c;
        const mg = mergeOf.get(key(r, c));
        if (mg) {
          const id = mg.r0 + ':' + mg.c0;
          if (seen.has(id + ':' + i)) continue;
          // Blok merge: dari baris/kolom pertama yang tampil di halaman ini
          let i1 = i, j0 = j, j1 = j;
          while (i1 + 1 < rows.length && rows[i1 + 1].r <= mg.r1) i1++;
          while (j0 > 0 && cols[j0 - 1].c >= mg.c0) j0--;
          while (j1 + 1 < cols.length && cols[j1 + 1].c <= mg.c1) j1++;
          if (j0 !== j) continue;
          for (let k = i; k <= i1; k++) seen.add(id + ':' + k);
          const tl = sh.cells.get(key(mg.r0, mg.c0));
          const tlIn = rIdx.has(mg.r0) && ci.has(mg.c0);
          blocks.push({ i0: i, i1, j0, j1, cell: tl, showText: tlIn, mg,
            rc: sh.cells.get(key(mg.r0, mg.c1)), bc: sh.cells.get(key(mg.r1, mg.c0)) });
        } else {
          const cell = sh.cells.get(key(r, c));
          blocks.push({ i0: i, i1: i, j0: j, j1: j, cell, showText: true });
        }
      }
    }
    const rect = (b) => ({ x: X[b.j0], y: Y[b.i0], w: X[b.j1 + 1] - X[b.j0], h: Y[b.i1 + 1] - Y[b.i0] });
    // 1. Isi warna
    for (const b of blocks) {
      const st = b.cell && b.cell.st;
      if (!st || !st.fill) continue;
      const R = rect(b);
      page.drawRectangle({ x: px(R.x), y: py(R.y + R.h), width: R.w * s, height: R.h * s, color: pdfRgb(st.fill) });
    }
    // 2. Garis kisi
    if (E.grid && !blocks.some((b) => b.mg)) {
      const gc = L.rgb(0.75, 0.77, 0.8), th = 0.35;
      for (let i = 0; i <= rows.length; i++) page.drawLine({ start: { x: px(0), y: py(Y[i]) }, end: { x: px(X[cols.length]), y: py(Y[i]) }, thickness: th, color: gc });
      for (let j = 0; j <= cols.length; j++) page.drawLine({ start: { x: px(X[j]), y: py(0) }, end: { x: px(X[j]), y: py(Y[rows.length]) }, thickness: th, color: gc });
    } else if (E.grid) {
      const gc = L.rgb(0.75, 0.77, 0.8), th = 0.35;
      for (const b of blocks) {
        const R = rect(b);
        page.drawLine({ start: { x: px(R.x + R.w), y: py(R.y) }, end: { x: px(R.x + R.w), y: py(R.y + R.h) }, thickness: th, color: gc });
        page.drawLine({ start: { x: px(R.x), y: py(R.y + R.h) }, end: { x: px(R.x + R.w), y: py(R.y + R.h) }, thickness: th, color: gc });
        if (b.j0 === 0) page.drawLine({ start: { x: px(R.x), y: py(R.y) }, end: { x: px(R.x), y: py(R.y + R.h) }, thickness: th, color: gc });
        if (b.i0 === 0) page.drawLine({ start: { x: px(R.x), y: py(R.y) }, end: { x: px(R.x + R.w), y: py(R.y) }, thickness: th, color: gc });
      }
    }
    // 3. Bingkai sel
    const edge = (sd, x1, y1, x2, y2) => {
      if (!sd) return;
      const th = (BORDER_W[sd.s] || 0.5) * Math.max(0.6, Math.min(1, s * 1.2));
      const o = { thickness: th, color: pdfRgb(sd.c) };
      if (BORDER_DASH[sd.s]) o.dashArray = BORDER_DASH[sd.s];
      if (sd.s === 'double') {
        const d = th * 0.9, vert = x1 === x2;
        const o2 = { thickness: th * 0.4, color: o.color };
        page.drawLine({ start: { x: px(x1) - (vert ? d : 0), y: py(y1) + (vert ? 0 : d) }, end: { x: px(x2) - (vert ? d : 0), y: py(y2) + (vert ? 0 : d) }, ...o2 });
        page.drawLine({ start: { x: px(x1) + (vert ? d : 0), y: py(y1) - (vert ? 0 : d) }, end: { x: px(x2) + (vert ? d : 0), y: py(y2) - (vert ? 0 : d) }, ...o2 });
        return;
      }
      page.drawLine({ start: { x: px(x1), y: py(y1) }, end: { x: px(x2), y: py(y2) }, ...o });
    };
    for (const b of blocks) {
      const bd = b.cell && b.cell.st && b.cell.st.border;
      const rb = (b.rc && b.rc.st.border) || bd, bb = (b.bc && b.bc.st.border) || bd;
      if (!bd && !rb && !bb) continue;
      const R = rect(b);
      const topVisible = !b.mg || rows[b.i0].r === b.mg.r0;
      const botVisible = !b.mg || rows[b.i1].r === b.mg.r1;
      if (bd && topVisible) edge(bd.t, R.x, R.y, R.x + R.w, R.y);
      if (bd) edge(bd.l, R.x, R.y, R.x, R.y + R.h);
      if (rb && (!b.mg || cols[b.j1].c === b.mg.c1)) edge(rb.r, R.x + R.w, R.y, R.x + R.w, R.y + R.h);
      if (bb && botVisible) edge(bb.b, R.x, R.y + R.h, R.x + R.w, R.y + R.h);
    }
    // 4. Teks — operator PDF dikumpulkan lalu dikirim sekaligus (jauh lebih cepat untuk sheet besar)
    const isEmpty = (i, j) => {
      if (i < 0 || j < 0 || j >= cols.length) return false;
      const k = key(rows[i].r, cols[j].c);
      if (mergeOf.has(k)) return false;
      const c = sh.cells.get(k);
      return !c || c.v == null || c.v === '';
    };
    let ops = [];
    const flush = () => { for (let i = 0; i < ops.length; i += 5000) page.pushOperators(...ops.slice(i, i + 5000)); ops = []; };
    const fontKeys = new Map();
    const keyFor = (font) => { let k = fontKeys.get(font); if (!k) { k = page.node.newFontDictionary(font.name, font.ref); fontKeys.set(font, k); } return k; };
    let curColor = '';
    const setColor = (c) => { const k = c.r + ',' + c.g + ',' + c.b; if (k !== curColor) { ops.push(L.setFillingRgbColor(c.r / 255, c.g / 255, c.b / 255)); curColor = k; } };
    const emit = async (t, x, y, size, F, f, color) => {
      if (!t) return;
      if (isWinAnsi(t)) {
        setColor(color);
        ops.push(L.beginText(), L.setFontAndSize(keyFor(F.font), size), L.setTextMatrix(1, 0, 0, 1, x, y), L.showText(F.font.encodeText(t)), L.endText());
        return;
      }
      // Teks di luar WinAnsi (huruf Yunani, simbol, dll.) → digambar sebagai gambar kecil
      flush();
      const ti = await textImage(E.doc, E.txtImgCache, t, size, F, f.b, f.i, color);
      page.drawImage(ti.img, { x, y: y - (ti.h - ti.base), width: ti.w, height: ti.h });
    };
    for (const b of blocks) {
      const cell = b.cell;
      if (!cell || cell.v == null || !b.showText) continue;
      const st = cell.st;
      const fv = sh.csv ? { t: String(cell.v) } : formatValue(cell.v, st.fmt, loc);
      const text = cleanText(fv.t);
      if (!text.trim()) continue;
      const f = st.font || { sz: 11 };
      const F = await fk.get(f);
      let size = (f.sz || 11) * sh.fontScale * F.scale * (f.va === 'superscript' || f.va === 'subscript' ? 0.7 : 1);
      const color = fv.color || f.color || BLACK;
      const R = rect(b);
      const pad = 2 + (st.indent || 0) * 7.5;
      let h = st.h;
      const isNumLike = cell.num || cell.csvNum;
      if (h === 'general' || !h) h = cell.bool || cell.err ? 'center' : isNumLike ? 'right' : 'left';
      if (h === 'fill' || h === 'justify' || h === 'distributed') h = h === 'distributed' ? 'center' : 'left';
      const wrap = (st.wrap || st.h === 'justify' || st.h === 'distributed') && !cell.num;
      const ansiOk = isWinAnsi(text.replace(/\n/g, ''));
      const width = (t) => F.font.widthOfTextAtSize(winAnsi(t), size) * (ansiOk ? 1 : 1.05);
      const innerW = R.w - 2 * pad;
      // Batas atas lebar (tiap huruf ≤ 1 em): bila lolos, tidak perlu mengukur
      const quickFit = (t) => t.length * size <= innerW;
      let lines;
      if (wrap && (text.includes('\n') || !quickFit(text))) {
        lines = [];
        for (const para of text.split(/\r?\n/)) {
          const words = para.split(' ');
          let line = '';
          for (let w of words) {
            while (w && w.length > 1 && width(w) > innerW) {
              let k = w.length;
              while (k > 1 && width(w.slice(0, k)) > innerW) k--;
              if (line) { lines.push(line); line = ''; }
              lines.push(w.slice(0, k)); w = w.slice(k);
            }
            const t = line ? line + ' ' + w : w;
            if (!line || width(t) <= innerW) line = t; else { lines.push(line); line = w; }
          }
          lines.push(line);
        }
      } else {
        lines = text.split(/\r?\n/);
        if (lines.length > 1 && !st.wrap) lines = [lines.join(' ')];
        if ((isNumLike || st.shrink) && !quickFit(lines[0])) {
          const w0 = width(lines[0]);
          if (isNumLike && w0 > innerW && !sh.csv) size *= Math.max(0.55, innerW / w0);
          else if (st.shrink && w0 > innerW) size *= Math.max(0.4, innerW / w0);
        }
      }
      const lh = size * 1.18;
      const blockH = lines.length * lh;
      let y0;
      const v = st.v || 'bottom';
      if (v === 'top') y0 = R.y + 1.5;
      else if (v === 'center' || v === 'distributed' || v === 'justify') y0 = R.y + (R.h - blockH) / 2;
      else y0 = R.y + R.h - blockH - 1.2;
      // Teks yang tidak dibungkus boleh meluber ke sel kosong di sebelahnya
      let cx0 = R.x, cx1 = R.x + R.w;
      const fitsAll = lines.every(quickFit);
      const maxLineW = fitsAll ? 0 : Math.max(...lines.map(width));
      if (!wrap && !isNumLike && maxLineW > innerW && !b.mg) {
        if (h === 'left' || h === 'center') { let j = b.j1 + 1; while (cx1 - cx0 - 2 * pad < maxLineW && isEmpty(b.i0, j)) { cx1 = X[j + 1]; j++; } }
        if (h === 'right' || h === 'center') { let j = b.j0 - 1; while (cx1 - cx0 - 2 * pad < maxLineW && isEmpty(b.i0, j)) { cx0 = X[j]; j--; } }
      }
      const needClip = blockH > R.h + 0.5 || maxLineW > cx1 - cx0 - 2 * pad + 0.5;
      if (needClip) ops.push(L.pushGraphicsState(), L.rectangle(px(cx0), py(R.y + R.h), (cx1 - cx0) * s, R.h * s), L.clip(), L.endPath());
      const fontSize = size * s;
      const lineTh = Math.max(0.4, fontSize * 0.06);
      for (let li = 0; li < lines.length; li++) {
        const t = lines[li];
        if (!t) continue;
        const base = y0 + li * lh + size * 0.93;
        if (fv.fill > 0 && !wrap && lines.length === 1 && fv.fill < t.length) {
          // Format akuntansi: simbol mata uang di kiri, angka di kanan
          const left = t.slice(0, fv.fill).replace(/\s+$/, ''), right = t.slice(fv.fill).replace(/^\s+/, '');
          await emit(left, px(R.x + pad - 1), py(base), fontSize, F, f, color);
          await emit(right, px(R.x + R.w - pad - width(right)), py(base), fontSize, F, f, color);
          continue;
        }
        const tw = h === 'left' && !f.u && !f.strike ? 0 : width(t);
        const hx0 = h === 'center' && !wrap ? cx0 : R.x, hx1 = h === 'center' && !wrap ? cx1 : R.x + R.w;
        const x = h === 'right' ? hx1 - pad - tw : h === 'center' ? (hx0 + hx1) / 2 - tw / 2 : R.x + pad;
        await emit(ansiOk ? winAnsi(t) : t, px(x), py(base), fontSize, F, f, color);
        if (f.u || f.strike) {
          setColor(color);
          const yy = f.u ? py(base) - fontSize * 0.12 : py(base) + fontSize * 0.3;
          ops.push(L.rectangle(px(x), yy - lineTh / 2, tw * s, lineTh), L.fill());
        }
      }
      if (needClip) { ops.push(L.popGraphicsState()); curColor = ''; }
    }
    flush();
    // 5. Gambar
    for (const im of sh.images) {
      const pos = imagePos(sh, im, cols, rows, X, Y, ci, rIdx);
      if (!pos) continue;
      let emb = E.imgCache.get(im.bytes);
      if (emb === undefined) { emb = await embedAnyImage(E.doc, im.bytes).catch(() => null); E.imgCache.set(im.bytes, emb); }
      if (!emb) continue;
      page.pushOperators(L.pushGraphicsState(), L.rectangle(px(0), py(Y[rows.length]), X[cols.length] * s, Y[rows.length] * s), L.clip(), L.endPath());
      page.drawImage(emb, { x: px(pos.x), y: py(pos.y + pos.h), width: pos.w * s, height: pos.h * s });
      page.pushOperators(L.popGraphicsState());
    }
  }

  function imagePos(sh, im, cols, rows, X, Y, ci, rIdx) {
    // Posisi gambar relatif terhadap awal halaman (baris & kolom pertama di halaman)
    const colStart = (c) => {
      if (ci.has(c)) return X[ci.get(c)];
      // kolom di luar halaman: hitung dari lebar kolom sheet
      let x = 0;
      if (c < cols[0].c) { for (let k = c; k < cols[0].c; k++) x -= sh.colW(k); return x; }
      x = X[cols.length];
      for (let k = cols[cols.length - 1].c + 1; k < c; k++) x += sh.colW(k);
      return x;
    };
    const rowStart = (r) => {
      if (rIdx.has(r)) return Y[rIdx.get(r)];
      const rh = (k) => { const h = sh.rowH(k); return h == null ? sh.defRowH : h; };
      let y = 0;
      const first = rows.find((x) => !sh.titleRows || x.r > sh.titleRows[1]) || rows[0];
      if (r < first.r) { y = Y[rows.indexOf(first)]; for (let k = r; k < first.r; k++) y -= rh(k); return y; }
      y = Y[rows.length];
      for (let k = rows[rows.length - 1].r + 1; k < r; k++) y += rh(k);
      return y;
    };
    if (im.abs) return null;
    const x = colStart(im.from.c) + im.from.co, y = rowStart(im.from.r) + im.from.ro;
    let w, h;
    if (im.to) { w = colStart(im.to.c) + im.to.co - x; h = rowStart(im.to.r) + im.to.ro - y; }
    else { w = im.w; h = im.h; }
    if (w <= 0 || h <= 0) return null;
    if (x + w <= 0 || y + h <= 0 || x >= X[cols.length] || y >= Y[rows.length]) return null;
    return { x, y, w, h };
  }

  async function sheetToPdf(files, opt, progress) {
    const L = PL();
    const doc = await L.PDFDocument.create();
    doc.setProducer('KlinikPDF'); doc.setCreator('KlinikPDF');
    let pages = 0;
    for (const file of [].concat(files)) {
      const isCsv = /\.(csv|tsv|txt)$/i.test(file.name);
      const sheets = isCsv ? await readCsv(file, opt) : await readXlsx(file, opt, progress);
      pages += await sheetsToPdf(sheets, opt, progress, doc);
    }
    if (!pages) throw userErr('Spreadsheet kosong: tidak ada sel berisi data untuk dicetak.');
    return doc.save();
  }

  // ==========================================================
  // POWERPOINT — tema, warna, isian
  // ==========================================================
  const PRST_COLORS = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', purple: '800080', navy: '000080', silver: 'C0C0C0', maroon: '800000', teal: '008080', lime: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', brown: 'A52A2A', pink: 'FFC0CB', gold: 'FFD700' };
  const COLOR_TAGS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'];

  function parseTheme(x) {
    const colors = themeColorsOf(x);
    const fs = at(x, 'themeElements', 'fontScheme');
    const major = attr(at(fs, 'majorFont', 'latin'), 'typeface') || 'Calibri Light';
    const minor = attr(at(fs, 'minorFont', 'latin'), 'typeface') || 'Calibri';
    const fmt = at(x, 'themeElements', 'fmtScheme');
    return {
      colors, major, minor,
      fills: kids(at(fmt, 'fillStyleLst')), bgFills: kids(at(fmt, 'bgFillStyleLst')), lines: kids(at(fmt, 'lnStyleLst'), 'ln'),
    };
  }
  function colorEl(container) {
    if (!container) return null;
    if (COLOR_TAGS.includes(container.localName)) return container;
    for (const c of kids(container)) if (COLOR_TAGS.includes(c.localName)) return c;
    return null;
  }
  function resolveColor(el, sc, phClr) {
    el = colorEl(el);
    if (!el) return null;
    let c;
    const v = attr(el, 'val');
    switch (el.localName) {
      case 'srgbClr': c = hexColor(v) || { ...BLACK }; break;
      case 'sysClr': c = hexColor(attr(el, 'lastClr')) || (v === 'window' ? hexColor('FFFFFF') : { ...BLACK }); break;
      case 'prstClr': c = hexColor(PRST_COLORS[v] || '000000'); break;
      case 'scrgbClr': {
        const g = (k) => { const l = nAttr(el, k, 0) / 100000; return Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); };
        c = { r: g('r'), g: g('g'), b: g('b'), a: 1 }; break;
      }
      case 'hslClr': c = hsl2rgb({ h: nAttr(el, 'hue', 0) / 21600000, s: nAttr(el, 'sat', 0) / 100000, l: nAttr(el, 'lum', 0) / 100000 }); break;
      case 'schemeClr': {
        if (v === 'phClr') { c = phClr ? { ...phClr } : { ...BLACK }; break; }
        const m = sc.clrMap[v] || v;
        const t = sc.theme.colors[m] || sc.theme.colors[v];
        c = t ? { ...t } : { ...BLACK };
        break;
      }
      default: return null;
    }
    c = { r: c.r, g: c.g, b: c.b, a: c.a == null ? 1 : c.a };
    for (const mEl of kids(el)) {
      const n = nAttr(mEl, 'val', 0) / 100000;
      switch (mEl.localName) {
        case 'alpha': c.a = n; break;
        case 'alphaMod': c.a *= n; break;
        case 'alphaOff': c.a = clamp(c.a + n, 0, 1); break;
        case 'lumMod': { const h = rgb2hsl(c); h.l = clamp(h.l * n, 0, 1); c = hsl2rgb(h, c.a); break; }
        case 'lumOff': { const h = rgb2hsl(c); h.l = clamp(h.l + n, 0, 1); c = hsl2rgb(h, c.a); break; }
        case 'satMod': { const h = rgb2hsl(c); h.s = clamp(h.s * n, 0, 1); c = hsl2rgb(h, c.a); break; }
        case 'hueMod': { const h = rgb2hsl(c); h.h = (h.h * n) % 1; c = hsl2rgb(h, c.a); break; }
        case 'hueOff': { const h = rgb2hsl(c); h.h = (h.h + nAttr(mEl, 'val', 0) / 21600000 + 1) % 1; c = hsl2rgb(h, c.a); break; }
        case 'tint': c = { r: Math.round(c.r * n + 255 * (1 - n)), g: Math.round(c.g * n + 255 * (1 - n)), b: Math.round(c.b * n + 255 * (1 - n)), a: c.a }; break;
        case 'shade': c = { r: Math.round(c.r * n), g: Math.round(c.g * n), b: Math.round(c.b * n), a: c.a }; break;
        case 'comp': c = { r: 255 - c.r, g: 255 - c.g, b: 255 - c.b, a: c.a }; break;
        case 'inv': c = { r: 255 - c.r, g: 255 - c.g, b: 255 - c.b, a: c.a }; break;
        case 'gray': { const y = Math.round(0.3 * c.r + 0.59 * c.g + 0.11 * c.b); c = { r: y, g: y, b: y, a: c.a }; break; }
        default: break;
      }
    }
    return c;
  }

  /** Cari elemen isian (solidFill, gradFill, …) di dalam spPr/bgPr. */
  const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];
  function fillElOf(el) { for (const c of kids(el)) if (FILL_TAGS.includes(c.localName)) return c; return null; }
  function parseFill(f, sc, phClr, rels) {
    if (!f) return null;
    switch (f.localName) {
      case 'noFill': return { type: 'none' };
      case 'solidFill': { const c = resolveColor(f, sc, phClr); return c ? { type: 'solid', color: c } : null; }
      case 'gradFill': {
        const stops = kids(at(f, 'gsLst'), 'gs').map((g) => ({ pos: nAttr(g, 'pos', 0) / 100000, color: resolveColor(g, sc, phClr) || BLACK })).sort((a, b) => a.pos - b.pos);
        if (!stops.length) return null;
        const lin = kid(f, 'lin'), path = kid(f, 'path');
        return { type: 'grad', stops, ang: lin ? nAttr(lin, 'ang', 0) / 60000 : 90, radial: !!path };
      }
      case 'blipFill': {
        const blip = kid(f, 'blip');
        const r = rels && rels[rid(blip, 'embed')];
        if (!r || r.external) return null;
        const alpha = kid(blip, 'alphaModFix');
        const sr = kid(f, 'srcRect');
        return { type: 'img', path: r.target, alpha: alpha ? nAttr(alpha, 'amt', 100000) / 100000 : 1, src: srcRectOf(sr), tile: !!kid(f, 'tile') };
      }
      case 'pattFill': { const c = resolveColor(kid(f, 'fgClr'), sc, phClr); const bg = resolveColor(kid(f, 'bgClr'), sc, phClr); return c ? { type: 'solid', color: bg ? mix(c, bg, 0.5) : c } : null; }
      case 'grpFill': return { type: 'group' };
      default: return null;
    }
  }
  const srcRectOf = (sr) => ({ l: nAttr(sr, 'l', 0) / 100000, t: nAttr(sr, 't', 0) / 100000, r: nAttr(sr, 'r', 0) / 100000, b: nAttr(sr, 'b', 0) / 100000 });
  function styleRefFill(styleEl, sc) {
    const ref = kid(styleEl, 'fillRef');
    if (!ref) return null;
    const idx = nAttr(ref, 'idx', 0);
    if (!idx) return { type: 'none' };
    const ph = resolveColor(ref, sc);
    const src = idx >= 1001 ? sc.theme.bgFills[idx - 1001] : sc.theme.fills[idx - 1];
    return parseFill(src, sc, ph, sc.themeRels) || (ph ? { type: 'solid', color: ph } : null);
  }
  function parseLine(spPr, styleEl, sc) {
    let base = null;
    const ref = kid(styleEl, 'lnRef');
    if (ref && nAttr(ref, 'idx', 0) > 0) {
      const ph = resolveColor(ref, sc);
      const tl = sc.theme.lines[nAttr(ref, 'idx', 1) - 1];
      base = { w: nAttr(tl, 'w', 9525) / EMU, color: ph, dash: null };
      const f = fillElOf(tl);
      if (f && f.localName === 'noFill') base = null;
      else if (f && f.localName === 'solidFill') base.color = resolveColor(f, sc, ph) || ph;
      if (base) base.dash = attr(kid(tl, 'prstDash'), 'val');
    }
    const ln = kid(spPr, 'ln');
    if (!ln) return base;
    const out = base ? { ...base } : { w: 0.75, color: null, dash: null };
    if (attr(ln, 'w') != null) out.w = nAttr(ln, 'w', 9525) / EMU;
    const f = fillElOf(ln);
    if (f) {
      if (f.localName === 'noFill') return null;
      if (f.localName === 'solidFill') out.color = resolveColor(f, sc);
      else if (f.localName === 'gradFill') { const g = parseFill(f, sc); out.color = g && g.stops ? g.stops[0].color : out.color; }
    }
    if (kid(ln, 'prstDash')) out.dash = attr(kid(ln, 'prstDash'), 'val');
    out.head = attr(kid(ln, 'headEnd'), 'type');
    out.tail = attr(kid(ln, 'tailEnd'), 'type');
    out.cap = attr(ln, 'cap');
    if (!out.color) return null;
    return out;
  }

  // ==========================================================
  // POWERPOINT — geometri bentuk
  // ==========================================================
  function adjOf(geom, name, def) {
    for (const gd of kids(at(geom, 'avLst'), 'gd')) {
      if (attr(gd, 'name') === name) { const m = String(attr(gd, 'fmla', '')).match(/val\s+(-?\d+)/); if (m) return +m[1]; }
    }
    return def;
  }
  /** Path2D untuk bentuk preset/custom. Hasil: { path, fill: bool, stroke: bool, open: bool } */
  function shapePath(spPr, w, h) {
    const P = new Path2D();
    const cust = kid(spPr, 'custGeom');
    if (cust) {
      const paths = [];
      for (const p of kids(at(cust, 'pathLst'), 'path')) {
        const pw = nAttr(p, 'w', 0) || w * EMU, phh = nAttr(p, 'h', 0) || h * EMU;
        const sx = w / (pw || 1), sy = h / (phh || 1);
        const q = new Path2D();
        let cx = 0, cy = 0, open = true;
        const pt = (e) => [nAttr(e, 'x', 0) * sx, nAttr(e, 'y', 0) * sy];
        for (const cmd of kids(p)) {
          const pts = kids(cmd, 'pt').map(pt);
          switch (cmd.localName) {
            case 'moveTo': if (pts[0]) { q.moveTo(...pts[0]); [cx, cy] = pts[0]; } break;
            case 'lnTo': if (pts[0]) { q.lineTo(...pts[0]); [cx, cy] = pts[0]; } break;
            case 'cubicBezTo': if (pts.length === 3) { q.bezierCurveTo(...pts[0], ...pts[1], ...pts[2]); [cx, cy] = pts[2]; } break;
            case 'quadBezTo': if (pts.length === 2) { q.quadraticCurveTo(...pts[0], ...pts[1]); [cx, cy] = pts[1]; } break;
            case 'arcTo': {
              const wR = nAttr(cmd, 'wR', 0) * sx, hR = nAttr(cmd, 'hR', 0) * sy;
              const st = (nAttr(cmd, 'stAng', 0) / 60000) * Math.PI / 180, sw = (nAttr(cmd, 'swAng', 0) / 60000) * Math.PI / 180;
              if (!wR || !hR) break;
              const t1 = Math.atan2(wR * Math.sin(st), hR * Math.cos(st));
              const t2 = Math.atan2(wR * Math.sin(st + sw), hR * Math.cos(st + sw));
              const ex0 = wR * Math.cos(t1), ey0 = hR * Math.sin(t1);
              const ccx = cx - ex0, ccy = cy - ey0;
              let a2 = t2;
              if (sw > 0 && a2 <= t1) a2 += 2 * Math.PI;
              if (sw < 0 && a2 >= t1) a2 -= 2 * Math.PI;
              if (Math.abs(sw) >= 2 * Math.PI - 1e-6) a2 = t1 + (sw > 0 ? 2 * Math.PI : -2 * Math.PI);
              q.ellipse(ccx, ccy, wR, hR, 0, t1, a2, sw < 0);
              cx = ccx + wR * Math.cos(a2); cy = ccy + hR * Math.sin(a2);
              break;
            }
            case 'close': q.closePath(); open = false; break;
            default: break;
          }
        }
        paths.push({ path: q, fill: attr(p, 'fill') !== 'none', stroke: attr(p, 'stroke') !== '0' && attr(p, 'stroke') !== 'false', open });
      }
      if (!paths.length) { P.rect(0, 0, w, h); return [{ path: P, fill: true, stroke: true }]; }
      return paths;
    }
    const geom = kid(spPr, 'prstGeom');
    const prst = attr(geom, 'prst', 'rect');
    const ss = Math.min(w, h);
    const A = (n, d) => adjOf(geom, n, d) / 100000;
    const poly = (pts) => { P.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) P.lineTo(pts[i][0], pts[i][1]); P.closePath(); };
    const rr = (r) => { r = Math.min(r, w / 2, h / 2); P.moveTo(r, 0); P.arcTo(w, 0, w, h, r); P.arcTo(w, h, 0, h, r); P.arcTo(0, h, 0, 0, r); P.arcTo(0, 0, w, 0, r); P.closePath(); };
    const star = (n, inner) => {
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / n, rad = i % 2 ? inner : 1;
        pts.push([w / 2 + (w / 2) * rad * Math.cos(a), h / 2 + (h / 2) * rad * Math.sin(a)]);
      }
      poly(pts);
    };
    let open = false, noFill = false;
    switch (prst) {
      case 'roundRect': case 'flowChartAlternateProcess': rr(ss * A('adj', 16667)); break;
      case 'flowChartTerminator': rr(h / 2); break;
      case 'round2SameRect': { const r = ss * A('adj1', 16667); P.moveTo(r, 0); P.arcTo(w, 0, w, h, r); P.lineTo(w, h); P.lineTo(0, h); P.arcTo(0, 0, w, 0, r); P.closePath(); break; }
      case 'round1Rect': { const r = ss * A('adj', 16667); P.moveTo(0, 0); P.lineTo(w - r, 0); P.arcTo(w, 0, w, h, r); P.lineTo(w, h); P.lineTo(0, h); P.closePath(); break; }
      case 'snip1Rect': { const d = ss * A('adj', 16667); poly([[0, 0], [w - d, 0], [w, d], [w, h], [0, h]]); break; }
      case 'snip2SameRect': { const d = ss * A('adj1', 16667); poly([[d, 0], [w - d, 0], [w, d], [w, h], [0, h], [0, d]]); break; }
      case 'ellipse': case 'flowChartConnector': case 'donut': case 'cloud': case 'cloudCallout': case 'wedgeEllipseCallout': case 'teardrop': case 'smileyFace': case 'pie': case 'chord': case 'flowChartOr': case 'flowChartSummingJunction':
        P.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); break;
      case 'triangle': case 'flowChartExtract': { const x = w * (prst === 'triangle' ? A('adj', 50000) : 0.5); poly([[x, 0], [w, h], [0, h]]); break; }
      case 'flowChartMerge': poly([[0, 0], [w, 0], [w / 2, h]]); break;
      case 'rtTriangle': poly([[0, 0], [w, h], [0, h]]); break;
      case 'diamond': case 'flowChartDecision': poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]); break;
      case 'parallelogram': case 'flowChartInputOutput': { const d = prst === 'parallelogram' ? ss * A('adj', 25000) : w * 0.2; poly([[d, 0], [w, 0], [w - d, h], [0, h]]); break; }
      case 'trapezoid': { const d = ss * A('adj', 25000); poly([[d, 0], [w - d, 0], [w, h], [0, h]]); break; }
      case 'pentagon': case 'homePlate': { const d = ss * A('adj', 50000); poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h]]); break; }
      case 'chevron': { const d = ss * A('adj', 50000); poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]); break; }
      case 'hexagon': { const d = ss * A('adj', 25000); poly([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]); break; }
      case 'octagon': { const d = ss * A('adj', 29289); poly([[d, 0], [w - d, 0], [w, d], [w, h - d], [w - d, h], [d, h], [0, h - d], [0, d]]); break; }
      case 'plus': case 'mathPlus': { const d = ss * A('adj', 25000); poly([[d, 0], [w - d, 0], [w - d, d], [w, d], [w, h - d], [w - d, h - d], [w - d, h], [d, h], [d, h - d], [0, h - d], [0, d], [d, d]].map(([x, y]) => [x, y])); break; }
      case 'rightArrow': { const t = h * A('adj1', 50000), hd = ss * A('adj2', 50000); poly([[0, (h - t) / 2], [w - hd, (h - t) / 2], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, (h + t) / 2], [0, (h + t) / 2]]); break; }
      case 'leftArrow': { const t = h * A('adj1', 50000), hd = ss * A('adj2', 50000); poly([[w, (h - t) / 2], [hd, (h - t) / 2], [hd, 0], [0, h / 2], [hd, h], [hd, (h + t) / 2], [w, (h + t) / 2]]); break; }
      case 'upArrow': { const t = w * A('adj1', 50000), hd = ss * A('adj2', 50000); poly([[(w - t) / 2, h], [(w - t) / 2, hd], [0, hd], [w / 2, 0], [w, hd], [(w + t) / 2, hd], [(w + t) / 2, h]]); break; }
      case 'downArrow': { const t = w * A('adj1', 50000), hd = ss * A('adj2', 50000); poly([[(w - t) / 2, 0], [(w - t) / 2, h - hd], [0, h - hd], [w / 2, h], [w, h - hd], [(w + t) / 2, h - hd], [(w + t) / 2, 0]]); break; }
      case 'leftRightArrow': { const t = h * A('adj1', 50000), hd = ss * A('adj2', 50000); poly([[0, h / 2], [hd, 0], [hd, (h - t) / 2], [w - hd, (h - t) / 2], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, (h + t) / 2], [hd, (h + t) / 2], [hd, h]]); break; }
      case 'star4': star(4, 0.38); break;
      case 'star5': star(5, 0.38); break;
      case 'star6': star(6, 0.5); break;
      case 'star8': star(8, 0.6); break;
      case 'heart': P.moveTo(w / 2, h * 0.25); P.bezierCurveTo(w * 0.5, 0, 0, 0, 0, h * 0.3); P.bezierCurveTo(0, h * 0.6, w * 0.4, h * 0.8, w / 2, h); P.bezierCurveTo(w * 0.6, h * 0.8, w, h * 0.6, w, h * 0.3); P.bezierCurveTo(w, 0, w * 0.5, 0, w / 2, h * 0.25); P.closePath(); break;
      case 'line': case 'straightConnector1': case 'curvedConnector2': case 'curvedConnector3': case 'curvedConnector4': case 'bentConnector2': case 'bentConnector4':
        P.moveTo(0, 0); P.lineTo(w, h); open = true; noFill = true; break;
      case 'bentConnector3': { const x = w * A('adj1', 50000); P.moveTo(0, 0); P.lineTo(x, 0); P.lineTo(x, h); P.lineTo(w, h); open = true; noFill = true; break; }
      case 'arc': { const a1 = (adjOf(geom, 'adj1', 16200000) / 60000) * Math.PI / 180, a2 = (adjOf(geom, 'adj2', 0) / 60000) * Math.PI / 180; P.ellipse(w / 2, h / 2, w / 2, h / 2, 0, a1, a2 <= a1 ? a2 + 2 * Math.PI : a2); open = true; noFill = true; break; }
      case 'leftBracket': P.moveTo(w, 0); P.quadraticCurveTo(0, 0, 0, Math.min(h * 0.1, w)); P.lineTo(0, h - Math.min(h * 0.1, w)); P.quadraticCurveTo(0, h, w, h); open = true; noFill = true; break;
      case 'rightBracket': P.moveTo(0, 0); P.quadraticCurveTo(w, 0, w, Math.min(h * 0.1, w)); P.lineTo(w, h - Math.min(h * 0.1, w)); P.quadraticCurveTo(w, h, 0, h); open = true; noFill = true; break;
      case 'leftBrace': P.moveTo(w, 0); P.quadraticCurveTo(w / 2, 0, w / 2, h * 0.1); P.lineTo(w / 2, h * 0.4); P.quadraticCurveTo(w / 2, h / 2, 0, h / 2); P.quadraticCurveTo(w / 2, h / 2, w / 2, h * 0.6); P.lineTo(w / 2, h * 0.9); P.quadraticCurveTo(w / 2, h, w, h); open = true; noFill = true; break;
      case 'rightBrace': P.moveTo(0, 0); P.quadraticCurveTo(w / 2, 0, w / 2, h * 0.1); P.lineTo(w / 2, h * 0.4); P.quadraticCurveTo(w / 2, h / 2, w, h / 2); P.quadraticCurveTo(w / 2, h / 2, w / 2, h * 0.6); P.lineTo(w / 2, h * 0.9); P.quadraticCurveTo(w / 2, h, 0, h); open = true; noFill = true; break;
      case 'flowChartDocument': P.moveTo(0, 0); P.lineTo(w, 0); P.lineTo(w, h * 0.83); P.bezierCurveTo(w * 0.7, h * 0.7, w * 0.3, h * 1.05, 0, h * 0.92); P.closePath(); break;
      case 'can': { const e = Math.min(h * 0.25, ss * A('adj', 25000)); P.moveTo(0, e / 2); P.ellipse(w / 2, e / 2, w / 2, e / 2, 0, Math.PI, 0); P.lineTo(w, h - e / 2); P.ellipse(w / 2, h - e / 2, w / 2, e / 2, 0, 0, Math.PI); P.closePath(); break; }
      default: P.rect(0, 0, w, h);
    }
    return [{ path: P, fill: !noFill, stroke: true, open }];
  }

  // ==========================================================
  // POWERPOINT — teks
  // ==========================================================
  const WINGDINGS = { '§': '▪', 'Ø': '➢', 'ü': '✔', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'Ÿ': '•', 'ð': '➔', 'à': '→', 'ê': '➥', 'o': '□', 'p': '◆', 'u': '◆', 'w': '◆', 'ß': '◄', 'Ú': '▲', 'Þ': '►', 'è': '➔', 'û': '✗', 'ý': '☒', 'þ': '☑', '': '•' };
  function autoNum(type, n) {
    const roman = (k) => { const v = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [a, b] of v) while (k >= a) { s += b; k -= a; } return s; };
    const alpha = (k) => { let s = ''; while (k > 0) { k--; s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26); } return s; };
    const t = String(type || 'arabicPeriod');
    let core = t.startsWith('roman') ? roman(n) : t.startsWith('alpha') ? alpha(n) : String(n);
    if (/Uc/.test(t)) core = core.toUpperCase();
    if (/ParenBoth/.test(t)) return `(${core})`;
    if (/ParenR/.test(t)) return core + ')';
    if (/Period/.test(t)) return core + '.';
    if (/Minus/.test(t)) return '- ' + core + ' -';
    return core;
  }
  function mergeR(dst, el) {
    if (!el) return dst;
    if (attr(el, 'sz') != null) dst.sz = nAttr(el, 'sz', 1800) / 100;
    if (attr(el, 'b') != null) dst.b = bAttr(el, 'b');
    if (attr(el, 'i') != null) dst.i = bAttr(el, 'i');
    if (attr(el, 'u') != null) dst.u = attr(el, 'u') !== 'none';
    if (attr(el, 'strike') != null) dst.strike = attr(el, 'strike') !== 'noStrike';
    if (attr(el, 'cap') != null) dst.cap = attr(el, 'cap');
    if (attr(el, 'baseline') != null) dst.baseline = nAttr(el, 'baseline', 0) / 100000;
    if (attr(el, 'spc') != null) dst.spc = nAttr(el, 'spc', 0) / 100;
    const f = fillElOf(el);
    if (f) dst.fill = f;
    const latin = kid(el, 'latin');
    if (latin && attr(latin, 'typeface')) dst.font = attr(latin, 'typeface');
    if (kid(el, 'hlinkClick')) { dst.link = true; if (attr(el, 'u') == null) dst.u = true; }
    const hl = kid(el, 'highlight');
    if (hl) dst.hl = hl;
    return dst;
  }
  function mergeP(dst, el) {
    if (!el) return dst;
    for (const k of ['marL', 'indent']) if (attr(el, k) != null) dst[k] = nAttr(el, k, 0) / EMU;
    if (attr(el, 'algn') != null) dst.algn = attr(el, 'algn');
    for (const k of ['lnSpc', 'spcBef', 'spcAft']) {
      const e = kid(el, k);
      if (!e) continue;
      const pct = kid(e, 'spcPct'), pts = kid(e, 'spcPts');
      dst[k] = pct ? { pct: nAttr(pct, 'val', 100000) / 100000 } : pts ? { pts: nAttr(pts, 'val', 0) / 100 } : dst[k];
    }
    if (kid(el, 'buNone')) dst.bu = { type: 'none' };
    else if (kid(el, 'buChar')) dst.bu = { type: 'char', ch: attr(kid(el, 'buChar'), 'char', '•') };
    else if (kid(el, 'buAutoNum')) dst.bu = { type: 'num', scheme: attr(kid(el, 'buAutoNum'), 'type'), start: nAttr(kid(el, 'buAutoNum'), 'startAt', 1) };
    else if (kid(el, 'buBlip')) dst.bu = { type: 'char', ch: '•' };
    if (kid(el, 'buFont')) dst.buFont = attr(kid(el, 'buFont'), 'typeface');
    if (kid(el, 'buClr')) dst.buClr = kid(el, 'buClr');
    if (kid(el, 'buClrTx')) dst.buClr = null;
    if (kid(el, 'buSzPct')) dst.buSz = nAttr(kid(el, 'buSzPct'), 'val', 100000) / 100000;
    if (kid(el, 'buSzPts')) dst.buSzPts = nAttr(kid(el, 'buSzPts'), 'val', 1800) / 100;
    if (kid(el, 'defRPr')) dst.r = mergeR({ ...dst.r }, kid(el, 'defRPr'));
    return dst;
  }
  const lvlEl = (lst, lvl) => (lst ? kid(lst, `lvl${lvl + 1}pPr`) : null);
  function mergeBody(dst, b) {
    if (!b) return dst;
    for (const k of ['lIns', 'tIns', 'rIns', 'bIns']) if (attr(b, k) != null) dst[k] = nAttr(b, k, 0) / EMU;
    for (const k of ['anchor', 'wrap', 'vert']) if (attr(b, k) != null) dst[k] = attr(b, k);
    if (attr(b, 'anchorCtr') != null) dst.anchorCtr = bAttr(b, 'anchorCtr');
    if (attr(b, 'rot') != null) dst.rot = nAttr(b, 'rot', 0) / 60000;
    const na = kid(b, 'normAutofit');
    if (na) { dst.autofit = true; dst.fontScale = nAttr(na, 'fontScale', 100000) / 100000; dst.lnRed = nAttr(na, 'lnSpcReduction', 0) / 100000; }
    if (kid(b, 'noAutofit') || kid(b, 'spAutoFit')) { dst.autofit = false; dst.fontScale = 1; dst.lnRed = 0; }
    return dst;
  }

  function fontStack(face, sc) {
    let f = face || sc.theme.minor;
    if (f === '+mj-lt' || f === '+mj-ea' || f === '+mj-cs') f = sc.theme.major;
    else if (f && f[0] === '+') f = sc.theme.minor;
    const serif = /times|cambria|georgia|garamond|book antiqua|palatino|serif|constantia/i.test(f) && !/sans/i.test(f);
    const fb = serif ? '"Times New Roman", Times, serif' : '"Calibri", "Carlito", "Segoe UI", Arial, "Helvetica Neue", sans-serif';
    return `"${f.replace(/"/g, '')}", ${fb}`;
  }

  /** Susun & gambar teks pada kotak. box: {x,y,w,h} dalam koordinat lokal (pt). */
  function drawTextBody(g, txBody, box, T) {
    const { sc, chain, fontRefColor, slideNum, collect } = T;
    if (!txBody) return;
    const paras = kids(txBody, 'p');
    if (!paras.length || !paras.some((p) => p.textContent.trim() || kids(p, 'br').length)) return;
    // Properti badan teks (inset, anchor, autofit)
    const body = { lIns: 7.2, tIns: 3.6, rIns: 7.2, bIns: 3.6, anchor: 't', wrap: 'square', autofit: false, fontScale: 1, lnRed: 0 };
    for (const bp of chain.bodyPr) mergeBody(body, bp);
    mergeBody(body, kid(txBody, 'bodyPr'));
    let bx = box.x, by = box.y, bw = box.w, bh = box.h;
    g.save();
    if (body.vert === 'vert' || body.vert === 'vert270' || body.vert === 'eaVert' || body.vert === 'wordArtVert') {
      g.translate(bx + bw / 2, by + bh / 2);
      g.rotate(body.vert === 'vert270' ? -Math.PI / 2 : Math.PI / 2);
      [bw, bh] = [bh, bw];
      bx = -bw / 2; by = -bh / 2;
    }
    if (body.rot) { g.translate(bx + bw / 2, by + bh / 2); g.rotate((body.rot * Math.PI) / 180); g.translate(-(bx + bw / 2), -(by + bh / 2)); }
    const innerX = bx + body.lIns, innerW = Math.max(1, bw - body.lIns - body.rIns);
    const wrap = body.wrap !== 'none';
    const lstStyle = kid(txBody, 'lstStyle');
    const build = (fs, lnRed) => {
      const out = [];
      const counters = [];
      let prevAft = 0;
      for (let pi = 0; pi < paras.length; pi++) {
        const p = paras[pi];
        const pPr = kid(p, 'pPr');
        const lvl = clamp(nAttr(pPr, 'lvl', 0), 0, 8);
        let P = { marL: 0, indent: 0, algn: 'l', lnSpc: null, spcBef: null, spcAft: null, bu: null, r: { sz: 18, b: false, i: false, u: false } };
        for (const lst of chain.lst) { mergeP(P, lst && kid(lst, 'defPPr')); mergeP(P, lvlEl(lst, lvl)); }
        if (fontRefColor) P.r = { ...P.r, fill: null, refColor: fontRefColor };
        mergeP(P, lstStyle && kid(lstStyle, 'defPPr'));
        mergeP(P, lvlEl(lstStyle, lvl));
        mergeP(P, pPr);
        // Run → token kata
        const runs = [];
        for (const r of kids(p)) {
          const ln = r.localName;
          if (ln === 'r' || ln === 'fld') {
            const st = mergeR({ ...P.r }, kid(r, 'rPr'));
            let t = (kid(r, 't') || { textContent: '' }).textContent;
            if (ln === 'fld' && /^slidenum$/i.test(attr(r, 'type') || '')) t = String(slideNum);
            if (st.cap === 'all') t = t.toUpperCase();
            if (t) runs.push({ t: t.replace(/\t/g, '    ').replace(/\u000b/g, '\n'), st });
          } else if (ln === 'br') runs.push({ br: true, st: mergeR({ ...P.r }, kid(r, 'rPr')) });
        }
        const endSt = mergeR({ ...P.r }, kid(p, 'endParaRPr'));
        const sizeOf = (st) => Math.max(1, (st.sz || 18) * fs * (st.baseline ? 0.68 : 1));
        // Bullet
        const hasText = runs.some((r) => r.t && r.t.trim());
        let bullet = null;
        if (P.bu && P.bu.type !== 'none' && hasText) {
          const firstSt = (runs.find((r) => r.t) || { st: endSt }).st;
          let ch;
          if (P.bu.type === 'num') {
            for (let k = lvl + 1; k < 9; k++) counters[k] = 0;
            counters[lvl] = (counters[lvl] || P.bu.start - 1) + 1;
            ch = autoNum(P.bu.scheme, counters[lvl]);
          } else {
            ch = P.bu.ch;
            if (/wingdings|symbol|webdings/i.test(P.buFont || '')) ch = WINGDINGS[ch] || (/symbol/i.test(P.buFont) && ch === '·' ? '•' : '•');
          }
          const bsz = P.buSzPts ? P.buSzPts * fs : sizeOf(firstSt) * (P.buSz || 1);
          const bc = P.buClr ? resolveColor(P.buClr, sc) : null;
          bullet = { ch, st: { ...firstSt, b: false, i: false, u: false, font: P.bu.type === 'num' ? firstSt.font : (/wingdings|symbol/i.test(P.buFont || '') ? null : P.buFont || firstSt.font) }, size: bsz, color: bc };
        }
        if (!P.bu || P.bu.type !== 'num') counters[lvl] = 0;
        // Kata-kata
        const toks = [];
        for (const r of runs) {
          if (r.br) { toks.push({ br: true, st: r.st, size: sizeOf(r.st) }); continue; }
          for (const piece of r.t.split(/(\n| +)/)) {
            if (!piece) continue;
            if (piece === '\n') { toks.push({ br: true, st: r.st, size: sizeOf(r.st) }); continue; }
            toks.push({ t: piece, st: r.st, size: sizeOf(r.st), space: /^ +$/.test(piece) });
          }
        }
        const measure = (tk) => {
          g.font = fontCss(tk.st, tk.size, sc);
          return g.measureText(tk.t).width + (tk.st.spc ? tk.st.spc * tk.t.length : 0);
        };
        const lineStartX = (first) => (first ? P.marL + P.indent : P.marL);
        let bulletW = 0;
        if (bullet) { g.font = fontCss(bullet.st, bullet.size, sc); bulletW = g.measureText(bullet.ch).width; }
        const lines = [];
        let line = { items: [], w: 0, max: 0, first: true };
        const firstX = () => {
          if (!bullet) return lineStartX(true);
          const bx0 = P.marL + P.indent;
          return Math.max(P.marL, bx0 + bulletW + bullet.size * 0.25);
        };
        let x0 = firstX();
        const avail = () => innerW - (line.first ? x0 : lineStartX(false));
        const push = () => { lines.push(line); line = { items: [], w: 0, max: 0, first: false }; };
        for (const tk of toks) {
          if (tk.br) { line.max = Math.max(line.max, tk.size); push(); continue; }
          let w = measure(tk);
          if (tk.space && !line.items.length && !line.first) continue;
          if (wrap && line.items.length && !tk.space && line.w + w > avail() + 0.5) {
            while (line.items.length && line.items[line.items.length - 1].space) line.w -= line.items.pop().w;
            push();
          }
          if (wrap && !tk.space && w > avail() && tk.t.length > 1) {
            // Kata terlalu panjang: potong per huruf
            let rest = tk.t;
            while (rest) {
              let k = rest.length;
              g.font = fontCss(tk.st, tk.size, sc);
              while (k > 1 && g.measureText(rest.slice(0, k)).width > avail() - line.w) k--;
              const part = { ...tk, t: rest.slice(0, k) };
              part.w = measure(part);
              line.items.push(part); line.w += part.w; line.max = Math.max(line.max, tk.size);
              rest = rest.slice(k);
              if (rest) push();
            }
            continue;
          }
          tk.w = w;
          line.items.push(tk); line.w += w; line.max = Math.max(line.max, tk.size);
        }
        if (line.items.length || !lines.length) lines.push(line);
        for (const ln of lines) { if (!ln.max) ln.max = sizeOf(endSt); while (ln.items.length && ln.items[ln.items.length - 1].space) ln.w -= ln.items.pop().w; }
        const baseSize = Math.max(...lines.map((l) => l.max));
        const spc = (s, def) => (!s ? def : s.pts != null ? s.pts : s.pct * baseSize * 1.2);
        const bef = pi === 0 ? 0 : spc(P.spcBef, 0);
        out.push({ P, lines, bullet, bef, aft: spc(P.spcAft, 0), x0, lnRed, prevAft });
        prevAft = spc(P.spcAft, 0);
      }
      // Tinggi total
      let hTot = 0;
      for (const pp of out) {
        hTot += pp.bef + (out.indexOf(pp) ? pp.prevAft : 0);
        for (const ln of pp.lines) {
          ln.h = pp.P.lnSpc && pp.P.lnSpc.pts != null ? pp.P.lnSpc.pts : ln.max * 1.2 * ((pp.P.lnSpc ? pp.P.lnSpc.pct : 1) - lnRed);
          hTot += ln.h;
        }
      }
      return { paras: out, h: hTot };
    };
    let fs = body.fontScale || 1, lnRed = body.lnRed || 0;
    let L = build(fs, lnRed);
    const availH = bh - body.tIns - body.bIns;
    if (body.autofit && L.h > availH + 1) {
      for (let k = 0; k < 12 && L.h > availH + 1 && fs > 0.3; k++) { fs *= 0.92; lnRed = Math.min(0.2, lnRed + 0.02); L = build(fs, lnRed); }
    }
    if (T.measure) { g.restore(); return L.h + body.tIns + body.bIns; }
    let y;
    if (body.anchor === 'ctr') y = by + body.tIns + (availH - L.h) / 2;
    else if (body.anchor === 'b') y = by + bh - body.bIns - L.h;
    else y = by + body.tIns;
    let first = true;
    for (const pp of L.paras) {
      y += pp.bef + (first ? 0 : pp.prevAft);
      first = false;
      pp.lines.forEach((ln, li) => {
        const startX = li === 0 ? pp.x0 : pp.P.marL;
        const room = innerW - startX;
        let x = innerX + startX;
        const al = pp.P.algn;
        if (al === 'ctr') x += (room - ln.w) / 2;
        else if (al === 'r') x += room - ln.w;
        const base = y + ln.h - ln.max * 0.24 - (ln.h - ln.max * 1.2 > 0 ? 0 : 0);
        let extra = 0;
        if ((al === 'just' || al === 'dist') && li < pp.lines.length - 1) {
          const gaps = ln.items.filter((it) => it.space).length;
          if (gaps) extra = (room - ln.w) / gaps;
        }
        if (li === 0 && pp.bullet) {
          const bxx = al === 'ctr' || al === 'r' ? x - (pp.x0 - (pp.P.marL + pp.P.indent)) : innerX + pp.P.marL + pp.P.indent;
          g.font = fontCss(pp.bullet.st, pp.bullet.size, sc);
          g.fillStyle = css(pp.bullet.color || runColor(pp.bullet.st, sc));
          g.fillText(pp.bullet.ch, bxx, base);
        }
        let lineText = '', lineX = x;
        for (const it of ln.items) {
          const st = it.st;
          const col = runColor(st, sc);
          g.font = fontCss(st, it.size, sc);
          const dy = st.baseline ? -st.baseline * ln.max : 0;
          if (st.hl) { const hc = resolveColor(st.hl, sc); if (hc) { g.fillStyle = css(hc); g.fillRect(x, base - it.size * 0.95, it.w + (it.space ? extra : 0), it.size * 1.2); } }
          g.fillStyle = css(col);
          if (!it.space) {
            if (st.spc) { let cx = x; for (const ch of it.t) { g.fillText(ch, cx, base + dy); cx += g.measureText(ch).width + st.spc; } }
            else g.fillText(it.t, x, base + dy);
          }
          if (st.u) g.fillRect(x, base + dy + it.size * 0.1, it.w + (it.space ? extra : 0), Math.max(0.5, it.size * 0.06));
          if (st.strike) g.fillRect(x, base + dy - it.size * 0.3, it.w + (it.space ? extra : 0), Math.max(0.5, it.size * 0.06));
          lineText += it.t;
          x += it.w + (it.space ? extra : 0);
        }
        if (collect && lineText.trim()) collect(g, lineText, lineX, base, ln.max, x - lineX);
        y += ln.h;
      });
    }
    g.restore();
  }
  function fontCss(st, size, sc) {
    return `${st.i ? 'italic ' : ''}${st.b ? 'bold ' : ''}${Math.max(0.5, size).toFixed(2)}px ${fontStack(st.font, sc)}`;
  }
  function runColor(st, sc) {
    if (st.fill) {
      if (st.fill.localName === 'noFill') return { r: 0, g: 0, b: 0, a: 0 };
      if (st.fill.localName === 'gradFill') { const g = parseFill(st.fill, sc); if (g && g.stops) return g.stops[0].color; }
      const c = resolveColor(st.fill, sc);
      if (c) return c;
    }
    if (st.link) return sc.theme.colors[sc.clrMap.hlink || 'hlink'] || sc.theme.colors.hlink;
    if (st.refColor) return st.refColor;
    return sc.theme.colors[sc.clrMap.tx1 || 'dk1'] || BLACK;
  }

  // ==========================================================
  // POWERPOINT — slide, layout, master
  // ==========================================================
  function phInfo(sp) {
    const nv = kids(sp).find((c) => /^nv/.test(c.localName));
    const ph = at(nv, 'nvPr', 'ph');
    if (!ph) return null;
    return { type: attr(ph, 'type') || 'obj', idx: attr(ph, 'idx') };
  }
  function collectPhs(spTree) {
    const out = [];
    for (const el of kids(spTree)) {
      const ph = phInfo(el);
      if (ph) out.push({ ...ph, el });
    }
    return out;
  }
  const MASTER_TYPE = (t) => (t === 'ctrTitle' || t === 'title' ? 'title' : ['dt', 'ftr', 'sldNum', 'hdr'].includes(t) ? t : 'body');
  function findLayoutPh(list, ph) {
    if (!list) return null;
    if (ph.idx != null) { const m = list.find((p) => p.idx === ph.idx && (ph.type === 'obj' || p.type === ph.type || p.type === 'obj' || !['title', 'ctrTitle'].includes(p.type))); if (m) return m; }
    const t = ph.type;
    return list.find((p) => p.type === t) || (t === 'ctrTitle' ? list.find((p) => p.type === 'title') : null) || (t === 'title' ? list.find((p) => p.type === 'ctrTitle') : null)
      || (ph.idx == null && t === 'obj' ? list.find((p) => p.type === 'body') : null);
  }
  const findMasterPh = (list, ph) => (list || []).find((p) => p.type === MASTER_TYPE(ph.type)) || null;

  async function loadPart(pkg, path, cache, loader) {
    if (!cache.has(path)) cache.set(path, loader(path));
    return cache.get(path);
  }

  class PptxRenderer {
    constructor(pkg, pres, presPath) {
      this.pkg = pkg; this.pres = pres; this.presPath = presPath;
      this.masters = new Map(); this.layouts = new Map(); this.images = new Map();
      this.defText = at(pres, 'defaultTextStyle');
    }
    async master(path) {
      return loadPart(this.pkg, path, this.masters, async () => {
        const x = await this.pkg.xml(path), rels = await this.pkg.rels(path);
        const thRel = relOfType(rels, 'theme');
        const theme = parseTheme(thRel ? await this.pkg.xml(thRel.target) : null);
        const cm = at(x, 'clrMap');
        const clrMap = {};
        if (cm) for (const a of Array.from(cm.attributes)) clrMap[a.name] = a.value;
        const tx = at(x, 'txStyles');
        const spTree = at(x, 'cSld', 'spTree');
        return { path, x, rels, theme, themeRels: thRel ? await this.pkg.rels(thRel.target) : {}, clrMap, spTree, phs: collectPhs(spTree), bg: at(x, 'cSld', 'bg'),
          title: kid(tx, 'titleStyle'), body: kid(tx, 'bodyStyle'), other: kid(tx, 'otherStyle') };
      });
    }
    async layout(path) {
      return loadPart(this.pkg, path, this.layouts, async () => {
        const x = await this.pkg.xml(path), rels = await this.pkg.rels(path);
        const mRel = relOfType(rels, 'slideMaster');
        const master = mRel ? await this.master(mRel.target) : null;
        const spTree = at(x, 'cSld', 'spTree');
        return { path, x, rels, master, spTree, phs: collectPhs(spTree), bg: at(x, 'cSld', 'bg'), showMasterSp: attr(x, 'showMasterSp') !== '0' && attr(x, 'showMasterSp') !== 'false', clrMapOvr: at(x, 'clrMapOvr', 'overrideClrMapping') };
      });
    }
    async image(path) {
      if (!this.images.has(path)) this.images.set(path, this.pkg.bytes(path).then((b) => (b ? decodeImage(b) : null)).catch(() => null));
      return this.images.get(path);
    }
  }

  async function renderSlide(R, slidePath, num, g, W, H, collect) {
    const pkg = R.pkg;
    const x = await pkg.xml(slidePath);
    if (!x) return;
    const rels = await pkg.rels(slidePath);
    const lRel = relOfType(rels, 'slideLayout');
    const layout = lRel ? await R.layout(lRel.target) : null;
    const master = layout && layout.master;
    if (!master) throw userErr('Struktur presentasi tidak lengkap (slide master tidak ditemukan).');
    const clrMap = { ...master.clrMap };
    const ovr = at(x, 'clrMapOvr', 'overrideClrMapping') || (layout && layout.clrMapOvr);
    if (ovr) for (const a of Array.from(ovr.attributes)) clrMap[a.name] = a.value;
    const sc = { theme: master.theme, themeRels: master.themeRels, clrMap };
    const slide = { x, rels, layout, master, spTree: at(x, 'cSld', 'spTree'), sc, num };
    // Latar
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    const bgSrc = [[at(x, 'cSld', 'bg'), rels], [layout.bg, layout.rels], [master.bg, master.rels]].find(([b]) => b);
    if (bgSrc) {
      const [bg, brels] = bgSrc;
      let fill = null;
      const bgPr = kid(bg, 'bgPr');
      if (bgPr) fill = parseFill(fillElOf(bgPr), sc, null, brels);
      else if (kid(bg, 'bgRef')) {
        const ref = kid(bg, 'bgRef');
        const idx = nAttr(ref, 'idx', 0), ph = resolveColor(ref, sc);
        const src = idx >= 1001 ? sc.theme.bgFills[idx - 1001] : sc.theme.fills[idx - 1];
        fill = parseFill(src, sc, ph, master.themeRels) || (ph ? { type: 'solid', color: ph } : null);
      }
      if (fill) { const p = new Path2D(); p.rect(0, 0, W, H); await paintFill(g, R, p, fill, { x: 0, y: 0, w: W, h: H }); }
    }
    const showMaster = attr(x, 'showMasterSp') !== '0' && attr(x, 'showMasterSp') !== 'false';
    const ctx = { R, sc, slide, collect };
    if (showMaster && layout.showMasterSp) await drawTree(g, master.spTree, { ...ctx, part: master, rels: master.rels, level: 'master' });
    if (showMaster) await drawTree(g, layout.spTree, { ...ctx, part: layout, rels: layout.rels, level: 'layout' });
    await drawTree(g, slide.spTree, { ...ctx, part: slide, rels, level: 'slide' });
  }

  function xfrmOf(el) {
    if (!el) return null;
    const off = kid(el, 'off'), ext = kid(el, 'ext');
    if (!off && !ext) return null;
    return {
      x: nAttr(off, 'x', 0) / EMU, y: nAttr(off, 'y', 0) / EMU, w: nAttr(ext, 'cx', 0) / EMU, h: nAttr(ext, 'cy', 0) / EMU,
      rot: nAttr(el, 'rot', 0) / 60000, flipH: bAttr(el, 'flipH'), flipV: bAttr(el, 'flipV'),
      chX: nAttr(kid(el, 'chOff'), 'x', 0) / EMU, chY: nAttr(kid(el, 'chOff'), 'y', 0) / EMU, chW: nAttr(kid(el, 'chExt'), 'cx', 0) / EMU, chH: nAttr(kid(el, 'chExt'), 'cy', 0) / EMU,
    };
  }

  async function drawTree(g, tree, C) {
    if (!tree) return;
    for (const el of kids(tree)) {
      try { await drawElement(g, el, C); } catch (e) { console.warn('Elemen slide dilewati:', el.localName, e); }
    }
  }

  async function drawElement(g, el, C) {
    const ln = el.localName;
    if (ln === 'AlternateContent') {
      const fb = kid(el, 'Fallback'), ch = kid(el, 'Choice');
      const pickEl = fb && kids(fb).length ? fb : ch;
      for (const c of kids(pickEl)) await drawElement(g, c, C);
      return;
    }
    const nv = kids(el).find((c) => /^nv/.test(c.localName));
    const cNv = kid(nv, 'cNvPr');
    if (cNv && bAttr(cNv, 'hidden')) return;
    const ph = phInfo(el);
    if (ph && C.level !== 'slide') return; // placeholder di layout/master tidak ikut tampil
    if (ln === 'sp' || ln === 'cxnSp') return drawShape(g, el, C, ph);
    if (ln === 'pic') return drawPic(g, el, C, ph);
    if (ln === 'grpSp') return drawGroup(g, el, C);
    if (ln === 'graphicFrame') return drawFrame(g, el, C);
  }

  /** Rantai pewarisan placeholder: [master, layout] untuk xfrm, bodyPr, lstStyle. */
  function inheritance(C, ph, el) {
    const out = { xfrm: null, bodyPr: [], lst: [], spPrs: [] };
    const slide = C.slide;
    const master = slide.master, layout = slide.layout;
    if (C.level === 'slide' && ph) {
      const lp = findLayoutPh(layout.phs, ph);
      const mp = findMasterPh(master.phs, lp ? { type: lp.type, idx: lp.idx } : ph);
      const cat = MASTER_TYPE(ph.type);
      out.lst.push(R_DEF(C));
      out.lst.push(cat === 'title' ? master.title : cat === 'body' ? master.body : master.other);
      for (const p of [mp, lp]) {
        if (!p) continue;
        const spPr = kid(p.el, 'spPr');
        const x = xfrmOf(kid(spPr, 'xfrm'));
        if (x) out.xfrm = x;
        out.spPrs.push(spPr);
        const tb = kid(p.el, 'txBody');
        out.bodyPr.push(kid(tb, 'bodyPr'));
        out.lst.push(kid(tb, 'lstStyle'));
      }
    } else {
      out.lst.push(R_DEF(C));
      out.lst.push(slide.master.other);
    }
    return out;
  }
  const R_DEF = (C) => C.R.defText;

  function applyXfrm(g, xf, noFlip) {
    g.translate(xf.x + xf.w / 2, xf.y + xf.h / 2);
    if (xf.rot) g.rotate((xf.rot * Math.PI) / 180);
    if (!noFlip) g.scale(xf.flipH ? -1 : 1, xf.flipV ? -1 : 1);
    g.translate(-xf.w / 2, -xf.h / 2);
  }

  async function paintFill(g, R, path, fill, box, alphaMul = 1) {
    if (!fill || fill.type === 'none' || fill.type === 'group') return;
    g.save();
    if (fill.type === 'solid') { g.fillStyle = css({ ...fill.color, a: (fill.color.a ?? 1) * alphaMul }); g.fill(path); }
    else if (fill.type === 'grad') {
      let gr;
      if (fill.radial) {
        gr = g.createRadialGradient(box.x + box.w / 2, box.y + box.h / 2, 0, box.x + box.w / 2, box.y + box.h / 2, Math.hypot(box.w, box.h) / 2);
      } else {
        const a = (fill.ang * Math.PI) / 180, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        const len = Math.abs(box.w * Math.cos(a)) + Math.abs(box.h * Math.sin(a));
        gr = g.createLinearGradient(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
      }
      for (const s of fill.stops) gr.addColorStop(clamp(s.pos, 0, 1), css({ ...s.color, a: (s.color.a ?? 1) * alphaMul }));
      g.fillStyle = gr;
      g.fill(path);
    } else if (fill.type === 'img') {
      const im = await R.image(fill.path);
      if (im) {
        g.clip(path);
        g.globalAlpha *= fill.alpha * alphaMul;
        drawCropped(g, im, fill.src, box);
      }
    }
    g.restore();
  }
  function drawCropped(g, im, src, box) {
    const s = src || { l: 0, t: 0, r: 0, b: 0 };
    const fw = 1 - s.l - s.r, fh = 1 - s.t - s.b;
    if (fw <= 0 || fh <= 0) return;
    const dw = box.w / fw, dh = box.h / fh;
    g.drawImage(im, box.x - s.l * dw, box.y - s.t * dh, dw, dh);
  }
  const DASH = { dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3], sysDashDot: [3, 1, 1, 1], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDotDot: [3, 1, 1, 1, 1, 1] };
  function strokePath(g, path, line) {
    if (!line || !line.color || line.w <= 0) return;
    g.save();
    g.strokeStyle = css(line.color);
    g.lineWidth = Math.max(0.5, line.w);
    g.lineJoin = 'round';
    g.lineCap = line.cap === 'rnd' ? 'round' : line.cap === 'sq' ? 'square' : 'butt';
    if (line.dash && DASH[line.dash]) g.setLineDash(DASH[line.dash].map((d) => d * Math.max(1, line.w)));
    g.stroke(path);
    g.restore();
  }
  function arrowHead(g, line, x1, y1, x2, y2) {
    // Kepala panah di (x2,y2) mengarah dari (x1,y1)
    const a = Math.atan2(y2 - y1, x2 - x1), s = Math.max(4, line.w * 3.5);
    g.save();
    g.fillStyle = css(line.color);
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45));
    g.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
    g.closePath();
    g.fill();
    g.restore();
  }

  async function drawShape(g, sp, C, ph) {
    const spPr = kid(sp, 'spPr');
    const inh = inheritance(C, ph, sp);
    const xf = xfrmOf(kid(spPr, 'xfrm')) || inh.xfrm;
    if (!xf) return;
    const style = kid(sp, 'style');
    const sc = C.sc;
    // Isian: spPr → placeholder induk → style
    let fill = parseFill(fillElOf(spPr), sc, null, C.rels);
    if (!fill) for (const p of inh.spPrs.slice().reverse()) { const f = parseFill(fillElOf(p), sc, null, C.slide.layout.rels); if (f) { fill = f; break; } }
    if (!fill && style) fill = styleRefFill(style, sc);
    if (fill && fill.type === 'group') fill = C.groupFill || null;
    let line = parseLine(spPr, style, sc);
    if (!kid(spPr, 'ln') && !style) for (const p of inh.spPrs.slice().reverse()) { if (kid(p, 'ln')) { line = parseLine(p, null, sc); break; } }
    const geomSrc = kid(spPr, 'custGeom') || kid(spPr, 'prstGeom') ? spPr : inh.spPrs.slice().reverse().find((p) => kid(p, 'custGeom') || kid(p, 'prstGeom')) || spPr;
    g.save();
    applyXfrm(g, xf);
    const paths = shapePath(geomSrc, xf.w, xf.h);
    for (const p of paths) {
      if (p.fill && fill && !p.open) await paintFill(g, C.R, p.path, fill, { x: 0, y: 0, w: xf.w, h: xf.h });
    }
    for (const p of paths) if (p.stroke) strokePath(g, p.path, line);
    const prst = attr(kid(geomSrc, 'prstGeom'), 'prst');
    if (line && (line.tail || line.head) && (paths[0].open || /line|Connector/.test(prst || ''))) {
      if (line.tail && line.tail !== 'none') arrowHead(g, line, 0, 0, xf.w, xf.h);
      if (line.head && line.head !== 'none') arrowHead(g, line, xf.w, xf.h, 0, 0);
    }
    g.restore();
    // Teks (tidak ikut dicerminkan)
    const tx = kid(sp, 'txBody');
    if (tx) {
      g.save();
      const txX = xfrmOf(kid(sp, 'txXfrm'));
      const box = txX || xf;
      applyXfrm(g, { ...box, rot: txX ? txX.rot : xf.rot }, true);
      const fr = kid(style, 'fontRef');
      const frc = fr ? resolveColor(fr, sc) : null;
      drawTextBody(g, tx, { x: 0, y: 0, w: box.w, h: box.h }, { sc, chain: inh, fontRefColor: frc, slideNum: C.slide.num, collect: C.collect });
      g.restore();
    }
  }

  async function drawPic(g, pic, C, ph) {
    const spPr = kid(pic, 'spPr');
    const inh = inheritance(C, ph, pic);
    const xf = xfrmOf(kid(spPr, 'xfrm')) || inh.xfrm;
    if (!xf || xf.w <= 0 || xf.h <= 0) return;
    const bf = kid(pic, 'blipFill');
    const fill = parseFill(bf, C.sc, null, C.rels);
    g.save();
    applyXfrm(g, xf);
    const paths = shapePath(spPr, xf.w, xf.h);
    if (fill && fill.type === 'img') await paintFill(g, C.R, paths[0].path, fill, { x: 0, y: 0, w: xf.w, h: xf.h });
    strokePath(g, paths[0].path, parseLine(spPr, kid(pic, 'style'), C.sc));
    g.restore();
  }

  async function drawGroup(g, grp, C) {
    const gp = kid(grp, 'grpSpPr');
    const xf = xfrmOf(kid(gp, 'xfrm'));
    g.save();
    if (xf) {
      applyXfrm(g, xf);
      const sx = xf.chW ? xf.w / xf.chW : 1, sy = xf.chH ? xf.h / xf.chH : 1;
      g.scale(sx, sy);
      g.translate(-xf.chX, -xf.chY);
    }
    const gf = parseFill(fillElOf(gp), C.sc, null, C.rels);
    const sub = { ...C, groupFill: gf && gf.type !== 'group' ? gf : C.groupFill };
    for (const el of kids(grp)) {
      if (['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(el.localName)) continue;
      try { await drawElement(g, el, sub); } catch (e) { console.warn('Elemen grup dilewati', e); }
    }
    g.restore();
  }

  async function drawFrame(g, fr, C) {
    const xf = xfrmOf(kid(fr, 'xfrm'));
    if (!xf) return;
    const gd = at(fr, 'graphic', 'graphicData');
    if (!gd) return;
    const uri = attr(gd, 'uri', '');
    if (/table$/.test(uri)) {
      g.save();
      applyXfrm(g, xf);
      await drawTable(g, kid(gd, 'tbl'), xf, C);
      g.restore();
      return;
    }
    if (/chart$/.test(uri)) {
      const ch = kid(gd, 'chart');
      const r = C.rels[rid(ch, 'id')];
      if (r) {
        g.save();
        applyXfrm(g, xf);
        await drawChart(g, r.target, xf.w, xf.h, C);
        g.restore();
      }
      return;
    }
    if (/diagram$/.test(uri)) {
      // SmartArt: PowerPoint menyimpan versi gambar jadi (diagramDrawing)
      const relIds = kid(gd, 'relIds');
      let drawPath = null;
      const dm = relIds && C.rels[rid(relIds, 'dm')];
      if (dm) {
        const dx = await C.R.pkg.xml(dm.target);
        const ext = desc(dx, 'dataModelExt')[0];
        const rel = ext && C.rels[attr(ext, 'relId')];
        if (rel) drawPath = rel.target;
      }
      if (!drawPath) { const all = Object.values(C.rels).filter((r) => r.type === 'diagramDrawing'); if (all.length === 1) drawPath = all[0].target; }
      if (!drawPath) return;
      const dxml = await C.R.pkg.xml(drawPath);
      const drels = await C.R.pkg.rels(drawPath);
      const tree = at(dxml, 'spTree');
      g.save();
      g.translate(xf.x, xf.y);
      await drawTree(g, tree, { ...C, rels: drels, level: 'diagram' });
      g.restore();
      return;
    }
    // Objek OLE / lainnya: gambar pratinjau jika ada
    const pic = desc(gd, 'pic')[0];
    if (pic) {
      const spPr = kid(pic, 'spPr');
      const pxf = xfrmOf(kid(spPr, 'xfrm'));
      if (!pxf || !pxf.w) {
        const bf = kid(pic, 'blipFill');
        const fill = parseFill(bf, C.sc, null, C.rels);
        if (fill && fill.type === 'img') { g.save(); applyXfrm(g, xf); const p = new Path2D(); p.rect(0, 0, xf.w, xf.h); await paintFill(g, C.R, p, fill, { x: 0, y: 0, w: xf.w, h: xf.h }); g.restore(); }
      } else await drawPic(g, pic, C, null);
    }
  }

  // ---------- Tabel ----------
  async function tableStyleOf(C, id) {
    const R = C.R;
    if (!R.tblStyles) {
      R.tblStyles = (async () => {
        const rels = await R.pkg.rels(R.presPath);
        const r = relOfType(rels, 'tableStyles');
        const x = r ? await R.pkg.xml(r.target) : null;
        const map = new Map();
        for (const s of kids(x, 'tblStyle')) map.set(attr(s, 'styleId'), s);
        return map;
      })();
    }
    const map = await R.tblStyles;
    return map.get(id) || null;
  }
  function defaultTableStyle(sc) {
    // Mirip "Medium Style 2 – Accent 1" (gaya bawaan PowerPoint)
    const a1 = sc.theme.colors.accent1 || hexColor('4472C4');
    const lt = sc.theme.colors[sc.clrMap.bg1 || 'lt1'] || hexColor('FFFFFF');
    const dk = sc.theme.colors[sc.clrMap.tx1 || 'dk1'] || BLACK;
    const tint = (t) => mix(a1, hexColor('FFFFFF'), t);
    const white = { w: 1, color: lt };
    return {
      wholeTbl: { fill: tint(0.2), color: dk, bdr: { left: white, right: white, top: white, bottom: white, insideH: white, insideV: white } },
      band1H: { fill: tint(0.4) }, band1V: { fill: tint(0.4) },
      firstRow: { fill: a1, color: lt, b: true, bdr: { bottom: { w: 3, color: lt } } }, lastRow: { fill: a1, color: lt, b: true, bdr: { top: { w: 3, color: lt } } },
      firstCol: { fill: a1, color: lt, b: true }, lastCol: { fill: a1, color: lt, b: true },
    };
  }
  function parseTblStyle(el, sc) {
    const out = {};
    for (const part of kids(el)) {
      const tcs = kid(part, 'tcStyle'), txs = kid(part, 'tcTxStyle');
      const P = {};
      const f = fillElOf(tcs) || at(tcs, 'fill') && fillElOf(at(tcs, 'fill'));
      if (f) { const pf = parseFill(f, sc); if (pf && pf.type === 'solid') P.fill = pf.color; else if (pf && pf.type === 'none') P.fill = null; }
      const fr = kid(tcs, 'fillRef');
      if (fr) P.fill = resolveColor(fr, sc);
      const bd = kid(tcs, 'tcBdr');
      if (bd) {
        P.bdr = {};
        for (const sEl of kids(bd)) {
          const lnEl = kid(sEl, 'ln');
          if (lnEl) {
            const f2 = fillElOf(lnEl);
            P.bdr[sEl.localName] = f2 && f2.localName === 'noFill' ? null : { w: nAttr(lnEl, 'w', 12700) / EMU, color: f2 ? resolveColor(f2, sc) : BLACK };
          } else if (kid(sEl, 'lnRef')) {
            P.bdr[sEl.localName] = { w: 1, color: resolveColor(kid(sEl, 'lnRef'), sc) || BLACK };
          }
        }
      }
      if (txs) {
        if (attr(txs, 'b') === 'on') P.b = true;
        if (attr(txs, 'i') === 'on') P.i = true;
        const c = colorEl(txs) || colorEl(kid(txs, 'fontRef'));
        if (c) P.color = resolveColor(c, sc);
      }
      out[part.localName] = P;
    }
    return out;
  }
  async function drawTable(g, tbl, xf, C) {
    if (!tbl) return;
    const sc = C.sc;
    const grid = kids(at(tbl, 'tblGrid'), 'gridCol').map((c) => nAttr(c, 'w', 0) / EMU);
    const trs = kids(tbl, 'tr');
    const tblPr = kid(tbl, 'tblPr');
    const flags = { firstRow: bAttr(tblPr, 'firstRow'), lastRow: bAttr(tblPr, 'lastRow'), firstCol: bAttr(tblPr, 'firstCol'), lastCol: bAttr(tblPr, 'lastCol'), bandRow: bAttr(tblPr, 'bandRow'), bandCol: bAttr(tblPr, 'bandCol') };
    const sid = (at(tblPr, 'tableStyleId') || {}).textContent;
    let TS;
    const NO_STYLE = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}', GRID = '{5940675A-B579-460E-94D1-54222C63F5DA}';
    if (sid === NO_STYLE) TS = {};
    else if (sid === GRID) { const b = { w: 1, color: BLACK }; TS = { wholeTbl: { bdr: { left: b, right: b, top: b, bottom: b, insideH: b, insideV: b } } }; }
    else {
      const el = sid ? await tableStyleOf(C, sid) : null;
      TS = el ? parseTblStyle(el, sc) : sid || kid(tblPr, 'tableStyleId') ? defaultTableStyle(sc) : {};
    }
    // Isian tabel langsung (tblPr fill)
    const tf = parseFill(fillElOf(tblPr), sc);
    const nR = trs.length, nC = grid.length;
    const colX = [0];
    grid.forEach((w, i) => colX.push(colX[i] + w));
    // Hitung tinggi baris (minimal tinggi tersimpan, bertambah mengikuti teks)
    const rowH = trs.map((tr) => nAttr(tr, 'h', 0) / EMU);
    const measureCanvas = document.createElement('canvas').getContext('2d');
    const cellsInfo = [];
    trs.forEach((tr, r) => {
      kids(tr, 'tc').forEach((tc, c) => {
        if (bAttr(tc, 'hMerge') || bAttr(tc, 'vMerge')) return;
        const gs = nAttr(tc, 'gridSpan', 1), rs = nAttr(tc, 'rowSpan', 1);
        cellsInfo.push({ tc, r, c, gs, rs });
        if (rs === 1) {
          const tcPr = kid(tc, 'tcPr');
          const w = colX[Math.min(nC, c + gs)] - colX[c] - nAttr(tcPr, 'marL', 91440) / EMU - nAttr(tcPr, 'marR', 91440) / EMU;
          const ps = partStyle(TS, flags, r, c, nR, nC);
          const textH = drawTextBody(measureCanvas, kid(tc, 'txBody'), { x: 0, y: 0, w, h: 1e6 }, { sc, chain: tableChain(C, ps, 't'), fontRefColor: ps.color || null, slideNum: C.slide.num, measure: true }) || 0;
          const need = textH + nAttr(tcPr, 'marT', 45720) / EMU + nAttr(tcPr, 'marB', 45720) / EMU;
          if (need > rowH[r]) rowH[r] = need;
        }
      });
    });
    const rowY = [0];
    rowH.forEach((h, i) => rowY.push(rowY[i] + h));
    if (tf && tf.type === 'solid') { g.fillStyle = css(tf.color); g.fillRect(0, 0, colX[nC], rowY[nR]); }
    const borders = [];
    for (const ci of cellsInfo) {
      const { tc, r, c, gs, rs } = ci;
      const x = colX[c], y = rowY[r], w = colX[Math.min(nC, c + gs)] - x, h = rowY[Math.min(nR, r + rs)] - y;
      const tcPr = kid(tc, 'tcPr');
      const ps = partStyle(TS, flags, r, c, nR, nC, r + rs - 1, c + gs - 1);
      let fill = ps.fill ? { type: 'solid', color: ps.fill } : null;
      const own = parseFill(fillElOf(tcPr), sc, null, C.rels);
      if (own) fill = own;
      const p = new Path2D(); p.rect(x, y, w, h);
      if (fill) await paintFill(g, C.R, p, fill, { x, y, w, h });
      const side = (tag, def) => {
        const lnEl = kid(tcPr, tag);
        if (lnEl) { const f = fillElOf(lnEl); if (f && f.localName === 'noFill') return null; if (f) return { w: nAttr(lnEl, 'w', 12700) / EMU, color: resolveColor(f, sc) }; }
        return def;
      };
      const B = ps.bdr || {};
      borders.push({ x, y, w, h,
        l: side('lnL', c === 0 ? B.left : B.insideV), r: side('lnR', c + gs >= nC ? B.right : B.insideV),
        t: side('lnT', r === 0 ? B.top : B.insideH), b: side('lnB', r + rs >= nR ? B.bottom : B.insideH) });
      // Teks
      const box = { x: x + nAttr(tcPr, 'marL', 91440) / EMU, y: y + nAttr(tcPr, 'marT', 45720) / EMU, w: w - nAttr(tcPr, 'marL', 91440) / EMU - nAttr(tcPr, 'marR', 91440) / EMU, h: h - nAttr(tcPr, 'marT', 45720) / EMU - nAttr(tcPr, 'marB', 45720) / EMU };
      const anchor = attr(tcPr, 'anchor', 't');
      drawTextBody(g, kid(tc, 'txBody'), box, { sc, chain: tableChain(C, ps, anchor), fontRefColor: ps.color || null, slideNum: C.slide.num, collect: C.collect });
    }
    for (const b of borders) {
      const L = (s, x1, y1, x2, y2) => { if (!s || !s.color || s.w <= 0) return; g.strokeStyle = css(s.color); g.lineWidth = s.w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
      L(b.t, b.x, b.y, b.x + b.w, b.y); L(b.b, b.x, b.y + b.h, b.x + b.w, b.y + b.h);
      L(b.l, b.x, b.y, b.x, b.y + b.h); L(b.r, b.x + b.w, b.y, b.x + b.w, b.y + b.h);
    }
  }
  function partStyle(TS, f, r, c, nR, nC, r2 = r, c2 = c) {
    const out = { fill: undefined, color: undefined, b: false, bdr: null };
    const apply = (p) => {
      if (!p) return;
      if (p.fill !== undefined) out.fill = p.fill;
      if (p.color) out.color = p.color;
      if (p.b) out.b = true;
      if (p.i) out.i = true;
      if (p.bdr) out.bdr = { ...(out.bdr || {}), ...p.bdr };
    };
    apply(TS.wholeTbl);
    const dataR = r - (f.firstRow ? 1 : 0);
    if (f.bandRow && dataR >= 0 && dataR % 2 === 0) apply(TS.band1H);
    if (f.bandRow && dataR >= 0 && dataR % 2 === 1) apply(TS.band2H);
    const dataC = c - (f.firstCol ? 1 : 0);
    if (f.bandCol && dataC >= 0 && dataC % 2 === 0) apply(TS.band1V);
    if (f.lastCol && c2 === nC - 1) apply(TS.lastCol);
    if (f.firstCol && c === 0) apply(TS.firstCol);
    if (f.lastRow && r2 === nR - 1) apply(TS.lastRow);
    if (f.firstRow && r === 0) apply(TS.firstRow);
    return out;
  }
  function tableChain(C, ps, anchor) {
    const bp = document.implementation.createDocument(null, 'bodyPr', null).documentElement;
    bp.setAttribute('lIns', '0'); bp.setAttribute('rIns', '0'); bp.setAttribute('tIns', '0'); bp.setAttribute('bIns', '0');
    bp.setAttribute('anchor', anchor);
    const chain = { bodyPr: [bp], lst: [C.R.defText, C.slide.master.other], spPrs: [] };
    if (ps.b || ps.i) {
      const lst = document.implementation.createDocument(null, 'lstStyle', null).documentElement;
      for (let k = 1; k <= 9; k++) {
        const l = lst.ownerDocument.createElement(`lvl${k}pPr`);
        const d = lst.ownerDocument.createElement('defRPr');
        if (ps.b) d.setAttribute('b', '1');
        if (ps.i) d.setAttribute('i', '1');
        l.appendChild(d); lst.appendChild(l);
      }
      chain.lst.push(lst);
    }
    return chain;
  }
  // ---------- Grafik (chart) sederhana ----------
  async function drawChart(g, path, w, h, C) {
    const x = await C.R.pkg.xml(path);
    if (!x) return;
    const sc = C.sc;
    const chart = kid(x, 'chart');
    const plot = kid(chart, 'plotArea');
    const types = ['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'pieChart', 'pie3DChart', 'doughnutChart', 'areaChart', 'area3DChart', 'scatterChart', 'radarChart'];
    const tEl = kids(plot).find((e) => types.includes(e.localName));
    if (!tEl) return;
    const type = tEl.localName.replace('3D', '');
    const strPts = (ref) => {
      const cache = ref && (desc(ref, 'strCache')[0] || desc(ref, 'numCache')[0] || desc(ref, 'strLit')[0] || desc(ref, 'numLit')[0]);
      const out = [];
      for (const p of kids(cache, 'pt')) out[nAttr(p, 'idx', 0)] = (kid(p, 'v') || {}).textContent;
      return out;
    };
    // Semua seri dari semua tipe di plotArea (mis. kombinasi batang + garis) disederhanakan ke tipe pertama
    const series = kids(tEl, 'ser').map((s, i) => {
      const spPr = kid(s, 'spPr');
      const f = parseFill(fillElOf(spPr), sc);
      const lnF = parseLine(spPr, null, sc);
      const accents = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
      const base = sc.theme.colors[accents[i % 6]] || BLACK;
      const dPts = new Map(kids(s, 'dPt').map((d) => [nAttr(kid(d, 'idx'), 'val', 0), parseFill(fillElOf(kid(d, 'spPr')), sc)]));
      return {
        name: strPts(kid(s, 'tx')).join(' ') || `Seri ${i + 1}`,
        cats: strPts(kid(s, 'cat') || kid(s, 'xVal')), vals: strPts(kid(s, 'val') || kid(s, 'yVal')).map((v) => (v == null ? null : +v)),
        color: (f && f.type === 'solid' && f.color) || (lnF && lnF.color) || base, dPts,
      };
    });
    if (!series.length) return;
    const chartFill = parseFill(fillElOf(kid(x, 'spPr')), sc);
    if (chartFill && chartFill.type === 'solid') { g.fillStyle = css(chartFill.color); g.fillRect(0, 0, w, h); }
    const textCol = sc.theme.colors[sc.clrMap.tx1 || 'dk1'] || BLACK;
    const grey = mix(textCol, hexColor('FFFFFF'), 0.65);
    const fsz = clamp(Math.min(w, h) / 22, 7, 14);
    g.font = `${fsz}px ${fontStack(null, sc)}`;
    g.textBaseline = 'alphabetic';
    let top = 6, bottom = h - 6;
    // Judul
    const titleEl = kid(chart, 'title');
    let title = titleEl ? desc(titleEl, 't').map((t) => t.textContent).join('') : '';
    if (!title && titleEl && series.length === 1) title = series[0].name;
    if (!title && !titleEl && series.length === 1 && !bAttr(kid(chart, 'autoTitleDeleted'), 'val') && /pie|doughnut/.test(type)) title = series[0].name;
    if (title) {
      g.font = `${fsz * 1.35}px ${fontStack(null, sc)}`;
      g.fillStyle = css(textCol);
      g.textAlign = 'center';
      g.fillText(title, w / 2, top + fsz * 1.35);
      top += fsz * 2.1;
      g.font = `${fsz}px ${fontStack(null, sc)}`;
    }
    const pie = /pie|doughnut/.test(type);
    const cats = series[0].cats.length ? series[0].cats : series[0].vals.map((_, i) => String(i + 1));
    // Legenda
    const legend = kid(chart, 'legend');
    const legItems = pie ? cats.map((c, i) => ({ t: c, col: pieColor(series[0], i, sc) })) : series.map((s) => ({ t: s.name, col: s.color }));
    if (legend && legItems.length) {
      const pos = attr(kid(legend, 'legendPos'), 'val', 'r');
      g.textAlign = 'left';
      if (pos === 'r' || pos === 'l') {
        const lw = Math.min(w * 0.3, Math.max(...legItems.map((it) => g.measureText(it.t || '').width)) + fsz * 2);
        const lx = pos === 'r' ? w - lw : 4;
        let ly = (top + bottom) / 2 - (legItems.length * fsz * 1.5) / 2;
        for (const it of legItems) { g.fillStyle = css(it.col); g.fillRect(lx, ly, fsz * 0.8, fsz * 0.8); g.fillStyle = css(textCol); g.fillText(it.t || '', lx + fsz * 1.2, ly + fsz * 0.8); ly += fsz * 1.5; }
        if (pos === 'r') w -= lw + 6; else { g.translate(lw + 6, 0); w -= lw + 6; }
      } else {
        const widths = legItems.map((it) => g.measureText(it.t || '').width + fsz * 2.2);
        const tot = widths.reduce((a, b) => a + b, 0);
        let lx = Math.max(4, w / 2 - tot / 2);
        const ly = pos === 't' ? top : bottom - fsz;
        legItems.forEach((it, i) => { g.fillStyle = css(it.col); g.fillRect(lx, ly, fsz * 0.8, fsz * 0.8); g.fillStyle = css(textCol); g.fillText(it.t || '', lx + fsz * 1.1, ly + fsz * 0.8); lx += widths[i]; });
        if (pos === 't') top += fsz * 1.8; else bottom -= fsz * 1.8;
      }
    }
    const showVal = desc(tEl, 'showVal').some((e) => bAttr(e, 'val')) ;
    const showPct = desc(tEl, 'showPercent').some((e) => bAttr(e, 'val'));
    if (pie) {
      const s = series[0];
      const vals = s.vals.map((v) => Math.max(0, v || 0));
      const tot = vals.reduce((a, b) => a + b, 0) || 1;
      const cx = w / 2, cy = (top + bottom) / 2, rad = Math.max(5, Math.min(w, bottom - top) / 2 - 4);
      const hole = type === 'doughnutChart' ? rad * (nAttr(kid(tEl, 'holeSize'), 'val', 50) / 100) : 0;
      let a = -Math.PI / 2 + ((nAttr(kid(tEl, 'firstSliceAng'), 'val', 0) * Math.PI) / 180);
      vals.forEach((v, i) => {
        const da = (v / tot) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + hole * Math.cos(a), cy + hole * Math.sin(a));
        g.arc(cx, cy, rad, a, a + da);
        if (hole) g.arc(cx, cy, hole, a + da, a, true); else g.lineTo(cx, cy);
        g.closePath();
        g.fillStyle = css(pieColor(s, i, sc));
        g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
        if ((showPct || showVal) && v > 0) {
          const m = a + da / 2, rr = hole ? (rad + hole) / 2 : rad * 0.65;
          g.fillStyle = '#fff'; g.textAlign = 'center';
          g.fillText(showPct ? Math.round((v / tot) * 100) + '%' : String(v), cx + rr * Math.cos(m), cy + rr * Math.sin(m) + fsz / 3);
        }
        a += da;
      });
      return;
    }
    // Sumbu
    const barDir = attr(kid(tEl, 'barDir'), 'val', 'col');
    const grouping = attr(kid(tEl, 'grouping'), 'val', 'clustered');
    const stacked = /stacked/i.test(grouping), pct = grouping === 'percentStacked';
    const n = Math.max(...series.map((s) => s.vals.length));
    let mn = 0, mx = 0;
    for (let i = 0; i < n; i++) {
      if (stacked) {
        let pos = 0, neg = 0;
        series.forEach((s) => { const v = s.vals[i] || 0; if (v >= 0) pos += v; else neg += v; });
        if (pct) { mx = 1; mn = Math.min(mn, neg < 0 ? -1 : 0); } else { mx = Math.max(mx, pos); mn = Math.min(mn, neg); }
      } else series.forEach((s) => { const v = s.vals[i]; if (v != null) { mx = Math.max(mx, v); mn = Math.min(mn, v); } });
    }
    if (mx === mn) mx = mn + 1;
    const step = niceStep((mx - mn) / 5);
    mx = Math.ceil(mx / step - 1e-9) * step; mn = Math.floor(mn / step + 1e-9) * step;
    const horiz = type === 'barChart' && barDir === 'bar';
    const fmtV = (v) => (pct ? Math.round(v * 100) + '%' : Math.abs(step) < 1 ? v.toFixed(Math.min(4, Math.ceil(-Math.log10(step)))) : Math.round(v).toLocaleString('id-ID'));
    g.textAlign = 'right';
    const labW = Math.max(...[mn, mx].map((v) => g.measureText(fmtV(v)).width)) + 6;
    const catLabW = horiz ? Math.min(w * 0.3, Math.max(...cats.map((c) => g.measureText(String(c ?? '')).width)) + 6) : 0;
    const L0 = 4 + (horiz ? catLabW : labW), R0 = w - 8, T0 = top + 4, B0 = bottom - fsz * 1.8;
    const pw = R0 - L0, ph = B0 - T0;
    if (pw < 10 || ph < 10) return;
    const vPos = (v) => (horiz ? L0 + ((v - mn) / (mx - mn)) * pw : B0 - ((v - mn) / (mx - mn)) * ph);
    g.lineWidth = 0.6;
    g.strokeStyle = css(mix(grey, hexColor('FFFFFF'), 0.5));
    g.fillStyle = css(grey);
    for (let v = mn; v <= mx + step / 2; v += step) {
      const p = vPos(v);
      g.beginPath();
      if (horiz) { g.moveTo(p, T0); g.lineTo(p, B0); } else { g.moveTo(L0, p); g.lineTo(R0, p); }
      g.stroke();
      if (horiz) { g.textAlign = 'center'; g.fillText(fmtV(v), p, B0 + fsz * 1.2); } else { g.textAlign = 'right'; g.fillText(fmtV(v), L0 - 4, p + fsz / 3); }
    }
    const nCat = Math.max(1, n);
    const band = (horiz ? ph : pw) / nCat;
    g.fillStyle = css(grey);
    cats.forEach((c, i) => {
      const t = String(c ?? '');
      if (horiz) { g.textAlign = 'right'; g.fillText(t, L0 - 4, T0 + band * (i + 0.5) + fsz / 3); }
      else {
        g.textAlign = 'center';
        const maxW = band - 2;
        let tt = t;
        while (tt.length > 1 && g.measureText(tt).width > maxW) tt = tt.slice(0, -2) + '…';
        g.fillText(tt, L0 + band * (i + 0.5), B0 + fsz * 1.2);
      }
    });
    if (type === 'barChart') {
      const gap = nAttr(kid(tEl, 'gapWidth'), 'val', 150) / 100;
      const groupW = band / (1 + gap);
      const bw = stacked ? groupW : groupW / series.length;
      for (let i = 0; i < n; i++) {
        let posAcc = 0, negAcc = 0;
        const tot = pct ? series.reduce((a, s) => a + Math.abs(s.vals[i] || 0), 0) || 1 : 1;
        series.forEach((s, k) => {
          let v = s.vals[i];
          if (v == null) return;
          if (pct) v /= tot;
          let a0, a1;
          if (stacked) { if (v >= 0) { a0 = posAcc; posAcc += v; a1 = posAcc; } else { a0 = negAcc; negAcc += v; a1 = negAcc; } }
          else { a0 = 0; a1 = v; }
          const p0 = vPos(Math.max(mn, Math.min(mx, a0))), p1 = vPos(Math.max(mn, Math.min(mx, a1)));
          const off = band * i + (band - groupW) / 2 + (stacked ? 0 : bw * k);
          const df = s.dPts.get(i);
          g.fillStyle = css((df && df.type === 'solid' && df.color) || s.color);
          if (horiz) g.fillRect(Math.min(p0, p1), T0 + off, Math.abs(p1 - p0), bw);
          else g.fillRect(L0 + off, Math.min(p0, p1), bw, Math.abs(p1 - p0));
          if (showVal) {
            g.fillStyle = css(textCol); g.textAlign = 'center';
            if (horiz) g.fillText(String(s.vals[i]), Math.max(p0, p1) + 12, T0 + off + bw / 2 + fsz / 3);
            else g.fillText(String(s.vals[i]), L0 + off + bw / 2, Math.min(p0, p1) - 3);
          }
        });
      }
    } else {
      series.forEach((s) => {
        g.strokeStyle = css(s.color); g.fillStyle = css(s.color); g.lineWidth = 2;
        const pts = s.vals.map((v, i) => (v == null ? null : [L0 + band * (i + 0.5), vPos(v)]));
        if (/area/.test(type)) {
          g.beginPath(); g.moveTo(pts.find(Boolean)[0], vPos(Math.max(mn, 0)));
          pts.forEach((p) => p && g.lineTo(p[0], p[1]));
          g.lineTo(pts.filter(Boolean).pop()[0], vPos(Math.max(mn, 0))); g.closePath();
          g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
          return;
        }
        g.beginPath();
        let started = false;
        pts.forEach((p) => { if (!p) { started = false; return; } if (!started) { g.moveTo(p[0], p[1]); started = true; } else g.lineTo(p[0], p[1]); });
        if (type !== 'scatterChart' || attr(kid(tEl, 'scatterStyle'), 'val', '') !== 'marker') g.stroke();
        pts.forEach((p) => { if (p) { g.beginPath(); g.arc(p[0], p[1], 2.5, 0, Math.PI * 2); g.fill(); } });
      });
    }
    g.strokeStyle = css(grey); g.lineWidth = 0.8;
    g.beginPath();
    if (horiz) { g.moveTo(vPos(Math.max(mn, 0)), T0); g.lineTo(vPos(Math.max(mn, 0)), B0); } else { g.moveTo(L0, vPos(Math.max(mn, 0))); g.lineTo(R0, vPos(Math.max(mn, 0))); }
    g.stroke();
  }
  function pieColor(s, i, sc) {
    const d = s.dPts.get(i);
    if (d && d.type === 'solid') return d.color;
    const acc = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
    const base = sc.theme.colors[acc[i % 6]] || BLACK;
    const round = Math.floor(i / 6);
    return round ? mix(base, round % 2 ? BLACK : hexColor('FFFFFF'), 1 - 0.25 * round) : base;
  }
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  // ---------- PPTX → PDF ----------
  async function pptxToPdf(file, opt, progress) {
    const L = PL();
    const pkg = await openZip(file, 'PowerPoint');
    const root = await pkg.rels('');
    const presPath = (relOfType(root, 'officeDocument') || {}).target || 'ppt/presentation.xml';
    const pres = await pkg.xml(presPath);
    if (!pres || pres.localName !== 'presentation') throw userErr(`"${file.name}" tidak dapat dibaca sebagai presentasi PowerPoint (.pptx).`);
    const presRels = await pkg.rels(presPath);
    const sz = kid(pres, 'sldSz');
    const W = nAttr(sz, 'cx', 12192000) / EMU, H = nAttr(sz, 'cy', 6858000) / EMU;
    const slides = kids(kid(pres, 'sldIdLst'), 'sldId').map((s) => presRels[rid(s, 'id')]).filter((r) => r && !r.external);
    if (!slides.length) throw userErr(`"${file.name}" tidak berisi slide.`);
    const R = new PptxRenderer(pkg, pres, presPath);
    const doc = await L.PDFDocument.create();
    doc.setProducer('KlinikPDF'); doc.setCreator('KlinikPDF');
    const helv = await doc.embedFont(L.StandardFonts.Helvetica);
    let scale = (+opt.dpi || 150) / 72;
    scale = Math.min(scale, 4200 / Math.max(W, H));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    const g = canvas.getContext('2d');
    let made = 0;
    for (let i = 0; i < slides.length; i++) {
      const path = slides[i].target;
      const sx = await pkg.xml(path);
      if (!sx) continue;
      if (attr(sx, 'show') === '0' && !opt.hidden) continue;
      progress && progress(`Menggambar slide ${i + 1}/${slides.length}…`, i / slides.length);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.textBaseline = 'alphabetic';
      const texts = [];
      const collect = (gg, t, x, y, size, w) => {
        const m = gg.getTransform();
        if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || m.a < 0 || m.d < 0) return;
        const p = m.transformPoint(new DOMPoint(x, y));
        texts.push({ t, x: p.x / scale, y: p.y / scale, size: size * (m.a / scale), w: w * (m.a / scale) });
      };
      try { await renderSlide(R, path, i + 1, g, W, H, collect); }
      catch (e) { if (e.user) throw e; console.warn('Slide gagal digambar sebagian', e); }
      const jpg = await canvasBytes(canvas, 'image/jpeg', 0.92);
      const page = doc.addPage([W, H]);
      page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: W, height: H });
      // Lapisan teks tak terlihat (agar PDF bisa dicari & disalin)
      for (const t of texts) {
        const s = winAnsi(t.t).trim();
        if (!s || !t.size) continue;
        const nat = helv.widthOfTextAtSize(s, t.size);
        const size = nat > 0 ? clamp(t.size * (t.w / nat), t.size * 0.5, t.size * 1.5) : t.size;
        try { page.drawText(s, { x: t.x, y: H - t.y, size, font: helv, opacity: 0 }); } catch (_) { /* abaikan */ }
      }
      made++;
      await yieldUI(true);
    }
    if (!made) throw userErr('Semua slide disembunyikan. Centang "Sertakan slide tersembunyi" untuk mengonversinya.');
    return doc.save();
  }

  window.KlinikOffice = { sheetToPdf, pptxToPdf, _formatValue: formatValue };
})();
