// Context-sensitive property bar (changes with the active tool and the selection, like CorelDRAW).
import { App } from '../app.js';
import { V } from '../view.js';
import { run, C } from '../commands.js';
import { applyM, PAGE_SIZES } from '../model.js';
import { selBox, objBox, geom } from '../objgeom.js';
import { T, S, R, decompose, bbox } from '../geom.js';
import { PS, PS_GROUPS } from '../shapes.js';
import { FONTS, loadFace } from '../fonts.js';
import { ARROWS, DASHES, fillColor } from '../fills.js';
import { icon } from '../icons.js';
import { h, fmtU, UNIT_LABEL, deep, clamp, toast } from '../util.js';
import { ib, sep, lbl, num, sel, seg, tog, check, slider, colorBtn, textField, popup, popover, ddButton } from './widgets.js';
import { NodeOps, BT, KT, ET, Crop } from '../tools/shape.js';
import { TO, MEDIA } from '../tools/draw.js';
import { FX, ENV_PRESETS, applyEnvPreset } from '../tools/fx.js';
import { TextDef, Text } from '../tools/text.js';
import { XForm } from '../tools/pick.js';

const S1 = () => App.sel.length === 1 ? App.sel[0] : null;
const all = fn => App.sel.forEach(fn);
const live = () => { App.render(); };
const fin = (label, final) => { if (final) App.commit(label); else live(); };
const u = () => App.doc?.units || 'mm';
App.settings.lockRatio ??= true;

// Applies a change to every selected object (and nested group members when deep)
function setAll(fn, label, final = true, deepGroups = false) {
  const visit = o => { if (deepGroups && o.type === 'g') o.ch.forEach(visit); else fn(o); };
  App.sel.forEach(visit); fin(label, final);
}

// ---------- shared blocks ----------
function posSize() {
  const box = () => selBox(App.sel);
  const yv = y => App.settings.yUp ? App.page.h - y : y;
  const X = num({ label: 'X', get: () => { const b = box(); return b && b.x + b.w / 2; }, set: (v, f) => { const b = box(); if (!b) return; all(o => applyM(o, T(v - b.x - b.w / 2, 0))); fin('Posisi', f); }, w: 62, title: 'Posisi horizontal (tengah objek)' });
  const Y = num({ label: 'Y', get: () => { const b = box(); return b && yv(b.y + b.h / 2); }, set: (v, f) => { const b = box(); if (!b) return; all(o => applyM(o, T(0, yv(v) - b.y - b.h / 2))); fin('Posisi', f); }, w: 62, title: 'Posisi vertikal (tengah objek)' });
  const scaleTo = (w, hh, f) => { const b = box(); if (!b) return; const sx = b.w ? w / b.w : 1, sy = b.h ? hh / b.h : 1; all(o => applyM(o, S(sx, sy, b.x + b.w / 2, b.y + b.h / 2))); fin('Ukuran', f); };
  const W = num({ label: 'L', get: () => box()?.w, set: (v, f) => { const b = box(); if (!b || v <= 0) return; scaleTo(v, App.settings.lockRatio ? b.h * v / (b.w || 1) : b.h, f); }, min: .001, w: 62, title: 'Lebar' });
  const H = num({ label: 'T', get: () => box()?.h, set: (v, f) => { const b = box(); if (!b || v <= 0) return; scaleTo(App.settings.lockRatio ? b.w * v / (b.h || 1) : b.w, v, f); }, min: .001, w: 62, title: 'Tinggi' });
  const lock = tog('link', 'Kunci rasio', () => App.settings.lockRatio, v => App.set('lockRatio', v));
  const dec = () => { const o = S1(); return o?.tf ? decompose(o.tf) : null; };
  const SX = num({ unit: 'pct', get: () => { const d = dec(); return d ? Math.abs(d.sx) * 100 : 100; }, set: (v, f) => { const b = box(); const d = dec(); if (!b) return; const k = v / ((d ? Math.abs(d.sx) : 1) * 100); all(o => applyM(o, S(k, App.settings.lockRatio ? k : 1, b.x + b.w / 2, b.y + b.h / 2))); fin('Skala', f); }, w: 44, suffix: '%', title: 'Skala horizontal', dec: 1 });
  const SY = num({ unit: 'pct', get: () => { const d = dec(); return d ? Math.abs(d.sy) * 100 : 100; }, set: (v, f) => { const b = box(); const d = dec(); if (!b) return; const k = v / ((d ? Math.abs(d.sy) : 1) * 100); all(o => applyM(o, S(App.settings.lockRatio ? k : 1, k, b.x + b.w / 2, b.y + b.h / 2))); fin('Skala', f); }, w: 44, suffix: '%', title: 'Skala vertikal', dec: 1 });
  const ROT = num({ icon: 'rotl', unit: 'deg', get: () => { const d = dec(); return d ? ((-d.rot % 360) + 360) % 360 : 0; }, set: (v, f) => { const b = box(); if (!b) return; const d = dec(), cur = d ? -d.rot : 0; all(o => applyM(o, R(-(v - cur), b.x + b.w / 2, b.y + b.h / 2))); fin('Putar', f); }, w: 46, suffix: '°', title: 'Sudut rotasi' });
  return [h('div', { class: 'pgrp xy' }, X, Y), h('div', { class: 'pgrp xy' }, W, H), lock, h('div', { class: 'pgrp xy' }, SX, SY), ROT,
    ib('mirrorh', 'Cermin horizontal', () => run('mirrorH')), ib('mirrorv', 'Cermin vertikal', () => run('mirrorV')), sep()];
}
function outlineQuick() {
  const o = () => App.sel.find(x => x.ol !== undefined);
  const w = num({ icon: 'outline', unit: 'mmw', get: () => o()?.ol?.w ?? 0, set: (v, f) => setAll(x => { if (v <= 0) x.ol = null; else x.ol = { ...(x.ol || { c: '#000000' }), w: v }; }, 'Lebar kerangka', f, true), min: 0, w: 52, dec: 3, step: .05, suffix: 'mm', title: 'Lebar kerangka' });
  const dd = h('button', { class: 'dd-trigger mini', html: icon('chevd', 12), title: 'Lebar kerangka cepat' });
  dd.onclick = e => { e.stopPropagation(); const r = dd.getBoundingClientRect(); popup([['Tidak ada', 0], ['Garis rambut', .076], ['0,1 mm', .1], ['0,2 mm', .2], ['0,25 mm', .25], ['0,35 mm', .35], ['0,5 mm', .5], ['0,75 mm', .75], ['1 mm', 1], ['1,5 mm', 1.5], ['2 mm', 2], ['3 mm', 3], ['5 mm', 5], ['8 mm', 8]].map(([l, v]) => ({ l, run: () => { setAll(x => { x.ol = v ? { ...(x.ol || { c: '#000000' }), w: v } : null; }, 'Lebar kerangka', true, true); w.refresh(); } })), r.left - 60, r.bottom + 4); };
  return [h('div', { class: 'pgrp' }, w, dd)];
}
function lineStyle() {
  const o = () => App.sel.find(x => x.ol);
  const dash = ddButton('', () => DASHES.map((d, i) => ({ l: d ? d.join('-') : 'Garis utuh', run: () => setAll(x => { if (x.ol) x.ol.d = d ? [...d] : null; }, 'Gaya garis', true, true) })), { icon: 'minus', title: 'Gaya garis' });
  const arrow = side => ddButton('', () => [{ l: 'Tidak ada', run: () => setAll(x => { if (x.ol) x.ol[side] = null; }, 'Panah', true, true) }, ...Object.entries(ARROWS).map(([k, a]) => ({ l: a.n, run: () => setAll(x => { x.ol = x.ol || { w: .3, c: '#000' }; x.ol[side] = k; }, 'Panah', true, true) }))], { icon: side === 'as' ? 'chevl' : 'chevr', title: side === 'as' ? 'Ujung panah awal' : 'Ujung panah akhir' });
  void o;
  return [arrow('as'), dash, arrow('ae')];
}
const groupBtns = () => [ib('group', 'Kelompokkan', () => run('group'), { key: 'Mod+G' }), ib('ungroup', 'Pisahkan kelompok', () => run('ungroup'), { key: 'Mod+U' }), ib('ungroupall', 'Pisahkan semua kelompok', () => run('ungroupAll'))];
const shapingBtns = () => ['weld', 'trim', 'intersect', 'simplify', 'fmb', 'bmf', 'boundary'].map(id => ib(C[id].i, C[id].l, () => run(id)));
const orderBtns = () => [ib('tofront', 'Ke depan', () => run('toFront'), { key: 'Shift+PgUp' }), ib('toback', 'Ke belakang', () => run('toBack'), { key: 'Shift+PgDn' })];
const alignBtn = () => ib('aleft', 'Rata dan distribusi', () => run('alignDock'));
const curvesBtn = () => ib('tocurves', 'Konversi ke kurva', () => run('toCurves'), { key: 'Mod+Q' });

