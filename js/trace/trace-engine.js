// Amatu Trace — gambar → garis vektor halus & presisi (+ isian warna opsional).
// Pure JS without DOM: runs in a module Worker (trace-worker.js) or on the main thread.
//
// Photo / object pipeline:
//   sRGB → CIELab · edge-aware smoothing (domain transform) · colour structure-tensor gradient ·
//   sub-pixel non-maximum suppression · adaptive hysteresis · thinning · chain linking + gap closing ·
//   corner-aware smoothing · least-squares cubic Bézier fitting (Schneider).
// Plain backgrounds (or transparent PNGs) give a closed object silhouette; inner lines are snapped onto it.
// Line-art pipeline: ink map · thinning (centre line) · spur pruning · ridge-centred points · same fitting.
// Fills: k-means colours on the smoothed image, cleaned regions, stacked layers (no hairline gaps).
//
// Coordinates of every result are in working pixels; pixel (x, y) covers [x, x+1) × [y, y+1).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const OFF8 = (W) => [1, W + 1, W, W - 1, -1, -W - 1, -W, -W + 1]; // E SE S SW W NW N NE (clockwise)

export const DEFAULTS = Object.freeze({
  mode: 'auto',     // 'auto' | 'photo' | 'lineart'
  detail: 65,       // 0..100 — more/finer lines
  smooth: 55,       // 0..100 — smoother curves, fewer corners
  bg: 'auto',       // 'auto' | 'remove' | 'keep'
  outline: true,    // closed object silhouette (needs a separable background)
  fill: 'none',     // 'none' | 'color' | 'solid'
  colors: 8,        // fill colours for 'color'
  shadows: true,    // treat neutral floor shadows as background
});

// ---------------------------------------------------------------- basic image ops
function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { k, r };
}
// Separable Gaussian blur, clamp-to-edge.
function blur(src, W, H, sigma, out) {
  out ||= new Float32Array(W * H);
  if (sigma < 0.2) { out.set(src); return out; }
  const { k, r } = gaussKernel(sigma), tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      if (x >= r && x < W - r) { const b = o + x - r; for (let i = 0; i <= 2 * r; i++) s += src[b + i] * k[i]; }
      else for (let i = -r; i <= r; i++) { const xx = x + i < 0 ? 0 : x + i >= W ? W - 1 : x + i; s += src[o + xx] * k[i + r]; }
      tmp[o + x] = s;
    }
  }
  for (let y = 0; y < H; y++) {
    const o = y * W;
    out.fill(0, o, o + W);
    for (let i = -r; i <= r; i++) {
      const yy = y + i < 0 ? 0 : y + i >= H ? H - 1 : y + i, oo = yy * W, w = k[i + r];
      for (let x = 0; x < W; x++) out[o + x] += tmp[oo + x] * w;
    }
  }
  return out;
}
// Edge-aware smoothing: domain transform, recursive filter (Gastal & Oliveira 2011). chans: Float32Array[].
function domainTransform(chans, W, H, sigmaS, sigmaR, iters = 3) {
  const N = W * H, nc = chans.length, ratio = sigmaS / sigmaR;
  const dH = new Float32Array(N), dV = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 1; x < W; x++) { let s = 0; for (let c = 0; c < nc; c++) s += Math.abs(chans[c][o + x] - chans[c][o + x - 1]); dH[o + x] = 1 + ratio * s; }
  }
  for (let y = 1; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) { let s = 0; for (let c = 0; c < nc; c++) s += Math.abs(chans[c][o + x] - chans[c][o + x - W]); dV[o + x] = 1 + ratio * s; }
  }
  const out = chans.map(c => Float32Array.from(c)), V = new Float32Array(N);
  for (let it = 0; it < iters; it++) {
    const sH = sigmaS * Math.sqrt(3) * 2 ** (iters - (it + 1)) / Math.sqrt(4 ** iters - 1), la = -Math.SQRT2 / sH;
    for (let k = 0; k < N; k++) V[k] = Math.exp(la * dH[k]);
    for (const F of out) for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 1; x < W; x++) { const k = o + x; F[k] += V[k] * (F[k - 1] - F[k]); }
      for (let x = W - 2; x >= 0; x--) { const k = o + x; F[k] += V[k + 1] * (F[k + 1] - F[k]); }
    }
    for (let k = 0; k < N; k++) V[k] = Math.exp(la * dV[k]);
    for (const F of out) {
      for (let y = 1; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) { const k = o + x; F[k] += V[k] * (F[k - W] - F[k]); } }
      for (let y = H - 2; y >= 0; y--) { const o = y * W; for (let x = 0; x < W; x++) { const k = o + x; F[k] += V[k + W] * (F[k + W] - F[k]); } }
    }
  }
  return out;
}
// Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher). src[k] = 1 → distance 0.
function edt(src, W, H) {
  const INF = 1e20, N = W * H, f = new Float64Array(Math.max(W, H)), d = new Float64Array(Math.max(W, H));
  const v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1), g = new Float64Array(N);
  const pass = (n) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = src[y * W + x] ? 0 : INF;
    pass(H);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  const out = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) f[x] = g[o + x];
    pass(W);
    for (let x = 0; x < W; x++) out[o + x] = Math.sqrt(d[x]);
  }
  return out;
}
// 4-connected components of pixels where pred(k) is true → { id: Int32Array (-1 = none), area[], touch[] (touches border) }
function components(W, H, pred) {
  const N = W * H, id = new Int32Array(N).fill(-1), area = [], touch = [], st = new Int32Array(N);
  let n = 0;
  for (let s = 0; s < N; s++) {
    if (id[s] >= 0 || !pred(s)) continue;
    let sp = 0, a = 0, t = 0; st[sp++] = s; id[s] = n;
    while (sp) {
      const k = st[--sp], x = k % W, y = (k / W) | 0; a++;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) t = 1;
      if (x > 0 && id[k - 1] < 0 && pred(k - 1)) { id[k - 1] = n; st[sp++] = k - 1; }
      if (x < W - 1 && id[k + 1] < 0 && pred(k + 1)) { id[k + 1] = n; st[sp++] = k + 1; }
      if (y > 0 && id[k - W] < 0 && pred(k - W)) { id[k - W] = n; st[sp++] = k - W; }
      if (y < H - 1 && id[k + W] < 0 && pred(k + W)) { id[k + W] = n; st[sp++] = k + W; }
    }
    area.push(a); touch.push(t); n++;
  }
  return { id, area, touch, n };
}
function otsu(hist) {
  let tot = 0, sum = 0;
  for (let i = 0; i < hist.length; i++) { tot += hist[i]; sum += i * hist[i]; }
  let wB = 0, sB = 0, best = 0, bi = 0;
  for (let i = 0; i < hist.length; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = tot - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; bi = i; }
  }
  return bi;
}

