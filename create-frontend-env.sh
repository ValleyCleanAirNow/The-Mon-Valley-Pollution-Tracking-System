#!/bin/bash
set -euo pipefail

# Firebase web configuration identifies a Firebase project but should still be
# supplied by the developer environment rather than committed as repository data.
required=(
  FIREBASE_API_KEY
  FIREBASE_AUTH_DOMAIN
  FIREBASE_PROJECT_ID
  FIREBASE_STORAGE_BUCKET
  FIREBASE_MESSAGING_SENDER_ID
  FIREBASE_APP_ID
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
done

cat > frontend/.env <<EOL
REACT_APP_FIREBASE_API_KEY=${FIREBASE_API_KEY}
REACT_APP_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN}
REACT_APP_FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
REACT_APP_FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET}
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID}
REACT_APP_FIREBASE_APP_ID=${FIREBASE_APP_ID}
EOL

echo "Created frontend/.env from the current shell environment."
