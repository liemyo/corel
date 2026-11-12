// Command registry: every menu item, toolbar button and keyboard shortcut resolves to one of these.
import { App } from './app.js';
import { V } from './view.js';
import { mk, cloneObj, applyM, newPage, newLayer, walk } from './model.js';
import { objBox, selBox, envInit, perspInit, geom } from './objgeom.js';
import { T, S, bbox } from './geom.js';
import * as Op from './ops.js';
import { saveDoc, openFiles, importFiles, autosave, printDoc } from './io.js';
import { NodeOps } from './tools/shape.js';
import { keyId, toast, deep, isMac } from './util.js';

const sel = () => App.sel;
const has = n => () => App.sel.length >= n;
const doc = () => !!App.doc && !App.startOn;
const ui = (name, ...a) => App.ui.openDialog?.(name, ...a);
const dock = id => App.ui.openDocker?.(id);
const one = () => App.sel.length === 1;
const setFxFor = (k, v) => { for (const o of sel()) { o.fx = o.fx || {}; o.fx[k] = typeof v === 'function' ? v(o) : deep(v); } App.commit('Efek'); };

export const C = {
  // ----- File
  new: { l: 'Baru…', k: 'Mod+N', i: 'new', run: () => ui('new') },
  newQuick: { l: 'Dokumen baru (A4)', i: 'new', run: () => App.newDocument() },
  newTpl: { l: 'Baru dari templat…', i: 'layout', run: () => { App.showStart(); App.ui.startTab?.('tpl'); } },
  open: { l: 'Buka…', k: 'Mod+O', i: 'open', run: () => openFiles() },
  save: { l: 'Simpan', k: 'Mod+S', i: 'save', en: doc, run: () => saveDoc() },
  saveAs: { l: 'Simpan sebagai…', k: 'Mod+Shift+S', i: 'save', en: doc, run: () => saveDoc(App.doc, true) },
  revert: { l: 'Kembalikan ke versi tersimpan', en: () => doc() && App.hist?.stack.length > 1, run: () => App.goHist(0) },
  close: { l: 'Tutup', k: 'Mod+Shift+W', en: () => !!App.doc, run: () => App.ui.closeDoc?.(App.doc) },
  closeAll: { l: 'Tutup semua', en: () => App.docs.length > 0, run: () => [...App.docs].forEach(d => App.closeDoc(d)) },
  import: { l: 'Impor…', k: 'Mod+I', i: 'import', en: doc, run: () => importFiles() },
  export: { l: 'Ekspor…', k: 'Mod+E', i: 'export', en: doc, run: () => ui('export') },
  exportPDF: { l: 'Terbitkan ke PDF…', i: 'doc', en: doc, run: () => ui('export', 'pdf') },
  exportWeb: { l: 'Ekspor untuk web…', en: doc, run: () => ui('export', 'png') },
  print: { l: 'Cetak…', k: 'Mod+P', i: 'print', en: doc, run: () => printDoc() },
  docProps: { l: 'Properti dokumen…', en: doc, run: () => ui('docprops') },
  start: { l: 'Layar sambutan', i: 'apps', run: () => App.showStart() },
  // ----- Edit
  undo: { l: 'Urungkan', k: 'Mod+Z', i: 'undo', en: () => App.hist?.canUndo(), run: () => App.undo() },
  redo: { l: 'Ulangi', k: 'Mod+Shift+Z', i: 'redo', en: () => App.hist?.canRedo(), run: () => App.redo() },
  redo2: { l: 'Ulangi', k: 'Mod+Y', hidden: true, run: () => App.redo() },
  cut: { l: 'Potong', k: 'Mod+X', i: 'cut', en: has(1), run: () => { C.copy.run(); C.delete.run('Potong'); } },
  copy: { l: 'Salin', k: 'Mod+C', i: 'copy', en: has(1), run: () => { App.clipboard = { objs: deep(sel()), assets: assetsOf(sel()) }; writeSys(); toast(`${sel().length} objek disalin`); } },
  paste: { l: 'Tempel', k: 'Mod+V', i: 'paste', en: doc, run: () => pasteClip() },
  pasteInPlace: { l: 'Tempel di tempat', k: 'Mod+Shift+V', en: () => !!App.clipboard, run: () => pasteClip(true) },
  delete: { l: 'Hapus', k: 'Delete', i: 'trash', en: has(1), run: (label = 'Hapus') => { const s = sel().filter(o => !o.lock); App.remove(s); App.commit(label); } },
  duplicate: { l: 'Duplikat', k: 'Mod+D', i: 'dup', en: has(1), run: () => Op.duplicate() },
  clone: { l: 'Klon (salinan tertaut)', en: has(1), run: () => Op.duplicate(sel(), [0, 0]) },
  stepRepeat: { l: 'Langkah dan ulangi…', k: 'Mod+Shift+D', i: 'steprep', en: has(1), run: () => dock('steprep') },
  copyProps: { l: 'Salin properti dari…', k: 'Mod+Shift+A', i: 'copyprops', en: has(1), run: () => ui('copyprops') },
  selectAll: { l: 'Pilih semua objek', k: 'Mod+A', en: doc, run: () => App.select(App.isolate ? App.ctxList : App.allObjects()) },
  selectText: { l: 'Pilih semua teks', en: doc, run: () => App.select(App.allObjects().filter(o => o.type === 'text')) },
  selectGuides: { l: 'Pilih semua garis bantu', en: doc, run: () => { V.selGuide = App.page.guides[0]; App.overlay(); } },
  selectNone: { l: 'Batalkan pilihan', k: 'Escape', hidden: true, run: () => App.clearSel() },
  find: { l: 'Cari dan ganti teks…', k: 'Mod+F', i: 'search', en: doc, run: () => ui('find') },
  insertChar: { l: 'Glif / karakter khusus…', k: 'Mod+F11', i: 'glyph', en: doc, run: () => dock('glyphs') },
  // ----- View
  wire: { l: 'Kerangka (Wireframe)', ck: () => App.wire, run: () => { App.wire = !App.wire; App.render(); App.emit('view'); } },
  rulers: { l: 'Penggaris', k: 'Mod+Alt+R', i: 'ruler', ck: () => App.settings.rulers, run: () => { App.set('rulers', !App.settings.rulers); V.resize(); } },
  grid: { l: 'Kisi dokumen', i: 'grid', ck: () => App.doc?.grid.show, en: doc, run: () => { App.doc.grid.show = !App.doc.grid.show; V.drawGrid(); App.emit('view'); } },
  guides: { l: 'Garis bantu', i: 'guides', ck: () => App.settings.guides !== false, run: () => { App.set('guides', App.settings.guides === false); App.overlay(); } },
  bleed: { l: 'Tampilkan area bleed', ck: () => App.settings.showBleed, run: () => { App.set('showBleed', !App.settings.showBleed); V._pg = null; App.render(); } },
  snapGrid: { l: 'Kunci ke kisi', k: 'Mod+Shift+Y', ck: () => App.doc?.grid.snap, en: doc, run: () => { App.doc.grid.snap = !App.doc.grid.snap; V.invalidateSnap(); App.emit('view'); } },
  snapGuides: { l: 'Kunci ke garis bantu', ck: () => App.doc?.snap.guides, en: doc, run: () => { App.doc.snap.guides = !App.doc.snap.guides; V.invalidateSnap(); App.emit('view'); } },
  snapObjects: { l: 'Kunci ke objek', k: 'Alt+Z', ck: () => App.doc?.snap.objects, en: doc, run: () => { App.doc.snap.objects = !App.doc.snap.objects; V.invalidateSnap(); App.emit('view'); } },
  snapPage: { l: 'Kunci ke halaman', ck: () => App.doc?.snap.page, en: doc, run: () => { App.doc.snap.page = !App.doc.snap.page; V.invalidateSnap(); App.emit('view'); } },
  dynGuides: { l: 'Garis bantu penjajaran (dinamis)', k: 'Shift+Alt+A', ck: () => App.doc?.snap.dyn, en: doc, run: () => { App.doc.snap.dyn = !App.doc.snap.dyn; V.invalidateSnap(); App.emit('view'); } },
  snapOff: { l: 'Matikan semua penguncian', en: doc, run: () => { Object.assign(App.doc.snap, { objects: false, guides: false, page: false, dyn: false }); App.doc.grid.snap = false; V.invalidateSnap(); App.emit('view'); toast('Penguncian dimatikan'); } },
  zoomIn: { l: 'Perbesar', k: 'Mod+=', i: 'zoomin', en: doc, run: () => V.zoomAt(1.5) },
  zoomIn2: { l: 'Perbesar', k: 'Mod+Shift+=', hidden: true, run: () => V.zoomAt(1.5) },
  zoomOut: { l: 'Perkecil', k: 'Mod+-', i: 'zoomout', en: doc, run: () => V.zoomAt(1 / 1.5) },
  zoom100: { l: 'Ukuran sebenarnya (100%)', k: 'Mod+1', en: doc, run: () => V.zoomTo(100) },
  zoomPage: { l: 'Zoom ke halaman', k: 'Shift+F4', i: 'zoompage', en: doc, run: () => V.fitPage() },
  zoomPage2: { l: 'Zoom ke halaman', k: 'Mod+0', hidden: true, run: () => V.fitPage() },
  zoomWidth: { l: 'Zoom ke lebar halaman', en: doc, run: () => V.fitWidth() },
  zoomAll: { l: 'Zoom ke semua objek', k: 'F4', i: 'zoomall', en: doc, run: () => V.fitAll() },
  zoomSel: { l: 'Zoom ke objek terpilih', k: 'Shift+F2', i: 'zoomsel', en: has(1), run: () => V.fitSel() },
  full: { l: 'Layar penuh', k: 'F9', i: 'full', run: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.() },
  // ----- Layout (pages)
  pageAdd: { l: 'Sisipkan halaman', i: 'page', en: doc, run: () => { const p = App.page; App.doc.pages.splice(App.doc.pi + 1, 0, newPage(p.w, p.h)); App.doc.pi++; App.sel = []; App.commit('Sisipkan halaman'); App.emit('page'); V.fitPage(); } },
  pageDup: { l: 'Duplikat halaman', en: doc, run: () => { const p = JSON.parse(JSON.stringify(App.page)); p.id = 'P' + Date.now().toString(36); p.layers.forEach(l => { l.id = 'L' + Math.random().toString(36).slice(2, 8); l.objs.forEach(o => cloneObjIn(o)); }); p.cur = p.layers[p.layers.length - 1].id; App.doc.pages.splice(App.doc.pi + 1, 0, p); App.doc.pi++; App.sel = []; App.commit('Duplikat halaman'); App.emit('page'); } },
  pageDel: { l: 'Hapus halaman', en: () => doc() && App.doc.pages.length > 1, run: () => { App.doc.pages.splice(App.doc.pi, 1); App.doc.pi = Math.max(0, App.doc.pi - 1); App.sel = []; App.commit('Hapus halaman'); App.emit('page'); V.fitPage(); } },
  pageRename: { l: 'Ganti nama halaman…', en: doc, run: async () => { const v = await App.ui.prompt('Nama halaman', App.page.name || `Halaman ${App.doc.pi + 1}`); if (v != null) { App.page.name = v; App.commit('Ganti nama halaman'); App.emit('page'); } } },
  pageSetup: { l: 'Tata letak halaman…', i: 'page', en: doc, run: () => ui('pagesetup') },
  pageBg: { l: 'Latar halaman…', en: doc, run: () => ui('pagesetup', 'bg') },
  pageOrient: { l: 'Ganti orientasi halaman', en: doc, run: () => { const p = App.page; [p.w, p.h] = [p.h, p.w]; App.commit('Orientasi halaman'); V.fitPage(); } },
  pageNext: { l: 'Halaman berikutnya', k: 'PgDn', en: () => doc() && App.doc.pi < App.doc.pages.length - 1, run: () => App.ui.gotoPage?.(App.doc.pi + 1) },
  pagePrev: { l: 'Halaman sebelumnya', k: 'PgUp', en: () => doc() && App.doc.pi > 0, run: () => App.ui.gotoPage?.(App.doc.pi - 1) },
  guideSetup: { l: 'Garis bantu…', en: doc, run: () => ui('guides') },
  gridSetup: { l: 'Kisi dan penggaris…', en: doc, run: () => ui('options', 'grid') },
  guidesClear: { l: 'Hapus semua garis bantu', en: () => doc() && App.page.guides.length, run: () => { App.page.guides = []; App.commit('Hapus garis bantu'); } },
  guidesMargin: { l: 'Garis bantu margin halaman (10 mm)', en: doc, run: () => { const p = App.page, m = 10; p.guides.push({ o: 'v', v: m }, { o: 'v', v: p.w - m }, { o: 'h', v: m }, { o: 'h', v: p.h - m }); App.commit('Garis bantu margin'); } },
  guidesCenter: { l: 'Garis bantu tengah halaman', en: doc, run: () => { const p = App.page; p.guides.push({ o: 'v', v: p.w / 2 }, { o: 'h', v: p.h / 2 }); App.commit('Garis bantu tengah'); } },
  // ----- Object
  insertQR: { l: 'Sisipkan kode QR…', i: 'qr', en: doc, run: () => ui('qr') },
  insertBarcode: { l: 'Sisipkan barcode…', i: 'barcode', en: doc, run: () => ui('barcode') },
  transform: { l: 'Transformasi', k: 'Alt+F7', i: 'xform', en: doc, run: () => dock('transform') },
  alignDock: { l: 'Rata dan distribusi…', k: 'Mod+Shift+L', i: 'aleft', en: doc, run: () => dock('align') },
  alignL: { l: 'Rata kiri', k: 'L', i: 'aleft', en: has(1), run: () => Op.align('l') },
  alignR: { l: 'Rata kanan', k: 'R', i: 'aright', en: has(1), run: () => Op.align('r') },
  alignT: { l: 'Rata atas', k: 'T', i: 'atop', en: has(1), run: () => Op.align('t') },
  alignB: { l: 'Rata bawah', k: 'B', i: 'abottom', en: has(1), run: () => Op.align('b') },
  alignHC: { l: 'Rata tengah horizontal', k: 'C', i: 'ahc', en: has(1), run: () => Op.align('hc') },
  alignVC: { l: 'Rata tengah vertikal', k: 'E', i: 'avc', en: has(1), run: () => Op.align('vc') },
  centerPage: { l: 'Tengahkan ke halaman', k: 'P', i: 'center', en: has(1), run: () => Op.align('c', { to: 'page' }) },
  distH: { l: 'Distribusi tengah horizontal', i: 'dh', en: has(3), run: () => Op.distribute('hc') },
  distV: { l: 'Distribusi tengah vertikal', i: 'dv', en: has(3), run: () => Op.distribute('vc') },
  distSH: { l: 'Spasi horizontal sama', i: 'dsh', en: has(3), run: () => Op.distribute('hs') },
  distSV: { l: 'Spasi vertikal sama', i: 'dsv', en: has(3), run: () => Op.distribute('vs') },
  toFront: { l: 'Ke depan halaman', k: 'Mod+Home', i: 'tofront', en: has(1), run: () => Op.order('front') },
  toFront2: { l: 'Ke depan lapisan', k: 'Shift+PgUp', hidden: true, run: () => Op.order('front') },
  toBack: { l: 'Ke belakang halaman', k: 'Mod+End', i: 'toback', en: has(1), run: () => Op.order('back') },
  toBack2: { l: 'Ke belakang lapisan', k: 'Shift+PgDn', hidden: true, run: () => Op.order('back') },
  forward: { l: 'Maju satu', k: 'Mod+PgUp', i: 'fwd', en: has(1), run: () => Op.order('fwd') },
  backward: { l: 'Mundur satu', k: 'Mod+PgDn', i: 'bwd', en: has(1), run: () => Op.order('bwd') },
  inFront: { l: 'Di depan objek…', en: has(1), run: () => App.ui.pickObject('Klik objek yang akan berada di belakang', t => Op.placeRelative(t, true)) },
  behind: { l: 'Di belakang objek…', en: has(1), run: () => App.ui.pickObject('Klik objek yang akan berada di depan', t => Op.placeRelative(t, false)) },
  reverseOrder: { l: 'Balik urutan', en: has(2), run: () => Op.order('reverse') },
  group: { l: 'Kelompokkan', k: 'Mod+G', i: 'group', en: has(1), run: () => Op.group() },
  ungroup: { l: 'Pisahkan kelompok', k: 'Mod+U', i: 'ungroup', en: () => sel().some(o => o.type === 'g'), run: () => Op.ungroup() },
  ungroupAll: { l: 'Pisahkan semua kelompok', i: 'ungroupall', en: () => sel().some(o => o.type === 'g'), run: () => Op.ungroup(sel(), true) },
  combine: { l: 'Kombinasikan', k: 'Mod+L', i: 'combine', en: has(2), run: () => Op.combine() },
  breakApart: { l: 'Pisahkan (Break apart)', k: 'Mod+K', i: 'breakapart', en: has(1), run: () => Op.breakApart() },
  lock: { l: 'Kunci objek', i: 'lock', en: has(1), run: () => Op.lock(true) },
  unlock: { l: 'Buka kunci objek', i: 'unlock', en: has(1), run: () => Op.lock(false) },
  unlockAll: { l: 'Buka kunci semua objek', en: doc, run: () => Op.unlockAll() },
  weld: { l: 'Las (Weld)', i: 'weld', en: has(2), run: () => Op.shaping('weld') },
  trim: { l: 'Pangkas (Trim)', i: 'trim', en: has(2), run: () => Op.shaping('trim') },
  intersect: { l: 'Irisan (Intersect)', i: 'intersect', en: has(2), run: () => Op.shaping('int') },
  simplify: { l: 'Sederhanakan', i: 'simplify', en: has(2), run: () => Op.shaping('simplify') },
  fmb: { l: 'Depan kurangi belakang', i: 'fmb', en: has(2), run: () => Op.shaping('fmb') },
  bmf: { l: 'Belakang kurangi depan', i: 'bmf', en: has(2), run: () => Op.shaping('bmf') },
  boundary: { l: 'Batas (Boundary)', i: 'boundary', en: has(1), run: () => Op.shaping('boundary') },
  shapingDock: { l: 'Pembentukan…', i: 'weld', en: doc, run: () => dock('shaping') },
  toCurves: { l: 'Konversi ke kurva', k: 'Mod+Q', i: 'tocurves', en: has(1), run: () => Op.convertToCurves() },
  outlineToObj: { l: 'Konversi kerangka ke objek', k: 'Mod+Shift+Q', en: has(1), run: () => Op.outlineToObject() },
  closePath: { l: 'Tutup jalur', en: () => sel().some(o => o.type === 'curve'), run: () => { sel().forEach(o => { if (o.type === 'curve') o.p.sp.forEach(s => { if (s.n.length > 2) s.c = true; }); }); App.commit('Tutup jalur'); } },
  mirrorH: { l: 'Cermin horizontal', i: 'mirrorh', en: has(1), run: () => Op.mirror(true) },
  mirrorV: { l: 'Cermin vertikal', i: 'mirrorv', en: has(1), run: () => Op.mirror(false) },
  rot90: { l: 'Putar 90° berlawanan jarum jam', i: 'rotl', en: has(1), run: () => Op.rotateSel(90) },
  rot90r: { l: 'Putar 90° searah jarum jam', i: 'rotr', en: has(1), run: () => Op.rotateSel(-90) },
  clearXform: { l: 'Hapus transformasi', en: has(1), run: () => { for (const o of sel()) { if (!o.tf) continue; const b0 = objBox(o); o.tf = [1, 0, 0, 1, o.tf[4], o.tf[5]]; const b1 = objBox(o); if (b0 && b1) applyM(o, T(b0.x + b0.w / 2 - b1.x - b1.w / 2, b0.y + b0.h / 2 - b1.y - b1.h / 2)); } App.commit('Hapus transformasi'); } },
  pcInside: { l: 'Tempatkan di dalam bingkai…', i: 'powerclip', en: has(1), run: () => { const items = [...sel()]; App.ui.pickObject('Klik objek bingkai PowerClip', t => Op.powerclipInto(t, items)); } },
  pcEdit: { l: 'Edit isi PowerClip', en: () => one() && !!sel()[0].pc?.length, run: () => Op.isolate(sel()[0]) },
  pcExtract: { l: 'Ekstrak isi', en: () => sel().some(o => o.pc?.length), run: () => Op.powerclipExtract() },
  isolate: { l: 'Edit grup/isi terpisah', hidden: true, run: o => Op.isolate(o || sel()[0]) },
  isoEnd: { l: 'Selesai mengedit', hidden: true, en: () => !!App.isolate, run: () => Op.endIsolate() },
  props: { l: 'Properti objek', k: 'Alt+Enter', i: 'props', run: () => dock('props') },
  objects: { l: 'Objek (lapisan)', i: 'layer', run: () => dock('objects') },
  // ----- Effects
  adjustDock: { l: 'Efek…', i: 'fx', run: () => dock('effects') },
  contourDock: { l: 'Kontur…', k: 'Mod+F9', i: 'contour', en: doc, run: () => dock('contour') },
  blendDock: { l: 'Campuran…', i: 'blend', en: doc, run: () => dock('blend') },
  lensDock: { l: 'Lensa…', k: 'Alt+F3', i: 'lens', en: doc, run: () => dock('lens') },
  envelope: { l: 'Amplop', k: 'Mod+F7', i: 'envelope', en: has(1), run: () => App.setTool('envelope') },
  addPersp: { l: 'Tambahkan perspektif', i: 'persp', en: has(1), run: () => { for (const o of sel()) { if (o.type === 'g') continue; o.fx = o.fx || {}; const g = geom(o); o.fx.persp = perspInit(bbox(g.local || g.p)); } App.commit('Tambahkan perspektif'); App.setTool('shape'); } },
  clearPersp: { l: 'Hapus perspektif', en: () => sel().some(o => o.fx?.persp), run: () => Op.clearEffect('persp') },
  clearEnv: { l: 'Hapus amplop', en: () => sel().some(o => o.fx?.env), run: () => Op.clearEffect('env') },
  dropShadow: { l: 'Bayangan jatuh', i: 'shadow', en: has(1), run: () => setFxFor('sh', { ...App.fxopt.sh, x: 1.5, y: 1.5 }) },
  innerGlow: { l: 'Pendaran (glow)', en: has(1), run: () => setFxFor('sh', { ...App.fxopt.sh, x: 0, y: 0, b: 4, c: '#ffb703', o: .9 }) },
  extrude: { l: 'Ekstrusi', i: 'extrude', en: has(1), run: () => setFxFor('ext', { ...App.fxopt.ext, vp: [110, -90] }) },
  blockShadow: { l: 'Bayangan blok', i: 'block', en: has(1), run: () => setFxFor('bs', { ...App.fxopt.bs, x: 2.5, y: 2.5 }) },
  contour: { l: 'Kontur (cepat)', i: 'contour', en: has(1), run: () => setFxFor('ct', App.fxopt.ct) },
  blend: { l: 'Campurkan dua objek', i: 'blend', en: () => sel().length === 2, run: () => blendSel() },
  distort: { l: 'Distorsi', i: 'distort', en: has(1), run: () => App.setTool('distort') },
  clearFx: { l: 'Hapus semua efek', en: has(1), run: () => { for (const o of sel()) { delete o.fx; o.tr = null; } App.refreshSel(); App.commit('Hapus efek'); } },
  copyFx: { l: 'Salin efek dari…', en: has(1), run: () => ui('copyprops', 'fx') },
  separate: { l: 'Pisahkan efek (Break apart)', en: () => sel().some(o => o.type === 'blend' || o.fx?.ct || o.fx?.ext || o.fx?.bs), run: async () => { const out = []; for (const o of sel()) out.push(...(o.type === 'blend' || o.fx?.ct || o.fx?.ext || o.fx?.bs ? await Op.separateEffect(o) : [o])); App.sel = out; App.commit('Pisahkan efek'); } },
  // ----- Bitmaps
  toBitmap: { l: 'Konversi ke bitmap…', i: 'bitmap', en: has(1), run: () => ui('tobitmap') },
  trace: { l: 'Trace bitmap (PowerTRACE)…', i: 'trace', en: () => one() && sel()[0].type === 'img', run: () => ui('trace') },
  autoTrace: { l: 'Trace Otomatis (garis presisi)…', i: 'trace', run: () => import('./ui/autotrace.js').then(m => m.openAutoTrace({ obj: one() && sel()[0].type === 'img' ? sel()[0] : null })) },
  importTrace: { l: 'Impor gambar & Trace Otomatis…', i: 'import', run: () => import('./ui/autotrace.js').then(m => m.openAutoTrace({ pick: true })) },
  quickTrace: { l: 'Trace cepat', en: () => one() && sel()[0].type === 'img', run: async () => { const { traceBitmap } = await import('./io.js'); const n = await traceBitmap(sel()[0], 'clip', { keep: false }); toast(`Trace selesai: ${n} objek`); } },
  bitmapFx: { l: 'Penyesuaian & efek bitmap…', i: 'image', en: () => one() && sel()[0].type === 'img', run: () => ui('bitmapfx') },
  resample: { l: 'Ubah resolusi…', en: () => one() && sel()[0].type === 'img', run: () => ui('bitmapfx', 'resample') },
  cropBitmap: { l: 'Pangkas bitmap ke bingkai', en: () => one() && sel()[0].type === 'img' && false, run: () => { } },
  // ----- Text
  textProps: { l: 'Properti teks…', k: 'Mod+T', i: 'text', run: () => dock('text') },
  fitPath: { l: 'Sesuaikan teks ke jalur', i: 'fit', en: () => sel().some(o => o.type === 'text'), run: () => fitToPath() },
  straighten: { l: 'Luruskan teks', en: () => sel().some(o => o.type === 'text' && o.tp), run: () => { sel().forEach(o => { delete o.tp; }); App.commit('Luruskan teks'); } },
  toPara: { l: 'Konversi ke teks paragraf', en: () => sel().some(o => o.type === 'text' && o.mode !== 'para'), run: () => { sel().forEach(o => { if (o.type !== 'text') return; const g = geom(o); o.mode = 'para'; o.w = Math.max(10, (g.lay?.w || 50) + 1); o.h = Math.max(8, (g.lay?.h || 20) + 1); }); App.commit('Ke teks paragraf'); } },
  toArt: { l: 'Konversi ke teks artistik', en: () => sel().some(o => o.type === 'text' && o.mode === 'para'), run: () => { sel().forEach(o => { if (o.type === 'text') o.mode = 'art'; }); App.commit('Ke teks artistik'); } },
  caseUp: { l: 'HURUF BESAR', en: () => sel().some(o => o.type === 'text'), run: () => setCase('up') },
  caseLow: { l: 'huruf kecil', en: () => sel().some(o => o.type === 'text'), run: () => setCase('low') },
  caseTitle: { l: 'Huruf Judul', en: () => sel().some(o => o.type === 'text'), run: () => setCase('title') },
  caseNone: { l: 'Huruf asli', en: () => sel().some(o => o.type === 'text'), run: () => setCase(undefined) },
  lorem: { l: 'Sisipkan teks contoh', en: doc, run: () => { const p = App.page; const o = mk('text', { ...App.textDef, mode: 'para', w: Math.min(120, p.w * .7), h: 60, s: 'Desain yang baik dimulai dari ide sederhana. Susun teks, warna, dan bentuk dengan seimbang agar pesan tersampaikan dengan jelas dan menarik bagi pembaca.\n\nGunakan hierarki tipografi, ruang kosong yang cukup, dan kontras warna untuk membimbing mata.', sz: 11, tf: T(p.w * .15, p.h * .3) }); App.add(o, 'Sisipkan teks contoh'); } },
  // ----- Table
  tableNew: { l: 'Tabel baru…', i: 'table', en: doc, run: () => ui('table') },
  tableRowAdd: { l: 'Sisipkan baris', en: () => one() && sel()[0].type === 'table', run: () => tableEdit('row+') },
  tableColAdd: { l: 'Sisipkan kolom', en: () => one() && sel()[0].type === 'table', run: () => tableEdit('col+') },
  tableRowDel: { l: 'Hapus baris terakhir', en: () => one() && sel()[0].type === 'table' && sel()[0].rh.length > 1, run: () => tableEdit('row-') },
  tableColDel: { l: 'Hapus kolom terakhir', en: () => one() && sel()[0].type === 'table' && sel()[0].cw.length > 1, run: () => tableEdit('col-') },
  tableHeader: { l: 'Tebalkan baris judul', en: () => one() && sel()[0].type === 'table', run: () => { const o = sel()[0]; (o.cells[0] || []).forEach(c => { c.b = !c.b; c.f = c.b ? '#e8eef7' : null; }); App.commit('Baris judul'); } },
  tableToGroup: { l: 'Konversi tabel ke kurva', en: () => one() && sel()[0].type === 'table', run: () => Op.convertToCurves() },
  // ----- Tools / window
  options: { l: 'Opsi…', k: 'Mod+J', i: 'gear', run: () => ui('options') },
  shortcuts: { l: 'Pintasan keyboard', k: 'Mod+/', i: 'help', run: () => ui('shortcuts') },
  colorDock: { l: 'Warna', i: 'wheel', run: () => dock('color') },
  historyDock: { l: 'Riwayat', i: 'history', run: () => dock('history') },
  palettes: { l: 'Palet warna…', i: 'palette', run: () => App.ui.paletteMenu?.() },
  themes: { l: 'Tema & liquid glass…', i: 'theme', run: () => ui('options', 'theme') },
  resetWs: { l: 'Atur ulang ruang kerja', run: () => { App.set('dockers', ['props', 'objects']); App.set('dockW', 290); App.ui.layoutDockers?.(); toast('Ruang kerja diatur ulang'); } },
  about: { l: 'Tentang Amatu Draw', i: 'info', run: () => ui('about') },
  menuSearch: { l: 'Cari perintah…', k: 'Mod+Shift+P', i: 'search', run: () => App.ui.focusSearch?.() },
  // ----- node editing (shape tool)
  nAdd: { l: 'Tambah node', i: 'addnode', run: () => NodeOps.add() },
  nDel: { l: 'Hapus node', i: 'delnode', run: () => NodeOps.del() },
  nJoin: { l: 'Gabungkan dua node', i: 'joinnode', run: () => NodeOps.join() },
  nBreak: { l: 'Pecah kurva', i: 'breaknode', run: () => NodeOps.breakAt() },
  nLine: { l: 'Konversi ke garis', i: 'toline', run: () => NodeOps.toLine() },
  nCurve: { l: 'Konversi ke kurva', i: 'tocurve', run: () => NodeOps.toCurve() },
  nCusp: { l: 'Node sudut (cusp)', i: 'cusp', run: () => NodeOps.setType(0) },
  nSmooth: { l: 'Node mulus', i: 'smoothn', run: () => NodeOps.setType(1) },
  nSymm: { l: 'Node simetris', i: 'symm', run: () => NodeOps.setType(2) },
  nReverse: { l: 'Balik arah', i: 'reverse', run: () => NodeOps.reverse() },
  nExtend: { l: 'Perpanjang kurva untuk menutup', i: 'extend', run: () => NodeOps.join(true) },
  nClose: { l: 'Tutup kurva otomatis', i: 'closec', run: () => NodeOps.closeAll() },
  nReduce: { l: 'Kurangi node', i: 'reduce', run: () => NodeOps.reduce() },
  nExtract: { l: 'Ekstrak subjalur', i: 'breakapart', run: () => NodeOps.extract() },
  nAll: { l: 'Pilih semua node', i: 'allnodes', run: () => NodeOps.selectAll() },
  nAlignH: { l: 'Ratakan node horizontal', i: 'avc', run: () => NodeOps.alignNodes('h') },
  nAlignV: { l: 'Ratakan node vertikal', i: 'ahc', run: () => NodeOps.alignNodes('v') },
};

