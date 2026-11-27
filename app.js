/* TNS Bird Walk – main app */
{
'use strict';
const C = window.TNS_CONFIG;
const APP_VERSION = 'v24';
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
  route: null, walk: null, lastWalk: null, deferredInstall: null, walkName: '',
  settings: Object.assign({ name: '', deviceId: '', minConfidence: C.minConfidence, voice: false, buzz: false, big: false, hc: false, every: 10, repeat: false, lang: 'en-IN', sendClips: true, theme: 'forest', voiceCmd: false }, store.get('tnsSettings', {})),
  walks: store.get('tnsWalks', []),
  places: store.get('tnsPlaces', [])        // places added on this phone or scanned from a place QR code
};
const ANYWHERE = { id: 'free', name: 'Walk anywhere', meta: 'Any place, any path, any length', tag: 'Open' };
const slug = (t) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'place';
const allRoutes = () => (C.routes || []).concat(S.places, [ANYWHERE]);

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
/* Spoken languages. Each phrase is a function so word order can follow the language. */
const LANGS = { 'en-IN': 'English (Indian voice)', 'te-IN': 'తెలుగు Telugu', 'hi-IN': 'हिन्दी Hindi', 'ta-IN': 'தமிழ் Tamil' };
const PH = {
  'en-IN': {
    item: (n, p) => `${n}, ${p} percent confidence`,
    bird: (l, t) => `${l}. ${t} ${t === 1 ? 'species' : 'species'} so far.`,
    welcome: (r) => `Welcome to TNS Bird Walk. Spoken mode is on. ${r ? 'Your route is selected. ' : ''}Find the Start walk button near the bottom of the screen.`,
    ready: (r) => `${r} is ready. Find the Start walk button.`,
    selected: (r) => `${r} selected. The Start walk button is below the list.`,
    modeOn: (m) => `Spoken mode is on. The phone will speak each new bird${m ? ' and give a walk update every ' + m + ' minutes' : ''}.`,
    started: (r) => `Walk started on ${r}. Listening for birds.`,
    paused: () => 'Walk paused. Double-tap Resume to carry on.', resumed: () => 'Listening again.',
    finishing: () => 'Finishing. Working out the last birds, please wait.',
    finished: (n, l, more) => `Walk finished. ${n} species heard${l ? ': ' + l + (more ? ', and ' + more + ' more' : '') : ''}. The Submit to TNS button is below the list.`,
    status: (o) => `${o.paused ? 'Paused. ' : ''}${o.min < 1 ? 'Less than a minute' : o.min + (o.min === 1 ? ' minute' : ' minutes')} walked, ${o.km} kilometres. ${o.n ? o.n + ' species so far. Latest: ' + o.recent + '.' : o.demo ? 'Demo mode: birds are added when you finish.' : 'No birds identified yet.'}${o.gps ? '' : ' Still waiting for GPS.'}`,
    listItem: (n, p, c, rv) => `${n}, ${p} percent confidence, ${c} ${c === 1 ? 'call' : 'calls'}${rv ? ', under review' : ''}`,
    list: (n, l) => `${n} species heard. ${l}.`,
    sent: () => 'Sent to TNS. Thank you!', notSent: () => 'Not sent. Try again later.',
    mic: () => 'Microphone permission is needed to listen for birds. Allow it and try again.'
  },
  'te-IN': {
    item: (n, p) => `${n}, ${p} శాతం నమ్మకం`,
    bird: (l, t) => `${l}. ఇప్పటివరకు ${t === 1 ? '1 జాతి' : t + ' జాతులు'}.`,
    welcome: (r) => `TNS బర్డ్ వాక్‌కు స్వాగతం. మాటల విధానం ఆన్ అయింది. ${r ? 'మీ దారి ఎంచుకోబడింది. ' : ''}స్టార్ట్ వాక్ బటన్ స్క్రీన్ కింది భాగంలో ఉంది.`,
    ready: (r) => `${r} సిద్ధంగా ఉంది. స్టార్ట్ వాక్ బటన్ నొక్కండి.`,
    selected: (r) => `${r} ఎంచుకున్నారు. స్టార్ట్ వాక్ బటన్ జాబితా కింద ఉంది.`,
    modeOn: (m) => `మాటల విధానం ఆన్ అయింది. ప్రతి కొత్త పక్షి పేరు చెబుతాను${m ? ', ప్రతి ' + m + ' నిమిషాలకు నడక వివరాలు చెబుతాను' : ''}.`,
    started: (r) => `${r} లో నడక మొదలైంది. పక్షుల కోసం వింటున్నాను.`,
    paused: () => 'నడక ఆపాను. కొనసాగించడానికి రెస్యూమ్ నొక్కండి.', resumed: () => 'మళ్ళీ వింటున్నాను.',
    finishing: () => 'నడక ముగిస్తున్నాను. దయచేసి కొంచెం ఆగండి.',
    finished: (n, l, more) => `నడక ముగిసింది. ${n} జాతులు వినిపించాయి${l ? ': ' + l + (more ? ', ఇంకా ' + more : '') : ''}. సబ్మిట్ బటన్ జాబితా కింద ఉంది.`,
    status: (o) => `${o.paused ? 'నడక ఆగి ఉంది. ' : ''}${o.min} నిమిషాలు, ${o.km} కిలోమీటర్లు. ${o.n ? 'ఇప్పటివరకు ' + o.n + ' జాతులు. చివరిగా: ' + o.recent + '.' : 'ఇంకా ఏ పక్షీ గుర్తించలేదు.'}${o.gps ? '' : ' జీపీఎస్ కోసం ఎదురుచూస్తున్నాను.'}`,
    listItem: (n, p, c, rv) => `${n}, ${p} శాతం నమ్మకం, ${c} సార్లు${rv ? ', పరిశీలనలో ఉంది' : ''}`,
    list: (n, l) => `${n} జాతులు వినిపించాయి. ${l}.`,
    sent: () => 'TNS కి పంపాను. ధన్యవాదాలు!', notSent: () => 'పంపలేకపోయాను. తర్వాత మళ్ళీ ప్రయత్నించండి.',
    mic: () => 'పక్షులను వినడానికి మైక్రోఫోన్ అనుమతి కావాలి.'
  },
  'hi-IN': {
    item: (n, p) => `${n}, ${p} प्रतिशत भरोसा`,
    bird: (l, t) => `${l}. अब तक ${t === 1 ? '1 प्रजाति' : t + ' प्रजातियाँ'}।`,
    welcome: (r) => `TNS बर्ड वॉक में आपका स्वागत है। बोलने वाला मोड चालू है। ${r ? 'आपका रास्ता चुना गया है। ' : ''}स्टार्ट वॉक बटन स्क्रीन के नीचे है।`,
    ready: (r) => `${r} तैयार है। स्टार्ट वॉक बटन दबाइए।`,
    selected: (r) => `${r} चुना गया। स्टार्ट वॉक बटन सूची के नीचे है।`,
    modeOn: (m) => `बोलने वाला मोड चालू है। हर नए पक्षी का नाम बताऊँगा${m ? ' और हर ' + m + ' मिनट में सैर की जानकारी दूँगा' : ''}।`,
    started: (r) => `${r} पर सैर शुरू हुई। पक्षियों को सुन रहा हूँ।`,
    paused: () => 'सैर रोकी गई। आगे बढ़ने के लिए रिज़्यूम दबाइए।', resumed: () => 'फिर से सुन रहा हूँ।',
    finishing: () => 'सैर पूरी कर रहा हूँ। कृपया थोड़ा रुकिए।',
    finished: (n, l, more) => `सैर पूरी हुई। ${n} प्रजातियाँ सुनाई दीं${l ? ': ' + l + (more ? ', और ' + more : '') : ''}। सबमिट बटन सूची के नीचे है।`,
    status: (o) => `${o.paused ? 'सैर रुकी है। ' : ''}${o.min} मिनट, ${o.km} किलोमीटर। ${o.n ? 'अब तक ' + o.n + ' प्रजातियाँ। आखिरी: ' + o.recent + '।' : 'अभी तक कोई पक्षी नहीं पहचाना।'}${o.gps ? '' : ' जीपीएस का इंतज़ार है।'}`,
    listItem: (n, p, c, rv) => `${n}, ${p} प्रतिशत भरोसा, ${c} बार${rv ? ', जाँच में' : ''}`,
    list: (n, l) => `${n} प्रजातियाँ सुनाई दीं। ${l}।`,
    sent: () => 'TNS को भेज दिया। धन्यवाद!', notSent: () => 'नहीं भेज पाया। बाद में फिर कोशिश कीजिए।',
    mic: () => 'पक्षियों को सुनने के लिए माइक्रोफ़ोन की अनुमति चाहिए।'
  },
  'ta-IN': {
    item: (n, p) => `${n}, ${p} சதவீதம் நம்பிக்கை`,
    bird: (l, t) => `${l}. இதுவரை ${t === 1 ? '1 இனம்' : t + ' இனங்கள்'}.`,
    welcome: (r) => `TNS பறவை நடைக்கு வரவேற்கிறோம். பேசும் முறை இயக்கப்பட்டது. ${r ? 'உங்கள் பாதை தேர்ந்தெடுக்கப்பட்டது. ' : ''}ஸ்டார்ட் வாக் பொத்தான் திரையின் கீழே உள்ளது.`,
    ready: (r) => `${r} தயார். ஸ்டார்ட் வாக் பொத்தானை அழுத்துங்கள்.`,
    selected: (r) => `${r} தேர்ந்தெடுக்கப்பட்டது. ஸ்டார்ட் வாக் பொத்தான் பட்டியலின் கீழே உள்ளது.`,
    modeOn: (m) => `பேசும் முறை இயக்கப்பட்டது. ஒவ்வொரு புதிய பறவையின் பெயரையும் சொல்வேன்${m ? ', ஒவ்வொரு ' + m + ' நிமிடத்துக்கும் நடை விவரம் சொல்வேன்' : ''}.`,
    started: (r) => `${r} இல் நடை தொடங்கியது. பறவைகளைக் கேட்கிறேன்.`,
    paused: () => 'நடை நிறுத்தப்பட்டது. தொடர ரெஸ்யூம் அழுத்துங்கள்.', resumed: () => 'மீண்டும் கேட்கிறேன்.',
    finishing: () => 'நடையை முடிக்கிறேன். தயவுசெய்து காத்திருங்கள்.',
    finished: (n, l, more) => `நடை முடிந்தது. ${n} இனங்கள் கேட்டன${l ? ': ' + l + (more ? ', மேலும் ' + more : '') : ''}. சப்மிட் பொத்தான் பட்டியலின் கீழே உள்ளது.`,
    status: (o) => `${o.paused ? 'நடை நிறுத்தத்தில் உள்ளது. ' : ''}${o.min} நிமிடங்கள், ${o.km} கிலோமீட்டர். ${o.n ? 'இதுவரை ' + o.n + ' இனங்கள். கடைசியாக: ' + o.recent + '.' : 'இன்னும் பறவை எதுவும் கண்டறியப்படவில்லை.'}${o.gps ? '' : ' ஜிபிஎஸ் காத்திருக்கிறது.'}`,
    listItem: (n, p, c, rv) => `${n}, ${p} சதவீதம் நம்பிக்கை, ${c} முறை${rv ? ', பரிசீலனையில்' : ''}`,
    list: (n, l) => `${n} இனங்கள் கேட்டன. ${l}.`,
    sent: () => 'TNS க்கு அனுப்பப்பட்டது. நன்றி!', notSent: () => 'அனுப்ப முடியவில்லை. பின்னர் மீண்டும் முயற்சிக்கவும்.',
    mic: () => 'பறவைகளைக் கேட்க மைக்ரோஃபோன் அனுமதி தேவை.'
  }
};
const LOCAL = {};                            // sci name -> local name, from names/<lang>.csv
async function loadNames(lang) {
  const code = lang.slice(0, 2); if (code === 'en' || LOCAL[code]) return;
  LOCAL[code] = {};
  try {
    const t = await (await fetch('names/' + code + '.csv', { cache: 'no-cache' })).text();
    t.split(/\r?\n/).slice(1).forEach((line) => { const c = line.split(','); if (c[0] && c[2] && c[2].trim()) LOCAL[code][c[0].trim()] = c[2].trim(); });
  } catch (e) {}
}
const lang = () => (PH[S.settings.lang] ? S.settings.lang : 'en-IN');
const nm = (s) => (LOCAL[lang().slice(0, 2)] || {})[s.sci] || s.common;     // local name if TNS has added one, else English
const P = (k, ...a) => PH[lang()][k](...a), E = (k, ...a) => PH['en-IN'][k](...a);
let lastSpeech = '';
function speak(msg, force) {                // the app's own voice, for walkers who don't use a screen reader
  if (!(S.settings.voice || force) || !('speechSynthesis' in window)) return;
  try {
    lastSpeech = msg;
    const L = lang(), u = new SpeechSynthesisUtterance(msg);
    u.voice = voices.find((v) => v.lang.replace('_', '-') === L) || voices.find((v) => v.lang.slice(0, 2) === L.slice(0, 2)) || null;
    u.lang = L; u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function hasVoice() { const L = lang(); return !voices.length || voices.some((v) => v.lang.replace('_', '-').slice(0, 2) === L.slice(0, 2)); }
/* say(): the screen reader gets English (it reads in the phone's own language settings), the app's voice speaks the chosen language */
function say(key, args, urgent) { announce(E(key, ...args), urgent); speak(P(key, ...args)); }
function tell(msg, urgent) { announce(msg, urgent); speak(msg); }
function buzz(pattern) { if (S.settings.buzz && navigator.vibrate) try { navigator.vibrate(pattern); } catch (e) {} }
const THEMES = { forest: 'Forest and turmeric', field: 'Field guide' };
function themeNow() {                       // the chosen style, or Pre-dawn while it is dark if the walker asked for that
  return THEMES[S.settings.theme] ? S.settings.theme : 'forest';
}
function applyDisplay() {
  document.body.classList.toggle('big', !!S.settings.big); document.body.classList.toggle('hc', !!S.settings.hc);
  const t = themeNow();
  if (t === 'forest') delete document.body.dataset.theme; else document.body.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]');
  const paper = getComputedStyle(document.body).getPropertyValue('--paper').trim() || '#FFFFFF';
  if (m) m.setAttribute('content', paper);            // phone's top and bottom bars take the page colour, so no coloured strip shows
  document.documentElement.style.background = paper;
}
const GCOL = { 'Birds': '#1565C0', 'Frogs & toads': '#2E7D32', 'Insects': '#9A5B00', 'Mammals': '#8A3B5C', 'Reptiles': '#6B5B2E' };
const gdot = (g) => `<span class="gdot" style="--g:${GCOL[g] || '#555E68'}" aria-hidden="true"></span>`;
function saveSettings() { store.set('tnsSettings', S.settings); applyDisplay(); }
function focusHeading() { const h = view.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: false }); } }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
function spokenTime(ms) { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'less than a minute' : plural(m, 'minute'); }
function walkStatus(local) {
  const w = S.walk; if (!w) return '';
  const now = w.paused ? w.pausedAt : Date.now(), sp = Object.values(w.species).sort((a, b) => b.t - a.t);
  const f = local ? P : E, name = local ? nm : (s) => s.common;
  return f('status', { paused: w.paused, min: Math.max(0, Math.round((now - w.start - w.pausedMs) / 60000)), km: km(w.track).toFixed(1), n: sp.length,
    recent: sp.slice(0, 3).map((s) => f('item', name(s), Math.round(s.best * 100))).join(', '), demo: w.demo, gps: w.track.length > 0 });
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
  if (location.hash === '' || location.hash === '#home' || location.hash.startsWith('#more') || location.hash === '#profile-credits') route();
}

