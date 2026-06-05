#!/usr/bin/env bash
# check_build.sh — Run a clean build and grep only errors/warnings.
# Solves the "binary file matches" problem caused by ANSI color codes
# when piping npm build output to grep.
#
# Usage:  bash scripts/check_build.sh
#         ./scripts/check_build.sh  (after chmod +x)

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Running clean build (CI=true NO_COLOR=1)..."
npm run build:clean 2>&1 | grep -a -i "error\|failed" || true
echo "==> Done."