function fontBlock(get, set) {
  const fam = sel({ options: () => { const cats = {}; FONTS.forEach(f => (cats[f.cat] ||= []).push([f.name, f.name])); return Object.entries(cats).flatMap(([c, l]) => ['-', ...l]).slice(1); }, get: () => get().font, set: v => { set({ font: v }); loadFace(v, get().wt, get().it); }, w: 150, title: 'Jenis huruf', cls: 'fontsel' });
  const size = num({ unit: 'num', get: () => get().sz, set: (v, f) => set({ sz: v }, f), min: 1, max: 3000, w: 44, dec: 1, title: 'Ukuran huruf (pt)', suffix: 'pt' });
  const sizes = h('button', { class: 'dd-trigger mini', html: icon('chevd', 12) });
  sizes.onclick = e => { e.stopPropagation(); const r = sizes.getBoundingClientRect(); popup([6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 120, 144, 200].map(v => ({ l: v + ' pt', run: () => { set({ sz: v }); size.refresh(); } })), r.left - 50, r.bottom + 4); };
  const B = tog('bold', 'Tebal', () => (get().wt || 400) >= 600, v => set({ wt: v ? 700 : 400 }), 'Mod+B');
  const I = tog('italic', 'Miring', () => get().it, v => set({ it: v }));
  const U = tog('underline', 'Garis bawah', () => get().ul, v => set({ ul: v }));
  const al = seg([['l', 'al', 'Rata kiri'], ['c', 'ac', 'Rata tengah'], ['r', 'ar', 'Rata kanan'], ['j', 'aj', 'Rata kiri-kanan']], () => get().al || 'l', v => set({ al: v }));
  return [fam, h('div', { class: 'pgrp' }, size, sizes), B, I, U, sep(), al];
}