/* ---------- routing ---------- */
function go(h) { if (location.hash === '#' + h) route(); else location.hash = h; }
window.addEventListener('hashchange', route);
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
/* Profile icon: opens Profile; tapping it again closes Profile and returns to the page you were on */
let beforeProfile = 'home';
$('#profileBtn').addEventListener('click', () => {
  const h = location.hash.slice(1) || 'home';
  if (h.startsWith('profile') || h === 'more') go(beforeProfile || 'home');
  else { beforeProfile = h; go('profile'); }
});
/* QR pop-up in the header: tap the icon, the sharing QR code opens large */
let qrKind = 'app';
function drawQr() {
  const base = location.origin + location.pathname;
  const url = qrKind === 'app' ? base : base + '#access';
  $('#qrBig').innerHTML = qrSvg(url, 8);
  $('#qrNote').textContent = qrKind === 'app' ? 'Opens TNS Bird Walk on any phone.' : 'Opens the app with spoken mode, vibration and large text on.';
  document.querySelectorAll('#qrDlg [data-q]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.q === qrKind));
}
$('#qrBtn').addEventListener('click', () => { drawQr(); $('#qrDlg').showModal(); });
$('#qrClose').addEventListener('click', () => $('#qrDlg').close());
$('#qrDlg').addEventListener('click', (e) => { if (e.target === $('#qrDlg')) $('#qrDlg').close(); });
document.querySelectorAll('#qrDlg [data-q]').forEach((b) => b.addEventListener('click', () => { qrKind = b.dataset.q; drawQr(); }));
const INSTALLED = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: minimal-ui)').matches || navigator.standalone === true || C.allowBrowser === true;
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
    if (p) { S.route = p.id; S.walkName = p.name; setTimeout(() => say('ready', [p.name]), 800); }
    location.replace('#home');
    return;
  }
  if (h === 'access' || h.startsWith('access-')) {        // a QR code that opens the app in spoken mode, optionally with a route
    Object.assign(S.settings, { voice: true, buzz: true, big: true, voiceCmd: VOICE.ok }); saveSettings();
    const rid = h.slice(7); if (rid && allRoutes().some((x) => x.id === rid)) S.route = rid;
    location.replace('#home');
    setTimeout(() => speak(P('welcome', !!S.route), true), 900);
    return;
  }
  if (h.startsWith('route-')) {
    const r = C.routes.find((x) => x.id === h.slice(6));
    if (r) { S.route = r.id; S.walkName = r.name; setTimeout(() => say('ready', [r.name]), 800); }
    location.replace('#home');
    return;
  }
  if (S.walk && S.walk.active && h !== 'walk') { location.hash = 'walk'; return; }
  const tab = (h === 'walk' || h === 'history' || h.startsWith('results')) ? 'walk' : h === 'home' ? 'home' : '';
  document.querySelectorAll('.navb').forEach((b) => b.setAttribute('aria-current', b.dataset.go === tab ? 'page' : 'false'));
  $('#profileBtn').setAttribute('aria-current', h.startsWith('profile') || h === 'more' ? 'page' : 'false');
  $('#profileBtn').setAttribute('aria-label', h.startsWith('profile') || h === 'more' ? 'Close profile' : 'Profile, settings and credits');
  document.body.classList.toggle('nonav', h.startsWith('profile') || h === 'more');
  view.classList.toggle('fit', h === 'home' || (h === 'walk' && !!S.walk) || h.startsWith('results-'));
  if ((h === 'walk' || h === 'history') && !S.walk && S.recover) { location.replace('#home'); return; }   // an interrupted walk is offered on Home
  if (h === 'walk' || h === 'history') { if (S.walk) renderWalk(); else renderHistory(); }
  else if (h.startsWith('profile') || h === 'more') renderMore(h === 'more' ? 'profile' : h);
  else if (h.startsWith('results-')) renderResults(h.slice(8));
  else renderHome();
  fitView();
  if (h !== lastPage) { if (lastPage !== null) focusHeading(); lastPage = h; }
}
let lastPage = null;


/* Home and Walk must fit the screen without scrolling. Phones differ in height and in the text size the
   owner has set, so after drawing we hide extras step by step (t1, t2, t3) until nothing overflows. */
function fitView() {
  view.classList.remove('t1', 't2', 't3');
  if (!view.classList.contains('fit')) return;
  for (const c of ['t1', 't2', 't3']) { if (view.scrollHeight <= view.clientHeight + 1) break; view.classList.add(c); }
}
let fitTimer = 0;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitView, 150); });

/* ---------- home ---------- */
/* Sound trace: one column per second of sound level, mirrored around a centre line, with a turmeric mark
   where a bird was identified. Used live on the walk screen and as the motif on Home. */
