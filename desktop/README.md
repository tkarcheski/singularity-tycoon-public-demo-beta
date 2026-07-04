# Singularity Tycoon — desktop shell

Electron wrapper around the zero-build game (production track, issue #46).
The game stays a static site; this folder only adds a window.

```bash
cd desktop
npm install            # approve electron's install script if prompted
npm start              # dev: loads ../index.html
npm run dist           # package: dist/Singularity Tycoon-<version>.AppImage
```

- `electron-main.js` — window, persistent profile (localStorage saves), external links open in the system browser
- `preload.js` — tiny `window.__desktop` bridge; Steamworks lands here later
- Packaging copies `index.html` + `src/` into the app; Windows (nsis) and macOS (dmg) targets are configured but untested
- TODO before Steam submission: vendor the CDN fonts, app icon, Steamworks (achievements + cloud saves), code signing
