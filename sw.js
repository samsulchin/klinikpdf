/* KlinikPDF — Service worker: menyimpan semua file aplikasi agar bisa dipakai offline.
   Naikkan VERSION setiap kali ada perubahan file supaya pengguna mendapat versi terbaru. */
const VERSION = 'klinikpdf-v3.3.2';
// Mesin OCR (vendor/tesseract, ±12 MB) tidak ikut disimpan di awal: disimpan otomatis saat pertama dipakai.
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'css/editor.css',
  'css/tools.css',
  'js/app.js',
  'js/tools.js',
  'js/pdfcrypt.js',
  'js/office.js',
  'assets/favicon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/fonts/fonts.css',
  'assets/fonts/PlusJakartaSans.woff2',
  'assets/fonts/DancingScript.woff2',
  'assets/fonts/GreatVibes.woff2',
  'assets/fonts/Caveat.woff2',
  'assets/fonts/Sacramento.woff2',
  'assets/fonts/Allura.woff2',
  'assets/fonts/Satisfy.woff2',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
  'vendor/pdf-lib.min.js',
  'vendor/qrcode.js',
  'vendor/jszip.min.js',
  'vendor/docx-preview.min.js',
  'vendor/html2canvas.min.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' memastikan yang disimpan adalah versi terbaru dari server, bukan salinan lama di cache browser.
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tautan luar (GitHub, Scholar, dll.) tidak di-cache

  // Halaman: coba jaringan dulu (agar selalu terbaru), jatuh ke cache saat offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { caches.open(VERSION).then((c) => c.put('index.html', res.clone())); return res; })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // File statis: cache dulu, lalu jaringan.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
