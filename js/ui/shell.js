// Window chrome: menu bar, standard toolbar, document tabs, toolbox with flyouts, colour palette,
// document palette, page navigator, status bar, context menu, command search.
import { App } from '../app.js';
import { V } from '../view.js';
import { C, run, TOOL_KEYS } from '../commands.js';
import { icon, LOGO } from '../icons.js';
import { h, kbd, fmtU, toast, mixHex, rgb2cmyk, hex2rgb } from '../util.js';
import { ib, sep, popup, closeMenus, ddButton } from './widgets.js';
import { PALETTES, fillColor } from '../fills.js';
import { objBox, selBox } from '../objgeom.js';
import { typeLabel } from '../shapes.js';
import { objName, walkDoc } from '../model.js';
import { Store, serialize } from '../io.js';
import { pickColor } from './colorpicker.js';

const $ = id => document.getElementById(id);
const M = id => {
  if (id === '-') return '-';
  if (typeof id === 'object') return id;
  const c = C[id]; if (!c) return null;
  return { l: c.l, k: c.k, i: c.i, ck: c.ck, en: c.en, run: () => run(id) };
};
const sub = (l, ids, i) => ({ l, i, sub: () => ids.map(M) });

// ---------- Menus ----------
export const MENUS = [
  ['Berkas', () => [M('new'), M('newTpl'), M('open'), { l: 'Buka terbaru', i: 'clock', sub: recentMenu }, '-', M('save'), M('saveAs'), M('revert'), '-', M('import'), M('importTrace'), M('export'), M('exportPDF'), M('exportWeb'), '-', M('print'), '-', M('docProps'), M('start'), '-', M('close'), M('closeAll')]],
  ['Edit', () => [M('undo'), M('redo'), M('historyDock'), '-', M('cut'), M('copy'), M('paste'), M('pasteInPlace'), M('delete'), '-', M('duplicate'), M('clone'), M('stepRepeat'), M('copyProps'), '-', sub('Pilih semua', ['selectAll', 'selectText', 'selectGuides']), '-', M('find'), M('insertChar')]],
  ['Tampilan', () => [M('wire'), '-', M('rulers'), M('grid'), M('guides'), M('bleed'), '-', sub('Kunci ke', ['snapObjects', 'snapGrid', 'snapGuides', 'snapPage', 'dynGuides', '-', 'snapOff'], 'magnet'), '-', M('zoomIn'), M('zoomOut'), M('zoom100'), M('zoomPage'), M('zoomWidth'), M('zoomAll'), M('zoomSel'), '-', M('full')]],
  ['Tata Letak', () => [M('pageAdd'), M('pageDup'), M('pageRename'), M('pageDel'), '-', M('pageNext'), M('pagePrev'), '-', M('pageSetup'), M('pageBg'), M('pageOrient'), '-', M('guideSetup'), M('guidesMargin'), M('guidesCenter'), M('guidesClear'), M('gridSetup')]],
  ['Objek', () => [M('insertQR'), M('insertBarcode'), '-', sub('Transformasi', ['transform', 'mirrorH', 'mirrorV', 'rot90', 'rot90r', 'clearXform'], 'xform'), sub('Rata dan distribusi', ['alignL', 'alignR', 'alignT', 'alignB', 'alignHC', 'alignVC', 'centerPage', '-', 'distH', 'distV', 'distSH', 'distSV', '-', 'alignDock'], 'aleft'), sub('Urutan', ['toFront', 'toBack', 'forward', 'backward', 'inFront', 'behind', 'reverseOrder'], 'tofront'), '-', M('group'), M('ungroup'), M('ungroupAll'), '-', M('combine'), M('breakApart'), '-', sub('Pembentukan', ['weld', 'trim', 'intersect', 'simplify', 'fmb', 'bmf', 'boundary', '-', 'shapingDock'], 'weld'), sub('PowerClip', ['pcInside', 'pcEdit', 'pcExtract'], 'powerclip'), '-', M('toCurves'), M('outlineToObj'), M('closePath'), '-', M('lock'), M('unlock'), M('unlockAll'), '-', M('objects'), M('props')]],
  ['Efek', () => [M('adjustDock'), M('contourDock'), M('blendDock'), M('lensDock'), '-', M('envelope'), M('clearEnv'), M('addPersp'), M('clearPersp'), M('distort'), '-', M('dropShadow'), M('innerGlow'), M('extrude'), M('blockShadow'), M('contour'), M('blend'), '-', M('separate'), M('copyFx'), M('clearFx')]],
  ['Bitmap', () => [M('autoTrace'), '-', M('toBitmap'), '-', M('trace'), M('quickTrace'), '-', M('bitmapFx'), M('resample')]],
  ['Teks', () => [M('textProps'), '-', M('fitPath'), M('straighten'), '-', M('toPara'), M('toArt'), '-', sub('Ubah huruf', ['caseUp', 'caseLow', 'caseTitle', 'caseNone']), '-', M('insertChar'), M('find'), M('lorem')]],
  ['Tabel', () => [M('tableNew'), '-', M('tableRowAdd'), M('tableColAdd'), M('tableRowDel'), M('tableColDel'), M('tableHeader'), '-', M('tableToGroup')]],
  ['Alat', () => [M('options'), M('shortcuts'), '-', M('colorDock'), M('palettes'), '-', M('objects'), M('historyDock'), '-', M('themes')]],
  ['Jendela', () => [{ head: 'Docker' }, ...DOCKERS.map(([id, l, i]) => ({ l, i, ck: () => App.settings.dockers.includes(id), run: () => App.ui.toggleDocker(id) })), '-', M('palettes'), M('resetWs'), '-', { head: 'Dokumen terbuka' }, ...App.docs.map(d => ({ l: d.name + (d._dirty ? ' •' : ''), ck: () => d === App.doc && !App.startOn, run: () => App.activate(d) })), { l: 'Layar sambutan', ck: () => App.startOn, run: () => App.showStart() }]],
  ['Bantuan', () => [M('shortcuts'), M('menuSearch'), '-', M('about')]],
];
export const DOCKERS = [['props', 'Properti', 'props'], ['objects', 'Objek', 'layer'], ['transform', 'Transformasi', 'xform'], ['align', 'Rata & Distribusi', 'aleft'], ['shaping', 'Pembentukan', 'weld'], ['color', 'Warna', 'wheel'], ['effects', 'Efek', 'fx'], ['contour', 'Kontur', 'contour'], ['blend', 'Campuran', 'blend'], ['lens', 'Lensa', 'lens'], ['text', 'Teks', 'text'], ['glyphs', 'Glif', 'glyph'], ['history', 'Riwayat', 'history'], ['steprep', 'Langkah & Ulangi', 'steprep']];
async function recentMenu() {
  const list = await Store.list();
  if (!list.length) return [{ l: 'Belum ada dokumen', en: () => false }];
  return list.slice(0, 10).map(r => ({ l: r.name, i: 'doc', run: () => App.ui.openRecent(r.id) }));
}

