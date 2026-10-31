// Modal dialogs.
import { App } from '../app.js';
import { V } from '../view.js';
import { run, C, TOOL_KEYS } from '../commands.js';
import { mk, PAGE_SIZES, walkDoc, walk } from '../model.js';
import { selBox, objBox } from '../objgeom.js';
import { T, S } from '../geom.js';
import { exportSVGString, exportRaster, exportPDF, traceBitmap, TRACE, Store } from '../io.js';
import { rasterize } from '../ops.js';
import { icon, LOGO } from '../icons.js';
import { h, kbd, toast, download, UNIT_LABEL, fmtU, fromU, toU, loadScript, clamp, deep } from '../util.js';
import { num, sel, seg, check, slider, colorBtn, textField } from './widgets.js';
import { applyTheme, THEMES, ACCENTS } from './theme.js';

let stack = [];
App.ui.modalOpen = () => stack.length > 0;
export function modal({ title, body, buttons = [['Tutup', 'cancel']], width = 520, cls = '', onClose }) {
  return new Promise(res => {
    const back = h('div', { class: 'mback' });
    const box = h('div', { class: 'modal glass-strong ' + cls, role: 'dialog', 'aria-modal': 'true', style: { width: width + 'px' } });
    const close = v => { back.remove(); stack = stack.filter(x => x !== back); onClose?.(v); res(v); };
    const head = h('div', { class: 'mdhead' }, h('h3', {}, title), h('button', { class: 'ib', title: 'Tutup', html: icon('close', 16), onclick: () => close(null) }));
    const foot = h('div', { class: 'mfoot' }, ...buttons.map(([t, v, kind]) => h('button', { class: 'btn ' + (kind || (v === 'ok' ? 'btn-primary' : 'btn-ghost')), type: 'button', onclick: async () => { if (typeof v === 'function') { const r = await v(); if (r !== false) close(r); } else close(v); } }, t)));
    box.append(head, h('div', { class: 'mbody' }, body), foot);
    back.append(box);
    back.addEventListener('pointerdown', e => { if (e.target === back) close(null); });
    back.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(null); if (e.key === 'Enter' && !/TEXTAREA/.test(e.target.tagName) && buttons.some(b => b[1] === 'ok')) { const ok = buttons.find(b => b[1] === 'ok'); setTimeout(() => foot.querySelector('.btn-primary')?.click(), 0); void ok; } });
    document.body.append(back); stack.push(back);
    setTimeout(() => (box.querySelector('input:not([type=checkbox]),select') || box.querySelector('.btn-primary'))?.focus(), 30);
  });
}
App.ui.prompt = (title, value = '') => {
  const i = h('input', { class: 'tx', value });
  return modal({ title, body: i, buttons: [['Batal', 'cancel'], ['OK', () => i.value, 'btn-primary']], width: 380 }).then(v => v === 'cancel' ? null : v);
};
App.ui.confirm = (title, text, btns = ['OK', 'Batal']) => modal({ title, body: h('p', { class: 'mtext' }, text), buttons: btns.map((b, i) => [b, i, i === 0 ? 'btn-primary' : 'btn-ghost']), width: 440 });
App.ui.editLabel = async o => { const v = await App.ui.prompt('Teks keterangan', o.txt || ''); if (v != null) { o.txt = v; App.commit('Teks keterangan'); } };
const F = (label, ...c) => h('label', { class: 'fx' }, h('span', { class: 'fx-l' }, label), ...c);
const grid2 = (...c) => h('div', { class: 'grid2' }, ...c);

