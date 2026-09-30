#!/usr/bin/env bash
# Rebuilds app/static/app.css after template changes. Only needed at development time.
set -euo pipefail
cd "$(dirname "$0")"
npx --yes tailwindcss@3 -c tailwind.config.js -i input.css -o ../app/static/app.css --minify