const MAGMA = ['#3B0F70', '#8C2981', '#DE4968', '#FE9F6D', '#FCFDBF'];
function traceSvg(levels, marks, w, h, where) {   // where: 'hero' or 'panel'; colours come from the current style
  const n = levels.length, step = w / Math.max(n, 1), mid = h / 2, room = h / 2 - 6, sw = Math.max(1.5, step * 0.55).toFixed(1);
  const col = (i, v) => { const x = (i + 0.5) * step, y = Math.max(1.5, v * room); return `M${x.toFixed(1)} ${(mid - y).toFixed(1)}V${(mid + y).toFixed(1)}`; };
  let body;
  if (themeNow() === 'dawn' && !S.settings.hc) {   // Pre-dawn: each column coloured by how loud it was, dark purple (quiet) to pale yellow (loud)
    body = levels.map((v, i) => `<path d="${col(i, v)}" style="stroke:${MAGMA[Math.min(4, Math.floor(v * 5))]}" stroke-width="${sw}" stroke-linecap="round"/>`).join('');
  } else body = `<path d="${levels.map((v, i) => col(i, v)).join('')}" style="stroke:var(${where === 'hero' ? '--heroTrace' : '--trace'})" stroke-width="${sw}" stroke-linecap="round" fill="none"/>`;
  const m = (marks || []).map((k) => { const x = ((k.i + 0.5) * step).toFixed(1); return `<path d="M${x} 4V${h - 4}" style="stroke:var(--mark)" stroke-width="2"/><circle cx="${x}" cy="5" r="4" style="fill:var(--mark)"/>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${body}${m}</svg>`;
}
const MOTIF = (() => {                     // a fixed song-like pattern for Home: three rising phrases, as a koel calls
  const out = [];
  for (let i = 0; i < 96; i++) {
    const ph = i % 32, call = ph < 22 ? Math.sin((ph / 22) * Math.PI) * (0.35 + 0.5 * (Math.floor(i / 32) / 2)) : 0.04;
    out.push(Math.max(0.04, call * (0.75 + 0.25 * Math.sin(i * 1.7))));
  }
  return out;
})();

/* ---------- voice commands for blind and low-vision walkers ----------
   Two short commands: "Start walk" starts a walk, "Stop walk" finishes it ("Walk status" reads the status).
   Uses the phone's speech recognition (Chrome on Android). Listening restarts by itself while voice commands are on. */
const VOICE = { ok: !!(window.SpeechRecognition || window.webkitSpeechRecognition), rec: null, on: false, retry: 0, heard: '', err: '', lock: 0, last: 0, log: [] };
/* A short diary of what speech recognition did, shown in Profile → Settings → Voice commands, so a failure on a real phone can be seen */
function vlog(msg) {
  const t = new Date().toLocaleTimeString('en-IN', { hour12: false });
  VOICE.log.push(t + '  ' + msg); if (VOICE.log.length > 40) VOICE.log.shift();
  const el = $('#vcLog'); if (el) { el.textContent = VOICE.log.slice().reverse().join('\n'); }
}
/* Phones write the same words differently, and Indian English "walk" often comes back as "work" or "wok".
   Both words of a command must be heard together, so ordinary talk ("let's stop here") never ends a walk. */
function norm(t) { return ' ' + t.toLowerCase().replace(/['’]/g, '').replace(/[.,!?"\-]/g, ' ').replace(/\s+/g, ' ').trim() + ' '; }
const WALK = '(walk|walks|work|works|wok|woke|wak|vok|vak|bok)';
const START_RX = new RegExp('\\b(start|starts|stat|star|stard|begin) (the |a |my )?' + WALK + '\\b');
const STOP_RX = new RegExp('\\b(stop|stops|stopped|stap|top|end|finish) (the |my )?' + WALK + '\\b');
const STATUS_RX = new RegExp('\\b' + WALK + ' status\\b|\\bstatus\\b');
function matchCommand(texts) {
  for (const raw of texts) {
    const t = norm(raw);
    if (STOP_RX.test(t)) return 'stop';
    if (START_RX.test(t)) return 'start';
    if (STATUS_RX.test(t)) return 'status';
  }
  return '';
}
function heardCommand(texts) {
  if (Date.now() < VOICE.lock) return true;                 // one command at a time (interim and final results repeat it)
  const c = matchCommand(texts);
  if (!c) return false;
  VOICE.lock = Date.now() + 4000;
  if (c === 'stop') { if (!S.walk) speak('No walk is running.', true); else { speak('Finishing.', true); finishWalk(); } }
  else if (c === 'start') { if (S.walk) speak('The walk is already running.', true); else { speak('Walk started.', true); startWalk(); } }
  else if (c === 'status') { if (S.walk) speak(walkStatus(true), true); else speak('No walk is running.', true); }
  return true;
}
function describeCommand(texts) { const c = matchCommand(texts); return c ? c.toUpperCase() + ' command' : ''; }
async function voiceCheck() {
  const ua = navigator.userAgent;
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /EdgA|Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS/.test(ua) ? 'Chrome on iPhone' : /iPhone|iPad/.test(ua) ? 'Safari on iPhone' : /Chrome/.test(ua) ? 'Chrome' : 'unknown browser';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let mic = 'unknown';
  try { mic = (await navigator.permissions.query({ name: 'microphone' })).state; } catch (e) {}
  vlog('check: ' + browser + (standalone ? ', installed app' : ', browser tab') + ', speech recognition ' + (VOICE.ok ? 'available' : 'NOT available') + ', microphone permission ' + mic + ', ' + (navigator.onLine ? 'online' : 'OFFLINE') + ', voice commands ' + (S.settings.voiceCmd ? 'on' : 'off') + ', listener ' + (VOICE.on ? 'running' : 'not running'));
}
function voiceStatusText() {
  if (!S.settings.voiceCmd) return '';
  if (VOICE.err) return 'Voice commands paused: ' + VOICE.err;
  if (VOICE.heard) return (S.walk ? 'Voice heard: “' : 'Heard: “') + VOICE.heard + '”';
  return S.walk ? 'Say “Stop walk” to finish' : 'Say “Start walk” to begin';
}
function showVoiceStatus() { const el = $('#vcStat'); if (el) el.textContent = voiceStatusText(); }
function voiceListen() {
  if (!VOICE.ok || !S.settings.voiceCmd || VOICE.on) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = VOICE.rec = new SR();
  r.lang = 'en-IN'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 3;
  r.onstart = () => { vlog('listening started'); };
  r.onspeechstart = () => { vlog('speech detected'); };
  r.onresult = (e) => {
    VOICE.err = ''; VOICE.retry = 0;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const alts = [...e.results[i]].map((a) => a.transcript);
      VOICE.heard = (alts[0] || '').trim().slice(-40);
      if (e.results[i].isFinal) vlog('heard: "' + alts.join('" / "') + '" → ' + (describeCommand(alts) || 'not a command'));
      if (heardCommand(alts)) break;
    }
    showVoiceStatus();
  };
  r.onerror = (e) => {
    vlog('error: ' + e.error + (e.message ? ' (' + e.message + ')' : ''));
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      /* Some phones refuse to listen until the person has touched the screen once after opening the app.
         Keep the setting on and start again on the next tap anywhere, instead of switching voice commands off. */
      if (VOICE.blocked) return;
      VOICE.err = 'tap anywhere on the screen to start listening'; VOICE.blocked = true; showVoiceStatus();
      document.addEventListener('pointerdown', () => { VOICE.blocked = false; VOICE.err = ''; VOICE.retry = 0; voiceListen(); showVoiceStatus(); }, { once: true });
      return;
    }
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    VOICE.err = e.error === 'network' ? 'no internet for speech recognition' : e.error === 'audio-capture' ? 'the microphone is busy' : e.error;
    showVoiceStatus();
  };
  r.onend = () => { vlog('listening ended'); VOICE.on = false; VOICE.last = Date.now(); if (S.settings.voiceCmd && !VOICE.blocked) setTimeout(voiceListen, Math.min(400 + VOICE.retry * 300, 3000)); VOICE.retry++; };
  try { r.start(); VOICE.on = true; } catch (e) { VOICE.on = false; vlog('could not start: ' + e.message); }
}
async function voiceTest() {
  await voiceCheck();
  if (!VOICE.ok) return;
  const wasOn = S.settings.voiceCmd; voiceStop();
  try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); vlog('test: microphone OK'); }
  catch (e) { vlog('test: microphone refused (' + e.name + ')'); }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR(); r.lang = 'en-IN'; r.continuous = true; r.interimResults = false; r.maxAlternatives = 3;
  r.onstart = () => vlog('test: listening, speak now');
  r.onaudiostart = () => vlog('test: sound input opened');
  r.onspeechstart = () => vlog('test: speech detected');
  r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) { const alts = [...e.results[i]].map((a) => a.transcript); vlog('test heard: "' + alts.join('" / "') + '" → ' + (describeCommand(alts) || 'not a command')); } };
  r.onerror = (e) => vlog('test error: ' + e.error + (e.message ? ' (' + e.message + ')' : ''));
  r.onend = () => { vlog('test: finished'); if (wasOn) { VOICE.retry = 0; setTimeout(voiceListen, 500); } };
  try { r.start(); } catch (e) { vlog('test: could not start (' + e.message + ')'); }
  setTimeout(() => { try { r.stop(); } catch (e) {} }, 10000);
}
/* Watchdog: phones end speech recognition quietly (silence, a call, the screen dimming, recording starting).
   Every 5 seconds, if commands are on and nothing is listening, start listening again. */
setInterval(() => { if (S.settings.voiceCmd && VOICE.ok && !VOICE.on && !VOICE.blocked && Date.now() - VOICE.last > 2500) voiceListen(); }, 5000);
/* Starting the bird recording can take the microphone away from speech recognition on some phones,
   so listening is restarted once the recording is running. */
function voiceRebind() { if (!S.settings.voiceCmd || !VOICE.ok) return; voiceStop(); VOICE.retry = 0; setTimeout(voiceListen, 300); }
function voiceStop() { const r = VOICE.rec; VOICE.rec = null; VOICE.on = false; if (r) { r.onend = null; try { r.abort(); } catch (e) {} } }
function refreshVoiceUi() { const h = location.hash.slice(1) || 'home'; if (h === 'home') renderHome(); else if (h === 'walk' && S.walk) renderWalk(); else if (h.startsWith('profile')) renderMore(h); }
function setVoiceCmd(on) {
  S.settings.voiceCmd = on; saveSettings(); VOICE.retry = 0;
  if (on) { voiceListen(); speak(S.walk ? 'Voice commands on. Say stop walk to finish.' : 'Voice commands on. Say start walk to begin.', true); }
  else { voiceStop(); speak('Voice commands off.', true); }
  refreshVoiceUi();
}

