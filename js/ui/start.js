// Welcome screen: new document presets, templates, recent documents, learning tips.
import { App } from '../app.js';
import { run } from '../commands.js';
import { TEMPLATES } from '../templates.js';
import { Store, deserialize, thumbOf, openFiles } from '../io.js';
import { ensureFonts } from '../fonts.js';
import { walkDoc, applyM } from '../model.js';
import { objBox } from '../objgeom.js';
import { T } from '../geom.js';
import { icon, LOGO } from '../icons.js';
import { h, toast } from '../util.js';

const PRESETS = [['A4', 210, 297, 'Dokumen'], ['A4 lanskap', 297, 210, 'Dokumen'], ['A3', 297, 420, 'Poster'], ['F4', 215, 330, 'Dokumen'], ['Letter', 215.9, 279.4, 'Dokumen'], ['Kartu nama', 90, 55, 'Cetak'], ['Instagram', 285.75, 285.75, '1080 × 1080 px'], ['Story', 285.75, 508, '1080 × 1920 px'], ['Spanduk 3×1 m', 3000, 1000, 'Cetak besar'], ['Web 1440', 381, 238.125, '1440 × 900 px']];
export async function finalizeDoc(d) {
  const objs = []; walkDoc(d, o => { objs.push(o); });
  await ensureFonts(objs);
  App.dirtyIndex();
  walkDoc(d, o => { if (o._cx != null) { const b = objBox(o); if (b) applyM(o, T(o._cx - (b.x + b.w / 2), 0)); delete o._cx; } });
  return d;
}
let tab = 'home', root;
export function buildStart() {
  root = document.getElementById('startpage');
  App.ui.startTab = t => { tab = t; draw(); };
  App.ui.openRecent = async id => {
    const r = await Store.get(id);
    if (!r) return toast('Dokumen tidak ditemukan');
    const open = App.docs.find(d => d.id === id);
    if (open) return App.activate(open);
    const d = deserialize(r.data); d.id = r.id; d.name = r.name;
    App.openDoc(d);
  };
  App.on('doc', () => { root.hidden = !App.startOn; document.body.classList.toggle('starting', App.startOn); if (App.startOn) draw(); });
  draw();
}
function nav() {
  const items = [['home', 'Mulai', 'apps'], ['tpl', 'Templat', 'layout'], ['recent', 'Terbaru', 'clock'], ['learn', 'Pelajari', 'book'], ['new', 'Apa yang baru', 'sparkle']];
  return h('aside', { class: 'snav glass refract' },
    h('div', { class: 'sbrand' }, h('span', { html: LOGO }), h('div', {}, h('b', {}, 'Amatu Draw'), h('span', {}, 'Desain grafis vektor'))),
    ...items.map(([k, t, ic]) => { const b = h('button', { class: 'snavb' + (tab === k ? ' on' : ''), type: 'button' }, h('span', { html: icon(ic, 18) }), t); b.onclick = () => { tab = k; draw(); }; return b; }),
    h('div', { class: 'grow' }),
    h('button', { class: 'snavb', onclick: () => run('options') }, h('span', { html: icon('gear', 18) }), 'Opsi & tema'),
    h('button', { class: 'snavb', onclick: () => run('shortcuts') }, h('span', { html: icon('help', 18) }), 'Pintasan'));
}
function presetCard([n, w, hh, sub]) {
  const k = 46 / Math.max(w, hh);
  const c = h('button', { class: 'pcard glass', type: 'button' }, h('div', { class: 'pcv' }, h('i', { style: { width: w * k + 'px', height: hh * k + 'px' } })), h('b', {}, n), h('span', {}, sub));
  c.onclick = () => App.newDocument({ w, h: hh });
  return c;
}
function tplCard(t) {
  const thumb = h('div', { class: 'tthumb' }, h('div', { class: 'spinner' }));
  const c = h('button', { class: 'tcard glass', type: 'button' }, thumb, h('b', {}, t.n), h('span', {}, t.c));
  c.onclick = async () => { const d = await finalizeDoc(t.make()); App.openDoc(d); App.render(); };
  (async () => {
    t._thumb ||= await finalizeDoc(t.make()).then(d => thumbOf(d, 360));
    thumb.innerHTML = ''; if (t._thumb) thumb.append(h('img', { src: t._thumb, alt: t.n }));
  })();
  return c;
}
async function recentGrid(limit) {
  const list = (await Store.list()).slice(0, limit || 60);
  if (!list.length) return h('div', { class: 'sempty glass' }, h('span', { html: icon('clock', 26) }), h('b', {}, 'Belum ada dokumen terbaru'), h('span', {}, 'Dokumen yang Anda kerjakan tersimpan otomatis di sini.'));
  return h('div', { class: 'rgrid' }, ...list.map(r => {
    const c = h('div', { class: 'rcard glass' }, h('button', { class: 'rthumb', type: 'button', onclick: () => App.ui.openRecent(r.id) }, r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('span', { html: icon('doc', 28) })),
      h('div', { class: 'rmeta' }, h('b', { title: r.name }, r.name), h('span', {}, new Date(r.modified).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ` · ${r.pages || 1} hlm`)),
      h('button', { class: 'ib sm rdel', title: 'Hapus dari daftar', html: icon('trash', 14), onclick: async e => { e.stopPropagation(); await Store.del(r.id); draw(); } }));
    return c;
  }));
}
async function draw() {
  if (!root) return;
  root.innerHTML = '';
  const main = h('main', { class: 'smain' });
  root.append(nav(), main);
  if (tab === 'home') {
    const hero = h('section', { class: 'hero glass refract' },
      h('div', { class: 'herot' }, h('h1', {}, 'Selamat datang di Amatu Draw'), h('p', {}, 'Ilustrasi, logo, tata letak cetak dan grafis media sosial — lengkap dengan Pembentukan, PowerClip, efek langsung dan PowerTRACE, langsung di peramban.'),
        h('div', { class: 'heroa' }, h('button', { class: 'btn btn-primary', onclick: () => run('new') }, h('span', { html: icon('new', 18) }), 'Dokumen baru'), h('button', { class: 'btn btn-ghost', onclick: () => openFiles() }, h('span', { html: icon('open', 18) }), 'Buka…'), h('button', { class: 'btn btn-ghost', onclick: () => App.newDocument() }, 'A4 cepat'))),
      h('div', { class: 'heroart', html: heroArt() }));
    main.append(hero, h('h2', {}, 'Mulai dokumen baru'), h('div', { class: 'pgrid' }, ...PRESETS.map(presetCard)),
      h('div', { class: 'srow' }, h('h2', {}, 'Templat'), h('button', { class: 'btn-text', onclick: () => { tab = 'tpl'; draw(); } }, 'Lihat semua')), h('div', { class: 'tgrid' }, ...TEMPLATES.slice(0, 4).map(tplCard)),
      h('div', { class: 'srow' }, h('h2', {}, 'Terbaru'), h('button', { class: 'btn-text', onclick: () => { tab = 'recent'; draw(); } }, 'Lihat semua')), await recentGrid(6));
  } else if (tab === 'tpl') main.append(h('h1', {}, 'Templat'), h('p', { class: 'muted' }, 'Semua elemen dapat diedit: teks, warna, efek dan tata letak.'), h('div', { class: 'tgrid' }, ...TEMPLATES.map(tplCard)));
  else if (tab === 'recent') main.append(h('h1', {}, 'Dokumen terbaru'), h('p', { class: 'muted' }, 'Tersimpan otomatis di peramban ini. Gunakan Berkas › Simpan untuk menyimpan berkas .adraw ke komputer.'), await recentGrid());
  else if (tab === 'learn') main.append(h('h1', {}, 'Pelajari'), h('div', { class: 'lgrid' }, ...LEARN.map(([t, d, ic, k]) => h('div', { class: 'lcard glass' }, h('span', { class: 'lic', html: icon(ic, 22) }), h('b', {}, t), h('p', {}, d), k ? h('kbd', {}, k) : null))));
  else main.append(h('h1', {}, 'Apa yang baru'), h('div', { class: 'lgrid' }, ...NEWS.map(([t, d, ic]) => h('div', { class: 'lcard glass' }, h('span', { class: 'lic', html: icon(ic, 22) }), h('b', {}, t), h('p', {}, d)))));
}
const LEARN = [
  ['Pilih, putar, miringkan', 'Klik objek untuk memilih. Klik sekali lagi untuk menampilkan pegangan putar dan miring. Seret sudut untuk skala proporsional.', 'pick', 'Spasi'],
  ['Edit node', 'Alat Bentuk mengedit node dan pegangan kurva. Dobel klik segmen untuk menambah node.', 'shape', 'F10'],
  ['Pembentukan', 'Las, Pangkas, Irisan, Sederhanakan — pilih dua objek atau lebih, lalu gunakan bilah properti.', 'weld', ''],
  ['PowerClip', 'Masukkan gambar atau objek ke dalam bentuk apa pun: Objek › PowerClip › Tempatkan di dalam bingkai.', 'powerclip', ''],
  ['Campuran & kontur', 'Seret dari satu objek ke objek lain dengan Alat Campuran. Kontur membuat cincin konsentris.', 'blend', ''],
  ['Trace Otomatis', 'Unggah foto atau sketsa (mis. kursi) → garis vektor halus & presisi mengikuti objek: Bitmap › Trace Otomatis.', 'trace', ''],
  ['PowerTRACE', 'Ubah logo atau foto menjadi vektor: pilih bitmap lalu Bitmap › Trace bitmap.', 'trace', ''],
  ['Palet warna', 'Klik warna untuk isian, klik kanan untuk kerangka, ⌘/Ctrl+klik untuk mencampur.', 'palette', ''],
  ['Kunci ke objek', 'Garis bantu penjajaran dinamis muncul otomatis saat menyeret. Tahan Alt untuk mematikannya sementara.', 'magnet', 'Alt+Z'],
];
const NEWS = [
  ['Liquid Glass', 'Tema kaca cair dengan refraksi tepi, blur latar, dan tiga varian warna.', 'sparkle'],
  ['Efek langsung', 'Bayangan jatuh & perspektif, kontur, campuran sepanjang jalur, ekstrusi berpencahayaan, amplop, distorsi dan lensa.', 'fx'],
  ['Teks ke kurva', 'Semua teks memakai mesin tata letak yang sama untuk layar, ekspor dan konversi ke kurva.', 'text'],
  ['PDF vektor & raster', 'Terbitkan PDF multi-halaman dengan bleed, atau mode raster akurat untuk efek kompleks.', 'doc'],
  ['Kode QR & barcode', 'Sisipkan kode QR dan barcode EAN-13 yang tetap dapat diedit.', 'qr'],
  ['Simpan otomatis', 'Dokumen tersimpan otomatis setiap 30 detik dan dapat dibuka lagi dari Terbaru.', 'save'],
];
function heroArt() {
  return `<svg viewBox="0 0 320 200" aria-hidden="true"><defs><linearGradient id="ha" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ee6a6"/><stop offset=".55" stop-color="#19a8d8"/><stop offset="1" stop-color="#6d5cff"/></linearGradient><linearGradient id="hb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd166"/><stop offset="1" stop-color="#ef476f"/></linearGradient></defs>
  <circle cx="230" cy="96" r="64" fill="url(#ha)" opacity=".9"/><rect x="58" y="44" width="110" height="110" rx="22" fill="url(#hb)" transform="rotate(-12 113 99)"/>
  ${Array.from({ length: 7 }, (_, i) => `<circle cx="${70 + i * 26}" cy="${168 - Math.sin(i / 6 * Math.PI) * 30}" r="${8 + i}" fill="none" stroke="#fff" stroke-opacity="${.25 + i * .1}" stroke-width="1.5"/>`).join('')}
  <path d="M40 170C90 60 190 40 290 70" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M40 170 92 72" stroke="#fff" stroke-opacity=".6" stroke-dasharray="3 4"/>
  <rect x="35" y="165" width="10" height="10" fill="#fff"/><circle cx="92" cy="72" r="4.5" fill="#fff"/><rect x="285" y="65" width="10" height="10" fill="#fff"/></svg>`;
}
