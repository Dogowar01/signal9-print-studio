# Signal9 Print Studio

A private app for your Mac that keeps your digital artworks organised and prints them on an
**Epson ET-8500** without ever opening the Mac or Epson print dialogs. It reads the image,
looks at the paper you've chosen, and sets quality, colour mode, paper source and tone/colour
corrections for you. Every one of those choices stays visible and editable.

Everything runs on your own computer. Your artworks never leave your Mac.

## What it does

- **Library:** drag artworks in (JPEG, PNG, WebP, TIFF, HEIC, PSD). Give them titles, star ratings,
  favourites, tags, notes and collections. Search, sort and filter by any of them.
- **Print studio:** pick paper type, paper size, borderless, layout (fit, fill/crop or an exact
  width), margin and copies. Print one artwork or a whole selection in one go.
- **Smart analysis:** each artwork is measured for resolution, tonal range, shadow and highlight
  content, saturation, colours outside the printer's range, black & white, colour casts, fine detail
  and flat graphics. Combined with the paper, that gives:
  - print quality (Draft, Standard, High or Best),
  - colour or grayscale mode (grayscale for true black & white, for neutral greys),
  - paper source (cassette 1 for small photo sizes, cassette 2 for A4/Letter, rear feed for fine art and card),
  - corrections for brightness, shadow detail, contrast, saturation and sharpening. Matte and fine art papers
    can't print a true black, for example, so shadow detail is opened up and colours get a small lift.
- **Preview:** shows the exact page. Switch between *Original*, *Print-ready* and *Paper simulation*,
  which approximates how the chosen paper renders blacks, paper white and colour range.
- **All printer settings:** every option your installed ET-8500 driver offers, read directly from it.
  The options the app set are labelled **auto** with the reason; anything you change is labelled **manual**.
- **Printer status:** ink levels (when the driver reports them), the print queue and cancelling jobs.

## Setting it up on your MacBook

1. **Connect the printer.** Open *System Settings → Printers & Scanners* and add the ET-8500.
   If the *Use* menu offers **EPSON ET-8500 Series** (Epson's own driver), choose it: it gives the
   longest list of Epson paper types. AirPrint works as well.
2. **Install Node.js** (one time only): download the macOS installer (LTS) from
   [nodejs.org](https://nodejs.org/en/download) and run it.
3. **Get the app:** on the GitHub page for this repository click **Code → Download ZIP** and unzip it,
   or clone it with git:
   ```bash
   git clone https://github.com/<your-username>/signal9-print-studio.git
   ```
4. **Start it:** double-click **`start.command`**. A Terminal window opens and the app opens in your browser
   at <http://localhost:4321>. Keep that Terminal window open while you use the app; close it to stop.

   The first time, macOS may say it can't verify the file. Right-click `start.command`, choose **Open**,
   then **Open** again. If it says you don't have permission, run this once in Terminal from the app folder:
   ```bash
   chmod +x start.command
   ```

Tip: drag `start.command` to your Dock (right side) to get a one-click launcher.

## Where your artworks are stored

In **`~/Pictures/Signal9 Library`**:

| Folder / file | Contents |
|---|---|
| `originals/` | your files, exactly as imported |
| `display/` | viewable copies of TIFF/HEIC/PSD files (made with macOS's built-in `sips`) |
| `thumbs/` | small previews |
| `library.json` | titles, tags, ratings, collections, analysis and print history |
| `trash/` | anything you remove from the library (it's moved here, never deleted) |

To store the library somewhere else, such as an external drive:
```bash
SIGNAL9_LIBRARY="/Volumes/Art/Signal9 Library" node server.js
```

## Tips for the best prints

- Pick the paper in the app that matches the paper in the tray. That choice drives everything else.
- Aim for **240 ppi or more** at the print size. The studio shows the ppi live and warns when it's low.
- If prints still come out slightly dark compared with your screen, turn your screen brightness down
  a little when judging. Most screens are much brighter than a print under room light.
- Fine art and thick papers: load **one sheet at a time in the rear feed**. Borderless isn't offered for them.

## Troubleshooting

- **"No printer found":** check the printer appears in *System Settings → Printers & Scanners*, then reload the page.
- **A setting chose the wrong option:** driver option names vary. Open *All printer settings* in the studio
  and pick the right one. Your choice is kept for that print session.
- **No ink levels:** some drivers don't report them over the network. Printing is unaffected.
- **"Port 4321 is already in use":** the app is already running. Just open <http://localhost:4321>.

## For developers

No dependencies and no build step: plain Node.js (20+) and browser JavaScript.

```bash
npm start          # run the app
npm test           # run the test suite
npm run simulate   # use a simulated ET-8500 (prints are saved as PDFs in the library folder)
```

On a computer without CUPS (such as Windows), the simulated printer is used automatically.

| Path | Purpose |
|---|---|
| `server.js` | local web server and API, bound to 127.0.0.1 only |
| `server/printing.js` | CUPS integration (`lpstat`, `lpoptions`, `lp`, `cancel`, `ipptool`) |
| `server/ppd.js` | reads the driver's options, labels and paper sizes |
| `server/pdf.js` | builds the page-exact PDF that's sent to the printer |
| `server/library.js` | artwork storage and organisation |
| `public/js/analyze.js` | image analysis and recommendations |
| `public/js/papers.js` | paper profiles and matching them to driver options |
| `public/js/adjust.js` | colour/tone corrections (runs in a Web Worker) |
| `public/js/render.js` | page layout and print rendering |
| `public/js/studio.js` | print studio UI |
| `public/js/app.js` | library UI |