// ---------- context builders ----------
const CTX = {
  page() {
    const p = App.page;
    const pre = sel({ options: () => [['', 'Ukuran khusus'], ...PAGE_SIZES.map(([n]) => [n, n])], get: () => { const m = PAGE_SIZES.find(([, w, hh]) => (Math.abs(w - p.w) < .05 && Math.abs(hh - p.h) < .05) || (Math.abs(hh - p.w) < .05 && Math.abs(w - p.h) < .05)); return m ? m[0] : ''; }, set: v => { const m = PAGE_SIZES.find(x => x[0] === v); if (!m) return; const land = p.w > p.h; [p.w, p.h] = land ? [Math.max(m[1], m[2]), Math.min(m[1], m[2])] : [m[1], m[2]]; App.commit('Ukuran halaman'); V.fitPage(); }, w: 170, title: 'Ukuran halaman' });
    const W = num({ label: 'L', get: () => App.page.w, set: (v, f) => { App.page.w = v; fin('Lebar halaman', f); if (f) V.fitPage(); }, min: 1, w: 66 });
    const H = num({ label: 'T', get: () => App.page.h, set: (v, f) => { App.page.h = v; fin('Tinggi halaman', f); if (f) V.fitPage(); }, min: 1, w: 66 });
    const orient = seg([['p', 'page', 'Potret'], ['l', 'layout', 'Lanskap']], () => App.page.w > App.page.h ? 'l' : 'p', v => { const pg = App.page; if ((v === 'l') !== (pg.w > pg.h)) { [pg.w, pg.h] = [pg.h, pg.w]; App.commit('Orientasi'); V.fitPage(); } });
    const units = sel({ options: Object.keys(UNIT_LABEL).map(k => [k, UNIT_LABEL[k]]), get: () => App.doc.units, set: v => { App.doc.units = v; App.commit('Satuan'); App.emit('view'); V.drawRulers(); build(true); }, w: 110, title: 'Satuan gambar' });
    const nudge = num({ icon: 'arrowr', get: () => App.settings.nudge, set: v => App.set('nudge', v), min: .001, w: 54, title: 'Jarak geser (tombol panah)' });
    const dup = num({ icon: 'dup', get: () => App.settings.dupOffset[0], set: v => App.set('dupOffset', [v, v]), w: 50, title: 'Jarak duplikat' });
    const bg = colorBtn({ get: () => App.page.bg, set: (c, f) => { App.page.bg = c || '#ffffff'; V._pg = null; fin('Latar halaman', f); }, title: 'Warna latar halaman', none: false });
    return [pre, h('div', { class: 'pgrp xy' }, W, H), orient, sep(), lbl('Satuan'), units, sep(), nudge, dup, sep(), lbl('Latar'), bg, sep(), ib('page', 'Tata letak halaman…', () => run('pageSetup')), ib('plus', 'Tambah halaman', () => run('pageAdd'))];
  },
  common(extra = []) {
    const multi = App.sel.length > 1;
    return [...posSize(), ...extra, ...(multi ? [...shapingBtns(), sep()] : []), ...groupBtns(), sep(), ...orderBtns(), alignBtn(), sep(), ...outlineQuick(), curvesBtn()];
  },
  rect() {
    const o = S1();
    const R4 = [0, 1, 2, 3].map(i => num({ unit: 'len', get: () => S1()?.r?.[i] ?? 0, set: (v, f) => { setAll(x => { if (x.type !== 'rect') return; x.r = x.r || [0, 0, 0, 0]; if (x.rlock === false) x.r[i] = v; else x.r = [v, v, v, v]; }, 'Sudut', f); R4.forEach(r => r.refresh()); }, min: 0, w: 42, title: ['Kiri atas', 'Kanan atas', 'Kanan bawah', 'Kiri bawah'][i] + ' — jari-jari sudut' }));
    const lockR = tog('link', 'Edit semua sudut bersama', () => S1()?.rlock !== false, v => setAll(x => { x.rlock = v; }, 'Kunci sudut'));
    const ct = seg([['round', 'round', 'Sudut membulat'], ['scallop', 'scallop', 'Sudut bergerigi'], ['chamfer', 'chamfer', 'Sudut miring']], () => S1()?.ct || 'round', v => setAll(x => { x.ct = v; }, 'Jenis sudut'));
    void o;
    return this.common([ct, h('div', { class: 'pgrp r4' }, ...R4), lockR, sep()]);
  },
  ell() {
    const m = seg([['e', 'ellipse', 'Elips'], ['pie', 'radial', 'Pai'], ['arc', 'curve3', 'Busur']], () => S1()?.k || 'e', v => setAll(x => { if (x.type !== 'ell') return; x.k = v; if (v !== 'e' && x.a0 == null) { x.a0 = 0; x.a1 = 270; } }, 'Mode elips'));
    const a0 = num({ unit: 'deg', get: () => S1()?.a0 ?? 0, set: (v, f) => setAll(x => { x.a0 = v; if (!x.k || x.k === 'e') x.k = 'pie'; }, 'Sudut awal', f), w: 44, suffix: '°', title: 'Sudut awal' });
    const a1 = num({ unit: 'deg', get: () => S1()?.a1 ?? 270, set: (v, f) => setAll(x => { x.a1 = v; if (!x.k || x.k === 'e') x.k = 'pie'; }, 'Sudut akhir', f), w: 44, suffix: '°', title: 'Sudut akhir' });
    const flip = ib('reverse', 'Ubah arah (searah/berlawanan)', () => setAll(x => { [x.a0, x.a1] = [x.a1, x.a0]; }, 'Arah busur'));
    return this.common([m, a0, a1, flip, sep()]);
  },
  poly() {
    const o = S1();
    const n = num({ icon: o?.cs ? 'cstar' : o?.star ? 'star' : 'polygon', unit: 'int', get: () => S1()?.n ?? 5, set: (v, f) => setAll(x => { if (x.type === 'poly') x.n = Math.round(clamp(v, 3, 500)); }, 'Jumlah sisi', f), min: 3, max: 500, w: 42, dec: 0, title: 'Jumlah titik/sisi' });
    const items = [n];
    if (o?.cs) items.push(num({ label: 'Tajam', unit: 'int', get: () => S1()?.k ?? 2, set: (v, f) => setAll(x => { x.k = Math.round(v); }, 'Ketajaman', f), min: 2, max: 99, w: 38, dec: 0 }));
    else if (o?.star || o?.ir != null) items.push(slider({ label: 'Tajam', get: () => Math.round((1 - (S1()?.ir ?? .5)) * 100), set: (v, f) => setAll(x => { x.ir = clamp(1 - v / 100, .02, .99); x.star = true; }, 'Ketajaman', f), min: 1, max: 99, w: 80 }));
    items.push(seg([['p', 'polygon', 'Poligon'], ['s', 'star', 'Bintang'], ['c', 'cstar', 'Bintang kompleks']], () => S1()?.cs ? 'c' : S1()?.star ? 's' : 'p', v => { setAll(x => { x.cs = v === 'c'; x.star = v === 's'; if (v === 'p') { delete x.ir; delete x.tw; } if (v === 's') x.ir = x.ir ?? .45; if (v === 'c') { x.k = x.k || 2; x.n = Math.max(5, x.n); } }, 'Jenis poligon'); build(true); }), sep());
    return this.common(items);
  },
  spiral() {
    return this.common([num({ icon: 'spiral', unit: 'num', get: () => S1()?.rev ?? 4, set: (v, f) => setAll(x => { x.rev = v; }, 'Putaran', f), min: .5, max: 100, w: 42, dec: 1, title: 'Putaran' }),
      seg([['s', 'spiral', 'Spiral simetris'], ['l', 'twirl', 'Spiral logaritmik']], () => S1()?.log ? 'l' : 's', v => setAll(x => { x.log = v === 'l'; }, 'Jenis spiral')),
      slider({ label: 'Ekspansi', get: () => S1()?.ex ?? 100, set: (v, f) => setAll(x => { x.ex = v; }, 'Ekspansi', f), min: 1, max: 100, w: 70 }), sep()]);
  },
  ps() {
    return this.common([psPicker(true), sep()]);
  },
  text() {
    const o = () => S1() || App.sel[0];
    const set = (p, f = true) => { setAll(x => { if (x.type === 'text') Object.assign(x, p); }, 'Format teks', f); Text.place?.(); };
    return [...posSize(), ...fontBlock(() => o() || TextDef, set), sep(), ib('text', 'Properti teks (⌘/Ctrl+T)', () => run('textProps')), ib('fit', 'Sesuaikan ke jalur', () => run('fitPath')), ...(o()?.tp ? [num({ label: 'Offset', get: () => o().tp.off || 0, set: (v, f) => { o().tp.off = v; fin('Offset teks', f); }, w: 50 }), tog('mirrorv', 'Sisi jalur', () => o().tp?.side, v => { o().tp.side = v ? 1 : 0; App.commit('Sisi teks'); }), tog('reverse', 'Balik arah', () => o().tp?.rev, v => { o().tp.rev = v; App.commit('Arah teks'); })] : []), sep(), ...groupBtns(), curvesBtn()];
  },
  img() {
    const o = S1();
    return [...posSize(), ib('trace', 'Trace Otomatis — garis presisi…', () => run('autoTrace')), ddButton('Trace', () => ['autoTrace', 'quickTrace', 'trace'].map(id => ({ l: C[id].l, run: () => run(id) })), { title: 'Trace bitmap' }), sep(), ib('image', 'Penyesuaian & efek bitmap…', () => run('bitmapFx')), ib('powerclip', 'PowerClip ke bingkai…', () => run('pcInside')), sep(),
      h('span', { class: 'plbl' }, o?.px ? `${o.px[0]} × ${o.px[1]} px · ${Math.round(o.px[0] / ((objBox(o)?.w || 1) / 25.4))} dpi` : 'Bitmap'), sep(), ...groupBtns(), ...orderBtns()];
  },
  blend() {
    const o = S1();
    const n = num({ icon: 'blend', unit: 'int', get: () => S1()?.n ?? 12, set: (v, f) => setAll(x => { if (x.type === 'blend') x.n = Math.round(v); }, 'Langkah campuran', f), min: 1, max: 999, w: 44, dec: 0, title: 'Jumlah langkah' });
    const rot = num({ icon: 'rotl', unit: 'deg', get: () => S1()?.rot ?? 0, set: (v, f) => setAll(x => { x.rot = v; }, 'Rotasi campuran', f), w: 46, suffix: '°', title: 'Rotasi campuran' });
    const cd = seg([['direct', 'arrowr', 'Warna langsung'], ['cw', 'rotr', 'Warna searah jarum jam'], ['ccw', 'rotl', 'Warna berlawanan jarum jam']], () => S1()?.cd || 'direct', v => setAll(x => { x.cd = v; }, 'Arah warna'));
    const acc = slider({ label: 'Akselerasi', get: () => S1()?.oacc ?? 0, set: (v, f) => setAll(x => { x.oacc = v; x.acc = v; }, 'Akselerasi', f), min: -100, max: 100, w: 70 });
    const loop = tog('reverse', 'Balik urutan langkah', () => S1()?.loop, v => setAll(x => { x.loop = v; }, 'Balik campuran'));
    const path = ib('fit', 'Campuran sepanjang jalur…', () => { const b = S1(); App.ui.pickObject('Klik jalur untuk campuran', t => { b.path = t.id; App.commit('Campuran ke jalur'); }); });
    void o;
    return [...posSize(), n, rot, cd, acc, loop, path, ib('close', 'Lepas dari jalur', () => setAll(x => { delete x.path; }, 'Lepas jalur')), sep(), ib('breakapart', 'Pisahkan campuran', () => run('separate')), ib('trash', 'Hapus campuran', () => { const { clearEffect } = App.ops; clearEffect('blend'); })];
  },
  dim() {
    return [...posSize(), num({ label: 'Desimal', unit: 'int', get: () => S1()?.dec ?? 1, set: (v, f) => setAll(x => { x.dec = Math.round(v); }, 'Presisi', f), min: 0, max: 6, w: 34, dec: 0 }),
      sel({ options: [['', 'Satuan dokumen'], ...Object.keys(UNIT_LABEL).map(k => [k, UNIT_LABEL[k]])], get: () => S1()?.u || '', set: v => setAll(x => { x.u = v || undefined; }, 'Satuan dimensi'), w: 120 }),
      tog('ruler', 'Tampilkan satuan', () => S1()?.su !== false, v => setAll(x => { x.su = v; }, 'Satuan')),
      num({ label: 'Teks', unit: 'num', get: () => S1()?.sz ?? 8, set: (v, f) => setAll(x => { x.sz = v; }, 'Ukuran teks', f), min: 2, w: 38, suffix: 'pt' }),
      num({ label: 'Skala 1:', unit: 'num', get: () => S1()?.scale ?? 1, set: (v, f) => setAll(x => { x.scale = v; }, 'Skala gambar', f), min: .0001, w: 50, title: 'Skala gambar (mis. 100 untuk 1:100)' }),
      textField({ get: () => S1()?.txt ?? '', set: v => setAll(x => { x.txt = v || undefined; }, 'Teks dimensi'), w: 120, placeholder: 'Teks khusus (opsional)' }), sep(), ...outlineQuick()];
  },
  conn() {
    return [seg([['s', 'conn2', 'Penghubung lurus'], ['r', 'conn', 'Penghubung siku'], ['rr', 'round', 'Siku membulat']], () => S1()?.k || 's', v => setAll(x => { x.k = v; }, 'Jenis penghubung')), sep(), ...outlineQuick(), ...lineStyle()];
  },
  table() {
    const o = S1();
    return [...posSize(), num({ label: 'Baris', unit: 'int', get: () => S1()?.rh.length, set: v => { const t = S1(); v = Math.round(clamp(v, 1, 200)); while (t.rh.length < v) run('tableRowAdd'); while (t.rh.length > v) run('tableRowDel'); }, w: 34, dec: 0 }),
      num({ label: 'Kolom', unit: 'int', get: () => S1()?.cw.length, set: v => { const t = S1(); v = Math.round(clamp(v, 1, 100)); while (t.cw.length < v) run('tableColAdd'); while (t.cw.length > v) run('tableColDel'); }, w: 34, dec: 0 }),
      lbl('Latar'), colorBtn({ get: () => S1()?.bg, set: (c, f) => setAll(x => { x.bg = c; }, 'Latar tabel', f) }),
      lbl('Teks'), num({ unit: 'num', get: () => S1()?.sz ?? 9, set: (v, f) => setAll(x => { x.sz = v; }, 'Ukuran teks tabel', f), min: 2, w: 36, suffix: 'pt' }),
      seg([['l', 'al', 'Kiri'], ['c', 'ac', 'Tengah'], ['r', 'ar', 'Kanan']], () => S1()?.al || 'l', v => setAll(x => { x.al = v; }, 'Perataan tabel')),
      ib('bold', 'Baris judul', () => run('tableHeader')), sep(), lbl('Garis'), colorBtn({ get: () => S1()?.ol?.c, set: (c, f) => setAll(x => { x.ol = c ? { ...(x.ol || { w: .25 }), c } : null; }, 'Warna garis tabel', f) }), ...outlineQuick(), void o];
  },
  qr() {
    return [...posSize(), textField({ get: () => S1()?.data, set: v => setAll(x => { x.data = v; }, 'Data QR'), w: 220, placeholder: 'Isi kode QR' }),
      sel({ options: [['L', 'Koreksi L (7%)'], ['M', 'Koreksi M (15%)'], ['Q', 'Koreksi Q (25%)'], ['H', 'Koreksi H (30%)']], get: () => S1()?.ec || 'M', set: v => setAll(x => { x.ec = v; }, 'Koreksi galat'), w: 130 }),
      lbl('Warna'), colorBtn({ get: () => S1()?.fill?.c, set: (c, f) => setAll(x => { x.fill = { t: 'solid', c: c || '#000' }; }, 'Warna QR', f), none: false }), lbl('Latar'), colorBtn({ get: () => S1()?.bg ?? '#ffffff', set: (c, f) => setAll(x => { x.bg = c; }, 'Latar QR', f) })];
  },
  curve() {
    const o = S1();
    const closed = o?.p?.sp.every(s => s.c);
    return this.common([ib(closed ? 'breaknode' : 'closec', closed ? 'Buka kurva' : 'Tutup kurva', () => { setAll(x => { if (x.type === 'curve') x.p.sp.forEach(s => { s.c = !closed && s.n.length > 2; }); }, closed ? 'Buka kurva' : 'Tutup kurva'); build(true); }), ib('reverse', 'Balik arah', () => setAll(x => { if (x.type === 'curve') x.p.sp = x.p.sp.map(s => ({ c: s.c, n: s.n.slice().reverse().map(n => ({ ...n, ix: n.ox, iy: n.oy, ox: n.ix, oy: n.iy })) })); }, 'Balik arah')), ...lineStyle(), sep()]);
  },
  multi() { return this.common([]); },
  // ----- tools
  shape() {
    const o = S1();
    if (o?.type !== 'curve') return o ? CTX[o.type]?.call(CTX) || CTX.common() : [lbl('Pilih kurva untuk mengedit node')];
    const b = id => ib(C[id].i, C[id].l, () => { run(id); refresh(); });
    return [lbl(`${NodeOps.sel.size} node terpilih`), sep(), b('nAdd'), b('nDel'), sep(), b('nJoin'), b('nBreak'), b('nExtend'), b('nClose'), sep(), b('nLine'), b('nCurve'), sep(), b('nCusp'), b('nSmooth'), b('nSymm'), sep(), b('nReverse'), b('nExtract'), b('nAlignH'), b('nAlignV'), sep(), b('nReduce'), b('nAll'), sep(), ...outlineQuick()];
  },
  brush() { return [num({ icon: 'eraser', label: '', get: () => BT.r, set: v => { BT.r = v; }, min: .2, w: 52, title: 'Ukuran ujung kuas' }), slider({ label: 'Kekuatan', get: () => BT.s, set: v => { BT.s = v; }, min: 1, max: 100, w: 90 })]; },
  crop() { const r = Crop.r; return [lbl(r ? 'Area potong' : 'Seret area potong pada kanvas'), ...(r ? [num({ label: 'L', get: () => Crop.r?.w, set: v => { Crop.r.w = v; App.overlay(); }, w: 60 }), num({ label: 'T', get: () => Crop.r?.h, set: v => { Crop.r.h = v; App.overlay(); }, w: 60 }), h('button', { class: 'btn-sm pri', onclick: () => Crop.apply() }, 'Potong'), h('button', { class: 'btn-sm', onclick: () => { Crop.r = null; App.overlay(); build(true); } }, 'Batal')] : [])]; },
  knife() { return [seg([['2p', 'line2', 'Potong lurus 2 titik'], ['free', 'freehand', 'Potong bebas']], () => KT.mode, v => { KT.mode = v; App.tool.activate(); }), num({ label: 'Celah', get: () => KT.gap, set: v => { KT.gap = v; }, min: 0, w: 52, title: 'Lebar celah potongan bebas' })]; },
  eraser() { return [num({ icon: 'eraser', get: () => ET.d, set: v => { ET.d = v; }, min: .05, w: 56, title: 'Diameter ujung penghapus' })]; },
  xform() { return [seg([['rot', 'rotl', 'Rotasi bebas'], ['mirror', 'mirrorh', 'Cermin bebas'], ['scale', 'zoomin', 'Skala bebas'], ['skew', 'xform', 'Kemiringan bebas']], () => XForm.sub, v => { XForm.sub = v; })]; },
  zoom() { return [ib('zoomin', 'Perbesar', () => run('zoomIn')), ib('zoomout', 'Perkecil', () => run('zoomOut')), ib('zoomsel', 'Zoom ke terpilih', () => run('zoomSel')), ib('zoomall', 'Zoom ke semua objek', () => run('zoomAll')), ib('zoompage', 'Zoom ke halaman', () => run('zoomPage')), h('button', { class: 'btn-sm', onclick: () => run('zoom100') }, '100%')]; },
  curveTool() { return [slider({ label: 'Kehalusan', get: () => TO.curve.smooth, set: v => { TO.curve.smooth = v; }, min: 0, max: 100, w: 100 }), check('Tutup otomatis', () => TO.curve.close, v => { TO.curve.close = v; }), sep(), ...outlineQuick()]; },
  media() {
    return [sel({ options: Object.entries(MEDIA).map(([k, m]) => [k, m.n]), get: () => TO.media.preset, set: v => { TO.media.preset = v; build(true); }, w: 190, title: 'Gaya goresan' }),
      num({ label: 'Lebar', get: () => TO.media.w, set: v => { TO.media.w = v; }, min: .1, w: 52 }), slider({ label: 'Kehalusan', get: () => TO.media.smooth, set: v => { TO.media.smooth = v; }, min: 0, max: 100, w: 80 }),
      ...(TO.media.preset === 'callig' ? [num({ label: 'Sudut pena', unit: 'deg', get: () => TO.media.nib, set: v => { TO.media.nib = v; }, w: 40, suffix: '°' })] : []),
      lbl('Warna'), colorBtn({ get: () => TO.media.c, set: c => { TO.media.c = c || '#000000'; }, none: false })];
  },
  rectTool() { return [num({ icon: 'round', label: '', get: () => TO.rect.r, set: v => { TO.rect.r = v; }, min: 0, w: 52, title: 'Jari-jari sudut' }), seg([['round', 'round', 'Membulat'], ['scallop', 'scallop', 'Bergerigi'], ['chamfer', 'chamfer', 'Miring']], () => TO.rect.ct, v => { TO.rect.ct = v; }), sep(), ...outlineQuick()]; },
  ellTool() { return [seg([['e', 'ellipse', 'Elips'], ['pie', 'radial', 'Pai'], ['arc', 'curve3', 'Busur']], () => TO.ell.k, v => { TO.ell.k = v; }), num({ unit: 'deg', get: () => TO.ell.a0, set: v => { TO.ell.a0 = v; }, w: 44, suffix: '°', title: 'Sudut awal' }), num({ unit: 'deg', get: () => TO.ell.a1, set: v => { TO.ell.a1 = v; }, w: 44, suffix: '°', title: 'Sudut akhir' })]; },
  polyTool() { return [num({ icon: 'polygon', unit: 'int', get: () => TO.poly.n, set: v => { TO.poly.n = Math.round(clamp(v, 3, 500)); }, w: 42, dec: 0, title: 'Jumlah sisi' })]; },
  starTool() { return [num({ icon: 'star', unit: 'int', get: () => TO.star.n, set: v => { TO.star.n = Math.round(clamp(v, 3, 500)); }, w: 42, dec: 0, title: 'Jumlah titik' }), slider({ label: 'Ketajaman', get: () => TO.star.sharp, set: v => { TO.star.sharp = v; }, min: 1, max: 99, w: 90 })]; },
  cstarTool() { return [num({ icon: 'cstar', unit: 'int', get: () => TO.cstar.n, set: v => { TO.cstar.n = Math.round(clamp(v, 5, 500)); }, w: 42, dec: 0, title: 'Jumlah titik' }), num({ label: 'Ketajaman', unit: 'int', get: () => TO.cstar.k, set: v => { TO.cstar.k = Math.round(v); }, min: 2, max: 99, w: 38, dec: 0 })]; },
  graphTool() { return [num({ label: 'Baris', unit: 'int', get: () => TO.graph.rows, set: v => { TO.graph.rows = Math.round(clamp(v, 1, 99)); }, w: 34, dec: 0 }), num({ label: 'Kolom', unit: 'int', get: () => TO.graph.cols, set: v => { TO.graph.cols = Math.round(clamp(v, 1, 99)); }, w: 34, dec: 0 })]; },
  spiralTool() { return [num({ icon: 'spiral', unit: 'num', get: () => TO.spiral.rev, set: v => { TO.spiral.rev = v; }, min: .5, max: 100, w: 42, dec: 1, title: 'Putaran' }), seg([['s', 'spiral', 'Simetris'], ['l', 'twirl', 'Logaritmik']], () => TO.spiral.log ? 'l' : 's', v => { TO.spiral.log = v === 'l'; }), slider({ label: 'Ekspansi', get: () => TO.spiral.ex, set: v => { TO.spiral.ex = v; }, min: 1, max: 100, w: 70 })]; },
  shapesTool() { return [psPicker(false)]; },
  textTool() { const o = App.sel[0]?.type === 'text' ? App.sel[0] : null; if (o) return CTX.text(); return [...fontBlock(() => TextDef, p => { Object.assign(TextDef, p); if (p.font) loadFace(p.font, TextDef.wt, TextDef.it); }), sep(), lbl('Klik untuk teks artistik · seret untuk teks paragraf')]; },
  tableTool() { return [num({ label: 'Baris', unit: 'int', get: () => TO.table.rows, set: v => { TO.table.rows = Math.round(clamp(v, 1, 200)); }, w: 34, dec: 0 }), num({ label: 'Kolom', unit: 'int', get: () => TO.table.cols, set: v => { TO.table.cols = Math.round(clamp(v, 1, 100)); }, w: 34, dec: 0 })]; },
  dimTool() { return [num({ label: 'Desimal', unit: 'int', get: () => TO.dim.dec, set: v => { TO.dim.dec = Math.round(v); }, min: 0, max: 6, w: 34, dec: 0 }), num({ label: 'Teks', unit: 'num', get: () => TO.dim.sz, set: v => { TO.dim.sz = v; }, min: 2, w: 38, suffix: 'pt' }), check('Tampilkan satuan', () => TO.dim.su, v => { TO.dim.su = v; })]; },
  connTool() { return [seg([['s', 'conn2', 'Lurus'], ['r', 'conn', 'Siku'], ['rr', 'round', 'Siku membulat']], () => TO.conn.k, v => { TO.conn.k = v; })]; },
  shadowT() {
    const o = S1(), sh = () => S1()?.fx?.sh || FX.sh;
    const upd = (p, f = true) => { if (S1()?.fx?.sh) setAll(x => { if (x.fx?.sh) Object.assign(x.fx.sh, p); }, 'Bayangan', f); else Object.assign(FX.sh, p); };
    return [sel({ options: [['', 'Preset…'], ['flat', 'Datar kanan bawah'], ['glow', 'Pendaran'], ['persp', 'Perspektif bawah'], ['soft', 'Lembut besar']], get: () => '', set: v => { const P = { flat: { k: 'flat', x: 1.5, y: 1.5, b: 2, o: .5, c: '#000000' }, glow: { k: 'flat', x: 0, y: 0, b: 5, o: .85, c: '#ffb703' }, persp: { k: 'persp', ang: 40, st: .45, b: 2, o: .4, x: 0, y: 0, c: '#000000' }, soft: { k: 'flat', x: 3, y: 4, b: 8, o: .35, c: '#000000' } }[v]; if (!P) return; if (App.sel.length) setAll(x => { x.fx = x.fx || {}; x.fx.sh = { ...P }; }, 'Preset bayangan'); else Object.assign(FX.sh, P); build(true); }, w: 140 }),
      slider({ label: 'Opasitas', get: () => Math.round(sh().o * 100), set: (v, f) => upd({ o: v / 100 }, f), min: 0, max: 100, w: 70, fmt: v => v + '%' }),
      num({ label: 'Halus', get: () => sh().b, set: (v, f) => upd({ b: v }, f), min: 0, w: 46, title: 'Perhalus tepi (feather)' }),
      lbl('Warna'), colorBtn({ get: () => sh().c, set: (c, f) => upd({ c: c || '#000000' }, f), none: false }),
      sel({ options: [['', 'Normal'], ['multiply', 'Kalikan'], ['screen', 'Layar'], ['overlay', 'Hamparan']], get: () => sh().mode || '', set: v => upd({ mode: v || undefined }), w: 90, title: 'Mode gabung' }),
      sep(), ib('trash', 'Hapus bayangan', () => App.ops.clearEffect('sh')), void o];
  },
  contourT() {
    const ct = () => S1()?.fx?.ct || FX.ct;
    const upd = (p, f = true) => { if (S1()?.fx?.ct) setAll(x => { if (x.fx?.ct) Object.assign(x.fx.ct, p); }, 'Kontur', f); else Object.assign(FX.ct, p); };
    return [seg([['center', 'contour', 'Ke tengah'], ['in', 'zoomout', 'Kontur dalam'], ['out', 'zoomin', 'Kontur luar']], () => ct().dir, v => upd({ dir: v })),
      num({ icon: 'steprep', unit: 'int', get: () => ct().n, set: (v, f) => upd({ n: Math.round(v) }, f), min: 1, max: 200, w: 40, dec: 0, title: 'Jumlah langkah' }),
      num({ label: 'Jarak', get: () => ct().off, set: (v, f) => upd({ off: v }, f), min: .05, w: 50, title: 'Jarak kontur' }),
      seg([['miter', 'chamfer', 'Sudut lancip'], ['round', 'round', 'Sudut bulat'], ['bevel', 'scallop', 'Sudut potong']], () => ct().join, v => upd({ join: v })),
      lbl('Isian'), colorBtn({ get: () => ct().fc, set: (c, f) => upd({ fc: c }, f) }), lbl('Kerangka'), colorBtn({ get: () => ct().oc, set: (c, f) => upd({ oc: c }, f) }),
      seg([['direct', 'arrowr', 'Warna langsung'], ['cw', 'rotr', 'Searah jarum jam'], ['ccw', 'rotl', 'Berlawanan']], () => ct().cd || 'direct', v => upd({ cd: v })),
      sep(), ib('breakapart', 'Pisahkan kontur', () => run('separate')), ib('trash', 'Hapus kontur', () => App.ops.clearEffect('ct'))];
  },
  blendT() { const o = S1(); if (o?.type === 'blend') return CTX.blend(); return [num({ icon: 'blend', unit: 'int', get: () => FX.blend.n, set: v => { FX.blend.n = Math.round(v); }, min: 1, w: 44, dec: 0, title: 'Langkah' }), num({ icon: 'rotl', unit: 'deg', get: () => FX.blend.rot, set: v => { FX.blend.rot = v; }, w: 44, suffix: '°' }), seg([['direct', 'arrowr', 'Warna langsung'], ['cw', 'rotr', 'Searah'], ['ccw', 'rotl', 'Berlawanan']], () => FX.blend.cd, v => { FX.blend.cd = v; }), lbl('Seret dari objek ke objek lain')]; },
  distortT() {
    const d = () => S1()?.fx?.dist || FX.dist;
    const upd = (p, f = true) => { Object.assign(FX.dist, p); if (S1()?.fx?.dist) setAll(x => { if (x.fx?.dist) Object.assign(x.fx.dist, p); }, 'Distorsi', f); };
    const k = d().k;
    return [seg([['push', 'repel', 'Tarik dan dorong'], ['zip', 'roughen', 'Ritsleting'], ['twist', 'twirl', 'Pusaran']], () => d().k, v => { upd({ k: v }); build(true); }),
      ...(k !== 'twist' ? [num({ label: 'Amplitudo', unit: 'num', get: () => d().amp, set: (v, f) => upd({ amp: v }, f), min: -200, max: 200, w: 44 })] : []),
      ...(k === 'zip' ? [num({ label: 'Frekuensi', unit: 'int', get: () => d().freq, set: (v, f) => upd({ freq: Math.round(v) }, f), min: 1, max: 200, w: 40, dec: 0 }), tog('smooth', 'Distorsi halus', () => d().smooth, v => upd({ smooth: v })), tog('roughen', 'Distorsi acak', () => d().rand, v => upd({ rand: v }))] : []),
      ...(k === 'twist' ? [num({ label: 'Putaran', unit: 'num', get: () => d().rot, set: (v, f) => upd({ rot: v }, f), w: 44, dec: 2 })] : []),
      ib('center', 'Pusatkan distorsi', () => upd({ cx: .5, cy: .5 })), sep(), ib('trash', 'Hapus distorsi', () => App.ops.clearEffect('dist'))];
  },
  envT() {
    return [seg([['curve', 'curve3', 'Mode lengkung'], ['line', 'line2', 'Mode garis lurus']], () => S1()?.fx?.env?.mode || FX.env.mode, v => { FX.env.mode = v; setAll(x => { if (x.fx?.env) x.fx.env.mode = v; }, 'Mode amplop'); }),
      ddButton('Preset', () => Object.keys(ENV_PRESETS).map(k => ({ l: { arch: 'Lengkung', bulge: 'Gembung', pinch: 'Jepit', flag: 'Bendera', wedge: 'Baji', bridge: 'Jembatan', valley: 'Lembah', trap: 'Trapesium' }[k], run: () => S1() && applyEnvPreset(S1(), k) })), { icon: 'envelope' }),
      ib('trash', 'Hapus amplop', () => run('clearEnv'))];
  },
  extrudeT() {
    const e = () => S1()?.fx?.ext || FX.ext;
    const upd = (p, f = true) => { if (S1()?.fx?.ext) setAll(x => { if (x.fx?.ext) Object.assign(x.fx.ext, p); }, 'Ekstrusi', f); else Object.assign(FX.ext, p); };
    return [slider({ label: 'Kedalaman', get: () => Math.round(e().d * 100), set: (v, f) => upd({ d: v / 100 }, f), min: 1, max: 99, w: 80 }),
      sel({ options: [['obj', 'Isian objek'], ['solid', 'Isian padat'], ['shade', 'Gradasi bayangan']], get: () => e().sh, set: v => upd({ sh: v }), w: 130, title: 'Warna ekstrusi' }),
      colorBtn({ get: () => e().c1, set: (c, f) => upd({ c1: c || '#888888' }, f), none: false, title: 'Warna awal' }), colorBtn({ get: () => e().c2, set: (c, f) => upd({ c2: c || '#000000' }, f), none: false, title: 'Warna akhir' }),
      num({ icon: 'sparkle', unit: 'deg', get: () => e().light, set: (v, f) => upd({ light: v }, f), w: 44, suffix: '°', title: 'Arah cahaya' }), tog('minus', 'Pencahayaan datar', () => e().flat, v => upd({ flat: v })),
      sep(), ib('breakapart', 'Pisahkan ekstrusi', () => run('separate')), ib('trash', 'Hapus ekstrusi', () => App.ops.clearEffect('ext'))];
  },
  blockT() { const b = () => S1()?.fx?.bs || FX.bs; return [lbl('Warna'), colorBtn({ get: () => b().c, set: (c, f) => { if (S1()?.fx?.bs) setAll(x => { if (x.fx?.bs) x.fx.bs.c = c || '#000'; }, 'Bayangan blok', f); else FX.bs.c = c; }, none: false }), ...(S1()?.fx?.bs ? [num({ label: 'X', get: () => S1().fx.bs.x, set: (v, f) => setAll(x => { if (x.fx?.bs) x.fx.bs.x = v; }, 'Bayangan blok', f), w: 50 }), num({ label: 'Y', get: () => S1().fx.bs.y, set: (v, f) => setAll(x => { if (x.fx?.bs) x.fx.bs.y = v; }, 'Bayangan blok', f), w: 50 })] : []), sep(), ib('trash', 'Hapus bayangan blok', () => App.ops.clearEffect('bs'))]; },
  transpT() {
    const o = S1(), tr = () => S1()?.tr;
    const upd = (p, f = true) => { if (S1()?.tr) setAll(x => { if (x.tr) Object.assign(x.tr, p); }, 'Transparansi', f); else Object.assign(FX.tr, p); };
    return [seg([['none', 'nofill', 'Tanpa transparansi'], ['uni', 'fill', 'Seragam'], ['lin', 'linear', 'Gradasi linier'], ['rad', 'radial', 'Gradasi radial']], () => tr()?.t || 'none', v => { if (!App.sel.length) { FX.tr.t = v; return; } setAll(x => { if (v === 'none') x.tr = null; else if (v === 'uni') x.tr = { t: 'uni', v: x.tr?.v ?? FX.tr.v, m: x.tr?.m }; else { const g = geom(x), b = bbox(g.local || g.p); x.tr = { t: v, p1: [b.x, b.y + b.h / 2], p2: [b.x + b.w, b.y + b.h / 2], v1: 0, v2: 1, m: x.tr?.m }; } }, 'Transparansi'); build(true); }),
      ...(tr()?.t === 'uni' || !tr() ? [slider({ label: 'Transparansi', get: () => Math.round((tr()?.v ?? FX.tr.v) * 100), set: (v, f) => upd({ v: v / 100 }, f), min: 0, max: 100, w: 90, fmt: v => v + '%' })] : []),
      ...(tr()?.p1 ? [slider({ label: 'Awal', get: () => Math.round((tr().v1 ?? 0) * 100), set: (v, f) => upd({ v1: v / 100 }, f), min: 0, max: 100, w: 60, fmt: v => v + '%' }), slider({ label: 'Akhir', get: () => Math.round((tr().v2 ?? 1) * 100), set: (v, f) => upd({ v2: v / 100 }, f), min: 0, max: 100, w: 60, fmt: v => v + '%' })] : []),
      sel({ options: BLEND_MODES, get: () => tr()?.m || FX.tr.m || 'normal', set: v => upd({ m: v }), w: 120, title: 'Mode gabung' }), void o];
  },
  ifillT() {
    const o = S1(), f = () => S1()?.fill;
    const types = [['none', 'nofill', 'Tanpa isian'], ['solid', 'fill', 'Isian seragam'], ['lin', 'linear', 'Gradasi linier'], ['rad', 'radial', 'Gradasi radial'], ['con', 'conical', 'Gradasi kerucut'], ['sq', 'square', 'Gradasi persegi'], ['pat', 'pattern', 'Isian pola'], ['tex', 'texture', 'Isian tekstur']];
    const cur = () => { const x = f(); if (!x) return 'none'; if (x.t === 'grad') return x.g; return x.t; };
    return [seg(types, cur, v => { if (!App.sel.length) { FX.ifill.g = v; return; } App.ui.setFillType(v); build(true); }),
      ...(f()?.t === 'grad' ? [colorBtn({ get: () => f().st[0].c, set: (c, fi) => setAll(x => { if (x.fill?.t === 'grad') x.fill.st[0].c = c || '#000'; }, 'Warna gradasi', fi), none: false, title: 'Warna awal' }), colorBtn({ get: () => f().st[f().st.length - 1].c, set: (c, fi) => setAll(x => { if (x.fill?.t === 'grad') x.fill.st[x.fill.st.length - 1].c = c || '#fff'; }, 'Warna gradasi', fi), none: false, title: 'Warna akhir' }),
        sel({ options: [['', 'Ulang: tidak'], ['repeat', 'Ulang'], ['reflect', 'Ulang & cermin']], get: () => f().sp || '', set: v => setAll(x => { if (x.fill?.t === 'grad') x.fill.sp = v || undefined; }, 'Pengulangan gradasi'), w: 120 }),
        ib('reverse', 'Balik warna', () => setAll(x => { if (x.fill?.t === 'grad') x.fill.st = x.fill.st.map(s => ({ ...s, o: 1 - s.o })).reverse(); }, 'Balik gradasi')), ib('props', 'Edit isian…', () => App.ui.openDialog('fill'))] : []),
      ...(f()?.t === 'solid' ? [colorBtn({ get: () => f().c, set: (c, fi) => setAll(x => { x.fill = c ? { t: 'solid', c } : null; }, 'Warna isian', fi) })] : []),
      void o];
  },
  dropT() { return [lbl(App.sampled ? `Diambil: ${App.sampled.color}` : 'Klik untuk mengambil warna'), App.sampled ? h('i', { class: 'swatch-lg', style: { background: App.sampled.color } }) : null].filter(Boolean); },
  smartT() { return [lbl('Warna isian'), colorBtn({ get: () => FX.smart.c, set: c => { FX.smart.c = c || '#ffd166'; }, none: false }), check('Dengan kerangka', () => FX.smart.ol, v => { FX.smart.ol = v; })]; },
};
export const BLEND_MODES = [['normal', 'Normal'], ['multiply', 'Kalikan'], ['screen', 'Layar'], ['overlay', 'Hamparan'], ['darken', 'Gelapkan'], ['lighten', 'Terangkan'], ['color-dodge', 'Hindari warna'], ['color-burn', 'Bakar warna'], ['hard-light', 'Cahaya keras'], ['soft-light', 'Cahaya lembut'], ['difference', 'Selisih'], ['exclusion', 'Pengecualian'], ['hue', 'Rona'], ['saturation', 'Saturasi'], ['color', 'Warna'], ['luminosity', 'Luminositas']];

