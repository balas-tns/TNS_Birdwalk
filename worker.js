/* TNS Bird Walk – analysis worker.
   Runs BirdNET+ V3.0 (ONNX) with ONNX Runtime Web, off the main thread.
   Messages in:  init, geo, start, audio, flush
   Messages out: ready, error, geo, window, queue, flushed */
'use strict';
const ORT_VERSION = '1.20.1';
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';

let cfg = null, session = null, geoSession = null, labels = [];
let feedPlan = null;            // {name, type, shape} that worked for the audio model
let N = 96000, SR = 32000;      // window length in samples, target sample rate
let srcRate = 48000, resPos = 0, srcBuf = new Float32Array(0), prev = [0, 0];
let outBuf = new Float32Array(0), windowIndex = 0, busy = false, flushing = false;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') await init(m.config);
    else if (m.type === 'geo') await runGeo(m.lat, m.lon, m.week);
    else if (m.type === 'start') reset(m.rate);
    else if (m.type === 'audio') { pushAudio(m.data); pump(); }
    else if (m.type === 'flush') { flushing = true; pump(); }
  } catch (err) {
    self.postMessage({ type: 'error', where: m.type, message: String(err && err.message || err) });
  }
};

async function init(config) {
  cfg = config;
  SR = cfg.model.sampleRate || 32000;
  N = Math.round(SR * (cfg.model.windowSeconds || 3));
  importScripts(ORT_BASE + 'ort.min.js');
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = 1;   // threads need special server headers; 1 works everywhere

  const txt = await (await mustFetch(cfg.model.labelsUrl)).text();
  labels = parseLabels(txt, cfg.model);
  const buf = await fetchModel(cfg.model.audioModelUrl);
  session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });

  let geo = false;
  if (cfg.model.geoModelUrl) {
    try {
      const gb = await fetchModel(cfg.model.geoModelUrl);
      geoSession = await ort.InferenceSession.create(gb, { executionProviders: ['wasm'] });
      geo = true;
    } catch (err) { geoSession = null; }
  }
  self.postMessage({
    type: 'ready', labels, geo,
    info: { inputs: session.inputNames, outputs: session.outputNames, windowSamples: N, sampleRate: SR }
  });
}

/* A model can be one file, or a list of parts that are joined back together here.
   Parts let the ~70 MB audio model live on hosts that limit file size (Cloudflare Pages allows 25 MB per file).
   If model/audio.onnx is missing, the parts model/audio.onnx.001, .002, … are used automatically,
   so splitting the model needs no change to config.js. */
async function fetchModel(url) {
  let list = url;
  if (!Array.isArray(url)) {
    const isFile = (r) => r.ok && !/text\/html/.test(r.headers.get('content-type') || '');   // some hosts answer a missing file with the app page
    const whole = await fetch(url);
    if (isFile(whole)) return whole.arrayBuffer();
    list = [];
    for (let i = 1; i < 100; i++) {
      const u = url + '.' + String(i).padStart(3, '0');
      const r = await fetch(u);
      if (!isFile(r)) break;
      list.push(new Uint8Array(await r.arrayBuffer()));
    }
    if (!list.length) throw new Error('Could not load ' + url + ' (' + whole.status + ')');
    return join(list);
  }
  const parts = [];
  for (const u of list) parts.push(new Uint8Array(await (await mustFetch(u)).arrayBuffer()));
  return join(parts);
}
function join(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}
async function mustFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not load ' + url + ' (' + r.status + ')');
  return r;
}