// ---------- New document / page setup ----------
function pageForm(st, { forNew }) {
  const U = () => st.units;
  const wf = num({ get: () => st.w, set: v => { st.w = v; upd(); }, w: 110, min: 1, units: U }), hf = num({ get: () => st.h, set: v => { st.h = v; upd(); }, w: 110, min: 1, units: U });
  const bl = num({ get: () => st.bleed, set: v => { st.bleed = v; upd(); }, w: 110, min: 0, units: U });
  const match = () => PAGE_SIZES.find(([, w, hh]) => (Math.abs(w - st.w) < .05 && Math.abs(hh - st.h) < .05) || (Math.abs(hh - st.w) < .05 && Math.abs(w - st.h) < .05));
  const preset = sel({ options: [['', 'Ukuran khusus'], ...PAGE_SIZES.map(([n, w, hh]) => [n, `${n} — ${fmtU(w, 'mm', 1)} × ${fmtU(hh, 'mm', 1)} mm`])], get: () => match()?.[0] || '', set: v => { const m = PAGE_SIZES.find(x => x[0] === v); if (m) { const land = st.w > st.h && m[1] !== m[2]; st.w = land ? Math.max(m[1], m[2]) : m[1]; st.h = land ? Math.min(m[1], m[2]) : m[2]; } upd(); } });
  const orient = seg([['p', 'page', 'Potret'], ['l', 'layout', 'Lanskap']], () => st.w > st.h ? 'l' : 'p', v => { if ((v === 'l') !== (st.w > st.h)) [st.w, st.h] = [st.h, st.w]; upd(); });
  const unitSel = sel({ options: Object.keys(UNIT_LABEL).map(k => [k, UNIT_LABEL[k]]), get: () => st.units, set: v => { st.units = v; upd(); } });
  const bg = colorBtn({ get: () => st.bg, set: c => { st.bg = c || '#ffffff'; upd(); }, none: false });
  const prev = h('div', { class: 'pgprev' }, h('i'));
  const upd = () => {
    [wf, hf, bl, preset, orient, unitSel].forEach(x => x.refresh());
    const k = 92 / Math.max(st.w, st.h), pg = prev.firstChild;
    pg.style.width = st.w * k + 'px'; pg.style.height = st.h * k + 'px'; pg.style.background = st.bg || '#fff';
    pg.dataset.lbl = `${fmtU(st.w, st.units)} × ${fmtU(st.h, st.units)} ${st.units}`;
  };
  const body = h('div', { class: 'pgform' },
    h('div', {}, forNew ? F('Nama', textField({ get: () => st.name, set: v => { st.name = v; }, w: 300, placeholder: 'Tanpa judul' })) : null, F('Ukuran', preset),
      grid2(F('Lebar', wf), F('Tinggi', hf)), grid2(F('Satuan', unitSel), F('Orientasi', orient)),
      grid2(F('Bleed', bl), forNew ? F('Jumlah halaman', num({ unit: 'int', get: () => st.pages, set: v => { st.pages = clamp(Math.round(v), 1, 200); }, w: 110, dec: 0 })) : F('Latar halaman', bg)),
      forNew ? grid2(F('Mode warna utama', sel({ options: [['cmyk', 'CMYK (cetak)'], ['rgb', 'RGB (layar/web)']], get: () => st.mode, set: v => { st.mode = v; } })), F('Latar halaman', bg)) : check('Terapkan ke semua halaman', () => st.all, v => { st.all = v; })),
    prev);
  setTimeout(upd, 0);
  return { body };
}
const DLG = {
  new() {
    const st = { name: '', w: 210, h: 297, units: App.settings.defUnits || 'mm', pages: 1, bleed: 0, mode: 'cmyk', bg: '#ffffff' };
    const f = pageForm(st, { forNew: true });
    modal({ title: 'Buat Dokumen Baru', body: f.body, width: 620, buttons: [['Batal', 'cancel'], ['OK', 'ok']] }).then(v => {
      if (v !== 'ok') return;
      const d = App.newDocument({ name: st.name || undefined, w: st.w, h: st.h, units: st.units, pages: st.pages, bleed: st.bleed });
      d.pages.forEach(p => { p.bg = st.bg; }); d.mode = st.mode;
      V._pg = null; App.render();
    });
  },
  pagesetup(tab) {
    const p = App.page, st = { w: p.w, h: p.h, units: App.doc.units, bleed: App.doc.bleed || 0, bg: p.bg, all: false };
    const f = pageForm(st, { forNew: false });
    modal({ title: 'Tata Letak Halaman', body: f.body, width: 600, buttons: [['Batal', 'cancel'], ['OK', 'ok']] }).then(v => {
      if (v !== 'ok') return;
      for (const pg of st.all ? App.doc.pages : [p]) { pg.w = st.w; pg.h = st.h; pg.bg = st.bg; }
      App.doc.units = st.units; App.doc.bleed = st.bleed; V._pg = null;
      App.commit('Tata letak halaman'); V.fitPage(); V.drawRulers();
    });
    void tab;
  },
  export(fmt0) {
    const st = { fmt: fmt0 || 'png', scope: App.sel.length ? 'sel' : 'page', dpi: 150, q: 92, bg: 'page', pdf: 'vector', pages: 'all', bleed: 0, w: 0 };
    const prev = h('div', { class: 'exprev' }, h('div', { class: 'spinner' }));
    const info = h('div', { class: 'exinfo' });
    const opts = h('div', { class: 'exopts' });
    const fmtSeg = h('div', { class: 'fmtgrid' }, ...[['png', 'PNG', 'Gambar transparan'], ['jpg', 'JPG', 'Foto / cetak cepat'], ['webp', 'WebP', 'Web modern'], ['svg', 'SVG', 'Vektor untuk web/aplikasi lain'], ['pdf', 'PDF', 'Cetak & berbagi'], ['adraw', 'ADRAW', 'Dokumen Amatu Draw']].map(([k, t, d]) => { const b = h('button', { class: 'fmt' + (st.fmt === k ? ' on' : ''), type: 'button' }, h('b', {}, t), h('span', {}, d)); b.onclick = () => { st.fmt = k; fmtSeg.querySelectorAll('.fmt').forEach(x => x.classList.toggle('on', x === b)); build(); }; return b; }));
    const build = () => {
      opts.innerHTML = '';
      const raster = ['png', 'jpg', 'webp'].includes(st.fmt);
      if (st.fmt !== 'pdf' && st.fmt !== 'adraw') opts.append(F('Cakupan', sel({ options: [['page', 'Halaman ini'], ...(App.sel.length ? [['sel', 'Objek terpilih saja']] : [])], get: () => st.scope, set: v => { st.scope = v; preview(); } })));
      if (raster) {
        opts.append(grid2(F('Resolusi', sel({ options: [['72', '72 dpi (layar)'], ['96', '96 dpi'], ['150', '150 dpi'], ['300', '300 dpi (cetak)'], ['600', '600 dpi']], get: () => String(st.dpi), set: v => { st.dpi = +v; st.w = 0; preview(); } })), F('Lebar khusus (px)', num({ unit: 'int', get: () => st.w || null, set: v => { st.w = Math.round(v); preview(); }, w: 110, dec: 0 }))),
          F('Latar', sel({ options: st.fmt === 'png' ? [['transparent', 'Transparan'], ['page', 'Warna halaman'], ['white', 'Putih']] : [['page', 'Warna halaman'], ['white', 'Putih']], get: () => st.bg, set: v => { st.bg = v; preview(); } })));
        if (st.fmt !== 'png') opts.append(F('Kualitas', slider({ get: () => st.q, set: v => { st.q = v; }, min: 40, max: 100, w: 180, fmt: v => v + '%' })));
      }
      if (st.fmt === 'pdf') opts.append(F('Halaman', sel({ options: [['all', `Semua halaman (${App.doc.pages.length})`], ['cur', 'Halaman ini']], get: () => st.pages, set: v => { st.pages = v; } })),
        F('Mode', sel({ options: [['vector', 'Vektor (teks & bentuk tetap tajam)'], ['raster', 'Raster akurat (semua efek persis)']], get: () => st.pdf, set: v => { st.pdf = v; build(); } })),
        st.pdf === 'raster' ? F('Resolusi', sel({ options: [['150', '150 dpi'], ['300', '300 dpi'], ['450', '450 dpi']], get: () => String(st.dpi), set: v => { st.dpi = +v; } })) : h('p', { class: 'small muted' }, 'Mode vektor: bayangan kabur dan lensa disederhanakan. Pilih Raster akurat untuk hasil identik dengan layar.'),
        F('Bleed (mm)', num({ unit: 'num', get: () => st.bleed, set: v => { st.bleed = v; }, w: 90 })));
      if (st.fmt === 'svg') opts.append(h('p', { class: 'small muted' }, 'Teks diekspor sebagai kurva sehingga tampil identik di semua aplikasi.'));
      if (st.fmt === 'adraw') opts.append(h('p', { class: 'small muted' }, 'Format asli Amatu Draw — menyimpan semua lapisan, efek langsung dan riwayat bentuk agar dapat diedit lagi.'));
      preview();
    };
    let pv = 0;
    const preview = async () => {
      const id = ++pv;
      try {
        const svg = await exportSVGString({ objs: st.scope === 'sel' && App.sel.length ? App.sel : null, bg: st.bg !== 'transparent' });
        if (id !== pv) return;
        prev.innerHTML = '';
        const im = h('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), alt: 'Pratinjau' });
        prev.append(im); prev.classList.toggle('checker', st.bg === 'transparent');
        const vb = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
        const s = st.w ? st.w / vb[2] : st.dpi / 25.4;
        info.textContent = ['png', 'jpg', 'webp'].includes(st.fmt) ? `${Math.round(vb[2] * s)} × ${Math.round(vb[3] * s)} px · ${fmtU(vb[2], App.doc.units)} × ${fmtU(vb[3], App.doc.units)} ${App.doc.units}` : `${fmtU(vb[2], App.doc.units)} × ${fmtU(vb[3], App.doc.units)} ${App.doc.units}`;
      } catch (e) { prev.textContent = 'Pratinjau gagal'; }
    };
    const go = async () => {
      const base = App.doc.name || 'gambar';
      try {
        if (st.fmt === 'svg') { const s = await exportSVGString({ objs: st.scope === 'sel' ? App.sel : null }); download(new Blob([s], { type: 'image/svg+xml' }), base + '.svg'); }
        else if (st.fmt === 'pdf') { toast('Menyiapkan PDF…'); const b = await exportPDF({ pages: st.pages, mode: st.pdf, dpi: st.dpi, bleed: st.bleed }); download(b, base + '.pdf'); }
        else if (st.fmt === 'adraw') { const { serialize } = await import('../io.js'); download(new Blob([serialize(App.doc)], { type: 'application/json' }), base + '.adraw'); }
        else {
          const type = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[st.fmt];
          const r = await exportRaster({ type, dpi: st.dpi, scope: st.scope, bg: st.bg, q: st.q / 100, pxW: st.w });
          const blob = await (await fetch(r.url)).blob();
          download(blob, base + '.' + st.fmt);
        }
        toast('Ekspor selesai');
      } catch (e) { console.error(e); toast('Ekspor gagal: ' + e.message, 'err'); return false; }
    };
    build();
    modal({ title: 'Ekspor', body: h('div', { class: 'exwrap' }, h('div', {}, fmtSeg, opts), h('div', { class: 'excol' }, prev, info)), width: 860, buttons: [['Batal', 'cancel'], ['Ekspor', go, 'btn-primary']] });
  },
  options(tab = 'theme') {
    const tabs = [['theme', 'Tema & Tampilan', 'theme'], ['work', 'Ruang kerja', 'layout'], ['doc', 'Dokumen', 'doc'], ['grid', 'Kisi & Penggaris', 'grid'], ['snap', 'Penguncian', 'magnet'], ['save', 'Simpan', 'save']];
    const side = h('div', { class: 'optnav' });
    const pane = h('div', { class: 'optpane' });
    const show = k => {
      side.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
      pane.innerHTML = '';
      const set = (key, v) => { App.set(key, v); };
      if (k === 'theme') {
        pane.append(h('h4', {}, 'Tema'), h('div', { class: 'themegrid' }, ...THEMES.map(t => { const b = h('button', { class: 'themec' + (App.settings.theme === t.id ? ' on' : ''), type: 'button' }, h('div', { class: 'thprev', style: { background: t.prev } }, h('i', { style: { background: t.panel } }), h('i', { style: { background: t.panel } }), h('b', { style: { background: t.page } })), h('span', {}, t.n), t.liquid ? h('em', {}, 'Liquid Glass') : null); b.onclick = () => { set('theme', t.id); applyTheme(); show('theme'); }; return b; })),
          h('h4', {}, 'Warna aksen'), h('div', { class: 'accents' }, ...Object.entries(ACCENTS).map(([k2, c]) => { const b = h('button', { class: 'acc' + (App.settings.accent === k2 ? ' on' : ''), style: { background: c }, title: k2 }); b.onclick = () => { set('accent', k2); applyTheme(); show('theme'); }; return b; })),
          h('h4', {}, 'Efek kaca'), seg([['liquid', 'sparkle', 'Liquid glass (refraksi)'], ['frost', 'grid', 'Kaca buram'], ['solid', 'rect', 'Padat (performa)']], () => App.settings.glass, v => { set('glass', v); applyTheme(); }),
          h('p', { class: 'small muted' }, 'Liquid glass memakai refraksi tepi dan blur latar (paling indah di Chrome/Edge). Mode padat paling ringan untuk dokumen besar.'));
      }
      if (k === 'work') pane.append(
        F('Roda mouse', sel({ options: [['auto', 'Otomatis (trackpad geser, roda zoom)'], ['zoom', 'Selalu zoom (gaya CorelDRAW)'], ['scroll', 'Selalu gulir']], get: () => App.settings.wheel, set: v => set('wheel', v) })),
        check('Tampilkan penggaris', () => App.settings.rulers, v => { set('rulers', v); V.resize(); }), check('Tampilkan petunjuk alat di bilah status', () => App.settings.toolHints, v => set('toolHints', v)),
        check('Tampilkan Layar Sambutan saat mulai', () => App.settings.startup === 'welcome', v => set('startup', v ? 'welcome' : 'last')),
        check('Titik asal Y di kiri bawah halaman (sumbu Y ke atas)', () => App.settings.yUp, v => { set('yUp', v); V.drawRulers(); App.emit('sel'); }));
      if (k === 'doc') pane.append(
        F('Satuan default dokumen baru', sel({ options: Object.keys(UNIT_LABEL).map(x => [x, UNIT_LABEL[x]]), get: () => App.settings.defUnits, set: v => set('defUnits', v) })),
        grid2(F('Jarak geser (mm)', num({ unit: 'num', get: () => App.settings.nudge, set: v => set('nudge', v), w: 100 })), F('Geser super, Shift (mm)', num({ unit: 'num', get: () => App.settings.superNudge, set: v => set('superNudge', v), w: 100 }))),
        grid2(F('Offset duplikat X (mm)', num({ unit: 'num', get: () => App.settings.dupOffset[0], set: v => set('dupOffset', [v, App.settings.dupOffset[1]]), w: 100 })), F('Offset duplikat Y (mm)', num({ unit: 'num', get: () => App.settings.dupOffset[1], set: v => set('dupOffset', [App.settings.dupOffset[0], v]), w: 100 }))));
      if (k === 'grid') {
        if (!App.doc) { pane.append(h('p', {}, 'Buka dokumen untuk mengatur kisi.')); return; }
        const g = App.doc.grid;
        pane.append(grid2(F('Jarak horizontal', num({ get: () => g.x, set: v => { g.x = v; V.drawGrid(); }, w: 100, min: .01 })), F('Jarak vertikal', num({ get: () => g.y, set: v => { g.y = v; V.drawGrid(); }, w: 100, min: .01 }))),
          check('Tampilkan kisi', () => g.show, v => { g.show = v; V.drawGrid(); }), check('Kisi berupa titik', () => g.dots, v => { g.dots = v; V.drawGrid(); }), check('Kunci ke kisi', () => g.snap, v => { g.snap = v; V.invalidateSnap(); }));
      }
      if (k === 'snap') {
        if (!App.doc) { pane.append(h('p', {}, 'Buka dokumen untuk mengatur penguncian.')); return; }
        const s = App.doc.snap;
        pane.append(check('Kunci ke objek (node, sudut, pusat, titik tengah)', () => s.objects, v => { s.objects = v; V.invalidateSnap(); }), check('Kunci ke garis bantu', () => s.guides, v => { s.guides = v; V.invalidateSnap(); }), check('Kunci ke halaman', () => s.page, v => { s.page = v; V.invalidateSnap(); }), check('Garis bantu penjajaran dinamis', () => s.dyn, v => { s.dyn = v; V.invalidateSnap(); }), h('p', { class: 'small muted' }, 'Tahan Alt saat menyeret untuk sementara mematikan penguncian.'));
      }
      if (k === 'save') pane.append(check('Simpan otomatis ke peramban setiap ada perubahan', () => App.settings.autosave, v => set('autosave', v)),
        h('p', { class: 'small muted' }, 'Salinan otomatis tersimpan di peramban ini (IndexedDB) dan muncul di Layar Sambutan › Terbaru.'),
        h('button', { class: 'btn btn-ghost', onclick: async () => { const l = await Store.list(); for (const r of l) await Store.del(r.id); toast('Daftar terbaru dikosongkan'); } }, 'Kosongkan dokumen terbaru'));
    };
    for (const [k, t, ic] of tabs) { const b = h('button', { 'data-k': k, type: 'button' }, h('span', { html: icon(ic, 16) }), t); b.onclick = () => show(k); side.append(b); }
    show(tab === 'rulers' ? 'grid' : tab);
    modal({ title: 'Opsi', body: h('div', { class: 'optwrap' }, side, pane), width: 760, buttons: [['Selesai', 'ok']] });
  },
  async outline() {
    if (!App.sel.length) return toast('Pilih objek untuk mengatur pena kerangka');
    const { panels } = await import('./dockers.js');
    modal({ title: 'Pena Kerangka', body: h('div', { class: 'dockpanel' }, panels.outline()), width: 420, buttons: [['Selesai', 'ok']] });
  },
  async fill(kind) {
    if (!App.sel.length) return toast('Pilih objek untuk mengatur isian');
    const { panels } = await import('./dockers.js');
    if (kind === 'outline') return DLG.outline();
    if (kind === 'grad' && App.sel[0].fill?.t !== 'grad') App.ui.setFillType('lin');
    if (kind === 'solid' && App.sel[0].fill?.t !== 'solid') App.ui.setFillType('solid');
    const host = h('div', { class: 'dockpanel' }, panels.fill());
    App.on('change', () => { if (host.isConnected) { host.innerHTML = ''; host.append(panels.fill()); } });
    modal({ title: 'Edit Isian', body: host, width: 420, buttons: [['Selesai', 'ok']] });
  },
  copyprops(which) {
    const st = { ol: true, olc: true, fill: true, text: false, tr: false, fx: which === 'fx' };
    const body = h('div', { class: 'col' }, check('Pena kerangka (lebar & gaya)', () => st.ol, v => { st.ol = v; }), check('Warna kerangka', () => st.olc, v => { st.olc = v; }), check('Isian', () => st.fill, v => { st.fill = v; }), check('Properti teks', () => st.text, v => { st.text = v; }), check('Transparansi', () => st.tr, v => { st.tr = v; }), check('Efek', () => st.fx, v => { st.fx = v; }));
    modal({ title: 'Salin Properti Dari', body, width: 380, buttons: [['Batal', 'cancel'], ['OK', 'ok']] }).then(v => {
      if (v !== 'ok') return;
      const targets = [...App.sel];
      App.ui.pickObject('Klik objek sumber properti', src => {
        for (const o of targets) {
          if (o === src) continue;
          if (st.ol || st.olc) { if (!src.ol) o.ol = null; else { o.ol = o.ol || { ...src.ol }; if (st.ol) Object.assign(o.ol, { ...deep(src.ol), c: st.olc ? src.ol.c : o.ol.c }); if (st.olc) o.ol.c = src.ol.c; } }
          if (st.fill) o.fill = deep(src.fill);
          if (st.tr) o.tr = deep(src.tr);
          if (st.fx) o.fx = deep(src.fx);
          if (st.text && o.type === 'text' && src.type === 'text') for (const k of ['font', 'wt', 'it', 'ul', 'sz', 'al', 'ls', 'cs', 'ws']) o[k] = src[k];
        }
        App.sel = targets; App.commit('Salin properti');
      });
    });
  },
  find() {
    const st = { q: '', r: '', case: false };
    const res = h('div', { class: 'findres' });
    const texts = () => { const out = []; walkDoc(App.doc, o => { if (o.type === 'text') out.push(o); }); return out; };
    const match = s => st.case ? s.includes(st.q) : s.toLowerCase().includes(st.q.toLowerCase());
    const list = () => { res.innerHTML = ''; if (!st.q) return; const m = texts().filter(o => match(o.s)); res.append(h('div', { class: 'small muted' }, `${m.length} objek teks cocok`), ...m.slice(0, 50).map(o => { const r = h('button', { class: 'hrow' }, '“' + o.s.slice(0, 60) + '”'); r.onclick = () => { const w = App.where(o); if (w.page !== App.page) App.ui.gotoPage(App.doc.pages.indexOf(w.page)); App.select(o); V.fitSel(); }; return r; })); };
    const body = h('div', { class: 'col' }, F('Cari', textField({ get: () => st.q, set: v => { st.q = v; list(); }, w: 380 })), F('Ganti dengan', textField({ get: () => st.r, set: v => { st.r = v; }, w: 380 })), check('Cocokkan huruf besar/kecil', () => st.case, v => { st.case = v; list(); }), res);
    modal({ title: 'Cari dan Ganti Teks', body, width: 460, buttons: [['Tutup', 'cancel'], ['Ganti semua', () => { if (!st.q) return false; let n = 0; const re = new RegExp(st.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), st.case ? 'g' : 'gi'); for (const o of texts()) { const s2 = o.s.replace(re, () => { n++; return st.r; }); if (s2 !== o.s) o.s = s2; } App.commit('Ganti teks'); toast(`${n} kemunculan diganti`); list(); return false; }, 'btn-primary']] });
  },
  async qr() {
    await loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js');
    const st = { data: 'https://liemyo.github.io/corel', size: 30, ec: 'M', fg: '#000000', bg: '#ffffff' };
    const body = h('div', { class: 'col' }, F('Isi (URL, teks, nomor WA, dll.)', textField({ get: () => st.data, set: v => { st.data = v; }, w: 420 })),
      grid2(F('Ukuran (mm)', num({ unit: 'num', get: () => st.size, set: v => { st.size = v; }, w: 100 })), F('Koreksi galat', sel({ options: [['L', 'L — 7%'], ['M', 'M — 15%'], ['Q', 'Q — 25%'], ['H', 'H — 30% (aman untuk logo)']], get: () => st.ec, set: v => { st.ec = v; } }))),
      grid2(F('Warna', colorBtn({ get: () => st.fg, set: c => { st.fg = c || '#000'; }, none: false })), F('Latar', colorBtn({ get: () => st.bg, set: c => { st.bg = c; } }))));
    modal({ title: 'Sisipkan Kode QR', body, width: 480, buttons: [['Batal', 'cancel'], ['Sisipkan', 'ok']] }).then(v => {
      if (v !== 'ok' || !st.data) return;
      const p = App.page;
      App.add(mk('qr', { data: st.data, ec: st.ec, w: st.size, h: st.size, fill: { t: 'solid', c: st.fg }, bg: st.bg, ol: null, tf: T(p.w / 2 - st.size / 2, p.h / 2 - st.size / 2) }), 'Sisipkan kode QR');
    });
  },
  barcode() {
    const st = { code: '899123456789', h: 22, w: 37.3 };
    const body = h('div', { class: 'col' }, F('12 digit EAN-13 (digit ke-13 dihitung otomatis)', textField({ get: () => st.code, set: v => { st.code = v.replace(/\D/g, '').slice(0, 12); }, w: 300 })), grid2(F('Lebar (mm)', num({ unit: 'num', get: () => st.w, set: v => { st.w = v; }, w: 100 })), F('Tinggi (mm)', num({ unit: 'num', get: () => st.h, set: v => { st.h = v; }, w: 100 }))));
    modal({ title: 'Sisipkan Barcode EAN-13', body, width: 440, buttons: [['Batal', 'cancel'], ['Sisipkan', 'ok']] }).then(v => {
      if (v !== 'ok') return;
      if (st.code.length !== 12) return toast('Masukkan tepat 12 digit', 'warn');
      const g = ean13(st.code, st.w, st.h);
      const p = App.page; applyMAll(g, T(p.w / 2 - st.w / 2, p.h / 2 - st.h / 2));
      App.add(g, 'Sisipkan barcode');
    });
  },
  table() {
    const st = { r: 4, c: 3, w: 120, h: 40 };
    const body = h('div', { class: 'col' }, grid2(F('Baris', num({ unit: 'int', get: () => st.r, set: v => { st.r = clamp(Math.round(v), 1, 200); }, w: 100, dec: 0 })), F('Kolom', num({ unit: 'int', get: () => st.c, set: v => { st.c = clamp(Math.round(v), 1, 100); }, w: 100, dec: 0 }))), grid2(F('Lebar', num({ get: () => st.w, set: v => { st.w = v; }, w: 100 })), F('Tinggi', num({ get: () => st.h, set: v => { st.h = v; }, w: 100 }))));
    modal({ title: 'Tabel Baru', body, width: 420, buttons: [['Batal', 'cancel'], ['OK', 'ok']] }).then(v => {
      if (v !== 'ok') return;
      const p = App.page;
      App.add(mk('table', { w: st.w, h: st.h, cw: Array(st.c).fill(st.w / st.c), rh: Array(st.r).fill(st.h / st.r), cells: Array.from({ length: st.r }, () => Array.from({ length: st.c }, () => ({ t: '' }))), ol: { w: .25, c: '#000000' }, sz: 9, font: 'Arial', fill: null, tf: T(p.w / 2 - st.w / 2, p.h / 2 - st.h / 2) }), 'Tabel baru');
    });
  },
  tobitmap() {
    const st = { dpi: 300, bg: 'none' };
    modal({ title: 'Konversi ke Bitmap', body: h('div', { class: 'col' }, F('Resolusi', sel({ options: [['72', '72 dpi'], ['150', '150 dpi'], ['200', '200 dpi'], ['300', '300 dpi'], ['600', '600 dpi']], get: () => String(st.dpi), set: v => { st.dpi = +v; } })), F('Latar', sel({ options: [['none', 'Transparan'], ['#ffffff', 'Putih']], get: () => st.bg, set: v => { st.bg = v; } }))), width: 380, buttons: [['Batal', 'cancel'], ['OK', 'ok']] })
      .then(v => { if (v === 'ok') rasterize(App.sel, st.dpi, { bg: st.bg === 'none' ? null : st.bg }); });
  },
  async trace() {
    const o = App.sel[0]; if (o?.type !== 'img') return toast('Pilih bitmap untuk di-trace');
    const st = { preset: 'logo', colors: TRACE.logo.o.numberofcolors, smooth: 0, removeBg: true, keep: false };
    const prevBox = h('div', { class: 'trprev' }, h('div', { class: 'trsrc' }, h('img', { src: App.assetURL(o.asset) }), h('span', {}, 'Sebelum')), h('div', { class: 'trdst' }, h('div', { class: 'spinner' }), h('span', {}, 'Sesudah')));
    const stat = h('div', { class: 'small muted' });
    let pv = 0;
    const preview = async () => {
      const id = ++pv;
      await loadScript('https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js');
      const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = App.assetURL(o.asset); });
      const sc = Math.min(1, 420 / Math.max(im.naturalWidth, im.naturalHeight)), W = Math.round(im.naturalWidth * sc), H = Math.round(im.naturalHeight * sc);
      const c = h('canvas', { width: W, height: H }), x = c.getContext('2d'); x.drawImage(im, 0, 0, W, H);
      const opt = { ...TRACE[st.preset].o, numberofcolors: st.colors, viewbox: true };
      if (st.smooth) { opt.blurradius = Math.round(st.smooth / 25); opt.ltres = opt.qtres = .5 + st.smooth / 40; }
      setTimeout(() => {
        if (id !== pv) return;
        const svg = window.ImageTracer.imagedataToSVG(x.getImageData(0, 0, W, H), opt);
        const d = prevBox.querySelector('.trdst'); d.innerHTML = ''; d.append(h('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) }), h('span', {}, 'Sesudah'));
        stat.textContent = `${(svg.match(/<path/g) || []).length} kurva · ${opt.numberofcolors} warna`;
      }, 10);
    };
    let colorsS;
    const body = h('div', { class: 'trwrap' }, h('div', { class: 'col' },
      F('Jenis trace', sel({ options: Object.entries(TRACE).map(([k, t]) => [k, t.n]), get: () => st.preset, set: v => { st.preset = v; st.colors = TRACE[v].o.numberofcolors; colorsS.refresh(); preview(); } })),
      F('Jumlah warna', (colorsS = slider({ get: () => st.colors, set: (v, f) => { st.colors = v; if (f) preview(); }, min: 2, max: 64, w: 200 }))),
      F('Perhalus', slider({ get: () => st.smooth, set: (v, f) => { st.smooth = v; if (f) preview(); }, min: 0, max: 100, w: 200 })),
      check('Hapus latar belakang putih', () => st.removeBg, v => { st.removeBg = v; }), check('Pertahankan bitmap asli', () => st.keep, v => { st.keep = v; }), stat), prevBox);
    preview();
    modal({ title: 'PowerTRACE — Trace Bitmap', body, width: 820, buttons: [['Batal', 'cancel'], ['Trace', async () => { toast('Menjalankan trace…'); const n = await traceBitmap(o, st.preset, { colors: st.colors, smooth: st.smooth, removeBg: st.removeBg, keep: st.keep }); toast(`Trace selesai: ${n} objek kurva`); }, 'btn-primary']] });
  },
  async bitmapfx(tab) {
    const o = App.sel[0]; if (o?.type !== 'img') return toast('Pilih bitmap');
    const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = App.assetURL(o.asset); });
    const st = { b: 0, c: 0, s: 0, hue: 0, fx: 'none', amt: 50, pw: im.naturalWidth, ph: im.naturalHeight };
    const sc = Math.min(1, 460 / Math.max(im.naturalWidth, im.naturalHeight));
    const cv = h('canvas', { width: Math.round(im.naturalWidth * sc), height: Math.round(im.naturalHeight * sc), class: 'bfxcv' });
    const draw = () => { const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(im, 0, 0, cv.width, cv.height); const d = x.getImageData(0, 0, cv.width, cv.height); bitmapOp(d, st, sc); x.putImageData(d, 0, 0); };
    let t; const q = () => { clearTimeout(t); t = setTimeout(draw, 30); };
    const S2 = (label, k, min, max) => F(label, slider({ get: () => st[k], set: v => { st[k] = v; q(); }, min, max, w: 200 }));
    const body = h('div', { class: 'trwrap' }, h('div', { class: 'col' },
      S2('Kecerahan', 'b', -100, 100), S2('Kontras', 'c', -100, 100), S2('Saturasi', 's', -100, 100), S2('Rona', 'hue', -180, 180),
      F('Efek', sel({ options: [['none', 'Tidak ada'], ['gray', 'Skala abu-abu'], ['sepia', 'Sepia'], ['invert', 'Negatif'], ['post', 'Posterisasi'], ['thresh', 'Ambang (hitam-putih)'], ['blur', 'Kabur Gaussian'], ['sharpen', 'Pertajam'], ['pixel', 'Piksel'], ['noise', 'Derau'], ['emboss', 'Timbul'], ['edge', 'Deteksi tepi'], ['vignette', 'Vinyet'], ['duo', 'Duotone']], get: () => st.fx, set: v => { st.fx = v; q(); } })),
      S2('Intensitas efek', 'amt', 0, 100),
      h('h4', {}, 'Ubah resolusi'), grid2(F('Lebar (px)', num({ unit: 'int', get: () => st.pw, set: v => { st.pw = Math.max(1, Math.round(v)); st.ph = Math.round(st.pw * im.naturalHeight / im.naturalWidth); }, w: 100, dec: 0 })), F('Tinggi (px)', num({ unit: 'int', get: () => st.ph, set: v => { st.ph = Math.max(1, Math.round(v)); st.pw = Math.round(st.ph * im.naturalWidth / im.naturalHeight); }, w: 100, dec: 0 })))),
      h('div', { class: 'bfxprev checker' }, cv));
    draw();
    void tab;
    modal({ title: 'Penyesuaian & Efek Bitmap', body, width: 820, buttons: [['Batal', 'cancel'], ['Atur ulang', () => { Object.assign(st, { b: 0, c: 0, s: 0, hue: 0, fx: 'none', amt: 50 }); body.querySelectorAll('*').forEach(x => x.refresh?.()); draw(); return false; }], ['Terapkan', () => {
      const W = Math.min(st.pw, 8000), H = Math.min(st.ph, 8000), c = h('canvas', { width: W, height: H }), x = c.getContext('2d');
      x.drawImage(im, 0, 0, W, H); const d = x.getImageData(0, 0, W, H); bitmapOp(d, st, W / im.naturalWidth); x.putImageData(d, 0, 0);
      const url = c.toDataURL('image/png'); o.asset = App.addAsset(url); o.px = [W, H]; App.assetEpoch++; App.commit('Efek bitmap');
    }, 'btn-primary']] });
  },
  shortcuts() {
    const groups = [['Berkas & edit', ['new', 'open', 'save', 'saveAs', 'import', 'export', 'print', 'undo', 'redo', 'cut', 'copy', 'paste', 'pasteInPlace', 'duplicate', 'stepRepeat', 'copyProps', 'delete', 'selectAll']], ['Objek', ['group', 'ungroup', 'combine', 'breakApart', 'toCurves', 'outlineToObj', 'toFront2', 'toBack2', 'forward', 'backward', 'alignL', 'alignR', 'alignT', 'alignB', 'alignHC', 'alignVC', 'centerPage', 'transform']], ['Tampilan', ['zoomIn', 'zoomOut', 'zoom100', 'zoomPage', 'zoomAll', 'zoomSel', 'rulers', 'snapObjects', 'snapGrid', 'full']], ['Efek & teks', ['envelope', 'contourDock', 'lensDock', 'textProps', 'insertChar', 'find', 'options', 'menuSearch']]];
    const toolNames = Object.entries(TOOL_KEYS).map(([k, id]) => [App.tools[id]?.name || id, k]);
    const body = h('div', { class: 'scgrid' }, ...groups.map(([g, ids]) => h('div', {}, h('h4', {}, g), ...ids.filter(i => C[i]).map(i => h('div', { class: 'scrow' }, h('span', {}, C[i].l), h('kbd', {}, kbd(C[i].k)))))),
      h('div', {}, h('h4', {}, 'Alat'), ...toolNames.map(([n, k]) => h('div', { class: 'scrow' }, h('span', {}, n), h('kbd', {}, k))), h('div', { class: 'scrow' }, h('span', {}, 'Alat Pilih ↔ alat terakhir'), h('kbd', {}, 'Spasi')), h('div', { class: 'scrow' }, h('span', {}, 'Pena kerangka / Isian'), h('kbd', {}, 'F12 / F11')), h('div', { class: 'scrow' }, h('span', {}, 'Geser objek (super: Shift)'), h('kbd', {}, '← ↑ → ↓')), h('div', { class: 'scrow' }, h('span', {}, 'Salin saat menyeret'), h('kbd', {}, '+ / klik kanan')), h('div', { class: 'scrow' }, h('span', {}, 'Matikan penguncian sementara'), h('kbd', {}, kbd('Alt+')))));
    modal({ title: 'Pintasan Keyboard', body, width: 900 });
  },
  about() {
    modal({
      title: 'Tentang Amatu Draw', width: 520, body: h('div', { class: 'about' }, h('div', { class: 'ablogo', html: LOGO }), h('h2', {}, 'Amatu Draw'), h('p', { class: 'muted' }, 'Aplikasi desain grafis vektor di peramban — versi 1.0 (2026)'),
        h('p', {}, 'Alur kerja ala CorelDRAW: Alat Pilih dengan putar/miring, Alat Bentuk, Pembentukan (Las/Pangkas/Irisan), PowerClip, efek langsung (campuran, kontur, ekstrusi, amplop, perspektif, distorsi, bayangan, lensa, transparansi), PowerTRACE, tabel, dimensi, kode QR, multi-halaman, ekspor SVG/PNG/JPG/PDF.'),
        h('p', { class: 'small muted' }, 'Pustaka sumber terbuka: paper.js (operasi boolean), Clipper (offset), opentype.js (teks ke kurva), jsPDF + svg2pdf.js, ImageTracer.js, qrcode-generator, Fontsource.'),
        h('p', { class: 'small muted' }, 'Berkas .CDR biner milik Corel tidak dapat dibuka langsung; gunakan SVG/PDF sebagai format pertukaran.'))
    });
  },
  docprops() {
    const m = App.doc.meta ||= {};
    let used = 0, objs = 0; walkDoc(App.doc, () => { objs++; }); for (const k in App.doc.assets) used += App.doc.assets[k].length;
    const body = h('div', { class: 'col' }, F('Judul', textField({ get: () => App.doc.name, set: v => { App.doc.name = v; App.emit('doc'); }, w: 420 })), F('Pembuat', textField({ get: () => m.author, set: v => { m.author = v; }, w: 420 })), F('Kata kunci', textField({ get: () => m.keywords, set: v => { m.keywords = v; }, w: 420 })),
      h('p', { class: 'small muted' }, `${App.doc.pages.length} halaman · ${objs} objek · ${(used / 1024 / 1024).toFixed(2)} MB gambar · dibuat ${new Date(App.doc.created).toLocaleString('id-ID')}`));
    modal({ title: 'Properti Dokumen', body, width: 480, buttons: [['Selesai', 'ok']] }).then(() => App.commit('Properti dokumen'));
  },
  guides() {
    const p = App.page, st = { o: 'v', v: 10 };
    const list = h('div', { class: 'glist' });
    const draw = () => { list.innerHTML = ''; p.guides.forEach((g, i) => list.append(h('div', { class: 'scrow' }, h('span', {}, `${g.o === 'h' ? 'Horizontal' : 'Vertikal'} · ${fmtU(g.v, App.doc.units)} ${App.doc.units}`), h('button', { class: 'ib sm', html: icon(g.lock ? 'lock' : 'unlock', 14), onclick: () => { g.lock = !g.lock; draw(); App.overlay(); } }), h('button', { class: 'ib sm', html: icon('trash', 14), onclick: () => { p.guides.splice(i, 1); draw(); App.overlay(); } })))); };
    draw();
    const body = h('div', { class: 'col' }, h('div', { class: 'row' }, sel({ options: [['v', 'Vertikal'], ['h', 'Horizontal']], get: () => st.o, set: v => { st.o = v; } }), num({ get: () => st.v, set: v => { st.v = v; }, w: 100 }), h('button', { class: 'btn btn-tonal', onclick: () => { p.guides.push({ o: st.o, v: st.v }); draw(); App.overlay(); } }, 'Tambah')), list);
    modal({ title: 'Garis Bantu', body, width: 440, buttons: [['Selesai', 'ok']] }).then(() => App.commit('Garis bantu'));
  },
};
App.ui.openDialog = (name, ...a) => { if (!DLG[name]) return console.warn('dialog?', name); if (['pagesetup', 'export', 'docprops', 'guides', 'find', 'copyprops', 'tobitmap'].includes(name) && !App.doc) return toast('Buka atau buat dokumen terlebih dahulu'); DLG[name](...a); };

