# Setting up the TNS Bird Walk dashboard

This takes about 15 minutes. You need a Google account, and you will use your GitHub `birdwalk` repository again.

When a walker taps **Submit to TNS**, the app sends the walk to a Google Sheet. The dashboard page reads that sheet and shows the results to everyone. Both are free.

---

## 1. Create the Google Sheet

1. Go to **sheets.google.com** and create a blank sheet.
2. Name it **TNS Bird Walk data**.
3. You do not need to add any tabs. The script creates three tabs on its own: **Walks**, **Species** and **Detections**.

## 2. Paste in the script

1. In the sheet, open the menu **Extensions → Apps Script**.
2. Delete everything already in the editor.
3. Open the file `google-sheet/Code.gs` from this folder. Copy all of it and paste it into the editor.
4. Click the **Save** icon (the floppy disk).

## 3. Set a reviewer key

The key is a password for confirming or rejecting records on the dashboard. Only share it with TNS experts.

1. In Apps Script, click **Project Settings** (the gear icon on the left).
2. Scroll down to **Script properties** and click **Add script property**.
3. For **Property**, type `REVIEW_KEY`. For **Value**, type any password, for example `kingfisher-2026`.
4. Click **Save script properties**.

## 4. Publish the script as a web app

1. Click **Deploy → New deployment** (blue button, top right).
2. Click the gear next to **Select type** and choose **Web app**.
3. Fill it in:
   - **Description**: `TNS Bird Walk`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
4. Click **Deploy**.
5. Google asks for permission. Click **Authorize access** and choose your account.
   - If you see *"Google hasn't verified this app"*, click **Advanced**, then **Go to … (unsafe)**. This warning appears because the script is yours and not published by Google. It is safe.
6. Copy the **Web app URL**. It ends in `/exec`.

**Check it works:** paste that URL into your browser and add `?action=data` to the end. You should see text that starts with `{"ok":true`.

## 5. Put the address in the app

1. Open `config.js` in this folder with a text editor (Notepad is fine).
2. Find this line:
   ```js
   uploadUrl: null,
   ```
3. Replace `null` with your URL in quotes:
   ```js
   uploadUrl: 'https://script.google.com/macros/s/AKfy...../exec',
   ```
4. Save the file.

## 6. Upload the changed files to GitHub

These files are small, so the GitHub website uploader works.

1. Open your `birdwalk` repository on github.com.
2. Click **Add file → Upload files**.
3. Drag in these four files:
   - `config.js`
   - `app.js`
   - `sw.js`
   - `dashboard.html`
4. Click **Commit changes**.
5. Wait about a minute for GitHub Pages to update.

You do **not** need to upload the model files again.

## 7. Open the dashboard

Go to:

```
https://<your-github-username>.github.io/birdwalk/dashboard.html
```

Until walks are submitted, the page shows **sample data** with a yellow note at the top. After the first real walk is submitted, the note disappears and real numbers show.

**Test it:** open the app on a phone, start **Walk anywhere**, walk for a minute, finish, and tap **Submit to TNS**. Refresh the dashboard. The walk should appear.

---

## Using the dashboard

- **Period and place:** use the buttons at the top to filter.
- **Include test walks:** demo walks are hidden unless you tick this box.
- **Species totals:** a record counts once the app is confident (70% or higher), or once an expert confirms it.
- **Expert review queue:** lists uncertain records. Enter the reviewer key, then tap **Confirm** or **Reject**. The decision is saved to the **Species** tab in the sheet.
- **Download CSV:** saves the records for the current filters.
- **Raw data:** everything is also in the Google Sheet itself, and you can sort, filter and share it there.

## If you change the script later

After editing `Code.gs`, click **Deploy → Manage deployments**, then the pencil icon. Set **Version** to **New version** and click **Deploy**. Doing it this way keeps the same `/exec` URL, so you don't need to change `config.js`.

## Limits

- Google Sheets handles a pilot of a few thousand walks well. Before scaling up to 10,000 walkers, move to a proper database such as Supabase or Firebase.
- Anyone who has the `/exec` URL can submit a walk. Only someone with the reviewer key can change a record's status.
- Audio clips stay on the walker's phone. Only species names, times and locations are sent.

---

## Sound clips in Google Drive (added in v9)

With each walk, the app sends one 3-second clip per bird, the best call it heard. The script saves the clips in your Google Drive, in a folder called **TNS Bird Walk clips**, with one subfolder per month. The clips stay private: no Drive links are shared. The dashboard plays them through the script, using the ▶ button in the **Expert review queue**.

**To turn it on:**

1. Open the Apps Script project. Replace all of `Code.gs` with the new version, then click **Save**.
2. Click **Deploy → Manage deployments**, then the pencil icon. Set **Version** to **New version** and click **Deploy**.
3. Google asks for permission again, this time for **Google Drive**. Click **Authorize access** and allow it. If you see "Google hasn't verified this app", click **Advanced**, then **Go to … (unsafe)**.
4. The `/exec` URL stays the same, so `config.js` doesn't change.

The **Species** tab gets a new last column, `clip_file_id`, the first time a walk arrives. Older rows stay blank.

**Space:** a clip is about 190 KB, and a typical walk with about 10 birds comes to about 2 MB. Free Google Drive is 15 GB, enough for about 7,500 walks.

**On the phone:**
- Clips are kept on the phone for the 30 most recent walks, so the ▶ buttons on the results screen work even after the app is closed or reloaded.
- If there's no signal when the walker taps *Submit*, the walk is still sent, and the clips go automatically the next time the app is open with signal. There's also a **Send the sound clips now** button.
- Walkers can turn clips off under *Share & settings → Send sound clips to TNS*.
- Demo walks never send clips.