// ---------- tool shortcuts ----------
export const TOOL_KEYS = { F5: 'freehand', F6: 'rect', F7: 'ellipse', F8: 'text', F10: 'shape', Y: 'polygon', A: 'spiral', D: 'graph', X: 'eraser', G: 'ifill', I: 'media', H: 'pan', Z: 'zoom', K: 'knife', M: 'smart', W: 'shadow', U: 'transp', N: 'pen' };

// ---------- helpers ----------
function assetsOf(list) { const a = {}; walk(list, o => { if (o.asset) a[o.asset] = App.doc.assets[o.asset]; if (o.fill?.asset) a[o.fill.asset] = App.doc.assets[o.fill.asset]; }); return a; }
function cloneObjIn(o) { o.id = 'o' + Math.random().toString(36).slice(2, 10); (o.ch || []).forEach(cloneObjIn); (o.pc || []).forEach(cloneObjIn); if (o.type === 'blend') { cloneObjIn(o.a); cloneObjIn(o.b); } }
function writeSys() {
  try { const txt = JSON.stringify({ amatudraw: 1, ...App.clipboard }); navigator.clipboard?.writeText(txt).catch(() => { }); } catch { }
}
async function pasteClip(inPlace = false) {
  if (!App.doc) return;
  let clip = App.clipboard;
  try {
    const items = await navigator.clipboard.read?.();
    for (const it of items || []) {
      const imgType = it.types.find(t => t.startsWith('image/'));
      if (imgType && !it.types.includes('text/plain')) { const blob = await it.getType(imgType); const { importFiles } = await import('./io.js'); return importFiles([new File([blob], 'tempel.' + imgType.split('/')[1], { type: imgType })]); }
      if (it.types.includes('text/plain')) {
        const txt = await (await it.getType('text/plain')).text();
        if (txt.startsWith('{"amatudraw"')) { clip = JSON.parse(txt); break; }
        if (/^\s*<svg[\s>]/.test(txt) || txt.includes('<svg')) { const { importSVG } = await import('./io.js'); const objs = importSVG(txt); if (objs.length) { App.add(objs, 'Tempel SVG'); return; } }
        if (!clip && txt.trim()) { const p = App.page; App.add(mk('text', { ...App.textDef, s: txt.slice(0, 5000), tf: T(p.w * .1, p.h * .1) }), 'Tempel teks'); return; }
      }
    }
  } catch { }
  if (!clip) return toast('Papan klip kosong');
  Object.assign(App.doc.assets, clip.assets || {});
  const objs = deep(clip.objs).map(o => { cloneObjIn(o); return o; });
  if (!inPlace) { const b = selBox(objs); if (b && App.clipboard?.objs && JSON.stringify(App.clipboard.objs) === JSON.stringify(clip.objs)) { /* same doc paste: offset slightly */ objs.forEach(o => applyM(o, T(App.settings.dupOffset[0], App.settings.dupOffset[1]))); } }
  App.add(objs, 'Tempel');
}
function setCase(c) { sel().forEach(o => { if (o.type === 'text') o.cap = c; }); App.commit('Ubah huruf'); }
function tableEdit(k) {
  const o = sel()[0];
  if (k === 'row+') { const h = o.rh[o.rh.length - 1]; o.rh.push(h); o.cells.push(o.cw.map(() => ({ t: '' }))); applyResize(o); }
  if (k === 'col+') { const w = o.cw[o.cw.length - 1]; o.cw.push(w); o.cells.forEach(r => r.push({ t: '' })); applyResize(o); }
  if (k === 'row-') { o.rh.pop(); o.cells.pop(); applyResize(o); }
  if (k === 'col-') { o.cw.pop(); o.cells.forEach(r => r.pop()); applyResize(o); }
  App.commit('Edit tabel');
}
function applyResize(o) { o.w = o.cw.reduce((a, b) => a + b, 0); o.h = o.rh.reduce((a, b) => a + b, 0); }
function blendSel() {
  const [a, b] = sel(), wa = App.where(a), wb = App.where(b);
  if (wa.list !== wb.list) return toast('Kedua objek harus berada di lapisan yang sama');
  const L = wa.list, [lo, hi] = L.indexOf(a) < L.indexOf(b) ? [a, b] : [b, a];
  const bl = mk('blend', { a: lo, b: hi, ...deep(App.fxopt.blend) });
  L.splice(L.indexOf(hi), 1); L.splice(L.indexOf(lo), 1, bl); App.dirtyIndex();
  App.sel = [bl]; App.commit('Campuran');
}
function fitToPath() {
  const texts = sel().filter(o => o.type === 'text'), paths = sel().filter(o => o.type !== 'text');
  const go = t => { for (const o of texts) { o.tp = { id: t.id, off: 0, side: 0 }; o.mode = 'art'; } App.commit('Sesuaikan teks ke jalur'); };
  if (paths.length) return go(paths[0]);
  App.ui.pickObject('Klik jalur/objek untuk menempatkan teks', go);
}

