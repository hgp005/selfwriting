/* ==========================================================================
   selfwriting · parsers.js
   本地书籍解析：TXT（含 GBK/UTF-16 编码识别）、EPUB、MOBI/AZW3、PDF
   全部在本机完成，零依赖、不联网。

   依赖 zlib 的替代实现：自己写的 DEFLATE 解压（浏览器没有 zlib）
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const P = {};

  /* ================================================================== */
  /* 1. 编码识别（中文 TXT 大多是 GBK，用 UTF-8 硬读会空白/乱码）          */
  /* ================================================================== */

  /** 判断这段字节是否像合法的 UTF-8 */
  function looksLikeUtf8(bytes) {
    let i = 0;
    const n = bytes.length;
    let multibyte = 0;
    while (i < n) {
      const b = bytes[i];
      if (b < 0x80) { i++; continue; }
      let need;
      if ((b & 0xe0) === 0xc0) need = 1;
      else if ((b & 0xf0) === 0xe0) need = 2;
      else if ((b & 0xf8) === 0xf0) need = 3;
      else return false;                       // 0x80-0xBF 不能作为首字节
      if (i + need >= n) return false;
      for (let k = 1; k <= need; k++) {
        if ((bytes[i + k] & 0xc0) !== 0x80) return false;
      }
      multibyte++;
      i += need + 1;
    }
    return multibyte > 0 ? true : true;
  }

  /** 明显的乱码特征（GBK 被当成 UTF-8 或反之都会出现这些） */
  function looksLikeMojibake(text) {
    if (!text) return false;
    const sample = text.slice(0, 4000);
    const bad = (sample.match(/[\uFFFD]/g) || []).length;
    if (bad > 2) return true;
    // 常见「锟斤拷 / 烫烫烫」类替换字符
    if (/锟斤拷|锘匡拷|烫烫烫|屯屯屯/.test(sample)) return true;
    return false;
  }

  /**
   * 把字节解码成文本：优先 UTF-8，判定失败或乱码则退回 GBK/GB18030，
   * 再不行试 Big5。TextDecoder 是浏览器内置能力（安卓 WebView 也支持）。
   */
  /**
   * 判断字节用了什么编码（给「导入后空白」这类问题提供可见依据）。
   * 返回人类可读的名字：UTF-8 / UTF-8(BOM) / UTF-16LE / UTF-16BE / GBK / Big5
   */
  P.detectEncoding = function (buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!bytes.length) return '空文件';
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'UTF-8（含 BOM）';
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return 'UTF-16LE';
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return 'UTF-16BE';
    if (looksLikeUtf8(bytes)) {
      const t = new TextDecoder('utf-8').decode(bytes);
      if (!looksLikeMojibake(t)) return 'UTF-8';
    }
    const gb = new TextDecoder('gb18030').decode(bytes);
    if (!looksLikeMojibake(gb)) return 'GBK / GB18030';
    const b5 = new TextDecoder('big5').decode(bytes);
    if (!looksLikeMojibake(b5)) return 'Big5（繁体）';
    return '未知编码';
  };

  P.decodeBytes = function (buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!bytes.length) return '';

    // BOM
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }

    const tryDecode = (label) => {
      try { return new TextDecoder(label, { fatal: false }).decode(bytes); } catch (e) { return null; }
    };

    let text = null;
    if (looksLikeUtf8(bytes)) {
      text = tryDecode('utf-8');
      if (text && !looksLikeMojibake(text)) return text;
    }
    // 中文小说常见：GBK / GB18030
    const gb = tryDecode('gb18030') || tryDecode('gbk');
    if (gb && !looksLikeMojibake(gb)) return gb;
    // 繁体：Big5
    const big5 = tryDecode('big5');
    if (big5 && !looksLikeMojibake(big5)) return big5;
    // 都不理想时给出可读性最好的那个
    return text || gb || big5 || '';
  };

  /* ================================================================== */
  /* 2. DEFLATE 解压（EPUB / MOBI / PDF 的流都是 zlib 或 raw deflate）      */
  /* ================================================================== */
  function bitReader(bytes, start, end) {
    let pos = start << 3;                 // 比特位置（注意：不是字节位置）
    const endBit = end << 3;              // 边界也要换算成比特，否则会误判越界
    return {
      /**
       * 读 n 个比特。DEFLATE 规定「低比特优先」（LSB-first）：
       * 先读到的比特是结果的低位，所以这里按位逐个累加，
       * 而不是把整字节按 MSB 顺序切片——霍夫曼码与长度/距离附加值都依赖这个顺序。
       */
      read(n) {
        let v = 0;
        for (let i = 0; i < n; i++) {
          if (pos >= endBit) throw new Error('deflate 数据提前结束');
          const bit = (bytes[(pos >> 3)] >> (pos & 7)) & 1;
          v |= bit << i;
          pos++;
        }
        return v >>> 0;
      },
      align() { pos = (pos + 7) & ~7; },
      seek(bytePos) { pos = bytePos << 3; },
      get bitsLeft() { return endBit - pos; },
      get bytePos() { return pos >> 3; }
    };
  }

  function buildHuffman(lengths) {
    const maxBits = Math.max.apply(null, lengths);
    const blCount = new Array(maxBits + 1).fill(0);
    lengths.forEach((l) => { if (l > 0) blCount[l]++; });
    const nextCode = new Array(maxBits + 1).fill(0);
    let code = 0;
    for (let bits = 1; bits <= maxBits; bits++) {
      code = (code + (blCount[bits - 1] || 0)) << 1;
      nextCode[bits] = code;
    }
    const map = Object.create(null);
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (!len) continue;
      const canon = nextCode[len]++;
      /* 规范编码按 MSB 书写，但流里是 LSB-first 打包的：
         存表时就按 len 位反转，解码时才能与读到的比特直接比较。 */
      let rev = 0;
      for (let i = 0; i < len; i++) rev |= ((canon >> i) & 1) << (len - 1 - i);
      map[len + ':' + rev] = sym;
    }
    return { map: map, maxBits: maxBits };
  }

  function decodeSymbol(br, huff) {
    let code = 0;
    for (let len = 1; len <= huff.maxBits; len++) {
      code |= br.read(1) << (len - 1);     // 与 read() 一致：低比特优先
      const sym = huff.map[len + ':' + code];
      if (sym !== undefined) return sym;
    }
    throw new Error('非法的 Huffman 编码');
  }

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  function inflateRaw(bytes, start, end) {
    const out = [];
    const stop = end === undefined ? bytes.length : end;
    let fixedLen = null, fixedDist = null;
    // 一个 bitReader 贯穿所有块，避免换块时丢失比特位置（此前这里踩过坑）
    const br = bitReader(bytes, start, stop);

    for (;;) {
      const final = br.read(1);
      const type = br.read(2);
      if (type === 0) {
        br.align();
        const pos = br.bytePos;
        if (pos + 4 > stop) throw new Error('deflate 存储块越界');
        const len = bytes[pos] | (bytes[pos + 1] << 8);
        const nlen = bytes[pos + 2] | (bytes[pos + 3] << 8);
        if ((len ^ 0xffff) !== nlen) throw new Error('deflate 存储块长度校验失败');
        if (pos + 4 + len > stop) throw new Error('deflate 存储块数据不完整');
        for (let i = 0; i < len; i++) out.push(bytes[pos + 4 + i]);
        br.seek(pos + 4 + len);
      } else if (type === 1 || type === 2) {
        let litHuff, distHuff;
        if (type === 1) {
          if (!fixedLen) {
            const litLens = new Array(288);
            for (let i = 0; i < 144; i++) litLens[i] = 8;
            for (let i = 144; i < 256; i++) litLens[i] = 9;
            for (let i = 256; i < 280; i++) litLens[i] = 7;
            for (let i = 280; i < 288; i++) litLens[i] = 8;
            fixedLen = buildHuffman(litLens);
            fixedDist = buildHuffman(new Array(30).fill(5));
          }
          litHuff = fixedLen; distHuff = fixedDist;
        } else {
          const hlit = br.read(5) + 257;
          const hdist = br.read(5) + 1;
          const hclen = br.read(4) + 4;
          const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
          const clens = new Array(19).fill(0);
          for (let i = 0; i < hclen; i++) clens[order[i]] = br.read(3);
          const clHuff = buildHuffman(clens);
          const lens = [];
          while (lens.length < hlit + hdist) {
            const sym = decodeSymbol(br, clHuff);
            if (sym < 16) lens.push(sym);
            else if (sym === 16) {
              const prev = lens[lens.length - 1];
              const rep = 3 + br.read(2);
              for (let i = 0; i < rep; i++) lens.push(prev);
            } else if (sym === 17) {
              const rep = 3 + br.read(3);
              for (let i = 0; i < rep; i++) lens.push(0);
            } else {
              const rep = 11 + br.read(7);
              for (let i = 0; i < rep; i++) lens.push(0);
            }
          }
          litHuff = buildHuffman(lens.slice(0, hlit));
          distHuff = buildHuffman(lens.slice(hlit));
        }
        for (;;) {
          const sym = decodeSymbol(br, litHuff);
          if (sym < 256) { out.push(sym); continue; }
          if (sym === 256) break;
          const li = sym - 257;
          if (li >= LEN_BASE.length) throw new Error('非法的长度码');
          const length = LEN_BASE[li] + br.read(LEN_EXTRA[li]);
          const dsym = decodeSymbol(br, distHuff);
          if (dsym >= DIST_BASE.length) throw new Error('非法的距离码');
          const dist = DIST_BASE[dsym] + br.read(DIST_EXTRA[dsym]);
          const startIdx = out.length - dist;
          if (startIdx < 0) throw new Error('距离越界');
          for (let i = 0; i < length; i++) out.push(out[startIdx + i]);
        }
      } else {
        throw new Error('非法的 deflate 块类型');
      }
      if (final) break;
    }
    return Uint8Array.from(out);
  }

  /** 裸 deflate（ZIP 条目用这个） */
  P.inflateRaw = inflateRaw;

  /**
   * 解压自动判别：
   *   ZIP 条目是「裸 deflate」，PDF 的 FlateDecode 流是「zlib 包装」，
   *   两者首字节都可能恰好是 0x78，所以先按 zlib 试，失败再按裸 deflate 试。
   */
  P.inflate = function (bytes, start, end) {
    const s = start || 0;
    const e = end === undefined ? bytes.length : end;
    const zlibLike = (e - s > 2) && bytes[s] === 0x78 && (((bytes[s] << 8) | bytes[s + 1]) % 31 === 0);
    if (zlibLike) {
      try { return inflateRaw(bytes, s + 2, e); } catch (err) { /* 再试裸 deflate */ }
    }
    try {
      return inflateRaw(bytes, s, e);
    } catch (err2) {
      if (!zlibLike) throw err2;
      return inflateRaw(bytes, s + 2, e);
    }
  };

  /* ================================================================== */
  /* 3. ZIP 读取（EPUB 就是 zip；只读中央目录，逐个解压）                  */
  /* ================================================================== */
  P.readZip = function (bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const SIG_EOCD = 0x06054b50;
    const SIG_CENTRAL = 0x02014b50;
    const SIG_LOCAL = 0x04034b50;

    // 从尾部找 EOCD（可能带注释，最多回退 64KB）
    let eocd = -1;
    const minPos = Math.max(0, bytes.length - 66000);
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip/epub 文件');

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
      if (dv.getUint32(p, true) !== SIG_CENTRAL) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name: name, method: method, compSize: compSize, localOff: localOff });
      p += 46 + nameLen + extraLen + commentLen;
    }

    const byName = Object.create(null);
    entries.forEach((en) => { byName[en.name] = en; });

    function read(entry) {
      if (!entry) return null;
      if (dv.getUint32(entry.localOff, true) !== SIG_LOCAL) return null;
      const nameLen = dv.getUint16(entry.localOff + 26, true);
      const extraLen = dv.getUint16(entry.localOff + 28, true);
      const start = entry.localOff + 30 + nameLen + extraLen;
      const raw = bytes.subarray(start, start + entry.compSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return P.inflate(raw);
      return null;                                  // 不支持其它压缩方式
    }

    return {
      names: entries.map((e) => e.name),
      entries: entries,
      has: (n) => !!byName[n],
      get: (n) => read(byName[n])
    };
  };

  /* ================================================================== */
  /* 4. HTML / XHTML → 纯文本                                            */
  /* ================================================================== */
  const ENTITIES = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ldquo: '“', rdquo: '”',
    lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–', middot: '·',
    copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷', bull: '•'
  };

  P.htmlToText = function (html) {
    let s = String(html || '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
    // 段落类标签换成换行
    s = s.replace(/<\s*(br|hr)\s*\/?>/gi, '\n');
    s = s.replace(/<\/\s*(p|div|section|article|h[1-6]|li|tr|blockquote|figcaption)\s*>/gi, '\n\n');
    s = s.replace(/<\s*li[^>]*>/gi, '· ');
    s = s.replace(/<[^>]+>/g, '');
    // 实体
    s = s.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)));
    s = s.replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)));
    s = s.replace(/&([a-zA-Z]+);/g, (m, name) => (ENTITIES[name] !== undefined ? ENTITIES[name] : m));
    s = s.replace(/\u00a0/g, ' ');
    s = s.replace(/[ \t]+\n/g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
  };

  /* ================================================================== */
  /* 5. EPUB                                                            */
  /* ================================================================== */
  P.parseEpub = function (bytes) {
    const zip = P.readZip(bytes);
    const dec = (b) => (b ? P.decodeBytes(b) : '');

    // 1) 找 OPF：优先 container.xml
    let opfPath = null;
    const container = zip.get('META-INF/container.xml');
    if (container) {
      const xml = dec(container);
      const m = /full-path\s*=\s*"([^"]+)"/i.exec(xml);
      if (m) opfPath = m[1];
    }
    if (!opfPath || !zip.has(opfPath)) {
      opfPath = zip.names.find((n) => /\.opf$/i.test(n)) || null;
    }
    if (!opfPath) throw new Error('这个 EPUB 里找不到内容清单（opf）');

    const opf = dec(zip.get(opfPath));
    const baseDir = opfPath.indexOf('/') >= 0 ? opfPath.replace(/[^/]*$/, '') : '';

    // 2) 元数据
    const pick = (tag) => {
      const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(opf);
      return m ? P.htmlToText(m[1]).trim() : '';
    };
    const title = pick('dc:title') || '未命名读物';
    const author = pick('dc:creator') || '';
    const lang = pick('dc:language') || '';

    // 3) manifest：id -> href
    const manifest = Object.create(null);
    const itemRe = /<item\b[^>]*>/gi;
    let m2;
    while ((m2 = itemRe.exec(opf))) {
      const tag = m2[0];
      const id = /id\s*=\s*"([^"]+)"/i.exec(tag);
      const href = /href\s*=\s*"([^"]+)"/i.exec(tag);
      const media = /media-type\s*=\s*"([^"]+)"/i.exec(tag);
      if (id && href) manifest[id[1]] = { href: href[1], media: media ? media[1] : '' };
    }

    // 4) spine：阅读顺序
    const order = [];
    const refRe = /<itemref\b[^>]*>/gi;
    while ((m2 = refRe.exec(opf))) {
      const idref = /idref\s*=\s*"([^"]+)"/i.exec(m2[0]);
      if (idref && manifest[idref[1]]) order.push(manifest[idref[1]]);
    }
    // 没有 spine 就退回 manifest 里的文档项
    const docs = order.length ? order : Object.keys(manifest).map((k) => manifest[k])
      .filter((it) => /xhtml|html|htm/i.test(it.media) || /\.x?html?$/i.test(it.href));

    // 5) 逐章抽取文本
    const chapters = [];
    docs.forEach((item, i) => {
      let path = item.href;
      if (baseDir && path.indexOf('/') !== 0) path = baseDir + path;
      path = path.replace(/^\.\//, '');
      let raw = zip.get(decodeURIComponent(path)) || zip.get(path);
      if (!raw) {
        // 有些书 href 与 zip 路径大小写/编码不一致，模糊匹配
        const hit = zip.names.find((n) => n.toLowerCase() === path.toLowerCase())
          || zip.names.find((n) => n.toLowerCase().endsWith(path.split('/').pop().toLowerCase()));
        if (hit) raw = zip.get(hit);
      }
      if (!raw) return;
      const html = P.decodeBytes(raw);
      const text = P.htmlToText(html);
      if (!text) return;
      let title2 = '';
      const h = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
      if (h) title2 = P.htmlToText(h[1]).trim().slice(0, 60);
      if (!title2) {
        const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        if (t) title2 = P.htmlToText(t[1]).trim().slice(0, 60);
      }
      chapters.push({ title: title2 || ('第 ' + (chapters.length + 1) + ' 节'), content: text });
    });

    if (!chapters.length) throw new Error('这个 EPUB 里没有可提取的文字（可能是纯图片漫画）');
    return { title: title, author: author, lang: lang, chapters: chapters };
  };

  /* ================================================================== */
  /* 6. MOBI / AZW / AZW3                                               */
  /* ================================================================== */
  function palmdocDecompress(bytes, start, end) {
    const out = [];
    let i = start;
    while (i < end) {
      const b = bytes[i++];
      if (b === 0) { out.push(0); continue; }
      if (b <= 8) { for (let k = 0; k < b; k++) out.push(bytes[i++]); continue; }
      if (b <= 0x7f) { out.push(b); continue; }
      if (b <= 0xbf) {
        if (i >= end) break;
        const pair = ((b << 8) | bytes[i++]) & 0x3fff;
        const dist = pair >> 3;
        const len = (pair & 7) + 3;
        if (dist === 0 || out.length < dist) break;
        const from = out.length - dist;
        for (let k = 0; k < len; k++) out.push(out[from + k]);
        continue;
      }
      out.push(32); out.push(b ^ 0x80);
    }
    return Uint8Array.from(out);
  }

  P.parseMobi = function (bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = new TextDecoder('latin1').decode(bytes.subarray(60, 68));
    if (!/BOOKMOBI/i.test(type)) throw new Error('这不是 MOBI/AZW 文件');

    const recCount = dv.getUint16(76, true);
    const recs = [];
    for (let i = 0; i < recCount; i++) {
      const off = 78 + i * 8;                 // 每项 8 字节：偏移 4 + 属性 1 + 填充 3
      if (off + 4 > bytes.length) break;
      recs.push({ off: dv.getUint32(off, true), attr: bytes[off + 4] });
    }
    // 头字段可能被写坏（见过把记录数写成大端、读出 512 条的样本）：
    // 偏移必须单调递增且落在文件内，否则退回「整文件当一条记录」的安全假设。
    const sane = recs.length > 0 && recs.every((r, i) => r.off >= 78 && r.off <= bytes.length
      && (i === 0 || r.off >= recs[i - 1].off));
    if (!sane) {
      throw new Error('这本 MOBI 的记录表异常，无法定位正文（文件可能损坏或不是标准 MOBI）');
    }
    recs.push({ off: bytes.length, attr: 0 });

    // 记录 0 = PalmDOC + MOBI 头
    const rec0 = bytes.subarray(recs[0].off, recs[1].off);
    const dv0 = new DataView(rec0.buffer, rec0.byteOffset, rec0.byteLength);
    const compression = dv0.getUint16(0, false);
    const textLength = dv0.getUint32(4, false);
    const textRecordCount = dv0.getUint16(8, false);
    const encoding = dv0.getUint16(28, false);          // 1252 或 65001
    /* MOBI 头固定从记录 0 的偏移 16 开始（MOBI 魔数所在处）。
       规范里没有「mobiOff 字段」，此前误读文件内容当偏移，导致标题/元数据全错。 */
    const mobiOff = 16;

    if (compression === 17480) {
      throw new Error('这本 MOBI 使用了 HUFF/CDIC 压缩，暂不支持（建议在电脑上转成 EPUB 或 TXT 再导入）');
    }
    if (compression !== 1 && compression !== 2) {
      throw new Error('不支持的 MOBI 压缩方式（' + compression + '）');
    }

    // 标题：MOBI 头里的全名通常是记录 0 的末尾 UTF-8
    let title = '';
    try {
      // 要读的是 MOBI 头里 68/72 两个字段，先确认这 80 字节确实落在记录 0 内
      if (rec0.length >= mobiOff + 80) {
        const fullNameOff = dv0.getUint32(mobiOff + 68, false);
        const fullNameLen = dv0.getUint32(mobiOff + 72, false);
        if (fullNameLen > 0 && fullNameLen < 1024 && fullNameOff + fullNameLen <= rec0.length) {
          title = P.decodeBytes(rec0.subarray(fullNameOff, fullNameOff + fullNameLen)).replace(/\0/g, '').trim();
        }
      }
    } catch (e) { /* 标题读不到不影响正文 */ }

    // 文本 = 记录 1..textRecordCount
    const parts = [];
    for (let i = 1; i <= textRecordCount && i < recs.length - 1; i++) {
      const s = recs[i].off, e = recs[i + 1].off;
      if (e <= s) continue;
      if (compression === 2) parts.push(palmdocDecompress(bytes, s, e));
      else parts.push(bytes.subarray(s, e));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const merged = new Uint8Array(Math.min(total, textLength || total));
    let o = 0;
    for (let i = 0; i < parts.length && o < merged.length; i++) {
      const take = Math.min(parts[i].length, merged.length - o);
      merged.set(parts[i].subarray(0, take), o);
      o += take;
    }

    const rawHtml = P.decodeBytes(merged);
    const text = P.htmlToText(rawHtml);
    if (!text) throw new Error('这本 MOBI 没有提取到文字（可能是 DRM 加密或纯图片）');

    // MOBI 的 HTML 里一般有 <mbp:pagebreak>，用它分节。
    // 注意必须在 htmlToText 之前切——标签在转纯文本时已经被删掉了。
    const rawParts = String(rawHtml).split(/<mbp:pagebreak[^>]*>/i);
    let chapters = [];
    if (rawParts.length > 1) {
      rawParts.forEach((p) => {
        const t = P.htmlToText(p);
        if (t) chapters.push({ title: '第 ' + (chapters.length + 1) + ' 节', content: t });
      });
    }
    if (!chapters.length) {
      chapters = U.splitChapters(text, 'auto').map((c) => ({ title: c.title, content: c.content }));
    }
    return { title: title || '未命名读物', author: '', chapters: chapters };
  };

  /* ================================================================== */
  /* 7. PDF（抽取文本层；扫描件会明确告知）                                */
  /* ================================================================== */
  P.parsePdf = function (bytes) {
    const latin = new TextDecoder('latin1').decode(bytes);
    if (latin.slice(0, 1024).indexOf('%PDF') < 0) throw new Error('这不是 PDF 文件');

    // 找出所有 stream ... endstream，尝试解压并抽取文本
    const texts = [];
    let from = 0;
    let decodedStreams = 0;
    while (from < bytes.length) {
      const sIdx = latin.indexOf('stream', from);
      if (sIdx < 0) break;
      let dataStart = sIdx + 6;
      if (latin[dataStart] === '\r') dataStart++;
      if (latin[dataStart] === '\n') dataStart++;
      const eIdx = latin.indexOf('endstream', dataStart);
      if (eIdx < 0) break;
      from = eIdx + 9;

      let chunk = bytes.subarray(dataStart, eIdx);
      if (!chunk.length) continue;
      let content = null;
      // 先试解压（FlateDecode），失败就当作明文内容流
      if (chunk[0] === 0x78) {
        try { content = P.inflate(chunk); decodedStreams++; } catch (e) { content = null; }
      }
      if (!content) {
        const asText = latin.slice(dataStart, eIdx);
        if (/\bBT\b/.test(asText) && /\bTj\b|\bTJ\b/.test(asText)) content = chunk;
      }
      if (!content) continue;

      const s = new TextDecoder('latin1').decode(content);
      if (s.indexOf('BT') < 0) continue;
      // 只在 BT...ET 文本块里取字符串
      const blockRe = /BT([\s\S]*?)ET/g;
      let bm;
      while ((bm = blockRe.exec(s))) {
        const body = bm[1];
        const strRe = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g;
        let sm;
        while ((sm = strRe.exec(body))) {
          const tok = sm[0];
          if (tok[0] === '(') texts.push(unescapePdfString(tok.slice(1, -1)));
          else texts.push(hexToString(tok.slice(1, -1)));
        }
        texts.push('\n');
      }
    }

    let text = texts.join('')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length < 20) {
      throw new Error('这个 PDF 里没有可提取的文字（多为扫描图片版）。'
        + '请先用电脑上的 OCR 工具或阅读软件转成 TXT / EPUB 再导入。');
    }
    const chapters = U.splitChapters(text, 'auto').map((c) => ({ title: c.title, content: c.content }));
    return { title: '未命名读物', author: '', chapters: chapters, scanned: false };
  };

  function unescapePdfString(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== '\\') { out += c; continue; }
      const n = s[++i];
      if (n === 'n') out += '\n';
      else if (n === 'r') out += '\r';
      else if (n === 't') out += '\t';
      else if (n === 'b') out += '\b';
      else if (n === 'f') out += '\f';
      else if (n === '(' || n === ')' || n === '\\') out += n;
      else if (n >= '0' && n <= '7') {
        let oct = n;
        while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
        out += String.fromCharCode(parseInt(oct, 8));
      } else out += n;
    }
    return out;
  }

  function hexToString(hex) {
    const clean = hex.replace(/\s+/g, '');
    let out = '';
    for (let i = 0; i + 1 < clean.length; i += 2) {
      out += String.fromCharCode(parseInt(clean.substr(i, 2), 16));
    }
    return out;
  }

  /* ================================================================== */
  /* 8. 统一入口                                                        */
  /* ================================================================== */
  P.extKind = function (name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  };

  P.BINARY_EXT = ['epub', 'mobi', 'azw', 'azw3', 'prc', 'pdf'];
  P.isBinary = function (name) { return P.BINARY_EXT.indexOf(P.extKind(name)) >= 0; };

  /** 解析成 { title, author, chapters:[{title,content}], note } */
  P.parseFile = function (file, buffer) {
    const ext = P.extKind(file.name);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (ext === 'epub') {
      const book = P.parseEpub(bytes);
      return Object.assign(book, { note: 'EPUB：' + book.chapters.length + ' 节' });
    }
    if (ext === 'mobi' || ext === 'azw' || ext === 'azw3' || ext === 'prc') {
      const book = P.parseMobi(bytes);
      return Object.assign(book, { note: 'MOBI：' + book.chapters.length + ' 节' });
    }
    if (ext === 'pdf') {
      const book = P.parsePdf(bytes);
      return Object.assign(book, { note: 'PDF：提取到 ' + book.chapters.length + ' 节文本' });
    }
    // 纯文本：编码识别后按章节标题切分
    const text = P.decodeBytes(bytes);
    if (!text.trim()) throw new Error('文件里没有可读文字（可能是二进制文件或空文件）');
    const chapters = U.splitChapters(text, 'auto').map((c) => ({ title: c.title, content: c.content }));
    return { title: String(file.name || '').replace(/\.[^.]+$/, ''), author: '', chapters: chapters, note: 'TXT：' + chapters.length + ' 节' };
  };

  /** 支持的扩展名（给文件选择器用） */
  P.ACCEPT = '.txt,.text,.md,.markdown,.epub,.mobi,.azw,.azw3,.prc,.pdf,.html,.htm,.json,text/plain,text/markdown,application/epub+zip,application/pdf';

  global.Parsers = P;
})(window);