/* ---------- labels ---------- */
function splitLine(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === d && !q) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
function parseLabels(text, mc) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('Labels file is empty');
  const first = lines[0];
  const d = ['\t', ',', ';'].map(x => [x, first.split(x).length]).sort((a, b) => b[1] - a[1])[0];
  const delim = d[1] > 1 ? d[0] : null;
  const rows = lines.map(l => delim ? splitLine(l, delim) : [l.trim()]);
  const head = rows[0].map(h => h.toLowerCase());
  const isHeader = head.some(h => /sci|common|label|species|class|group|^id$|^en$|name/.test(h)) && !/\s.*_/.test(rows[0][0]);
  const find = (want, re) => {
    if (want) { const i = head.indexOf(String(want).toLowerCase()); if (i >= 0) return i; }
    return head.findIndex(h => re.test(h));
  };
  let sciC = -1, comC = -1, grpC = -1, labC = -1, body = rows;
  if (isHeader) {
    sciC = find(null, /sci/);
    comC = find(mc.commonNameColumn, /common|com_name|^en$|_en$|english|vernacular/);
    grpC = find(mc.groupColumn, /class|group|taxon/);
    labC = find(null, /label|species/);
    body = rows.slice(1);
  }
  return body.map(f => {
    let sci = '', common = '', group = '';
    if (isHeader) {
      sci = sciC >= 0 ? f[sciC] || '' : '';
      common = comC >= 0 ? f[comC] || '' : '';
      group = grpC >= 0 ? f[grpC] || '' : '';
      if ((!sci || !common) && labC >= 0 && f[labC]) {
        const p = f[labC].split('_'); sci = sci || p[0]; common = common || p.slice(1).join('_');
      }
    } else if (f.length === 1) {
      const p = f[0].split('_'); sci = p[0]; common = p.slice(1).join('_') || p[0];
    } else { sci = f[0]; common = f[1]; group = f[2] || ''; }
    const human = /homo sapiens|\bhuman\b/i.test(sci + ' ' + common);
    const nonAnimal = !human && (/non.?animal|noise|anthrop|environment|abiotic/i.test(group) || (!group && sci && !/\s/.test(sci)));
    return { sci, common: common || sci, group: friendlyGroup(group), human, nonAnimal };
  });
}
function friendlyGroup(g) {
  if (!g) return 'Wildlife';
  if (/aves|bird/i.test(g)) return 'Birds';
  if (/amphib|frog|anura/i.test(g)) return 'Frogs & toads';
  if (/insect|orthop|hemip/i.test(g)) return 'Insects';
  if (/mamm/i.test(g)) return 'Mammals';
  if (/rept/i.test(g)) return 'Reptiles';
  return g;
}

/* ---------- geomodel ---------- */
async function runGeo(lat, lon, week) {
  if (!geoSession) { self.postMessage({ type: 'geo', ok: false }); return; }
  const name = geoSession.inputNames[0];
  const vals = new Float32Array([lat, lon, week]);
  let res = null;
  for (const shape of [[1, 3], [3]]) {
    for (const t of ['float32', 'float16']) {
      try {
        const data = t === 'float16' ? toHalf(vals) : vals;
        res = await geoSession.run({ [name]: new ort.Tensor(t, data, shape) });
        break;
      } catch (err) { res = null; }
    }
    if (res) break;
  }
  if (!res) { self.postMessage({ type: 'geo', ok: false }); return; }
  const scores = pickScores(res, labels.length);
  if (!scores) { self.postMessage({ type: 'geo', ok: false }); return; }
  const allowed = [];
  for (let i = 0; i < scores.length; i++) if (scores[i] >= cfg.geoThreshold) allowed.push(i);
  self.postMessage({ type: 'geo', ok: true, allowed });
}

/* ---------- audio in: resample to 32 kHz ---------- */
function reset(rate) {
  srcRate = rate || 48000; resPos = 0; srcBuf = new Float32Array(0); prev = [0, 0];
  outBuf = new Float32Array(0); windowIndex = 0; flushing = false;
}
function concat(a, b) { const c = new Float32Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }
function pushAudio(chunk) {
  let x = chunk;
  if (srcRate > SR) {                    // gentle low-pass before downsampling
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      y[i] = 0.25 * prev[0] + 0.5 * prev[1] + 0.25 * x[i];
      prev[0] = prev[1]; prev[1] = x[i];
    }
    x = y;
  }
  if (srcRate === SR) { outBuf = concat(outBuf, x); return; }
  srcBuf = concat(srcBuf, x);
  const step = srcRate / SR, out = [];
  while (resPos + 1 < srcBuf.length) {
    const i = Math.floor(resPos), f = resPos - i;
    out.push(srcBuf[i] * (1 - f) + srcBuf[i + 1] * f);
    resPos += step;
  }
  const drop = Math.floor(resPos);
  srcBuf = srcBuf.slice(drop); resPos -= drop;
  outBuf = concat(outBuf, Float32Array.from(out));
}

