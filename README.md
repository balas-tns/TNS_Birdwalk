# TNS Bird Walk

A phone app for Tirupati Nature Society bird sound walks. Walkers scan a QR code, the app opens in Chrome, and they can install it like any other app. During the walk it listens through the phone's microphone, logs the GPS route, and identifies birds, frogs and other wildlife with **BirdNET+ V3.0**. Everything runs on the phone, so it works on paths with no signal once it has been opened once.

## What's in this folder

| File | What it does |
| --- | --- |
| `index.html` | The app's screens and look |
| `app.js` | Walk recording, GPS, results, history, QR codes, settings |
| `worker.js` | Runs the BirdNET+ V3.0 model in the background (ONNX Runtime Web) |
| `config.js` | Routes, thresholds, model file names, TNS server address. **Edit this, not the code.** |
| `sw.js` | Lets the app open and work offline after the first visit |
| `manifest.webmanifest`, `icons/` | Makes it installable on Android, with its own icon |
| `model/` | Put the BirdNET+ V3.0 files here (see below) |

## Step 1: Add the BirdNET+ V3.0 model

1. Open <https://zenodo.org/records/24362980> and download only **`BirdNET+_V3.0_Global_10K_BNL.zip`** (the BirdNET Live bundle, about 70 MB).
2. Unzip it and copy these three files into the `model/` folder, renamed:

| File in the bundle | Rename to |
| --- | --- |
| `BirdNET+_V3.0_Global_10K_FP16_BNL.onnx` | `audio.onnx` |
| `BirdNET+_Geomodel_V3.0.5_Global_10K_FP16_BNL.onnx` | `geo.onnx` |
| `BirdNET+_V3.0_Global_10K_Labels.csv` | `labels.csv` |

3. The model was trained on 3-second chunks, which is the app's setting (`windowSeconds: 3` in `config.js`). 5 or 10 seconds also work if older phones fall behind during a walk, at the cost of coarser timing and locations.

Until the model is there, the app runs in **demo mode**: the walk, timer and GPS are real, and the results are clearly marked sample species. Set `demoIfNoModel: false` in `config.js` before the real programme.

The model weights are under the Apache License 2.0. Read the acceptable use policy linked on the Zenodo page, and keep the BirdNET credit shown in the app.

## Step 2: Put it online (free, about 15 minutes)

The microphone and GPS only work on a secure `https://` address, so the app needs hosting. GitHub Pages is free and enough for thousands of walkers.

1. Create a free account at <https://github.com>.
2. Click **New repository**, name it `birdwalk`, set it to **Public**, and create it.
3. Click **Add file > Upload files**, drag in everything from this folder (including `icons/` and `model/`), and click **Commit changes**.
   - GitHub refuses single files over 100 MB in the browser. The FP16 model is about 70 MB, so it fits. If you switch to a larger model, use GitHub Desktop with Git LFS, or Netlify / Cloudflare Pages instead.
4. Open **Settings > Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
5. After a minute or two the app is live at `https://YOUR-USERNAME.github.io/birdwalk/`.

Other free hosts that work the same way: Netlify (drag-and-drop the folder at app.netlify.com/drop) and Cloudflare Pages. If TNS later buys a domain such as `birdwalk.tirupatinature.org`, point it at any of these.

## Step 3: Make the QR codes

1. Open the live app, tap **Share & settings**.
2. The top QR code opens the app. Each route has its own QR code that opens the app with that route already picked.
3. Tap **Print QR codes**, or take screenshots, and put one at each route's start point and on posters and the newsletter.

## Step 4: How walkers install it on Android

1. Scan the QR code with the phone camera or Google Lens. It opens in Chrome.
2. Tap **Install the app on this phone** on the Home screen, or Chrome's menu **⋮ > Add to Home screen / Install app**.
3. The TNS Bird Walk icon appears with their other apps and opens full screen, like a normal app.
4. On the first walk, allow **Microphone** and **Location** when asked.

During a walk the screen stays on (the app asks for this). Ask walkers to keep the app open and the phone out of their pocket. Browsers pause web apps that are in the background or have the screen off.

## Optional: put it on the Google Play Store

The same app can be listed on Play without rewriting it:

1. Go to <https://www.pwabuilder.com>, enter the live app address, and choose **Package for stores > Android**.
2. It produces a signed Android package (.aab) that wraps this app (a "Trusted Web Activity").
3. Create a Google Play developer account (one-time fee), upload the .aab, add screenshots and the privacy policy, and submit for review.
4. PWABuilder also gives you an `assetlinks.json` file. Upload it to `/.well-known/` on your site so the Play app opens without a browser bar.

For a test group you can also share the .apk directly (walkers allow "Install unknown apps"), but Play is easier and safer for the public.

## Credits and citation

The app shows these credits under **Share & settings**. Keep them, and use them in the newsletter, reports and any paper that uses walk data, as the BirdNET acceptable use policy asks.

- **Model:** Lasseck, M., Eibl, M., Klinck, H. & Kahl, S. (2026). *BirdNET+ V3.0 model files* (version 3.0.1). Zenodo. <https://doi.org/10.5281/zenodo.24362980>. Model weights under the Apache License 2.0.
- **App this builds on:** Kahl, S., Börner, A., Mauermann, M., Seifert, R. C., Lasseck, M., Verdon, S., Wilhelm-Stein, T., Wood, C. M., Eibl, M., Müller, J. & Klinck, H. (2026). *BirdNET Live app – Professional bioacoustics in your pocket.* <https://github.com/birdnet-team/birdnet-live-app>

## What this version does and doesn't do yet

- **Does:** route QR codes, walk timer, live GPS track, on-phone BirdNET+ V3.0 identification in 3-second chunks, location filter (geomodel), human voices discarded and never stored, one best audio clip per species, results with coordinates and "approx. location" where GPS was lost, history, downloads (JSON and GPX), external mic selection.
- **Needs the TNS server:** "Submit to TNS" turns on when you put the server address in `uploadUrl` in `config.js`. It sends the walk as JSON.
- **Not yet:** recording with the screen off or the app in the background (needs the native Android build), Telugu bird names (add a Telugu column to the labels file and set `commonNameColumn`), user accounts.
- **Tested:** the screens, walk flow, GPS and demo mode were tested in Chrome. The BirdNET+ V3.0 model itself could not be loaded in testing, so do one test walk after adding the model files. If the FP16 model won't run, use the FP32 ONNX model from the same Zenodo record.
