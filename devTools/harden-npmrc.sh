#!/usr/bin/env bash
set -euo pipefail

# Upgrade npm globally (so we have at least 11.10.0, which introduced min-release-age) and create a user npm config with stricter defaults.
npm install -g npm

if [[ -e "$HOME/.npmrc" ]]; then
    echo "ERROR: $HOME/.npmrc already exists. Please set the changes manually." >&2
    exit 1
fi

cat >"$HOME/.npmrc" <<'EOF'
min-release-age=1 # days
ignore-scripts=true
EOF
