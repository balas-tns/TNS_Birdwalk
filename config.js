// TNS Bird Walk – settings you can change without touching the app code.
// Edit this file, upload it with the rest of the app, and reload.
window.TNS_CONFIG = {
  appName: 'TNS Bird Walk',

  // BirdNET+ V3.0 files from https://zenodo.org/records/24362980
  // Use the "BirdNET Live bundle" (on-device FP16 ONNX audio model, geomodel and labels).
  // Put them in the /model folder and keep these names, or change the paths here.
  model: {
    audioModelUrl: 'model/audio.onnx',
    geoModelUrl: 'model/geo.onnx',      // optional; set to null to switch off the location filter
    labelsUrl: 'model/labels.csv',
    sampleRate: 32000,                   // BirdNET+ V3.0 takes mono 32 kHz audio
    windowSeconds: 3,                    // the model was trained on 3 s chunks (best accuracy and timing).
                                         // 5 or 10 also work: fewer, longer chunks, so less work on slow
                                         // phones, but coarser timing and locations for each detection.
    commonNameColumn: null,              // e.g. 'en' or 'common_name'; null = pick automatically
    groupColumn: null                    // e.g. 'class'; null = pick automatically
  },

  // Detection rules
  minConfidence: 0.5,      // ignore detections below this
  reviewBelow: 0.7,        // flag detections below this for expert review
  geoThreshold: 0.03,      // species the geomodel rates below this are flagged as unexpected

  // When the model files are missing, show clearly-marked sample results so the
  // app can still be tried end to end. Set to false for the real programme.
  demoIfNoModel: true,

  // Where "Submit to TNS" sends a walk, and where the dashboard reads from.
  // Paste the Google Apps Script web app address here (it ends in /exec), in quotes:
  //   // Dashboard map style (MapLibre). Default: OpenFreeMap 'liberty', free, no key.
  // Other free styles: https://tiles.openfreemap.org/styles/bright or .../positron
  mapStyle: 'https://tiles.openfreemap.org/styles/liberty',

  uploadUrl: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  // Leave null until it's set up; the dashboard then shows sample data.
  uploadUrl: 'https://script.google.com/macros/s/AKfycbwQpiXEyfQ38HWcZVDuKGPSVXzlKE8MtJmXRnxGJIsxPeV7atavy6vvBrcq76IUy1OGsw/exec',

  // Fixed TNS routes. Print a QR code for each one (More > Share) and put it at the start point.
  routes: [
    { id: 'kapila', name: 'Kapila Theertham foothill trail', meta: '2.4 km · about 45 min', tag: 'Hills' },
    { id: 'svu', name: 'SV University campus loop', meta: '1.8 km · about 35 min', tag: 'Campus' },
    { id: 'lake', name: 'Lake edge walk', meta: '2.0 km · about 40 min', tag: 'Wetland' }
  ]
};
