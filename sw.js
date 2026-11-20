/* KlinikPDF — Service worker: menyimpan semua file aplikasi agar bisa dipakai offline.
   Naikkan VERSION setiap kali ada perubahan file supaya pengguna mendapat versi terbaru. */
const VERSION = 'klinikpdf-v3.4.0';
// Kunci cache untuk halaman utama (satu-satunya halaman HTML aplikasi).
const PAGE = 'index.html';
// Mesin OCR (vendor/tesseract, ±12 MB) tidak ikut disimpan di awal: disimpan otomatis saat pertama dipakai.
const ASSETS = [
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

/* Respons hasil pengalihan (mis. Vercel "cleanUrls" mengalihkan /index.html → /) DITOLAK browser
   bila dipakai untuk membuka halaman saat offline. Salin ulang menjadi respons biasa sebelum disimpan. */
async function clean(res) {
  if (!res || !res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // cache: 'reload' memastikan yang disimpan adalah versi terbaru dari server, bukan salinan lama di cache browser.
    await c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    const page = await fetch(new Request('./', { cache: 'reload' }));
    if (!page.ok) throw new Error('Halaman utama gagal disimpan untuk offline');
    await c.put(PAGE, await clean(page));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cachedPage() {
  const hit = await caches.match(PAGE);
  return hit ? clean(hit) : null;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tautan luar (GitHub, Scholar, dll.) tidak di-cache

  // Halaman: coba jaringan dulu (agar selalu terbaru). Saat offline, atau sinyal sangat lambat (> 4 detik),
  // pakai salinan tersimpan.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const net = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') event.waitUntil(clean(res.clone()).then((r) => caches.open(VERSION).then((c) => c.put(PAGE, r))));
        return res;
      });
      net.catch(() => {}); // hindari peringatan "unhandled rejection" bila salinan tersimpan yang dipakai
      const slow = new Promise((resolve) => setTimeout(resolve, 4000)).then(cachedPage);
      try {
        const first = await Promise.race([net, slow]);
        if (first) return first;
        return await net;
      } catch (_) {
        return (await cachedPage()) || Response.error();
      }
    })());
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