// ---------------------------------------------------------------- colour
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const fLab = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function toLab(rgba, N) {
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  let transp = 0;
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    let r = LIN[rgba[j]], g = LIN[rgba[j + 1]], b = LIN[rgba[j + 2]];
    const a = rgba[j + 3];
    if (a < 255) { const t = a / 255; r = r * t + 1 - t; g = g * t + 1 - t; b = b * t + 1 - t; if (a < 128) transp++; }
    const fx = fLab((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), fy = fLab(0.2126 * r + 0.7152 * g + 0.0722 * b), fz = fLab((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    L[i] = 116 * fy - 16; A[i] = 500 * (fx - fy); B[i] = 200 * (fy - fz);
  }
  return { L, A, B, transp };
}
const hex2 = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

// ---------------------------------------------------------------- gradient + edges
// Di Zenzo colour gradient on (already smoothed) channels with Scharr kernels.
function colorGradient(chans, wts, W, H) {
  const N = W * H, Jxx = new Float32Array(N), Jyy = new Float32Array(N), Jxy = new Float32Array(N);
  for (let c = 0; c < chans.length; c++) {
    const F = chans[c], w2 = wts[c] * wts[c];
    for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) {
      const a = F[k - W - 1], b = F[k - W], cc = F[k - W + 1], d = F[k - 1], e = F[k + 1], f = F[k + W - 1], g = F[k + W], hh = F[k + W + 1];
      const gx = (3 * (cc - a) + 10 * (e - d) + 3 * (hh - f)) / 32, gy = (3 * (f - a) + 10 * (g - b) + 3 * (hh - cc)) / 32;
      Jxx[k] += w2 * gx * gx; Jyy[k] += w2 * gy * gy; Jxy[k] += w2 * gx * gy;
    }
  }
  const mag = new Float32Array(N), ux = new Float32Array(N), uy = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const a = Jxx[k], b = Jyy[k], c = Jxy[k], t = Math.sqrt((a - b) * (a - b) + 4 * c * c), l1 = 0.5 * (a + b + t);
    mag[k] = Math.sqrt(l1);
    let vx = l1 - b, vy = c;
    if (Math.abs(vx) + Math.abs(vy) < Math.abs(c) + Math.abs(l1 - a)) { vx = c; vy = l1 - a; }
    const n = Math.hypot(vx, vy);
    if (n > 1e-12) { ux[k] = vx / n; uy[k] = vy / n; } else { ux[k] = 1; uy[k] = 0; }
  }
  return { mag, ux, uy };
}
// Non-maximum suppression with sub-pixel (parabolic) refinement along the gradient direction.
function nms(G, W, H, minMag) {
  const { mag, ux, uy } = G, N = W * H, cand = new Uint8Array(N), ex = new Float32Array(N), ey = new Float32Array(N);
  const bil = (x, y) => {
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, k = y0 * W + x0;
    return (mag[k] * (1 - fx) + mag[k + 1] * fx) * (1 - fy) + (mag[k + W] * (1 - fx) + mag[k + W + 1] * fx) * fy;
  };
  for (let y = 2; y < H - 2; y++) for (let x = 2, k = y * W + 2; x < W - 2; x++, k++) {
    const m = mag[k];
    if (m < minMag) continue;
    const dx = ux[k], dy = uy[k], m1 = bil(x + dx, y + dy), m2 = bil(x - dx, y - dy);
    if (!((m > m1 && m >= m2) || (m >= m1 && m > m2))) continue;
    const den = m1 + m2 - 2 * m;
    const t = den < -1e-9 ? clamp((m2 - m1) / (2 * den), -0.5, 0.5) : 0;
    cand[k] = 1; ex[k] = x + 0.5 + t * dx; ey[k] = y + 0.5 + t * dy;
  }
  return { cand, ex, ey };
}
function hysteresis(cand, mag, W, H, lo, hi, roi) {
  // 5×5 connectivity: weak maxima up to 2 px apart still continue a strong edge
  const N = W * H, out = new Uint8Array(N), st = new Int32Array(N), off = [];
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (i || j) off.push(j * W + i);
  for (let s = 0; s < N; s++) {
    if (!cand[s] || out[s] || mag[s] < hi || (roi && !roi[s])) continue;
    let sp = 0; st[sp++] = s; out[s] = 1;
    while (sp) {
      const k = st[--sp];
      for (const o of off) { const q = k + o; if (cand[q] && !out[q] && mag[q] >= lo && (!roi || roi[q])) { out[q] = 1; st[sp++] = q; } }
    }
  }
  return out;
}
// Zhang–Suen thinning in place (img 0/1, the 1-px frame must be 0).
function thin(img, W, H) {
  let list = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) if (img[k]) list.push(k);
  const del = [];
  for (let iter = 0; iter < 200; iter++) {
    let changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (const k of list) {
        if (!img[k]) continue;
        const p2 = img[k - W], p3 = img[k - W + 1], p4 = img[k + 1], p5 = img[k + W + 1], p6 = img[k + W], p7 = img[k + W - 1], p8 = img[k - 1], p9 = img[k - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        del.push(k);
      }
      for (const k of del) img[k] = 0;
      if (del.length) changed = true;
    }
    if (!changed) break;
    list = list.filter(k => img[k]);
  }
}
// Follows weak edge evidence from line ends in the line's direction; keeps the walk only if it reaches another
// edge (closes dashed sections of one real edge without growing noise).
function bridgeGaps(edge, cand, mag, ex, ey, W, H, lo2, maxSteps) {
  const off = OFF8(W), ends = [], R = 3;
  for (let y = 3; y < H - 3; y++) for (let x = 3, k = y * W + 3; x < W - 3; x++, k++) {
    if (!edge[k]) continue;
    let cn = 0, cnt = 0;
    for (let i = 0; i < 8; i++) { const a = edge[k + off[i]], b = edge[k + off[(i + 1) & 7]]; if (!a && b) cn++; cnt += a; }
    if (cnt >= 1 && cn === 1) ends.push(k);
  }
  const line = (a, b, out) => { // pixels strictly between a and b
    const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0, n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let i = 1; i < n; i++) out.push(Math.round(ay + (by - ay) * i / n) * W + Math.round(ax + (bx - ax) * i / n));
  };
  let added = 0;
  for (const e of ends) {
    const back = [e];
    let prev = -1, cur = e;
    for (let s = 0; s < 7; s++) {
      let nx = -1;
      for (let i = 0; i < 8; i++) { const q = cur + off[i]; if (edge[q] && q !== prev && !back.includes(q)) { nx = q; break; } }
      if (nx < 0) break;
      prev = cur; cur = nx; back.push(cur);
    }
    if (back.length < 4) continue;
    let dx = (e % W) - (cur % W), dy = ((e / W) | 0) - ((cur / W) | 0), l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    dx /= l; dy /= l;
    const nodes = [e], seen = new Set(back);
    let p = e, hit = -1, walked = 0;
    while (walked < maxSteps) {
      const px = p % W, py = (p / W) | 0;
      let best = -1, bs = -1, bEdge = -1, beS = -1;
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const d = Math.hypot(i, j); if (d < 0.5 || d > R + 0.01) continue;
        const qx = px + i, qy = py + j; if (qx < 2 || qy < 2 || qx > W - 3 || qy > H - 3) continue;
        const q = qy * W + qx; if (seen.has(q)) continue;
        const al = (i * dx + j * dy) / d; if (al < 0.7) continue;
        if (edge[q]) { const sc = al - d * 0.05; if (sc > beS) { beS = sc; bEdge = q; } continue; }
        if (!cand[q] || mag[q] < lo2) continue;
        const sc = al - d * 0.12 + 0.1 * Math.min(2, mag[q] / lo2);
        if (sc > bs) { bs = sc; best = q; }
      }
      if (bEdge >= 0) { hit = bEdge; break; }
      if (best < 0) break;
      const bx = (best % W) - px, by = ((best / W) | 0) - py, bl = Math.hypot(bx, by);
      walked += bl; nodes.push(best); seen.add(best);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) seen.add(p + j * W + i);
      dx = 0.7 * dx + 0.3 * bx / bl; dy = 0.7 * dy + 0.3 * by / bl; l = Math.hypot(dx, dy); dx /= l; dy /= l;
      p = best;
    }
    if (hit < 0) continue;
    nodes.push(hit);
    const fill = [];
    for (let i = 0; i < nodes.length - 1; i++) { if (i) fill.push(nodes[i]); line(nodes[i], nodes[i + 1], fill); }
    for (const q of fill) { if (!edge[q]) { edge[q] = 1; added++; if (!cand[q]) { ex[q] = (q % W) + 0.5; ey[q] = ((q / W) | 0) + 0.5; } } }
  }
  return added;
}
// Pixel chains of a thinned map. Returns [{ px: Int32Array of pixel indices, closed, j0, j1 }] (j = ends at junction).
function traceChains(img, W, H) {
  const N = W * H, off = OFF8(W), type = new Uint8Array(N), pix = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) {
    if (!img[k]) continue;
    let cn = 0, cnt = 0;
    for (let i = 0; i < 8; i++) { const a = img[k + off[i]], b = img[k + off[(i + 1) & 7]]; if (!a && b) cn++; cnt += a; }
    type[k] = cnt === 0 ? 4 : cn <= 1 ? 1 : cn === 2 ? 2 : 3; // 4 isolated, 1 end, 2 regular, 3 junction
    pix.push(k);
  }
  const vis = new Uint8Array(N), out = [], ORD = [0, 2, 4, 6, 1, 3, 5, 7];
  const walk = (start, next) => {
    const ch = [start];
    if (type[start] !== 3) vis[start] = 1;
    let prev = start, cur = next;
    for (;;) {
      ch.push(cur);
      if (type[cur] === 3) break;
      vis[cur] = 1;
      let nx = -1;
      for (const i of ORD) {
        const q = cur + off[i];
        if (!img[q] || q === prev) continue;
        if (type[q] === 3) { if (q !== start || ch.length > 3) { nx = q; break; } continue; }
        if (!vis[q]) { nx = q; break; }
      }
      if (nx < 0) break;
      prev = cur; cur = nx;
    }
    return ch;
  };
  for (const k of pix) if (type[k] === 1 && !vis[k]) {
    let nx = -1;
    for (const i of ORD) { const q = k + off[i]; if (img[q] && (type[q] === 3 || !vis[q])) { nx = q; break; } }
    if (nx < 0) { vis[k] = 1; continue; }
    const ch = walk(k, nx);
    out.push({ px: ch, closed: false, j0: false, j1: type[ch[ch.length - 1]] === 3 });
  }
  for (const k of pix) if (type[k] === 3) {
    for (const i of ORD) {
      const q = k + off[i];
      if (!img[q] || vis[q] || type[q] === 3) continue;
      const ch = walk(k, q);
      out.push({ px: ch, closed: false, j0: true, j1: type[ch[ch.length - 1]] === 3 });
    }
  }
  for (const k of pix) if (!vis[k] && type[k] === 2) {
    let nx = -1;
    for (const i of ORD) { const q = k + off[i]; if (img[q] && !vis[q]) { nx = q; break; } }
    if (nx < 0) { vis[k] = 1; continue; }
    const ch = walk(k, nx), last = ch[ch.length - 1];
    let adj = false;
    for (let i = 0; i < 8; i++) if (last + off[i] === k) adj = true;
    out.push({ px: ch, closed: adj && ch.length > 4, j0: false, j1: false });
  }
  return out;
}
const polyLen = (p) => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };

// Joins chains whose ends meet (shared junction or small gap) with compatible directions.
function mergeChains(chs, gap, tanLen) {
  const ends = [];
  for (let i = 0; i < chs.length; i++) {
    const c = chs[i], p = c.p, n = p.length / 2;
    if (c.closed || n < 2) continue;
    for (let e = 0; e < 2; e++) {
      const a = e ? n - 1 : 0;
      // tangent from a point ~tanLen px inside the chain
      let b = a, acc = 0;
      while (acc < tanLen) { const nb = e ? b - 1 : b + 1; if (nb < 0 || nb >= n) break; acc += Math.hypot(p[2 * nb] - p[2 * b], p[2 * nb + 1] - p[2 * b + 1]); b = nb; }
      let tx = p[2 * a] - p[2 * b], ty = p[2 * a + 1] - p[2 * b + 1];
      const l = Math.hypot(tx, ty);
      if (l < 1e-6) { tx = 0; ty = 0; } else { tx /= l; ty /= l; }
      ends.push({ i, e, x: p[2 * a], y: p[2 * a + 1], tx, ty, len: c.len });
    }
  }
  const cell = Math.max(2, gap), grid = new Map(), key = (cx, cy) => cy * 65536 + cx;
  ends.forEach((en, idx) => { const k = key((en.x / cell) | 0, (en.y / cell) | 0); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(idx); });
  const cand = [], cosJ = Math.cos(50 * Math.PI / 180), cosG = Math.cos(38 * Math.PI / 180);
  ends.forEach((a, ia) => {
    const cx = (a.x / cell) | 0, cy = (a.y / cell) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const lst = grid.get(key(cx + ox, cy + oy)); if (!lst) continue;
      for (const ib of lst) {
        if (ib <= ia) continue;
        const b = ends[ib];
        if (a.i === b.i && chs[a.i].len < gap * 4) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d > gap) continue;
        const cosT = -(a.tx * b.tx + a.ty * b.ty);
        let cost;
        if (d < 1.75) {
          if (cosT < cosJ) continue;
          cost = (1 - cosT) * 2 + d * 0.05;
        } else {
          const vx = dx / d, vy = dy / d, ca = a.tx * vx + a.ty * vy, cb = -(b.tx * vx + b.ty * vy);
          if (ca < cosG || cb < cosG || cosT < cosJ) continue;
          cost = d / gap + (1 - ca) + (1 - cb) + (1 - cosT) + 0.25;
        }
        cand.push([cost, ia, ib]);
      }
    }
  });
  cand.sort((x, y) => x[0] - y[0]);
  const link = new Map();
  for (const [, ia, ib] of cand) {
    const a = ends[ia], b = ends[ib], ka = a.i * 2 + a.e, kb = b.i * 2 + b.e;
    if (link.has(ka) || link.has(kb)) continue;
    link.set(ka, kb); link.set(kb, ka);
  }
  const used = new Uint8Array(chs.length), out = [];
  const build = (startI, startE) => {
    // enter chain startI via end startE
    const pts = [], parts = [];
    let i = startI, e = startE, closed = false;
    for (let guard = 0; guard < chs.length + 1; guard++) {
      used[i] = 1; parts.push(i);
      const p = chs[i].p, n = p.length / 2;
      for (let s = 0; s < n; s++) {
        const j = e === 0 ? s : n - 1 - s, x = p[2 * j], y = p[2 * j + 1];
        if (pts.length) { const lx = pts[pts.length - 2], ly = pts[pts.length - 1]; if (Math.abs(lx - x) + Math.abs(ly - y) < 0.35) continue; }
        pts.push(x, y);
      }
      const exitK = i * 2 + (1 - e), nk = link.get(exitK);
      if (nk === undefined) break;
      const ni = nk >> 1, ne = nk & 1;
      if (ni === startI && ne === startE) { closed = true; break; }
      if (used[ni]) break;
      i = ni; e = ne;
    }
    return { p: pts, closed, parts };
  };
  for (let i = 0; i < chs.length; i++) {
    if (used[i]) continue;
    const c = chs[i];
    if (c.closed) { used[i] = 1; out.push({ p: c.p, closed: true, parts: [i] }); continue; }
    // walk back to a free end
    let ci = i, ce = 0, guard = 0;
    for (;;) {
      const nk = link.get(ci * 2 + ce);
      if (nk === undefined || guard++ > chs.length) break;
      const ni = nk >> 1, ne = nk & 1;
      if (ni === i) { ci = i; ce = 0; break; }
      ci = ni; ce = 1 - ne;
    }
    out.push(build(ci, ce));
  }
  return out;
}