function renderHome() {
  if (!S.route && allRoutes().length === 1) S.route = ANYWHERE.id;      // only Walk anywhere: pick it for the walker
  const total = S.walks.length, species = new Set();
  S.walks.forEach((w) => w.species.forEach((s) => species.add(s.sci)));
  const notice = S.model === 'demo'
    ? `<p class="banner">Demo mode: the BirdNET+ V3.0 files aren't on the server yet, so results will be sample data. GPS and the walk timer are real.</p>`
    : S.model === 'error' ? `<p class="banner err">The bird sound model could not load. ${esc(S.modelMsg)}</p>` : '';
  const R = S.recover;
  const recCard = R ? `<section class="recover" role="region" aria-label="Unfinished walk">
      <b>Your walk was interrupted</b>
      <p class="muted">${esc(R.routeName)}, started at ${esc(new Date(R.start).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }))}. ${km(R.track || []).toFixed(1)} km and ${plural(Object.keys(R.species || {}).length, 'species', 'species')} are saved.</p>
      <button class="btn" id="recContinue">Continue this walk</button>
      <button class="btn alt" id="recFinish">Finish and see the results</button>
    </section>` : '';
  const hour = new Date().getHours(), hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Namaskaram' : 'Good evening';
  view.innerHTML = `
    ${notice}${recCard}
    <section class="hero">
      <p class="hi">${hello}${S.settings.name ? ', ' + esc(S.settings.name) : ''}</p>
      <h1>Ready for a bird walk?</h1>
      <p class="sum">${total ? `${plural(total, 'walk')} and ${plural(species.size, 'species', 'species')} heard on this phone so far.` : 'Walk slowly and the phone will name the birds it hears.'}</p>
      <div class="trace">${traceSvg(MOTIF, [], 480, 64, 'hero')}</div>
    </section>
    ${allRoutes().length > 1 ? `<h2>Choose a place</h2>
    <div class="list">
      ${allRoutes().map((r) => `
        <button class="route" data-route="${esc(r.id)}" aria-pressed="${S.route === r.id}" aria-label="${esc(r.name)}. ${esc(r.meta)}. ${esc(r.tag)}">
          <span class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="color:var(--forest)"><path d="M4 19c3-6 5-2 8-8s5-4 8-6"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="5" r="1.5"/></svg></span>
          <span style="flex:1"><b>${esc(r.name)}</b><span class="muted">${esc(r.meta)}</span></span>
          ${S.route === r.id ? '<span class="tag">Selected</span>' : ''}
        </button>`).join('')}
    </div>` : ''}
    <div class="fields2">
      <label class="f">Walk name<input id="wName" maxlength="60" list="wNames" autocomplete="off" placeholder="e.g. Talakona trail" value="${esc(S.walkName)}"></label>
      <datalist id="wNames">${[...new Set(S.walks.map((w) => w.routeName).filter((n) => n && n !== ANYWHERE.name))].slice(0, 15).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <label class="f">Your name<input id="wWalker" maxlength="60" autocomplete="name" placeholder="Optional" value="${esc(S.settings.name)}"></label>
    </div>
    <div class="mic">
      <button class="micbtn" id="start" aria-label="Start walk" ${S.route && S.model !== 'loading' && S.model !== 'error' ? '' : 'disabled'}><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7"/></svg></button>
      <p class="miclbl" aria-hidden="true">${S.model === 'loading' ? 'Loading the bird model…' : S.model === 'error' ? 'The bird model could not load' : S.route ? 'Tap to start the walk' : 'Pick a place above'}</p>
    </div>
    ${VOICE.ok ? `<button class="vcbtn${S.settings.voiceCmd ? ' on' : ''}" id="vcHome" aria-pressed="${!!S.settings.voiceCmd}">${ICON.mic}${S.settings.voiceCmd ? 'Listening for “Start walk”' : 'Turn on voice commands'}</button>` : ''}${S.settings.voiceCmd ? `<p class="muted vcline" id="vcStat" aria-hidden="true">${esc(voiceStatusText())}</p>` : ''}
    ${permNeeded() ? permHtml() : `<p class="tip">${S.settings.voice ? 'Spoken mode is on. Keep the phone in a shirt pocket or on a lanyard with the microphone facing out. It will tell you each new bird. Double-tap Say status at any time.' : 'Best between 6:00 and 8:30 am. Hold the phone out of your pocket, walk slowly, and stop for a minute every 200 m.'}</p>`}
    ${S.settings.voice ? '' : '<button class="linkish" id="a11yOn">Turn on spoken mode for blind and low-vision walkers</button>'}
`;
  const pm = $('#perm'); if (pm) pm.addEventListener('click', askPermissions);
  view.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => {
    S.route = b.dataset.route;
    const picked = allRoutes().find((x) => x.id === S.route);
    if (picked && picked.id !== ANYWHERE.id) S.walkName = picked.name;
    renderHome();
    const again = view.querySelector(`[data-route="${CSS.escape(S.route)}"]`); if (again) again.focus();
    const r = allRoutes().find((x) => x.id === S.route);
    say('selected', [r ? r.name : 'Route']);
  }));
  const on = $('#a11yOn');
  if (on) on.addEventListener('click', () => {
    Object.assign(S.settings, { voice: true, buzz: true, big: true }); saveSettings(); renderHome(); focusHeading();
    speak(P('modeOn', S.settings.every), true);
  });
  const st = $('#start'); if (st) st.addEventListener('click', () => startWalk());
  const vh = $('#vcHome'); if (vh) vh.addEventListener('click', () => setVoiceCmd(!S.settings.voiceCmd));
  $('#wName').addEventListener('input', (e) => { S.walkName = e.target.value; });
  $('#wWalker').addEventListener('change', (e) => { S.settings.name = e.target.value.trim(); saveSettings(); });
  const rc = $('#recContinue'); if (rc) rc.addEventListener('click', () => startWalk(S.recover));
  const rf = $('#recFinish'); if (rf) rf.addEventListener('click', () => finishRecovered());
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.deferredInstall = e; if (!INSTALLED) renderGate(); });
window.addEventListener('appinstalled', () => { S.deferredInstall = null; S.justInstalled = true; if (!INSTALLED) renderGate(); });

/* ---------- microphone and location permission ----------
   A web app cannot skip the phone's own "Allow microphone / location?" questions; the browser always asks once.
   What the app can do: ask both together, once, at a moment that makes sense, and explain how to fix a "Block". */
S.perm = { mic: 'prompt', geo: 'prompt' };
async function readPermissions() {
  for (const [k, name] of [['mic', 'microphone'], ['geo', 'geolocation']]) {
    try {
      const st = await navigator.permissions.query({ name });
      S.perm[k] = st.state;
      st.onchange = () => { S.perm[k] = st.state; if ((location.hash || '#home') === '#home') renderHome(); };
    } catch (e) { S.perm[k] = 'unknown'; }
  }
  if ((location.hash || '#home') === '#home' && INSTALLED) renderHome();
}
function permNeeded() { return S.perm.mic === 'prompt' || S.perm.geo === 'prompt' || S.perm.mic === 'denied' || S.perm.geo === 'denied'; }
function permHtml() {
  if (S.perm.mic === 'denied' || S.perm.geo === 'denied') {
    const what = S.perm.mic === 'denied' && S.perm.geo === 'denied' ? 'microphone and location are' : S.perm.mic === 'denied' ? 'microphone is' : 'location is';
    return `<div class="permbar bad" role="alert"><b>The ${what} blocked for this app.</b> Open Chrome, tap ⋮, then Settings › Site settings › ${S.perm.mic === 'denied' ? 'Microphone' : 'Location'}, find this app's address under Blocked and choose Allow. Then reopen the app.</div>`;
  }
  return `<button class="permbar" id="perm"><b>Allow microphone and location</b><span>Needed once, before your first walk. The phone will ask twice: tap Allow both times.</span></button>`;
}
async function askPermissions() {
  try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); S.perm.mic = 'granted'; }
  catch (e) { S.perm.mic = e.name === 'NotAllowedError' ? 'denied' : S.perm.mic; }
  await new Promise((res) => navigator.geolocation.getCurrentPosition(() => { S.perm.geo = 'granted'; res(); }, (e) => { if (e.code === 1) S.perm.geo = 'denied'; res(); }, { enableHighAccuracy: true, timeout: 15000 }));
  renderHome();
  if (!permNeeded()) tell('Microphone and location are allowed. You are ready to walk.', true);
}

/* ---------- install-only page ----------
   Opened in a browser tab (from a QR code or a link), the app shows only how to install it.
   The full app runs only once installed and opened from the home screen. */
function renderGate() {
  document.body.classList.add('gate');
  const base = location.origin + location.pathname;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /; wv\)|FBAN|FBAV|Instagram|Line\/|WhatsApp|GSA\//.test(ua);
  const samsung = /SamsungBrowser/.test(ua);
  const mobile = /Android|iPhone|iPad|iPod/.test(ua) || ios;
  let how;
  if (S.justInstalled) how = '<p class="gnote ok"><b>Installed.</b> Close this page and open <b>TNS Bird Walk</b> from your home screen.</p>';
  else if (inApp) how = `<p class="gnote">This link opened inside another app, which cannot install apps. Tap <b>⋮</b> or <b>…</b> at the top and choose <b>Open in Chrome</b>${ios ? ' (on iPhone: Open in Safari)' : ''}, or copy the link and paste it into Chrome.</p><button class="btn alt" id="gCopy">Copy the link</button>`;
  else if (S.deferredInstall) how = '<button class="btn" id="gInstall">Install TNS Bird Walk</button><p class="gnote">Free, about 1 MB now. The bird model (about 75 MB) downloads the first time you open the app, so use Wi-Fi if you can.</p>';
  else if (ios) how = '<ol class="gsteps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open <b>TNS Bird Walk</b> from your home screen.</li></ol>';
  else if (samsung) how = '<ol class="gsteps"><li>Tap <b>☰</b> at the bottom right.</li><li>Tap <b>Add page to</b>, then <b>Home screen</b>.</li><li>Open <b>TNS Bird Walk</b> from your home screen.</li></ol>';
  else if (mobile) how = '<ol class="gsteps"><li>Tap <b>⋮</b> at the top right of Chrome.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>, then <b>Install</b>).</li><li>Open <b>TNS Bird Walk</b> from your home screen.</li></ol><p class="gnote">If the menu shows <b>Open app</b> instead, it is already installed: open it from your home screen.</p>';
  else how = `<p class="gnote">TNS Bird Walk is a phone app. Scan this code with your phone's camera to install it.</p><div class="qr">${qrSvg(base, 6)}</div>`;
  view.className = 'gatepg';
  view.innerHTML = `
    <img class="gicon" src="icons/icon-192.png" width="96" height="96" alt="">
    <h1>TNS Bird Walk</h1>
    <p class="glead">Record bird calls on your walk and find out which birds are around you. By Tirupati Nature Society.</p>
    ${how}
    <p class="gfine">When you start your first walk, the phone asks to use the microphone (to hear birds) and location (to map the walk). Tap Allow both times.</p>`;
  const gi = $('#gInstall');
  if (gi) gi.addEventListener('click', async () => { const d = S.deferredInstall; if (!d) return; d.prompt(); const c = await d.userChoice; if (c.outcome === 'accepted') { S.deferredInstall = null; S.justInstalled = true; } renderGate(); });
  const gc = $('#gCopy');
  if (gc) gc.addEventListener('click', async () => { try { await navigator.clipboard.writeText(base); gc.textContent = 'Link copied'; } catch (e) { gc.textContent = base; } });
}