function applyMAll(g, m) { import('../model.js').then(({ applyM }) => applyM(g, m)); }
// ---------- EAN-13 ----------
function ean13(code, W, H) {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const Rr = L.map(s => s.replace(/./g, c => c === '0' ? '1' : '0'));
  const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = code.split('').map(Number);
  const sum = d.reduce((a, v, i) => a + v * (i % 2 ? 3 : 1), 0), chk = (10 - sum % 10) % 10;
  const all = [...d, chk];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PAR[all[0]][i - 1] === 'L' ? L : G)[all[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += Rr[all[i]];
  bits += '101';
  const quiet = 11, total = bits.length + quiet * 2, mw = W / total, ch = [];
  const guards = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  let i = 0;
  while (i < bits.length) {
    if (bits[i] !== '1') { i++; continue; }
    let j = i; while (j < bits.length && bits[j] === '1') j++;
    const tall = guards.has(i);
    ch.push(mk('rect', { w: (j - i) * mw, h: tall ? H : H * .86, tf: T((quiet + i) * mw, 0), fill: { t: 'solid', c: '#000000' }, ol: null }));
    i = j;
  }
  const txt = (s, x) => mk('text', { s, font: 'Arial', sz: H * .13 / (25.4 / 72), al: 'l', fill: { t: 'solid', c: '#000000' }, ol: null, tf: T(x, H * .86) });
  ch.push(txt(String(all[0]), 2 * mw), txt(all.slice(1, 7).join(''), (quiet + 6) * mw), txt(all.slice(7).join(''), (quiet + 52) * mw));
  return mk('g', { ch, name: 'Barcode EAN-13 ' + all.join('') });
}

// ---------- Bitmap pixel operations ----------
function bitmapOp(img, st, scale = 1) {
  const d = img.data, W = img.width, H = img.height, n = d.length;
  const b = st.b / 100 * 255, c = st.c / 100, cf = (1 + c) / (1 - Math.min(.99, c)), sat = 1 + st.s / 100, hr = st.hue * Math.PI / 180;
  const cosH = Math.cos(hr), sinH = Math.sin(hr);
  const hm = [.213 + cosH * .787 - sinH * .213, .715 - cosH * .715 - sinH * .715, .072 - cosH * .072 + sinH * .928, .213 - cosH * .213 + sinH * .143, .715 + cosH * .285 + sinH * .140, .072 - cosH * .072 - sinH * .283, .213 - cosH * .213 - sinH * .787, .715 - cosH * .715 + sinH * .715, .072 + cosH * .928 + sinH * .072];
  for (let i = 0; i < n; i += 4) {
    let r = d[i], g = d[i + 1], bl = d[i + 2];
    if (st.hue) { const R = r * hm[0] + g * hm[1] + bl * hm[2], G2 = r * hm[3] + g * hm[4] + bl * hm[5], B2 = r * hm[6] + g * hm[7] + bl * hm[8]; r = R; g = G2; bl = B2; }
    r += b; g += b; bl += b;
    if (c) { r = (r - 128) * cf + 128; g = (g - 128) * cf + 128; bl = (bl - 128) * cf + 128; }
    if (st.s) { const l = .299 * r + .587 * g + .114 * bl; r = l + (r - l) * sat; g = l + (g - l) * sat; bl = l + (bl - l) * sat; }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl;
  }
  const a = st.amt / 100;
  const conv = (k, div = 1, off = 0) => { const src = new Uint8ClampedArray(d); const s = Math.sqrt(k.length) | 0, hlf = s >> 1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let R = 0, G2 = 0, B2 = 0; for (let ky = 0; ky < s; ky++) for (let kx = 0; kx < s; kx++) { const xx = Math.min(W - 1, Math.max(0, x + kx - hlf)), yy = Math.min(H - 1, Math.max(0, y + ky - hlf)), j = (yy * W + xx) * 4, w = k[ky * s + kx]; R += src[j] * w; G2 += src[j + 1] * w; B2 += src[j + 2] * w; } const i = (y * W + x) * 4; d[i] = R / div + off; d[i + 1] = G2 / div + off; d[i + 2] = B2 / div + off; } };
  const boxBlur = r => { if (r < 1) return; const src = new Uint8ClampedArray(d); for (let pass = 0; pass < 2; pass++) { const s = pass ? new Uint8ClampedArray(d) : src; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let R = 0, G2 = 0, B2 = 0, A = 0, cnt = 0; for (let k = -r; k <= r; k++) { const xx = pass ? x : Math.min(W - 1, Math.max(0, x + k)), yy = pass ? Math.min(H - 1, Math.max(0, y + k)) : y, j = (yy * W + xx) * 4; R += s[j]; G2 += s[j + 1]; B2 += s[j + 2]; A += s[j + 3]; cnt++; } const i = (y * W + x) * 4; d[i] = R / cnt; d[i + 1] = G2 / cnt; d[i + 2] = B2 / cnt; d[i + 3] = A / cnt; } } };
  switch (st.fx) {
    case 'gray': for (let i = 0; i < n; i += 4) { const l = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; d[i] = d[i] + (l - d[i]) * a * 2; d[i + 1] = d[i + 1] + (l - d[i + 1]) * a * 2; d[i + 2] = d[i + 2] + (l - d[i + 2]) * a * 2; } break;
    case 'sepia': for (let i = 0; i < n; i += 4) { const r = d[i], g = d[i + 1], bl = d[i + 2]; const k = Math.min(1, a * 2); d[i] = r + ((.393 * r + .769 * g + .189 * bl) - r) * k; d[i + 1] = g + ((.349 * r + .686 * g + .168 * bl) - g) * k; d[i + 2] = bl + ((.272 * r + .534 * g + .131 * bl) - bl) * k; } break;
    case 'invert': for (let i = 0; i < n; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } break;
    case 'post': { const lv = Math.max(2, Math.round(2 + (1 - a) * 14)), st2 = 255 / (lv - 1); for (let i = 0; i < n; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] / st2) * st2; break; }
    case 'thresh': { const t = 255 * a; for (let i = 0; i < n; i += 4) { const v = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) > t ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; } break; }
    case 'blur': boxBlur(Math.round(a * 12 * scale)); break;
    case 'sharpen': { const k = a * 2; conv([0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0]); break; }
    case 'pixel': { const s = Math.max(2, Math.round(a * 30 * scale)); for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) { const j = (y * W + x) * 4; for (let yy = y; yy < Math.min(H, y + s); yy++) for (let xx = x; xx < Math.min(W, x + s); xx++) { const i = (yy * W + xx) * 4; d[i] = d[j]; d[i + 1] = d[j + 1]; d[i + 2] = d[j + 2]; } } break; }
    case 'noise': for (let i = 0; i < n; i += 4) { const z = (Math.random() - .5) * 120 * a; d[i] += z; d[i + 1] += z; d[i + 2] += z; } break;
    case 'emboss': conv([-2, -1, 0, -1, 1, 1, 0, 1, 2], 1, 0); for (let i = 0; i < n; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; d[i] = d[i] + (l - d[i]) * a; d[i + 1] = d[i + 1] + (l - d[i + 1]) * a; d[i + 2] = d[i + 2] + (l - d[i + 2]) * a; } break;
    case 'edge': { const src = new Uint8ClampedArray(d); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const L = (xx, yy) => { const j = (yy * W + xx) * 4; return .299 * src[j] + .587 * src[j + 1] + .114 * src[j + 2]; }; const gx = -L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1) + L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1); const gy = -L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1) + L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1); const v = 255 - Math.min(255, Math.hypot(gx, gy) * (.5 + a)); const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; } break; }
    case 'vignette': for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = x / W - .5, dy = y / H - .5, f = 1 - Math.min(1, Math.hypot(dx, dy) * 1.4) ** 2 * 0 - Math.max(0, Math.hypot(dx, dy) * 2 - .4) * a * 1.4; const i = (y * W + x) * 4; d[i] *= f; d[i + 1] *= f; d[i + 2] *= f; } break;
    case 'duo': for (let i = 0; i < n; i += 4) { const l = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / 255; d[i] = 20 + l * (235 - 20); d[i + 1] = 30 + l * (180 - 30) * (0.6 + a * .4); d[i + 2] = 90 + l * (90) * (1 - a * .5); } break;
  }
}
export { modal as openModal, toU, fromU, selBox, objBox, S, walk };