export function run(id, ...a) {
  const c = C[id];
  if (!c) return console.warn('cmd?', id);
  if (c.en && !c.en()) return;
  try { const r = c.run(...a); if (r?.catch) r.catch(e => { console.error(e); toast('Gagal: ' + e.message, 'err'); }); } catch (e) { console.error(e); toast('Gagal: ' + e.message, 'err'); }
}
App.run = run;

// ---------- keyboard ----------
const keymap = new Map();
for (const id in C) if (C[id].k) keymap.set(C[id].k, id);
export function bindKeys() {
  addEventListener('keydown', e => {
    const t = e.target;
    const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (typing) { if (e.key === 'Escape') t.blur(); return; }
    if (App.ui.modalOpen?.()) return;
    if (e.key === ' ' && !e.repeat && App.doc && !App.startOn) {
      e.preventDefault();
      if (App.toolId === 'pick') { if (App.prevTool && App.prevTool !== 'pick') App.setTool(App.prevTool); }
      else App.setTool('pick');
      return;
    }
    if (App.tool?.key?.(e)) { e.preventDefault(); return; }
    const k = keyId(e);
    let id = keymap.get(k);
    if (!id && !isMac && e.ctrlKey) id = keymap.get(k);
    if (id) { e.preventDefault(); run(id); return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && App.doc && !App.startOn) {
      const tk = TOOL_KEYS[e.key.length === 1 ? e.key.toUpperCase() : e.key];
      if (tk && !(e.key.length === 1 && e.shiftKey)) { e.preventDefault(); App.setTool(tk); return; }
      if (e.key.startsWith('Arrow') && App.sel.length) {
        e.preventDefault();
        const st = e.shiftKey ? App.settings.superNudge : App.settings.nudge;
        const [dx, dy] = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
        App.sel.forEach(o => applyM(o, T(dx, dy)));
        clearTimeout(bindKeys._t); App.render(); App.emit('sel');
        bindKeys._t = setTimeout(() => App.commit('Geser'), 350);
      }
    }
    if (e.key === 'F12' && !e.shiftKey) { e.preventDefault(); ui('outline'); }
    if (e.key === 'F12' && e.shiftKey) { e.preventDefault(); ui('fill', 'outline'); }
    if (e.key === 'F11' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); ui('fill', e.shiftKey ? 'solid' : 'grad'); }
  });
  addEventListener('keydown', e => { if (e.key === ' ') V.spaceDown = false; });
  addEventListener('copy', e => { if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return; });
  // Every change is written to the browser store ~1.5 s after editing stops (plus a 10 s safety net).
  const autosaveAll = () => { for (const d of App.docs) if (d._dirty && d._as !== d.modified) { d._as = d.modified; autosave(d); } };
  let asT = 0;
  App.on('change', () => { clearTimeout(asT); asT = setTimeout(autosaveAll, 1500); });
  setInterval(autosaveAll, 10000);
  addEventListener('pagehide', () => { for (const d of App.docs) if (d._dirty) autosave(d); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) for (const d of App.docs) if (d._dirty) autosave(d); });
}
export { envInit, S, cloneObj, newLayer };
