#!/bin/sh
# Puts a sprite-update bundle from `npm run data:pmd-sprites:update` on the
# Fly volume and unpacks it in place over /data/pmd-sprite-mirror — the
# same folder layout the whole-mirror upload in DEPLOY.md uses, so only the
# added/updated species change. Nothing caches these files in the image, so
# the sheets are live as soon as the app that references them deploys.
#
#   npm run deploy:pmd-sprites -- deploy-assets/pmd-sprite-update-<stamp>.tar.gz
set -eu

TARBALL="${1:?usage: upload-pmd-sprites.sh deploy-assets/pmd-sprite-update-<stamp>.tar.gz}"
[ -f "$TARBALL" ] || { echo "no such file: $TARBALL" >&2; exit 1; }
NAME=$(basename "$TARBALL")

echo "uploading $TARBALL to /data/$NAME"
printf 'put %s /data/%s\n' "$TARBALL" "$NAME" | fly ssh sftp shell
echo "unpacking on the volume"
fly ssh console -C "sh -c 'cd /data && tar -xzf $NAME && rm $NAME && echo unpacked $NAME'"