function buildMenubar() {
  const bar = $('menubar');
  const brand = h('div', { class: 'brand', title: 'Amatu Draw' }, h('span', { class: 'bl', html: LOGO }), h('b', {}, 'Amatu'), h('span', {}, 'Draw'));
  brand.onclick = () => App.showStart();
  const nav = h('nav', { class: 'mbar', role: 'menubar' });
  let active = false;
  MENUS.forEach(([name, items]) => {
    const mi = h('button', { class: 'mi', type: 'button' }, name);
    const open = async () => {
      closeMenus(); nav.querySelectorAll('.mi').forEach(x => x.classList.remove('open'));
      mi.classList.add('open'); active = true;
      const r = mi.getBoundingClientRect();
      let list = items(); list = await Promise.all(list.map(async x => x && typeof x.sub === 'function' && x.l === 'Buka terbaru' ? { ...x, sub: await x.sub() } : x));
      const m = popup(list, r.left, r.bottom + 3);
      const obs = new MutationObserver(() => { if (!m.isConnected) { mi.classList.remove('open'); obs.disconnect(); setTimeout(() => { if (!document.querySelector('.menu')) active = false; }, 0); } });
      obs.observe(document.body, { childList: true });
    };
    mi.addEventListener('click', e => { e.stopPropagation(); if (mi.classList.contains('open')) { closeMenus(); active = false; } else open(); });
    mi.addEventListener('pointerenter', () => { if (active && document.querySelector('.menu') && !mi.classList.contains('open')) open(); });
    nav.append(mi);
  });
  const search = h('div', { class: 'msearch' }, h('span', { html: icon('search', 15) }), h('input', { id: 'cmdq', placeholder: 'Cari perintah… ' + kbd('Mod+Shift+P'), spellcheck: 'false' }));
  const q = search.querySelector('input');
  q.addEventListener('input', () => cmdSearch(q));
  q.addEventListener('focus', () => cmdSearch(q));
  q.addEventListener('keydown', e => {
    e.stopPropagation();
    const m = document.querySelector('.menu.cmdres'); if (!m) return;
    const rows = [...m.querySelectorAll('.mrow:not(.dis)')]; let i = rows.findIndex(r => r.classList.contains('kb'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[i]?.classList.remove('kb'); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; rows[i]?.classList.add('kb'); rows[i]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { (rows[i] || rows[0])?.click(); q.value = ''; q.blur(); }
    if (e.key === 'Escape') { closeMenus(); q.blur(); }
  });
  App.ui.focusSearch = () => q.focus();
  const right = h('div', { class: 'mright' }, search, ib('theme', 'Tema & liquid glass', () => run('themes')), ib('help', 'Pintasan keyboard', () => run('shortcuts')));
  bar.append(brand, nav, right);
}
function cmdSearch(q) {
  const t = q.value.trim().toLowerCase();
  const res = [];
  for (const id in C) { const c = C[id]; if (c.hidden) continue; if (!t || c.l.toLowerCase().includes(t)) res.push(M(id)); }
  const tools = Object.values(App.tools).filter(x => !t || x.name.toLowerCase().includes(t)).map(x => ({ l: x.name, i: TOOL_ICON[x.id], run: () => App.setTool(x.id) }));
  const list = [...tools.slice(0, 6), ...res].slice(0, 40);
  const r = q.getBoundingClientRect();
  popup(list.length ? list : [{ l: 'Tidak ada hasil', en: () => false }], r.left - 20, r.bottom + 6, { cls: 'cmdres', minW: 320 });
  document.querySelector('.menu.cmdres .mrow')?.classList.add('kb');
}

// ---------- Standard toolbar ----------
function buildStdbar() {
  const bar = $('stdbar');
  const b = (id, title) => { const c = C[id]; const btn = ib(c.i, title || c.l, () => run(id), { key: c.k }); btn.dataset.cmd = id; return btn; };
  const zoom = h('select', { class: 'sf zoomsel', title: 'Tingkat zoom' });
  const zl = [['fit', 'Halaman'], ['width', 'Lebar halaman'], ['all', 'Semua objek'], ['sel', 'Objek terpilih'], ['-'], ...[10, 25, 50, 75, 100, 150, 200, 300, 400, 800, 1600].map(z => [z, z + '%'])];
  const fillZoom = () => { zoom.innerHTML = ''; zoom.append(h('option', { value: 'cur', hidden: true }, Math.round(V.pct) + '%')); for (const [v, t] of zl) zoom.append(v === '-' ? h('option', { disabled: true }, '─────') : h('option', { value: v }, t)); zoom.value = 'cur'; };
  zoom.onchange = () => { const v = zoom.value; if (v === 'fit') V.fitPage(); else if (v === 'width') V.fitWidth(); else if (v === 'all') V.fitAll(); else if (v === 'sel') V.fitSel(); else V.zoomTo(+v); fillZoom(); };
  App.on('view', () => { const o = zoom.querySelector('option[value=cur]'); if (o) o.textContent = Math.round(V.pct) + '%'; });
  fillZoom();
  const snap = ddButton('Kunci ke', () => ['snapObjects', 'snapGrid', 'snapGuides', 'snapPage', 'dynGuides', '-', 'snapOff'].map(M), { icon: 'magnet', title: 'Kunci ke (snap)' });
  const undoDD = h('button', { class: 'dd-trigger mini', title: 'Riwayat urungkan', html: icon('chevd', 12) });
  undoDD.onclick = e => { e.stopPropagation(); const r = undoDD.getBoundingClientRect(); const st = App.hist?.stack || []; popup(st.map((s, i) => ({ l: s.label, ck: () => i === App.hist.i, run: () => App.goHist(i) })).reverse().slice(0, 30), r.left - 30, r.bottom + 4); };
  bar.append(b('new'), b('open'), b('save'), sep(), b('print'), sep(), b('cut'), b('copy'), b('paste'), sep(), b('undo'), undoDD, b('redo'), sep(), b('import'), b('export'), ib('doc', 'Terbitkan ke PDF', () => run('exportPDF')), sep(), zoom, ib('full', 'Layar penuh', () => run('full'), { key: 'F9' }), sep(),
    tb('rulers'), tb('grid'), tb('guides'), snap, sep(), ib('apps', 'Layar sambutan', () => run('start')), ib('gear', 'Opsi', () => run('options'), { key: 'Mod+J' }),
    h('div', { class: 'grow' }), h('div', { class: 'wsname', title: 'Ruang kerja' }, h('span', { html: icon('layout', 15) }), 'Ruang kerja: Default'));
  const upd = () => { bar.querySelectorAll('[data-cmd]').forEach(x => { const c = C[x.dataset.cmd]; x.classList.toggle('dis', !!(c.en && !c.en())); if (c.ck) x.classList.toggle('on', !!c.ck()); }); };
  App.on('sel', upd); App.on('change', upd); App.on('doc', upd); App.on('view', upd); upd();
}
const tb = id => { const c = C[id]; const b = ib(c.i, c.l, () => run(id), { key: c.k }); b.dataset.cmd = id; return b; };

// ---------- Document tabs ----------
function buildTabs() {
  const el = $('doctabs');
  const draw = () => {
    el.innerHTML = '';
    const st = h('button', { class: 'dtab start' + (App.startOn ? ' on' : ''), type: 'button' }, h('span', { html: icon('apps', 14) }), 'Layar Sambutan');
    st.onclick = () => App.showStart();
    el.append(st);
    for (const d of App.docs) {
      const t = h('div', { class: 'dtab' + (d === App.doc && !App.startOn ? ' on' : ''), title: d.name }, h('span', { class: 'dn' }, d.name), d._dirty ? h('i', { class: 'dirty' }) : null);
      const x = h('button', { class: 'dx', title: 'Tutup', html: icon('close', 12) });
      x.onclick = e => { e.stopPropagation(); App.ui.closeDoc(d); };
      t.append(x);
      t.onclick = () => { if (App.doc !== d || App.startOn) App.activate(d); };
      t.onauxclick = e => { if (e.button === 1) App.ui.closeDoc(d); };
      el.append(t);
    }
    const plus = h('button', { class: 'dtab plus', title: 'Dokumen baru', html: icon('plus', 14) });
    plus.onclick = () => run('new');
    el.append(plus);
  };
  App.on('doc', draw); App.on('change', () => { clearTimeout(draw._t); draw._t = setTimeout(draw, 120); }); App.on('closed', draw);
  draw();
}
App.ui.closeDoc = async d => {
  if (d._dirty) {
    const r = await App.ui.confirm(`Simpan perubahan pada “${d.name}”?`, 'Perubahan akan hilang jika tidak disimpan. Salinan otomatis tetap tersedia di Layar Sambutan › Terbaru.', ['Simpan', 'Jangan simpan', 'Batal']);
    if (r === 2 || r == null) return;
    if (r === 0) { App.activate(d); const { saveDoc } = await import('../io.js'); await saveDoc(d); }
  }
  App.closeDoc(d);
};

// ---------- Toolbox ----------
export const TOOL_GROUPS = [
  ['pick', 'freepick', 'xform'], ['shape', 'smooth', 'smear', 'twirl', 'attract', 'repel', 'roughen'], ['crop', 'knife', 'vsdel', 'eraser'], ['zoom', 'pan'],
  ['freehand', 'line2', 'bezier', 'pen', 'bspline', 'polyline', 'curve3', 'smart'], ['media'], ['rect', 'rect3'], ['ellipse', 'ellipse3'],
  ['polygon', 'star', 'cstar', 'graph', 'spiral'], ['shapes'], ['text'], ['table'], ['dimpar', 'dimhv', 'dimang', 'dimseg', 'leader'], ['conn'],
  ['shadow', 'contour', 'blend', 'distort', 'envelope', 'extrude', 'block'], ['transp'], ['eyedrop', 'attrdrop', 'bucket'], ['ifill', 'smartfill'],
];
export const TOOL_ICON = { pick: 'pick', freepick: 'freepick', xform: 'xform', shape: 'shape', smooth: 'smooth', smear: 'smear', twirl: 'twirl', attract: 'attract', repel: 'repel', roughen: 'roughen', crop: 'crop', knife: 'knife', vsdel: 'vsdel', eraser: 'eraser', zoom: 'zoom', pan: 'pan', freehand: 'freehand', line2: 'line2', bezier: 'bezier', pen: 'pen', bspline: 'bspline', polyline: 'polyline', curve3: 'curve3', smart: 'smart', media: 'media', rect: 'rect', rect3: 'rect3', ellipse: 'ellipse', ellipse3: 'ellipse3', polygon: 'polygon', star: 'star', cstar: 'cstar', graph: 'graph', spiral: 'spiral', shapes: 'basic', text: 'text', table: 'table', dimpar: 'dim', dimhv: 'dimhv', dimang: 'dimang', dimseg: 'dimseg', leader: 'leader', conn: 'conn', shadow: 'shadow', contour: 'contour', blend: 'blend', distort: 'distort', envelope: 'envelope', extrude: 'extrude', block: 'block', transp: 'transp', eyedrop: 'eyedrop', attrdrop: 'attrdrop', bucket: 'bucket', ifill: 'ifill', smartfill: 'smartfill' };
const KEY_OF = Object.fromEntries(Object.entries(TOOL_KEYS).map(([k, v]) => [v, k]));
function buildToolbox() {
  const el = $('toolbox');
  const cur = TOOL_GROUPS.map(g => g[0]);
  const btns = [];
  TOOL_GROUPS.forEach((g, gi) => {
    const btn = h('button', { class: 'tool' + (g.length > 1 ? ' fly' : ''), type: 'button' });
    const paint = () => { const id = cur[gi], t = App.tools[id]; btn.innerHTML = icon(id === 'shapes' ? psIcon() : TOOL_ICON[id], 20) + (g.length > 1 ? '<i class="tri"></i>' : ''); btn.title = (t?.name || id) + (KEY_OF[id] ? ` (${KEY_OF[id]})` : ''); btn.dataset.tool = id; };
    paint();
    let press;
    const openFly = () => {
      const r = btn.getBoundingClientRect();
      closeMenus();
      const m = popup(g.map(id => ({ l: App.tools[id]?.name || id, i: id === 'shapes' ? psIcon() : TOOL_ICON[id], k: KEY_OF[id], ck: () => App.toolId === id, run: () => { cur[gi] = id; paint(); App.setTool(id); } })), r.right + 6, r.top - 4, { cls: 'flyout', minW: 230 });
      m.classList.add('flyout');
    };
    btn.addEventListener('pointerdown', e => { if (g.length > 1) press = setTimeout(() => { press = null; openFly(); }, 380); });
    btn.addEventListener('pointerup', () => { if (press) { clearTimeout(press); press = null; App.setTool(cur[gi]); } });
    btn.addEventListener('click', e => { if (g.length > 1 && e.offsetX > btn.clientWidth - 12 && e.offsetY > btn.clientHeight - 12) openFly(); });
    btn.addEventListener('contextmenu', e => { e.preventDefault(); if (g.length > 1) openFly(); });
    if (g.length === 1) btn.onclick = () => App.setTool(g[0]);
    btn._g = g; btn._gi = gi; btn._paint = paint;
    el.append(btn); btns.push(btn);
    if ([3, 9, 13, 15].includes(gi)) el.append(h('div', { class: 'tsep' }));
  });
  const fillInd = h('div', { class: 'tb-attr', title: 'Isian & kerangka bawaan · klik untuk mengubah' }, h('i', { class: 'f' }), h('i', { class: 'o' }));
  el.append(h('div', { class: 'grow' }), fillInd);
  fillInd.onclick = () => App.ui.openDialog('fill');
  const upd = () => {
    btns.forEach(b => {
      const i = b._g.indexOf(App.toolId);
      if (i >= 0 && cur[b._gi] !== App.toolId) { cur[b._gi] = App.toolId; b._paint(); }
      b.classList.toggle('on', b._g.includes(App.toolId));
      if (b._g[0] === 'shapes') b._paint();
    });
    const o = App.sel[0];
    const fc = o ? fillColor(o.fill) : fillColor(App.mkDefaults?.fill), oc = o ? o.ol?.c : '#000000';
    fillInd.querySelector('.f').style.background = fc || ''; fillInd.querySelector('.f').classList.toggle('none', !fc);
    fillInd.querySelector('.o').style.borderColor = oc || 'transparent'; fillInd.querySelector('.o').classList.toggle('none', !(o ? o.ol : true));
  };
  App.on('tool', upd); App.on('sel', upd); upd();
}
const psIcon = () => ({ basic: 'basic', arrows: 'arrows', flow: 'flow', banner: 'banner', callout: 'callout', stars: 'stars' }[App.topt?.ps?.g] || 'basic');

// ---------- Colour palette ----------
export function applyColor(c, outline, mix) {
  const list = App.sel.length ? App.sel : null;
  if (!list) {
    toast(outline ? 'Tidak ada objek terpilih — pilih objek untuk mengubah warna kerangka' : 'Tidak ada objek terpilih — pilih objek untuk mengisi warna');
    App.ui.activeColor = c; return;
  }
  const set = o => {
    if (o.type === 'g') { o.ch.forEach(set); return; }
    if (o.type === 'blend') { set(o.a); set(o.b); return; }
    if (outline) { if (!c) o.ol = null; else o.ol = { ...(o.ol || { w: .2 }), c: mix && o.ol?.c ? mixHex(o.ol.c, c, .1) : c }; }
    else if (o.type === 'qr') o.fill = c ? { t: 'solid', c } : o.fill;
    else o.fill = c ? { t: 'solid', c: mix && o.fill?.t === 'solid' ? mixHex(o.fill.c, c, .1) : c } : null;
  };
  list.forEach(set);
  App.ui.activeColor = c;
  App.commit(outline ? 'Warna kerangka' : 'Warna isian');
}
function swatch(c, cls = '') {
  const s = h('button', { class: 'psw ' + cls, type: 'button', style: { background: c.hex } });
  const cm = c.cmyk || rgb2cmyk(...hex2rgb(c.hex));
  s.title = `${c.n && c.n !== c.hex ? c.n + ' · ' : ''}${c.hex.toUpperCase()} · C${cm[0]} M${cm[1]} Y${cm[2]} K${cm[3]}\nKlik: isian · Klik kanan: kerangka · ${kbd('Mod+')}klik: campur`;
  s.addEventListener('click', e => applyColor(c.hex, false, e.metaKey || e.ctrlKey));
  s.addEventListener('contextmenu', e => { e.preventDefault(); applyColor(c.hex, true, e.metaKey || e.ctrlKey); });
  s.draggable = true;
  s.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-color', c.hex); });
  return s;
}
function buildPalette() {
  const el = $('palette');
  const draw = () => {
    el.innerHTML = '';
    const pal = PALETTES[App.settings.palette] || PALETTES.cmyk;
    const none = h('button', { class: 'psw none', title: 'Tanpa warna · klik kanan: tanpa kerangka', html: icon('close', 13) });
    none.onclick = () => applyColor(null, false); none.oncontextmenu = e => { e.preventDefault(); applyColor(null, true); };
    const list = h('div', { class: 'plist' }, ...pal.cols.map(c => swatch(c)));
    const up = h('button', { class: 'pscroll', html: icon('chevu', 12), title: 'Gulir' }), dn = h('button', { class: 'pscroll', html: icon('chevd', 12), title: 'Gulir' });
    up.onclick = () => list.scrollBy({ top: -120, behavior: 'smooth' }); dn.onclick = () => list.scrollBy({ top: 120, behavior: 'smooth' });
    const menu = h('button', { class: 'pmenu', title: 'Palet warna', html: icon('palette', 15) });
    menu.onclick = e => { e.stopPropagation(); paletteMenu(menu); };
    const custom = h('button', { class: 'psw add', title: 'Warna khusus…', html: icon('plus', 13) });
    custom.onclick = () => pickColor(custom, App.sel[0] ? fillColor(App.sel[0].fill) : '#3366ff', (c, f) => { if (f && c) applyColor(c, false); });
    el.append(menu, none, up, list, dn, custom);
  };
  App.on('settings', k => { if (k === 'palette') draw(); });
  draw();
}
function paletteMenu(anchor) {
  const r = (anchor || $('palette')).getBoundingClientRect();
  popup(Object.entries(PALETTES).map(([k, p]) => ({ l: p.n, ck: () => App.settings.palette === k, run: () => App.set('palette', k) })), r.left - 230, r.top);
}
App.ui.paletteMenu = () => paletteMenu();
function buildDocPalette() {
  const el = $('docpal');
  const draw = () => {
    if (!App.doc) { el.innerHTML = ''; return; }
    const cols = new Map();
    walkDoc(App.doc, o => { const f = fillColor(o.fill); if (f) cols.set(f, 1); if (o.ol?.c) cols.set(o.ol.c, 1); if (o.fill?.st) o.fill.st.forEach(s => cols.set(s.c, 1)); });
    const arr = [...cols.keys()].slice(0, 40);
    App.doc.palette = arr;
    el.innerHTML = '';
    el.append(h('span', { class: 'dpl', title: 'Palet dokumen: warna yang dipakai di dokumen ini', html: icon('palette', 14) }), ...arr.map(c => swatch({ hex: c }, 'sm')));
  };
  App.on('change', () => { clearTimeout(draw._t); draw._t = setTimeout(draw, 300); }); App.on('doc', draw);
  draw();
}

// ---------- Page navigator ----------
function buildPagebar() {
  const el = $('pagebar');
  const go = i => { if (!App.doc) return; App.doc.pi = Math.max(0, Math.min(App.doc.pages.length - 1, i)); App.sel = []; App.isolate = null; App.dirtyIndex(); V._pg = null; App.render(); App.emit('page'); App.emit('sel'); V.fitPage(); };
  App.ui.gotoPage = go;
  const draw = () => {
    el.innerHTML = '';
    if (!App.doc) return;
    const d = App.doc, n = d.pages.length;
    el.append(ib('first', 'Halaman pertama', () => go(0), { size: 15 }), ib('chevl', 'Halaman sebelumnya', () => go(d.pi - 1), { size: 15 }),
      h('span', { class: 'pgn' }, `${d.pi + 1} dari ${n}`), ib('chevr', 'Halaman berikutnya', () => go(d.pi + 1), { size: 15 }), ib('last', 'Halaman terakhir', () => go(n - 1), { size: 15 }),
      ib('plus', 'Tambah halaman', () => run('pageAdd'), { size: 15 }));
    d.pages.forEach((p, i) => {
      const t = h('button', { class: 'ptab' + (i === d.pi ? ' on' : ''), type: 'button' }, p.name || `Halaman ${i + 1}`);
      t.onclick = () => go(i);
      t.ondblclick = () => run('pageRename');
      t.oncontextmenu = e => { e.preventDefault(); go(i); popup(['pageAdd', 'pageDup', 'pageRename', 'pageDel', '-', 'pageSetup', 'pageOrient'].map(M), e.clientX, e.clientY); };
      el.append(t);
    });
  };
  App.on('page', draw); App.on('doc', draw); App.on('change', () => { clearTimeout(draw._t); draw._t = setTimeout(draw, 150); });
  draw();
}

// ---------- Status bar ----------
function buildStatus() {
  const el = $('status');
  const pos = h('span', { class: 'st-pos' }), info = h('span', { class: 'st-info' }), hintEl = h('span', { class: 'st-hint' });
  const fsw = h('button', { class: 'st-sw', title: 'Isian · dobel klik untuk mengedit' }), osw = h('button', { class: 'st-sw ol', title: 'Kerangka · dobel klik untuk mengedit' });
  const flab = h('span', { class: 'st-lab' }), olab = h('span', { class: 'st-lab' });
  fsw.ondblclick = () => App.ui.openDialog('fill'); osw.ondblclick = () => App.ui.openDialog('outline');
  fsw.onclick = () => App.ui.openDocker('props'); osw.onclick = () => App.ui.openDocker('props');
  el.append(pos, h('i', { class: 'st-div' }), info, h('i', { class: 'st-div' }), hintEl, h('div', { class: 'grow' }), h('span', { class: 'st-attr' }, fsw, flab), h('span', { class: 'st-attr' }, osw, olab));
  const u = () => App.doc?.units || 'mm';
  App.on('cursor', ev => {
    const y = App.settings.yUp ? App.page.h - ev.y : ev.y;
    pos.textContent = `( ${fmtU(ev.x, u())} ; ${fmtU(y, u())} ) ${u()}`;
  });
  App.on('hint', t => { hintEl.textContent = t; });
  const upd = () => {
    const s = App.sel;
    if (!App.doc || App.startOn) { info.textContent = ''; return; }
    if (!s.length) info.textContent = App.isolate ? 'Mengedit isi — Esc atau dobel klik area kosong untuk selesai' : 'Tidak ada objek terpilih';
    else if (s.length === 1) {
      const o = s[0], b = objBox(o), w = App.where(o);
      info.textContent = `${o.name ? '“' + o.name + '” · ' : ''}${typeLabel(o)}${o.type === 'g' ? ` (${o.ch.length} objek)` : ''}${o.pc?.length ? ' · PowerClip' : ''}${o.fx && Object.keys(o.fx).length ? ' · efek' : ''} di ${w?.layer?.name || 'lapisan'}${b ? ` · L ${fmtU(b.w, u())} × T ${fmtU(b.h, u())} ${u()}` : ''}`;
    } else { const b = selBox(s); info.textContent = `${s.length} objek terpilih${b ? ` · L ${fmtU(b.w, u())} × T ${fmtU(b.h, u())} ${u()}` : ''}`; }
    const o = s[0];
    const fc = o && o.type !== 'g' ? fillColor(o.fill) : null, f = o?.fill;
    fsw.style.background = fc || ''; fsw.classList.toggle('none', !fc);
    flab.textContent = !o ? '' : !f ? 'Tanpa isian' : f.t === 'solid' ? f.c.toUpperCase() : f.t === 'grad' ? 'Isian gradasi' : f.t === 'pat' ? 'Isian pola' : f.t === 'tex' ? 'Isian tekstur' : 'Isian bitmap';
    const ol = o?.ol;
    osw.style.borderColor = ol?.c || 'transparent'; osw.classList.toggle('none', !ol);
    olab.textContent = !o ? '' : !ol ? 'Tanpa kerangka' : `${fmtU(ol.w, u() === 'px' ? 'px' : 'mm', 2)} ${u() === 'px' ? 'px' : 'mm'} · ${ol.c.toUpperCase()}`;
  };
  App.on('sel', upd); App.on('change', upd); App.on('doc', upd);
  upd();
}

// ---------- Context menu ----------
App.ui.contextMenu = e => {
  const s = App.sel, has = s.length > 0;
  const hit = App.view.hit(App.view.ev(e));
  if (hit && !s.includes(hit)) App.select(hit);
  const items = App.sel.length ? [
    M('cut'), M('copy'), M('paste'), M('delete'), '-', M('duplicate'), M('copyProps'), '-',
    App.sel.some(o => o.type === 'g') ? M('ungroup') : M('group'), App.sel.length > 1 ? M('combine') : M('breakApart'), M('toCurves'), '-',
    sub('Urutan', ['toFront', 'toBack', 'forward', 'backward', 'inFront', 'behind'], 'tofront'), sub('Rata', ['alignL', 'alignHC', 'alignR', 'alignT', 'alignVC', 'alignB', 'centerPage'], 'aleft'),
    App.sel.length > 1 ? sub('Pembentukan', ['weld', 'trim', 'intersect', 'simplify', 'fmb', 'bmf', 'boundary'], 'weld') : null,
    sub('PowerClip', ['pcInside', 'pcEdit', 'pcExtract'], 'powerclip'), App.sel[0]?.type === 'img' ? M('autoTrace') : null, App.sel[0]?.type === 'img' ? M('trace') : null, App.sel[0]?.type === 'text' ? M('fitPath') : null, '-',
    App.sel.every(o => o.lock) ? M('unlock') : M('lock'), M('props'),
  ] : [M('paste'), M('selectAll'), '-', M('zoomPage'), M('zoomAll'), '-', M('pageSetup'), M('pageBg'), M('guidesMargin'), '-', M('grid'), M('rulers')];
  void has;
  popup(items.filter(Boolean), e.clientX, e.clientY);
};

// ---------- Pick-an-object mode (PowerClip target, fit to path, in front of…) ----------
App.ui.pickObject = (msg, cb) => {
  const prev = App.toolId;
  const banner = h('div', { class: 'pickbanner glass-strong' }, h('span', { html: icon('pick', 16) }), msg, h('button', { class: 'btn-sm', onclick: () => end() }, 'Batal'));
  document.body.append(banner);
  V.el.classList.add('picking');
  const handler = e => {
    if (!V.el.contains(e.target)) return;
    e.stopPropagation(); e.preventDefault();
    const o = V.hit(V.ev(e));
    end();
    if (o) cb(o); else toast('Tidak ada objek di titik itu');
  };
  const end = () => { banner.remove(); V.el.classList.remove('picking'); removeEventListener('pointerdown', handler, true); if (App.toolId !== prev) App.setTool(prev); };
  addEventListener('pointerdown', handler, true);
};

export function buildShell() {
  buildMenubar(); buildStdbar(); buildTabs(); buildToolbox(); buildPalette(); buildDocPalette(); buildPagebar(); buildStatus();
}
export { serialize, objName, sep };
