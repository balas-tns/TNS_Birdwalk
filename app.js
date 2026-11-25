/* TNS Bird Walk – main app */
{
'use strict';
const C = window.TNS_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};

/* ---------- state ---------- */
const S = {
  model: 'loading',           // loading | ready | demo | error
  modelMsg: '', info: null, labels: [], geoOk: false, geoAllowed: null,
  route: null, walk: null, lastWalk: null, deferredInstall: null,
  settings: Object.assign({ name: '', deviceId: '', minConfidence: C.minConfidence, voice: false, buzz: false, big: false, hc: false, every: 10, repeat: false }, store.get('tnsSettings', {})),
  walks: store.get('tnsWalks', []),
  places: store.get('tnsPlaces', [])        // places added on this phone or scanned from a place QR code
};
const ANYWHERE = { id: 'free', name: 'Walk anywhere', meta: 'Any place, any path, any length', tag: 'Open' };
const slug = (t) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'place';
const allRoutes = () => C.routes.concat(S.places, [ANYWHERE]);

/* ---------- accessibility: screen reader, speech, vibration, display ---------- */
let srTimer = null;
function announce(msg, urgent) {            // read out by TalkBack / VoiceOver without moving focus
  const el = $(urgent ? '#srA' : '#sr'); if (!el) return;
  el.textContent = ''; clearTimeout(srTimer);
  srTimer = setTimeout(() => { el.textContent = msg; }, 60);
}
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices(); } catch (e) {} }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(msg, force) {                // the app's own voice, for walkers who don't use a screen reader
  if (!(S.settings.voice || force) || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(msg);
    u.voice = voices.find((v) => v.lang === 'en-IN') || voices.find((v) => /^en/.test(v.lang)) || null;
    u.lang = u.voice ? u.voice.lang : 'en-IN'; u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function tell(msg, urgent) { announce(msg, urgent); speak(msg); }
function buzz(pattern) { if (S.settings.buzz && navigator.vibrate) try { navigator.vibrate(pattern); } catch (e) {} }
function applyDisplay() { document.body.classList.toggle('big', !!S.settings.big); document.body.classList.toggle('hc', !!S.settings.hc); }
function saveSettings() { store.set('tnsSettings', S.settings); applyDisplay(); }
function focusHeading() { const h = view.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: false }); } }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
function spokenTime(ms) { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'less than a minute' : plural(m, 'minute'); }
function walkStatus() {
  const w = S.walk; if (!w) return '';
  const now = w.paused ? w.pausedAt : Date.now(), sp = Object.values(w.species);
  const recent = sp.sort((a, b) => b.t - a.t).slice(0, 3).map((s) => `${s.common}, ${Math.round(s.best * 100)} percent`);
  const last = w.track[w.track.length - 1];
  return `${w.paused ? 'Paused. ' : ''}${spokenTime(now - w.start - w.pausedMs)} walked, ${km(w.track).toFixed(1)} kilometres. ` +
    (sp.length ? `${plural(sp.length, 'species', 'species')} so far. Latest: ${recent.join(', ')}.` : (w.demo ? 'Demo mode: birds are added when you finish.' : 'No birds identified yet.')) +
    (last ? '' : ' Still waiting for GPS.');
}
function addPlace(name, lat, lon) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return null;
  const id = 'p-' + slug(name);
  let p = S.places.find((x) => x.id === id);
  if (!p) {
    p = { id, name, meta: lat != null ? 'Added place · ' + lat.toFixed(4) + ', ' + lon.toFixed(4) : 'Added place', tag: 'Place', lat: lat != null ? +lat.toFixed(5) : null, lon: lon != null ? +lon.toFixed(5) : null };
    S.places.push(p); store.set('tnsPlaces', S.places);
  }
  return p;
}
const placeLink = (base, p) => base + '#place-' + encodeURIComponent(p.name) + (p.lat != null ? '~' + p.lat + ',' + p.lon : '');
const DEMO = [
  ['Asian Koel', 'Eudynamys scolopaceus', 'Birds'], ['Red-vented Bulbul', 'Pycnonotus cafer', 'Birds'],
  ['Purple-rumped Sunbird', 'Leptocoma zeylonica', 'Birds'], ['Greater Coucal', 'Centropus sinensis', 'Birds'],
  ['Rose-ringed Parakeet', 'Psittacula krameri', 'Birds'], ['Common Tailorbird', 'Orthotomus sutorius', 'Birds'],
  ['Ashy Prinia', 'Prinia socialis', 'Birds'], ['White-throated Kingfisher', 'Halcyon smyrnensis', 'Birds'],
  ['Indian Pitta', 'Pitta brachyura', 'Birds'], ['Indian Bullfrog', 'Hoplobatrachus tigerinus', 'Frogs & toads']
];

/* ---------- model worker ---------- */
let worker = null, flushResolve = null;
function startWorker() {
  try { worker = new Worker('worker.js'); } catch (e) { setModel('error', 'This browser cannot run the analysis worker.'); return; }
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') { S.labels = m.labels; S.info = m.info; S.geoOk = m.geo; setModel('ready', ''); }
    else if (m.type === 'error') {
      if (S.model === 'loading') setModel(C.demoIfNoModel ? 'demo' : 'error', m.message);
      else { S.modelMsg = m.message; if (S.walk) S.walk.errors = (S.walk.errors || 0) + 1; }
    }
    else if (m.type === 'geo') { S.geoAllowed = m.ok ? new Set(m.allowed) : null; if (S.walk) S.walk.geoUsed = !!m.ok; }
    else if (m.type === 'window') onWindow(m);
    else if (m.type === 'queue') { if (S.walk) S.walk.pending = m.pendingSeconds; }
    else if (m.type === 'flushed') { if (flushResolve) { flushResolve(); flushResolve = null; } }
  };
  worker.postMessage({ type: 'init', config: C });
}
function setModel(state, msg) {
  S.model = state; S.modelMsg = msg || '';
  const b = $('#modelBadge');
  b.textContent = { loading: 'Loading model…', ready: 'BirdNET+ V3.0 ready', demo: 'Demo mode', error: 'Model missing' }[state];
  if (state !== 'loading' && (!location.hash || location.hash === '#home')) announce(state === 'ready' ? 'Bird model ready.' : state === 'demo' ? 'Demo mode. Results will be sample data.' : 'The bird model could not load.');
  if (location.hash === '' || location.hash === '#home' || location.hash.startsWith('#more')) route();
}