/* ---------- walk ---------- */
let audio = null, geoWatch = null, wakeLock = null, tick = null;
async function startWalk(prev) {
  const r = prev ? { id: prev.route, name: prev.routeName } : allRoutes().find((x) => x.id === S.route) || ANYWHERE;
  let stream;
  try {
    const a = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
    if (S.settings.deviceId) a.deviceId = { exact: S.settings.deviceId };
    stream = await navigator.mediaDevices.getUserMedia({ audio: a });
    setTimeout(voiceRebind, 1500);
  } catch (e) {
    view.insertAdjacentHTML('afterbegin', '<p class="banner err">Microphone permission is needed to listen for birds. Allow it in the browser and try again.</p>');
    say('mic', [], true);
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
  if (prev) {                                // carry on a walk that was saved before a refresh or crash
    prev.species = prev.species || {};
    Object.values(prev.species).forEach((x) => { x.clip = null; });
    S.walk = Object.assign(prev, { active: true, paused: false, pausedAt: null, pausedMs: (prev.pausedMs || 0) + Math.max(0, now - (prev.savedAt || now)),
      anchors: [{ audioSec: 0, wall: now }], sentSec: 0, level: new Array(32).fill(0.05), pending: 0, geoSent: false, resumed: (prev.resumed || 0) + 1 });
    S.recover = null;
  } else {
    if (S.recover) { const old = S.recover; S.recover = null; old.active = false; old.end = old.savedAt || now; if (old.demo && !Object.keys(old.species || {}).length) addDemo(old); saveWalk(old); }
    S.walk = {
    id: String(now), active: true, paused: false, route: r.id, routeName: (S.walkName || '').trim().slice(0, 60) || r.name, walker: S.settings.name || '', start: now, end: null,
    demo: S.model === 'demo', model: S.model === 'ready' ? 'BirdNET+ V3.0' : 'demo', track: [], detections: [],
    species: {}, humanWindows: 0, windows: 0, anchors: [{ audioSec: 0, wall: now }], sentSec: 0, level: new Array(32).fill(0.05),
    pausedMs: 0, pausedAt: null, pending: 0, geoUsed: false, geoSent: false, errors: 0
  };
  }
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
  document.documentElement.classList.add('walking');
  checkpoint(true);
  go('walk');
  lastSpoken = Date.now();
  say('started', [r.name]);
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
    if (!w.species[d.i]) { newBird(L, d.score); lastCheckpoint = 0; if (w.marks) w.marks.push({ i: w.sono.length - 1, name: L.common }); }
    else if (S.settings.repeat && Date.now() - (w.species[d.i].said || 0) > 300000) { w.species[d.i].said = Date.now(); newBird(L, d.score); }
    const sp = w.species[d.i] || (w.species[d.i] = { said: Date.now(), i: d.i, sci: L.sci, common: L.common, group: L.group, count: 0, best: 0, t: t, lat: loc.lat, lon: loc.lon, est: loc.est, clipScore: 0, clip: null });
    sp.count++;
    if (d.score > sp.best) sp.best = d.score;
    if (k === 0 && m.pcm && d.score > sp.clipScore) { sp.clipScore = d.score; sp.clip = wav(m.pcm, C.model.sampleRate); saveClip(w.id, sp); }
  });
}
/* ---------- sound clips: one best 3-second clip per species, kept on the phone in IndexedDB ---------- */
const CLIPS = {};                                   // walkId -> { sci: Blob }, loaded on demand
const KEEP_CLIP_WALKS = 30;                         // clips are kept for the 30 most recent walks
let clipDb = null;
function idb() {
  if (clipDb) return clipDb;
  clipDb = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no IndexedDB'));
    const r = indexedDB.open('tnsClips', 1);
    r.onupgradeneeded = () => { const st = r.result.createObjectStore('clips', { keyPath: 'key' }); st.createIndex('walk', 'walkId'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  clipDb.catch(() => { clipDb = null; });
  return clipDb;
}
async function clipTx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('clips', mode), out = fn(t.objectStore('clips')); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); });
}
function saveClip(walkId, sp) {                       // called whenever a better clip for a species arrives
  if (!sp.clip) return;
  (CLIPS[walkId] = CLIPS[walkId] || {})[sp.sci] = sp.clip;
  clipTx('readwrite', (st) => st.put({ key: walkId + '|' + sp.sci, walkId, sci: sp.sci, common: sp.common, score: sp.clipScore, blob: sp.clip, sent: false })).catch(() => {});
}
async function walkClips(walkId) {
  try {
    const rows = await clipTx('readonly', (st) => st.index('walk').getAll(walkId));
    return rows || [];
  } catch (e) { return []; }
}
async function loadClips(walkId) {
  const rows = await walkClips(walkId);
  const m = CLIPS[walkId] = CLIPS[walkId] || {};
  rows.forEach((r) => { if (!m[r.sci]) m[r.sci] = r.blob; });
  return m;
}
async function deleteClips(walkIds) {
  for (const id of walkIds) {
    delete CLIPS[id];
    const rows = await walkClips(id);
    await clipTx('readwrite', (st) => rows.forEach((r) => st.delete(r.key))).catch(() => {});
  }
}
async function pruneClips() {                         // keep the phone's storage in check
  const keep = new Set(S.walks.slice(0, KEEP_CLIP_WALKS).map((w) => w.id).concat(S.walk ? [S.walk.id] : [], S.recover ? [S.recover.id] : []));
  try {
    const keys = await clipTx('readonly', (st) => st.getAllKeys());
    const old = [...new Set((keys || []).map((k) => k.split('|')[0]))].filter((id) => !keep.has(id));
    const keepPending = new Set(S.walks.filter((w) => w.submitted && !w.clipsDone && !w.demo).map((w) => w.id));
    await deleteClips(old.filter((id) => !keepPending.has(id)));
  } catch (e) {}
}
const toBase64 = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = () => rej(f.error); f.readAsDataURL(blob); });
let uploading = false;
async function uploadClips(w, progress) {             // after the walk itself is saved in the Sheet
  if (!C.uploadUrl || w.demo || !S.settings.sendClips) return { sent: 0, total: 0 };
  const rows = (await walkClips(w.id)).filter((r) => !r.sent);
  let sent = 0;
  for (const r of rows) {
    if (progress) progress(sent, rows.length);
    try {
      const data = await toBase64(r.blob);
      const res = await fetch(C.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'clip', walk_id: w.id, sci: r.sci, common: r.common, start: w.start, score: r.score, mime: 'audio/wav', data }) });
      let j;
      try { j = await res.json(); } catch (x) { throw new Error('the TNS script sent back an error page; check it is deployed and allowed to use Google Drive'); }
      if (!j.ok) throw new Error(j.error === 'Missing walk data' ? 'the TNS script is still the old version; deploy the new Code.gs as a new version' : (j.error || 'not saved'));
      r.sent = true; r.fileId = j.file_id;
      await clipTx('readwrite', (st) => st.put(r));
      sent++;
    } catch (e) { return { sent, total: rows.length, error: navigator.onLine ? e.message : 'no signal' }; }
  }
  w.clipsDone = true; store.set('tnsWalks', S.walks);
  return { sent, total: rows.length };
}
async function retryClips() {                         // walks submitted earlier whose clips did not all go
  if (uploading || !C.uploadUrl || !navigator.onLine || !S.settings.sendClips) return;
  uploading = true;
  try { for (const w of S.walks.filter((x) => x.submitted && !x.clipsDone && !x.demo)) { const r = await uploadClips(w); if (r.error) break; } }
  finally { uploading = false; }
}
window.addEventListener('online', () => setTimeout(retryClips, 3000));

