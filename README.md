# Signal9 Print Studio

A private app for your Mac that keeps your digital artworks organised and prints them on an
**Epson ET-8500** without ever opening the Mac or Epson print dialogs. It reads the image,
looks at the paper you've chosen, and sets quality, colour mode, paper source and tone/colour
corrections for you. Every one of those choices stays visible and editable.

Everything runs on your own computer. Your artworks never leave your Mac.

## What it does

- **Library:** drag artworks in (JPEG, PNG, WebP, TIFF, HEIC, PSD). Give them titles, star ratings,
  favourites, tags, notes and collections. Search, sort and filter by any of them.
- **Duplicates:** importing a file that's already in the library is skipped. *Duplicates* (also
  *Edit → Find Duplicates…*) finds works that are in more than once, including the same picture saved at
  another size or format, keeps the best copy and moves its tags, collections, ratings and print history
  onto it. Removed copies go to the library's trash folder.
- **Find like images:** *Group by → Style* gathers works by look (palette, light or dark, contrast,
  detail), and *Group by → Subject* by what's in them (cities, flowers, people, sky…). Every work's
  details show what was recognised in it and **More like this**: its closest matches, with
  *Show all similar works* to rank the whole library by look, subject or both. Search also finds works by
  what's in them, so "sunflower" or "skyline" works without tagging anything. Subjects are recognised by
  macOS's built-in image recognition (Apple's Vision framework), on the Mac itself; nothing is uploaded.
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

## Installing it on your MacBook

Signal9 Print Studio is a normal Mac app for Apple silicon Macs (M-series and A-series, including the MacBook Neo).
It lives in your Applications folder and Dock. Closing its window keeps it running in the Dock; click the
Dock icon to bring it back, and press **⌘Q** to quit.

1. **Connect the printer.** Open *System Settings → Printers & Scanners* and add the ET-8500.
   If the *Use* menu offers **EPSON ET-8500 Series** (Epson's own driver), choose it: it gives the
   longest list of Epson paper types. AirPrint works as well.
2. **Download the app** from the [latest release](https://github.com/Dogowar01/signal9-print-studio/releases/latest):
   the file ending in **`.dmg`**.
3. **Install it:** open the `.dmg` and drag **Signal9 Print Studio** onto the **Applications** folder.
4. **Open it the first time.** The app isn't registered with Apple (that needs a paid developer account),
   so macOS asks you to approve it once:
   - Double-click **Signal9 Print Studio** in Applications. When macOS says it can't verify it, click **Done**.
   - Open *System Settings → Privacy & Security*, scroll down and click **Open Anyway** next to
     Signal9 Print Studio, then confirm.

   After that it opens normally. To keep it in the Dock, right-click its Dock icon while it's running and
   choose *Options → Keep in Dock*.

**Menus:** *File → Import Artworks…* (⌘O), *File → Print…* (⌘P), *File → Show Library in Finder*, and
*Signal9 Print Studio → Check for Updates…*.

**Updates install themselves.** When a new version is published, the app shows a card saying it's ready.
Click **Update & restart**: it downloads the new version, checks it against GitHub's fingerprint, replaces
itself in Applications and reopens. No re-approval needed. Your library is never touched: it lives in your
Pictures folder, not inside the app. (Versions before 1.2.0 don't have the updater, so install 1.2.0 by hand once.)

### Running it from the source code instead

If you'd rather not use the `.dmg`, install [Node.js](https://nodejs.org/en/download) and run the app straight
from this repository (clone it or use *Code → Download ZIP*):

```bash
npm install
npm run app
```

You can also build your own `.dmg` on a Mac with `npm run build:mac` (output in `dist/`). An app you build
yourself doesn't need the approval step above.

## Where your artworks are stored

In **`~/Pictures/Signal9 Library`**:

| Folder / file | Contents |
|---|---|
| `originals/` | your files, exactly as imported |
| `display/` | viewable copies of TIFF/HEIC/PSD files (made with macOS's built-in `sips`) |
| `thumbs/` | small previews |
| `library.json` | titles, tags, ratings, collections, analysis and print history |
| `trash/` | anything you remove from the library (it's moved here, never deleted) |

Use *File → Show Library in Finder* to open it. To keep the library somewhere else, such as an
external drive, start the app from Terminal with the location set:
```bash
SIGNAL9_LIBRARY="/Volumes/Art/Signal9 Library" open -a "Signal9 Print Studio"
```

## Tips for the best prints

- Pick the paper in the app that matches the paper in the tray. That choice drives everything else.
- Aim for **240 ppi or more** at the print size. The studio shows the ppi live and warns when it's low.
- If prints still come out slightly dark compared with your screen, turn your screen brightness down
  a little when judging. Most screens are much brighter than a print under room light.
- Fine art and thick papers: load **one sheet at a time in the rear feed**. Borderless isn't offered for them.

## Troubleshooting

- **"No printer found":** check the printer appears in *System Settings → Printers & Scanners*, then choose
  *View → Reload* in the app.
- **"Signal9 Print Studio is damaged and can't be opened":** macOS sometimes says this about apps downloaded
  from outside the App Store. Run this once in Terminal, then open the app again:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Signal9 Print Studio.app"
  ```
- **A setting chose the wrong option:** driver option names vary. Open *All printer settings* in the studio
  and pick the right one. Your choice is kept for that print session.
- **No ink levels:** some drivers don't report them over the network. Printing is unaffected.

## For developers

The app is plain Node.js and browser JavaScript with no runtime dependencies. [Electron](https://www.electronjs.org)
wraps it as a Mac app: `electron/main.js` starts the local server inside the app and shows it in a native window.

```bash
npm install        # dev tools: Electron and the app packager
npm run app        # run the desktop app
npm start          # or run just the server and use it in a browser at http://localhost:4321
npm test           # run the test suite
npm run simulate   # use a simulated ET-8500 (prints are saved as PDFs in the library folder)
npm run build:mac  # build dist/Signal9-Print-Studio-<version>-arm64.dmg (macOS only)
```

On a computer without CUPS (such as Windows), the simulated printer is used automatically.

Subject recognition uses a small Swift helper (`vision/Signal9Vision.swift`) that the Mac build compiles,
self-tests and bundles. To use it when running from source on a Mac, run `npm run build:vision` once.
Elsewhere, grouping by style and "More like this" by look still work.

**Releasing a new version:**
1. Bump `version` in `package.json` and commit.
2. Tag it with a short note about what changed. The note's first paragraph is what the app's update card shows:
   ```bash
   git tag -a v1.3.0 -m "New fine-art paper profiles and faster previews."
   git push && git push --tags
   ```
3. GitHub builds the `.dmg` on an Apple silicon Mac (`.github/workflows/build-mac.yml`) and publishes the release.
   Installed copies offer the update within a few hours, or straight away via *Check for Updates…*.

*Actions → Build Mac app → Run workflow* builds a `.dmg` without publishing a release.

| Path | Purpose |
|---|---|
| `electron/main.js` | the Mac app: window, Dock behaviour, menus, runs the server |
| `electron/preload.cjs` | the small bridge that passes menu commands and update messages to the page |
| `electron/updater.js` | checks GitHub Releases, downloads, verifies and installs updates |
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
| `build/` | app icon and the Mac build script |