/* ---------- routing ---------- */
function go(h) { if (location.hash === '#' + h) route(); else location.hash = h; }
window.addEventListener('hashchange', route);
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
function route() {
  const h = location.hash.slice(1) || 'home';
  if (h.startsWith('place-')) {
    let name = '', lat = null, lon = null;
    try {
      const [n, ll] = decodeURIComponent(h.slice(6)).split('~');
      name = n;
      if (ll) { const [a, b] = ll.split(',').map(Number); if (isFinite(a) && isFinite(b)) { lat = a; lon = b; } }
    } catch (e) {}
    const p = addPlace(name, lat, lon);
    if (p) { S.route = p.id; setTimeout(() => tell(p.name + ' is ready. Find the Start walk button.'), 800); }
    location.replace('#home');
    return;
  }
  if (h === 'access' || h.startsWith('access-')) {        // a QR code that opens the app in spoken mode, optionally with a route
    Object.assign(S.settings, { voice: true, buzz: true, big: true }); saveSettings();
    const rid = h.slice(7); if (rid && allRoutes().some((x) => x.id === rid)) S.route = rid;
    location.replace('#home');
    setTimeout(() => speak('Welcome to TNS Bird Walk. Spoken mode is on. ' + (S.route ? 'Your route is selected. ' : '') + 'Find the Start walk button near the bottom of the screen.', true), 900);
    return;
  }
  if (h.startsWith('route-')) {
    const r = C.routes.find((x) => x.id === h.slice(6));
    if (r) { S.route = r.id; setTimeout(() => tell(r.name + ' is ready. Find the Start walk button.'), 800); }
    location.replace('#home');
    return;
  }
  if (S.walk && S.walk.active && h !== 'walk') { location.hash = 'walk'; return; }
  const tab = h.startsWith('results') ? 'history' : h === 'walk' ? 'home' : h;
  document.querySelectorAll('.navb').forEach((b) => b.setAttribute('aria-current', b.dataset.go === tab ? 'page' : 'false'));
  if (h === 'walk') renderWalk();
  else if (h === 'history') renderHistory();
  else if (h === 'more') renderMore();
  else if (h.startsWith('results-')) renderResults(h.slice(8));
  else renderHome();
  if (h !== lastPage) { if (lastPage !== null) focusHeading(); lastPage = h; }
}
let lastPage = null;

/* ---------- home ---------- */
function renderHome() {
  const total = S.walks.length, species = new Set();
  S.walks.forEach((w) => w.species.forEach((s) => species.add(s.sci)));
  const notice = S.model === 'demo'
    ? `<p class="banner">Demo mode: the BirdNET+ V3.0 files aren't on the server yet, so results will be sample data. GPS and the walk timer are real.</p>`
    : S.model === 'error' ? `<p class="banner err">The bird sound model could not load. ${esc(S.modelMsg)}</p>` : '';
  view.innerHTML = `
    ${notice}
    <section class="hero">
      <p style="font-size:13px;font-weight:600;opacity:.85">${S.settings.name ? 'Namaskaram, ' + esc(S.settings.name) : 'Namaskaram'}</p>
      <h1>Ready for a bird walk?</h1>
      <div class="stats"><div><b>${total}</b><span>walks</span></div><div><b>${species.size}</b><span>species</span></div></div>
      ${S.settings.voice ? '' : '<button class="btn alt small" id="a11yOn" style="background:#fff">Turn on spoken mode (for blind and low-vision walkers)</button>'}
    </section>
    <h2>Choose a route or place</h2>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${allRoutes().map((r) => `
        <button class="route" data-route="${esc(r.id)}" aria-pressed="${S.route === r.id}" aria-label="${esc(r.name)}. ${esc(r.meta)}. ${esc(r.tag)}">
          <span class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1F5C43" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 19c3-6 5-2 8-8s5-4 8-6"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="5" r="1.5"/></svg></span>
          <span style="flex:1"><b>${esc(r.name)}</b><span class="muted">${esc(r.meta)}</span></span>
          <span class="tag">${esc(r.tag)}</span>
        </button>`).join('')}
    </div>
    <p class="card muted">${S.settings.voice ? 'Spoken mode is on. Start the walk, then keep the phone in a shirt pocket or on a lanyard with the microphone facing out. The phone tells you each new bird it hears. Double-tap the Say status button at any time.' : 'Best between 6:00 and 8:30 am. Hold the phone out of your pocket with the screen on, walk slowly, and stop for a minute every 200 m.'}</p>
    <button class="btn" id="start" ${S.route && S.model !== 'loading' && S.model !== 'error' ? '' : 'disabled'}>${S.model === 'loading' ? 'Loading the bird model…' : S.route ? 'Start walk' : 'Pick a route or Walk anywhere'}</button>
    ${S.deferredInstall ? '<button class="btn alt" id="install">Install the app on this phone</button>' : ''}`;
  view.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => {
    S.route = b.dataset.route; renderHome();
    const again = view.querySelector(`[data-route="${CSS.escape(S.route)}"]`); if (again) again.focus();
    const r = allRoutes().find((x) => x.id === S.route);
    tell((r ? r.name : 'Route') + ' selected. The Start walk button is below the list.');
  }));
  const on = $('#a11yOn');
  if (on) on.addEventListener('click', () => {
    Object.assign(S.settings, { voice: true, buzz: true, big: true }); saveSettings(); renderHome(); focusHeading();
    speak('Spoken mode is on. The phone will speak each new bird and give a walk update every ' + S.settings.every + ' minutes. Change this under Share and settings.', true);
  });
  const st = $('#start'); if (st) st.addEventListener('click', startWalk);
  const ins = $('#install');
  if (ins) ins.addEventListener('click', async () => { S.deferredInstall.prompt(); await S.deferredInstall.userChoice; S.deferredInstall = null; renderHome(); });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.deferredInstall = e; if (!location.hash || location.hash === '#home') renderHome(); });

