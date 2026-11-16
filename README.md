# KlinikPDF — Tanda Tangan Digital & Alat PDF

Website untuk menandatangani dokumen **PDF, Word (DOCX), JPG, PNG, dan WEBP** langsung dari browser,
plus **39 alat PDF** (gabung, pisah, kompres, konversi, kunci, OCR, dan lainnya).
Gratis, tanpa daftar, **tanpa batas halaman**, **bisa offline**, dan **dokumen tidak pernah diunggah ke server**.

Dibuat oleh **Samsul Arifin**, peneliti Artificial Intelligence, Data Science, Computer Vision, dan Biomedical
· [GitHub](https://github.com/samsulchin)
· [Google Scholar](https://scholar.google.com/citations?user=ZVBGYEYAAAAJ&hl=id)
· [Scopus 60377470100](https://www.scopus.com/authid/detail.uri?authorId=60377470100)

## Alur pemakaian

1. **Siapkan tanda tangan** di panel *Tanda Tangan Saya*:
   - **Unggah** tanda tangan yang sudah ada (latar putih dihapus otomatis), atau
   - **Buat baru**: gambar manual, ketik nama (6 gaya tulisan tangan), atau **QR Code**
2. **Unggah dokumen**: PDF, DOCX, JPG, PNG, atau WEBP, berapa pun jumlah halamannya
3. **Drag & drop** tanda tangan ke halaman mana pun, atur posisi dan ukuran, lalu **Unduh** (PDF/JPG)

## Fitur

- Pustaka *Tanda Tangan Saya*, disimpan di perangkat (localStorage); bisa disiapkan sebelum membuka dokumen
- Drag & drop dari panel ke halaman, dengan mouse maupun jari (di HP lewat strip bawah)
- **TTD QR Code** berisi nama, jabatan, instansi, kontak, nama dokumen, waktu (WIB),
  sidik **SHA-256** dokumen asli, dan kode unik. Bisa dipindai kamera HP mana pun.
- Paraf ke semua halaman sekali klik; teks, tanggal otomatis, centang, silang
- Word (.docx) dikonversi ke PDF di browser (tanpa server)
- **e-Meterai**: panduan urutan yang benar, tautan portal resmi, dan **deteksi otomatis** PDF yang sudah
  bertanda tangan digital/e-Meterai, dengan peringatan sebelum disimpan ulang
- PWA: bisa **dipasang** di HP/laptop dan dipakai **tanpa internet**
- Mendukung halaman PDF yang diputar dan PDF terkunci (kata sandi diminta bila perlu)
- Editor juga punya: sisipkan gambar, pena (coretan bebas), stabilo, kotak, tutup putih,
  **sensor permanen** (halaman yang disensor diratakan agar teks di bawah kotak hitam benar-benar hilang),
  serta **kolom isian & kotak centang** yang menjadi formulir PDF sungguhan

## Alat PDF (menu "Alat PDF", tautan langsung `#alat/<nama-alat>`)

| Kategori | Alat |
|---|---|
| Atur & Gabung | Atur PDF, Gabung PDF, Pisah PDF, Putar Halaman, Hapus Halaman, Ambil Halaman, Urutkan Halaman (termasuk merapikan scan bolak-balik), Halaman per Lembar (2–16), Ubah Ukuran Halaman (A4, F4, Letter, …), Potong/Crop (manual atau otomatis) |
| Konversi | Konversi ke PDF (DOCX, XLSX/CSV, PPTX, gambar, TXT), Excel ke PDF, PowerPoint ke PDF, Gambar ke PDF, PDF ke Word/Teks/JPG/PNG, PDF ke Gambar, Ekstrak Gambar, OCR (Indonesia + Inggris) |
| Edit & Tanda Tangan | Tanda Tangan, Edit, Anotasi, Sensor, Buat Formulir (lewat editor), Watermark teks/logo, Nomor Halaman, Overlay/Kop Surat, Ratakan (Flatten) |
| Optimasi & Keamanan | Kompres, Optimasi Web, Kunci PDF (AES-256), Buka Kunci (RC4/AES-128/AES-256), Perbaiki PDF, Bandingkan PDF (teks & visual) |
| Properti Dokumen | Edit Metadata, Hapus Metadata, Preferensi Tampilan, Edit Bookmark |
| Buat Dokumen | Buat Invoice (Rupiah), Surat Lamaran Kerja (+ gabung CV & lampiran) |

Catatan batasan (karena semuanya berjalan di browser tanpa server):
- **PDF ke Word** mode "teks bisa diedit" menyusun ulang paragraf; tabel dan kolom rumit bisa bergeser.
  Mode "tata letak persis" menyimpan tiap halaman sebagai gambar di Word.
- **Excel ke PDF** menggambar ulang sheet sebagai tabel vektor (teks tetap bisa dicari), lengkap dengan format
  angka/tanggal/Rupiah, sel gabungan, warna, bingkai, gambar, area cetak, dan judul yang diulang. Grafik (chart)
  di dalam Excel belum ikut. Rumus memakai hasil terakhir yang disimpan Excel.
- **PowerPoint ke PDF** menggambar tiap slide (bentuk, gambar, tabel, SmartArt, grafik sederhana) menjadi gambar
  beresolusi tinggi plus lapisan teks tak terlihat agar PDF bisa dicari. Animasi/video tidak ikut, dan huruf yang
  tidak terpasang di perangkat diganti huruf serupa.
- Format Office lama (`.doc`, `.xls`, `.ppt`) belum didukung; simpan ulang sebagai `.docx`/`.xlsx`/`.pptx`.
- **Optimasi Web** memperkecil gambar & memadatkan struktur, tetapi tidak melakukan linearisasi (Fast Web View).
- **OCR** butuh versi online/terpasang (tidak bisa dari `file://`). Data bahasa (±4 MB) dimuat saat pertama dipakai,
  lalu tersimpan untuk penggunaan offline.

### Soal e-Meterai

e-Meterai resmi hanya diterbitkan **Peruri** melalui distributor resmi (misalnya [e-meterai.co.id](https://e-meterai.co.id/)).
Setiap meterai punya nomor seri dan tanda tangan digital, dan membuat meterai tiruan melanggar
UU No. 10 Tahun 2020 tentang Bea Meterai. Karena itu KlinikPDF **tidak membuat meterai**. Urutan yang benar:
tanda tangani di KlinikPDF → unduh PDF → bubuhkan e-Meterai di portal resmi → jangan edit lagi.

## Pakai sendiri secara offline

**Cara 1, tanpa instal apa pun:** buka file `index.html` di Chrome/Edge (klik dua kali). Semua fitur jalan dari folder.

**Cara 2, sebagai aplikasi:** buka situs yang sudah di-hosting sekali, lalu klik **Pasang Aplikasi**
(atau menu browser → *Install app* / *Tambahkan ke Layar Utama*). Setelah itu bisa dibuka tanpa internet.

**Cara 3, server lokal** (butuh [Node.js](https://nodejs.org)):

```bash
npm start      # lalu buka http://localhost:5173
```

## Hosting agar bisa dipakai orang lain

Ini website statis (tanpa database, tanpa backend), jadi bisa di-hosting gratis.

### Vercel

1. Upload folder ini ke repositori GitHub
2. Buka [vercel.com/new](https://vercel.com/new), pilih repositori tersebut
3. Framework Preset: **Other**, Build Command: *(kosong)*, Output Directory: *(kosong / `.`)*
4. Klik **Deploy**. Konfigurasi header sudah disiapkan di `vercel.json`.

Atau lewat terminal: `npx vercel --prod`

### InfinityFree (atau hosting cPanel/Apache lain)

1. Buat akun dan situs di [infinityfree.com](https://www.infinityfree.com)
2. Buka **File Manager** (atau FTP dengan FileZilla) → masuk folder `htdocs`
3. Upload **seluruh isi** folder ini (termasuk `.htaccess`, `vendor/`, `assets/`, `css/`, `js/`)
4. Aktifkan **SSL gratis** di panel InfinityFree (HTTPS wajib agar fitur offline/PWA aktif).
   `.htaccess` otomatis mengalihkan ke HTTPS.

> Setiap kali mengubah file, naikkan `VERSION` di `sw.js` (misalnya `klinikpdf-v3.2.1`) supaya pengunjung
> mendapatkan versi terbaru, bukan versi lama yang tersimpan untuk offline.

## Struktur

```
index.html            Landing page + editor + alat PDF (satu halaman)
css/style.css         Gaya landing page
css/editor.css        Gaya editor & modal
css/tools.css         Gaya halaman alat PDF
js/app.js             Editor tanda tangan, modal, dan API kecil (window.TTDIN)
js/tools.js           Semua alat PDF (daftar alat, antarmuka, dan prosesnya)
js/pdfcrypt.js        Enkripsi/dekripsi PDF (dimuat saat dibutuhkan)
sw.js                 Service worker (mode offline)
manifest.webmanifest  Data aplikasi PWA
vendor/               pdf.js 3.11.174, pdf-lib 1.17.1, qrcode-generator 1.4.4,
                      docx-preview 0.3.3, JSZip 3.10.1, html2canvas 1.4.1,
                      tesseract.js 5.1.1 + data bahasa ind/eng (vendor/tesseract, untuk OCR)
assets/               Logo, ikon aplikasi, font lokal (SIL OFL)
vercel.json           Konfigurasi Vercel
.htaccess             Konfigurasi Apache / InfinityFree
server.js             Server lokal sederhana
```

## Catatan hukum

Tanda tangan dari KlinikPDF (gambar maupun QR) termasuk **tanda tangan elektronik tidak tersertifikasi**
(UU ITE & PP No. 71 Tahun 2019). Untuk dokumen yang mewajibkan tanda tangan elektronik tersertifikasi,
gunakan layanan PSrE yang diakui pemerintah.
