---
name: deploy
description: Release this plugin (Ensemble for Paseo). Bumps the version in package.json, tags and pushes it, checks the tag installs, and creates a GitHub release on DueGin/paseo-ensemble. Use when the user says "发布", "发版", "release", "deploy" or "배포".
---

# Deploy paseo-ensemble

A release request authorizes every step below, including the push and the GitHub release. Stop and report instead of continuing when a check fails.

## 1. Preflight

All of these must hold; otherwise stop and report what is wrong:

- On `main`, the working tree is clean, and `git fetch` shows `main` equals `origin/main`.
- `npm run typecheck` and `npm test` pass.
- There are commits since the last tag (`git describe --tags --abbrev=0`).
- `OVERVIEW.md` and the README's Limitations still describe the shipped behaviour. If a commit since the last release changed behaviour they describe, update them first and get the user's OK on the wording.

github.com is reached through the proxy: `git` has it configured; `gh` needs `HTTPS_PROXY=http://127.0.0.1:7890`.

## 2. Record the version

Use the bump level the user names (patch, minor, major). If they name none, use `patch`, and say so in the report.

```bash
npm version <level> --no-git-tag-version   # updates package.json and package-lock.json
git commit -am "Release v<version>"
git tag v<version>
git push origin main v<version>
```

`paseo-plugin.json` has no version field; do not add one.

## 3. Check the release installs

Never touch the `paseo-ensemble` plugin installed on the user's daemon, and never stop or restart that daemon. Install the tag on a throwaway daemon instead (its own `--home`), then stop that daemon by killing the shell that runs it:

```bash
PASEO_LISTEN=127.0.0.1:6799 paseo daemon run --home /tmp/ensemble-release   # in the background
paseo plugin add git:DueGin/paseo-ensemble --ref v<version> --home /tmp/ensemble-release
paseo plugin ls --home /tmp/ensemble-release      # must be "running" with no error
```

If it fails (for example the server runtime boundary rejecting an import), stop: the release is broken, so fix it and release the next patch.

## 4. GitHub release

Build the notes from the commit subjects since the previous tag:

```bash
git log --format='- %s' <previous>..v<version>~1
gh release create v<version> --repo DueGin/paseo-ensemble --title "v<version>" --notes "<notes>"
```

## 5. Report

Report to the user: the version, the tag, the GitHub release URL, and whether the bump level was the default. `paseo plugin add git:DueGin/paseo-ensemble` installs the latest `main`; add `--ref v<version>` for this release.
