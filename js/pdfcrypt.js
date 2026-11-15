/* ==========================================================
   TTD.in — Enkripsi & dekripsi PDF (Standard Security Handler)
   - Kunci: AES-256 (PDF 2.0 / revisi 6), didukung semua pembaca modern
   - Buka:  RC4 40/128-bit, AES-128, AES-256 (revisi 2–6)
   Berjalan 100% di browser memakai pdf-lib + WebCrypto.
   ========================================================== */
(() => {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  const L = () => G.PDFLib;

  // ---------- Byte util ----------
  const enc = new TextEncoder();
  function concat(...parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  function randomBytes(n) {
    const b = new Uint8Array(n);
    G.crypto.getRandomValues(b);
    return b;
  }
  function equal(a, b, n) {
    if (a.length < n || b.length < n) return false;
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function int32le(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    return b;
  }

  // ---------- MD5 ----------
  const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const MD5_K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
  function md5(msg) {
    const n = msg.length;
    const total = Math.ceil((n + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[n] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, (n * 8) >>> 0, true);
    dv.setUint32(total - 4, Math.floor(n / 536870912), true);
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    const M = new Int32Array(16);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        F = (F + A + MD5_K[i] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16);
    const o = new DataView(out.buffer);
    o.setInt32(0, a0, true); o.setInt32(4, b0, true); o.setInt32(8, c0, true); o.setInt32(12, d0, true);
    return out;
  }

  // ---------- RC4 ----------
  function rc4(key, data) {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 255;
      const t = s[i]; s[i] = s[j]; s[j] = t;
    }
    const out = new Uint8Array(data.length);
    let i = 0;
    j = 0;
    for (let k = 0; k < data.length; k++) {
      i = (i + 1) & 255;
      j = (j + s[i]) & 255;
      const t = s[i]; s[i] = s[j]; s[j] = t;
      out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
    }
    return out;
  }

  // ---------- AES & SHA (WebCrypto) ----------
  function subtle() {
    if (!G.crypto || !G.crypto.subtle) {
      const e = new Error('Browser ini tidak menyediakan WebCrypto (buka lewat https atau localhost).');
      e.code = 'NO_CRYPTO';
      throw e;
    }
    return G.crypto.subtle;
  }
  const keyCache = new Map();
  function aesKey(raw) {
    const id = toHex(raw);
    let k = keyCache.get(id);
    if (!k) {
      k = subtle().importKey('raw', raw, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
      if (keyCache.size > 64) keyCache.clear();
      keyCache.set(id, k);
    }
    return k;
  }
  async function aesEncrypt(key, iv, data, pad = true) {
    const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, await aesKey(key), data));
    return pad ? out : out.subarray(0, data.length);
  }
  /** Dekripsi AES-CBC tanpa padding (WebCrypto selalu meminta PKCS#7, jadi ditambah blok buatan). */
  async function aesDecryptNoPad(key, iv, data) {
    if (!data.length) return new Uint8Array(0);
    const k = await aesKey(key);
    const last = data.subarray(data.length - 16);
    const extra = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last }, k, new Uint8Array(16).fill(16))).subarray(0, 16);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, concat(data, extra)));
  }
  async function aesDecryptContent(key, data) {
    if (data.length < 32) return new Uint8Array(0);
    const iv = data.subarray(0, 16);
    let body = data.subarray(16);
    if (body.length % 16) body = body.subarray(0, body.length - (body.length % 16));
    try {
      return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, await aesKey(key), body));
    } catch (_) {
      return aesDecryptNoPad(key, iv, body); // padding rusak: ambil apa adanya
    }
  }
  async function aesEncryptContent(key, data) {
    const iv = randomBytes(16);
    return concat(iv, await aesEncrypt(key, iv, data));
  }
  async function sha(alg, data) { return new Uint8Array(await subtle().digest(alg, data)); }

  /** Algoritma 2.B (ISO 32000-2) untuk revisi 6. */
  async function hash2B(pw, salt, udata) {
    let K = await sha('SHA-256', concat(pw, salt, udata));
    let E = null;
    let i = 0;
    while (i < 64 || E[E.length - 1] > i - 32) {
      const seq = concat(pw, K, udata);
      const K1 = new Uint8Array(seq.length * 64);
      for (let r = 0; r < 64; r++) K1.set(seq, r * seq.length);
      E = await aesEncrypt(K.subarray(0, 16), K.subarray(16, 32), K1, false);
      let sum = 0;
      for (let r = 0; r < 16; r++) sum += E[r];
      K = await sha(['SHA-256', 'SHA-384', 'SHA-512'][sum % 3], E);
      i++;
    }
    return K.subarray(0, 32);
  }
  async function hashR5(pw, salt, udata, rev) {
    if (rev === 5) return sha('SHA-256', concat(pw, salt, udata));
    return hash2B(pw, salt, udata);
  }

  // ---------- Kata sandi ----------
  const PAD = new Uint8Array([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
  function pwLatin1(s) {
    const out = [];
    for (const ch of String(s || '')) {
      const c = ch.codePointAt(0);
      out.push(c < 256 ? c : 63);
      if (out.length >= 32) break;
    }
    return new Uint8Array(out);
  }
  function pwUtf8(s) {
    let b = enc.encode(String(s || '').normalize('NFKC'));
    if (b.length > 127) b = b.subarray(0, 127);
    return b;
  }
  function padPw(b) {
    const out = new Uint8Array(32);
    const n = Math.min(32, b.length);
    out.set(b.subarray(0, n));
    out.set(PAD.subarray(0, 32 - n), n);
    return out;
  }
  function keyR4(pw32, O, P, id0, R, n, encMeta) {
    const tail = R >= 4 && !encMeta ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0);
    let h = md5(concat(pw32, O.subarray(0, 32), int32le(P), id0, tail));
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
    return h.slice(0, n);
  }
  function computeU(key, R, id0) {
    if (R === 2) return rc4(key, PAD);
    let h = rc4(key, md5(concat(PAD, id0)));
    for (let i = 1; i <= 19; i++) h = rc4(key.map((b) => b ^ i), h);
    return h;
  }
  function userPwFromOwner(ownerPw, O, R, n) {
    let h = md5(padPw(ownerPw));
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
    const key = h.subarray(0, n);
    let u = O.subarray(0, 32);
    if (R === 2) return rc4(key, u);
    for (let i = 19; i >= 0; i--) u = rc4(key.map((b) => b ^ i), u);
    return u;
  }

  // ---------- Membaca kamus PDF ----------
  function lookup(ctx, v) { return v ? ctx.lookup(v) : undefined; }
  function bytesOf(o) {
    const { PDFString, PDFHexString } = L();
    if (o instanceof PDFString || o instanceof PDFHexString) return o.asBytes();
    return new Uint8Array(0);
  }
  function numOf(o, d) { return o && typeof o.asNumber === 'function' ? o.asNumber() : d; }
  function nameOf(o) { return o ? String(o).replace(/^\//, '') : ''; }

  function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

  /** Baca kamus /Encrypt dan siapkan fungsi dekripsi untuk kata sandi tertentu. */
  async function makeDecryptor(ctx, password) {
    const { PDFName, PDFDict, PDFArray } = L();
    const encRef = ctx.trailerInfo.Encrypt;
    const E = lookup(ctx, encRef);
    if (!(E instanceof PDFDict)) throw err('NOT_ENCRYPTED', 'PDF tidak terenkripsi');
    const g = (k) => E.lookup(PDFName.of(k));
    const filter = nameOf(g('Filter'));
    if (filter && filter !== 'Standard') throw err('UNSUPPORTED', 'Jenis enkripsi tidak didukung: ' + filter);
    const V = numOf(g('V'), 0);
    const R = numOf(g('R'), 2);
    const P = numOf(g('P'), -1) | 0;
    const O = bytesOf(g('O'));
    const U = bytesOf(g('U'));
    const encMetaObj = g('EncryptMetadata');
    const encMeta = !(encMetaObj && String(encMetaObj) === 'false');
    let id0 = new Uint8Array(0);
    const ID = lookup(ctx, ctx.trailerInfo.ID);
    if (ID instanceof PDFArray && ID.size()) id0 = bytesOf(ID.lookup(0));

    // Metode untuk string & stream
    let stm = 'RC4', str = 'RC4';
    let n = Math.max(5, Math.min(16, numOf(g('Length'), 40) / 8));
    if (V === 1) n = 5;
    if (V >= 4) {
      const CF = g('CF');
      const method = (fname) => {
        if (!fname || fname === 'Identity') return 'none';
        const cf = CF instanceof PDFDict ? CF.lookup(PDFName.of(fname)) : null;
        const cfm = cf instanceof PDFDict ? nameOf(cf.lookup(PDFName.of('CFM'))) : 'None';
        if (cfm === 'V2') return 'RC4';
        if (cfm === 'AESV2') return 'AES';
        if (cfm === 'AESV3') return 'AES256';
        if (cfm === 'None' || !cfm) return 'none';
        throw err('UNSUPPORTED', 'Metode enkripsi tidak didukung: ' + cfm);
      };
      stm = method(nameOf(g('StmF')) || 'Identity');
      str = method(nameOf(g('StrF')) || 'Identity');
      if (V === 4) {
        const cf = CF instanceof PDFDict ? CF.lookup(PDFName.of(nameOf(g('StmF')) || 'StdCF')) : null;
        const len = cf instanceof PDFDict ? numOf(cf.lookup(PDFName.of('Length')), 16) : 16;
        n = len > 16 ? len / 8 : len || 16;
        if (stm === 'AES' || str === 'AES') n = 16;
      }
    }

    let fileKey = null;
    let owner = false;
    if (R >= 5) {
      const OE = bytesOf(g('OE')), UE = bytesOf(g('UE'));
      const pw = pwUtf8(password);
      const U48 = U.subarray(0, 48);
      if (equal(await hashR5(pw, O.subarray(32, 40), U48, R), O, 32)) {
        owner = true;
        fileKey = await aesDecryptNoPad(await hashR5(pw, O.subarray(40, 48), U48, R), new Uint8Array(16), OE.subarray(0, 32));
      } else if (equal(await hashR5(pw, U.subarray(32, 40), new Uint8Array(0), R), U, 32)) {
        fileKey = await aesDecryptNoPad(await hashR5(pw, U.subarray(40, 48), new Uint8Array(0), R), new Uint8Array(16), UE.subarray(0, 32));
      }
      if (!fileKey) throw err('PASSWORD', 'Kata sandi salah');
    } else {
      const check = (pw32) => {
        const key = keyR4(pw32, O, P, id0, R, n, encMeta);
        const u = computeU(key, R, id0);
        return equal(u, U, R === 2 ? 32 : 16) ? key : null;
      };
      const pw = pwLatin1(password);
      fileKey = check(padPw(pw));
      if (!fileKey) {
        fileKey = check(userPwFromOwner(pw, O, R, n));
        owner = !!fileKey;
      }
      if (!fileKey) throw err('PASSWORD', 'Kata sandi salah');
    }

    const objKey = (num, gen, aes) => {
      const ext = concat(fileKey, new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]),
        aes ? new Uint8Array([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0));
      return md5(ext).subarray(0, Math.min(fileKey.length + 5, 16));
    };
    const run = async (method, data, num, gen) => {
      if (method === 'none' || !data.length) return data;
      if (method === 'RC4') return rc4(objKey(num, gen, false), data);
      if (method === 'AES') return aesDecryptContent(objKey(num, gen, true), data);
      return aesDecryptContent(fileKey, data);
    };
    return {
      encRef, owner, encMeta, R, V,
      perms: P,
      string: (data, num, gen) => run(str, data, num, gen),
      stream: (data, num, gen) => run(stm, data, num, gen),
    };
  }

  // ---------- Mem-parsing PDF terenkripsi dengan pdf-lib ----------
  /**
   * pdf-lib tidak bisa membaca object stream yang terenkripsi, jadi parser-nya dipasangi "kait":
   * setiap object stream didekripsi dulu sebelum diurai.
   */
  async function parseWith(bytes, onObjStm) {
    const { PDFParser, PDFObjectStreamParser, PDFContext } = L();
    const origFor = PDFObjectStreamParser.forStream;
    const origHdr = PDFParser.prototype.parseIndirectObjectHeader;
    const origAssign = PDFContext.prototype.assign;
    let lastRef = null;
    const fromObjStm = new Set();
    let inside = false;
    PDFParser.prototype.parseIndirectObjectHeader = function () {
      const r = origHdr.call(this);
      lastRef = r;
      return r;
    };
    PDFContext.prototype.assign = function (ref, obj) {
      if (inside) fromObjStm.add(ref);
      return origAssign.call(this, ref, obj);
    };
    PDFObjectStreamParser.forStream = function (stream, tick) {
      const ref = lastRef;
      return {
        parseIntoContext: async () => {
          if (!onObjStm) return;
          const s2 = await onObjStm(stream, ref);
          inside = true;
          try { await origFor(s2, tick).parseIntoContext(); } finally { inside = false; }
        },
      };
    };
    try {
      const ctx = await PDFParser.forBytesWithOptions(bytes, Infinity, false, false).parseDocument();
      return { ctx, fromObjStm };
    } finally {
      PDFObjectStreamParser.forStream = origFor;
      PDFParser.prototype.parseIndirectObjectHeader = origHdr;
      PDFContext.prototype.assign = origAssign;
    }
  }

  async function mapStrings(obj, fn) {
    const { PDFString, PDFHexString, PDFDict, PDFArray, PDFName } = L();
    if (obj instanceof PDFString || obj instanceof PDFHexString) return L().PDFHexString.of(toHex(await fn(obj.asBytes())));
    if (obj instanceof PDFDict) {
      const isSig = obj.has(PDFName.of('ByteRange'));
      for (const [k, v] of obj.entries()) {
        if (isSig && k === PDFName.of('Contents')) continue;
        if (v instanceof PDFString || v instanceof PDFHexString || v instanceof PDFDict || v instanceof PDFArray) {
          const nv = await mapStrings(v, fn);
          if (nv !== v) obj.set(k, nv);
        }
      }
      return obj;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.get(i);
        if (v instanceof PDFString || v instanceof PDFHexString || v instanceof PDFDict || v instanceof PDFArray) {
          const nv = await mapStrings(v, fn);
          if (nv !== v) obj.set(i, nv);
        }
      }
      return obj;
    }
    return obj;
  }

  async function serialize(ctx) {
    return L().PDFWriter.forContext(ctx, 200).serializeToBuffer();
  }

  /** Cek cepat apakah PDF terenkripsi. */
  async function isEncrypted(bytes) {
    const { ctx } = await parseWith(bytes, null);
    return !!lookup(ctx, ctx.trailerInfo.Encrypt);
  }

  /**
   * Lepaskan enkripsi PDF. Mengembalikan { bytes, owner, wasEncrypted }.
   * Kata sandi kosong cukup untuk PDF yang hanya dikunci izin (tanpa kata sandi membuka).
   */
  async function decrypt(bytes, password = '') {
    const { PDFRawStream, PDFName, PDFString, PDFHexString, PDFDict, PDFArray } = L();
    const first = await parseWith(bytes, null);
    if (!lookup(first.ctx, first.ctx.trailerInfo.Encrypt)) return { bytes, owner: true, wasEncrypted: false };
    const D = await makeDecryptor(first.ctx, password);

    const { ctx, fromObjStm } = await parseWith(bytes, async (stream, ref) => {
      if (!ref) throw err('PARSE', 'Struktur PDF tidak dikenali');
      const dec = await D.stream(stream.contents, ref.objectNumber, ref.generationNumber);
      return PDFRawStream.of(stream.dict, dec);
    });
    const encObj = lookup(ctx, ctx.trailerInfo.Encrypt);
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (ref === ctx.trailerInfo.Encrypt || obj === encObj || fromObjStm.has(ref)) continue;
      const num = ref.objectNumber, gen = ref.generationNumber;
      const strFn = (b) => D.string(b, num, gen);
      if (obj instanceof PDFRawStream) {
        const type = obj.dict.lookup(PDFName.of('Type'));
        if (type === PDFName.of('XRef')) continue;
        await mapStrings(obj.dict, strFn);
        if (type === PDFName.of('Metadata') && !D.encMeta) continue;
        ctx.assign(ref, PDFRawStream.of(obj.dict, await D.stream(obj.contents, num, gen)));
      } else if (obj instanceof PDFString || obj instanceof PDFHexString) {
        ctx.assign(ref, await mapStrings(obj, strFn));
      } else if (obj instanceof PDFDict || obj instanceof PDFArray) {
        await mapStrings(obj, strFn);
      }
    }
    const encRef = ctx.trailerInfo.Encrypt;
    ctx.trailerInfo.Encrypt = undefined;
    if (encRef instanceof L().PDFRef) ctx.delete(encRef);
    return { bytes: await serialize(ctx), owner: D.owner, wasEncrypted: true };
  }

  /** Nilai /P dari daftar izin. */
  function permissionBits(p = {}) {
    let v = 0xfffff0c0 | 0;
    if (p.print !== false) v |= 4 | 2048;
    if (p.modify !== false) v |= 8 | 1024;
    if (p.copy !== false) v |= 16 | 512;
    if (p.annotate !== false) v |= 32 | 256;
    return v | 0;
  }

  /**
   * Kunci PDF dengan AES-256.
   * opts: { userPassword, ownerPassword, permissions: { print, modify, copy, annotate } }
   */
  async function encrypt(bytes, opts = {}) {
    const { PDFDocument, PDFParser, PDFRawStream, PDFName, PDFString, PDFHexString, PDFDict, PDFArray } = L();
    // Normalisasi: tulis ulang tanpa object stream agar setiap objek bisa dienkripsi satu per satu.
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const flat = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
    const ctx = await PDFParser.forBytesWithOptions(flat, Infinity, false, false).parseDocument();

    const upw = pwUtf8(opts.userPassword || '');
    const opw = pwUtf8(opts.ownerPassword || toHex(randomBytes(16)));
    const fileKey = randomBytes(32);
    const zero = new Uint8Array(16);
    const empty = new Uint8Array(0);

    const uvs = randomBytes(8), uks = randomBytes(8);
    const U = concat(await hash2B(upw, uvs, empty), uvs, uks);
    const UE = await aesEncrypt(await hash2B(upw, uks, empty), zero, fileKey, false);
    const ovs = randomBytes(8), oks = randomBytes(8);
    const O = concat(await hash2B(opw, ovs, U), ovs, oks);
    const OE = await aesEncrypt(await hash2B(opw, oks, U), zero, fileKey, false);
    const P = permissionBits(opts.permissions);
    const permsPlain = concat(int32le(P), new Uint8Array([255, 255, 255, 255, 0x54, 0x61, 0x64, 0x62]), randomBytes(4));
    const Perms = await aesEncrypt(fileKey, zero, permsPlain, false);

    const strFn = (b) => aesEncryptContent(fileKey, b);
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) {
        if (obj.dict.lookup(PDFName.of('Type')) === PDFName.of('XRef')) continue;
        await mapStrings(obj.dict, strFn);
        ctx.assign(ref, PDFRawStream.of(obj.dict, await aesEncryptContent(fileKey, obj.contents)));
      } else if (obj instanceof PDFString || obj instanceof PDFHexString) {
        ctx.assign(ref, await mapStrings(obj, strFn));
      } else if (obj instanceof PDFDict || obj instanceof PDFArray) {
        await mapStrings(obj, strFn);
      }
    }

    const H = (b) => PDFHexString.of(toHex(b));
    const encDict = ctx.obj({
      Filter: 'Standard', V: 5, R: 6, Length: 256,
      CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
      StmF: 'StdCF', StrF: 'StdCF',
      O: H(O), U: H(U), OE: H(OE), UE: H(UE), P, Perms: H(Perms),
      EncryptMetadata: true,
    });
    ctx.trailerInfo.Encrypt = ctx.register(encDict);
    const id = H(randomBytes(16));
    ctx.trailerInfo.ID = ctx.obj([id, id]);
    // Tandai ekstensi Adobe level 8 (AES-256) agar Acrobat lama memberi pesan yang jelas.
    const root = ctx.lookup(ctx.trailerInfo.Root);
    if (root instanceof PDFDict) root.set(PDFName.of('Extensions'), ctx.obj({ ADBE: { BaseVersion: PDFName.of('1.7'), ExtensionLevel: 8 } }));
    return serialize(ctx);
  }

  G.PDFCrypt = { encrypt, decrypt, isEncrypted, md5, rc4, _hash2B: hash2B };
})();
