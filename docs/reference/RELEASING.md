---
title: "Release Policy"
summary: "Public release channels, version naming, and cadence"
read_when:
  - Looking for public release channel definitions
  - Looking for version naming and cadence
---

# Release Policy

OpenClaw has three public release lanes:

- stable: tagged releases that publish to npm `latest`
- beta: prerelease tags that publish to npm `beta`
- dev: the moving head of `main`

## Version naming

- Stable release version: `YYYY.M.D`
  - Git tag: `vYYYY.M.D`
- Stable correction release version: `YYYY.M.D-N`
  - Git tag: `vYYYY.M.D-N`
- Beta prerelease version: `YYYY.M.D-beta.N`
  - Git tag: `vYYYY.M.D-beta.N`
- Do not zero-pad month or day
- `latest` means the current stable npm release
- `beta` means the current prerelease npm release
- Stable correction releases also publish to npm `latest`
- Every OpenClaw release ships the npm package and macOS app artifacts together
- Stable macOS release artifacts currently include:
  - OpenClaw `.zip`, `.dmg`, and `.dSYM.zip`
  - OpenClaw Easy Mode `.zip`, `.dmg`, and `.dSYM.zip`
  - OpenClaw Easy Mode stable website alias `OpenClaw-Easy-Mode.dmg`

## Release cadence

- Releases move beta-first
- Stable follows only after the latest beta is validated
- Detailed release procedure, approvals, credentials, and recovery notes are
  maintainer-only

## Release preflight

- Run `pnpm build` before `pnpm release:check` so the expected `dist/*` release
  artifacts exist for the pack validation step
- Run `pnpm release:check` before every tagged release
- Run `RELEASE_TAG=vYYYY.M.D node --import tsx scripts/openclaw-npm-release-check.ts`
  (or the matching beta/correction tag) before approval
- After npm publish, run
  `node --import tsx scripts/openclaw-npm-postpublish-verify.ts YYYY.M.D`
  (or the matching beta/correction version) to verify the published registry
  install path in a fresh temp prefix
- For stable correction releases like `YYYY.M.D-N`, the post-publish verifier
  also checks the same temp-prefix upgrade path from `YYYY.M.D` to `YYYY.M.D-N`
  so release corrections cannot silently leave older global installs on the
  base stable payload
- npm release preflight fails closed unless the tarball includes both
  `dist/control-ui/index.html` and a non-empty `dist/control-ui/assets/` payload
  so we do not ship an empty browser dashboard again
- Stable macOS release readiness also includes the updater surfaces:
  - the GitHub release must end up with the packaged `.zip`, `.dmg`, and `.dSYM.zip`
  - `appcast.xml` on `main` must point at the new stable zip after publish
  - `appcast-easy-mode.xml` on `main` must point at the new stable Easy Mode zip after publish
  - the packaged app must keep a non-debug bundle id, a non-empty Sparkle feed
    URL, and a `CFBundleVersion` at or above the canonical Sparkle build floor
    for that release version
- OpenClaw Easy Mode stable website downloads use:
  `https://github.com/openclaw/openclaw/releases/latest/download/OpenClaw-Easy-Mode.dmg`
- Beta macOS releases may upload versioned Easy Mode assets to the prerelease,
  but they must not update the stable Easy Mode DMG alias or
  `appcast-easy-mode.xml` until a separate beta feed exists.

## Public references

- [`.github/workflows/openclaw-npm-release.yml`](https://github.com/openclaw/openclaw/blob/main/.github/workflows/openclaw-npm-release.yml)
- [`scripts/openclaw-npm-release-check.ts`](https://github.com/openclaw/openclaw/blob/main/scripts/openclaw-npm-release-check.ts)
- [`scripts/package-mac-dist.sh`](https://github.com/openclaw/openclaw/blob/main/scripts/package-mac-dist.sh)
- [`scripts/make_appcast.sh`](https://github.com/openclaw/openclaw/blob/main/scripts/make_appcast.sh)
- [`appcast-easy-mode.xml`](https://github.com/openclaw/openclaw/blob/main/appcast-easy-mode.xml)

Maintainers use the private release docs in
[`openclaw/maintainers/release/README.md`](https://github.com/openclaw/maintainers/blob/main/release/README.md)
for the actual runbook.
