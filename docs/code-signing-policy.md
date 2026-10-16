# Code signing policy

**Status:** Pauli Speaks releases are not code-signed yet, so Windows shows a SmartScreen warning
when you run the installer (see the [README](../README.md#windows-protected-your-pc)). This page
will name the signing service and certificate once releases are signed.

## How releases are built

1. A maintainer tags a commit on `main` in this public repository (`v1.2.3`).
2. GitHub Actions builds the installer `Pauli-Speaks-Setup-<version>.exe` from that commit, on
   GitHub's servers, and runs the tests. Nothing built on a personal computer is published.
3. The installer, its `.blockmap` and `latest.yml` are published as a
   [GitHub release](https://github.com/izscaryu/pauli-speaks/releases). The in-app updater checks
   `latest.yml` before installing.

Download Pauli Speaks only from GitHub Releases. The product name in the installer is
"Pauli Speaks", and the version is the version of the release.

## What will be signed

Once signing is in place, only the installer built from this repository by the
[release workflow](../.github/workflows/release.yml) will be signed, after a maintainer approves
each release, and `latest.yml` will be regenerated for the signed file. Nothing from another
project will be signed.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [Patrik Pauli (@izscaryu)](https://github.com/izscaryu) |
| Release approvers | [Patrik Pauli (@izscaryu)](https://github.com/izscaryu) |

Changes from contributors outside this list are reviewed by a committer before they are merged.
All team members use multi-factor authentication for GitHub.

## Privacy

Pauli Speaks turns speech into text on your PC. It connects to GitHub to check for updates and to
Hugging Face to download speech and translation models, and it sends audio or text to a cloud
provider only if you turn on a cloud option. The full statement, including the third-party
services involved, is in [PRIVACY.md](../PRIVACY.md).

## Reporting a problem

If you think a Pauli Speaks release is malicious or was not built from this repository, open an
issue at [github.com/izscaryu/pauli-speaks/issues](https://github.com/izscaryu/pauli-speaks/issues).
We'll help investigate.
