#!/usr/bin/env bash
# Download manylinux cp312 wheels for offline Docker builds (LAN/IR).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p wheelhouse
export http_proxy="${http_proxy:-${HTTP_PROXY:-}}"
export https_proxy="${https_proxy:-${HTTPS_PROXY:-${http_proxy:-}}}"
python3 -m pip download -r requirements.txt -d wheelhouse \
  --python-version 312 --platform manylinux2014_x86_64 --only-binary=:all:
echo "OK: $(ls wheelhouse | wc -l) files in wheelhouse/"
