// Module worker around the trace engine. Keeps the last image (and its cached stages) between runs.
import { Tracer } from './trace-engine.js';

let T = null, key = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type !== 'trace') return;
  try {
    if (m.img) { T = new Tracer(m.img); key = m.key; }
    if (!T || key !== m.key) throw new Error('no-image');
    const res = T.run(m.opts, (stage, f) => self.postMessage({ type: 'progress', id: m.id, stage, f }));
    const tr = [];
    for (const l of res.lines) tr.push(l.seg.buffer, l.cusp.buffer);
    for (const f of res.fills) for (const s of f.subs) tr.push(s.seg.buffer, s.cusp.buffer);
    self.postMessage({ type: 'result', id: m.id, res }, tr);
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, msg: String((err && err.message) || err) });
  }
};
