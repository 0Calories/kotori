#!/bin/sh
# Uploads the web export's source maps to Sentry (sparkwright/kotori-app), then deletes them so
# they aren't deployed. Without SENTRY_AUTH_TOKEN (local builds, PR checks) the maps are only
# deleted. SENTRY_UPLOAD=required (the production deploy) fails the build instead of skipping.
set -eu
dist="$1"
required=$([ "${SENTRY_UPLOAD:-}" = required ] && echo yes || echo no)

fail() {
  echo "error: $1" >&2
  exit 1
}

maps=$(find "$dist" -name '*.map' | wc -l | tr -d ' ')
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  [ "$required" = yes ] && fail "SENTRY_UPLOAD=required but SENTRY_AUTH_TOKEN is unset."
  echo "SENTRY_AUTH_TOKEN is unset; not uploading source maps to Sentry."
elif [ "$maps" -eq 0 ]; then
  [ "$required" = yes ] && fail "no source maps in $dist; was it exported with --source-maps?"
  echo "No source maps in $dist; nothing to upload."
else
  echo "Uploading $maps source map(s) from $dist to Sentry."
  log=$(mktemp)
  # The uploader exits 0 when it skips bundles, so check its summary line too.
  sentry-expo-upload-sourcemaps "$dist" 2>&1 | tee "$log"
  grep -q "Uploaded bundles and sourcemaps to Sentry successfully" "$log" || fail "not every bundle's source map was uploaded."
  rm -f "$log"
fi
find "$dist" -name '*.map' -delete