function psPicker(forSel) {
  const o = forSel ? S1() : null;
  const g = o ? PS[o.sh]?.g : App.topt.ps.g;
  const groups = seg(PS_GROUPS.map(([k, n, ic]) => [k, ic, n]), () => g, v => { App.topt.ps.g = v; if (!forSel) App.emit('tool', App.toolId); build(true); });
  const cur = o ? o.sh : App.topt.ps[g];
  const btn = h('button', { class: 'dd-trigger pspick', title: 'Pilih bentuk' }, h('span', { class: 'psprev', html: psSVG(cur) }), h('span', { class: 'ddl' }, PS[cur]?.n || ''), h('span', { class: 'ddc', html: icon('chevd', 12) }));
  btn.onclick = e => {
    e.stopPropagation();
    const grid = h('div', { class: 'psgrid' });
    for (const [k, d] of Object.entries(PS)) {
      if (d.g !== g) continue;
      const b = h('button', { class: 'psitem' + (k === cur ? ' on' : ''), title: d.n, html: psSVG(k) });
      b.onclick = () => {
        if (forSel) { setAll(x => { if (x.type === 'ps') { x.sh = k; x.p = deep(PS[k].p); } }, 'Ganti bentuk'); }
        else { App.topt.ps[g] = k; }
        document.querySelector('.popover')?._close(); build(true);
      };
      grid.append(b);
    }
    popover(btn, grid);
  };
  return h('div', { class: 'pgrp' }, groups, btn);
}
const psCache = {};
export function psSVG(k) {
  if (psCache[k]) return psCache[k];
  const d = PS[k]; if (!d) return '';
  const r = d.f(20, 20, d.p);
  const P = p => p.sp.map(s => 'M' + s.n.map((n, i) => i ? `C${s.n[i - 1].ox} ${s.n[i - 1].oy} ${n.ix} ${n.iy} ${n.x} ${n.y}` : `${n.x} ${n.y}`).join('') + (s.c ? `C${s.n.at(-1).ox} ${s.n.at(-1).oy} ${s.n[0].ix} ${s.n[0].iy} ${s.n[0].x} ${s.n[0].y}Z` : '')).join('');
  return psCache[k] = `<svg viewBox="-2 -2 24 24" width="22" height="22"><path d="${P(r)}" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2" fill-rule="evenodd"/>${r.lines ? `<path d="${P({ sp: r.lines })}" fill="none" stroke="currentColor" stroke-width="1.2"/>` : ''}</svg>`;
}

