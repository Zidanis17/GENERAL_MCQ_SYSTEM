# MCQ Studio

Offline React + TypeScript + Electron desktop app for JSON question banks, practice, and exams. Targets Windows x64.

Version **1.2.1** supports importing multiple banks together through drag-and-drop or the file picker, with a 10 MiB limit per file. Valid files are saved independently; duplicate IDs offer Replace or Skip, and a completion summary lists any failed files.

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

The `src/shared` model owns import validation, types, shuffling, and scoring. `src/main` owns filesystem access, serialized persistence, authoritative session changes, expiry, and the updater. `src/preload` exposes a fixed typed bridge. `src/renderer` contains the React interface. Native windows use an isolated, sandboxed renderer, a local custom protocol, no arbitrary navigation, and blocked renderer network requests in production. The updater uses its own Electron network session.

Saved production data lives in `%APPDATA%\MCQ Studio`; development uses `%APPDATA%\MCQ Studio Development`. Tests set `MCQ_STUDIO_DATA_DIR` to temporary folders. Do not point tests at real data. The Windows portable and installed editions share production data.

Persistence uses `electron-store` in the main process for JSON reads and atomic writes. It opens the existing `state.json` and `state.backup.json` filenames with the same root structure, so banks, history, and unfinished sessions from earlier versions continue to work. A small wrapper validates saved data, keeps the previous state as a backup, and preserves damaged files before recovery. No storage package runs in the renderer or preload.

See [FORMAT.md](FORMAT.md) for the versioned JSON contract and [USAGE.md](USAGE.md) for the user guide.

## App updates

The installed edition supports background update downloads with an explicit restart prompt. Releases are configured for `Zidanis17/GENERAL_MCQ_SYSTEM`; `.github/workflows/release.yml` tests and publishes complete releases when a matching version tag is pushed. Ordinary `package:win` builds never publish. Run `npm run test:updates` after packaging to exercise actual update-feed requests, error/retry, downloading, and checksum validation against an isolated local server without installing anything. See [UPDATES.md](UPDATES.md) for the initial rollout and subsequent releases.
