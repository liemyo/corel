// "Trace Otomatis" panel shared by Amatu Design and Amatu Draw: upload, live preview, options.
// The host app mounts panel.el inside its own dialog and inserts panel.result with panel.style().
import { TraceSession, PRECISION, defaultPrecision, toSVG, aiCutout } from './trace-client.js';

const PREF = 'amatu.trace.v1';
export const TRACE_DEFAULTS = {
  mode: 'auto', detail: 65, smooth: 55, bg: 'auto', shadows: true, outline: true, fill: 'none', colors: 8,
  fillColor: '#f1dcb9', lineColor: '#1d1d22', lineWidth: 3, outlineBoost: 1.35, prec: null, focus: true, view: 'res',
};
const ENGINE_KEYS = ['mode', 'detail', 'smooth', 'bg', 'shadows', 'fill', 'colors', 'prec', 'focus'];
const STAGES = { analyze: 'Menganalisis gambar…', mask: 'Memisahkan objek dari latar…', edges: 'Mendeteksi garis objek…', fit: 'Menghaluskan kurva…', fill: 'Menyusun isian warna…', done: 'Selesai' };
const MODE_NAME = { photo: 'Foto / objek', lineart: 'Sketsa / garis', art: 'Clipart' };

function E(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
const ICON = {
  up: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-6 6-9 9-9s3 4 6 4 3-3 3-3"/><circle cx="3" cy="17" r="1.6"/><circle cx="21" cy="9" r="1.6"/></svg>',
  ai: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8L19 21l-.8-2.4-2-.8 2-.8z"/></svg>',
  dl: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};

let cssDone = false;
function injectCSS() {
  if (cssDone) return; cssDone = true;
  const css = `
.atr{--atr-a:var(--accent,#7b3fe4);display:grid;grid-template-columns:minmax(0,1fr) 296px;gap:14px;height:min(660px,calc(100vh - 190px));min-height:430px;color:var(--tx,#1d1d24);font-size:12.5px;text-align:left}
.atr *{box-sizing:border-box}
.atr-main{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0}
.atr-stage{position:relative;flex:1;min-height:0;border-radius:12px;overflow:hidden;border:1px solid var(--line2,rgba(0,0,0,.14));background:#fff repeating-conic-gradient(rgba(0,0,0,.045) 0 25%,transparent 0 50%) 0 0/16px 16px;display:flex;align-items:center;justify-content:center}
.atr-stage.over{outline:2px dashed var(--atr-a);outline-offset:-6px}
.atr-view{position:relative;flex:none;display:none}
.atr-view.on{display:block}
.atr-view>div{position:absolute;inset:0}
.atr-img{overflow:hidden}
.atr-img img{position:absolute;max-width:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
.atr-svg svg{display:block;width:100%;height:100%}
.atr-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px;text-align:center;color:#3a3a44}
.atr-empty b{font-size:15px}.atr-empty small{color:#777}
.atr-busy{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:none;align-items:center;gap:9px;padding:7px 14px 7px 10px;border-radius:99px;background:rgba(20,20,28,.82);color:#fff;font-size:12px;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.25)}
.atr-busy.on{display:flex}
.atr-spin{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:atrs .8s linear infinite}
@keyframes atrs{to{transform:rotate(360deg)}}
.atr-err{position:absolute;inset:auto 12px 12px;padding:9px 12px;border-radius:10px;background:#fde8e8;color:#9b1c1c;font-size:12px;display:none}
.atr-err.on{display:block}
.atr-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:30px}
.atr-stat{flex:1;min-width:120px;color:var(--tx3,#6a6b78);font-size:11.5px}
.atr-seg{display:flex;padding:2px;border-radius:9px;background:var(--hov,rgba(0,0,0,.06));gap:2px}
.atr-seg button{flex:1;border:0;background:none;color:inherit;font:inherit;font-size:12px;padding:5px 8px;border-radius:7px;cursor:pointer;white-space:nowrap;min-height:26px}
.atr-seg button:hover{background:var(--hov,rgba(0,0,0,.06))}
.atr-seg button.on{background:var(--atr-a);color:#fff}
.atr-seg.inl{display:inline-flex}
.atr-side{display:flex;flex-direction:column;gap:13px;overflow:auto;padding:2px 6px 2px 2px;min-height:0}
.atr-g{display:flex;flex-direction:column;gap:6px}
.atr-g>.atr-h{display:flex;justify-content:space-between;align-items:baseline;font-weight:600;font-size:11.5px;color:var(--tx2,#3e3f4b)}
.atr-h i{font-style:normal;font-weight:500;color:var(--tx3,#6a6b78)}
.atr-rng{width:100%;accent-color:var(--atr-a);margin:0}
.atr-ends{display:flex;justify-content:space-between;font-size:10.5px;color:var(--tx3,#6a6b78);margin-top:-3px}
.atr-chk{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;line-height:1.3}
.atr-chk input{accent-color:var(--atr-a);width:15px;height:15px;margin:0;flex:none}
.atr-row{display:flex;align-items:center;gap:10px}
.atr-col{width:34px;height:26px;border:1px solid var(--line2,rgba(0,0,0,.15));border-radius:7px;padding:2px;background:none;cursor:pointer;flex:none}
.atr-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line2,rgba(0,0,0,.15));background:var(--field,rgba(255,255,255,.7));color:inherit;font:inherit;font-size:12px;padding:6px 11px;border-radius:9px;cursor:pointer;white-space:nowrap}
.atr-btn:hover{border-color:var(--atr-a)}
.atr-btn.pri{background:var(--atr-a);border-color:var(--atr-a);color:#fff;font-weight:600;padding:9px 16px;font-size:13px}
.atr-btn:disabled{opacity:.5;cursor:default}
.atr-note{font-size:11px;color:var(--tx3,#6a6b78);line-height:1.4}
.atr-sep{height:1px;background:var(--line,rgba(0,0,0,.08));margin:2px 0}
@media (max-width:760px){.atr{grid-template-columns:1fr;height:auto;min-height:0}.atr-stage{height:46vh;flex:none}.atr-side{overflow:visible}}
`;
  document.head.append(E('style', { id: 'atr-css', html: css }));
}

const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
// Remembered between sessions: tuning and line style only. Fill always starts as 'none' (no colour), mode/background as automatic.
const KEEP = ['detail', 'smooth', 'shadows', 'outline', 'colors', 'fillColor', 'lineColor', 'lineWidth', 'prec', 'focus'];
const savePrefs = (st) => { try { localStorage.setItem(PREF, JSON.stringify(Object.fromEntries(KEEP.map(k => [k, st[k]])))); } catch { /* storage blocked */ } };

// source: File | Blob | URL string | null ; returns { el, result, style(), svg(extra), ready, load(file), destroy() }
export function tracePanel({ source = null, name = '', onResult } = {}) {
  injectCSS();
  const saved = loadPrefs(), st = { ...TRACE_DEFAULTS, ...Object.fromEntries(KEEP.filter(k => k in saved).map(k => [k, saved[k]])) };
  st.prec ||= defaultPrecision(); st.view = 'res';
  const S = new TraceSession();
  let res = null, srcURL = null, ownURL = false, blob = null, timer = 0, gen = 0, destroyed = false;

  // ---------- preview ----------
  const img = E('img', { alt: '', draggable: false });
  const lImg = E('div.atr-img', img), lSvg = E('div.atr-svg');
  const view = E('div.atr-view', lImg, lSvg);
  const fileIn = E('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: () => fileIn.files[0] && load(fileIn.files[0]) });
  const empty = E('div.atr-empty', E('div', { html: ICON.up, style: { color: 'var(--atr-a)' } }), E('b', 'Unggah gambar untuk di-trace'),
    E('small', 'Foto objek (mis. kursi), sketsa, logo atau clipart — JPG, PNG, WEBP, SVG'),
    E('button.atr-btn.pri', { type: 'button', onclick: () => fileIn.click() }, 'Pilih gambar…'), E('small', 'atau seret & lepas gambar di sini'));
  const busyTx = E('span'), busy = E('div.atr-busy', E('i.atr-spin'), busyTx);
  const err = E('div.atr-err');
  const stage = E('div.atr-stage', view, empty, busy, err);
  const tabs = seg([['res', 'Hasil'], ['cmp', 'Bandingkan'], ['src', 'Asli']], () => st.view, (v) => { st.view = v; draw(); }, true);
  const stat = E('div.atr-stat');
  const btnNew = E('button.atr-btn', { type: 'button', onclick: () => fileIn.click() }, 'Ganti gambar');
  const btnSvg = E('button.atr-btn', { type: 'button', title: 'Unduh hasil sebagai SVG', html: ICON.dl + '<span>SVG</span>', onclick: downloadSVG });
  const main = E('div.atr-main', stage, E('div.atr-bar', tabs, stat, btnSvg, btnNew), fileIn);

  for (const ev of ['dragenter', 'dragover']) stage.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); stage.classList.add('over'); } });
  stage.addEventListener('dragleave', () => stage.classList.remove('over'));
  stage.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('over'); const f = [...e.dataTransfer.files].find(x => /^image\//.test(x.type)); if (f) load(f); });

  // ---------- options ----------
  const modeSeg = seg([['auto', 'Otomatis'], ['photo', 'Foto / objek'], ['lineart', 'Sketsa']], () => st.mode, set('mode'));
  const fillExtra = E('div.atr-g');
  const side = E('div.atr-side',
    group('Jenis gambar', modeSeg),
    range('Detail garis', 'detail', 0, 100, 1, ['Garis utama', 'Sangat detail']),
    range('Kehalusan garis', 'smooth', 0, 100, 1, ['Tegas / bersudut', 'Sangat halus']),
    E('div.atr-sep'),
    group('Latar belakang', seg([['auto', 'Otomatis'], ['remove', 'Hapus latar'], ['keep', 'Pertahankan']], () => st.bg, set('bg')),
      check('Abaikan bayangan di lantai', 'shadows'),
      E('div.atr-row', E('button.atr-btn', { type: 'button', onclick: runAI, html: ICON.ai + '<span>Pisahkan objek (AI)</span>', title: 'Untuk foto berlatar ramai: AI memisahkan objek dari latar, langsung di perangkat (unduhan model ±40 MB sekali).' })),
    ),
    E('div.atr-sep'),
    group('Garis', E('div.atr-row', colorIn('lineColor', 'Warna garis'), rangeInline('lineWidth', 0.5, 8, 0.25)), check('Garis luar objek lebih tegas', 'outline')),
    group('Isian warna', seg([['none', 'Tanpa isian'], ['color', 'Warna asli'], ['solid', 'Satu warna']], () => st.fill, set('fill')), fillExtra),
    E('div.atr-sep'),
    group('Presisi', seg(PRECISION.map(([k, l]) => [k, l]), () => st.prec, set('prec')), check('Fokus otomatis ke objek (lebih detail)', 'focus')),
  );
  const root = E('div.atr', main, side);
  const ro = new ResizeObserver(() => fit()); ro.observe(stage);

  function refreshFillExtra() {
    fillExtra.textContent = '';
    if (st.fill === 'color') fillExtra.append(range('Jumlah warna', 'colors', 2, 24, 1, ['Sederhana', 'Kaya warna']));
    else if (st.fill === 'solid') fillExtra.append(E('div.atr-row', colorIn('fillColor', 'Warna isian'), E('span.atr-note', 'Mengisi bagian dalam objek')));
    else fillExtra.append(E('span.atr-note', 'Default: hanya garis (tanpa warna).'));
  }
  refreshFillExtra();

  // ---------- controls ----------
  function group(title, ...kids) { return E('div.atr-g', E('div.atr-h', title), ...kids); }
  function seg(items, get, onset, inline) {
    const box = E('div.atr-seg' + (inline ? '.inl' : ''));
    const paint = () => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(get())));
    for (const [v, l] of items) box.append(E('button', { type: 'button', 'data-v': v, onclick: () => { onset(v); paint(); } }, l));
    box.paint = paint; paint();
    return box;
  }
  function range(label, key, min, max, step, ends) {
    const out = E('i', String(st[key]));
    const r = E('input.atr-rng', { type: 'range', min, max, step, value: st[key] });
    r.addEventListener('input', () => { out.textContent = r.value; });
    r.addEventListener('change', () => set(key)(+r.value));
    return E('div.atr-g', E('div.atr-h', label, out), r, ends ? E('div.atr-ends', E('span', ends[0]), E('span', ends[1])) : null);
  }
  function rangeInline(key, min, max, step) {
    const out = E('i', { style: { minWidth: '30px', fontStyle: 'normal', textAlign: 'right' } }, String(st[key]));
    const r = E('input.atr-rng', { type: 'range', min, max, step, value: st[key], title: 'Tebal garis' });
    r.addEventListener('input', () => { out.textContent = r.value; set(key)(+r.value); });
    return E('div.atr-row', { style: { flex: 1, gap: '8px' } }, E('span.atr-note', 'Tebal'), r, out);
  }
  function check(label, key) {
    const i = E('input', { type: 'checkbox', checked: !!st[key], onchange: () => set(key)(i.checked) });
    return E('label.atr-chk', i, E('span', label));
  }
  function colorIn(key, title) {
    const i = E('input.atr-col', { type: 'color', value: st[key], title });
    i.addEventListener('input', () => set(key)(i.value));
    return i;
  }
  function set(key) {
    return (v) => {
      st[key] = v; savePrefs(st);
      if (key === 'fill') refreshFillExtra();
      if (ENGINE_KEYS.includes(key)) schedule(); else draw();
    };
  }

  // ---------- run ----------
  function schedule(ms = 220) { clearTimeout(timer); timer = setTimeout(run, ms); }
  async function run() {
    if (!S.loaded || destroyed) return;
    const my = ++gen;
    err.classList.remove('on');
    busy.classList.add('on'); busyTx.textContent = STAGES.analyze;
    try {
      const r = await S.run({ mode: st.mode, detail: st.detail, smooth: st.smooth, bg: st.bg, shadows: st.shadows, outline: true, fill: st.fill, colors: st.colors, focus: st.focus }, st.prec,
        (stage) => { if (my === gen) busyTx.textContent = STAGES[stage] || '…'; });
      if (!r || my !== gen || destroyed) return;
      res = r; busy.classList.remove('on');
      draw(); onResult?.(res);
    } catch (e) {
      if (my !== gen) return;
      busy.classList.remove('on');
      err.textContent = 'Trace gagal: ' + (e?.message || e); err.classList.add('on');
    }
  }
  async function load(input, nm) {
    try {
      err.classList.remove('on');
      busy.classList.add('on'); busyTx.textContent = 'Membaca gambar…';
      await S.load(input);
      blob = input instanceof Blob ? input : null;
      if (ownURL && srcURL) URL.revokeObjectURL(srcURL);
      if (blob) { srcURL = URL.createObjectURL(blob); ownURL = true; } else { srcURL = typeof input === 'string' ? input : input?.src; ownURL = false; }
      img.src = srcURL;
      name = nm || input?.name || name;
      res = null; empty.style.display = 'none';
      await run();
    } catch (e) {
      busy.classList.remove('on');
      err.textContent = 'Gambar tidak dapat dibuka: ' + (e?.message || e); err.classList.add('on');
    }
  }
  async function runAI() {
    if (!S.loaded) return fileIn.click();
    try {
      busy.classList.add('on'); busyTx.textContent = 'Memuat model AI…';
      let b = blob;
      if (!b) b = await (await fetch(srcURL)).blob();
      const out = await aiCutout(b, (k, f) => { busyTx.textContent = (/fetch|download/i.test(k) ? 'Mengunduh model AI ' : 'Memisahkan objek ') + Math.round(f * 100) + '%'; });
      st.bg = 'auto';
      side.querySelectorAll('.atr-seg').forEach(s => s.paint?.());
      await load(out, name);
    } catch (e) {
      busy.classList.remove('on');
      err.textContent = 'AI tidak tersedia: ' + (e?.message || e); err.classList.add('on');
    }
  }

  // ---------- drawing ----------
  function style(extra) { return { lineColor: st.lineColor, lineWidth: st.lineWidth, outlineBoost: st.outline ? st.outlineBoost : 1, outline: true, fill: st.fill, fillColor: st.fillColor, ...extra }; }
  function fit() {
    if (!res) return;
    const W = stage.clientWidth - 24, H = stage.clientHeight - 24, k = Math.max(0.01, Math.min(W / res.w, H / res.h));
    view.style.width = Math.round(res.w * k) + 'px'; view.style.height = Math.round(res.h * k) + 'px';
  }
  function draw() {
    tabs.paint();
    if (!res) { view.classList.remove('on'); return; }
    view.classList.add('on'); fit();
    const [cx, cy, cw, ch] = res.crop;
    Object.assign(img.style, { width: 100 / cw + '%', height: 100 / ch + '%', left: -cx / cw * 100 + '%', top: -cy / ch * 100 + '%' });
    lImg.style.display = st.view === 'res' ? 'none' : '';
    lImg.style.opacity = st.view === 'cmp' ? '.35' : '1';
    lSvg.style.display = st.view === 'src' ? 'none' : '';
    if (st.view !== 'src') lSvg.innerHTML = toSVG(res, style({ fit: true }));
    const auto = st.mode === 'auto' ? ' (otomatis)' : '';
    stat.textContent = `${MODE_NAME[res.mode === 'photo' && res.auto === 'art' ? 'art' : res.mode]}${auto} · ${res.lines.length} garis · ${res.stats.segs} kurva${res.fills.length ? ' · ' + res.fills.length + ' warna' : ''}${res.object ? ' · objek terdeteksi' : ''} · ${(res.stats.ms / 1000).toFixed(1)} dtk`;
  }
  function downloadSVG() {
    if (!res) return;
    const svg = toSVG(res, style()), a = E('a', { href: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), download: (name || 'trace').replace(/\.[a-z0-9]+$/i, '') + '-trace.svg' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  const ready = source ? load(source, name) : Promise.resolve();
  return {
    el: root, ready, load, style, state: st,
    get result() { return res; },
    get busy() { return busy.classList.contains('on'); },
    get source() { return blob; },
    svg: (extra) => (res ? toSVG(res, style(extra)) : ''),
    pick: () => fileIn.click(),
    destroy() { destroyed = true; clearTimeout(timer); ro.disconnect(); S.dispose(); if (ownURL && srcURL) URL.revokeObjectURL(srcURL); },
  };
}
