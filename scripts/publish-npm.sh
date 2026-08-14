#!/usr/bin/env bash
# Publish @snowamberx/dsh-role-router to npm.
#
# The repo README keeps its screenshot section for GitHub; npm gets the
# trimmed English README (npm-readme.md) instead. README.md is temporarily
# swapped before publishing and restored afterwards (even on failure, via
# trap), so the working tree is always left clean. README.en.md is parked
# during the publish so it does not ride along in the tarball.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP=".dsh-tmp/publish-bak"
mkdir -p "$BACKUP"

restore() {
  mv -f "$BACKUP/README.md" README.md 2>/dev/null || true
  mv -f "$BACKUP/README.en.md" README.en.md 2>/dev/null || true
  rm -rf "$BACKUP"
}
trap restore EXIT

cp README.md "$BACKUP/README.md"
mv README.en.md "$BACKUP/README.en.md"
cp npm-readme.md README.md

npm --cache .dsh-tmp/npm-cache publish --access public "$@"
