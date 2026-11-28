#!/usr/bin/env sh
# Self-signed certificate for a LOCAL HTTPS test of docker-compose.https.yml (browsers will warn; never use it in
# production). Writes deploy/certs/fullchain.pem and privkey.pem, both ignored by git.
set -eu
dir="$(cd "$(dirname "$0")" && pwd)/certs"
mkdir -p "$dir"
# Git Bash on Windows: openssl.exe needs a Windows path, and MSYS_NO_PATHCONV keeps "/CN=..." as is
command -v cygpath >/dev/null 2>&1 && dir="$(cygpath -m "$dir")"
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout "$dir/privkey.pem" -out "$dir/fullchain.pem"
echo "wrote $dir/fullchain.pem and $dir/privkey.pem"
