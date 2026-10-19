# MCQ Studio

Offline React + TypeScript + Electron desktop app for JSON question banks, practice, and exams. Targets Windows x64.

## Run and build

Requires Node.js 24 and npm for development only.

```powershell
npm ci
npm run icons
npm run dev
```

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run package:win
npm run test:portable
npm run deliver
```

`package:win` produces an unsigned portable executable and per-user NSIS installer under `release/`. `deliver` copies them, an example bank, usage instructions, and format documentation to Windows’ actual `Desktop\MCQ Studio` folder. The finished executables include their runtime and work offline.

The `src/shared` model owns import validation, types, shuffling, and scoring. `src/main` owns filesystem access, serialized persistence, authoritative session changes, and expiry. `src/preload` exposes a fixed typed bridge. `src/renderer` contains the React interface. Native windows use an isolated, sandboxed renderer, a local custom protocol, no arbitrary navigation, and blocked network requests in production.

Saved production data lives in `%APPDATA%\MCQ Studio`; development uses `%APPDATA%\MCQ Studio Development`. Tests set `MCQ_STUDIO_DATA_DIR` to temporary folders. Do not point tests at real data. The Windows portable and installed editions share production data.

Persistence uses `electron-store` in the main process for JSON reads and atomic writes. It opens the existing `state.json` and `state.backup.json` filenames with the same root structure, so banks, history, and unfinished sessions from earlier versions continue to work. A small wrapper validates saved data, keeps the previous state as a backup, and preserves damaged files before recovery. No storage package runs in the renderer or preload.

See [FORMAT.md](FORMAT.md) for the versioned JSON contract and [USAGE.md](USAGE.md) for the user guide.
