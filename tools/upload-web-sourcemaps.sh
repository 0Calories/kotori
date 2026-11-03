#!/bin/sh
# Uploads the web export's source maps to Sentry (sparkwright/kotori-app), then deletes them so
# they aren't deployed. Without SENTRY_AUTH_TOKEN (local builds) the maps are only deleted.
set -eu
dist="$1"
if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
  sentry-expo-upload-sourcemaps "$dist"
else
  echo "SENTRY_AUTH_TOKEN is unset; not uploading source maps to Sentry."
fi
find "$dist" -name '*.map' -delete
