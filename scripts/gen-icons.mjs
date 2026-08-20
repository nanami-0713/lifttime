// 生成 PWA 图标：纯 Node 实现 PNG 编码（zlib 内置），几何图形绘制 + 超采样抗锯齿
// 用法：node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');
mkdirSync(OUT, { recursive: true });

/* ---------- PNG 编码 ---------- */
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 几何 ---------- */
function sdRoundRect(px, py, cx, cy, w, h, r) {
  const qx = Math.abs(px - cx) - w / 2 + r;
  const qy = Math.abs(py - cy) - h / 2 + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
function sdRing(px, py, cx, cy, r, t) {
  return Math.abs(Math.hypot(px - cx, py - cy) - r) - t / 2;
}
const GAP_LO = (-120 * Math.PI) / 180, GAP_HI = (-60 * Math.PI) / 180;
function inGap(px, py, cx, cy) {
  const a = Math.atan2(py - cy, px - cx);
  return a > GAP_LO && a < GAP_HI;
}

/** 渲染单点（单位坐标 0..1）→ [r,g,b,a] */
function shade(x, y, opts) {
  const full = opts.fullBleed;
  let r = 0, g = 0, b = 0, a = 0;
  // 背景圆角矩形（渐变）
  const dBg = full ? -1 : sdRoundRect(x, y, 0.5, 0.5, 1.0, 1.0, 0.225);
  if (dBg < 0.001 || full) {
    const t = y; // 垂直渐变
    r = Math.round(225 + (0 - 225) * t + (109 - 225) * 0); // #e11d48 → #6d28d9
    r = Math.round((1 - t) * 225 + t * 109);
    g = Math.round((1 - t) * 29 + t * 40);
    b = Math.round((1 - t) * 72 + t * 217);
    a = 1;
    // 白色表冠（表盘顶部的按钮）
    const crown = sdRoundRect(x, y, 0.5, 0.135 * opts.s + 0.0, 0.10, 0.05, 0.025);
    if (crown < 0) { r = g = b = 255; }
    // 白色圆环（秒表盘，顶部留缺口）
    if (!inGap(x, y, 0.5, 0.44) && sdRing(x, y, 0.5, 0.44, 0.255, 0.052) < 0) { r = g = b = 255; }
    // 三根柱状条（时间分布）
    const bw = 0.072, gap = 0.044, hts = [0.13, 0.235, 0.175];
    const total = 3 * bw + 2 * gap;
    const x0 = 0.5 - total / 2;
    for (let i = 0; i < 3; i++) {
      const bx = x0 + i * (bw + gap) + bw / 2;
      const top = 0.735 - hts[i];
      if (sdRoundRect(x, y, bx, top + hts[i] / 2, bw, hts[i], bw / 2.6) < 0) { r = g = b = 255; }
    }
  }
  return [r, g, b, a];
}

function render(size, opts) {
  const SS = 3; // 超采样
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          // maskable：内容缩到中心 78% 安全区
          const [xx, yy] = opts.maskable
            ? [(x - 0.5) / 0.78 + 0.5, (y - 0.5) / 0.78 + 0.5]
            : [x, y];
          const c = shade(xx, yy, { fullBleed: opts.fullBleed || opts.maskable, s: 1 });
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      buf[i] = Math.round(r / n); buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n); buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, size, buf);
}

const jobs = [
  ['icon-192.png', 192, { fullBleed: false }],
  ['icon-512.png', 512, { fullBleed: false }],
  ['maskable-192.png', 192, { maskable: true }],
  ['maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];
for (const [name, size, opts] of jobs) {
  const out = render(size, opts);
  writeFileSync(join(OUT, name), out);
  console.log('✓ icons/' + name + ' (' + out.length + ' bytes)');
}
console.log('done');