/* ---------- walk ---------- */
let audio = null, geoWatch = null, wakeLock = null, tick = null;
async function startWalk() {
  const r = allRoutes().find((x) => x.id === S.route) || ANYWHERE;
  let stream;
  try {
    const a = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
    if (S.settings.deviceId) a.deviceId = { exact: S.settings.deviceId };
    stream = await navigator.mediaDevices.getUserMedia({ audio: a });
  } catch (e) {
    view.insertAdjacentHTML('afterbegin', '<p class="banner err">Microphone permission is needed to listen for birds. Allow it in the browser and try again.</p>');
    tell('Microphone permission is needed to listen for birds. Allow it and try again.', true);
    return;
  }
  let ctx;
  try { ctx = new AudioContext({ sampleRate: C.model.sampleRate }); } catch (e) { ctx = new AudioContext(); }
  let src;
  try { src = ctx.createMediaStreamSource(stream); }
  catch (e) { ctx.close(); ctx = new AudioContext(); src = ctx.createMediaStreamSource(stream); }
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  const now = Date.now();
  S.walk = {
    id: String(now), active: true, paused: false, route: r.id, routeName: r.name, start: now, end: null,
    demo: S.model === 'demo', model: S.model === 'ready' ? 'BirdNET+ V3.0' : 'demo', track: [], detections: [],
    species: {}, humanWindows: 0, windows: 0, anchors: [{ audioSec: 0, wall: now }], sentSec: 0, level: new Array(32).fill(0.05),
    pausedMs: 0, pausedAt: null, pending: 0, geoUsed: false, geoSent: false, errors: 0
  };
  audio = { ctx, stream, proc, src };
  proc.onaudioprocess = (ev) => {
    const w = S.walk; if (!w || w.paused) return;
    const ch = ev.inputBuffer.getChannelData(0);
    let peak = 0; for (let i = 0; i < ch.length; i += 8) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    w.level.push(Math.min(1, peak * 3)); w.level.shift();
    if (S.model === 'ready') worker.postMessage({ type: 'audio', data: new Float32Array(ch) });
    w.sentSec += ch.length / ctx.sampleRate;
  };
  if (S.model === 'ready') worker.postMessage({ type: 'start', rate: ctx.sampleRate });
  if ('geolocation' in navigator) {
    geoWatch = navigator.geolocation.watchPosition((p) => {
      const w = S.walk; if (!w || w.paused) return;
      const pt = { t: Date.now(), lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) };
      w.track.push(pt);
      if (!w.geoSent && S.model === 'ready' && S.geoOk && pt.acc < 200) { w.geoSent = true; worker.postMessage({ type: 'geo', lat: pt.lat, lon: pt.lon, week: birdWeek(new Date()) }); }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  await keepAwake();
  buzz(300);
  go('walk');
  lastSpoken = Date.now();
  tell('Walk started on ' + r.name + '. Listening for birds.' + (S.settings.voice ? ' I will tell you each new bird.' : ''));
}
function birdWeek(d) { return Math.min(48, d.getMonth() * 4 + Math.min(4, Math.ceil(d.getDate() / 7.75))); }
async function keepAwake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.walk && S.walk.active) keepAwake(); });

function audioToWall(sec) {
  const a = S.walk.anchors; let k = a[0];
  for (const x of a) if (x.audioSec <= sec) k = x;
  return k.wall + (sec - k.audioSec) * 1000;
}
function locate(t, track) {
  if (!track.length) return { lat: null, lon: null, acc: null, est: true };
  let b = null, a = null;
  for (const p of track) { if (p.t <= t) b = p; else { a = p; break; } }
  if (b && a) {
    const f = (t - b.t) / (a.t - b.t || 1);
    const gap = Math.min(t - b.t, a.t - t);
    return { lat: +(b.lat + (a.lat - b.lat) * f).toFixed(6), lon: +(b.lon + (a.lon - b.lon) * f).toFixed(6), acc: Math.max(b.acc, a.acc), est: gap > 10000 };
  }
  const p = b || a;
  return { lat: p.lat, lon: p.lon, acc: p.acc, est: Math.abs(p.t - t) > 10000 };
}
function onWindow(m) {
  const w = S.walk; if (!w) return;
  w.windows++;
  if (m.human) { w.humanWindows++; return; }
  const t = audioToWall(m.startSec), loc = locate(t, w.track);
  m.dets.forEach((d, k) => {
    if (d.score < S.settings.minConfidence) return;
    const L = S.labels[d.i]; if (!L) return;
    w.detections.push({ i: d.i, score: +d.score.toFixed(3), t: Math.round(t), lat: loc.lat, lon: loc.lon, acc: loc.acc, est: loc.est });
    if (!w.species[d.i]) newBird(L.common, d.score);
    else if (S.settings.repeat && Date.now() - (w.species[d.i].said || 0) > 300000) { w.species[d.i].said = Date.now(); newBird(L.common, d.score); }
    const sp = w.species[d.i] || (w.species[d.i] = { said: Date.now(), i: d.i, sci: L.sci, common: L.common, group: L.group, count: 0, best: 0, t: t, lat: loc.lat, lon: loc.lon, est: loc.est, clipScore: 0, clip: null });
    sp.count++;
    if (d.score > sp.best) sp.best = d.score;
    if (k === 0 && m.pcm && d.score > sp.clipScore) { sp.clipScore = d.score; sp.clip = wav(m.pcm, C.model.sampleRate); }
  });
}
let birdQueue = [], birdTimer = null, lastSpoken = 0;
function newBird(name, score) {              // batch birds heard within a few seconds into one sentence
  birdQueue.push(`${name}, ${Math.round(score * 100)} percent confidence`);
  clearTimeout(birdTimer);
  birdTimer = setTimeout(() => {
    const n = birdQueue.length, list = birdQueue.join(', ');
    birdQueue = [];
    const total = S.walk ? Object.keys(S.walk.species).length : n;
    buzz([120, 80, 120]);
    tell(list + '. ' + plural(total, 'species', 'species') + ' so far.');
    lastSpoken = Date.now();
  }, 2500);
}
function wav(pcm, rate) {
  const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b);
  const s = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(b, 44).set(pcm);
  return new Blob([b], { type: 'audio/wav' });
}
function km(track) {
  let d = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    if (a.acc > 50 || b.acc > 50) continue;
    const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    d += 2 * R * Math.asin(Math.sqrt(x));
  }
  return d;
}
const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