// ---------------------------------------------------------------- marching squares
// Iso-contours (closed loops) of field F at level t; outside the image counts as 0.
// Returned loops keep the high side on the right (screen coords).
const MS = (() => {
  const EM = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]; // edges top,right,bottom,left
  const CO = [[0, 0], [1, 0], [1, 1], [0, 1]]; // corners tl,tr,br,bl  (bits 8,4,2,1)
  const EC = [[0, 1], [1, 2], [3, 2], [0, 3]];
  const tbl = [];
  const orient = (a, b, corner, high) => {
    const [ax, ay] = EM[a], [bx, by] = EM[b], [cx, cy] = CO[corner];
    const s = -(by - ay) * (cx - ax) + (bx - ax) * (cy - ay);
    return (high ? s > 0 : s < 0) ? [a, b] : [b, a];
  };
  for (let c = 0; c < 32; c++) { // bit 4 (16) = saddle centre high
    const idx = c & 15, hi = [8, 4, 2, 1].map(b => !!(idx & b)), centre = !!(c & 16);
    const cross = [0, 1, 2, 3].filter(e => hi[EC[e][0]] !== hi[EC[e][1]]);
    const segs = [];
    if (cross.length === 2) {
      const h = hi.findIndex(v => v);
      segs.push(orient(cross[0], cross[1], h, true));
    } else if (cross.length === 4) {
      // saddle: tl&br high (idx 10) or tr&bl high (idx 5)
      const cut = centre ? hi.map(v => !v) : hi; // corners cut off by a segment
      for (let k = 0; k < 4; k++) if (cut[k]) {
        const es = [0, 1, 2, 3].filter(e => EC[e].includes(k));
        segs.push(orient(es[0], es[1], k, hi[k]));
      }
    }
    tbl.push(segs);
  }
  return tbl;
})();
function contours(F, W, H, t, minLen = 0) {
  const PW = W + 2, PH = H + 2, NE = PW * PH;
  const g = (X, Y) => (X < 1 || Y < 1 || X > W || Y > H ? 0 : F[(Y - 1) * W + (X - 1)]);
  const ids = new Map(), px = [], py = [], nxt = [];
  const point = (X, Y, e, v) => {
    const id = e === 0 ? Y * PW + X : e === 2 ? (Y + 1) * PW + X : e === 3 ? NE + Y * PW + X : NE + Y * PW + X + 1;
    let p = ids.get(id);
    if (p !== undefined) return p;
    let ax, ay, bx, by, va, vb;
    if (e === 0) { ax = X; ay = Y; bx = X + 1; by = Y; va = v[0]; vb = v[1]; }
    else if (e === 1) { ax = X + 1; ay = Y; bx = X + 1; by = Y + 1; va = v[1]; vb = v[2]; }
    else if (e === 2) { ax = X; ay = Y + 1; bx = X + 1; by = Y + 1; va = v[3]; vb = v[2]; }
    else { ax = X; ay = Y; bx = X; by = Y + 1; va = v[0]; vb = v[3]; }
    const u = va === vb ? 0.5 : clamp((t - va) / (vb - va), 0, 1);
    p = px.length; ids.set(id, p);
    px.push(ax + (bx - ax) * u - 0.5); py.push(ay + (by - ay) * u - 0.5); nxt.push(-1);
    return p;
  };
  const v = [0, 0, 0, 0];
  for (let Y = 0; Y < PH - 1; Y++) for (let X = 0; X < PW - 1; X++) {
    v[0] = g(X, Y); v[1] = g(X + 1, Y); v[2] = g(X + 1, Y + 1); v[3] = g(X, Y + 1);
    let idx = (v[0] > t ? 8 : 0) | (v[1] > t ? 4 : 0) | (v[2] > t ? 2 : 0) | (v[3] > t ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    if ((idx === 5 || idx === 10) && (v[0] + v[1] + v[2] + v[3]) / 4 > t) idx |= 16;
    for (const [a, b] of MS[idx]) nxt[point(X, Y, a, v)] = point(X, Y, b, v);
  }
  const loops = [], seen = new Uint8Array(px.length);
  for (let s = 0; s < px.length; s++) {
    if (seen[s] || nxt[s] < 0) continue;
    const pts = [];
    let k = s;
    while (k >= 0 && !seen[k]) { seen[k] = 1; pts.push(px[k], py[k]); k = nxt[k]; }
    if (pts.length >= 6 && (!minLen || polyLen(pts) >= minLen)) loops.push(pts);
  }
  return loops;
}
const polyArea = (p) => { let a = 0; const n = p.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) a += (p[2 * j] - p[2 * i]) * (p[2 * j + 1] + p[2 * i + 1]); return a / 2; };