/* ---------- analysis loop ---------- */
async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (outBuf.length >= N || (flushing && outBuf.length > SR * 0.5)) {
      let win;
      if (outBuf.length >= N) { win = outBuf.slice(0, N); outBuf = outBuf.slice(N); }
      else { win = new Float32Array(N); win.set(outBuf); outBuf = new Float32Array(0); }
      self.postMessage({ type: 'queue', pendingSeconds: outBuf.length / SR });
      const idx = windowIndex++;
      try { await analyse(win, idx); }
      catch (err) { self.postMessage({ type: 'error', where: 'analyse', message: String(err && err.message || err) }); }
    }
    if (flushing) { flushing = false; outBuf = new Float32Array(0); self.postMessage({ type: 'flushed' }); }
  } finally { busy = false; }
}

async function analyse(win, index) {
  let peak = 0; for (let i = 0; i < win.length; i++) { const a = Math.abs(win[i]); if (a > peak) peak = a; }
  const scores = await infer(win);
  const dets = []; let human = false;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] < cfg.minConfidence) continue;
    const L = labels[i];
    if (!L) continue;
    if (L.human) { human = true; continue; }
    if (L.nonAnimal) continue;
    dets.push({ i, score: scores[i] });
  }
  dets.sort((a, b) => b.score - a.score);
  let pcm = null;
  if (dets.length && !human) {           // keep audio only for wildlife, never for human voices
    pcm = new Int16Array(win.length);
    for (let i = 0; i < win.length; i++) pcm[i] = Math.max(-1, Math.min(1, win[i])) * 32767;
  }
  self.postMessage({ type: 'window', index, startSec: index * N / SR, dets: dets.slice(0, 5), human, peak, pcm }, pcm ? [pcm.buffer] : []);
}

async function infer(win) {
  const name = session.inputNames[0];
  const plans = feedPlan ? [feedPlan] : [
    { t: 'float32', s: [1, N] }, { t: 'float32', s: [1, 1, N] }, { t: 'float32', s: [N] },
    { t: 'float16', s: [1, N] }, { t: 'float16', s: [1, 1, N] }
  ];
  let lastErr = null;
  for (const p of plans) {
    try {
      const data = p.t === 'float16' ? toHalf(win) : win;
      const res = await session.run({ [name]: new ort.Tensor(p.t, data, p.s) });
      const scores = pickScores(res, labels.length);
      if (!scores) throw new Error('No output matches the labels file (' + labels.length + ' labels)');
      feedPlan = p;
      return scores;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Model would not run');
}

function pickScores(res, n) {
  for (const k of Object.keys(res)) {
    const t = res[k];
    const data = t.type === 'float16' ? fromHalf(t.data) : t.data;
    if (data.length === n) {
      const s = Float32Array.from(data);
      let lo = Infinity, hi = -Infinity;
      for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (lo < 0 || hi > 1) for (let i = 0; i < s.length; i++) s[i] = 1 / (1 + Math.exp(-s[i]));
      return s;
    }
  }
  return null;
}

/* ---------- float16 helpers ---------- */
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(arr) {
  const out = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    f32[0] = arr[i]; const x = u32[0];
    const sign = (x >> 16) & 0x8000, exp = ((x >> 23) & 0xff) - 112, mant = x & 0x7fffff;
    if (exp <= 0) out[i] = sign;
    else if (exp >= 31) out[i] = sign | 0x7c00;
    else out[i] = sign | (exp << 10) | (mant >> 13);
  }
  return out;
}
function fromHalf(h) {
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const v = h[i], s = v & 0x8000 ? -1 : 1, e = (v >> 10) & 0x1f, m = v & 0x3ff;
    out[i] = e === 0 ? s * m * Math.pow(2, -24) : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * Math.pow(2, e - 15);
  }
  return out;
}
