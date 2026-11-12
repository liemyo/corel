// Trace Otomatis for Amatu Draw: uploaded or selected bitmap → smooth vector curves (lines + optional colour fills).
// Engine + panel: js/trace/. Every traced line becomes an editable curve (smooth/cusp nodes) inside one group.
import { App } from '../app.js';
import { mk } from '../model.js';
import { T, S, mul, ap } from '../geom.js';
import { h, toast } from '../util.js';
import { check } from './widgets.js';
import { modal } from './dialogs.js';
import { tracePanel } from '../trace/trace-ui.js';

const readURL = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });

// obj: bitmap object to trace (optional). pick: open the file picker right away.
export async function openAutoTrace({ obj = null, pick = false } = {}) {
  if (!App.doc || App.startOn) App.newDocument();
  if (obj && obj.type !== 'img') obj = null;
  let source = null, name = '';
  if (obj) {
    try { source = await (await fetch(App.assetURL(obj.asset))).blob(); name = obj.name || 'bitmap'; }
    catch { toast('Bitmap ini tidak dapat dibaca', 'err'); return; }
  }
  const panel = tracePanel({ source, name });
  const st = { keep: false, withImg: false };
  const extra = obj ? check('Pertahankan bitmap asli di bawah hasil trace', () => st.keep, v => { st.keep = v; })
    : check('Sertakan gambar asli di bawah garis', () => st.withImg, v => { st.withImg = v; });
  if (pick && !obj) panel.pick();
  modal({
    title: 'Trace Otomatis — gambar jadi garis vektor', cls: 'mtrace', width: Math.min(1180, innerWidth - 24),
    body: h('div', { style: { display: 'grid', gap: '10px' } }, panel.el, extra),
    buttons: [['Batal', 'cancel'], ['Sisipkan ke dokumen', () => insert(panel, obj, st), 'btn-primary']],
    onClose: () => panel.destroy(),
  });
}

// Engine cubic chain [x0,y0, c1x,c1y,c2x,c2y,x,y …] → Amatu Draw sub-path with nodes (world coords via M).
function subOf(seg, closed, cusp, M) {
  const P = (i) => ap(M, seg[i], seg[i + 1]), n = [], ns = (seg.length - 2) / 6;
  const [x0, y0] = P(0);
  n.push({ x: x0, y: y0, ix: x0, iy: y0, ox: x0, oy: y0, t: 0 });
  for (let s = 0; s < ns; s++) {
    const b = 2 + s * 6, [c1x, c1y] = P(b), [c2x, c2y] = P(b + 2), [x, y] = P(b + 4), last = n[n.length - 1];
    last.ox = c1x; last.oy = c1y;
    n.push({ x, y, ix: c2x, iy: c2y, ox: x, oy: y, t: cusp?.[s] ? 0 : 1 });
  }
  if (closed && n.length > 2) { const f = n[0], l = n.pop(); f.ix = l.ix; f.iy = l.iy; f.t = l.t; }
  else { n[0].t = 0; n[n.length - 1].t = 0; }
  return { c: !!closed, n };
}

async function insert(panel, obj, opt) {
  const r = panel.result;
  if (!r) { toast(panel.busy ? 'Tunggu sebentar, trace masih diproses…' : 'Unggah gambar terlebih dahulu', 'warn'); return false; }
  const st = panel.style(), [cx, cy, cw, ch] = r.crop, page = App.page;
  let M;
  if (obj) M = mul(obj.tf, mul(T(cx * obj.w, cy * obj.h), S(cw * obj.w / r.w, ch * obj.h / r.h)));
  else {
    const ar = r.w / r.h;
    let w = page.w * 0.72, hh = w / ar;
    if (hh > page.h * 0.72) { hh = page.h * 0.72; w = hh * ar; }
    M = mul(T((page.w - w) / 2, (page.h - hh) / 2), S(w / r.w, hh / r.h));
  }
  const k = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])), lw = +(st.lineWidth * Math.max(r.w, r.h) / 1000 * k).toFixed(3);
  const line = (l, w, nm) => mk('curve', { p: { sp: [subOf(l.seg, l.closed, l.cusp, M)] }, fill: null, ol: { w, c: st.lineColor, cap: 'round', join: 'round' }, name: nm });
  const kids = [];
  if (st.fill !== 'none' && r.fills.length) {
    const fills = r.fills.map((f, i) => mk('curve', { p: { sp: f.subs.map(sb => subOf(sb.seg, true, sb.cusp, M)) }, fill: { t: 'solid', c: f.color || st.fillColor }, ol: null, name: r.fills.length > 1 ? 'Isian ' + (i + 1) : 'Isian' }));
    kids.push(fills.length > 1 ? mk('g', { ch: fills, name: 'Isian warna' }) : fills[0]);
  }
  const inner = r.lines.filter(l => l.kind !== 'o').map(l => line(l, lw, 'Garis'));
  const outer = r.lines.filter(l => l.kind === 'o').map(l => line(l, +(lw * st.outlineBoost).toFixed(3), 'Garis luar'));
  if (inner.length) kids.push(inner.length > 1 ? mk('g', { ch: inner, name: 'Garis detail' }) : inner[0]);
  if (outer.length) kids.push(outer.length > 1 ? mk('g', { ch: outer, name: 'Garis luar' }) : outer[0]);
  if (!kids.length) { toast('Tidak ada garis yang terdeteksi — naikkan Detail garis', 'warn'); return false; }
  const g = mk('g', { ch: kids, name: 'Trace otomatis' });
  if (obj) {
    const w = App.where(obj), i = w ? w.list.indexOf(obj) : -1;
    if (i >= 0) { w.list.splice(i + 1, 0, g); if (!opt.keep && !obj.lock) w.list.splice(i, 1); App.dirtyIndex(); App.sel = [g]; App.commit('Trace otomatis'); }
    else App.add(g, 'Trace otomatis');
  } else {
    const add = [];
    if (opt.withImg && panel.source) {
      // whole source image, positioned so the traced part lines up with the curves
      const src = r.src, kx = r.w / (cw * src.w), ky = r.h / (ch * src.h);
      const id = App.addAsset(await readURL(panel.source));
      add.push(mk('img', { asset: id, w: src.w, h: src.h, px: [src.w, src.h], tf: mul(M, mul(S(kx, ky), T(-cx * src.w, -cy * src.h))), name: 'Gambar asli' }));
    }
    add.push(g);
    App.add(add, 'Trace otomatis');
    App.sel = [g]; App.render?.(); App.emit?.('sel');
  }
  toast(`Trace selesai: ${r.lines.length} kurva garis${r.fills.length && st.fill !== 'none' ? ' + ' + r.fills.length + ' isian' : ''}`);
  return true;
}