// ---------------------------------------------------------------- curve fitting
function resample(P, closed, step) {
  const n = P.length / 2;
  if (n < 2) return Float64Array.from(P);
  const m0 = closed ? n + 1 : n, cum = new Float64Array(m0);
  for (let i = 1; i < m0; i++) { const a = i - 1, b = i % n; cum[i] = cum[i - 1] + Math.hypot(P[2 * b] - P[2 * a], P[2 * b + 1] - P[2 * a + 1]); }
  const L = cum[m0 - 1];
  if (L < 1e-6) return Float64Array.from([P[0], P[1]]);
  const m = closed ? Math.max(4, Math.round(L / step)) : Math.max(2, Math.round(L / step) + 1);
  const st = closed ? L / m : L / (m - 1), out = new Float64Array(2 * m);
  let sg = 1;
  for (let j = 0; j < m; j++) {
    const s = j * st;
    while (sg < m0 - 1 && cum[sg] < s) sg++;
    const a = sg - 1, b = sg % n, sl = cum[sg] - cum[a], u = sl > 1e-9 ? clamp((s - cum[a]) / sl, 0, 1) : 0;
    out[2 * j] = P[2 * a] + (P[2 * b] - P[2 * a]) * u; out[2 * j + 1] = P[2 * a + 1] + (P[2 * b + 1] - P[2 * a + 1]) * u;
  }
  if (!closed) { out[2 * m - 2] = P[2 * n - 2]; out[2 * m - 1] = P[2 * n - 1]; }
  return out;
}
function smoothPts(P, closed, sigma) {
  const n = P.length / 2;
  if (sigma < 0.3 || n < 4) return P;
  const R = Math.ceil(sigma * 2.5), w = new Float64Array(R + 1);
  for (let j = 0; j <= R; j++) w[j] = Math.exp(-(j * j) / (2 * sigma * sigma));
  const Q = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const r = closed ? Math.min(R, (n - 1) >> 1) : Math.min(R, i, n - 1 - i);
    let sx = P[2 * i] * w[0], sy = P[2 * i + 1] * w[0], sw = w[0];
    for (let j = 1; j <= r; j++) {
      const a = closed ? (i - j + n) % n : i - j, b = closed ? (i + j) % n : i + j;
      sx += (P[2 * a] + P[2 * b]) * w[j]; sy += (P[2 * a + 1] + P[2 * b + 1]) * w[j]; sw += 2 * w[j];
    }
    Q[2 * i] = sx / sw; Q[2 * i + 1] = sy / sw;
  }
  return Q;
}
function findCorners(P, closed, k, thr) {
  const n = P.length / 2, ang = new Float64Array(n), res = [];
  if (n < 2 * k + 3) return res;
  for (let i = 0; i < n; i++) {
    let a = i - k, b = i + k;
    if (closed) { a = (a + n) % n; b %= n; } else if (a < 0 || b >= n) continue;
    const v1x = P[2 * i] - P[2 * a], v1y = P[2 * i + 1] - P[2 * a + 1], v2x = P[2 * b] - P[2 * i], v2y = P[2 * b + 1] - P[2 * i + 1];
    const l = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (l < 1e-9) continue;
    ang[i] = 1 - (v1x * v2x + v1y * v2y) / l;
  }
  for (let i = 0; i < n; i++) {
    if (ang[i] < thr) continue;
    let mx = true;
    for (let j = -k; j <= k && mx; j++) {
      if (!j) continue;
      let q = i + j;
      if (closed) q = (q + n) % n; else if (q < 0 || q >= n) continue;
      if (ang[q] > ang[i] || (ang[q] === ang[i] && q < i)) mx = false;
    }
    if (mx) res.push(i);
  }
  return res;
}
function chordParam(P, a, b) {
  const u = new Float64Array(b - a + 1);
  for (let i = a + 1; i <= b; i++) u[i - a] = u[i - a - 1] + Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
  const L = u[b - a] || 1;
  for (let i = 0; i < u.length; i++) u[i] /= L;
  return u;
}
function genBezier(P, a, b, u, t1x, t1y, t2x, t2y) {
  const x0 = P[2 * a], y0 = P[2 * a + 1], x3 = P[2 * b], y3 = P[2 * b + 1];
  let C00 = 0, C01 = 0, C11 = 0, X0 = 0, X1 = 0;
  for (let i = 0; i <= b - a; i++) {
    const t = u[i], mt = 1 - t, b0 = mt * mt * mt, b1 = 3 * t * mt * mt, b2 = 3 * t * t * mt, b3 = t * t * t;
    const a1x = t1x * b1, a1y = t1y * b1, a2x = t2x * b2, a2y = t2y * b2;
    C00 += a1x * a1x + a1y * a1y; C01 += a1x * a2x + a1y * a2y; C11 += a2x * a2x + a2y * a2y;
    const tx = P[2 * (a + i)] - (x0 * (b0 + b1) + x3 * (b2 + b3)), ty = P[2 * (a + i) + 1] - (y0 * (b0 + b1) + y3 * (b2 + b3));
    X0 += a1x * tx + a1y * ty; X1 += a2x * tx + a2y * ty;
  }
  const det = C00 * C11 - C01 * C01, seg = Math.hypot(x3 - x0, y3 - y0);
  let al1 = 0, al2 = 0;
  if (Math.abs(det) > 1e-12) { al1 = (X0 * C11 - X1 * C01) / det; al2 = (C00 * X1 - C01 * X0) / det; }
  if (!(al1 > 1e-6 * seg) || !(al2 > 1e-6 * seg) || al1 > seg * 2 || al2 > seg * 2) al1 = al2 = seg / 3;
  return [x0, y0, x0 + t1x * al1, y0 + t1y * al1, x3 + t2x * al2, y3 + t2y * al2, x3, y3];
}
function bezPt(bz, t) {
  const mt = 1 - t, a = mt * mt * mt, b = 3 * t * mt * mt, c = 3 * t * t * mt, d = t * t * t;
  return [a * bz[0] + b * bz[2] + c * bz[4] + d * bz[6], a * bz[1] + b * bz[3] + c * bz[5] + d * bz[7]];
}
function maxError(P, a, b, bz, u) {
  let mx = 0, sp = (a + b) >> 1;
  for (let i = a + 1; i < b; i++) {
    const [x, y] = bezPt(bz, u[i - a]), d = (x - P[2 * i]) ** 2 + (y - P[2 * i + 1]) ** 2;
    if (d >= mx) { mx = d; sp = i; }
  }
  return [mx, sp];
}
function reparam(P, a, b, u, bz) {
  const out = new Float64Array(u.length);
  for (let i = a; i <= b; i++) {
    const t = u[i - a], mt = 1 - t, px = P[2 * i], py = P[2 * i + 1];
    const [qx, qy] = bezPt(bz, t);
    const d1x = 3 * (mt * mt * (bz[2] - bz[0]) + 2 * mt * t * (bz[4] - bz[2]) + t * t * (bz[6] - bz[4])), d1y = 3 * (mt * mt * (bz[3] - bz[1]) + 2 * mt * t * (bz[5] - bz[3]) + t * t * (bz[7] - bz[5]));
    const d2x = 6 * (mt * (bz[4] - 2 * bz[2] + bz[0]) + t * (bz[6] - 2 * bz[4] + bz[2])), d2y = 6 * (mt * (bz[5] - 2 * bz[3] + bz[1]) + t * (bz[7] - 2 * bz[5] + bz[3]));
    const num = (qx - px) * d1x + (qy - py) * d1y, den = d1x * d1x + d1y * d1y + (qx - px) * d2x + (qy - py) * d2y;
    out[i - a] = Math.abs(den) < 1e-12 ? t : clamp(t - num / den, 0, 1);
  }
  return out;
}
function tangentAt(P, i, dir, n, span = 3) {
  // unit vector from point i towards neighbours in direction dir (+1 forward, -1 backward)
  const j = clamp(i + dir * span, 0, n - 1);
  let x = P[2 * j] - P[2 * i], y = P[2 * j + 1] - P[2 * i + 1];
  const l = Math.hypot(x, y);
  return l > 1e-9 ? [x / l, y / l] : [dir, 0];
}
function fitCubic(P, a, b, t1x, t1y, t2x, t2y, err2, out, depth = 0) {
  const n = b - a + 1;
  const x0 = P[2 * a], y0 = P[2 * a + 1], x3 = P[2 * b], y3 = P[2 * b + 1];
  if (n <= 2 || depth > 24) {
    const d = Math.hypot(x3 - x0, y3 - y0) / 3;
    out.push(x0 + t1x * d, y0 + t1y * d, x3 + t2x * d, y3 + t2y * d, x3, y3);
    return;
  }
  let u = chordParam(P, a, b), bz = genBezier(P, a, b, u, t1x, t1y, t2x, t2y), [mx, sp] = maxError(P, a, b, bz, u);
  if (mx < err2) { out.push(bz[2], bz[3], bz[4], bz[5], bz[6], bz[7]); return; }
  if (mx < err2 * 25) {
    for (let it = 0; it < 6; it++) {
      const u2 = reparam(P, a, b, u, bz);
      bz = genBezier(P, a, b, u2, t1x, t1y, t2x, t2y);
      [mx, sp] = maxError(P, a, b, bz, u2);
      if (mx < err2) { out.push(bz[2], bz[3], bz[4], bz[5], bz[6], bz[7]); return; }
      u = u2;
    }
  }
  if (sp <= a) sp = a + 1; if (sp >= b) sp = b - 1;
  const s1 = Math.max(a, sp - 2), s2 = Math.min(b, sp + 2);
  let cx = P[2 * s1] - P[2 * s2], cy = P[2 * s1 + 1] - P[2 * s2 + 1];
  const l = Math.hypot(cx, cy);
  if (l < 1e-9) { cx = -(y3 - y0); cy = x3 - x0; const l2 = Math.hypot(cx, cy) || 1; cx /= l2; cy /= l2; } else { cx /= l; cy /= l; }
  fitCubic(P, a, sp, t1x, t1y, cx, cy, err2, out, depth + 1);
  fitCubic(P, sp, b, -cx, -cy, t2x, t2y, err2, out, depth + 1);
}
// Polyline → cubic Bézier chain: [x0,y0, c1x,c1y,c2x,c2y,x,y, ...] plus corner flags per node.
export function fitPolyline(pts, closed, o) {
  let P = resample(pts, closed, 1);
  let n = P.length / 2;
  if (n < 2) return null;
  if (closed && n < 4) closed = false;
  const err2 = o.eps * o.eps;
  // corners on a lightly smoothed copy
  const C = findCorners(smoothPts(P, closed, 1.0), closed, o.cornerK, o.cornerThr);
  const seg = [], nodes = []; // nodes: corner flag for each node (1 = cusp)
  const fitRange = (Q, closed2) => {
    const m = Q.length / 2, out = [];
    if (m < 2) return out;
    if (closed2) {
      const bx = Q[2 * (m - 1)], by = Q[2 * (m - 1) + 1];
      // centre tangent at the seam
      let tx = Q[2] - bx, ty = Q[3] - by; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const R = new Float64Array(2 * (m + 1)); R.set(Q); R[2 * m] = Q[0]; R[2 * m + 1] = Q[1];
      fitCubic(R, 0, m, tx, ty, -tx, -ty, err2, out);
    } else {
      const [t1x, t1y] = tangentAt(Q, 0, 1, m, Math.min(3, m - 1)), [t2x, t2y] = tangentAt(Q, m - 1, -1, m, Math.min(3, m - 1));
      fitCubic(Q, 0, m - 1, t1x, t1y, t2x, t2y, err2, out);
    }
    return out;
  };
  const piece = (a, b) => { // inclusive indices on P (open, or wrapping for closed)
    const len = b >= a ? b - a + 1 : n - a + b + 1, Q = new Float64Array(2 * len);
    for (let i = 0; i < len; i++) { const k = (a + i) % n; Q[2 * i] = P[2 * k]; Q[2 * i + 1] = P[2 * k + 1]; }
    return smoothPts(Q, false, o.sigma);
  };
  if (closed && !C.length) {
    const Q = smoothPts(P, true, o.sigma), out = fitRange(Q, true);
    seg.push(Q[0], Q[1], ...out);
    for (let i = 0; i < out.length / 6; i++) nodes.push(0);
    return { seg: Float32Array.from(seg), closed: true, cusp: Uint8Array.from(nodes) };
  }
  const cut = closed ? C.slice() : [0, ...C.filter(i => i > 1 && i < n - 2), n - 1];
  if (closed) {
    for (let c = 0; c < cut.length; c++) {
      const a = cut[c], b = cut[(c + 1) % cut.length];
      const Q = piece(a, b === a ? (a + n - 1) % n : b);
      const out = fitRange(Q, false);
      if (!seg.length) seg.push(Q[0], Q[1]);
      seg.push(...out);
      for (let i = 0; i < out.length / 6; i++) nodes.push(i === out.length / 6 - 1 ? 1 : 0);
    }
    // ensure exact closure
    seg[seg.length - 2] = seg[0]; seg[seg.length - 1] = seg[1];
  } else {
    for (let c = 0; c < cut.length - 1; c++) {
      const Q = piece(cut[c], cut[c + 1]);
      const out = fitRange(Q, false);
      if (!seg.length) seg.push(Q[0], Q[1]);
      seg.push(...out);
      for (let i = 0; i < out.length / 6; i++) nodes.push(i === out.length / 6 - 1 && c < cut.length - 2 ? 1 : 0);
    }
  }
  return { seg: Float32Array.from(seg), closed, cusp: Uint8Array.from(nodes) };
}

// ---------------------------------------------------------------- tracer
export class Tracer {
  constructor(img) {
    this.W = img.width; this.H = img.height; this.N = this.W * this.H; this.rgba = img.data;
    this.D = Math.sqrt(this.N); this.k = Math.max(0.5, this.D / 1200);
    this.cache = {}; this.tune = {}; this.tk = '{}'; this.prof = {};
  }
  tp(name, def) { const v = this.tune?.[name]; return typeof v === 'number' ? v : def; }
  memo(name, key, fn) {
    const c = this.cache[name]; if (c && c.key === key) return c.val;
    const t = Date.now(), val = fn(); this.prof[name] = (this.prof[name] || 0) + Date.now() - t;
    this.cache[name] = { key, val }; return val;
  }

