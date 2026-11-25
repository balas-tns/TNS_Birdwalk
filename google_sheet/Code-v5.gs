/**
 * TNS Bird Walk – collector for walks submitted from the app.
 * Paste this whole file into Extensions > Apps Script of a Google Sheet, then deploy as a web app
 * (see SETUP-DASHBOARD.md). It creates three tabs: Walks, Species and Detections.
 *
 * POST (from the app):        a walk as JSON  -> saved, duplicates ignored
 * POST {action:'review',...}: confirm or reject a species record (needs the reviewer key)
 * GET  ?action=data:          everything the dashboard needs, as JSON
 */

const SHEETS = {
  Walks: ['walk_id', 'received_at', 'start', 'end', 'route_id', 'place', 'walker', 'km', 'species_count',
          'demo', 'model', 'human_stretches_removed', 'location_filter', 'start_lat', 'start_lon', 'track_json'],
  Species: ['walk_id', 'start', 'place', 'walker', 'common', 'sci', 'group', 'calls', 'best_confidence',
            'flagged', 'status', 'lat', 'lon', 'location_estimated', 'first_heard', 'reviewed_at'],
  Detections: ['walk_id', 'time', 'common', 'sci', 'confidence', 'lat', 'lon', 'accuracy_m', 'location_estimated']
};

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SHEETS[name].length).setFontWeight('bold').setBackground('#E3EEE7');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function iso_(ms) { return ms ? new Date(Number(ms)).toISOString() : ''; }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Not valid JSON' }); }
  if (body.action === 'review') return review_(body);
  return saveWalk_(body);
}

function saveWalk_(w) {
  if (!w || !w.id || !Array.isArray(w.species)) return json_({ ok: false, error: 'Missing walk data' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const walks = sheet_('Walks');
    const id = String(w.id);
    const found = walks.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
    if (found) return json_({ ok: true, duplicate: true });

    const place = String(w.routeName || '').slice(0, 80);
    const walker = String(w.walker || '').slice(0, 60);
    const start = iso_(w.start), track = Array.isArray(w.track) ? w.track : [];
    let trackJson = JSON.stringify(track.map(function (p) { return [p.lat, p.lon]; }));
    if (trackJson.length > 45000) trackJson = trackJson.slice(0, 45000);
    walks.appendRow([id, new Date().toISOString(), start, iso_(w.end), String(w.route || ''), place, walker,
      Number(w.km) || 0, w.species.length, !!w.demo, String(w.model || ''), Number(w.humanWindowsRemoved) || 0,
      !!w.geoFilter, track[0] ? track[0].lat : '', track[0] ? track[0].lon : '', trackJson]);

    const sp = w.species.map(function (s) {
      return [id, start, place, walker, String(s.common || ''), String(s.sci || ''), String(s.group || ''),
        Number(s.count) || 0, Number(s.best) || 0, !!s.review, s.review ? 'needs review' : 'accepted',
        s.lat == null ? '' : s.lat, s.lon == null ? '' : s.lon, !!s.estimated, iso_(s.firstHeard), ''];
    });
    if (sp.length) { const sh = sheet_('Species'); sh.getRange(sh.getLastRow() + 1, 1, sp.length, sp[0].length).setValues(sp); }

    const det = (Array.isArray(w.detections) ? w.detections : []).slice(0, 3000).map(function (d) {
      return [id, iso_(d.t), String(d.common || ''), String(d.sci || ''), Number(d.score) || 0,
        d.lat == null ? '' : d.lat, d.lon == null ? '' : d.lon, d.acc == null ? '' : d.acc, !!d.estimated];
    });
    if (det.length) { const sh = sheet_('Detections'); sh.getRange(sh.getLastRow() + 1, 1, det.length, det[0].length).setValues(det); }

    return json_({ ok: true, species: sp.length });
  } finally {
    lock.releaseLock();
  }
}

function review_(b) {
  const key = PropertiesService.getScriptProperties().getProperty('REVIEW_KEY');
  if (!key || b.key !== key) return json_({ ok: false, error: 'Wrong reviewer key' });
  if (['accepted', 'confirmed', 'rejected', 'needs review'].indexOf(b.status) < 0) return json_({ ok: false, error: 'Unknown status' });
  const sh = sheet_('Species');
  const rows = sh.getDataRange().getValues();
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][0]) === String(b.walk_id) && String(rows[r][5]) === String(b.sci)) {
      sh.getRange(r + 1, 11).setValue(b.status);
      sh.getRange(r + 1, 16).setValue(new Date().toISOString());
      return json_({ ok: true });
    }
  }
  return json_({ ok: false, error: 'Record not found' });
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'data';
  if (action !== 'data') return json_({ ok: false, error: 'Unknown action' });
  const read = function (name, cols, limit) {
    const sh = sheet_(name);
    const last = sh.getLastRow();
    if (last < 2) return [];
    const from = Math.max(2, last - limit + 1);
    return sh.getRange(from, 1, last - from + 1, cols.length).getValues().map(function (row) {
      const o = {};
      cols.forEach(function (c, i) { o[c] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
      return o;
    });
  };
  const walks = read('Walks', SHEETS.Walks.slice(0, 15), 3000);      // track_json left out to keep it light
  const species = read('Species', SHEETS.Species, 20000);
  return json_({ ok: true, updated: new Date().toISOString(), walks: walks, species: species });
}
