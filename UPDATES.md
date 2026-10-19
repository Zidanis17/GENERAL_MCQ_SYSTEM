# Publishing MCQ Studio updates

The installed Windows app uses `electron-updater` and GitHub Releases. It checks about ten seconds after startup and every six hours while open. Users can also select **App updates → Check for updates**. New releases download in the background, and the user chooses **Restart to update**. Banks, history, and the unfinished session stay in the same application data folder.

Timed exams continue counting during a restart. No update forces a restart or installs simply because the user closes the app. Offline study continues normally if an update check fails.

## Repository and first release

The public repository is configured as `Zidanis17/GENERAL_MCQ_SYSTEM`. The first update-enabled release is **v1.1.1**, available from the repository’s Releases page. Future releases use the version/tag commands below.

GitHub Actions runs the tests, builds Windows artifacts, and tests the packaged updater and portable app. It creates one draft, uploads the four release files in sequence, verifies their presence and sizes, and then publishes. The workflow checks that the tag matches `package.json` and uses GitHub’s built-in workflow token. No token is embedded in the app, and users do not need GitHub accounts to receive public updates.

Download the **Setup** executable from that GitHub release and distribute it. Users on v1.0.1 or earlier must install this update-enabled version once; those old builds cannot discover updates on their own. A local build made before a repository is configured also needs that one-time replacement with a configured installer.

## Later releases

Commit your app changes, then run:

```powershell
npm version patch
git push --follow-tags
```

`npm version patch` updates the manifest and lockfile, commits the change, and creates the matching version tag. Pushing that tag triggers the release workflow. Increase the version for every release; clients ignore the same or an older version. Only published stable releases are used, so drafts and prereleases do not reach existing users.

Keep this repository available at the same owner/name: installed copies remember where their update feed lives.

## Local builds and manual publishing

`npm run package:win` builds without uploading anything. After configuration, `release/` also contains `latest.yml`, the setup executable, and its `.blockmap`. These three files must belong to the same version and remain together in the GitHub release. Do not edit `latest.yml`; it includes the artifact checksum. The portable executable can be attached as another manual download.

For a manual upload instead of the workflow, install the GitHub CLI (`gh`), set `GH_TOKEN` in your own shell environment, and run `npm run release:win`. This uploads to one draft and verifies all four files. Publish that draft from GitHub’s Releases page when ready. Never place the token in project files or in the app’s update configuration. GitHub-hosted runners already include the CLI.

The project currently builds unsigned Windows executables. Existing checksum validation remains enabled; if you later configure Windows code signing, keep a consistent publisher identity between releases so signature validation continues to work.

## Editions and testing

Automatic installation is supported by the **NSIS setup edition**. The portable edition displays an explanation and requires downloading a replacement executable. Development and unconfigured builds display their actual status and do not make automatic network requests.

Run `npm test` for updater state, scheduling, retry, and saved-progress tests. Run `npm run test:e2e` for the Electron UI and study flows. After packaging, `npm run test:updates` serves a real installer through an isolated local update feed and verifies failure/retry, downloading, checksum validation, and restart confirmation without executing an installer. `npm run test:portable` verifies the portable edition and saved progress. The public GitHub workflow can run when the corresponding version tag is pushed.