  lab() {
    return this.memo('lab', '', () => {
      const r = toLab(this.rgba, this.N);
      r.alphaMask = null;
      if (r.transp > this.N * 0.01) {
        // transparent PNG: alpha defines the object when the border is mostly transparent
        const { W, H } = this; let bt = 0, bn = 0;
        for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { bn++; if (this.rgba[(y * W + x) * 4 + 3] < 128) bt++; }
        for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { bn++; if (this.rgba[(y * W + x) * 4 + 3] < 128) bt++; }
        if (bt > bn * 0.5) { const m = new Uint8Array(this.N); for (let i = 0; i < this.N; i++) m[i] = this.rgba[i * 4 + 3] >= 128 ? 1 : 0; r.alphaMask = m; }
      }
      return r;
    });
  }
  // Paper / line-art statistics used by mode 'auto' and the line-art pipeline.
  inkMap() {
    return this.memo('ink', '', () => {
      const { W, H, N } = this, { L } = this.lab(), B = 8, bw = Math.ceil(W / B), bh = Math.ceil(H / B), bm = new Float32Array(bw * bh);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = ((y / B) | 0) * bw + ((x / B) | 0); if (L[y * W + x] > bm[k]) bm[k] = L[y * W + x]; }
      // max over 5×5 blocks (≈ 40 px) removes strokes, then smooth
      const bm2 = new Float32Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        let m = 0;
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const xx = clamp(x + i, 0, bw - 1), yy = clamp(y + j, 0, bh - 1); if (bm[yy * bw + xx] > m) m = bm[yy * bw + xx]; }
        bm2[y * bw + x] = m;
      }
      const bs = blur(bm2, bw, bh, 1.5), dk = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const fx = clamp((x + 0.5) / B - 0.5, 0, bw - 1), fy = clamp((y + 0.5) / B - 0.5, 0, bh - 1), x0 = fx | 0, y0 = fy | 0, x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
        const bg = (bs[y0 * bw + x0] * (1 - ax) + bs[y0 * bw + x1] * ax) * (1 - ay) + (bs[y1 * bw + x0] * (1 - ax) + bs[y1 * bw + x1] * ax) * ay;
        const k = y * W + x;
        dk[k] = clamp((Math.max(bg, 25) - L[k]) / Math.max(bg, 25), 0, 1);
      }
      const hist = new Float64Array(256);
      for (let k = 0; k < N; k++) if (dk[k] > 0.04) hist[Math.min(255, (dk[k] * 255) | 0)]++;
      const ot = otsu(hist) / 255;
      return { dk, otsu: ot };
    });
  }
  analyze() {
    return this.memo('analyze', '', () => {
      const { W, H, N } = this, { A, B, alphaMask } = this.lab(), { dk, otsu: ot } = this.inkMap();
      const tInk = clamp(ot, 0.15, 0.6);
      let paper = 0, ink = 0, shade = 0, chroma = 0, inkPer = 0;
      for (let k = 0; k < N; k++) {
        const d = dk[k];
        if (d < 0.05) paper++; else if (d >= tInk) { ink++; chroma += Math.hypot(A[k], B[k]); } else shade++;
      }
      // ink boundary length (thin strokes have area/perimeter ≈ half width)
      for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) if (dk[k] >= tInk && (dk[k - 1] < tInk || dk[k + 1] < tInk || dk[k - W] < tInk || dk[k + W] < tInk)) inkPer++;
      const halfW = ink / Math.max(1, inkPer), fPaper = paper / N, fInk = ink / N, fShade = shade / N, cInk = chroma / Math.max(1, ink);
      // flat-colour artwork with dark outlines (clipart, icons, cartoons): locally constant colour almost everywhere
      const px = this.rgba, q5 = new Uint32Array(32768), rgb = new Uint8Array(N * 3);
      for (let k = 0, j = 0; k < N; k++, j += 4) {
        const a = px[j + 3] / 255, r = px[j] * a + 255 * (1 - a), g = px[j + 1] * a + 255 * (1 - a), b = px[j + 2] * a + 255 * (1 - a);
        rgb[k * 3] = r; rgb[k * 3 + 1] = g; rgb[k * 3 + 2] = b; q5[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++;
      }
      let bgBin = 0; for (let i = 1; i < 32768; i++) if (q5[i] > q5[bgBin]) bgBin = i;
      let nb = 0, flat0 = 0, z2 = 0, dark = 0;
      for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
        const k = y * W + x, i3 = k * 3;
        if ((((rgb[i3] >> 3) << 10) | ((rgb[i3 + 1] >> 3) << 5) | (rgb[i3 + 2] >> 3)) === bgBin) continue;
        nb++;
        let m1 = 0, m2 = 0;
        for (let c = 0; c < 3; c++) {
          const v = rgb[i3 + c], l = rgb[i3 - 3 + c], r = rgb[i3 + 3 + c], u = rgb[i3 - W * 3 + c], d = rgb[i3 + W * 3 + c];
          m1 = Math.max(m1, Math.abs(l - v), Math.abs(r - v), Math.abs(u - v), Math.abs(d - v));
          m2 = Math.max(m2, Math.abs(l + r - 2 * v), Math.abs(u + d - 2 * v));
        }
        if (m1 <= 2) flat0++;
        if (m2 <= 1) z2++;
        if (0.2126 * rgb[i3] + 0.7152 * rgb[i3 + 1] + 0.0722 * rgb[i3 + 2] < 70) dark++;
      }
      const fFlat = flat0 / Math.max(1, nb), fZ2 = z2 / Math.max(1, nb), fDark = dark / Math.max(1, nb);
      const art = fFlat >= 0.66 && fZ2 >= 0.6 && fDark >= 0.04;
      const lineart = !art && !alphaMask && fPaper > 0.45 && fInk > 0.002 && fInk < 0.3 && halfW < Math.max(3.2 * this.k, 0.0045 * this.D) && fShade < fInk * 2.2 + 0.03 && cInk < 22;
      return { lineart, art, fFlat, fZ2, fDark, fPaper, fInk, fShade, halfW, cInk, tInk };
    });
  }
  smoothed(detail) {
    const d = Math.round(detail / 10) * 10;
    return this.memo('dt', d + this.tk, () => {
      const { W, H, N } = this, { L, A, B } = this.lab(), t = d / 100;
      const ch = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
      for (let k = 0; k < N; k++) { ch[0][k] = L[k] / 100; ch[1][k] = A[k] / 100; ch[2][k] = B[k] / 100; }
      return domainTransform(ch, W, H, this.tp('ss', lerp(16, 5, t)) * this.k, this.tp('sr', lerp(0.32, 0.14, t)), 3);
    });
  }
  gradient(detail) {
    const d = Math.round(detail / 10) * 10;
    return this.memo('grad', d + this.tk, () => {
      const { W, H } = this, S = this.smoothed(d), sg = this.tp('sg', lerp(1.5, 0.85, d / 100)) * Math.max(1, this.k * 0.8);
      const ch = S.map(c => blur(c, W, H, sg));
      return colorGradient(ch, [1, 0.75, 0.75], W, H);
    });
  }
  // Object mask (1 = object) from alpha or a plain background; null when not separable.
  objectMask(bgOpt, detail, shadows = true) {
    if (bgOpt === 'keep') return null;
    const hint = this.bgHint;
    return this.memo('mask', [bgOpt, Math.round(detail / 10), shadows, this.tk, hint ? hint.ref.join(',') + hint.tol : ''].join('|'), () => {
      this.bgInfo = null;
      const { W, H, N } = this, lab = this.lab();
      const clean = (m) => {
        // remove specks of object and fill tiny pinholes
        const minObj = Math.max(30, N * 0.0004), minHole = Math.max(12, N * 0.00004);
        const fc = components(W, H, k => m[k] === 1);
        for (let k = 0; k < N; k++) if (m[k] && fc.area[fc.id[k]] < minObj) m[k] = 0;
        const bc = components(W, H, k => m[k] === 0);
        for (let k = 0; k < N; k++) if (!m[k] && !bc.touch[bc.id[k]] && bc.area[bc.id[k]] < minHole) m[k] = 1;
        let cnt = 0; for (let k = 0; k < N; k++) cnt += m[k];
        return cnt > N * 0.004 && cnt < N * 0.985 ? m : null;
      };
      if (lab.alphaMask) return clean(Uint8Array.from(lab.alphaMask));
      const S = this.smoothed(detail), [SL, SA, SB] = S;
      // border statistics
      const ring = [], step = Math.max(1, Math.floor((2 * (W + H)) / 3000));
      for (let x = 0; x < W; x += step) ring.push(x, W + x, (H - 1) * W + x, (H - 2) * W + x);
      for (let y = 2; y < H - 2; y += step) ring.push(y * W, y * W + 1, y * W + W - 1, y * W + W - 2);
      const med = (f) => { const a = Float32Array.from(ring, k => f[k]).sort(); return a[a.length >> 1]; };
      const rL = hint ? hint.ref[0] : med(SL), rA = hint ? hint.ref[1] : med(SA), rB = hint ? hint.ref[2] : med(SB);
      const de = (k) => 100 * Math.hypot(SL[k] - rL, SA[k] - rA, SB[k] - rB);
      const ds = Float32Array.from(ring, de).sort(), within = ds.filter(v => v < 8).length / ds.length, p75 = ds[(ds.length * 0.75) | 0];
      if (bgOpt === 'auto' && within < (hint ? 0.25 : 0.72)) return null;
      const tol = hint ? hint.tol : clamp(5 + 2.2 * p75, 6.5, 18), G = this.gradient(detail).mag;
      this.bgInfo = { ref: [rL, rA, rB], tol };
      const gs = Float32Array.from(ring, k => G[k]).sort(), gN = gs[(gs.length * 0.9) | 0];
      const stop = Math.max(0.012, gN * 3), neutralRef = Math.hypot(rA, rB) * 100 < 10;
      const neutral = (k) => 100 * Math.hypot(SA[k] - rA, SB[k] - rB) < 6.5;
      const bg = new Uint8Array(N), st = new Int32Array(N);
      let sp = 0;
      for (const k of ring) if (!bg[k] && de(k) < tol) { bg[k] = 1; st[sp++] = k; }
      const ok = (k, from) => {
        if (G[k] > stop * 1.6) return false;
        if (de(k) < tol) return true;
        // smooth gradients / vignetting of a neutral backdrop
        return neutralRef && neutral(k) && de(k) < 38 && G[k] < stop && Math.abs(SL[k] - SL[from]) * 100 < 1.2;
      };
      const flood = () => {
        while (sp) {
          const k = st[--sp], x = k % W, y = (k / W) | 0;
          if (x > 0 && !bg[k - 1] && ok(k - 1, k)) { bg[k - 1] = 1; st[sp++] = k - 1; }
          if (x < W - 1 && !bg[k + 1] && ok(k + 1, k)) { bg[k + 1] = 1; st[sp++] = k + 1; }
          if (y > 0 && !bg[k - W] && ok(k - W, k)) { bg[k - W] = 1; st[sp++] = k - W; }
          if (y < H - 1 && !bg[k + W] && ok(k + W, k)) { bg[k + W] = 1; st[sp++] = k + W; }
        }
      };
      flood();
      // enclosed holes of background colour (gaps between chair slats, handles …)
      const holeMin = Math.max(40, N * 0.00012);
      const hc = components(W, H, k => !bg[k] && de(k) < tol * 0.9 && G[k] < stop * 2);
      const hsum = new Float64Array(hc.n);
      for (let k = 0; k < N; k++) if (hc.id[k] >= 0) hsum[hc.id[k]] += de(k);
      for (let k = 0; k < N; k++) { const c = hc.id[k]; if (c >= 0 && hc.area[c] >= holeMin && hsum[c] / hc.area[c] < tol * 0.6) bg[k] = 1; }
      // cast shadows on a neutral floor: neutral darkening of the backdrop, flat inside, touching the background,
      // lying in the lower part of the object
      let shadowPx = 0;
      if (shadows && neutralRef) {
        let y0 = H, y1 = 0;
        for (let y = 0; y < H; y++) for (let x = 0, k = y * W; x < W; x++, k++) if (!bg[k]) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const sh = (k) => !bg[k] && SL[k] < rL - 0.012 && SL[k] > Math.max(0.3, rL - 0.62) && neutral(k);
        const sc = components(W, H, sh);
        if (sc.n) {
          const notSh = new Uint8Array(N); for (let k = 0; k < N; k++) notSh[k] = sc.id[k] < 0 ? 1 : 0;
          const dIn = edt(notSh, W, H), band = 3 * Math.max(1, this.k);
          const bnd = new Float64Array(sc.n), inner = new Float64Array(sc.n), rough = new Float64Array(sc.n), cy = new Float64Array(sc.n), sl = new Float64Array(sc.n), take = new Uint8Array(sc.n);
          for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) {
            const c = sc.id[k]; if (c < 0) continue;
            cy[c] += y; sl[c] += SL[k];
            if (sc.id[k - 1] !== c || sc.id[k + 1] !== c || sc.id[k - W] !== c || sc.id[k + W] !== c) bnd[c]++;
            if (dIn[k] > band) { inner[c]++; if (G[k] > stop * 2.5) rough[c]++; }
          }
          const lowY = y0 + (y1 - y0) * 0.5;
          for (let pass = 0; pass < 4; pass++) {
            const touch = new Float64Array(sc.n);
            for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) {
              const c = sc.id[k]; if (c < 0 || take[c]) continue;
              if (bg[k - 1] || bg[k + 1] || bg[k - W] || bg[k + W]) touch[c]++;
            }
            let changed = false;
            for (let c = 0; c < sc.n; c++) {
              if (take[c] || sc.area[c] < 25) continue;
              const flat = inner[c] < 30 * this.k * this.k || rough[c] < inner[c] * 0.04;
              if (touch[c] >= Math.max(3, bnd[c] * 0.02) && flat && cy[c] / sc.area[c] > lowY) { take[c] = 1; changed = true; }
            }
            if (!changed) break;
            for (let k = 0; k < N; k++) { const c = sc.id[k]; if (c >= 0 && take[c] && !bg[k]) { bg[k] = 1; shadowPx++; } }
          }
          // pockets of the same shadow seen through the object (enclosed by legs, rails …)
          let lo = Infinity, hi = -Infinity;
          for (let c = 0; c < sc.n; c++) if (take[c] && sc.area[c] > 200) { const m = sl[c] / sc.area[c]; if (m < lo) lo = m; if (m > hi) hi = m; }
          if (lo <= hi) {
            let any = false;
            for (let c = 0; c < sc.n; c++) {
              if (take[c] || sc.area[c] < 25) continue;
              const m = sl[c] / sc.area[c], flat = inner[c] < 30 * this.k * this.k || rough[c] < inner[c] * 0.03;
              if (flat && m > lo - 0.04 && m < hi + 0.04 && cy[c] / sc.area[c] > lowY) { take[c] = 1; any = true; }
            }
            if (any) for (let k = 0; k < N; k++) { const c = sc.id[k]; if (c >= 0 && take[c] && !bg[k]) { bg[k] = 1; shadowPx++; } }
          }
          if (this.debug) this.debug.shadow = [...Array(sc.n).keys()].filter(c => sc.area[c] > 500).map(c => ({ c, area: sc.area[c], bnd: bnd[c], rough: rough[c], inner: inner[c], cy: Math.round(cy[c] / sc.area[c]), lowY: Math.round(lowY), take: take[c] }));
        }
        // penumbra rims left between shadow and backdrop
        if (shadowPx) for (let k = 0; k < N; k++) if (!bg[k] && neutral(k) && SL[k] > rL - 0.62 && SL[k] < rL + 0.02) {
          const x = k % W, y = (k / W) | 0;
          if (x > 0 && x < W - 1 && y > 0 && y < H - 1 && (bg[k - 1] + bg[k + 1] + bg[k - W] + bg[k + W]) >= 3) bg[k] = 1;
        }
      }
      // grow the background up to the edge crest (the stop leaves a 1–2 px rim)
      const m = new Uint8Array(N);
      for (let k = 0; k < N; k++) m[k] = bg[k] ? 0 : 1;
      for (let pass = 0; pass < 2; pass++) {
        const add = [];
        for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) {
          if (!m[k]) continue;
          if ((!m[k - 1] || !m[k + 1] || !m[k - W] || !m[k + W]) && de(k) < tol * 0.75) add.push(k);
        }
        for (const k of add) m[k] = 0;
      }
      return clean(m);
    });
  }
  // Blurred mask whose 0.5 iso-line is the (smooth, sub-pixel) region outline. tag → cached.
  maskField(mask, sigma, tag) {
    const make = () => { const f = new Float32Array(this.N); for (let k = 0; k < this.N; k++) f[k] = mask[k]; return blur(f, this.W, this.H, sigma); };
    return tag ? this.memo('mfield', tag + '|' + sigma, make) : make();
  }
  objTag() { return 'obj' + this.cache.mask?.key; }
  // Moves outline points onto the gradient crest along the normal (sub-pixel), when a crest is close.
  snapToCrest(pts, detail, lo) {
    const { W, H } = this, { mag } = this.gradient(detail), n = pts.length / 2, R = 2.5 * Math.max(1, this.k), q = pts.slice();
    const at = (x, y) => {
      const fx = clamp(x - 0.5, 0, W - 1.001), fy = clamp(y - 0.5, 0, H - 1.001), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, k = y0 * W + x0;
      return (mag[k] * (1 - ax) + mag[k + 1] * ax) * (1 - ay) + (mag[k + W] * (1 - ax) + mag[k + W + 1] * ax) * ay;
    };
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      let tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1]; const l = Math.hypot(tx, ty); if (l < 1e-6) continue; tx /= l; ty /= l;
      const nx = -ty, ny = tx, x = pts[2 * i], y = pts[2 * i + 1];
      let best = -1, bs = 0;
      const vals = [];
      for (let s = -R, j = 0; s <= R + 1e-6; s += 0.5, j++) { const v = at(x + nx * s, y + ny * s); vals.push(v); if (v > best) { best = v; bs = j; } }
      if (best < lo || bs === 0 || bs === vals.length - 1) continue;
      const m1 = vals[bs - 1], m0 = vals[bs], m2 = vals[bs + 1], den = m1 + m2 - 2 * m0;
      const sub = den < -1e-9 ? clamp((m1 - m2) / (2 * den), -0.5, 0.5) : 0;
      const s = -R + (bs + sub) * 0.5;
      q[2 * i] = x + nx * s; q[2 * i + 1] = y + ny * s;
    }
    return q;
  }

  // ---- photo edges → pixel chains with sub-pixel points
  edgeChains(detail, mask, strokeZone = null) {
    const t = detail / 100;
    return this.memo('edges', [Math.round(detail), this.cache.mask?.key, !!mask, !!strokeZone, this.tk].join('|'), () => {
      const { W, H, N, k: K } = this, G = this.gradient(detail), { mag } = G;
      const { cand, ex, ey } = nms(G, W, H, 0.004);
      // region of interest: object (dilated a bit) when a mask exists
      let roi = null, distB = null;
      if (mask) {
        const bd = new Uint8Array(N);
        for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) if (mask[k] && (!mask[k - 1] || !mask[k + 1] || !mask[k - W] || !mask[k + W])) bd[k] = 1;
        distB = edt(bd, W, H);
        roi = new Uint8Array(N);
        const rb = 2.2 * Math.max(1, K);
        for (let k = 0; k < N; k++) roi[k] = mask[k] && distB[k] > rb ? 1 : 0;
      }
      // adaptive thresholds
      let nRoi = 0; const vals = [];
      const all = [];
      for (let k = 0; k < N; k += 7) if (!roi || roi[k]) all.push(mag[k]);
      for (let k = 0; k < N; k++) if (cand[k] && (!roi || roi[k])) vals.push(mag[k]);
      for (let k = 0; k < N; k++) if (!roi || roi[k]) nRoi++;
      vals.sort((a, b) => b - a); all.sort((a, b) => a - b);
      const noise = all.length ? all[(all.length * 0.5) | 0] : 0.002;
      const pHi = this.tp('pHi', lerp(0.004, 0.05, t * t)) * (mask ? 1.25 : 1);
      const tP = vals.length ? vals[Math.min(vals.length - 1, Math.floor(nRoi * pHi))] : 0.05;
      const hi = Math.max(tP, noise * this.tp('nk', lerp(7, 2.6, t)), this.tp('abs', lerp(0.045, 0.009, t)));
      const lo = hi * this.tp('lr', lerp(0.46, 0.3, t));
      const edge = hysteresis(cand, mag, W, H, lo, hi, roi);
      for (let x = 0; x < W; x++) { edge[x] = 0; edge[(H - 1) * W + x] = 0; }
      for (let y = 0; y < H; y++) { edge[y * W] = 0; edge[y * W + W - 1] = 0; }
      if (strokeZone) for (let k = 0; k < N; k++) if (strokeZone[k]) edge[k] = 0;
      thin(edge, W, H);
      bridgeGaps(edge, cand, mag, ex, ey, W, H, Math.max(lo * 0.42, noise * 2), Math.round(this.tp('br', 34) * Math.max(1, K * 0.9)));
      thin(edge, W, H);
      if (this.debug) Object.assign(this.debug, { cand, edge: Uint8Array.from(edge), mag, lo, hi });
      const raw = traceChains(edge, W, H);
      const chs = [];
      for (const c of raw) {
        if (c.px.length < 2) continue;
        const p = new Array(c.px.length * 2);
        let s = 0;
        c.px.forEach((k, i) => { p[2 * i] = ex[k]; p[2 * i + 1] = ey[k]; s += mag[k]; });
        chs.push({ p, closed: c.closed, len: polyLen(p), str: s / c.px.length });
      }
      let merged = mergeChains(chs, lerp(5, 9, t) * Math.max(1, K * 0.9), 5 * Math.max(1, K * 0.8));
      // significance filter
      const minLen = this.tp('ml', lerp(42, 7, t)) * K, minLen2 = lerp(18, 4, t) * K;
      merged = merged.map(m => {
        let s = 0, n = 0;
        for (const i of m.parts) { s += chs[i].str * chs[i].len; n += chs[i].len; }
        return { p: m.p, closed: m.closed, len: polyLen(m.p), str: n ? s / n : 0 };
      }).filter(m => m.len >= minLen || (m.len >= minLen2 && m.str > hi * 2.2));
      // snap ends onto the silhouette
      if (mask) {
        const F = this.maskField(mask, 1.2 * Math.max(1, K), this.objTag()), snap = 2.2 * Math.max(1, K) + 7 * K;
        const at = (x, y) => {
          const fx = clamp(x - 0.5, 0, W - 1.001), fy = clamp(y - 0.5, 0, H - 1.001), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, k = y0 * W + x0;
          return (F[k] * (1 - ax) + F[k + 1] * ax) * (1 - ay) + (F[k + W] * (1 - ax) + F[k + W + 1] * ax) * ay;
        };
        for (const m of merged) {
          if (m.closed) continue;
          const p = m.p, n = p.length / 2;
          for (const e of [0, 1]) {
            const a = e ? n - 1 : 0, b = e ? Math.max(0, n - 6) : Math.min(n - 1, 5);
            const kx = Math.round(p[2 * a] - 0.5), ky = Math.round(p[2 * a + 1] - 0.5), kk = clamp(ky, 0, H - 1) * W + clamp(kx, 0, W - 1);
            if (distB[kk] > snap) continue;
            let tx = p[2 * a] - p[2 * b], ty = p[2 * a + 1] - p[2 * b + 1]; const l = Math.hypot(tx, ty); if (l < 1e-6) continue; tx /= l; ty /= l;
            let prev = at(p[2 * a], p[2 * a + 1]), hit = null;
            for (let s = 0.5; s <= snap * 1.4; s += 0.5) {
              const x = p[2 * a] + tx * s, y = p[2 * a + 1] + ty * s, v = at(x, y);
              if ((prev - 0.5) * (v - 0.5) <= 0) { const u = Math.abs(prev - v) > 1e-6 ? (prev - 0.5) / (prev - v) : 0; hit = [x - tx * 0.5 * (1 - u), y - ty * 0.5 * (1 - u)]; break; }
              prev = v;
            }
            if (hit) { if (e) p.push(hit[0], hit[1]); else p.unshift(hit[0], hit[1]); }
          }
        }
      }
      merged.lo = lo; merged.hi = hi;
      return merged;
    });
  }

  // ---- line art → centre lines. art = dark outline strokes of clipart (only thin parts, plus their zone)
  lineChains(detail, art = false) {
    const t = detail / 100;
    return this.memo(art ? 'strokes' : 'lines', Math.round(detail) + this.tk, () => {
      const { W, H, N, k: K } = this, { dk, otsu: ot } = this.inkMap(), { L } = this.lab();
      const tInk = clamp(ot * lerp(1.15, 0.55, t), 0.07, 0.6), maxHW = art ? 0.02 * this.D : Infinity;
      const f = new Float32Array(N);
      for (let k = 0; k < N; k++) f[k] = (art ? L[k] < 42 && dk[k] > 0.4 : dk[k] >= tInk) ? 1 : 0;
      const sm = blur(f, W, H, 0.9 * Math.max(1, K * 0.7)), ink = new Uint8Array(N);
      for (let k = 0; k < N; k++) ink[k] = sm[k] > 0.5 ? 1 : 0;
      for (let x = 0; x < W; x++) { ink[x] = 0; ink[(H - 1) * W + x] = 0; }
      for (let y = 0; y < H; y++) { ink[y * W] = 0; ink[y * W + W - 1] = 0; }
      const minA = lerp(60, 6, t) * K * K;
      const ic = components(W, H, k => ink[k] === 1);
      for (let k = 0; k < N; k++) if (ink[k] && ic.area[ic.id[k]] < minA) ink[k] = 0;
      const hc = components(W, H, k => ink[k] === 0);
      for (let k = 0; k < N; k++) if (!ink[k] && !hc.touch[hc.id[k]] && hc.area[hc.id[k]] < 10 * K * K) ink[k] = 1;
      const notInk = new Uint8Array(N); for (let k = 0; k < N; k++) notInk[k] = ink[k] ? 0 : 1;
      const dist = edt(notInk, W, H);
      const sk = Uint8Array.from(ink);
      thin(sk, W, H);
      let raw = traceChains(sk, W, H);
      // prune short spurs (free end → junction) shorter than ~ the local stroke width
      let pruned = false;
      for (const c of raw) {
        if (c.closed || c.j0 === c.j1) continue;
        const hw = dist[c.px[c.j0 ? 0 : c.px.length - 1]];
        if (c.px.length >= Math.max(3 * K, 1.6 * hw + 1)) continue;
        const from = c.j0 ? 1 : 0, to = c.j0 ? c.px.length : c.px.length - 1;
        for (let i = from; i < to; i++) sk[c.px[i]] = 0;
        pruned = true;
      }
      if (pruned) { thin(sk, W, H); raw = traceChains(sk, W, H); }
      let zone = null;
      if (art) {
        // keep only thin, line-like runs; their area (± a rim) becomes the zone where region edges are muted
        const runs = [];
        for (const c of raw) {
          let cur = [];
          const flush = () => {
            if (cur.length > 1) { let s = 0; for (const k of cur) s += dist[k]; const wd = 2 * s / cur.length; if (cur.length >= Math.max(8 * K, 2.5 * wd)) runs.push({ px: cur, closed: false }); }
            cur = [];
          };
          for (const k of c.px) { if (dist[k] <= maxHW) cur.push(k); else flush(); }
          if (cur.length === c.px.length && c.closed) { runs.push({ px: cur, closed: true }); cur = []; } else flush();
        }
        raw = runs;
        zone = new Uint8Array(N);
        for (const c of raw) for (const k of c.px) {
          const r = dist[k] + 2.5 * Math.max(1, K * 0.8), r2 = r * r, R = Math.ceil(r), x0 = k % W, y0 = (k / W) | 0;
          for (let j = -R; j <= R; j++) { const y = y0 + j; if (y < 0 || y >= H) continue; for (let i = -R; i <= R; i++) { const x = x0 + i; if (x >= 0 && x < W && i * i + j * j <= r2) zone[y * W + x] = 1; } }
        }
      }
      const chs = [];
      for (const c of raw) {
        if (c.px.length < 2) continue;
        const p = new Array(c.px.length * 2); let s = 0;
        c.px.forEach((k, i) => { p[2 * i] = (k % W) + 0.5; p[2 * i + 1] = ((k / W) | 0) + 0.5; s += dist[k]; });
        chs.push({ p, closed: c.closed, len: polyLen(p), wd: 2 * s / c.px.length });
      }
      // ridge-centre refinement: move points to the darkness centroid across the stroke
      const at = (x, y) => {
        const fx = clamp(x - 0.5, 0, W - 1.001), fy = clamp(y - 0.5, 0, H - 1.001), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, k = y0 * W + x0;
        return (dk[k] * (1 - ax) + dk[k + 1] * ax) * (1 - ay) + (dk[k + W] * (1 - ax) + dk[k + W + 1] * ax) * ay;
      };
      for (const c of chs) {
        const p = c.p, n = p.length / 2, R = Math.max(1.5, c.wd * 0.65 + 1), q = p.slice();
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
          let tx = p[2 * b] - p[2 * a], ty = p[2 * b + 1] - p[2 * a + 1]; const l = Math.hypot(tx, ty); if (l < 1e-6) continue; tx /= l; ty /= l;
          const nx = -ty, ny = tx, x = p[2 * i], y = p[2 * i + 1], v0 = at(x, y);
          if (v0 < 0.05) continue;
          let sw = v0 * v0, ss = 0;
          for (const dir of [1, -1]) for (let s = 0.5; s <= R + 1e-6; s += 0.5) {
            const v = at(x + nx * s * dir, y + ny * s * dir);
            if (v < v0 * 0.25) break;
            sw += v * v; ss += v * v * s * dir;
          }
          const off = clamp(ss / sw, -R * 0.6, R * 0.6);
          q[2 * i] = x + nx * off; q[2 * i + 1] = y + ny * off;
        }
        c.p = q;
      }
      let merged = mergeChains(chs, lerp(4, 8, t) * Math.max(1, K * 0.9), 5 * Math.max(1, K * 0.8));
      const minLen = lerp(26, 4, t) * K;
      merged = merged.map(m => {
        let s = 0, n = 0; for (const i of m.parts) { s += chs[i].wd * chs[i].len; n += chs[i].len; }
        return { p: m.p, closed: m.closed, len: polyLen(m.p), wd: n ? s / n : 2 };
      }).filter(m => m.len >= minLen);
      return { chains: merged, ink, zone };
    });
  }

  // ---- colour fills (stacked layers, bottom first)
  fillLayers(region, colors, detail, smoothO) {
    const { W, H, N, k: K } = this, S = this.smoothed(detail), [SL, SA, SB] = S, t = detail / 100;
    const idx = [];
    for (let k = 0; k < N; k++) if (!region || region[k]) idx.push(k);
    if (idx.length < 50) return [];
    // k-means++ in Lab on a sample
    const nS = Math.min(idx.length, 24000), samp = new Int32Array(nS);
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < nS; i++) samp[i] = idx[(rnd() * idx.length) | 0];
    const kC = Math.min(colors, nS), cen = [];
    cen.push([SL[samp[0]], SA[samp[0]], SB[samp[0]]]);
    const dmin = new Float64Array(nS).fill(Infinity);
    while (cen.length < kC) {
      const c = cen[cen.length - 1]; let sum = 0;
      for (let i = 0; i < nS; i++) { const k = samp[i], d = (SL[k] - c[0]) ** 2 + (SA[k] - c[1]) ** 2 + (SB[k] - c[2]) ** 2; if (d < dmin[i]) dmin[i] = d; sum += dmin[i]; }
      let r = rnd() * sum, pick = 0;
      for (let i = 0; i < nS; i++) { r -= dmin[i]; if (r <= 0) { pick = i; break; } }
      cen.push([SL[samp[pick]], SA[samp[pick]], SB[samp[pick]]]);
    }
    const asg = new Uint8Array(nS);
    for (let it = 0; it < 14; it++) {
      const acc = cen.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < nS; i++) {
        const k = samp[i]; let best = 0, bd = Infinity;
        for (let j = 0; j < cen.length; j++) { const c = cen[j], d = (SL[k] - c[0]) ** 2 + (SA[k] - c[1]) ** 2 + (SB[k] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } }
        asg[i] = best; const a = acc[best]; a[0] += SL[k]; a[1] += SA[k]; a[2] += SB[k]; a[3]++;
      }
      cen.forEach((c, j) => { const a = acc[j]; if (a[3]) { c[0] = a[0] / a[3]; c[1] = a[1] / a[3]; c[2] = a[2] / a[3]; } });
    }
    const lbl = new Uint8Array(N).fill(255);
    for (const k of idx) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < cen.length; j++) { const c = cen[j], d = (SL[k] - c[0]) ** 2 + (SA[k] - c[1]) ** 2 + (SB[k] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } }
      lbl[k] = best;
    }
    // majority filter ×2
    const cnt = new Uint16Array(256);
    for (let pass = 0; pass < 2; pass++) {
      const src = Uint8Array.from(lbl);
      for (let y = 1; y < H - 1; y++) for (let x = 1, k = y * W + 1; x < W - 1; x++, k++) {
        if (src[k] === 255) continue;
        let best = src[k], bc = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = src[k + j * W + i]; if (v !== 255) { const c = ++cnt[v]; if (c > bc) { bc = c; best = v; } } }
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) cnt[src[k + j * W + i]] = 0;
        if (bc >= 5) lbl[k] = best;
      }
    }
    // merge small regions into their dominant neighbour
    const minA = lerp(0.0025, 0.00012, t) * idx.length + 6 * K * K;
    for (let pass = 0; pass < 3; pass++) {
      const comp = new Int32Array(N).fill(-1), area = [], st = new Int32Array(N); let n = 0;
      for (let s = 0; s < N; s++) {
        if (comp[s] >= 0 || lbl[s] === 255) continue;
        const L0 = lbl[s]; let sp = 0, a = 0; st[sp++] = s; comp[s] = n;
        while (sp) {
          const k = st[--sp], x = k % W, y = (k / W) | 0; a++;
          if (x > 0 && comp[k - 1] < 0 && lbl[k - 1] === L0) { comp[k - 1] = n; st[sp++] = k - 1; }
          if (x < W - 1 && comp[k + 1] < 0 && lbl[k + 1] === L0) { comp[k + 1] = n; st[sp++] = k + 1; }
          if (y > 0 && comp[k - W] < 0 && lbl[k - W] === L0) { comp[k - W] = n; st[sp++] = k - W; }
          if (y < H - 1 && comp[k + W] < 0 && lbl[k + W] === L0) { comp[k + W] = n; st[sp++] = k + W; }
        }
        area.push(a); n++;
      }
      const small = area.map(a => a < minA);
      if (!small.some(Boolean)) break;
      const votes = new Map();
      for (let y = 0; y < H; y++) for (let x = 0, k = y * W; x < W; x++, k++) {
        const c = comp[k]; if (c < 0 || !small[c]) continue;
        for (const q of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1]) {
          if (q < 0 || lbl[q] === 255 || comp[q] === c) continue;
          let m = votes.get(c); if (!m) votes.set(c, m = new Map());
          const w2 = small[comp[q]] ? 0.2 : 1;
          m.set(lbl[q], (m.get(lbl[q]) || 0) + w2);
        }
      }
      const to = new Int16Array(n).fill(-1);
      for (const [c, m] of votes) { let best = -1, bv = 0; for (const [l, v] of m) if (v > bv) { bv = v; best = l; } to[c] = best; }
      for (let k = 0; k < N; k++) { const c = comp[k]; if (c >= 0 && small[c] && to[c] >= 0) lbl[k] = to[c]; }
    }
    // colours (mean original sRGB) + order by area (largest first = bottom)
    const acc = cen.map(() => [0, 0, 0, 0]), rgba = this.rgba;
    for (const k of idx) {
      const l = lbl[k]; if (l === 255) continue;
      const a = acc[l], j = k * 4, al = rgba[j + 3] / 255;
      a[0] += rgba[j] * al + 255 * (1 - al); a[1] += rgba[j + 1] * al + 255 * (1 - al); a[2] += rgba[j + 2] * al + 255 * (1 - al); a[3]++;
    }
    const order = acc.map((a, i) => [i, a[3]]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const rank = new Int16Array(256).fill(-1); order.forEach((l, r) => (rank[l] = r));
    const layers = [], sig = Math.max(0.8, 0.9 * K * 0.8), f = new Float32Array(N), minLoop = 6 * K;
    const fo = { ...smoothO, sigma: smoothO.sigma * 0.8 };
    for (let r = 0; r < order.length; r++) {
      for (let k = 0; k < N; k++) f[k] = lbl[k] !== 255 && rank[lbl[k]] >= r ? 1 : 0;
      const F = blur(f, W, H, sig), loops = contours(F, W, H, 0.5, minLoop);
      const subs = [];
      for (const lp of loops) { if (Math.abs(polyArea(lp)) < 9 * K * K) continue; const ft = fitPolyline(lp, true, fo); if (ft) subs.push(ft); }
      const a = acc[order[r]];
      if (subs.length) layers.push({ color: '#' + hex2(a[0] / a[3]) + hex2(a[1] / a[3]) + hex2(a[2] / a[3]), subs });
    }
    return layers;
  }

  run(opts = {}, progress = () => {}) {
    const o = { ...DEFAULTS, ...opts }, t0 = Date.now(), K = this.k;
    this.tune = o.tune || {}; this.tk = JSON.stringify(this.tune); this.prof = {}; this.bgHint = o.bgHint || null;
    progress('analyze', 0.05);
    const an = this.analyze();
    const mode = o.mode === 'auto' ? (an.lineart ? 'lineart' : 'photo') : o.mode;
    const sm = clamp(o.smooth, 0, 100) / 100, detail = clamp(o.detail, 0, 100);
    const fit = { sigma: lerp(0.45, 2.1, sm) * Math.max(1, K * 0.85), eps: lerp(0.28, 1.45, sm) * Math.max(1, K * 0.85), cornerK: Math.round(lerp(3, 6, sm) * Math.max(1, K * 0.85)), cornerThr: 1 - Math.cos(lerp(38, 78, sm) * Math.PI / 180) };
    progress('mask', 0.15);
    const mask = mode === 'photo' ? this.objectMask(o.bg, detail, o.shadows !== false) : null;
    const res = { w: this.W, h: this.H, mode, auto: an.lineart ? 'lineart' : an.art ? 'art' : 'photo', object: !!mask, lines: [], fills: [], box: null };
    if (mask && !this.lab().alphaMask && this.bgInfo) res.bgInfo = this.bgInfo;
    if (mask) {
      let x0 = this.W, y0 = this.H, x1 = -1, y1 = -1;
      for (let y = 0; y < this.H; y++) for (let x = 0, k = y * this.W; x < this.W; x++, k++) if (mask[k]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= x0) res.box = [x0, y0, x1 + 1, y1 + 1];
    }
    progress('edges', 0.3);
    let chains = [], ink = null, zone = null;
    if (mode === 'lineart') { const r = this.lineChains(detail); chains = r.chains; ink = r.ink; }
    else {
      const st = an.art ? this.lineChains(detail, true) : null;
      zone = st?.chains.length ? st.zone : null;
      chains = this.edgeChains(detail, mask, zone);
      if (zone) chains = chains.concat(st.chains);
    }
    progress('fit', 0.6);
    for (const c of chains) {
      const f = fitPolyline(c.p, c.closed, fit);
      if (f) res.lines.push({ ...f, kind: 'i', wd: c.wd });
    }
    if (mask && o.outline && mode === 'photo') {
      const F = this.maskField(mask, 1.2 * Math.max(1, K), this.objTag());
      const loops = contours(F, this.W, this.H, 0.5, 14 * K);
      const fo = { ...fit, sigma: fit.sigma * 1.1 }, lo = (this.cache.edges?.val?.lo || 0.02) * 1.5;
      const zd = zone ? this.memo('zdist', this.cache.strokes?.key, () => edt(zone, this.W, this.H)) : null, W = this.W;
      for (let lp of loops) {
        if (Math.abs(polyArea(lp)) < 40 * K * K) continue;
        lp = resample(lp, true, 1);
        if (!this.lab().alphaMask && !zone) lp = this.snapToCrest(lp, detail, lo);
        if (zd) {
          // the outline already is a drawn stroke there → keep only the uncovered runs
          const n = lp.length / 2, keep = new Uint8Array(n);
          for (let i = 0; i < n; i++) { const x = clamp(Math.round(lp[2 * i] - 0.5), 0, W - 1), y = clamp(Math.round(lp[2 * i + 1] - 0.5), 0, this.H - 1); keep[i] = zd[y * W + x] > 1.5 * Math.max(1, K) ? 1 : 0; }
          if (!keep.every(Boolean)) {
            let s0 = keep.indexOf(0);
            for (let j = 1; j <= n; j++) {
              const i = (s0 + j) % n;
              if (!keep[i]) continue;
              const run = [];
              let q = i; while (keep[q] && run.length < 2 * n) { run.push(lp[2 * q], lp[2 * q + 1]); q = (q + 1) % n; j++; }
              if (polyLen(run) >= 12 * K) { const f = fitPolyline(run, false, fo); if (f) res.lines.unshift({ ...f, kind: 'o' }); }
            }
            continue;
          }
        }
        const f = fitPolyline(lp, true, fo); if (f) res.lines.unshift({ ...f, kind: 'o' });
      }
    }
    progress('fill', 0.75);
    if (o.fill !== 'none') {
      let region = mask;
      if (!region) {
        // object = everything the lines enclose (flood the outside from the border)
        const { W, H, N } = this, wall = new Uint8Array(N);
        if (ink) wall.set(ink);
        else for (const c of chains) for (let i = 0; i < c.p.length; i += 2) { const x = c.p[i] | 0, y = c.p[i + 1] | 0; if (x >= 0 && y >= 0 && x < W && y < H) wall[y * W + x] = 1; }
        const dil = new Uint8Array(N), R = Math.max(1, Math.round(1.5 * K));
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wall[y * W + x]) for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < W && yy < H) dil[yy * W + xx] = 1; }
        const out = components(W, H, k => !dil[k]);
        const m = new Uint8Array(N); let cnt = 0;
        for (let k = 0; k < N; k++) { m[k] = dil[k] || !out.touch[out.id[k]] ? 1 : 0; cnt += m[k]; }
        region = cnt > N * 0.02 && cnt < N * 0.97 ? m : null;
      }
      if (o.fill === 'solid') {
        const F = region ? this.maskField(region, 1.1 * Math.max(1, K), region === mask ? this.objTag() : null) : null;
        const loops = F ? contours(F, this.W, this.H, 0.5, 10 * K) : [[0, 0, this.W, 0, this.W, this.H, 0, this.H]];
        const subs = [];
        for (const lp of loops) { if (Math.abs(polyArea(lp)) < 30 * K * K) continue; const f = fitPolyline(lp, true, { ...fit, cornerThr: F ? fit.cornerThr : 0.2 }); if (f) subs.push(f); }
        if (subs.length) res.fills.push({ color: null, subs });
      } else {
        res.fills = this.fillLayers(region, clamp(o.colors | 0, 2, 32), detail, fit);
      }
    }
    let segs = 0; for (const l of res.lines) segs += (l.seg.length - 2) / 6;
    res.stats = { ms: Date.now() - t0, lines: res.lines.length, segs, fills: res.fills.length, an, prof: this.prof };
    progress('done', 1);
    return res;
  }
}