// ---------- build / refresh ----------
let key = '', widgets = [];
function ctxKey() {
  if (!App.doc || App.startOn) return 'none';
  const t = App.toolId, s = App.sel, o = s[0];
  const toolCtx = { shape: 'shape', smooth: 'brush', smear: 'brush', twirl: 'brush', attract: 'brush', repel: 'brush', roughen: 'brush', crop: 'crop', knife: 'knife', eraser: 'eraser', xform: 'xform', zoom: 'zoom', pan: 'zoom', freehand: 'curveTool', line2: 'curveTool', bezier: 'curveTool', pen: 'curveTool', bspline: 'curveTool', polyline: 'curveTool', curve3: 'curveTool', smart: 'curveTool', media: 'media', shadow: 'shadowT', contour: 'contourT', blend: 'blendT', distort: 'distortT', envelope: 'envT', extrude: 'extrudeT', block: 'blockT', transp: 'transpT', ifill: 'ifillT', eyedrop: 'dropT', attrdrop: 'dropT', bucket: 'dropT', smartfill: 'smartT', text: 'textTool' }[t];
  const drawCtx = { rect: 'rectTool', rect3: 'rectTool', ellipse: 'ellTool', ellipse3: 'ellTool', polygon: 'polyTool', star: 'starTool', cstar: 'cstarTool', graph: 'graphTool', spiral: 'spiralTool', shapes: 'shapesTool', table: 'tableTool', dimpar: 'dimTool', dimhv: 'dimTool', dimang: 'dimTool', dimseg: 'dimTool', leader: 'dimTool', conn: 'connTool' }[t];
  const sig = s.map(x => x.type + (x.type === 'poly' ? (x.cs ? 'c' : x.star ? 's' : 'p') : '') + (x.fx ? Object.keys(x.fx).join('') : '') + (x.tr?.t || '') + (x.fill?.t || '') + (x.fill?.g || '') + (x.type === 'text' && x.tp ? 'tp' : '') + (x.type === 'curve' ? x.p.sp.every(q => q.c) : '')).join(',');
  if (toolCtx) return toolCtx + '|' + sig + (t === 'shape' ? NodeOps.sel.size : '') + (t === 'crop' ? !!Crop.r : '') + (t === 'media' ? TO.media.preset : '') + (t === 'distort' ? FX.dist.k : '') + (t.includes('drop') || t === 'bucket' ? App.sampled?.color : '') + (t === 'shapes' ? App.topt.ps.g : '');
  if (drawCtx && !s.length) return drawCtx;
  if (!s.length) return 'page';
  if (s.length > 1) return 'multi|' + sig;
  return (CTX[o.type] ? o.type : 'multi') + '|' + sig + (o.type === 'ps' ? o.sh : '');
}
export function build(force = false) {
  const bar = document.getElementById('propbar');
  const k = ctxKey();
  if (!force && k === key) return refresh();
  key = k;
  bar.innerHTML = '';
  if (k === 'none') return;
  const name = k.split('|')[0];
  let items = [];
  try { items = (CTX[name] || CTX.multi).call(CTX); } catch (e) { console.error('propbar', e); }
  items = items.flat().filter(x => x && x.nodeType);
  const ti = h('div', { class: 'pb-tool', title: App.tool?.name, html: icon(App.ui.toolIcon?.(App.toolId) || 'pick', 17) });
  bar.append(ti, ...items);
  widgets = [...bar.querySelectorAll('*')].filter(x => x.refresh);
}
export function refresh() { widgets.forEach(w => { try { w.refresh(); } catch { } }); }
export function bindPropbar() {
  const q = () => { cancelAnimationFrame(q._r); q._r = requestAnimationFrame(() => build()); };
  App.on('sel', q); App.on('tool', q); App.on('change', q); App.on('doc', q); App.on('nodes', q); App.on('sampled', q); App.on('page', q);
  App.on('status', () => { cancelAnimationFrame(q._s); q._s = requestAnimationFrame(refresh); });
  build(true);
}
App.ui.setFillType = (v) => {
  setAll(x => {
    if (x.type === 'g' || x.type === 'img') return;
    const g = geom(x), b = bbox(g.local || g.p), base = fillColor(x.fill) || '#2f6bff';
    if (v === 'none') x.fill = null;
    else if (v === 'solid') x.fill = { t: 'solid', c: base };
    else if (['lin', 'rad', 'con', 'sq'].includes(v)) {
      const st = x.fill?.t === 'grad' ? x.fill.st : [{ o: 0, c: base, a: 1 }, { o: 1, c: '#ffffff', a: 1 }];
      x.fill = v === 'lin' ? { t: 'grad', g: v, st, p1: [b.x, b.y + b.h / 2], p2: [b.x + b.w, b.y + b.h / 2] } : { t: 'grad', g: v, st, p1: [b.x + b.w / 2, b.y + b.h / 2], p2: [b.x + b.w, b.y + b.h / 2] };
    } else if (v === 'pat') x.fill = { t: 'pat', id: 'checker', fg: base, bg: '#ffffff', s: 5, a: 0 };
    else if (v === 'tex') x.fill = { t: 'tex', id: 'clouds', s: Math.max(20, Math.max(b.w, b.h) / 2) };
  }, 'Jenis isian', true, true);
};
export { toast, fmtU, PS_GROUPS };