/* ---------- keep the walk safe: saved to the phone every few seconds ---------- */
const LIVE = 'tnsLiveWalk';
let lastCheckpoint = 0;
function checkpoint(force) {
  const w = S.walk; if (!w || !w.active) return;
  if (!force && Date.now() - lastCheckpoint < 5000) return;
  lastCheckpoint = Date.now();
  const sp = {}; Object.entries(w.species).forEach(([k, v]) => { sp[k] = Object.assign({}, v, { clip: null }); });
  const copy = Object.assign({}, w, { species: sp, level: null, sono: null, marks: null, savedAt: Date.now(), paused: false,
    pausedMs: w.paused ? w.pausedMs + (Date.now() - w.pausedAt) : w.pausedMs, pausedAt: null });
  if (!store.set(LIVE, copy)) { copy.detections = copy.detections.slice(-3000); copy.track = copy.track.filter((_, i) => i % 2 === 0); store.set(LIVE, copy); }
}
function clearCheckpoint() { try { localStorage.removeItem(LIVE); } catch (e) {} document.documentElement.classList.remove('walking'); }
window.addEventListener('beforeunload', (e) => {   // asks "Leave site?" if someone reloads or closes mid-walk
  if (S.walk && S.walk.active) { checkpoint(true); e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('pagehide', () => checkpoint(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') checkpoint(true); });
function finishRecovered() {
  const w = S.recover; if (!w) return;
  S.recover = null;
  w.active = false; w.end = w.savedAt || Date.now();
  Object.values(w.species || {}).forEach((x) => { x.clip = null; });
  if (w.demo && !Object.keys(w.species).length) addDemo(w);
  saveWalk(w); clearCheckpoint();
  S.lastWalk = w;
  go('results-' + w.id);
}

let birdQueue = [], birdTimer = null, lastSpoken = 0;
function newBird(L, score) {                 // batch birds heard within a few seconds into one sentence
  birdQueue.push([L, Math.round(score * 100)]);
  clearTimeout(birdTimer);
  birdTimer = setTimeout(() => {
    const q = birdQueue; birdQueue = [];
    const total = S.walk ? Object.keys(S.walk.species).length : q.length;
    buzz([120, 80, 120]);
    announce(E('bird', q.map(([b, p]) => E('item', b.common, p)).join(', '), total));
    speak(P('bird', q.map(([b, p]) => P('item', nm(b), p)).join(', '), total));
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

let walkTab = 'map';
function renderWalk() {
  const w = S.walk;
  if (!w) return go('home');
  if (!w.sono) { w.sono = new Array(90).fill(0); w.marks = []; w.sonoN = 0; }
  view.innerHTML = `
    <div class="walkhead">
      <div><h1>${w.routeName && w.routeName !== ANYWHERE.name ? esc(w.routeName) : w.active ? 'Walking' : 'Finishing'}</h1>${S.settings.voiceCmd ? `<p class="sub" id="vcStat" aria-hidden="true">${esc(voiceStatusText())}</p>` : ''}</div>
      <div class="wh-r"><span class="live" id="live" aria-hidden="true"><i></i><span id="liveTxt">Listening</span></span>${VOICE.ok ? `<button class="vcbtn round${S.settings.voiceCmd ? ' on' : ''}" id="vcWalk" aria-pressed="${!!S.settings.voiceCmd}" aria-label="${S.settings.voiceCmd ? 'Voice commands are on. Say stop walk to finish.' : 'Turn on voice commands'}">${ICON.mic}</button>` : ''}</div>
    </div>
    <section class="panel" aria-hidden="true">
      <div class="lbl"><span>Sound, last 90 seconds</span><span id="gpsTxt">Waiting for GPS</span></div>
      <div class="meter" id="meter"></div>
      <div class="nums"><div><b id="wTime">00:00</b><span>time</span></div><div><b id="wDist">0.0 km</b><span>distance</span></div><div><b id="wSp">0</b><span>species</span></div></div>
      <div id="finishBox" class="hide" style="display:flex;flex-direction:column;gap:8px"><p style="font-weight:700">Finishing the analysis…</p><div class="prog"><i id="finBar" style="width:10%"></i></div></div>
    </section>
    <div class="tabs" role="tablist" aria-label="Walk view">
      <button class="tab" role="tab" id="tabMap" aria-controls="paneMap" aria-selected="${walkTab === 'map'}">Map</button>
      <button class="tab" role="tab" id="tabSp" aria-controls="paneSp" aria-selected="${walkTab === 'sp'}">Species <span id="tabSpN">0</span></button>
    </div>
    <div class="pane${walkTab === 'map' ? '' : ' hide'}" id="paneMap" role="tabpanel" aria-labelledby="tabMap"><div class="map" id="map" aria-hidden="true"></div></div>
    <div class="pane${walkTab === 'sp' ? '' : ' hide'}" id="paneSp" role="tabpanel" aria-labelledby="tabSp"><div class="card heard" id="latest" aria-hidden="true"><p class="muted" style="border:0;padding:6px 0">${w.demo ? 'Demo mode: sample birds are added when you finish.' : 'Listening. Each new bird appears here.'}</p></div></div>
    <div class="ctrls" id="walkBtns">
      <div class="rb"><button class="rbtn" id="pause" aria-label="${w.paused ? 'Resume' : 'Pause'}">${w.paused ? ICON.play : ICON.pause}</button><span id="pauseLbl" aria-hidden="true">${w.paused ? 'Resume' : 'Pause'}</span></div>
      <div class="rb"><button class="rbtn stop" id="finish" aria-label="Stop and finish the walk">${ICON.stop}</button><span id="finishLbl" aria-hidden="true">Stop</span></div>
      <div class="rb"><button class="rbtn say" id="say" aria-label="Say status">${ICON.say}</button><span aria-hidden="true">Say status</span></div>
    </div>`;
  $('#say').addEventListener('click', () => { announce(walkStatus(false), true); speak(walkStatus(true)); lastSpoken = Date.now(); });
  $('#pause').addEventListener('click', togglePause);
  const pick = (t) => { walkTab = t; $('#tabMap').setAttribute('aria-selected', t === 'map'); $('#tabSp').setAttribute('aria-selected', t === 'sp');
    $('#paneMap').classList.toggle('hide', t !== 'map'); $('#paneSp').classList.toggle('hide', t !== 'sp'); updateWalk(); };
  const vw = $('#vcWalk'); if (vw) vw.addEventListener('click', () => setVoiceCmd(!S.settings.voiceCmd));
  $('#tabMap').addEventListener('click', () => pick('map')); $('#tabSp').addEventListener('click', () => pick('sp'));
  $('#finish').addEventListener('click', stopPressed);
  clearInterval(tick); tick = setInterval(updateWalk, 1000); updateWalk();
}
function updateWalk() {
  const w = S.walk; if (!w || !$('#wTime')) { clearInterval(tick); return; }
  const now = w.paused ? w.pausedAt : Date.now();
  $('#wTime').textContent = fmt(now - w.start - w.pausedMs);
  $('#wDist').textContent = km(w.track).toFixed(1) + ' km';
  $('#wSp').textContent = Object.keys(w.species).length;
  $('#live').className = 'live' + (w.paused ? ' off' : ''); $('#liveTxt').textContent = w.paused ? 'Paused' : 'Listening';
  const last = w.track[w.track.length - 1];
  $('#gpsTxt').textContent = last ? 'GPS ±' + last.acc + ' m' : 'Waiting for GPS';
  if (!w.sono) { w.sono = new Array(90).fill(0); w.marks = []; w.sonoN = 0; }
  if (!w.paused) { w.sono.push(Math.max(...w.level)); w.sono.shift(); w.sonoN++; w.marks = w.marks.map((k) => ({ i: k.i - 1, name: k.name })).filter((k) => k.i >= 0); }
  $('#meter').innerHTML = traceSvg(w.sono, w.marks, 360, 96, 'panel');
  const all = Object.values(w.species).sort((a, b) => b.t - a.t);
  $('#tabSpN').textContent = all.length;
  const box = $('#latest');
  if (all.length && !$('#paneSp').classList.contains('hide')) {        // no scrolling: show as many as fit, newest first, then "and N more"
    const row = (s) => `<p><b>${gdot(s.group)}${esc(s.common)}</b><span>${Math.round(s.best * 100)}% sure${s.count > 1 ? ', ' + s.count + ' calls' : ''}</span></p>`;
    let n = all.length;
    box.innerHTML = all.map(row).join('');
    while (n > 1 && box.scrollHeight > box.clientHeight + 1) {
      n--; box.innerHTML = all.slice(0, n).map(row).join('') + `<p class="muted"><span>and ${all.length - n} more, listed when you finish</span></p>`;
    }
  }
  if (!$('#paneMap').classList.contains('hide')) drawMap($('#map'), w.track, Object.values(w.species));
  checkpoint();
  if (S.settings.voice && S.settings.every && !w.paused && Date.now() - lastSpoken > S.settings.every * 60000) { lastSpoken = Date.now(); speak(walkStatus(true)); }
}
const ICON = {
  mic: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  pause: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  stop: '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  say: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>'
};
let stopArmed = null;
function stopPressed() {                    // two taps to finish, so a brush in a pocket can't end the walk
  const b = $('#finish'), l = $('#finishLbl');
  if (stopArmed) { clearTimeout(stopArmed); stopArmed = null; finishWalk(); return; }
  b.classList.add('armed'); l.textContent = 'Tap again to finish'; b.setAttribute('aria-label', 'Tap again to finish the walk');
  buzz(80); tell('Tap Stop again to finish the walk.');
  stopArmed = setTimeout(() => { stopArmed = null; if ($('#finish')) { b.classList.remove('armed'); l.textContent = 'Stop'; b.setAttribute('aria-label', 'Stop and finish the walk'); } }, 4000);
}
function togglePause() {
  const w = S.walk; if (!w) return;
  if (!w.paused) { w.paused = true; w.pausedAt = Date.now(); audio.ctx.suspend(); }
  else { w.pausedMs += Date.now() - w.pausedAt; w.paused = false; w.anchors.push({ audioSec: w.sentSec, wall: Date.now() }); audio.ctx.resume(); }
  const pb = $('#pause'); pb.innerHTML = w.paused ? ICON.play : ICON.pause; pb.setAttribute('aria-label', w.paused ? 'Resume' : 'Pause');
  $('#pauseLbl').textContent = w.paused ? 'Resume' : 'Pause'; updateWalk();
  buzz(w.paused ? 200 : [100, 60, 100]);
  checkpoint(true);
  say(w.paused ? 'paused' : 'resumed', []);
}
async function finishWalk() {
  const w = S.walk; if (!w) return;
  if (w.paused) togglePause();
  w.active = false; w.end = Date.now();
  clearInterval(tick);
  $('#walkBtns').classList.add('hide'); $('#finishBox').classList.remove('hide');
  say('finishing', []);
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
  saveWalk(w); clearCheckpoint();
  S.lastWalk = w; S.walk = null;
  go('results-' + w.id);
  buzz([400, 100, 400]);
  const top = Object.values(w.species).sort((a, b) => b.count - a.count), n = top.length, more = Math.max(0, n - 8);
  setTimeout(() => {
    announce(E('finished', n, top.slice(0, 8).map((s) => E('item', s.common, Math.round(s.best * 100))).join(', '), more));
    speak(P('finished', n, top.slice(0, 8).map((s) => P('item', nm(s), Math.round(s.best * 100))).join(', '), more));
  }, 700);
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
    walker: (w.walker != null ? w.walker : S.settings.name) || null, km: +km(w.track).toFixed(2), humanWindowsRemoved: w.humanWindows, geoFilter: w.geoUsed,
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
let resTab = 'species';
function renderResults(id) {
  const w = S.walks.find((x) => x.id === id);
  if (!w) { view.innerHTML = '<p class="empty">That walk is no longer on this phone.</p>'; return; }
  if (!CLIPS[id] || !CLIPS[id]._loaded) loadClips(id).then((m) => { m._loaded = true; if (location.hash === '#results-' + id && Object.keys(m).length > 1) renderResults(id); });
  const groups = ['All'].concat([...new Set(w.species.map((s) => s.group))]).concat(w.species.some((s) => s.review) ? ['Under review'] : []);
  if (!groups.includes(resFilter)) resFilter = 'All';
  const list = w.species.filter((s) => resFilter === 'All' || (resFilter === 'Under review' ? s.review : s.group === resFilter));
  const d = new Date(w.start);
  const clipFor = (s) => (CLIPS[id] || {})[s.sci] || null;
  const nRev = w.species.filter((s) => s.review).length;
  view.innerHTML = `
    <div class="reshead"><div>
      <h1>${plural(w.species.length, 'species', 'species')} heard</h1>
      <p class="muted">${esc(w.routeName)}, ${esc(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}. ${fmt(w.end - w.start)}, ${w.km.toFixed(1)} km${w.demo ? '. Demo sample data' : ''}${w.humanWindowsRemoved ? `. ${w.humanWindowsRemoved} stretches with voices discarded` : ''}.</p></div>
      ${w.species.length ? `<button class="vcbtn round" id="readAll" aria-label="Read the bird list aloud">${ICON.say}</button>` : ''}
    </div>
    <div class="tabs noprint" role="tablist" aria-label="Walk results">
      <button class="tab" role="tab" id="rtabSp" aria-controls="rpaneSp" aria-selected="${resTab === 'species'}">Species <span>${w.species.length}</span></button>
      <button class="tab" role="tab" id="rtabMap" aria-controls="rpaneMap" aria-selected="${resTab === 'map'}">Map</button>
    </div>
    <div class="pane${resTab === 'map' ? ' hide' : ''}" id="rpaneSp" role="tabpanel" aria-labelledby="rtabSp">
      ${groups.length > 2 || nRev ? `<div class="chips noprint" role="group" aria-label="Show only">${groups.map((g) => `<button class="chip" data-f="${esc(g)}" aria-pressed="${g === resFilter}">${esc(g)} ${g === 'All' ? w.species.length : g === 'Under review' ? nRev : w.species.filter((s) => s.group === g).length}</button>`).join('')}</div>` : ''}
      <div class="splist">
      ${list.length ? list.map((s, k) => {
        const c = clipFor(s);
        return `<div class="sp" role="group" aria-label="${esc(s.common)}, ${s.review ? 'under review' : Math.round(s.best * 100) + ' percent sure'}, ${plural(s.count, 'call')}">
          <button class="play" data-play="${k}" ${c ? '' : 'disabled'} aria-label="${c ? 'Play recording of ' + esc(s.common) : 'No recording kept'}"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
          <div class="nm"><b>${gdot(s.group)}${esc(s.common)}</b><i lang="la">${esc(s.sci)}</i></div>
          <div class="rt"><span class="pill ${s.review ? 'rev' : ''}">${s.review ? 'Review' : Math.round(s.best * 100) + '%'}</span><span>${s.count} ${s.count === 1 ? 'call' : 'calls'}</span></div>
        </div>`;
      }).join('') : `<p class="empty">${w.species.length ? 'Nothing in this group.' : 'No birds were identified on this walk.'}</p>`}
      </div>
    </div>
    <div class="pane${resTab === 'map' ? '' : ' hide'}" id="rpaneMap" role="tabpanel" aria-labelledby="rtabMap"><div class="map" id="rmap" aria-hidden="true"></div></div>
    <div class="resfoot noprint">
      ${w.submitted ? '' : `<div class="fields2">
        <label class="f">Walk name<input id="rName" maxlength="60" value="${esc(w.routeName)}"></label>
        <label class="f">Your name<input id="rWalker" maxlength="60" autocomplete="name" placeholder="Optional" value="${esc(w.walker || '')}"></label>
      </div>`}
      ${C.uploadUrl ? (w.submitted ? '<p class="banner small">Sent to TNS on ' + esc(new Date(w.submitted).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '.</p>' + (!w.clipsDone && !w.demo && S.settings.sendClips ? '<button class="btn alt small" id="resendClips">Send the sound clips now</button>' : '') : '<button class="btn" id="submit">' + (w.demo ? 'Submit to TNS (marked as demo)' : 'Submit to TNS') + '</button>') : '<p class="muted">Submitting to TNS turns on once the TNS server address is set in config.js.</p>'}
      <details class="more"><summary>Download or delete this walk</summary>
        <div class="row"><button class="btn alt small" id="dlJson" aria-label="Download walk data">Walk data (JSON)</button><button class="btn alt small" id="dlGpx" aria-label="Download route as GPX">Route (GPX)</button></div>
        <button class="linkish danger" id="del">Delete this walk from the phone</button>
      </details>
    </div>`;
  const showRes = (t) => {
    resTab = t;
    $('#rtabSp').setAttribute('aria-selected', t === 'species'); $('#rtabMap').setAttribute('aria-selected', t === 'map');
    $('#rpaneSp').classList.toggle('hide', t !== 'species'); $('#rpaneMap').classList.toggle('hide', t !== 'map');
    if (t === 'map') drawMap($('#rmap'), w.track, w.species);
  };
  $('#rtabSp').addEventListener('click', () => showRes('species'));
  $('#rtabMap').addEventListener('click', () => showRes('map'));
  const mo = view.querySelector('details.more');
  mo.addEventListener('toggle', () => { const f = view.querySelector('.resfoot'); if (mo.open) f.classList.add('open'); else f.classList.remove('open'); });
  if (resTab === 'map') drawMap($('#rmap'), w.track, w.species);
  view.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    resFilter = b.dataset.f; renderResults(id);
    const again = view.querySelector(`[data-f="${CSS.escape(resFilter)}"]`); if (again) again.focus();
    announce('Showing ' + (resFilter === 'All' ? 'all species' : resFilter) + ': ' + view.querySelectorAll('.sp').length + '.');
  }));
  const ra = $('#readAll');
  if (ra) ra.addEventListener('click', () => {
    const sorted = w.species.slice().sort((a, b) => b.count - a.count);
    const t = (f, name) => f('list', sorted.length, sorted.map((s) => f('listItem', name(s), Math.round(s.best * 100), s.count, s.review)).join('. '));
    if ('speechSynthesis' in window) { speechSynthesis.cancel(); speak(t(P, nm), true); } else announce(t(E, (s) => s.common), true);
  });
  view.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => {
    const c = clipFor(list[+b.dataset.play]); if (!c) return;
    if (player) { player.pause(); URL.revokeObjectURL(player.src); }
    player = new Audio(URL.createObjectURL(c)); player.play().catch(() => {});
  }));
  $('#dlJson').addEventListener('click', () => download(`tns-walk-${w.id}.json`, JSON.stringify(w, null, 1), 'application/json'));
  $('#dlGpx').addEventListener('click', () => download(`tns-walk-${w.id}.gpx`, gpx(w), 'application/gpx+xml'));
  $('#del').addEventListener('click', () => { S.walks = S.walks.filter((x) => x.id !== id); store.set('tnsWalks', S.walks); deleteClips([id]); go('history'); });
  const rc = $('#resendClips');
  if (rc) rc.addEventListener('click', async () => {
    rc.disabled = true;
    const r = await uploadClips(w, (n, t) => { rc.textContent = `Sending sound clips ${n + 1} of ${t}…`; });
    rc.textContent = r.error ? `${r.sent} of ${r.total} clips sent: ${r.error}. Tap to try again.` : 'Sound clips sent to TNS.'; rc.disabled = !r.error;
    announce(rc.textContent);
  });
  const rn = $('#rName'), rw = $('#rWalker');
  if (rn) rn.addEventListener('change', () => { w.routeName = rn.value.trim().slice(0, 60) || ANYWHERE.name; store.set('tnsWalks', S.walks); announce('Walk name saved.'); });
  if (rw) rw.addEventListener('change', () => { w.walker = rw.value.trim().slice(0, 60) || null; if (w.walker) { S.settings.name = w.walker; saveSettings(); } store.set('tnsWalks', S.walks); announce('Name saved.'); });
  const sub = $('#submit');
  if (sub) sub.addEventListener('click', async () => {
    sub.disabled = true; sub.textContent = 'Sending…'; announce('Sending to TNS.');
    try {
      // text/plain keeps this a "simple" request, which Google Apps Script accepts from any website
      const r = await fetch(C.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(w) });
      let j = {}; try { j = await r.json(); } catch (e) {}
      if (r.ok && j.ok !== false) {
        w.submitted = Date.now(); store.set('tnsWalks', S.walks);
        const done = j.duplicate ? 'Already sent to TNS' : 'Sent to TNS. Thank you!';
        if (S.settings.sendClips && !w.demo) {
          uploading = true;
          const c = await uploadClips(w, (n, t) => { sub.textContent = `Walk sent. Sending sound clips ${n + 1} of ${t}…`; });
          uploading = false;
          sub.textContent = c.error ? `${done} ${c.sent} of ${c.total} sound clips sent (${c.error}). They will be tried again later.` : c.total ? `${done} ${c.total} sound ${c.total === 1 ? 'clip' : 'clips'} included.` : done;
        } else sub.textContent = done;
        announce(sub.textContent); speak(P('sent')); buzz(200);
      } else { sub.textContent = 'Not sent: ' + (j.error || 'server said ' + r.status) + '. Tap to retry.'; sub.disabled = false; announce(sub.textContent, true); speak(P('notSent')); }
    } catch (e) { sub.textContent = 'Not sent: no connection. Tap to retry later.'; sub.disabled = false; announce(sub.textContent, true); speak(P('notSent')); }
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
    ${path ? `<path d="${path}" fill="none" style="stroke:var(--track)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${pts.length ? `<circle cx="${X(pts[0])}" cy="${Y(pts[0])}" r="6" style="fill:var(--sheet);stroke:var(--track)" stroke-width="3"/><circle cx="${X(pts[pts.length - 1])}" cy="${Y(pts[pts.length - 1])}" r="7" style="fill:var(--track);stroke:var(--sheet)" stroke-width="3"/>` : ''}
    ${sp.map((s) => `<circle cx="${X(s)}" cy="${Y(s)}" r="7" style="fill:${s.review ? 'var(--sheet)' : 'var(--dot)'};stroke:var(--dotStroke)" stroke-width="2"><title>${esc(s.common)}</title></circle>`).join('')}
  </svg><span class="note">${pts.length ? plural(pts.length, 'GPS point') : 'No GPS fix yet'}, ${sp.length} placed</span>`;
}

/* ---------- history ---------- */
function renderHistory() {
  view.innerHTML = `<h1>Walks</h1>
    <p class="muted">No walk is running. Tap the microphone on Home to start one${VOICE.ok && S.settings.voiceCmd ? ', or say “Start walk”' : ''}.</p>
    ${S.walks.length ? '<div class="list">' + S.walks.map((w) => `
      <button class="route" data-id="${esc(w.id)}" aria-label="${esc(w.routeName)}, ${esc(new Date(w.start).toLocaleString('en-IN', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }))}, ${w.km.toFixed(1)} kilometres, ${plural(w.species.length, 'species', 'species')}${w.demo ? ', demo' : ''}">
        <span class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="color:var(--forest)"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
        <span style="flex:1"><b>${esc(w.routeName)}</b><span class="muted">${esc(new Date(w.start).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}, ${w.km.toFixed(1)} km</span></span>
        <span class="tag">${plural(w.species.length, 'species', 'species')}${w.demo ? ', demo' : ''}</span>
      </button>`).join('') + '</div>' : '<p class="empty">No walks yet. Start one from Home.</p>'}`;
  view.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => go('results-' + b.dataset.id)));
}

/* ---------- share & settings ---------- */
function qrSvg(text, cell) {
  if (typeof qrcode === 'undefined') return '<p class="muted">QR codes need an internet connection the first time.</p>';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell || 6, margin: 2, scalable: true });
}
const PF = {   // Profile pages: key → [title, parent]
  'profile': ['Profile', null],
  'profile-settings': ['Settings', 'profile'],
  'profile-credits': ['Credits', 'profile'],
  'profile-look': ['Look', 'profile-settings'],
  'profile-speech': ['Listening and speech', 'profile-settings'],
  'profile-voice': ['Voice commands', 'profile-settings'],
  'profile-walks': ['Your walks', 'profile-settings'],
  'profile-org': ['For TNS organisers', 'profile-settings'],
};
const CHEV = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const navRow = (to, title, sub) => `<button class="navrow" data-pf="${to}"><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${CHEV}</button>`;
async function renderMore(page) {
  page = PF[page] ? page : 'profile';
  const [title, parent] = PF[page];
  const on = (k) => (k === page ? '' : ' hide');
  const base = location.origin + location.pathname;
  view.innerHTML = `
    <div class="pfhead noprint">${parent ? `<button class="iconbtn" id="pfBack" aria-label="Back to ${PF[parent][0]}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>` : ''}<h1>${title}</h1></div>
    <div class="pfpage${on('profile')}">
    <section class="card profile noprint">
      <span class="avatar" aria-hidden="true">${esc((S.settings.name || 'W').trim().charAt(0).toUpperCase())}</span>
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <label class="f">Your name<input id="nm" value="${esc(S.settings.name)}" autocomplete="name" placeholder="Shown on the TNS dashboard"></label>
        <p class="muted">${(() => { const sp = new Set(); let k = 0; S.walks.forEach((w) => { k += w.km || 0; w.species.forEach((x) => sp.add(x.sci)); }); return `${plural(S.walks.length, 'walk')}, ${plural(sp.size, 'species', 'species')} and ${k.toFixed(1)} km on this phone.`; })()}</p>
      </div>
    </section>
    <div class="group noprint">${navRow('profile-settings', 'Settings', 'Style, speech, voice commands, sound clips, QR codes')}${navRow('profile-credits', 'Credits', 'App version, bird model and acknowledgements')}</div>
    </div>
    <div class="pfpage${on('profile-settings')}">
    <div class="group noprint">${navRow('profile-look', 'Look', THEMES[themeNow()])}${navRow('profile-speech', 'Listening and speech', S.settings.voice ? 'Spoken mode on' : 'Spoken mode off')}${navRow('profile-voice', 'Voice commands', S.settings.voiceCmd ? 'On' : 'Off')}${navRow('profile-walks', 'Your walks', 'Sound clips, microphone, confidence')}${navRow('profile-org', 'For TNS organisers', 'QR codes and new places')}</div>
    <button class="linkish danger noprint" id="clear">Delete all walks on this phone</button>
    </div>
    <div class="pfpage${on('profile-look')}">
    <div class="group noprint">
      <label class="f">App style
        <select id="aTheme">${Object.entries(THEMES).map(([k, v]) => `<option value="${k}" ${S.settings.theme === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div></div>
    <div class="pfpage${on('profile-speech')}">
    <div class="group noprint">
      <label class="toggle"><input type="checkbox" id="aVoice" ${S.settings.voice ? 'checked' : ''}><span>Spoken mode<small>Says each new bird, gives walk updates and reads the results. Works alongside TalkBack.</small></span></label>
      <label class="f">Voice language
        <select id="aLang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${lang() === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <span class="muted hide" id="aLangMsg" style="font-weight:400"></span></label>
      <label class="f">Spoken walk update
        <select id="aEvery"><option value="0">Never, birds only</option>${[5, 10, 15, 20].map((n) => `<option value="${n}" ${S.settings.every === n ? 'selected' : ''}>Every ${n} minutes</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" id="aRepeat" ${S.settings.repeat ? 'checked' : ''}><span>Say a bird again when it calls later<small>At most once every 5 minutes for each bird.</small></span></label>
      <label class="toggle"><input type="checkbox" id="aBuzz" ${S.settings.buzz ? 'checked' : ''}><span>Vibrate<small>Two short buzzes for a new bird, one long buzz at the start and end of a walk.</small></span></label>
      <label class="toggle"><input type="checkbox" id="aBig" ${S.settings.big ? 'checked' : ''}><span>Larger text and buttons</span></label>
      <label class="toggle"><input type="checkbox" id="aHc" ${S.settings.hc ? 'checked' : ''}><span>High contrast</span></label>
      <div><button class="linkish" id="aTest">Test the voice</button></div>
    </div></div>
    <div class="pfpage${on('profile-voice')}">
    <div class="group noprint">
      ${VOICE.ok ? `<label class="toggle"><input type="checkbox" id="aVoiceCmd" ${S.settings.voiceCmd ? 'checked' : ''}><span>Start and stop the walk by voice<small>Say “Start walk” to start and “Stop walk” to finish. “Walk status” tells you the time, distance and birds so far. The phone keeps listening while this is on.</small></span></label>` : '<p class="muted">This phone’s browser does not offer speech recognition, so voice commands are not available. Chrome on Android does.</p>'}
    </div>
    <h2>Check voice commands</h2>
    <p class="muted">Tap the button, then say “Start walk”. Nothing starts during the check. The list shows what the phone heard, newest first. If voice commands don’t work, send TNS a screenshot of this list.</p>
    <button class="btn alt small" id="vcTest">Check now (10 seconds)</button>
    <pre class="vclog" id="vcLog" aria-live="polite">${esc(VOICE.log.slice().reverse().join('\n') || 'Nothing recorded yet.')}</pre>
    </div>
    <div class="pfpage${on('profile-walks')}">
    <div class="group noprint">
      <label class="toggle"><input type="checkbox" id="sClips" ${S.settings.sendClips ? 'checked' : ''}><span>Send sound clips to TNS<small>One 3-second clip per bird, so experts can check it. About 2 MB per walk. Human voices are never included.</small></span></label>
      <label class="f">Microphone<select id="mic"><option value="">Phone's built-in mic</option></select></label>
      <label class="f"><span>Minimum confidence <span id="mcv" class="muted" aria-hidden="true" style="font-weight:400">${Math.round(S.settings.minConfidence * 100)}%</span></span><input type="range" id="mc" min="0.1" max="0.9" step="0.05" value="${S.settings.minConfidence}" aria-valuetext="${Math.round(S.settings.minConfidence * 100)} percent"></label>
      <div><a class="linkish" href="dashboard.html" target="_blank" rel="noopener">Open the community dashboard</a></div>
    </div></div>
    <div class="pfpage${on('profile-org')}">
    <p class="muted noprint">The QR icon at the top shows the sharing code at any time. These are for printing.</p>
    <div class="qr"><div>${qrSvg(base, 6)}</div><b>Scan to open TNS Bird Walk</b><span class="muted" style="word-break:break-all">${esc(base)}</span></div>
    <h2>Accessible walk QR codes</h2>
    <p class="muted">Scanning opens the app with spoken mode, vibration and large text on. Put a tactile sticker or Braille label on each printed code so it can be found by touch.</p>
    <div class="qrs"><div class="qr">${qrSvg(base + '#access', 4)}<b style="font-size:15px">Spoken mode, any place</b></div>${C.routes.map((r) => `<div class="qr">${qrSvg(base + '#access-' + r.id, 4)}<b style="font-size:15px">Spoken mode, ${esc(r.name)}</b></div>`).join('')}</div>
    ${C.routes.length ? `<h2>Route QR codes</h2>
    <p class="muted">Put each one at its start point. Scanning opens the app with that route picked.</p>
    <div class="qrs">${C.routes.map((r) => `<div class="qr">${qrSvg(base + '#route-' + r.id, 4)}<b style="font-size:15px">${esc(r.name)}</b></div>`).join('')}</div>` : ''}
    ${S.places.length ? `<h2>Place QR codes</h2><div class="qrs">${S.places.map((p) => `<div class="qr">${qrSvg(placeLink(base, p), 4)}<b style="font-size:15px">${esc(p.name)}</b><button class="linkish danger noprint" data-delplace="${esc(p.id)}">Remove</button></div>`).join('')}</div>` : ''}
    <h2 class="noprint">Enable a new place</h2>
    <div class="group noprint">
      <p class="muted">Anyone who scans the new place's QR code gets it on their Home screen with the walk name filled in. Stand at the place and tick the box to save its location too.</p>
      <label class="f">Place name<input id="plName" maxlength="60" placeholder="e.g. Talakona waterfall trail"></label>
      <label class="toggle"><input type="checkbox" id="plHere"><span>Use my current location as the start point</span></label>
      <button class="btn small" id="plAdd">Create QR code</button>
      <p class="muted hide" id="plMsg"></p>
    </div>
    <button class="btn alt small noprint" id="print">Print QR codes</button>
    </div>
    <div class="pfpage${on('profile-credits')}">
    <div class="group noprint">
      <p><b>TNS Bird Walk ${APP_VERSION}</b><br><span class="muted">${plural((C.routes || []).length, 'fixed route')} set in config.js</span></p>
      <p><b>Bird model</b><br><span class="muted">${esc(modelText())}</span></p>
      <p class="muted">Sound identification by BirdNET+ V3.0 (Lasseck, Eibl, Klinck &amp; Kahl, 2026), Chemnitz University of Technology, Museum für Naturkunde Berlin and the K. Lisa Yang Center for Conservation Bioacoustics, Cornell Lab of Ornithology. Model weights: Apache License 2.0. <a href="https://doi.org/10.5281/zenodo.24362980">doi.org/10.5281/zenodo.24362980</a></p>
      <p class="muted">Built on BirdNET Live: Kahl, S., Börner, A., Mauermann, M., Seifert, R. C., Lasseck, M., Verdon, S., Wilhelm-Stein, T., Wood, C. M., Eibl, M., Müller, J. &amp; Klinck, H. (2026). <i>BirdNET Live app – Professional bioacoustics in your pocket.</i> <a href="https://github.com/birdnet-team/birdnet-live-app">github.com/birdnet-team/birdnet-live-app</a></p>
      <p class="muted">App by Tirupati Nature Society.</p>
    </div></div>`;
  view.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => go(b.dataset.pf)));
  const bk = $('#pfBack'); if (bk) bk.addEventListener('click', () => go(parent));
  $('#print').addEventListener('click', () => window.print());
  $('#aTheme').addEventListener('change', (e) => { S.settings.theme = e.target.value; saveSettings(); announce('Style changed to ' + THEMES[e.target.value] + '.'); });
  const vc = $('#aVoiceCmd'); if (vc) vc.addEventListener('change', (e) => setVoiceCmd(e.target.checked));
  const vt = $('#vcTest'); if (vt) vt.addEventListener('click', voiceTest);
  if (S.settings.every === 0) $('#aEvery').value = '0';
  const tg = (id, key, msg) => $(id).addEventListener('change', (e) => { S.settings[key] = e.target.checked; saveSettings(); announce(msg + (e.target.checked ? ' on.' : ' off.')); if (key === 'buzz' && e.target.checked) buzz([120, 80, 120]); });
  tg('#aVoice', 'voice', 'Spoken mode'); tg('#aBuzz', 'buzz', 'Vibration'); tg('#aBig', 'big', 'Larger text'); tg('#aHc', 'hc', 'High contrast'); tg('#aRepeat', 'repeat', 'Repeat birds');
  $('#aEvery').addEventListener('change', (e) => { S.settings.every = +e.target.value; saveSettings(); });
  const langMsg = () => { const m = $('#aLangMsg'); const ok = hasVoice(); m.classList.toggle('hide', ok);
    m.textContent = ok ? '' : 'This phone has no ' + LANGS[lang()].split(' ').pop() + ' voice yet. Open phone Settings → Text-to-speech → Google → Install voice data, and download it.'; };
  langMsg();
  $('#aLang').addEventListener('change', async (e) => { S.settings.lang = e.target.value; saveSettings(); await loadNames(lang()); langMsg(); speak(P('item', nm({ sci: 'Eudynamys scolopaceus', common: 'Asian Koel' }), 85), true); });
  $('#aTest').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) { announce('This phone has no voice for the app. TalkBack still works.', true); return; }
    speechSynthesis.cancel();
    speak(P('bird', P('item', nm({ sci: 'Pycnonotus jocosus', common: 'Red-whiskered Bulbul' }), 85), 3), true);
  });
  view.querySelectorAll('[data-delplace]').forEach((b) => b.addEventListener('click', () => {
    S.places = S.places.filter((p) => p.id !== b.dataset.delplace); store.set('tnsPlaces', S.places);
    if (S.route === b.dataset.delplace) S.route = null;
    renderMore(page);
  }));
  $('#plAdd').addEventListener('click', () => {
    const name = $('#plName').value.trim(), msg = $('#plMsg');
    msg.classList.remove('hide');
    if (!name) { msg.textContent = 'Type a place name first.'; return; }
    const done = (lat, lon) => { const p = addPlace(name, lat, lon); if (p) S.route = p.id; renderMore(page); };
    if ($('#plHere').checked && 'geolocation' in navigator) {
      msg.textContent = 'Getting your location…';
      navigator.geolocation.getCurrentPosition((pos) => done(pos.coords.latitude, pos.coords.longitude),
        () => { msg.textContent = 'Location not available, so the place was saved without it.'; setTimeout(() => done(null, null), 1200); },
        { enableHighAccuracy: true, timeout: 15000 });
    } else done(null, null);
  });
  $('#sClips').addEventListener('change', (e) => { S.settings.sendClips = e.target.checked; saveSettings(); announce('Sound clips ' + (e.target.checked ? 'on.' : 'off.')); });
  $('#nm').addEventListener('change', (e) => { S.settings.name = e.target.value.trim(); store.set('tnsSettings', S.settings); });
  $('#mc').addEventListener('input', (e) => { S.settings.minConfidence = +e.target.value; $('#mcv').textContent = Math.round(+e.target.value * 100) + '%'; e.target.setAttribute('aria-valuetext', Math.round(+e.target.value * 100) + ' percent'); store.set('tnsSettings', S.settings); });
  $('#clear').addEventListener('click', () => { if ($('#clear').dataset.sure) { deleteClips(S.walks.map((x) => x.id)); S.walks = []; store.set('tnsWalks', []); renderMore(page); } else { $('#clear').dataset.sure = '1'; $('#clear').textContent = 'Tap again to delete all walks'; } });
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
if (!INSTALLED) {
  /* QR codes for spoken mode or a place still work: their settings are saved now and used once the app is installed */
  const gh = location.hash.slice(1);
  if (gh === 'access' || gh.startsWith('access-')) { Object.assign(S.settings, { voice: true, buzz: true, big: true, voiceCmd: VOICE.ok }); saveSettings(); }
  if (gh.startsWith('place-')) { try { const [n, ll] = decodeURIComponent(gh.slice(6)).split('~'); const [a, b] = (ll || '').split(',').map(Number); addPlace(n, isFinite(a) ? a : null, isFinite(b) ? b : null); } catch (e) {} }
  renderGate();
} else {
loadNames(lang());
readPermissions();
if (S.settings.voiceCmd) voiceListen();
S.recover = store.get(LIVE, null);
if (S.recover && !(S.recover.track && S.recover.start)) { S.recover = null; clearCheckpoint(); }
setTimeout(() => { pruneClips(); retryClips(); }, 4000);
if (S.recover) setTimeout(() => tell('Your walk was interrupted, but it was saved. Continue this walk, or finish and see the results.', true), 1200);
startWorker();
route();
}
}

/* re-fit after any direct redraw of Home or Walk (voice toggle, install prompt, spoken mode) */
renderHome = ((f) => function () { f.apply(this, arguments); fitView(); })(renderHome);
renderWalk = ((f) => function () { f.apply(this, arguments); fitView(); })(renderWalk);
renderResults = ((f) => function () { f.apply(this, arguments); fitView(); })(renderResults);
