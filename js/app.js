// Application state: open documents, selection, history, render loop and a tiny event bus.
import { newDoc, curPage, curLayer, History, walk, walkPage, mk, cloneObj, applyM, objName } from './model.js';
import { renderPage } from './render.js';
import { setResolver, objBox, selBox, bumpEpoch } from './objgeom.js';
import { onFontLoad } from './fonts.js';
import { T } from './geom.js';
import { deep, uid, toast } from './util.js';

const LS = 'amatudraw.settings';
const SETTINGS = {
  theme: 'liquid-dark', accent: 'teal', glass: 'liquid', wheel: 'auto', nudge: 0.5, superNudge: 5, dupOffset: [5, 5],
  rulers: true, toolHints: true, autosave: true, palette: 'cmyk', dockers: ['props', 'objects'], dockW: 290, treatFilled: false,
  showBleed: true, defUnits: 'mm', yUp: false, startup: 'welcome', recentMax: 12, hiQuality: true, liveFx: true, fpsLimit: false,
};
function loadSettings() { try { return { ...SETTINGS, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { ...SETTINGS }; } }

export const App = {
  docs: [], doc: null, sel: [], tool: null, toolId: 'pick', tools: {}, clipboard: null, isolate: null, editing: null,
  settings: loadSettings(), wire: false, assetEpoch: 0, startOn: true, view: null, ui: {}, lastTool: {},
  _bus: {}, _idx: null, _rq: false, _ovq: false, assetURLs: new Map(),

  get page() { return this.doc && curPage(this.doc); },
  get layer() { return this.doc && curLayer(this.doc); },
  get hist() { return this.doc?._hist; },

  on(ev, fn) { (this._bus[ev] ||= []).push(fn); },
  emit(ev, ...a) { (this._bus[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(ev, e); } }); },
  saveSettings() { try { localStorage.setItem(LS, JSON.stringify(this.settings)); } catch { } },
  set(k, v) { this.settings[k] = v; this.saveSettings(); this.emit('settings', k); },

  // ---------- documents ----------
  newDocument(opts = {}) {
    const d = newDoc({ units: this.settings.defUnits, ...opts });
    if (!opts.name) {
      let n = 1; while (this.docs.some(x => x.name === 'Tanpa judul-' + n)) n++;
      d.name = 'Tanpa judul-' + n;
    }
    if (opts.build) opts.build(d);
    return this.openDoc(d);
  },
  openDoc(d) {
    d._hist = new History(d);
    d._hist.reset(d.pages.some(p => p.layers.some(l => l.objs.length)) ? 'Dokumen dibuka' : 'Dokumen baru');
    d._dirty = false;
    this.docs.push(d);
    this.activate(d);
    return d;
  },
  activate(d) {
    if (this.doc && this.view) this.doc.view = this.view.get();
    this.doc = d; this.sel = []; this.isolate = null; this.startOn = !d; this._idx = null;
    this.emit('doc');
    if (d && this.view) { d.view ? this.view.set(d.view) : setTimeout(() => this.view.fitPage(), 30); }
    this.render(); this.emit('sel');
  },
  closeDoc(d) {
    const i = this.docs.indexOf(d);
    if (i < 0) return;
    this.docs.splice(i, 1);
    this.emit('closed', d);
    this.activate(this.docs[Math.min(i, this.docs.length - 1)] || null);
    if (!this.doc) { this.startOn = true; this.emit('doc'); }
  },
  showStart() { if (this.doc && this.view) this.doc.view = this.view.get(); this.startOn = true; this.emit('doc'); },

  // ---------- index (id → location) ----------
  index() {
    if (this._idx) return this._idx;
    const m = new Map();
    if (this.doc) for (const p of this.doc.pages) for (const l of p.layers) walk(l.objs, (o, list, owner) => { m.set(o.id, { o, list, owner, layer: l, page: p }); });
    return this._idx = m;
  },
  find(id) { return this.index().get(id)?.o || null; },
  where(o) { return this.index().get(o.id); },
  dirtyIndex() { this._idx = null; },
  // list that new objects go into (layer or isolation container)
  get ctxList() {
    if (this.isolate) return this.isolate.type === 'g' ? this.isolate.ch : this.isolate.pc;
    return this.layer.objs;
  },
  topOf(o) { // climbs to the object that lives directly in the editable context
    let w = this.where(o);
    while (w && w.owner && w.list !== this.ctxList) { const up = this.where(w.owner); if (!up) break; o = w.owner; w = up; }
    return o;
  },

  // ---------- selection ----------
  select(list, mode = 'set') {
    list = (Array.isArray(list) ? list : [list]).filter(Boolean);
    if (mode === 'add') list = [...this.sel, ...list.filter(o => !this.sel.includes(o))];
    else if (mode === 'toggle') { const s = new Set(this.sel); for (const o of list) s.has(o) ? s.delete(o) : s.add(o); list = [...s]; }
    this.sel = list;
    this.emit('sel'); this.overlay();
  },
  clearSel() { if (this.sel.length) this.select([]); },
  selBox() { return selBox(this.sel); },
  allObjects(page = this.page) {
    const r = [];
    for (const l of page.layers) if (l.vis && !l.lock) r.push(...l.objs);
    return r;
  },
  refreshSel() { // re-bind selection after undo or replacement
    const ids = this.sel.map(o => o.id);
    this._idx = null;
    this.sel = ids.map(id => this.find(id)).filter(Boolean);
  },

  // ---------- mutations ----------
  add(objs, label, { select = true, list } = {}) {
    objs = Array.isArray(objs) ? objs : [objs];
    const L = list || this.ctxList;
    L.push(...objs);
    this._idx = null;
    if (select) this.sel = objs;
    this.commit(label || ('Buat ' + objName(objs[0])));
    return objs;
  },
  remove(objs) {
    for (const o of objs) { const w = this.where(o); if (w) { const i = w.list.indexOf(o); if (i >= 0) w.list.splice(i, 1); } }
    this._idx = null;
    this.sel = this.sel.filter(o => !objs.includes(o));
  },
  replace(o, n) {
    const w = this.where(o);
    if (!w) return;
    w.list[w.list.indexOf(o)] = n;
    this._idx = null;
    this.sel = this.sel.map(s => s === o ? n : s);
  },
  commit(label = 'Ubah') {
    if (!this.doc) return;
    this._idx = null;
    const pushed = this.hist.push(label, this.sel.map(o => o.id));
    this.doc.ver = (this.doc.ver || 0) + 1;
    if (pushed) { this.doc._dirty = true; this.doc.modified = Date.now(); this.emit('change', label); }
    this.render(); this.emit('sel');
  },
  undo() { const r = this.hist?.undo(); if (r) this.afterHist(r); },
  redo() { const r = this.hist?.redo(); if (r) this.afterHist(r); },
  goHist(i) { const r = this.hist?.go(i); if (r) this.afterHist(r); },
  afterHist(r) {
    this._idx = null;
    this.isolate = null;
    this.sel = (r.sel || []).map(id => this.find(id)).filter(Boolean);
    this.doc._dirty = true; this.doc.modified = Date.now();
    this.render(); this.emit('sel'); this.emit('change', 'history'); this.emit('page');
  },

  // ---------- rendering ----------
  assetURL(id) {
    if (!id || !this.doc?.assets[id]) return '';
    let u = this.assetURLs.get(id);
    if (!u) {
      const durl = this.doc.assets[id];
      try {
        const [head, b64] = durl.split(','), mime = head.match(/data:([^;]+)/)?.[1] || 'image/png';
        const bin = atob(b64), arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        u = URL.createObjectURL(new Blob([arr], { type: mime }));
      } catch { u = durl; }
      this.assetURLs.set(id, u);
    }
    return u;
  },
  addAsset(dataURL) {
    const d = this.doc;
    for (const k in d.assets) if (d.assets[k] === dataURL) return k;
    const id = uid('a');
    d.assets[id] = dataURL;
    return id;
  },
  render() {
    if (this._rq) return;
    this._rq = true;
    requestAnimationFrame(() => { this._rq = false; this.renderNow(); });
  },
  renderNow() {
    if (!this.doc || !this.view) return;
    const t0 = performance.now();
    const hide = this.editing ? new Set([this.editing.id]) : null;
    const r = renderPage(this.page, { mode: 'screen', wire: this.wire, asset: id => this.assetURL(id), units: this.doc.units, hide, assetEpoch: this.assetEpoch });
    this.view.setContent(r.defs, r.body, this.page);
    this._lastRender = performance.now() - t0;
    this.overlay();
  },
  overlay() {
    if (this._ovq) return;
    this._ovq = true;
    requestAnimationFrame(() => { this._ovq = false; this.view?.drawOverlay(); });
  },

  // ---------- tools ----------
  setTool(id, opts) {
    const t = this.tools[id];
    if (!t) return;
    if (this.tool?.deactivate) this.tool.deactivate();
    this.prevTool = this.toolId;
    this.tool = t; this.toolId = id;
    if (t.activate) t.activate(opts);
    this.emit('tool', id);
    this.overlay();
  },

  // ---------- helpers used by many commands ----------
  centerOn(objs, x, y) {
    const b = selBox(objs);
    if (!b) return;
    const m = T(x - (b.x + b.w / 2), y - (b.y + b.h / 2));
    objs.forEach(o => applyM(o, m));
  },
  paste(objs, offset = true) {
    const c = objs.map(o => cloneObj(deep(o)));
    if (offset === 'center') { const p = this.page; this.centerOn(c, p.w / 2, p.h / 2); }
    this.add(c, 'Tempel');
  },
  boxOf: objBox,
  walkPage,
  mk,
};

setResolver(id => App.find(id));
onFontLoad(() => { bumpEpoch(); App.render(); App.emit('fonts'); });
window.addEventListener('beforeunload', e => { if (App.docs.some(d => d._dirty) && !App.settings.autosave) { e.preventDefault(); e.returnValue = ''; } });
export { toast };
