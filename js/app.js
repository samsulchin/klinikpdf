/* ==========================================================
   KlinikPDF — Aplikasi tanda tangan digital (100% di browser)
   Dibuat oleh Samsul Arifin — https://github.com/samsulchin
   Library: pdf.js, pdf-lib, qrcode-generator, docx-preview,
            JSZip, html2canvas (semua disimpan lokal di /vendor)
   ========================================================== */
(() => {
  'use strict';

  // ---------- Util ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dpr = () => Math.min(window.devicePixelRatio || 1, 3);
  const IS_FILE = location.protocol === 'file:';

  const TEXT_FONT = 'Arial, Helvetica, sans-serif';
  const UI_FONT = '"Plus Jakarta Sans", Arial, sans-serif';
  const LINE_H = 1.15;
  const INK = ['#111827', '#1d4ed8', '#b91c1c'];
  const SIG_FONTS = ['Dancing Script', 'Great Vibes', 'Sacramento', 'Allura', 'Satisfy', 'Caveat'];
  const STORE_KEY = 'ttdin.signatures.v1';
  const MAX_SAVED = 12;

  const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    copy: svg('<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
    layers: svg('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.5),
    ok: svg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>'),
    warn: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'),
    grip: svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>', 2.5),
  };

  // ---------- Toast & loading ----------
  let toastTimer;
  function toast(msg, type = 'info') {
    const t = $('#toast');
    t.innerHTML = (type === 'error' ? ICON.warn : type === 'ok' ? ICON.ok : '') + '<span></span>';
    t.lastChild.textContent = msg;
    t.className = 'toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), type === 'error' ? 5500 : 3400);
  }
  function showLoading(text) { $('#loadingText').textContent = text; $('#loading').classList.add('show'); }
  function hideLoading() { $('#loading').classList.remove('show'); }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Gambar tidak dapat dibaca'));
      img.src = src;
    });
  }
  function canvasToBlob(c, type, q) {
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob gagal'))), type, q));
  }
  function dataUrlToBytes(url) {
    const bin = atob(url.split(',')[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
  }
  /** Potong area transparan di sekeliling gambar. */
  function trimCanvas(c, pad = 8) {
    const w = c.width, h = c.height;
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const o = document.createElement('canvas');
    o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  }
  /** Perkecil kanvas agar sisi terpanjang tidak melebihi `max`. */
  function limitCanvas(c, max) {
    const k = max / Math.max(c.width, c.height);
    if (k >= 1) return c;
    const o = document.createElement('canvas');
    o.width = Math.round(c.width * k); o.height = Math.round(c.height * k);
    const x = o.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, o.width, o.height);
    return o;
  }
  function formatDate(d = new Date()) {
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function formatDateTime(d = new Date()) {
    try {
      return d.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    } catch (_) { return d.toLocaleString('id-ID'); }
  }
  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(buf) : buf.forEach((_, i) => { buf[i] = Math.random() * 256; });
    return 'TTD-' + Array.from(buf, (b) => chars[b % chars.length]).join('');
  }
  async function sha256Hex(buf) {
    try {
      if (!window.crypto || !crypto.subtle) return '';
      const h = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return ''; }
  }
  /** Cari teks (ASCII) di dalam isi file tanpa memuat semuanya sebagai string sekaligus. */
  function bytesInclude(bytes, needle) {
    const dec = new TextDecoder('latin1');
    const CH = 4 << 20;
    for (let i = 0; i < bytes.length; i += CH) {
      const s = dec.decode(bytes.subarray(i, Math.min(bytes.length, i + CH + 32)));
      if (s.includes(needle)) return true;
    }
    return false;
  }
  /** Deteksi PDF yang sudah ditandatangani digital (termasuk e-Meterai). */
  function hasDigitalSignature(bytes) { return bytesInclude(bytes, '/ByteRange'); }

  // ---------- Memuat library (lazy, dari folder vendor) ----------
  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete scriptCache[src]; reject(new Error('Gagal memuat ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }
  async function ensureLibs() {
    const jobs = [loadScript('vendor/pdf.min.js'), loadScript('vendor/pdf-lib.min.js')];
    // Saat dibuka langsung dari folder (file://), Web Worker diblokir browser,
    // jadi mesin PDF dijalankan di thread utama.
    if (IS_FILE) jobs.push(loadScript('vendor/pdf.worker.min.js'));
    await Promise.all(jobs);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }
  async function ensureQr() {
    await loadScript('vendor/qrcode.js');
    if (window.qrcode && window.qrcode.stringToBytesFuncs) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
  }
  async function ensureDocx() {
    await loadScript('vendor/jszip.min.js');
    await Promise.all([loadScript('vendor/docx-preview.min.js'), loadScript('vendor/html2canvas.min.js')]);
  }

  // ==========================================================
  // LANDING
  // ==========================================================
  $('#year').textContent = new Date().getFullYear();
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  $('#navToggle').addEventListener('click', () => {
    const open = $('#navLinks').classList.toggle('open');
    $('#navToggle').setAttribute('aria-expanded', String(open));
  });
  $$('#navLinks a, #navLinks button').forEach((a) => a.addEventListener('click', () => $('#navLinks').classList.remove('open')));
  if (location.hash === '#tanda-tangan') history.replaceState(null, '', location.pathname + location.search);

  // ---------- PWA: offline & pasang aplikasi ----------
  if (!IS_FILE) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $$('[data-install]').forEach((b) => { b.hidden = false; });
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $$('[data-install]').forEach((b) => { b.hidden = true; });
    toast('KlinikPDF terpasang! Sekarang bisa dibuka tanpa internet.', 'ok');
  });
  $$('[data-install]').forEach((b) => b.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (_) { /* abaikan */ }
    installPrompt = null;
    $$('[data-install]').forEach((x) => { x.hidden = true; });
  }));

  // ---------- Pemilihan file ----------
  const fileInput = $('#fileInput');
  let nextMode = null;
  function pickFile(mode) { nextMode = typeof mode === 'string' ? mode : null; fileInput.value = ''; fileInput.click(); }
  $$('[data-open-file]').forEach((b) => b.addEventListener('click', () => pickFile()));
  $$('[data-open-sig]').forEach((b) => b.addEventListener('click', () => openSigModal(b.dataset.openSig || undefined)));
  const heroDrop = $('#heroDrop');
  heroDrop.addEventListener('click', () => pickFile());
  heroDrop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); }
  });
  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; if (f) openFile(f, { mode: nextMode }); nextMode = null; });

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const inTools = () => document.body.classList.contains('tooling') && !isEditing();
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (inTools()) return;
    dragDepth++; heroDrop.classList.add('drag');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e) || inTools()) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) heroDrop.classList.remove('drag');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; heroDrop.classList.remove('drag');
    if (inTools() || $('.modal.open')) return;
    const f = e.dataTransfer.files[0];
    if (f) openFile(f, { mode: isEditing() ? S.mode : null });
  });

  // Contoh QR di landing page
  (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(async () => {
    try {
      const q = { name: 'Nama Penandatangan', role: 'Jabatan', org: 'Instansi', layout: 'none', color: INK[0] };
      $('#qrDemo').src = await qrImage(q, { doc: false, code: 'TTD-CONTOH01' });
    } catch (_) { /* abaikan */ }
    ensureLibs().catch(() => {});
  });

  // ==========================================================
  // STATE EDITOR
  // ==========================================================
  const S = {
    name: '', kind: 'pdf', bytes: null, pdf: null, hash: '', signed: false,
    pages: [], els: [], sel: null, mode: 'sign', pen: null,
    zoom: 1, fit: 1, dirty: false, hinted: false, placedHint: false,
  };
  /** Mode editor (dibuka dari kartu alat): menentukan petunjuk & nama file hasil. */
  const MODES = {
    sign: { suffix: 'ditandatangani', tools: [] },
    edit: { suffix: 'diedit', tools: ['toolText', 'toolImage', 'toolWhiteout'], hint: 'Tambahkan teks atau gambar. Untuk mengganti tulisan lama, tutup dengan "Tutup Putih" lalu ketik teks baru di atasnya.' },
    annotate: { suffix: 'anotasi', tools: ['toolPen', 'toolHighlight', 'toolRect', 'toolText'], hint: 'Pakai Pena untuk mencoret, Stabilo untuk menandai, Kotak, atau Teks untuk catatan.' },
    redact: { suffix: 'disensor', tools: ['toolRedact'], hint: 'Klik "Sensor", lalu tutup bagian rahasia dengan kotak hitam. Saat diunduh, isi di bawahnya dihapus permanen.' },
    form: { suffix: 'formulir', tools: ['toolField', 'toolCheckbox'], hint: 'Klik "Kolom Teks" atau "Kotak Centang", lalu atur posisi & ukurannya. Hasil unduhan menjadi PDF yang bisa diisi.' },
  };
  const stage = $('#stage');
  const pagesWrap = $('#pages');
  let io = null;

  function isEditing() { return document.body.classList.contains('editing'); }
  function docOpen() { return isEditing() && S.pages.length > 0; }
  function enterEditor() {
    if (isEditing()) return;
    document.body.classList.add('editing');
    history.pushState({ ttdin: 'editor' }, '', '#tanda-tangan');
  }
  function closeEditorNow() {
    document.body.classList.remove('editing');
    resetDoc();
    renderLibraries();
  }
  function leaveEditor() {
    if (history.state && history.state.ttdin === 'editor') history.back();
    else closeEditorNow();
  }
  window.addEventListener('popstate', () => {
    if (!isEditing()) return;
    if (S.dirty && !confirm('Keluar dari editor? Tanda tangan yang belum diunduh akan hilang.')) {
      history.pushState({ ttdin: 'editor' }, '', '#tanda-tangan');
      return;
    }
    closeEditorNow();
  });
  window.addEventListener('beforeunload', (e) => {
    if (isEditing() && S.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  $('#edHome').addEventListener('click', (e) => { e.preventDefault(); leaveEditor(); });
  $('#btnNewFile').addEventListener('click', pickFile);
  $('#bannerClose').addEventListener('click', () => { $('#signedBanner').hidden = true; });

  function resetDoc() {
    if (S.pen) stopPen(false);
    if (io) io.disconnect();
    S.pages.forEach((p) => p.task && p.task.cancel());
    pagesWrap.innerHTML = '';
    if (S.pdf) S.pdf.destroy();
    Object.assign(S, { pdf: null, bytes: null, hash: '', signed: false, pages: [], els: [], sel: null, dirty: false, zoom: 1 });
    $('#signedBanner').hidden = true;
  }
  function applyMode() {
    const m = MODES[S.mode] || MODES.sign;
    $$('.ed-tools .tool').forEach((b) => b.classList.toggle('hl', m.tools.includes(b.id)));
    const first = m.tools.length && $('#' + m.tools[0]);
    if (first) first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ---------- PDF berkata sandi ----------
  let pwResolve = null;
  const pwModal = $('#pwModal');
  function askPassword(name, wrong) {
    return new Promise((resolve) => {
      $('#pwText').textContent = `"${name}" dilindungi kata sandi. Masukkan kata sandi untuk membukanya.`;
      $('#pwErr').hidden = !wrong;
      $('#pwInput').value = '';
      pwResolve = resolve;
      openModal(pwModal);
      setTimeout(() => $('#pwInput').focus(), 30);
    });
  }
  function finishPw(v) {
    const r = pwResolve;
    pwResolve = null;
    closeModal(pwModal);
    if (r) r(v);
  }
  $('#pwOk').addEventListener('click', () => finishPw($('#pwInput').value));
  $('#pwInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finishPw($('#pwInput').value); } });
  new MutationObserver(() => {
    if (!pwModal.classList.contains('open') && pwResolve) { const r = pwResolve; pwResolve = null; r(null); }
  }).observe(pwModal, { attributes: true, attributeFilter: ['class'] });

  /** Lepas enkripsi PDF (minta kata sandi bila perlu). File tanpa enkripsi dikembalikan apa adanya. */
  async function unlockPdf(bytes, name) {
    if (!bytesInclude(bytes, '/Encrypt')) return bytes;
    await loadScript('js/pdfcrypt.js');
    let pw = '';
    let tries = 0;
    for (;;) {
      try {
        return (await window.PDFCrypt.decrypt(bytes, pw)).bytes;
      } catch (e) {
        if (e.code !== 'PASSWORD') throw e;
        pw = await askPassword(name, tries++ > 0);
        if (pw == null) { const x = new Error('Dibatalkan'); x.code = 'CANCELLED'; throw x; }
      }
    }
  }

  // ---------- Membuka file ----------
  async function openFile(file, opts = {}) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';
    const isDocx = ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isImg = !isPdf && !isDocx && (/^image\//.test(file.type) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext));
    if (['doc', 'odt', 'rtf'].includes(ext)) {
      toast(`Format .${ext} belum didukung. Simpan ulang sebagai .docx atau PDF (File → Save As), lalu buka lagi.`, 'error');
      return;
    }
    if (!isPdf && !isDocx && !isImg) {
      toast('Format belum didukung. Gunakan PDF, Word (DOCX), JPG, PNG, atau WEBP.', 'error');
      return;
    }
    if (S.dirty && S.els.length && !confirm('Buka dokumen baru? Tanda tangan pada dokumen saat ini akan hilang.')) return;

    const wasOpen = docOpen();
    const mode = MODES[opts.mode] ? opts.mode : (wasOpen ? S.mode : 'sign');
    enterEditor();
    showLoading(isDocx ? 'Mengonversi dokumen Word…' : 'Membuka dokumen…');
    try {
      await ensureLibs();
      const original = await file.arrayBuffer();
      const hash = await sha256Hex(original);
      let bytes;
      if (isPdf) {
        bytes = new Uint8Array(original);
        try { bytes = await unlockPdf(bytes, file.name); }
        catch (e) {
          if (e.code === 'CANCELLED') { hideLoading(); if (!wasOpen) leaveEditor(); return; }
          console.warn('Dekripsi gagal, dibuka apa adanya:', e);
        }
      } else if (isDocx) bytes = await docxToPdf(file);
      else bytes = await imageToPdf(file);
      const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      resetDoc();
      Object.assign(S, { pdf, bytes, hash, name: file.name, kind: isPdf ? 'pdf' : isDocx ? 'docx' : 'image', mode });
      S.signed = isPdf && hasDigitalSignature(bytes);
      $('#signedBanner').hidden = !S.signed;
      $('#edFileName').textContent = file.name;
      $('#edFileName').title = file.name;
      $('#edPages').textContent = `${pdf.numPages} halaman`;
      await buildPages();
      stage.scrollTop = 0;
      hideLoading();
      renderLibraries();
      applyMode();
      if (mode !== 'sign') {
        toast(MODES[mode].hint);
      } else if (!loadSaved().length) {
        openSigModal('upload');
      } else if (!S.hinted) {
        S.hinted = true;
        toast('Seret tanda tangan dari panel "Tanda Tangan Saya" ke halaman dokumen.');
      }
    } catch (err) {
      console.error(err);
      hideLoading();
      let msg = 'Dokumen tidak dapat dibuka. Pastikan file tidak rusak.';
      if (err && err.name === 'PasswordException') msg = 'PDF ini dilindungi kata sandi. Buka kuncinya terlebih dahulu, lalu coba lagi.';
      else if (err && /Gagal memuat/.test(err.message)) msg = 'Gagal memuat komponen aplikasi. Muat ulang halaman lalu coba lagi.';
      else if (isDocx) msg = 'Dokumen Word tidak dapat dibaca. Coba simpan sebagai PDF dari Microsoft Word, lalu buka lagi.';
      else if (isImg) msg = 'Gambar tidak dapat dibaca. Gunakan JPG, PNG, atau WEBP.';
      toast(msg, 'error');
      if (!wasOpen) leaveEditor();
    }
  }

  /** Ubah gambar (JPG/PNG/WEBP) menjadi PDF satu halaman. */
  async function imageToPdf(file) {
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    const k = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const jpg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.95)).arrayBuffer());
    const doc = await window.PDFLib.PDFDocument.create();
    const pw = 595.28, ph = (pw * h) / w;
    const page = doc.addPage([pw, ph]);
    page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: pw, height: ph });
    return doc.save();
  }

  /** Ubah dokumen Word (DOCX) menjadi PDF: render ke HTML, lalu ke gambar per halaman. */
  async function docxToPdf(file, onProgress = (i, n) => showLoading(`Mengonversi dokumen Word… (${i}/${n})`)) {
    await ensureDocx();
    const host = document.createElement('div');
    host.className = 'docx-host';
    document.body.appendChild(host);
    try {
      await window.docx.renderAsync(file, host, host, {
        className: 'docx', inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false,
        renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        useBase64URL: true, experimental: true,
      });
      await Promise.all($$('img', host).map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
      try { await document.fonts.ready; } catch (_) { /* abaikan */ }
      const secs = $$('section.docx', host);
      if (!secs.length) throw new Error('Dokumen Word kosong');
      const doc = await window.PDFLib.PDFDocument.create();
      const scale = 2;
      for (let i = 0; i < secs.length; i++) {
        onProgress(i + 1, secs.length);
        const sec = secs[i];
        const wpx = sec.offsetWidth;
        let hpx = parseFloat(getComputedStyle(sec).minHeight);
        if (!hpx || hpx < 100) hpx = wpx * 1.4142;
        const total = sec.offsetHeight;
        const canvas = await window.html2canvas(sec, { scale, backgroundColor: '#ffffff', logging: false, useCORS: true });
        const slices = Math.max(1, Math.ceil(total / hpx - 0.02));
        const sliceH = Math.round(hpx * scale);
        for (let s = 0; s < slices; s++) {
          const c = document.createElement('canvas');
          c.width = canvas.width;
          c.height = sliceH;
          const x = c.getContext('2d');
          x.fillStyle = '#fff';
          x.fillRect(0, 0, c.width, c.height);
          x.drawImage(canvas, 0, -s * sliceH);
          const jpg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
          const page = doc.addPage([wpx * 0.75, hpx * 0.75]);
          page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: wpx * 0.75, height: hpx * 0.75 });
        }
      }
      return doc.save();
    } finally {
      host.remove();
    }
  }

  // ---------- Halaman ----------
  async function buildPages() {
    const n = S.pdf.numPages;
    for (let i = 1; i <= n; i++) {
      const page = await S.pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.index = String(i - 1);
      const canvas = document.createElement('canvas');
      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = `Halaman ${i} dari ${n}`;
      el.append(canvas, label);
      pagesWrap.appendChild(el);
      S.pages.push({
        i: i - 1, page, el, canvas,
        w: vp.width, h: vp.height, view: page.view.slice(), rotate: page.rotate,
        cssW: 0, cssH: 0, scale: 0, task: null, visible: false,
      });
    }
    computeFit();
    layout();
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const p = S.pages[+en.target.dataset.index];
        if (!p) continue;
        p.visible = en.isIntersecting;
        if (p.visible) renderPage(p);
        else if (S.pages.length > 20 && p.scale) {
          // Hemat memori untuk dokumen dengan banyak halaman
          if (p.task) { p.task.cancel(); p.task = null; }
          p.canvas.width = p.canvas.height = 0;
          p.scale = 0;
        }
      }
    }, { root: stage, rootMargin: '900px 0px' });
    S.pages.forEach((p) => io.observe(p.el));
  }

  function computeFit() {
    if (!S.pages.length) return;
    const avail = stage.clientWidth - (window.innerWidth < 860 ? 24 : 56);
    const maxW = Math.max(...S.pages.map((p) => p.w));
    S.fit = clamp(avail / maxW, 0.2, 1.5);
  }

  function layout() {
    const sc = S.fit * S.zoom;
    for (const p of S.pages) {
      p.cssW = Math.round(p.w * sc);
      p.cssH = Math.round(p.h * sc);
      p.el.style.width = p.cssW + 'px';
      p.el.style.height = p.cssH + 'px';
      p.el.style.setProperty('--pw', p.cssW + 'px');
      if (p.visible) renderPage(p);
    }
    $('#zoomVal').textContent = Math.round(S.zoom * 100) + '%';
    S.els.forEach((el) => { applyStyle(el); if (el.type === 'text') measureText(el); });
    if (S.pen) S.pages.forEach((p) => penRedraw(p));
  }

  async function renderPage(p) {
    let r = S.fit * S.zoom * dpr();
    const maxPx = 12e6;
    const px = p.w * r * p.h * r;
    if (px > maxPx) r *= Math.sqrt(maxPx / px);
    if (Math.abs(p.scale - r) < 1e-3) return;
    if (p.task) { p.task.cancel(); p.task = null; }
    p.scale = r;
    const vp = p.page.getViewport({ scale: r });
    const off = document.createElement('canvas');
    off.width = Math.floor(vp.width);
    off.height = Math.floor(vp.height);
    const task = p.page.render({ canvasContext: off.getContext('2d'), viewport: vp });
    p.task = task;
    try {
      await task.promise;
    } catch (e) {
      if (!e || e.name !== 'RenderingCancelledException') { console.error(e); p.scale = 0; }
      return;
    }
    if (p.task !== task) return;
    p.task = null;
    p.el.replaceChild(off, p.canvas);
    p.canvas = off;
  }

  // ---------- Zoom ----------
  function setZoom(z) {
    z = clamp(Math.round(z * 100) / 100, 0.5, 3);
    if (z === S.zoom || !S.pages.length) return;
    const rx = (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth;
    const ry = (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight;
    S.zoom = z;
    layout();
    stage.scrollLeft = rx * stage.scrollWidth - stage.clientWidth / 2;
    stage.scrollTop = ry * stage.scrollHeight - stage.clientHeight / 2;
  }
  $('#zoomIn').addEventListener('click', () => setZoom(S.zoom + 0.25));
  $('#zoomOut').addEventListener('click', () => setZoom(S.zoom - 0.25));
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (docOpen()) { computeFit(); layout(); }
      if (sigModal.classList.contains('open')) sizePad();
    }, 150);
  });

  // ==========================================================
  // ELEMEN (tanda tangan, QR, teks, tanggal, centang)
  // ==========================================================
  /** Cari halaman yang paling terlihat & titik tengah area yang terlihat. */
  function visibleTarget() {
    if (!S.pages.length) return null;
    const st = stage.getBoundingClientRect();
    let best = null, bestArea = -1;
    for (const p of S.pages) {
      const r = p.el.getBoundingClientRect();
      const l = Math.max(r.left, st.left), rt = Math.min(r.right, st.right);
      const t = Math.max(r.top, st.top), b = Math.min(r.bottom, st.bottom);
      const a = Math.max(0, rt - l) * Math.max(0, b - t);
      if (a > bestArea) { bestArea = a; best = { p, r, cx: (l + rt) / 2, cy: (t + b) / 2 }; }
    }
    return {
      page: best.p.i,
      fx: clamp((best.cx - best.r.left) / best.r.width, 0, 1),
      fy: clamp((best.cy - best.r.top) / best.r.height, 0, 1),
    };
  }
  /** Halaman di bawah titik layar (x, y), untuk drag & drop. */
  function pageAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !hit.closest('.ed-stage')) return null;
    for (const p of S.pages) {
      const r = p.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { page: p.i, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, exact: true };
      }
    }
    return null;
  }
  function placeAt(el, t) {
    el.x = clamp(t.fx - el.w / 2, 0, Math.max(0, 1 - el.w));
    el.y = clamp(t.fy - el.h / 2, 0, Math.max(0, 1 - el.h));
    if (t.exact) return;
    // Hindari menumpuk tepat di atas elemen lain: geser ke bawah
    const p = S.pages[t.page];
    const gap = 6 / p.h;
    for (let n = 0; n < 30; n++) {
      const hit = S.els.find((o) => o !== el && o.page === t.page &&
        el.x < o.x + o.w && el.x + el.w > o.x && el.y < o.y + o.h && el.y + el.h > o.y);
      if (!hit) break;
      const ny = hit.y + hit.h + gap;
      if (ny + el.h > 1) break;
      el.y = ny;
    }
  }
  function clampEl(el) {
    el.x = clamp(el.x, 0, Math.max(0, 1 - el.w));
    el.y = clamp(el.y, 0, Math.max(0, 1 - el.h));
  }

  function addElement(data, opts = {}) {
    const el = Object.assign({ id: uid(), x: 0, y: 0, w: 0.2, h: 0.05, color: INK[0] }, data);
    S.els.push(el);
    renderEl(el);
    S.dirty = true;
    if (opts.select !== false) select(el);
    return el;
  }

  async function addImageEl(src, extra = {}, target = null) {
    const t = target || visibleTarget();
    if (!t) return;
    const img = await loadImage(src);
    const aspect = img.naturalWidth / img.naturalHeight;
    const p = S.pages[t.page];
    const kind = extra.kind || 'sig';
    const qrSize = aspect > 1.4 ? [Math.min(320, p.w * 0.55), 125] : [105, 145]; // QR + keterangan di samping lebih lebar
    const size = { mark: [16, 16], qr: qrSize, sig: [Math.min(170, p.w * 0.32), 75], photo: [Math.min(220, p.w * 0.45), Math.min(220, p.h * 0.4)] }[kind] || [150, 75];
    let wPt = size[0];
    let hPt = wPt / aspect;
    if (hPt > size[1]) { hPt = size[1]; wPt = hPt * aspect; }
    const el = { type: 'image', kind, src, aspect, page: t.page, w: wPt / p.w, h: hPt / p.h, ...extra };
    placeAt(el, t);
    addElement(el);
    if (kind !== 'mark' && !S.placedHint) {
      S.placedHint = true;
      toast('Geser untuk memindahkan, tarik titik di pojok untuk mengubah ukuran.');
    }
  }

  function addText(text, edit) {
    const t = visibleTarget();
    if (!t) return;
    const p = S.pages[t.page];
    const el = addElement({ type: 'text', page: t.page, text, fs: 12 / p.w, color: INK[0] });
    measureText(el);
    placeAt(el, t);
    applyStyle(el);
    if (edit) startEdit(el);
  }

  function makeMark(mark, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 120;
    const x = c.getContext('2d');
    x.strokeStyle = color; x.lineWidth = 15; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath();
    if (mark === 'check') { x.moveTo(16, 64); x.lineTo(46, 94); x.lineTo(104, 26); }
    else { x.moveTo(24, 24); x.lineTo(96, 96); x.moveTo(96, 24); x.lineTo(24, 96); }
    x.stroke();
    return c.toDataURL('image/png');
  }
  function addMark(mark) {
    addImageEl(makeMark(mark, INK[0]), { kind: 'mark', mark, color: INK[0] });
  }

  // ---------- Bentuk (stabilo, kotak, tutup putih, sensor) & kolom formulir ----------
  const SHAPES = {
    highlight: { colors: ['#fde047', '#86efac', '#f9a8d4', '#93c5fd'], size: [150, 16], hint: 'Tarik titik di pojok untuk menyesuaikan panjang & tinggi stabilo.' },
    rect: { colors: INK, size: [150, 70] },
    whiteout: { size: [130, 20], hint: 'Kotak putih menutup tulisan di bawahnya. Tambahkan Teks di atasnya untuk menggantinya.' },
    redact: { size: [130, 18], hint: 'Bagian di bawah kotak hitam akan dihapus permanen saat diunduh sebagai PDF.' },
  };
  const hinted = new Set();
  function addShape(shape) {
    const t = visibleTarget();
    if (!t) return;
    const p = S.pages[t.page];
    const def = SHAPES[shape];
    const el = { type: 'shape', shape, free: true, page: t.page, w: def.size[0] / p.w, h: def.size[1] / p.h, color: def.colors ? def.colors[0] : '#000000' };
    placeAt(el, t);
    addElement(el);
    if (def.hint && !hinted.has(shape)) { hinted.add(shape); toast(def.hint); }
  }
  function uniqueFieldName(base) {
    const used = new Set(S.els.filter((e) => e.type === 'field').map((e) => e.name));
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
  function addField(kind) {
    const t = visibleTarget();
    if (!t) return;
    const p = S.pages[t.page];
    const n = S.els.filter((e) => e.type === 'field' && e.field === kind).length + 1;
    const el = kind === 'check'
      ? { type: 'field', field: 'check', aspect: 1, page: t.page, w: 14 / p.w, h: 14 / p.h, name: uniqueFieldName(`Centang ${n}`) }
      : { type: 'field', field: 'text', free: true, page: t.page, w: 180 / p.w, h: 20 / p.h, name: uniqueFieldName(`Kolom ${n}`) };
    placeAt(el, t);
    addElement(el);
    if (!hinted.has('field')) { hinted.add('field'); toast('Klik ikon pensil untuk mengganti nama kolom. Ubah ukuran lewat titik di pojok.'); }
  }
  async function addPhoto(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Pilih file gambar (JPG, PNG, atau WEBP).', 'error'); return; }
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadImage(url); } catch (_) { toast('Gambar tidak dapat dibuka.', 'error'); return; } finally { URL.revokeObjectURL(url); }
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    const png = /png|webp|gif/.test(file.type);
    if (!png) { x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
    await addImageEl(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9), { kind: 'photo' });
  }

  // ---------- Pena (coretan bebas) ----------
  const penBar = $('#penBar');
  function startPen() {
    if (!S.pages.length) return;
    select(null);
    S.pen = { color: INK[0], width: 2, strokes: new Map(), order: [] };
    document.body.classList.add('pen-on');
    $('#toolPen').classList.add('active');
    penBar.hidden = false;
    $$('[data-pen-color]', penBar).forEach((b, i) => b.classList.toggle('active', i === 0));
    $$('[data-pen-width]', penBar).forEach((b) => b.classList.toggle('active', +b.dataset.penWidth === 2));
    if (!hinted.has('pen')) { hinted.add('pen'); toast('Coret langsung di halaman. Klik "Selesai" jika sudah.'); }
  }
  function penLayer(p) {
    let c = p.el.querySelector('.pen-layer');
    if (!c) { c = document.createElement('canvas'); c.className = 'pen-layer'; p.el.appendChild(c); }
    return c;
  }
  function penDrawStroke(ctx, s, sx, sy, k) {
    const pts = s.pts.map((q) => ({ x: q.x * sx, y: q.y * sy, w: s.w * k }));
    prepCtx(ctx, s.color);
    if (pts.length === 1) { drawDot(ctx, pts[0]); return; }
    drawStroke(ctx, pts);
  }
  function penRedraw(p) {
    const list = S.pen && S.pen.strokes.get(p.i);
    const c = p.el.querySelector('.pen-layer');
    if (!list || !c) return;
    const d = dpr();
    c.width = Math.round(p.cssW * d);
    c.height = Math.round(p.cssH * d);
    const x = c.getContext('2d');
    const k = (p.cssW / p.w) * d;
    list.forEach((s) => penDrawStroke(x, s, c.width, c.height, k));
  }
  pagesWrap.addEventListener('pointerdown', (e) => {
    if (!S.pen) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = S.pages[+pageEl.dataset.index];
    if (!S.pen.strokes.has(p.i)) S.pen.strokes.set(p.i, []);
    penLayer(p);
    const stroke = { color: S.pen.color, w: S.pen.width, pts: [] };
    S.pen.strokes.get(p.i).push(stroke);
    S.pen.order.push(p.i);
    const r = pageEl.getBoundingClientRect();
    const add = (ev) => stroke.pts.push({ x: clamp((ev.clientX - r.left) / r.width, 0, 1), y: clamp((ev.clientY - r.top) / r.height, 0, 1) });
    add(e);
    penRedraw(p);
    try { pageEl.setPointerCapture(e.pointerId); } catch (_) { /* abaikan */ }
    const move = (ev) => {
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      (evs.length ? evs : [ev]).forEach(add);
      penRedraw(p);
    };
    const up = () => {
      pageEl.removeEventListener('pointermove', move);
      pageEl.removeEventListener('pointerup', up);
      pageEl.removeEventListener('pointercancel', up);
    };
    pageEl.addEventListener('pointermove', move);
    pageEl.addEventListener('pointerup', up);
    pageEl.addEventListener('pointercancel', up);
  });
  /** Selesai menggambar: coretan tiap halaman menjadi satu elemen gambar yang bisa digeser. */
  function stopPen(commit = true) {
    const pen = S.pen;
    if (!pen) return;
    S.pen = null;
    document.body.classList.remove('pen-on');
    $('#toolPen').classList.remove('active');
    penBar.hidden = true;
    $$('.pen-layer', pagesWrap).forEach((c) => c.remove());
    if (!commit) return;
    for (const [pi, list] of pen.strokes) {
      const strokes = list.filter((s) => s.pts.length);
      if (!strokes.length) continue;
      const p = S.pages[pi];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of strokes) for (const q of s.pts) {
        const ux = q.x * p.w, uy = q.y * p.h, pad = s.w;
        x0 = Math.min(x0, ux - pad); y0 = Math.min(y0, uy - pad);
        x1 = Math.max(x1, ux + pad); y1 = Math.max(y1, uy + pad);
      }
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(p.w, x1); y1 = Math.min(p.h, y1);
      const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
      const k = Math.min(4, 3000 / Math.max(bw, bh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bw * k));
      c.height = Math.max(1, Math.round(bh * k));
      const ctx = c.getContext('2d');
      ctx.translate(-x0 * k, -y0 * k);
      strokes.forEach((s) => penDrawStroke(ctx, s, p.w * k, p.h * k, k));
      addElement({ type: 'image', kind: 'ink', src: c.toDataURL('image/png'), aspect: c.width / c.height, page: pi, x: x0 / p.w, y: y0 / p.h, w: bw / p.w, h: bh / p.h }, { select: false });
    }
  }
  penBar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !S.pen) return;
    if (b.dataset.penColor) {
      S.pen.color = b.dataset.penColor;
      $$('[data-pen-color]', penBar).forEach((x) => x.classList.toggle('active', x === b));
    } else if (b.dataset.penWidth) {
      S.pen.width = +b.dataset.penWidth;
      $$('[data-pen-width]', penBar).forEach((x) => x.classList.toggle('active', x === b));
    } else if (b.dataset.penAct === 'undo') {
      const pi = S.pen.order.pop();
      if (pi != null) { S.pen.strokes.get(pi).pop(); penRedraw(S.pages[pi]); }
    } else if (b.dataset.penAct === 'done') stopPen(true);
  });

  function renderEl(el) {
    const p = S.pages[el.page];
    const node = document.createElement('div');
    node.className = 'el';
    node.dataset.id = el.id;
    if (el.type === 'image') {
      const img = new Image();
      img.src = el.src; img.alt = ''; img.draggable = false;
      node.appendChild(img);
    } else if (el.type === 'shape') {
      const b = document.createElement('div');
      b.className = 'shape shape-' + el.shape;
      node.appendChild(b);
      node.classList.add('el-shape');
    } else if (el.type === 'field') {
      const b = document.createElement('div');
      b.className = 'fieldbox fieldbox-' + el.field;
      if (el.field === 'check') b.innerHTML = svg('<path d="M20 6 9 17l-5-5"/>', 3);
      else { const s = document.createElement('span'); s.textContent = el.name; b.appendChild(s); }
      b.title = el.name;
      node.appendChild(b);
    } else {
      const t = document.createElement('div');
      t.className = 'txt';
      t.spellcheck = false;
      t.dataset.ph = 'Ketik teks…';
      t.textContent = el.text;
      t.addEventListener('input', () => measureText(el));
      t.addEventListener('blur', () => stopEdit(el));
      t.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); t.blur(); } });
      t.addEventListener('paste', (e) => {
        if (t.contentEditable === 'plaintext-only') return;
        e.preventDefault();
        document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text'));
      });
      node.appendChild(t);
    }
    const handle = document.createElement('div');
    handle.className = 'handle';
    node.appendChild(handle);
    node.appendChild(buildBar(el));
    el.node = node;
    p.el.appendChild(node);
    applyStyle(el);
    bindDrag(el);
  }

  function applyStyle(el) {
    const n = el.node;
    if (!n) return;
    n.style.left = el.x * 100 + '%';
    n.style.top = el.y * 100 + '%';
    const p = S.pages[el.page];
    if (el.type === 'text') {
      const t = n.firstChild;
      t.style.fontSize = `calc(var(--pw) * ${el.fs})`;
      t.style.color = el.color;
      t.style.fontFamily = TEXT_FONT;
    } else {
      n.style.width = el.w * 100 + '%';
      n.style.height = el.h * 100 + '%';
      if (el.type === 'shape') {
        const b = n.firstChild;
        if (el.shape === 'highlight') b.style.background = el.color;
        if (el.shape === 'rect') { b.style.borderColor = el.color; b.style.borderWidth = Math.max(1, (1.5 * p.cssW) / p.w) + 'px'; }
      } else if (el.type === 'field' && el.field === 'text') {
        n.firstChild.style.fontSize = Math.max(8, Math.min(13, el.h * p.cssH * 0.55)) + 'px';
      }
    }
    n.classList.toggle('near-top', el.y * p.cssH < 56);
  }
  function measureText(el) {
    const p = S.pages[el.page];
    if (!el.node || !p.cssW) return;
    el.w = el.node.offsetWidth / p.cssW;
    el.h = el.node.offsetHeight / p.cssH;
  }

  function buildBar(el) {
    const bar = document.createElement('div');
    bar.className = 'el-bar';
    const colors = el.type === 'text' || el.kind === 'mark' ? INK : el.type === 'shape' ? (SHAPES[el.shape].colors || null) : null;
    let html = '';
    if (colors) html += colors.map((c) => `<button class="sw" data-act="color" data-color="${c}" style="background:${c}" title="Ganti warna" aria-label="Ganti warna"></button>`).join('');
    if (el.type === 'text') html += `<button data-act="edit" title="Edit teks" aria-label="Edit teks">${ICON.edit}</button>`;
    if (el.type === 'field') html += `<button data-act="rename" title="Ganti nama kolom" aria-label="Ganti nama kolom">${ICON.edit}</button>`;
    if (S.pages.length > 1) html += `<button data-act="all" title="Salin ke semua halaman (paraf)">${ICON.layers}<span>Semua hal.</span></button>`;
    html += `<button data-act="dup" title="Duplikat" aria-label="Duplikat">${ICON.copy}</button>`;
    html += `<button data-act="del" class="danger" title="Hapus" aria-label="Hapus">${ICON.trash}</button>`;
    bar.innerHTML = html;
    bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      elAction(el, b.dataset.act, b.dataset.color);
    });
    return bar;
  }

  function cloneData(el) {
    const { node, id, ...rest } = el;
    return rest;
  }

  function elAction(el, act, color) {
    if (act === 'color') {
      el.color = color;
      if (el.kind === 'mark') { el.src = makeMark(el.mark, color); el.node.firstChild.src = el.src; }
      applyStyle(el);
      S.dirty = true;
    } else if (act === 'edit') {
      startEdit(el);
    } else if (act === 'rename') {
      const v = prompt('Nama kolom (dipakai sebagai nama field di PDF):', el.name);
      if (v && v.trim() && v.trim() !== el.name) {
        el.name = uniqueFieldName(v.trim().slice(0, 60));
        const b = el.node.firstChild;
        b.title = el.name;
        if (el.field === 'text') b.firstChild.textContent = el.name;
        S.dirty = true;
      }
    } else if (act === 'del') {
      removeEl(el);
    } else if (act === 'dup') {
      stopEdit(el);
      const extra = el.type === 'field' ? { name: uniqueFieldName(el.name) } : {};
      const c = addElement({ ...cloneData(el), x: el.x + 0.02, y: el.y + 0.02, ...extra });
      clampEl(c); applyStyle(c);
    } else if (act === 'all') {
      stopEdit(el);
      if (!S.els.includes(el)) return;
      const src = S.pages[el.page];
      let n = 0;
      for (const p of S.pages) {
        if (p.i === el.page) continue;
        const data = { ...cloneData(el), page: p.i };
        if (el.type === 'text') data.fs = (el.fs * src.w) / p.w;
        else if (el.aspect) data.h = (el.w * p.w) / el.aspect / p.h;
        else { data.w = (el.w * src.w) / p.w; data.h = (el.h * src.h) / p.h; }
        if (el.type === 'field') data.name = uniqueFieldName(`${el.name} hal${p.i + 1}`);
        const c = addElement(data, { select: false });
        if (c.type === 'text') measureText(c);
        clampEl(c); applyStyle(c);
        n++;
      }
      toast(`Disalin ke ${n} halaman lainnya.`, 'ok');
    }
  }

  function removeEl(el) {
    if (el.node) el.node.remove();
    S.els = S.els.filter((x) => x !== el);
    if (S.sel === el) S.sel = null;
    S.dirty = true;
  }

  function select(el) {
    if (S.sel && S.sel !== el) {
      const prev = S.sel;
      prev.node.classList.remove('selected');
      stopEdit(prev);
    }
    S.sel = el || null;
    if (el && el.node) el.node.classList.add('selected');
  }

  function startEdit(el) {
    select(el);
    const n = el.node, t = n.firstChild;
    n.classList.add('editing');
    t.setAttribute('contenteditable', 'plaintext-only');
    if (t.contentEditable !== 'plaintext-only') t.setAttribute('contenteditable', 'true');
    t.focus();
    const range = document.createRange();
    range.selectNodeContents(t);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }
  function stopEdit(el) {
    if (!el || !el.node || !el.node.classList.contains('editing')) return;
    const t = el.node.firstChild;
    el.node.classList.remove('editing');
    t.removeAttribute('contenteditable');
    el.text = t.innerText.replace(/ /g, ' ').replace(/\n+$/, '');
    if (!el.text.trim()) { removeEl(el); return; }
    t.textContent = el.text;
    measureText(el);
    clampEl(el);
    applyStyle(el);
    S.dirty = true;
  }

  // ---------- Geser & ubah ukuran elemen ----------
  function bindDrag(el) {
    const n = el.node;
    n.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (n.classList.contains('editing')) return;
      e.preventDefault();
      e.stopPropagation();
      select(el);
      const resize = e.target.classList.contains('handle');
      const p = S.pages[el.page];
      const st = { x: e.clientX, y: e.clientY, ex: el.x, ey: el.y, ew: el.w, eh: el.h, fs: el.fs, pw: p.cssW, ph: p.cssH, moved: false };
      try { n.setPointerCapture(e.pointerId); } catch (_) { /* abaikan */ }

      const move = (ev) => {
        const dx = ev.clientX - st.x, dy = ev.clientY - st.y;
        if (!st.moved && Math.hypot(dx, dy) < 3) return;
        st.moved = true;
        if (resize) {
          if (el.free) {
            el.w = clamp((st.ew * st.pw + dx) / st.pw, 6 / st.pw, 1 - el.x);
            el.h = clamp((st.eh * st.ph + dy) / st.ph, 4 / st.ph, 1 - el.y);
          } else if (el.type !== 'text') {
            const d = Math.abs(dx) > Math.abs(dy * el.aspect) ? dx : dy * el.aspect;
            const wpx = clamp(st.ew * st.pw + d, 14, st.pw);
            el.w = wpx / st.pw;
            el.h = wpx / el.aspect / st.ph;
          } else {
            const w0 = Math.max(10, st.ew * st.pw);
            el.fs = clamp((st.fs * (w0 + dx)) / w0, 5 / p.w, 120 / p.w);
          }
        } else {
          el.x = st.ex + dx / st.pw;
          el.y = st.ey + dy / st.ph;
        }
        applyStyle(el);
        if (el.type === 'text' && resize) measureText(el);
      };
      const up = () => {
        n.removeEventListener('pointermove', move);
        n.removeEventListener('pointerup', up);
        n.removeEventListener('pointercancel', up);
        if (!st.moved) return;
        if (!resize) dropToPage(el);
        clampEl(el);
        applyStyle(el);
        S.dirty = true;
      };
      n.addEventListener('pointermove', move);
      n.addEventListener('pointerup', up);
      n.addEventListener('pointercancel', up);
    });
    if (el.type === 'text') n.addEventListener('dblclick', () => startEdit(el));
  }

  /** Jika elemen dilepas di atas halaman lain, pindahkan ke halaman itu. */
  function dropToPage(el) {
    const r = el.node.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cur = S.pages[el.page];
    for (const p of S.pages) {
      if (p === cur) continue;
      const pr = p.el.getBoundingClientRect();
      if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) continue;
      el.page = p.i;
      el.x = (r.left - pr.left) / pr.width;
      el.y = (r.top - pr.top) / pr.height;
      if (el.type !== 'text') { el.w = r.width / pr.width; el.h = r.height / pr.height; }
      else el.fs = (el.fs * cur.w) / p.w;
      p.el.appendChild(el.node);
      applyStyle(el);
      if (el.type === 'text') measureText(el);
      return;
    }
  }

  stage.addEventListener('pointerdown', (e) => { if (!e.target.closest('.el')) select(null); });

  document.addEventListener('keydown', (e) => {
    if (!isEditing() || $('.modal.open')) return;
    if (S.pen && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); stopPen(true); return; }
    const el = S.sel;
    if (!el || el.node.classList.contains('editing')) return;
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
    const p = S.pages[el.page];
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeEl(el); }
    else if (e.key === 'Escape') select(null);
    else if (moves[e.key]) {
      e.preventDefault();
      el.x += moves[e.key][0] / p.cssW;
      el.y += moves[e.key][1] / p.cssH;
      clampEl(el); applyStyle(el); S.dirty = true;
    }
  });

  // ---------- Toolbar ----------
  const tool = (id, fn) => $(id).addEventListener('click', () => { if (S.pen && id !== '#toolPen') stopPen(true); fn(); });
  $('#libAdd').addEventListener('click', () => openSigModal());
  tool('#toolText', () => addText('', true));
  tool('#toolDate', () => addText(formatDate(), false));
  tool('#toolCheck', () => addMark('check'));
  tool('#toolCross', () => addMark('cross'));
  tool('#toolImage', () => { const i = $('#imgInput'); i.value = ''; i.click(); });
  $('#imgInput').addEventListener('change', (e) => { if (e.target.files[0]) addPhoto(e.target.files[0]); });
  tool('#toolPen', () => (S.pen ? stopPen(true) : startPen()));
  tool('#toolHighlight', () => addShape('highlight'));
  tool('#toolRect', () => addShape('rect'));
  tool('#toolWhiteout', () => addShape('whiteout'));
  tool('#toolRedact', () => addShape('redact'));
  tool('#toolField', () => addField('text'));
  tool('#toolCheckbox', () => addField('check'));
  tool('#toolMeterai', () => openModal($('#meteraiModal')));

  // ==========================================================
  // TANDA TANGAN SAYA (pustaka tersimpan di perangkat)
  // ==========================================================
  function loadSaved() {
    try {
      const list = JSON.parse(localStorage.getItem(STORE_KEY)) || [];
      return list.filter((s) => s && s.src).map((s) => ({ kind: 'image', ...s }));
    } catch (_) { return []; }
  }
  function storeSaved(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; } catch (_) { return false; }
  }
  function saveSignature(entry) {
    const list = loadSaved();
    const key = (s) => (s.kind === 'qr' ? 'qr:' + JSON.stringify(s.qr) : s.src);
    if (list.some((s) => key(s) === key(entry))) return;
    list.unshift({ id: uid(), ...entry });
    if (!storeSaved(list.slice(0, MAX_SAVED))) toast('Tanda tangan tidak dapat disimpan di perangkat ini.', 'error');
    renderLibraries();
  }
  function deleteSaved(id) {
    storeSaved(loadSaved().filter((s) => s.id !== id));
    renderLibraries();
  }
  function confirmDelete(s) {
    if (confirm('Hapus tanda tangan ini dari "Tanda Tangan Saya"?')) deleteSaved(s.id);
  }

  /** Tempel tanda tangan ke dokumen. QR dibuat ulang dengan info dokumen ini. */
  async function placeSignature(entry, target) {
    if (!S.pages.length) return;
    let src = entry.src;
    if (entry.kind === 'qr') src = await qrImage(entry.qr, { doc: true, code: randomCode() });
    await addImageEl(src, { kind: entry.kind === 'qr' ? 'qr' : 'sig' }, target);
  }

  function renderLibraries() {
    const list = loadSaved();

    // Panel editor
    const lib = $('#libList');
    lib.innerHTML = '';
    if (!list.length) {
      lib.innerHTML = `<div class="lib-empty"><p>Belum ada tanda tangan. Unggah TTD Anda atau buat yang baru.</p>
        <button class="btn btn-primary" data-lib="upload">Unggah TTD</button>
        <button class="btn btn-outline" data-lib="draw">Buat manual / QR</button></div>`;
      $$('[data-lib]', lib).forEach((b) => b.addEventListener('click', () => openSigModal(b.dataset.lib)));
    }
    for (const s of list) {
      const d = document.createElement('div');
      d.className = 'lib-item';
      d.title = 'Seret ke halaman dokumen, atau klik untuk menambahkan';
      d.innerHTML = `<span class="grip">${ICON.grip}</span><img alt="Tanda tangan">${s.kind === 'qr' ? '<span class="lib-badge">QR</span>' : ''}<button class="x" aria-label="Hapus" title="Hapus">${ICON.x}</button>`;
      d.querySelector('img').src = s.src;
      d.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); confirmDelete(s); });
      bindLibDrag(d, s);
      lib.appendChild(d);
    }

    // Modal: tab Tersimpan
    const grid = $('#savedGrid');
    grid.innerHTML = '';
    if (!list.length) grid.innerHTML = '<div class="saved-empty">Belum ada tanda tangan tersimpan.</div>';
    for (const s of list) {
      const d = document.createElement('div');
      d.className = 'saved-item';
      d.innerHTML = `<img alt="Tanda tangan tersimpan">${s.kind === 'qr' ? '<span class="lib-badge">QR</span>' : ''}<button class="x" aria-label="Hapus" title="Hapus">${ICON.x}</button>`;
      d.querySelector('img').src = s.src;
      d.addEventListener('click', (e) => {
        if (e.target.closest('.x')) { e.stopPropagation(); confirmDelete(s); return; }
        if (!docOpen()) { toast('Pilih dokumen dulu, lalu seret tanda tangan ini ke halamannya.'); return; }
        closeModal(sigModal);
        placeSignature(s);
      });
      grid.appendChild(d);
    }
    $('[data-tab="saved"]').hidden = !list.length;
    if (!list.length && sigTab === 'saved' && sigModal.classList.contains('open')) setTab('upload');

    // Landing: kartu "Tanda Tangan Saya"
    const hero = $('#heroSigs');
    hero.innerHTML = '';
    if (!list.length) {
      hero.innerHTML = '<div class="hero-sigs-empty">Belum ada. Siapkan tanda tangan dulu (unggah, gambar manual, atau QR), lalu pilih dokumen.</div>';
    }
    for (const s of list) {
      const d = document.createElement('div');
      d.className = 'hero-sig';
      d.innerHTML = '<img alt="Tanda tangan tersimpan">';
      d.querySelector('img').src = s.src;
      hero.appendChild(d);
    }
  }

  /** Drag & drop dari panel "Tanda Tangan Saya" ke halaman (mouse & sentuh). */
  function bindLibDrag(node, sig) {
    node.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.x')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!S.pages.length) return;
      const sx = e.clientX, sy = e.clientY;
      const touch = e.pointerType !== 'mouse';
      let ghost = null, over = null, done = false;
      try { node.setPointerCapture(e.pointerId); } catch (_) { /* abaikan */ }

      const setOver = (p) => {
        if (over === p) return;
        if (over) over.el.classList.remove('drop-target');
        over = p;
        if (over) over.el.classList.add('drop-target');
      };
      const cleanup = () => {
        done = true;
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
        if (ghost) ghost.remove();
        setOver(null);
      };
      const move = (ev) => {
        if (done) return;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!ghost) {
          if (Math.hypot(dx, dy) < 8) return;
          if (touch && Math.abs(dx) > Math.abs(dy) * 1.2) { cleanup(); return; } // geser strip, bukan drag
          ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.innerHTML = '<img alt="">';
          ghost.firstChild.src = node.querySelector('img').src;
          document.body.appendChild(ghost);
          select(null);
        }
        ev.preventDefault();
        ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px) translate(-50%, -50%)`;
        const hit = pageAt(ev.clientX, ev.clientY);
        setOver(hit ? S.pages[hit.page] : null);
      };
      const up = (ev) => {
        if (done) return;
        const dragged = !!ghost;
        cleanup();
        if (dragged) {
          const hit = pageAt(ev.clientX, ev.clientY);
          if (hit) placeSignature(sig, hit);
          else toast('Lepaskan tanda tangan di atas halaman dokumen.');
        } else if (ev.type === 'pointerup') {
          placeSignature(sig);
        }
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    });
  }

  // ==========================================================
  // MODAL
  // ==========================================================
  const sigModal = $('#sigModal');
  function openModal(m) { m.classList.add('open'); }
  function closeModal(m) { m.classList.remove('open'); }
  $$('.modal').forEach((m) => {
    $$('[data-close]', m).forEach((b) => b.addEventListener('click', () => closeModal(m)));
    m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModal(m); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = $$('.modal.open').pop();
    if (m) closeModal(m);
  });

  // ---------- Modal tanda tangan ----------
  let sigTab = 'upload';
  let sigColor = INK[0];
  let typeFont = SIG_FONTS[0];

  function openSigModal(tab) {
    select(null);
    renderLibraries();
    const open = docOpen();
    const has = loadSaved().length > 0;
    $('#saveWrap').hidden = !open;
    $('#sigApply').textContent = open ? 'Gunakan' : 'Simpan';
    $('#savedNote').textContent = open
      ? 'Klik salah satu untuk menambahkannya ke dokumen, atau buat yang baru lewat tab lainnya.'
      : 'Tanda tangan ini tersimpan di perangkat Anda. Pilih dokumen, lalu seret tanda tangan ke halamannya.';
    openModal(sigModal);
    setTab(tab || (has && open ? 'saved' : 'upload'));
  }

  function setTab(t) {
    if (t === 'saved' && !loadSaved().length) t = 'upload';
    sigTab = t;
    $$('.tab', sigModal).forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === t);
      b.setAttribute('aria-selected', String(b.dataset.tab === t));
    });
    $$('.pane', sigModal).forEach((p) => p.classList.toggle('active', p.dataset.pane === t));
    $('#colors').style.visibility = ['draw', 'type', 'qr'].includes(t) ? 'visible' : 'hidden';
    const creating = t !== 'saved';
    $('#saveWrap').style.display = creating ? '' : 'none';
    $('#sigApply').style.display = creating ? '' : 'none';
    const fine = window.matchMedia('(pointer: fine)').matches;
    if (t === 'draw') requestAnimationFrame(sizePad);
    if (t === 'type') { updateFonts(); if (fine) setTimeout(() => typeName.focus(), 30); }
    if (t === 'qr') { updateQrPreview(); if (fine) setTimeout(() => $('#qrName').focus(), 30); }
    const active = $('.tab.active', sigModal);
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $$('.tab', sigModal).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('[data-goto]', sigModal).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.goto)));

  $$('.swatch', sigModal).forEach((b) => b.addEventListener('click', () => {
    sigColor = b.dataset.color;
    $$('.swatch', sigModal).forEach((x) => x.classList.toggle('active', x === b));
    redrawPad();
    updateFonts();
    updateQrPreview();
  }));

  // ---------- Tab: Unggah ----------
  const uploadBox = $('#uploadBox');
  const sigFile = $('#sigFile');
  let uploadImg = null;
  let uploadCanvas = null;
  uploadBox.addEventListener('click', () => { sigFile.value = ''; sigFile.click(); });
  uploadBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); uploadBox.click(); }
  });
  sigFile.addEventListener('change', () => { if (sigFile.files[0]) loadSigImage(sigFile.files[0]); });
  uploadBox.addEventListener('dragover', (e) => { e.preventDefault(); uploadBox.classList.add('drag'); });
  uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('drag'));
  uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadBox.classList.remove('drag');
    dragDepth = 0;
    heroDrop.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) loadSigImage(f);
  });
  $('#removeBg').addEventListener('change', processUpload);

  async function loadSigImage(file) {
    if (!/^image\//.test(file.type)) { toast('Pilih file gambar (PNG atau JPG).', 'error'); return; }
    const url = URL.createObjectURL(file);
    try { uploadImg = await loadImage(url); }
    catch (_) { toast('Gambar tidak dapat dibuka.', 'error'); return; }
    finally { URL.revokeObjectURL(url); }
    processUpload();
  }
  function processUpload() {
    if (!uploadImg) return;
    const k = Math.min(1, 1400 / Math.max(uploadImg.naturalWidth, uploadImg.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(uploadImg.naturalWidth * k));
    c.height = Math.max(1, Math.round(uploadImg.naturalHeight * k));
    c.getContext('2d').drawImage(uploadImg, 0, 0, c.width, c.height);
    if ($('#removeBg').checked) removeBackground(c);
    uploadCanvas = trimCanvas(c, 6) || c;
    const inner = $('#uploadInner');
    inner.innerHTML = '';
    const im = new Image();
    im.alt = 'Pratinjau tanda tangan';
    im.src = uploadCanvas.toDataURL('image/png');
    const p = document.createElement('p');
    p.style.marginTop = '10px';
    p.textContent = 'Klik untuk mengganti gambar';
    inner.append(im, p);
  }
  /** Hapus latar terang (kertas) dan pertegas tinta. */
  function removeBackground(c) {
    const ctx = c.getContext('2d');
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    // Jika gambar sudah punya area transparan (PNG), jangan diubah.
    let transparent = 0;
    for (let i = 3; i < d.length; i += 400) if (d[i] < 250) transparent++;
    if (transparent > d.length / 400 * 0.05) return;
    const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const samples = [];
    const stepPx = Math.max(1, Math.floor(d.length / 4 / 20000));
    for (let i = 0; i < d.length; i += 4 * stepPx) samples.push(lum(i));
    samples.sort((a, b) => a - b);
    const bg = clamp(samples[Math.floor(samples.length * 0.7)] || 255, 110, 255);
    const hi = bg - 22, lo = bg - 95;
    for (let i = 0; i < d.length; i += 4) {
      const l = lum(i);
      let a;
      if (l >= hi) a = 0;
      else if (l <= lo) a = 255;
      else a = (255 * (hi - l)) / (hi - lo);
      d[i + 3] = Math.min(d[i + 3], a);
      d[i] *= 0.7; d[i + 1] *= 0.7; d[i + 2] *= 0.7;
    }
    ctx.putImageData(id, 0, 0);
  }

  // ---------- Tab: Gambar ----------
  const pad = $('#pad');
  const padWrap = $('#padWrap');
  const pctx = pad.getContext('2d');
  const MIN_W = 1.3, MAX_W = 3.6;
  let strokes = [];
  let cur = null;

  function sizePad() {
    const r = pad.getBoundingClientRect();
    if (!r.width) return;
    const d = dpr();
    pad.width = Math.round(r.width * d);
    pad.height = Math.round(r.height * d);
    pctx.setTransform(d, 0, 0, d, 0, 0);
    redrawPad();
  }
  function drawSeg(ctx, pts, i, from) {
    const a = pts[i - 1], b = pts[i];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(a.x, a.y, m.x, m.y);
    ctx.lineWidth = (a.w + b.w) / 2;
    ctx.stroke();
    return m;
  }
  function drawDot(ctx, p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  function prepCtx(ctx, color) {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }
  function drawStroke(ctx, pts) {
    drawDot(ctx, pts[0]);
    let from = pts[0];
    for (let i = 1; i < pts.length; i++) from = drawSeg(ctx, pts, i, from);
    const last = pts[pts.length - 1];
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(last.x, last.y);
    ctx.lineWidth = last.w; ctx.stroke();
  }
  function redrawPad() {
    pctx.save();
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, pad.width, pad.height);
    pctx.restore();
    prepCtx(pctx, sigColor);
    strokes.forEach((s) => drawStroke(pctx, s));
    padWrap.classList.toggle('dirty', strokes.length > 0);
  }
  function addPoint(e) {
    const r = pad.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top, t = e.timeStamp || performance.now();
    const last = cur[cur.length - 1];
    let w = (MIN_W + MAX_W) / 2;
    if (last) {
      const d = Math.hypot(x - last.x, y - last.y);
      if (d < 1) return false;
      const v = d / Math.max(1, t - last.t);
      const target = e.pointerType === 'pen' && e.pressure > 0
        ? MIN_W + (MAX_W - MIN_W) * e.pressure
        : clamp(MAX_W - v * 1.1, MIN_W, MAX_W);
      w = last.w * 0.65 + target * 0.35;
    }
    cur.push({ x, y, t, w });
    return true;
  }
  pad.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { pad.setPointerCapture(e.pointerId); } catch (_) { /* abaikan */ }
    cur = [];
    addPoint(e);
    strokes.push(cur);
    prepCtx(pctx, sigColor);
    drawDot(pctx, cur[0]);
    cur.from = cur[0];
    padWrap.classList.add('dirty');
  });
  pad.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      if (addPoint(ev)) cur.from = drawSeg(pctx, cur, cur.length - 1, cur.from);
    }
  });
  const endStroke = () => {
    if (!cur) return;
    const last = cur[cur.length - 1];
    pctx.beginPath(); pctx.moveTo(cur.from.x, cur.from.y); pctx.lineTo(last.x, last.y);
    pctx.lineWidth = last.w; pctx.stroke();
    cur = null;
  };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  $('#padUndo').addEventListener('click', () => { strokes.pop(); redrawPad(); });
  $('#padClear').addEventListener('click', () => { strokes = []; redrawPad(); });

  function exportDraw() {
    if (!strokes.length) return null;
    const r = pad.getBoundingClientRect();
    const k = 3;
    const c = document.createElement('canvas');
    c.width = Math.round(r.width * k);
    c.height = Math.round(r.height * k);
    const ctx = c.getContext('2d');
    ctx.scale(k, k);
    prepCtx(ctx, sigColor);
    strokes.forEach((s) => drawStroke(ctx, s));
    const t = trimCanvas(c, 18);
    return t && limitCanvas(t, 1400).toDataURL('image/png');
  }

  // ---------- Tab: Ketik ----------
  const fontList = $('#fontList');
  const typeName = $('#typeName');
  SIG_FONTS.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'font-opt';
    b.style.fontFamily = `"${f}", cursive`;
    b.dataset.font = f;
    b.addEventListener('click', () => { typeFont = f; updateFonts(); });
    fontList.appendChild(b);
  });
  function updateFonts() {
    const name = typeName.value.trim() || 'Nama Anda';
    $$('.font-opt', sigModal).forEach((b) => {
      b.textContent = name;
      b.style.color = sigColor;
      b.classList.toggle('active', b.dataset.font === typeFont);
    });
  }
  typeName.addEventListener('input', updateFonts);
  typeName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#sigApply').click(); } });

  async function exportType() {
    const name = typeName.value.trim();
    if (!name) return null;
    const size = 140;
    const font = `${size}px "${typeFont}", cursive`;
    try { await document.fonts.load(`${size}px "${typeFont}"`, name); } catch (_) { /* pakai font cadangan */ }
    const c = document.createElement('canvas');
    let ctx = c.getContext('2d');
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(name).width);
    c.width = w + size * 2;
    c.height = Math.round(size * 2.4);
    ctx = c.getContext('2d');
    ctx.font = font;
    ctx.fillStyle = sigColor;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, size, size * 1.5);
    const t = trimCanvas(c, 12);
    return t && limitCanvas(t, 1400).toDataURL('image/png');
  }

  // ---------- Tab: QR Code ----------
  const QR_FIELDS = { name: '#qrName', role: '#qrRole', org: '#qrOrg', nip: '#qrNip', contact: '#qrContact' };
  const QR_FORM_KEY = 'ttdin.qrform.v1';
  let qrLogo = '';
  function readQrForm() {
    const q = {};
    for (const [k, sel] of Object.entries(QR_FIELDS)) q[k] = $(sel).value.trim();
    q.doc = $('#qrDoc').checked;
    q.layout = $('#qrLayout').value;
    q.wm = $('#qrWm').checked;
    q.logo = qrLogo;
    q.color = sigColor;
    return q;
  }
  /** TTD QR lama (sebelum ada pilihan tampilan) memakai q.caption. */
  const qrLayoutOf = (q) => q.layout || (q.caption === false ? 'none' : 'below');

  const b64url = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64url = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  const hexBytes = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
  const bytesHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  /** Alamat halaman verifikasi = alamat situs ini (hanya jika dibuka lewat http/https). */
  function verifyBase() {
    if (!/^https?:$/.test(location.protocol)) return '';
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }
  /** Versi lama: teks biasa. Dipakai hanya jika KlinikPDF dibuka langsung dari file di komputer. */
  function qrTextPayload(q, opts = {}) {
    const L = ['DITANDATANGANI SECARA ELEKTRONIK', 'Nama: ' + (q.name || '-')];
    if (q.role) L.push('Jabatan: ' + q.role);
    if (q.org) L.push('Instansi: ' + q.org);
    if (q.nip) L.push(q.nip);
    if (q.contact) L.push('Kontak: ' + q.contact);
    if (opts.doc && q.doc) {
      L.push('Dokumen: ' + (S.name || 'dokumen.pdf'));
      L.push('Waktu: ' + formatDateTime());
      if (S.hash) L.push('SHA-256: ' + S.hash.slice(0, 32));
    }
    if (opts.code) L.push('Kode: ' + opts.code);
    return L.join('\n');
  }
  /**
   * Isi QR: tautan ke halaman verifikasi di situs ini. Datanya ikut di dalam tautan (setelah tanda #),
   * jadi tidak perlu server/database dan tidak pernah dikirim ke server saat dibuka.
   * Kamera HP mana pun langsung menawarkan untuk membuka tautannya.
   */
  // Teks ditulis hampir apa adanya (spasi → "+") agar tautan sependek mungkin: QR makin renggang & mudah dipindai.
  const urlPart = (s) => Array.from(new TextEncoder().encode(s), (b) => {
    if (b === 32) return '+';
    const ch = String.fromCharCode(b);
    return b < 128 && /[A-Za-z0-9.,\-_:/@;]/.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }).join('');
  function qrPayload(q, opts = {}) {
    const base = verifyBase();
    if (!base) return qrTextPayload(q, opts);
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const withDoc = opts.doc && q.doc;
    const f = ['2', q.name, q.role, q.org, q.nip, q.contact,
      withDoc ? clean(S.name || 'dokumen.pdf').slice(0, 50) : '',
      withDoc ? Math.floor(Date.now() / 1000).toString(36) : '',
      withDoc && S.hash ? b64url(hexBytes(S.hash.slice(0, 16))) : '',
      String(opts.code || '').replace(/^TTD-/, '')].map(clean);
    while (f.length > 2 && !f[f.length - 1]) f.pop();
    return `${base}#v=${f.map(urlPart).join('~')}`;
  }
  function parseQrPayload(s) {
    let f;
    if (s.startsWith('2~')) f = s.split('~').map((x) => decodeURIComponent(x.replace(/\+/g, ' ')));
    else f = new TextDecoder().decode(fromB64url(s)).split('\n'); // format versi 1
    if ((f[0] !== '1' && f[0] !== '2') || !f[1]) return null;
    const [, name, role, org, nip, contact, doc, t, hash, code] = f;
    const time = t ? new Date(parseInt(t, 36) * 1000) : null;
    return { name, role, org, nip, contact, doc, time: time && !Number.isNaN(time.getTime()) ? time : null, hash: hash ? bytesHex(fromB64url(hash)) : '', code: code ? 'TTD-' + code : '' };
  }

  const logoCache = new Map();
  function logoImage(src) {
    if (!src) return Promise.resolve(null);
    if (!logoCache.has(src)) logoCache.set(src, loadImage(src).catch(() => null));
    return logoCache.get(src);
  }
  /** Buat gambar TTD QR (memuat library, huruf, dan logo terlebih dahulu). */
  async function qrImage(q, opts) {
    await ensureQr();
    try { await document.fonts.load(`700 24px ${UI_FONT}`); } catch (_) { /* abaikan */ }
    return renderQrImage(qrPayload(q, opts), q, await logoImage(q.logo));
  }
  function renderQrImage(text, q, logo) {
    // Logo menutup sebagian modul, jadi koreksi galat dinaikkan (Q = 25%) agar QR tetap terbaca.
    const qr = window.qrcode(0, logo ? 'Q' : 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const cell = 8, quiet = 4;
    const qs = (n + quiet * 2) * cell;
    const ink = q.color || INK[0];
    const qc = document.createElement('canvas');
    qc.width = qc.height = qs;
    const x = qc.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, qs, qs);
    x.fillStyle = ink;
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < n; k++) if (qr.isDark(r, k)) x.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
    if (logo) {
      let m = Math.round(n * 0.22);
      if ((n - m) % 2) m++;
      const s = ((n - m) / 2 + quiet) * cell, size = m * cell;
      x.fillStyle = '#fff';
      x.beginPath();
      if (x.roundRect) x.roundRect(s, s, size, size, cell * 1.2); else x.rect(s, s, size, size);
      x.fill();
      const pad = cell * 0.9;
      const k = Math.min((size - 2 * pad) / logo.naturalWidth, (size - 2 * pad) / logo.naturalHeight);
      const w = logo.naturalWidth * k, h = logo.naturalHeight * k;
      x.drawImage(logo, s + (size - w) / 2, s + (size - h) / 2, w, h);
    }
    const layout = qrLayoutOf(q);
    if (layout === 'side') return qrSideLayout(qc, q, logo);
    if (layout === 'below' && q.name) return qrBelowLayout(qc, q);
    return qc.toDataURL('image/png');
  }
  function qrBelowLayout(qc, q) {
    const qs = qc.width;
    const capH = Math.round(qs * 0.2);
    const c = document.createElement('canvas');
    c.width = qs;
    c.height = qs + capH;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(qc, 0, 0);
    let fs = Math.round(qs * 0.085);
    x.font = `700 ${fs}px ${UI_FONT}`;
    while (x.measureText(q.name).width > qs * 0.94 && fs > 8) { fs--; x.font = `700 ${fs}px ${UI_FONT}`; }
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    x.fillStyle = q.color || INK[0];
    x.fillText(q.name, qs / 2, qs + fs * 0.35);
    let fs2 = Math.round(qs * 0.048);
    x.font = `500 ${fs2}px ${UI_FONT}`;
    const sub = 'Ditandatangani secara elektronik';
    while (x.measureText(sub).width > qs * 0.94 && fs2 > 6) { fs2--; x.font = `500 ${fs2}px ${UI_FONT}`; }
    x.fillStyle = '#475569';
    x.fillText(sub, qs / 2, qs + fs * 0.35 + fs2 * 1.6);
    return c.toDataURL('image/png');
  }
  /** QR di kiri, keterangan penanda tangan di kanan (gaya surat dinas). */
  function qrSideLayout(qc, q, logo) {
    const qs = qc.width;
    const SERIF = '"Times New Roman", Times, "Liberation Serif", serif';
    const meas = document.createElement('canvas').getContext('2d');
    const maxW = qs * 1.75;
    const wrap = (text, font) => {
      meas.font = font;
      const out = [];
      let line = '';
      for (const w of String(text).split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + w : w;
        if (line && meas.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
      }
      if (line) out.push(line);
      return out;
    };
    const build = (k) => {
      const s1 = qs * 0.07 * k, s2 = qs * 0.09 * k, s3 = qs * 0.08 * k;
      const f1 = `italic ${s1}px ${SERIF}`, f2 = `700 ${s2}px ${SERIF}`, f3 = `${s3}px ${SERIF}`;
      const L = [{ t: 'Ditandatangani secara elektronik oleh:', f: f1, s: s1 }];
      for (const part of [q.role, q.org].filter(Boolean)) wrap(part, f2).forEach((t) => L.push({ t, f: f2, s: s2 }));
      if (q.role || q.org) L.push({ gap: s2 * 0.9 });
      wrap(q.name || 'Nama Penanda Tangan', f2).forEach((t) => L.push({ t, f: f2, s: s2 }));
      if (q.nip) L.push({ t: q.nip, f: f3, s: s3 });
      const h = L.reduce((a, l) => a + (l.gap || l.s * 1.22), 0);
      return { L, h };
    };
    let k = 1, B = build(k);
    while (B.h > qs * 0.9 && k > 0.4) { k *= 0.93; B = build(k); }
    let tw = 0;
    for (const l of B.L) if (l.t) { meas.font = l.f; tw = Math.max(tw, meas.measureText(l.t).width); }
    const gap = qs * 0.06;
    const c = document.createElement('canvas');
    c.width = Math.ceil(qs + gap + tw + qs * 0.04);
    c.height = qs;
    const x = c.getContext('2d');
    x.drawImage(qc, 0, 0);
    if (logo && q.wm) {
      const h = qs * 0.92, w = (logo.naturalWidth / logo.naturalHeight) * h;
      x.save();
      x.globalAlpha = 0.1;
      x.drawImage(logo, c.width - w - qs * 0.02, (qs - h) / 2, w, h);
      x.restore();
    }
    x.fillStyle = q.color || INK[0];
    x.textBaseline = 'alphabetic';
    let y = (qs - B.h) / 2;
    for (const l of B.L) {
      if (l.gap) { y += l.gap; continue; }
      y += l.s * 1.22;
      x.font = l.f;
      x.fillText(l.t, qs + gap, y - l.s * 0.28);
    }
    return c.toDataURL('image/png');
  }

  let qrTimer;
  function updateQrPreview() {
    clearTimeout(qrTimer);
    qrTimer = setTimeout(async () => {
      try {
        const q = readQrForm();
        if (!q.name) q.name = 'Nama Anda';
        $('#qrPreview').src = await qrImage(q, { doc: true, code: 'TTD-XXXXXXXX' });
      } catch (e) { console.error(e); }
    }, 120);
  }
  function renderLogoUi() {
    $('#qrLogoPrev').hidden = !qrLogo;
    if (qrLogo) $('#qrLogoPrev').src = qrLogo;
    $('#qrLogoDel').hidden = !qrLogo;
    $('#qrLogoBtn').textContent = qrLogo ? 'Ganti logo' : 'Pilih logo';
    $('#qrWmWrap').hidden = !(qrLogo && $('#qrLayout').value === 'side');
  }
  [...Object.values(QR_FIELDS), '#qrDoc', '#qrLayout', '#qrWm'].forEach((sel) => {
    $(sel).addEventListener('input', updateQrPreview);
    $(sel).addEventListener('change', () => { renderLogoUi(); updateQrPreview(); });
  });
  $('#qrLogoBtn').addEventListener('click', () => { const i = $('#qrLogoFile'); i.value = ''; i.click(); });
  $('#qrLogoDel').addEventListener('click', () => { qrLogo = ''; renderLogoUi(); updateQrPreview(); });
  $('#qrLogoFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('Pilih file gambar logo (PNG atau JPG).', 'error'); return; }
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImage(url);
      const k = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      qrLogo = c.toDataURL('image/png');
    } catch (_) { toast('Logo tidak dapat dibaca.', 'error'); } finally { URL.revokeObjectURL(url); }
    renderLogoUi();
    updateQrPreview();
  });
  // Isi ulang data QR terakhir (disimpan di perangkat ini saja)
  (() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(QR_FORM_KEY)) || {}; } catch (_) { /* abaikan */ }
    for (const [k, sel] of Object.entries(QR_FIELDS)) if (saved[k]) $(sel).value = saved[k];
    if (saved.layout) $('#qrLayout').value = saved.layout;
    if (typeof saved.wm === 'boolean') $('#qrWm').checked = saved.wm;
    if (saved.logo) qrLogo = saved.logo;
    renderLogoUi();
  })();

  // ---------- Halaman verifikasi (dibuka saat QR dipindai) ----------
  const verifyModal = $('#verifyModal');
  let verifyData = null;
  function showVerify() {
    const m = location.hash.match(/^#v=(.+)$/);
    if (!m) return;
    let d = null;
    try { d = parseQrPayload(m[1]); } catch (_) { d = null; }
    verifyData = d;
    const body = $('#vfBody');
    body.innerHTML = '';
    const status = document.createElement('div');
    status.className = 'vf-status' + (d ? '' : ' bad');
    status.innerHTML = d ? ICON.ok : ICON.warn;
    const st = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = d ? 'Tanda tangan elektronik terbaca' : 'QR tidak dikenali';
    const sm = document.createElement('small');
    sm.textContent = d ? 'Data berikut tertanam di QR saat dokumen ditandatangani dengan KlinikPDF.' : 'Tautan ini rusak atau bukan dari KlinikPDF.';
    st.append(b, sm);
    status.appendChild(st);
    body.appendChild(status);
    if (d) {
      const rows = [['Nama', d.name], ['Jabatan', d.role], ['Instansi', d.org], ['Nomor identitas', d.nip], ['Kontak', d.contact], ['Dokumen', d.doc],
        ['Waktu', d.time && d.time.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB'],
        ['Sidik dokumen asli', d.hash], ['Kode', d.code]].filter(([, v]) => v);
      const dl = document.createElement('dl');
      dl.className = 'vf-list';
      for (const [k, v] of rows) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        if (k === 'Sidik dokumen asli') dd.className = 'mono';
        dl.append(dt, dd);
      }
      body.appendChild(dl);
    }
    $('#vfCheck').hidden = !(d && d.hash);
    $('#vfResult').hidden = true;
    openModal(verifyModal);
  }
  $('#vfCheckBtn').addEventListener('click', () => { const i = $('#vfFile'); i.value = ''; i.click(); });
  $('#vfFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f || !verifyData) return;
    const h = await sha256Hex(await f.arrayBuffer());
    const same = !!h && h.slice(0, verifyData.hash.length) === verifyData.hash;
    const r = $('#vfResult');
    r.hidden = false;
    r.className = 'vf-result ' + (same ? 'ok' : 'bad');
    r.textContent = same
      ? `Cocok. "${f.name}" adalah file asli yang ditandatangani (sebelum tanda tangan dibubuhkan).`
      : `Tidak cocok. "${f.name}" berbeda dari dokumen asli. Catatan: file yang sudah berisi tanda tangan memang selalu berbeda, jadi cocokkan dengan file sebelum ditandatangani.`;
  });
  new MutationObserver(() => {
    if (!verifyModal.classList.contains('open') && /^#v=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }).observe(verifyModal, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('hashchange', showVerify);

  // ---------- Simpan / gunakan ----------
  $('#sigApply').addEventListener('click', async () => {
    let entry = null;
    if (sigTab === 'upload') {
      if (uploadCanvas) entry = { kind: 'image', src: limitCanvas(uploadCanvas, 1400).toDataURL('image/png') };
    } else if (sigTab === 'draw') {
      const src = exportDraw();
      if (src) entry = { kind: 'image', src };
    } else if (sigTab === 'type') {
      const src = await exportType();
      if (src) entry = { kind: 'image', src };
    } else if (sigTab === 'qr') {
      const q = readQrForm();
      if (q.name) {
        entry = { kind: 'qr', qr: q, src: await qrImage(q, { doc: false }) };
        try {
          const { doc, color, ...form } = q;
          localStorage.setItem(QR_FORM_KEY, JSON.stringify(form));
        } catch (_) { /* abaikan */ }
      }
    }
    if (!entry) {
      const msg = {
        upload: 'Silakan unggah gambar tanda tangan terlebih dahulu.',
        draw: 'Silakan gambar tanda tangan Anda terlebih dahulu.',
        type: 'Silakan ketik nama Anda terlebih dahulu.',
        qr: 'Silakan isi nama lengkap untuk QR Code.',
      };
      toast(msg[sigTab] || 'Lengkapi tanda tangan terlebih dahulu.', 'error');
      return;
    }
    const open = docOpen();
    if (!open || $('#saveSig').checked) saveSignature(entry);
    closeModal(sigModal);
    if (sigTab === 'draw') { strokes = []; redrawPad(); }
    if (open) await placeSignature(entry);
    else toast('Tersimpan di "Tanda Tangan Saya". Sekarang pilih dokumen yang ingin ditandatangani.', 'ok');
  });

  // ==========================================================
  // EKSPOR
  // ==========================================================
  const dl = $('#dl');
  $('#btnDownload').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!S.pdf) return;
    dl.classList.toggle('open');
  });
  document.addEventListener('click', (e) => { if (!dl.contains(e.target)) dl.classList.remove('open'); });
  $$('[data-export]').forEach((b) => b.addEventListener('click', () => {
    dl.classList.remove('open');
    doExport(b.dataset.export);
  }));

  function baseName() {
    return (S.name.replace(/\.[^.]+$/, '') || 'dokumen').replace(/[\\/:*?"<>|]+/g, '_');
  }

  async function doExport(kind) {
    if (!S.pdf) return;
    if (S.pen) stopPen(true);
    if (S.sel) stopEdit(S.sel);
    select(null);
    if (!S.els.length && !confirm(S.mode === 'sign' ? 'Belum ada tanda tangan pada dokumen. Tetap unduh?' : 'Belum ada perubahan pada dokumen. Tetap unduh?')) return;
    if (kind === 'jpg' && S.els.some((e) => e.type === 'field') && !confirm('Kolom formulir hanya berfungsi di file PDF. Pada gambar JPG, kolom tampil sebagai kotak kosong. Lanjutkan?')) return;
    if (S.signed && !confirm('Dokumen ini memiliki tanda tangan digital / e-Meterai. Jika dilanjutkan, tanda tangan digital tersebut menjadi TIDAK VALID pada file hasil. Lanjutkan?')) return;
    showLoading(kind === 'jpg' ? 'Menyiapkan gambar…' : 'Menyiapkan PDF…');
    try {
      S.els.forEach((el) => { if (el.type === 'text') measureText(el); });
      if (kind === 'jpg') {
        const many = S.pages.length > 1;
        for (const p of S.pages) {
          if (many) showLoading(`Menyiapkan gambar… (${p.i + 1}/${S.pages.length})`);
          const c = await renderComposite(p, exportScale(p));
          const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
          download(blob, `${baseName()}-${MODES[S.mode].suffix}${many ? `-hal${p.i + 1}` : ''}.jpg`);
          if (many) await sleep(400);
        }
        toast(many ? `Berhasil! ${S.pages.length} gambar sudah diunduh.` : 'Berhasil! Gambar sudah diunduh.', 'ok');
      } else {
        const blob = await exportPdf();
        download(blob, `${baseName()}-${MODES[S.mode].suffix}.pdf`);
        toast(S.mode === 'sign' ? 'Berhasil! Dokumen yang sudah ditandatangani sudah diunduh.' : 'Berhasil! Dokumen sudah diunduh.', 'ok');
      }
      S.dirty = false;
    } catch (err) {
      console.error(err);
      toast('Gagal membuat file. Silakan coba lagi.', 'error');
    } finally {
      hideLoading();
    }
  }

  function exportScale(p) {
    const want = S.kind === 'image' ? 5 : 2.5;
    return Math.min(want, 4000 / Math.max(p.w, p.h));
  }

  /** Gambar teks pada kanvas dengan tata letak yang sama seperti di layar. */
  function drawTextLines(ctx, text, fontPx, color, ox, oy, padPx) {
    ctx.font = `${fontPx}px ${TEXT_FONT}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    const lh = fontPx * LINE_H;
    const m = ctx.measureText('Hg');
    const asc = m.fontBoundingBoxAscent || fontPx * 0.905;
    const desc = m.fontBoundingBoxDescent || fontPx * 0.212;
    const half = (lh - (asc + desc)) / 2;
    text.split('\n').forEach((line, i) => ctx.fillText(line, ox + padPx, oy + i * lh + half + asc));
  }

  function textPng(el) {
    const p = S.pages[el.page];
    const k = 4; // piksel per point (~288 dpi)
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(el.w * p.w * k));
    c.height = Math.max(1, Math.ceil(el.h * p.h * k));
    drawTextLines(c.getContext('2d'), el.text, el.fs * p.w * k, el.color, 0, 0, (k * p.w) / p.cssW);
    return dataUrlToBytes(c.toDataURL('image/png'));
  }

  /** Posisi elemen (koordinat layar) -> koordinat PDF, termasuk halaman yang diputar. */
  function pdfRect(el, p, flat) {
    const [x0, y0, x1, y1] = flat ? [0, 0, p.w, p.h] : p.view;
    const u = el.x * p.w, v = el.y * p.h;
    const dw = el.w * p.w, dh = el.h * p.h;
    const vb = v + dh;
    const rot = flat ? 0 : ((p.rotate % 360) + 360) % 360;
    let x, y;
    if (rot === 90) { x = x0 + vb; y = y0 + u; }
    else if (rot === 180) { x = x1 - u; y = y0 + vb; }
    else if (rot === 270) { x = x1 - vb; y = y1 - u; }
    else { x = x0 + u; y = y1 - vb; }
    return { x, y, width: dw, height: dh, rotate: window.PDFLib.degrees(rot) };
  }

  function hexRgb(h) {
    const n = parseInt(String(h).replace('#', ''), 16) || 0;
    return window.PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  function drawShapePdf(page, el, p) {
    const { rgb, BlendMode } = window.PDFLib;
    const r = pdfRect(el, p);
    if (el.shape === 'highlight') page.drawRectangle({ ...r, color: hexRgb(el.color), opacity: 0.45, blendMode: BlendMode.Multiply });
    else if (el.shape === 'rect') page.drawRectangle({ ...r, borderColor: hexRgb(el.color), borderWidth: 1.5 });
    else page.drawRectangle({ ...r, color: el.shape === 'whiteout' ? rgb(1, 1, 1) : rgb(0, 0, 0) });
  }

  async function exportPdf() {
    const { PDFDocument, rgb } = window.PDFLib;
    let doc;
    try {
      doc = await PDFDocument.load(S.bytes, { updateMetadata: false });
    } catch (e) {
      // PDF terkunci izin: coba lepas enkripsinya dulu agar teks tetap bisa dipilih
      try {
        await loadScript('js/pdfcrypt.js');
        doc = await PDFDocument.load((await window.PDFCrypt.decrypt(S.bytes, '')).bytes, { updateMetadata: false });
      } catch (e2) {
        // PDF tidak standar: buat ulang dari hasil render
        console.warn('Beralih ke mode PDF gambar:', e, e2);
        return exportFlatPdf();
      }
    }
    let pages = doc.getPages();
    const cache = new Map();
    // Halaman yang disensor dijadikan gambar agar teks di bawah kotak hitam benar-benar hilang.
    const redacted = new Set(S.els.filter((e) => e.type === 'shape' && e.shape === 'redact').map((e) => e.page));
    for (const el of S.els) {
      if (redacted.has(el.page) || el.type === 'field') continue;
      const p = S.pages[el.page];
      if (el.type === 'shape') { drawShapePdf(pages[el.page], el, p); continue; }
      let img;
      if (el.type === 'image') {
        img = cache.get(el.src);
        if (!img) {
          const bytes = dataUrlToBytes(el.src);
          img = el.src.startsWith('data:image/jpeg') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
          cache.set(el.src, img);
        }
      } else {
        img = await doc.embedPng(textPng(el));
      }
      pages[el.page].drawImage(img, pdfRect(el, p));
    }
    for (const i of [...redacted].sort((a, b) => a - b)) {
      const p = S.pages[i];
      const c = await renderComposite(p, Math.min(2.5, 3500 / Math.max(p.w, p.h)), { noFields: true });
      const jpg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
      const np = doc.insertPage(i, [p.w, p.h]);
      np.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: p.w, height: p.h });
      doc.removePage(i + 1);
    }
    pages = doc.getPages();
    const fields = S.els.filter((e) => e.type === 'field');
    if (fields.length) {
      const form = doc.getForm();
      for (const el of fields) {
        const p = S.pages[el.page];
        const base = String(el.name || 'Kolom').replace(/\./g, '_').trim() || 'Kolom';
        let name = base, k = 2;
        while (form.getFieldMaybe(name)) name = `${base}_${k++}`;
        const r = pdfRect(el, p, redacted.has(el.page));
        const o = { x: r.x, y: r.y, width: r.width, height: r.height, rotate: r.rotate, borderColor: rgb(0.55, 0.6, 0.7), borderWidth: 0.75 };
        if (el.field === 'check') form.createCheckBox(name).addToPage(pages[el.page], o);
        else form.createTextField(name).addToPage(pages[el.page], o);
      }
    }
    doc.setProducer('KlinikPDF');
    doc.setModificationDate(new Date());
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }

  async function exportFlatPdf() {
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.create();
    for (const p of S.pages) {
      const c = await renderComposite(p, Math.min(2.5, 3500 / Math.max(p.w, p.h)));
      const jpg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
      const page = doc.addPage([p.w, p.h]);
      page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: p.w, height: p.h });
    }
    doc.setProducer('KlinikPDF');
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }

  /** Render halaman + semua elemen di atasnya menjadi satu kanvas. */
  async function renderComposite(p, scale, opts = {}) {
    const vp = p.page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await p.page.render({ canvasContext: ctx, viewport: vp }).promise;
    const k = c.width / p.w;
    for (const el of S.els) {
      if (el.page !== p.i) continue;
      const x = el.x * c.width, y = el.y * c.height;
      const w = el.w * c.width, h = el.h * c.height;
      if (el.type === 'image') {
        ctx.drawImage(await loadImage(el.src), x, y, w, h);
      } else if (el.type === 'shape') {
        ctx.save();
        if (el.shape === 'highlight') { ctx.globalAlpha = 0.45; ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = el.color; ctx.fillRect(x, y, w, h); }
        else if (el.shape === 'rect') { ctx.strokeStyle = el.color; ctx.lineWidth = 1.5 * k; ctx.strokeRect(x, y, w, h); }
        else { ctx.fillStyle = el.shape === 'whiteout' ? '#fff' : '#000'; ctx.fillRect(x, y, w, h); }
        ctx.restore();
      } else if (el.type === 'field') {
        if (opts.noFields) continue;
        ctx.save();
        ctx.strokeStyle = '#8c99b3';
        ctx.lineWidth = Math.max(1, 0.75 * k);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      } else {
        ctx.save();
        drawTextLines(ctx, el.text, el.fs * p.w * k, el.color, x, y, (k * p.w) / p.cssW);
        ctx.restore();
      }
    }
    return c;
  }

  renderLibraries();
  showVerify();

  // API kecil untuk js/tools.js (alat PDF lainnya)
  window.TTDIN = {
    $, $$, clamp, uid, sleep, svg, ICON, IS_FILE,
    toast, loadScript, ensureLibs, download, loadImage, canvasToBlob, dataUrlToBytes, formatDate,
    docxToPdf, bytesInclude, unlockPdf, askPassword, loadSaved,
    openInEditor: (file, mode) => openFile(file, { mode }),
    pickForEditor: (mode) => pickFile(mode),
  };
})();
