# Images, icons and other static files

Where each kind of file lives, how the app icons are made, and where files we have not needed yet go. `.claude/rules/assets.md` holds the short rules.

## The layout

```
assets/
  brand/        hand-made, in git: the only art anyone edits
  generated/    made on `pnpm install`, not in git; app.json points here
public/         served at the web root unchanged
  index.html, manifest.json    hand-written, in git
  icon.svg, favicon.ico, icon-*.png, apple-touch-icon.png    generated, not in git
scripts/renderIcons.ts, scripts/icons.ts    make every generated file
src/ui/         an image that one screen shows sits beside that screen
```

`assets/` is Expo's folder for files the native build reads. `public/` is Expo's web root: everything in it is copied to `dist/` as it is.

## How the icons are made

`assets/brand/icon-foreground.svg` is the glyph on a transparent 1024 px square. `pnpm install` runs `scripts/renderIcons.ts` (the `postinstall` script), and `pnpm icons` runs it again after an art change. It lays the brand colour behind the glyph where an output needs a background, then draws every size with `@resvg/resvg-wasm`. That renderer is WebAssembly, so it needs no download or approval on install and draws the same pixels everywhere.

Every output is one row in `PNG_OUTPUTS` in `scripts/icons.ts`:

| Output                                | Size     | Background            | Used by                                        |
| ------------------------------------- | -------- | --------------------- | ---------------------------------------------- |
| `assets/generated/icon.png`           | 1024     | yes, no alpha channel | iOS app icon (`app.json` `icon`)               |
| `assets/generated/adaptive-icon.png`  | 1024     | no                    | Android adaptive icon foreground               |
| `assets/generated/splash-icon.png`    | 1024     | no                    | Splash screen on both phones                   |
| `public/icon-192.png`, `icon-512.png` | 192, 512 | yes                   | Web app manifest                               |
| `public/icon-maskable-512.png`        | 512      | yes                   | Web app manifest, maskable                     |
| `public/apple-touch-icon.png`         | 180      | yes                   | iPhone "Add to Home Screen"                    |
| `public/icon.svg`                     | vector   | yes                   | Browser tab icon; cached by the service worker |
| `public/favicon.ico`                  | 48       | yes                   | Browser tab icon; cached by the service worker |

## Size rules

- **iOS icon:** exactly 1024 by 1024, RGB, no alpha channel. App Store Connect rejects an alpha channel even when every pixel is opaque, so `opaquePng` writes RGB.
- **Android adaptive icon:** the phone masks the outer third, so the glyph stays inside the centre 66%. A test checks it.
- **Maskable web icon:** the glyph stays inside the centre 80%.
- **Brand colour:** `#f6f1e7` is `BACKGROUND_COLOUR` in `scripts/icons.ts`. It is also in `app.json` and `public/manifest.json`; the three must match.

## When you add a file

| You are adding                                                                                                                          | It goes in                                                | Notes                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| New art for the app icon (#91)                                                                                                          | `assets/brand/`                                           | Keep the file name, or change `scripts/renderIcons.ts` to read the new one.                                            |
| Android themed icon (monochrome SVG)                                                                                                    | `assets/brand/`                                           | Add one output row, then name it in `app.json` as `android.adaptiveIcon.monochromeImage`.                              |
| iOS 26 icon made in Icon Composer (`.icon` folder)                                                                                      | `assets/brand/`                                           | Name it in `app.json` as `ios.icon`. The tool runs only on macOS, so this is the one icon that is not generated.       |
| Android notification icon (white on transparent)                                                                                        | `assets/brand/`, with an output row                       | Needed with #108.                                                                                                      |
| A picture one screen shows                                                                                                              | Beside its component in `src/ui/`                         | Import it; Metro hashes it into the bundle on all three platforms.                                                     |
| A custom font                                                                                                                           | `assets/fonts/`                                           | Fonts today come from `@expo-google-fonts/*`. Record the licence below.                                                |
| A file a third party fetches at a fixed address (`robots.txt`, `.well-known/assetlinks.json`, `.well-known/apple-app-site-association`) | `public/`, hand-written                                   | Check the service worker does not cache it. Values that differ by environment need a build step, not a committed copy. |
| A link-preview image (Open Graph)                                                                                                       | `assets/brand/` source, with an output row into `public/` | The `og:image` URL must be absolute.                                                                                   |
| Store listing text and screenshots                                                                                                      | `assets/store/`                                           | Not created yet; decide the layout with #110 and #121.                                                                 |

An icon the script cannot draw from the foreground glyph (a hand-tuned small size, for example) needs a second source in `assets/brand/` and its own output row. Do not edit a generated file.

## Licences of third-party files

| Files                              | From                                                            | Licence                   |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------- |
| Inter, Source Serif 4 fonts        | `@expo-google-fonts/inter`, `@expo-google-fonts/source-serif-4` | SIL Open Font License 1.1 |
| The glyph in `icon-foreground.svg` | Outline of "A" in Source Serif 4                                | SIL Open Font License 1.1 |