// ---------------------------------------------------------------- output
const fmt = (v) => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? '0' : String(r); };
// Compact relative path data with rounding that never drifts.
export function pathData(seg, closed, sx = 1, sy = sx, ox = 0, oy = 0) {
  let cx = Math.round((seg[0] * sx + ox) * 10) / 10, cy = Math.round((seg[1] * sy + oy) * 10) / 10;
  let d = 'M' + fmt(cx) + ' ' + fmt(cy);
  const n = (seg.length - 2) / 6;
  if (n) d += 'c';
  for (let i = 0; i < n; i++) {
    const b = 2 + i * 6, q = [];
    for (let j = 0; j < 3; j++) q.push(Math.round((seg[b + 2 * j] * sx + ox) * 10) / 10, Math.round((seg[b + 2 * j + 1] * sy + oy) * 10) / 10);
    const parts = [q[0] - cx, q[1] - cy, q[2] - cx, q[3] - cy, q[4] - cx, q[5] - cy].map(fmt);
    let s = '';
    for (const p of parts) s += (s && !p.startsWith('-') ? ' ' : '') + p;
    d += (i ? (parts[0].startsWith('-') ? '' : ' ') : '') + s;
    cx = q[4]; cy = q[5];
  }
  return d + (closed ? 'z' : '');
}
// style: { lineColor, lineWidth (px per 1000 px of the long side), outlineBoost, outline, lines, fill, fillColor, keepWidth, fit }
// fit: true → width/height 100% + preserveAspectRatio none (for scalable embedding).
export function toSVG(res, st = {}) {
  const s = { lineColor: '#1d1d22', lineWidth: 2, outlineBoost: 1.35, outline: true, lines: true, fill: 'none', fillColor: '#e9e2d6', keepWidth: false, fit: false, ...st };
  const u = Math.max(res.w, res.h) / 1000, lw = Math.max(0.1, s.lineWidth * u);
  let body = '';
  if (s.fill !== 'none' && res.fills.length) {
    body += '<g data-tr="fill" stroke="none" fill-rule="evenodd">';
    for (const f of res.fills) body += `<path fill="${f.color || s.fillColor}" d="${f.subs.map(x => pathData(x.seg, true)).join('')}"/>`;
    body += '</g>';
  }
  if (s.lines) {
    const outer = s.outline ? res.lines.filter(l => l.kind === 'o') : [], inner = res.lines.filter(l => l.kind !== 'o');
    const attrs = `fill="none" stroke="${s.lineColor}" stroke-linecap="round" stroke-linejoin="round"`;
    if (s.keepWidth && res.mode === 'lineart') {
      const groups = new Map();
      for (const l of inner) { const w = Math.max(0.6, Math.round((l.wd || 2) * 2) / 2); const g = groups.get(w) || []; g.push(l); groups.set(w, g); }
      for (const [w, ls] of [...groups].sort((a, b) => a[0] - b[0])) body += `<path data-tr="line" ${attrs} stroke-width="${fmt(w * s.lineWidth / 2)}" d="${ls.map(l => pathData(l.seg, l.closed)).join('')}"/>`;
    } else if (inner.length) body += `<path data-tr="line" ${attrs} stroke-width="${fmt(lw)}" d="${inner.map(l => pathData(l.seg, l.closed)).join('')}"/>`;
    if (outer.length) body += `<path data-tr="outline" ${attrs} stroke-width="${fmt(lw * s.outlineBoost)}" d="${outer.map(l => pathData(l.seg, l.closed)).join('')}"/>`;
  }
  const size = s.fit ? 'width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible"' : `width="${res.w}" height="${res.h}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${res.w} ${res.h}" ${size}>${body}</svg>`;
}
