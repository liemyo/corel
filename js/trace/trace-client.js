// Main-thread side of Amatu Trace: decoding, working resolution, auto-crop to the object, worker jobs, AI cut-out.
import { Tracer, toSVG, pathData, DEFAULTS } from './trace-engine.js';
export { toSVG, pathData, DEFAULTS };

// [key, label, long side in px]
export const PRECISION = [['std', 'Standar', 1100], ['high', 'Tinggi', 1600], ['max', 'Maksimal', 2200]];
export function defaultPrecision() {
  const low = (navigator.deviceMemory || 8) <= 4 || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  return low ? 'std' : 'high';
}
const loadImg = (url) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('Gambar tidak dapat dibaca')); im.src = url; });

// File / Blob / URL / <img> → { src (drawable), w, h, blob }
export async function decode(input) {
  if (input instanceof HTMLImageElement) {
    if (!input.complete) await new Promise(r => { input.onload = r; input.onerror = r; });
    return { src: input, w: input.naturalWidth || 1000, h: input.naturalHeight || 1000, blob: null };
  }
  let blob = input;
  if (typeof input === 'string') blob = await (await fetch(input)).blob();
  if (!(blob instanceof Blob)) throw new Error('Format gambar tidak didukung');
  if (!/svg/i.test(blob.type)) {
    try { const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' }); return { src: bm, w: bm.width, h: bm.height, blob }; } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  const im = await loadImg(url);
  return { src: im, w: im.naturalWidth || 1000, h: im.naturalHeight || 1000, blob, url };
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
// Drawable (optionally a normalised crop [x, y, w, h]) → ImageData whose long side is `longSide` (upscaling ≤ 3×).
export function toImageData(dec, longSide, crop = null) {
  const [cx, cy, cw, ch] = crop || [0, 0, 1, 1];
  const sx = cx * dec.w, sy = cy * dec.h, sw = Math.max(1, cw * dec.w), sh = Math.max(1, ch * dec.h);
  const s = Math.min(3, longSide / Math.max(sw, sh));
  const W = Math.max(16, Math.round(sw * s)), H = Math.max(16, Math.round(sh * s));
  const c = canvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  if (s < 0.5) {
    // progressive halving keeps thin lines (one-step reduction drops pixels)
    let cur = canvas(Math.round(sw), Math.round(sh));
    cur.getContext('2d').drawImage(dec.src, sx, sy, sw, sh, 0, 0, cur.width, cur.height);
    while (cur.width / 2 > W) {
      const t = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2)), tx = t.getContext('2d');
      tx.imageSmoothingQuality = 'high'; tx.drawImage(cur, 0, 0, t.width, t.height); cur = t;
    }
    x.drawImage(cur, 0, 0, W, H);
  } else x.drawImage(dec.src, sx, sy, sw, sh, 0, 0, W, H);
  return x.getImageData(0, 0, W, H);
}

// One worker per dialog. run() returns null for requests superseded by a newer one.
export class TraceJob {
  constructor() {
    this.id = 0; this.busy = false; this.pending = null; this.cur = null; this.local = null;
    try {
      this.w = new Worker(new URL('./trace-worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = (e) => this.onmsg(e.data);
      this.w.onerror = (e) => { e.preventDefault?.(); this.w?.terminate(); this.w = null; const j = this.cur; if (j) { this.busy = false; this.cur = null; this.pending ||= j; this.pump(); } };
    } catch { this.w = null; }
  }
  setImage(img) { this.img = img; this.key = 'k' + Date.now() + Math.random(); this.sent = false; this.local = null; }
  run(opts, onProgress) {
    return new Promise((resolve, reject) => {
      if (this.pending) this.pending.resolve(null);
      this.pending = { opts: { ...opts }, onProgress, resolve, reject };
      this.pump();
    });
  }
  pump() {
    if (this.busy || !this.pending || !this.img) return;
    const job = this.pending; this.pending = null; this.busy = true; this.cur = job;
    const id = ++this.id;
    if (this.w) {
      const msg = { type: 'trace', id, key: this.key, opts: job.opts };
      if (!this.sent) { msg.img = { width: this.img.width, height: this.img.height, data: this.img.data }; this.sent = true; }
      this.w.postMessage(msg);
    } else {
      setTimeout(() => {
        try { this.local ||= new Tracer(this.img); this.finish(job, this.local.run(job.opts, job.onProgress)); }
        catch (e) { this.finish(job, null, e); }
      }, 20);
    }
  }
  onmsg(m) {
    const job = this.cur;
    if (!job || m.id !== this.id) return;
    if (m.type === 'progress') { job.onProgress?.(m.stage, m.f); return; }
    if (m.type === 'error' && m.msg === 'no-image') { this.sent = false; this.busy = false; this.cur = null; this.pending ||= job; this.pump(); return; }
    this.finish(job, m.type === 'result' ? m.res : null, m.type === 'error' ? new Error(m.msg) : null);
  }
  finish(job, res, err) {
    this.busy = false; this.cur = null;
    if (err) job.reject(err); else job.resolve(this.pending ? null : res);
    this.pump();
  }
  dispose() { this.pending?.resolve(null); this.pending = null; this.w?.terminate(); this.w = null; this.local = null; }
}

// Source image + working image + automatic crop around the detected object (more pixels on the object = finer lines).
// Results carry `crop` = [x, y, w, h] normalised to the source image.
export class TraceSession {
  constructor() { this.job = new TraceJob(); this.dec = null; }
  async load(input) {
    const dec = await decode(input);
    if (this.dec?.url) URL.revokeObjectURL(this.dec.url);
    this.dec = dec; this.workKey = null; this.crop = null; this.cropKey = null;
    return dec;
  }
  get loaded() { return !!this.dec; }
  setWork(side, crop) {
    const key = side + '|' + (crop ? crop.join(',') : 'full');
    if (key === this.workKey) return;
    this.workKey = key;
    this.job.setImage(toImageData(this.dec, side, crop));
  }
  async run(opts, prec, onProgress) {
    if (!this.dec) return null;
    const side = (PRECISION.find(p => p[0] === prec) || PRECISION[1])[2];
    const ck = [side, opts.mode, opts.bg, opts.shadows, opts.focus !== false, Math.round(opts.detail / 20)].join('|');
    if (ck !== this.cropKey) { this.cropKey = ck; this.crop = null; this.cropDone = false; this.hint = null; }
    this.setWork(side, this.crop);
    let r = await this.job.run(this.crop && this.hint ? { ...opts, bgHint: this.hint } : opts, onProgress);
    if (!r) return null;
    if (!this.cropDone) {
      this.cropDone = true;
      const c = opts.focus !== false && !this.crop ? this.cropFor(r, side) : null;
      if (c) {
        this.crop = c; this.hint = r.bgInfo || null; this.setWork(side, c);
        r = await this.job.run(this.hint ? { ...opts, bgHint: this.hint } : opts, onProgress);
        if (!r) { this.cropDone = false; return null; }
      }
    }
    r.crop = this.crop || [0, 0, 1, 1];
    r.src = { w: this.dec.w, h: this.dec.h };
    return trim(r);
  }
  cropFor(r, side) {
    if (!r.box) return null;
    const [x0, y0, x1, y1] = r.box, m = 0.05 * Math.max(x1 - x0, y1 - y0) + 4;
    const cx0 = Math.max(0, x0 - m), cy0 = Math.max(0, y0 - m), cx1 = Math.min(r.w, x1 + m), cy1 = Math.min(r.h, y1 + m);
    const crop = [cx0 / r.w, cy0 / r.h, (cx1 - cx0) / r.w, (cy1 - cy0) / r.h];
    const srcLong = Math.max(this.dec.w, this.dec.h), cropLong = Math.max(crop[2] * this.dec.w, crop[3] * this.dec.h);
    const gain = Math.min(3, side / cropLong) / Math.min(3, side / srcLong);
    return gain >= 1.3 ? crop.map(v => Math.round(v * 1e5) / 1e5) : null;
  }
  dispose() { this.job.dispose(); if (this.dec?.url) URL.revokeObjectURL(this.dec.url); this.dec = null; }
}

// Shrinks the result to the bounding box of what was drawn (+ margin) and updates crop accordingly.
export function trim(r) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const scan = (seg) => { for (let i = 0; i < seg.length; i += 2) { const x = seg[i], y = seg[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } };
  for (const l of r.lines) scan(l.seg);
  for (const f of r.fills) for (const sb of f.subs) scan(sb.seg);
  if (!(x1 > x0 && y1 > y0)) return r;
  const m = Math.max(6, 0.02 * Math.max(x1 - x0, y1 - y0));
  x0 = Math.max(0, Math.floor(x0 - m)); y0 = Math.max(0, Math.floor(y0 - m)); x1 = Math.min(r.w, Math.ceil(x1 + m)); y1 = Math.min(r.h, Math.ceil(y1 + m));
  const nw = x1 - x0, nh = y1 - y0;
  if (nw * nh > r.w * r.h * 0.9) return r;
  const shift = (seg) => { for (let i = 0; i < seg.length; i += 2) { seg[i] -= x0; seg[i + 1] -= y0; } };
  for (const l of r.lines) shift(l.seg);
  for (const f of r.fills) for (const sb of f.subs) shift(sb.seg);
  const [cx, cy, cw, ch] = r.crop;
  r.crop = [cx + cw * x0 / r.w, cy + ch * y0 / r.h, cw * nw / r.w, ch * nh / r.h];
  if (r.box) r.box = [r.box[0] - x0, r.box[1] - y0, r.box[2] - x0, r.box[3] - y0];
  r.w = nw; r.h = nh;
  return r;
}

// Optional AI object cut-out (runs in the browser; model downloaded once and cached).
const IMGLY = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm';
let imgly;
export async function aiCutout(blob, onProgress) {
  imgly ||= import(IMGLY);
  const m = await imgly, fn = m.removeBackground || m.default;
  return fn(blob, { model: 'isnet_quint8', output: { format: 'image/png' }, progress: (k, c, t) => onProgress?.(k, t ? c / t : 0) });
}
