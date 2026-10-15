# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

**Status:** Pauli Speaks has applied to SignPath Foundation. Until the application is approved,
releases are not signed and Windows shows a SmartScreen warning when you run the installer.
This page describes how signed releases will be made.

## What is signed

Only the Windows installer `Pauli-Speaks-Setup-<version>.exe` published on
[GitHub Releases](https://github.com/izscaryu/pauli-speaks/releases) is signed, and only when it
was built from this repository by the [release workflow](../.github/workflows/release.yml).
Nothing built on a personal computer is signed, and nothing from another project is signed.

## How a release is built and signed

1. A maintainer tags a commit on `main` in this public repository (`v1.2.3`).
2. GitHub Actions builds the installer from that commit, on GitHub's servers, and runs the tests.
3. The unsigned installer is submitted to SignPath. An approver checks that the request comes
   from the release workflow for the expected tag, and approves it by hand. Every release needs
   its own approval.
4. The signed installer, its `.blockmap` and `latest.yml` (regenerated for the signed file) are
   published as a GitHub release. The in-app updater checks `latest.yml` before installing.

The product name in signed files is "Pauli Speaks", and the version is the version of the release.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [Patrik Pauli (@izscaryu)](https://github.com/izscaryu) |
| Approvers | [Patrik Pauli (@izscaryu)](https://github.com/izscaryu) |

Changes from contributors outside this list are reviewed by a committer before they are merged.
All team members use multi-factor authentication for GitHub and SignPath.

## Privacy

Pauli Speaks turns speech into text on your PC. It connects to GitHub to check for updates and to
Hugging Face to download speech and translation models, and it sends audio or text to a cloud
provider only if you turn on a cloud option. The full statement, including the third-party
services involved, is in [PRIVACY.md](../PRIVACY.md).

## Reporting a problem

If you think a signed Pauli Speaks file is malicious or was signed by mistake, open an issue at
[github.com/izscaryu/pauli-speaks/issues](https://github.com/izscaryu/pauli-speaks/issues) or
write to SignPath Foundation through [signpath.org](https://signpath.org/). We'll help
investigate.
