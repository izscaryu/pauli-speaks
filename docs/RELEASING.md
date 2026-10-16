# Releasing Pauli Speaks

Releases are built and published by GitHub Actions from a version tag, never from a developer's
PC. This page is the checklist for the person cutting a release.

## 1. Release

With everything committed, pushed on `main` and [CI](../.github/workflows/ci.yml) green:

```bash
npm run release -- 1.2.0
```

(or `patch`, `minor`, `major`). [`scripts/release.js`](../scripts/release.js):

1. stops if the working tree isn't clean, you aren't on `main`, or `main` differs from
   `origin/main`;
2. runs `npm test`;
3. sets `"version"` in `package.json` with `npm version`, which commits "Release v1.2.0" and
   tags it `v1.2.0`;
4. pushes the commit and the tag together.

The tag starts [`.github/workflows/release.yml`](../.github/workflows/release.yml):

- **build** (Windows): checks that the tag matches `package.json`, runs `npm ci` and the tests,
  builds `Pauli-Speaks-Setup-<version>.exe` and `Pauli-Speaks-Portable-<version>.exe` (unsigned),
  then runs [`scripts/release-check.js`](../scripts/release-check.js). That check fails the run
  unless `latest.yml`, the file the installed app's updater reads, names this installer with its
  exact sha512 and size, and the blockmap and portable `.exe` are there.
- **release** (Linux): creates the GitHub release with the installer, its `.blockmap`,
  `latest.yml` and the portable `.exe`, with generated release notes, then checks that every file
  arrived.

Installed copies pick the release up within 6 hours, or straight away via *About → Check for
updates*. Portable copies only show that a new version exists.

If the **build** job fails, no release is created. Fix the problem on `main` and release the
next patch version; don't move a tag that has been pushed.

## 2. Pre-releases ("Get early versions")

```bash
npm run release -- 1.2.0-beta.1
```

Only `x.y.z-beta.N` versions are accepted. The workflow publishes them as a GitHub
**pre-release**. Copies with *About → Get early versions* on install it; everyone else reads
GitHub's latest release, which never is a pre-release, so they don't see it. Don't untick
"Set as a pre-release" on GitHub by hand: every installed copy would then update to the beta.

Then `1.2.0-beta.2` and so on. When it's ready, release `1.2.0` (`npm run release -- patch`
from a beta gives the same). Beta users move to it automatically, because the updater takes the
newest release of either kind.

Why only `beta`: the updater moves someone on a `beta` version on to the next regular release,
but someone on another pre-release name (`rc`, `alpha`, …) would only be offered that name again.

## 3. Check the published files

### VirusTotal (by hand)

There is no VirusTotal step in the workflow on purpose: it would need an API key as a repository
secret, and the release workflow uses no secrets.

1. Download `Pauli-Speaks-Setup-<version>.exe` and `Pauli-Speaks-Portable-<version>.exe` from the
   GitHub release page (scan what users download, not a local build).
2. Upload each at [virustotal.com](https://www.virustotal.com/gui/home/upload). If a file was
   already scanned, VirusTotal shows the earlier report; check that its SHA-256 matches
   (`Get-FileHash .\Pauli-Speaks-Setup-<version>.exe` in PowerShell).
3. Optionally add the report links to the release notes.

A few heuristic detections are common for new, unsigned Electron apps, and more so for one with
a keyboard hook. Look at which engines flag it. If **Microsoft** is one of them, follow the next
section, since Defender is what most users run. Other vendors have their own false-positive
forms; VirusTotal's documentation lists contacts for each engine.

### Microsoft Defender false positive

If Defender (or Microsoft on VirusTotal) flags a release:

1. Note the **detection name** and the **security intelligence version**: *Windows Security →
   Virus & threat protection → Protection history* shows the detection, and
   `Get-MpComputerStatus | Select AntivirusSignatureVersion` in PowerShell shows the version.
2. Go to Microsoft's security intelligence file submission portal,
   [microsoft.com/wdsi/filesubmission](https://www.microsoft.com/wdsi/filesubmission), and sign
   in with the Microsoft account you use for submissions.
3. Submit as a **software developer**, choose Microsoft Defender Antivirus as the product, and
   say the file is **incorrectly detected** (a false positive). Upload the flagged `.exe`.
4. In the comments, give the detection name and version, and link the GitHub release, the
   [release workflow run](https://github.com/izscaryu/pauli-speaks/actions/workflows/release.yml)
   that built it and the source. Say what the keyboard hook does: it only listens for the user's
   shortcuts and never stores keystrokes.
5. Follow the status in the portal's submission history. When the detection is removed, users
   (and you) can pick up the fix straight away from an administrator command prompt:

   ```
   cd "%ProgramFiles%\Windows Defender"
   MpCmdRun.exe -removedefinitions -dynamicsignatures
   MpCmdRun.exe -SignatureUpdate
   ```

   Mention the outcome in a comment on any GitHub issue about it.

## Code signing

Releases are not code-signed yet, so Windows SmartScreen shows "Windows protected your PC"
until a download builds up reputation; the README explains the *More info → Run anyway* step.
The [code signing policy](code-signing-policy.md) shows the current status. Once signing is in
place, the workflow must regenerate `latest.yml` for the signed installer before
`release-check.js` runs (the steps are in the comment in the workflow).