function renderWalk() {
  const w = S.walk;
  if (!w) return go('home');
  view.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div><span class="muted" style="font-weight:700;font-size:12px">${w.active ? 'WALKING' : 'FINISHING'}</span><h1 style="font-size:19px">${esc(w.routeName)}</h1></div>
      <span class="live" id="live" aria-hidden="true"><i></i><span id="liveTxt">Live</span></span>
    </div>
    <div class="map" id="map" aria-hidden="true"></div>
    <div class="grid3" aria-hidden="true">
      <div class="stat"><span>TIME</span><b id="wTime">00:00</b></div>
      <div class="stat"><span>DISTANCE</span><b id="wDist">0.0 km</b></div>
      <div class="stat"><span>SPECIES</span><b id="wSp">0</b></div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700" aria-hidden="true"><span>Microphone</span><span id="gpsTxt" class="muted">Waiting for GPS…</span></div>
      <div class="meter" id="meter" aria-hidden="true">${w.level.map(() => '<span></span>').join('')}</div>
      <p class="muted" id="latest" aria-hidden="true">${w.demo ? 'Demo mode: listening for sound levels only.' : 'Listening… new birds appear here.'}</p>
    </div>
    <div id="finishBox" class="card hide"><p style="font-weight:700">Finishing the analysis…</p><div class="prog"><i id="finBar" style="width:10%"></i></div></div>
    <div style="display:flex;flex-direction:column;gap:10px" id="walkBtns">
      <button class="btn say" id="say">Say status</button>
      <div class="row">
        <button class="btn alt" id="pause" style="flex:1">${w.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn" id="finish" style="flex:1.6">Finish walk</button>
      </div>
    </div>`;
  $('#say').addEventListener('click', () => { const t = walkStatus(); announce(t, true); speak(t); lastSpoken = Date.now(); });
  $('#pause').addEventListener('click', togglePause);
  $('#finish').addEventListener('click', finishWalk);
  clearInterval(tick); tick = setInterval(updateWalk, 1000); updateWalk();
}
function updateWalk() {
  const w = S.walk; if (!w || !$('#wTime')) { clearInterval(tick); return; }
  const now = w.paused ? w.pausedAt : Date.now();
  $('#wTime').textContent = fmt(now - w.start - w.pausedMs);
  $('#wDist').textContent = km(w.track).toFixed(1) + ' km';
  $('#wSp').textContent = Object.keys(w.species).length;
  $('#live').className = 'live' + (w.paused ? ' off' : ''); $('#liveTxt').textContent = w.paused ? 'Paused' : 'Live';
  const last = w.track[w.track.length - 1];
  $('#gpsTxt').textContent = last ? 'GPS ±' + last.acc + ' m' : 'Waiting for GPS…';
  $('#meter').querySelectorAll('span').forEach((s, i) => { s.style.height = Math.max(3, Math.round(w.level[i] * 34)) + 'px'; });
  const recent = Object.values(w.species).sort((a, b) => b.t - a.t).slice(0, 3);
  if (recent.length) $('#latest').textContent = 'Heard: ' + recent.map((s) => s.common + ' ' + Math.round(s.best * 100) + '%').join(', ');
  drawMap($('#map'), w.track, Object.values(w.species));
  if (S.settings.voice && S.settings.every && !w.paused && Date.now() - lastSpoken > S.settings.every * 60000) { lastSpoken = Date.now(); speak(walkStatus()); }
}
function togglePause() {
  const w = S.walk; if (!w) return;
  if (!w.paused) { w.paused = true; w.pausedAt = Date.now(); audio.ctx.suspend(); }
  else { w.pausedMs += Date.now() - w.pausedAt; w.paused = false; w.anchors.push({ audioSec: w.sentSec, wall: Date.now() }); audio.ctx.resume(); }
  $('#pause').textContent = w.paused ? 'Resume' : 'Pause'; updateWalk();
  buzz(w.paused ? 200 : [100, 60, 100]);
  tell(w.paused ? 'Walk paused. Double-tap Resume to carry on.' : 'Listening again.');
}
async function finishWalk() {
  const w = S.walk; if (!w) return;
  if (w.paused) togglePause();
  w.active = false; w.end = Date.now();
  clearInterval(tick);
  $('#walkBtns').classList.add('hide'); $('#finishBox').classList.remove('hide');
  tell('Finishing. Working out the last birds, please wait.');
  try { audio.proc.disconnect(); audio.src.disconnect(); audio.stream.getTracks().forEach((t) => t.stop()); audio.ctx.close(); } catch (e) {}
  if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch);
  try { if (wakeLock) await wakeLock.release(); } catch (e) {}
  if (S.model === 'ready') {
    const total = Math.max(1, w.pending || 1);
    const bar = setInterval(() => { const b = $('#finBar'); if (b) b.style.width = Math.min(95, 100 - (w.pending / total) * 90) + '%'; }, 300);
    const limit = Math.max(20000, (w.pending || 0) * 4000);   // never hang if the model stalls
    await new Promise((res) => { flushResolve = res; worker.postMessage({ type: 'flush' }); setTimeout(res, limit); });
    flushResolve = null;
    clearInterval(bar);
  } else if (w.demo) addDemo(w);
  saveWalk(w);
  S.lastWalk = w; S.walk = null;
  go('results-' + w.id);
  buzz([400, 100, 400]);
  const names = Object.values(w.species).sort((a, b) => b.count - a.count).map((s) => `${s.common} ${Math.round(s.best * 100)} percent`);
  setTimeout(() => tell(`Walk finished. ${plural(names.length, 'species', 'species')} heard${names.length ? ': ' + names.slice(0, 8).join(', ') + (names.length > 8 ? ', and ' + (names.length - 8) + ' more' : '') : ''}. The Submit to TNS button is below the list.`), 700);
}
function addDemo(w) {
  const n = 6 + Math.floor(Math.random() * 4), pick = DEMO.slice().sort(() => Math.random() - 0.5).slice(0, n);
  const span = Math.max(1, w.end - w.start);
  pick.forEach(([common, sci, group], k) => {
    const count = 1 + Math.floor(Math.random() * 12), t = w.start + span * (k + 1) / (n + 1), loc = locate(t, w.track);
    const best = +(0.55 + Math.random() * 0.4).toFixed(2);
    w.species['d' + k] = { i: 'd' + k, sci, common, group, count, best, t, lat: loc.lat, lon: loc.lon, est: loc.est, clip: null };
    w.detections.push({ i: 'd' + k, score: best, t: Math.round(t), lat: loc.lat, lon: loc.lon, acc: loc.acc, est: loc.est });
  });
}

/* ---------- saving ---------- */
function reviewFlag(sp, geoAllowed) {
  if (sp.best < C.reviewBelow) return true;
  return !!(geoAllowed && typeof sp.i === 'number' && !geoAllowed.has(sp.i));
}
function summarise(w) {
  const step = Math.max(1, Math.ceil(w.track.length / 600));
  return {
    id: w.id, route: w.route, routeName: w.routeName, start: w.start, end: w.end, demo: w.demo, model: w.model,
    walker: S.settings.name || null, km: +km(w.track).toFixed(2), humanWindowsRemoved: w.humanWindows, geoFilter: w.geoUsed,
    species: Object.values(w.species).sort((a, b) => b.count - a.count).map((s) => ({
      sci: s.sci, common: s.common, group: s.group, count: s.count, best: +s.best.toFixed(3), review: reviewFlag(s, S.geoAllowed),
      firstHeard: Math.round(s.t), lat: s.lat, lon: s.lon, estimated: s.est
    })),
    detections: w.detections.slice(0, 3000).map((d) => {
      const s = w.species[d.i];
      return { sci: s ? s.sci : '', common: s ? s.common : '', score: d.score, t: d.t, lat: d.lat, lon: d.lon, acc: d.acc, estimated: d.est };
    }),
    track: w.track.filter((_, i) => i % step === 0)
  };
}
function saveWalk(w) {
  const sum = summarise(w);
  w.summary = sum;
  S.walks.unshift(sum);
  while (S.walks.length && !store.set('tnsWalks', S.walks)) S.walks.pop();
}

/* ---------- results ---------- */
let resFilter = 'All', player = null;
function renderResults(id) {
  const w = S.walks.find((x) => x.id === id);
  if (!w) { view.innerHTML = '<p class="empty">That walk is no longer on this phone.</p>'; return; }
  const live = S.lastWalk && S.lastWalk.id === id ? S.lastWalk : null;
  const groups = ['All'].concat([...new Set(w.species.map((s) => s.group))]).concat(w.species.some((s) => s.review) ? ['Under review'] : []);
  if (!groups.includes(resFilter)) resFilter = 'All';
  const list = w.species.filter((s) => resFilter === 'All' || (resFilter === 'Under review' ? s.review : s.group === resFilter));
  const d = new Date(w.start);
  const clipFor = (s) => live && Object.values(live.species).find((x) => x.sci === s.sci && x.clip);
  view.innerHTML = `
    <div><span class="muted" style="font-weight:700;font-size:12px">${esc(d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase())} · ${esc(w.routeName.toUpperCase())}</span>
    <h1>${w.species.length} species heard</h1>
    <p class="muted">${fmt(w.end - w.start)} · ${w.km.toFixed(1)} km · ${w.demo ? 'sample data (demo mode)' : 'identified with BirdNET+ V3.0'}</p></div>
    ${w.demo ? '<p class="banner">Demo mode: these species are sample data, placed along your real GPS track.</p>' : ''}
    ${w.humanWindowsRemoved ? `<p class="muted">${w.humanWindowsRemoved} stretches with human voices were discarded and never stored.</p>` : ''}
    <div class="map" id="rmap" aria-hidden="true"></div>
    ${w.species.length ? '<button class="btn say small noprint" id="readAll">Read the bird list aloud</button>' : ''}
    <div class="chips" role="group" aria-label="Show only">${groups.map((g) => `<button class="chip" data-f="${esc(g)}" aria-pressed="${g === resFilter}">${esc(g)} ${g === 'All' ? w.species.length : g === 'Under review' ? w.species.filter((s) => s.review).length : w.species.filter((s) => s.group === g).length}</button>`).join('')}</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${list.length ? list.map((s, k) => {
        const c = clipFor(s);
        return `<div class="sp" role="group" aria-label="${esc(s.common)}, ${s.review ? 'under review' : Math.round(s.best * 100) + ' percent sure'}, ${plural(s.count, 'call')}">
          <button class="play" data-play="${k}" ${c ? '' : 'disabled'} aria-label="${c ? 'Play recording of ' + esc(s.common) : 'No recording kept'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="#1F5C43" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
          <div class="nm"><b>${esc(s.common)}</b><i lang="la">${esc(s.sci)}</i></div>
          <div class="rt"><span class="pill ${s.review ? 'rev' : ''}">${s.review ? 'Under review' : Math.round(s.best * 100) + '% sure'}</span><span>${s.count} ${s.count === 1 ? 'call' : 'calls'}${s.lat != null ? ' · ' + (s.estimated ? 'approx. location' : 'GPS') : ''}</span></div>
        </div>`;
      }).join('') : '<p class="empty">Nothing in this group.</p>'}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px" class="noprint">
      ${C.uploadUrl ? (w.submitted ? '<p class="banner">Sent to TNS on ' + esc(new Date(w.submitted).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '.</p>' : '<button class="btn" id="submit">' + (w.demo ? 'Submit to TNS (marked as demo)' : 'Submit to TNS') + '</button>') : '<p class="muted">Submitting to TNS turns on once the TNS server address is set in config.js.</p>'}
      <div class="row"><button class="btn alt small" id="dlJson">Download walk data</button><button class="btn alt small" id="dlGpx">Download route (GPX)</button></div>
      <button class="btn alt small" id="del">Delete this walk</button>
    </div>`;
  drawMap($('#rmap'), w.track, w.species);
  view.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    resFilter = b.dataset.f; renderResults(id);
    const again = view.querySelector(`[data-f="${CSS.escape(resFilter)}"]`); if (again) again.focus();
    announce('Showing ' + (resFilter === 'All' ? 'all species' : resFilter) + ': ' + view.querySelectorAll('.sp').length + '.');
  }));
  const ra = $('#readAll');
  if (ra) ra.addEventListener('click', () => {
    const t = `${plural(w.species.length, 'species', 'species')} heard. ` + w.species.slice().sort((a, b) => b.count - a.count)
      .map((s) => `${s.common}, ${Math.round(s.best * 100)} percent confidence, ${plural(s.count, 'call')}${s.review ? ', under review' : ''}`).join('. ') + '.';
    if ('speechSynthesis' in window) { speechSynthesis.cancel(); speak(t, true); } else announce(t, true);
  });
  view.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => {
    const c = clipFor(list[+b.dataset.play]); if (!c) return;
    if (player) { player.pause(); URL.revokeObjectURL(player.src); }
    player = new Audio(URL.createObjectURL(c.clip)); player.play().catch(() => {});
  }));
  $('#dlJson').addEventListener('click', () => download(`tns-walk-${w.id}.json`, JSON.stringify(w, null, 1), 'application/json'));
  $('#dlGpx').addEventListener('click', () => download(`tns-walk-${w.id}.gpx`, gpx(w), 'application/gpx+xml'));
  $('#del').addEventListener('click', () => { S.walks = S.walks.filter((x) => x.id !== id); store.set('tnsWalks', S.walks); go('history'); });
  const sub = $('#submit');
  if (sub) sub.addEventListener('click', async () => {
    sub.disabled = true; sub.textContent = 'Sending…'; announce('Sending to TNS.');
    try {
      // text/plain keeps this a "simple" request, which Google Apps Script accepts from any website
      const r = await fetch(C.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(w) });
      let j = {}; try { j = await r.json(); } catch (e) {}
      if (r.ok && j.ok !== false) {
        w.submitted = Date.now(); store.set('tnsWalks', S.walks);
        sub.textContent = j.duplicate ? 'Already sent to TNS' : 'Sent to TNS. Thank you!';
        tell(sub.textContent); buzz(200);
      } else { sub.textContent = 'Not sent: ' + (j.error || 'server said ' + r.status) + '. Tap to retry.'; sub.disabled = false; tell(sub.textContent, true); }
    } catch (e) { sub.textContent = 'Not sent: no connection. Tap to retry later.'; sub.disabled = false; tell(sub.textContent, true); }
  });
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function gpx(w) {
  const x = (s) => esc(s);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TNS Bird Walk" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${x(w.routeName)}</name><time>${new Date(w.start).toISOString()}</time></metadata>\n` +
    w.species.filter((s) => s.lat != null).map((s) => `<wpt lat="${s.lat}" lon="${s.lon}"><name>${x(s.common)}</name><desc>${x(s.sci)} · ${s.count} ${s.count === 1 ? 'call' : 'calls'} · best ${Math.round(s.best * 100)}%</desc></wpt>`).join('\n') +
    `\n<trk><name>${x(w.routeName)}</name><trkseg>\n` + w.track.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n') + `\n</trkseg></trk></gpx>`;
}
function drawMap(el, track, species) {
  if (!el) return;
  const W = el.clientWidth || 340, H = el.clientHeight || 240, pts = track.filter((p) => p.acc == null || p.acc < 100);
  const sp = species.filter((s) => s.lat != null);
  const all = pts.concat(sp);
  if (!all.length) { el.innerHTML = '<svg aria-hidden="true"></svg><span class="note">Waiting for GPS</span>'; return; }
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  all.forEach((p) => { a = Math.min(a, p.lat); b = Math.max(b, p.lat); c = Math.min(c, p.lon); d = Math.max(d, p.lon); });
  const k = Math.cos(((a + b) / 2) * Math.PI / 180), spanX = Math.max((d - c) * k, 0.0005), spanY = Math.max(b - a, 0.0005);
  const sc = Math.min((W - 40) / spanX, (H - 40) / spanY);
  const X = (p) => (W / 2 + ((p.lon - (c + d) / 2) * k) * sc).toFixed(1), Y = (p) => (H / 2 - (p.lat - (a + b) / 2) * sc).toFixed(1);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + X(p) + ' ' + Y(p)).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Walk route with ${sp.length} species locations">
    ${path ? `<path d="${path}" fill="none" stroke="#1F5C43" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${pts.length ? `<circle cx="${X(pts[0])}" cy="${Y(pts[0])}" r="6" fill="#fff" stroke="#1F5C43" stroke-width="3"/><circle cx="${X(pts[pts.length - 1])}" cy="${Y(pts[pts.length - 1])}" r="7" fill="#1F5C43" stroke="#fff" stroke-width="3"/>` : ''}
    ${sp.map((s) => `<circle cx="${X(s)}" cy="${Y(s)}" r="6" fill="${s.review ? '#E8A33D' : '#8A5200'}" stroke="#fff" stroke-width="2"><title>${esc(s.common)}</title></circle>`).join('')}
  </svg><span class="note">${pts.length ? pts.length + ' GPS points' : 'No GPS fix yet'} · ${sp.length} species placed</span>`;
}

/* ---------- history ---------- */
function renderHistory() {
  view.innerHTML = `<h1>My walks</h1>
    ${S.walks.length ? S.walks.map((w) => `
      <button class="route" data-id="${esc(w.id)}" aria-label="${esc(w.routeName)}, ${esc(new Date(w.start).toLocaleString('en-IN', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }))}, ${w.km.toFixed(1)} kilometres, ${plural(w.species.length, 'species', 'species')}${w.demo ? ', demo' : ''}">
        <span class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F5C43" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
        <span style="flex:1"><b>${esc(w.routeName)}</b><span class="muted">${esc(new Date(w.start).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${w.km.toFixed(1)} km</span></span>
        <span class="tag">${w.species.length} spp.${w.demo ? ' · demo' : ''}</span>
      </button>`).join('') : '<p class="empty">No walks yet. Pick a route on Home and start your first one.</p>'}`;
  view.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => go('results-' + b.dataset.id)));
}

/* ---------- share & settings ---------- */
function qrSvg(text, cell) {
  if (typeof qrcode === 'undefined') return '<p class="muted">QR codes need an internet connection the first time.</p>';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell || 6, margin: 2, scalable: true });
}
async function renderMore() {
  const base = location.origin + location.pathname;
  view.innerHTML = `
    <h1>Share &amp; settings</h1>
    <div class="qr"><div>${qrSvg(base, 6)}</div><b>Scan to open TNS Bird Walk</b><span class="muted" style="word-break:break-all">${esc(base)}</span></div>
    <h2>Route QR codes</h2>
    <p class="muted">Print these and put each one at its start point. Scanning opens the app with that route already picked.</p>
    <div class="qrs">${C.routes.map((r) => `<div class="qr">${qrSvg(base + '#route-' + r.id, 4)}<b style="font-size:13px">${esc(r.name)}</b></div>`).join('')}</div>
    ${S.places.length ? `<h2>Place QR codes</h2><div class="qrs">${S.places.map((p) => `<div class="qr">${qrSvg(placeLink(base, p), 4)}<b style="font-size:13px">${esc(p.name)}</b><button class="chip noprint" data-delplace="${esc(p.id)}">Remove</button></div>`).join('')}</div>` : ''}
    <div class="card noprint" style="display:flex;flex-direction:column;gap:10px">
      <b>Enable a new place</b>
      <p class="muted">Type a place name to make its QR code. Anyone who scans it gets that place on their Home screen, ready to walk. Stand at the place and tick the box to save its location too.</p>
      <label class="f">Place name<input id="plName" maxlength="60" placeholder="e.g. Talakona waterfall trail"></label>
      <label style="display:flex;gap:10px;align-items:center;font-size:14px"><input type="checkbox" id="plHere" style="width:22px;height:22px;accent-color:#1F5C43"> Use my current location as the start point</label>
      <button class="btn small" id="plAdd">Create QR code</button>
      <p class="muted hide" id="plMsg"></p>
    </div>
    <button class="btn alt small noprint" id="print">Print QR codes</button>
    <h2>Accessible walk QR code</h2>
    <p class="muted">For blind and low-vision walkers. Scanning it opens the app with spoken mode, vibration and large text already on. Put a tactile sticker or a Braille label on the printed code so it can be found by touch.</p>
    <div class="qrs"><div class="qr">${qrSvg(base + '#access', 4)}<b style="font-size:13px">Spoken mode · any route</b></div>${C.routes.map((r) => `<div class="qr">${qrSvg(base + '#access-' + r.id, 4)}<b style="font-size:13px">Spoken mode · ${esc(r.name)}</b></div>`).join('')}</div>
    <h2 class="noprint">Accessibility</h2>
    <div class="card noprint" style="display:flex;flex-direction:column;gap:16px">
      <label class="toggle"><input type="checkbox" id="aVoice" ${S.settings.voice ? 'checked' : ''}><span>Spoken mode<small>The phone speaks each new bird, gives walk updates and reads the results. Works alongside TalkBack.</small></span></label>
      <label class="toggle"><input type="checkbox" id="aRepeat" ${S.settings.repeat ? 'checked' : ''}><span>Also say a bird again when it calls later<small>At most once every 5 minutes per bird. Off: each species is said only the first time.</small></span></label>
      <label class="f">Spoken walk update every
        <select id="aEvery"><option value="0">Never (birds only)</option>${[5, 10, 15, 20].map((n) => `<option value="${n}" ${S.settings.every === n ? 'selected' : ''}>${n} minutes</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" id="aBuzz" ${S.settings.buzz ? 'checked' : ''}><span>Vibrate<small>Two short buzzes for a new bird, one long buzz when the walk starts or finishes.</small></span></label>
      <label class="toggle"><input type="checkbox" id="aBig" ${S.settings.big ? 'checked' : ''}><span>Larger text and buttons</span></label>
      <label class="toggle"><input type="checkbox" id="aHc" ${S.settings.hc ? 'checked' : ''}><span>High contrast</span></label>
      <button class="btn alt small" id="aTest">Test the voice</button>
    </div>
    <h2 class="noprint">Settings</h2>
    <div class="card noprint" style="display:flex;flex-direction:column;gap:14px">
      <label class="f">Your name (shown on this phone and in your walk data)<input id="nm" value="${esc(S.settings.name)}" autocomplete="name"></label>
      <label class="f">Microphone<select id="mic"><option value="">Phone's built-in mic</option></select></label>
      <label class="f">Minimum confidence: <span id="mcv" aria-hidden="true">${Math.round(S.settings.minConfidence * 100)}%</span><input type="range" id="mc" min="0.1" max="0.9" step="0.05" value="${S.settings.minConfidence}" aria-valuetext="${Math.round(S.settings.minConfidence * 100)} percent"></label>
    </div>
    <a class="btn alt small noprint" href="dashboard.html" target="_blank" rel="noopener">Open the community dashboard</a>
    <div class="card noprint"><b>Model</b><p class="muted">${esc(modelText())}</p></div>
    <div class="card noprint" style="display:flex;flex-direction:column;gap:8px">
      <b>Credits</b>
      <p class="muted">Sound identification by BirdNET+ V3.0 (Lasseck, Eibl, Klinck &amp; Kahl, 2026), Chemnitz University of Technology, Museum für Naturkunde Berlin and the K. Lisa Yang Center for Conservation Bioacoustics, Cornell Lab of Ornithology. Model weights: Apache License 2.0. <a href="https://doi.org/10.5281/zenodo.24362980">doi.org/10.5281/zenodo.24362980</a></p>
      <p class="muted">Built on BirdNET Live: Kahl, S., Börner, A., Mauermann, M., Seifert, R. C., Lasseck, M., Verdon, S., Wilhelm-Stein, T., Wood, C. M., Eibl, M., Müller, J. &amp; Klinck, H. (2026). <i>BirdNET Live app – Professional bioacoustics in your pocket.</i> <a href="https://github.com/birdnet-team/birdnet-live-app">github.com/birdnet-team/birdnet-live-app</a></p>
      <p class="muted">App by Tirupati Nature Society.</p>
    </div>
    <button class="btn alt small noprint" id="clear">Delete all walks on this phone</button>`;
  $('#print').addEventListener('click', () => window.print());
  if (S.settings.every === 0) $('#aEvery').value = '0';
  const tg = (id, key, msg) => $(id).addEventListener('change', (e) => { S.settings[key] = e.target.checked; saveSettings(); announce(msg + (e.target.checked ? ' on.' : ' off.')); if (key === 'buzz' && e.target.checked) buzz([120, 80, 120]); });
  tg('#aVoice', 'voice', 'Spoken mode'); tg('#aBuzz', 'buzz', 'Vibration'); tg('#aBig', 'big', 'Larger text'); tg('#aHc', 'hc', 'High contrast'); tg('#aRepeat', 'repeat', 'Repeat birds');
  $('#aEvery').addEventListener('change', (e) => { S.settings.every = +e.target.value; saveSettings(); });
  $('#aTest').addEventListener('click', () => { if (!('speechSynthesis' in window)) { announce('This phone has no voice for the app. TalkBack still works.', true); return; } speak('Red-whiskered Bulbul, 85 percent confidence. 3 species so far.', true); });
  view.querySelectorAll('[data-delplace]').forEach((b) => b.addEventListener('click', () => {
    S.places = S.places.filter((p) => p.id !== b.dataset.delplace); store.set('tnsPlaces', S.places);
    if (S.route === b.dataset.delplace) S.route = null;
    renderMore();
  }));
  $('#plAdd').addEventListener('click', () => {
    const name = $('#plName').value.trim(), msg = $('#plMsg');
    msg.classList.remove('hide');
    if (!name) { msg.textContent = 'Type a place name first.'; return; }
    const done = (lat, lon) => { const p = addPlace(name, lat, lon); if (p) S.route = p.id; renderMore(); };
    if ($('#plHere').checked && 'geolocation' in navigator) {
      msg.textContent = 'Getting your location…';
      navigator.geolocation.getCurrentPosition((pos) => done(pos.coords.latitude, pos.coords.longitude),
        () => { msg.textContent = 'Location not available, so the place was saved without it.'; setTimeout(() => done(null, null), 1200); },
        { enableHighAccuracy: true, timeout: 15000 });
    } else done(null, null);
  });
  $('#nm').addEventListener('change', (e) => { S.settings.name = e.target.value.trim(); store.set('tnsSettings', S.settings); });
  $('#mc').addEventListener('input', (e) => { S.settings.minConfidence = +e.target.value; $('#mcv').textContent = Math.round(+e.target.value * 100) + '%'; e.target.setAttribute('aria-valuetext', Math.round(+e.target.value * 100) + ' percent'); store.set('tnsSettings', S.settings); });
  $('#clear').addEventListener('click', () => { if ($('#clear').dataset.sure) { S.walks = []; store.set('tnsWalks', []); renderMore(); } else { $('#clear').dataset.sure = '1'; $('#clear').textContent = 'Tap again to delete all walks'; } });
  const sel = $('#mic');
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
    devs.forEach((d, i) => sel.insertAdjacentHTML('beforeend', `<option value="${esc(d.deviceId)}">${esc(d.label || 'Microphone ' + (i + 1))}</option>`));
    if (!devs.some((d) => d.label)) sel.insertAdjacentHTML('afterend', '<span class="muted">Start one walk first to see mic names. A plugged-in USB-C clip-on mic shows up here.</span>');
  } catch (e) {}
  sel.value = S.settings.deviceId || '';
  sel.addEventListener('change', () => { S.settings.deviceId = sel.value; store.set('tnsSettings', S.settings); });
}
function modelText() {
  if (S.model === 'ready') return `BirdNET+ V3.0 loaded: ${S.labels.length} species classes, ${S.info.sampleRate / 1000} kHz audio in ${S.info.windowSamples / S.info.sampleRate}-second chunks. Location filter (geomodel): ${S.geoOk ? 'on' : 'off'}.`;
  if (S.model === 'demo') return 'Demo mode. ' + S.modelMsg + ' Put the BirdNET+ V3.0 files in the model folder (see README).';
  if (S.model === 'error') return S.modelMsg;
  return 'Loading…';
}

/* ---------- start ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
applyDisplay();
startWorker();
route();
}
