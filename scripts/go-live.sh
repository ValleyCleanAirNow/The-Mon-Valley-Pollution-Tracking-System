#!/usr/bin/env bash
# One-time go-live for the Mon Valley Pollution Tracking System.
#
# Run from the repository root on a machine where you have run
#   firebase login
#   gcloud auth login            (only needed for anonymous sign-in and export)
#
# Usage:
#   scripts/go-live.sh              # everything, with prompts
#   scripts/go-live.sh --skip-deploy
#   scripts/go-live.sh --delete-legacy   # also export + delete symptomReports
#
# Each step is idempotent; rerun safely.
set -euo pipefail

PROJECT="${FIREBASE_PROJECT:-mv-pollution-tracking-system}"
SKIP_DEPLOY=false
DELETE_LEGACY=false
for arg in "$@"; do
  case "$arg" in
    --skip-deploy) SKIP_DEPLOY=true ;;
    --delete-legacy) DELETE_LEGACY=true ;;
    *) echo "unknown flag $arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. $2" >&2; exit 1; }; }

need firebase "Install with: npm install -g firebase-tools"
need node "Install Node 22."
need npm "Install Node 22."

bold "0. Checking Firebase access to $PROJECT"
firebase use "$PROJECT" >/dev/null
firebase projects:list 2>/dev/null | grep -q "$PROJECT" || { echo "Run: firebase login" >&2; exit 1; }
echo "ok"

bold "1. Enabling Anonymous sign-in"
if command -v gcloud >/dev/null 2>&1 && TOKEN="$(gcloud auth print-access-token 2>/dev/null)"; then
  RESP="$(curl -sS -X PATCH \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config?updateMask=signIn.anonymous.enabled" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -H "x-goog-user-project: $PROJECT" \
    -d '{"signIn":{"anonymous":{"enabled":true}}}')"
  if echo "$RESP" | grep -q '"enabled": *true'; then
    echo "Anonymous sign-in enabled."
  else
    echo "Could not enable via API (response below). Enable it in the console:"
    echo "  https://console.firebase.google.com/project/$PROJECT/authentication/providers"
    echo "$RESP" | head -20
  fi
else
  echo "gcloud not authenticated; enable Anonymous in the console, then press Enter:"
  echo "  https://console.firebase.google.com/project/$PROJECT/authentication/providers"
  read -r _
fi

bold "2. Secrets"
set_secret() {
  local name="$1" hint="$2" default="${3:-}"
  if firebase functions:secrets:access "$name" >/dev/null 2>&1; then
    echo "$name already set (keeping current value)."
    return
  fi
  echo "$name: $hint"
  if [[ -n "$default" ]]; then
    read -r -p "  Value [$default]: " value
    value="${value:-$default}"
  else
    read -r -s -p "  Value: " value; echo
  fi
  [[ -n "$value" ]] || { echo "  empty value, aborting" >&2; exit 1; }
  printf '%s' "$value" | firebase functions:secrets:set "$name" --data-file=- >/dev/null
  echo "  stored."
}
set_secret PURPLEAIR_API_KEY "PurpleAir READ key from https://develop.purpleair.com"
set_secret TOGETHER_API_KEY "Together AI key for BreatheAI (enter 'unused' to disable chat)" "unused"
set_secret SENDGRID_API_KEY "SendGrid API key for alert emails (or 'unused' for now)" "unused"
set_secret TWILIO_ACCOUNT_SID "Twilio account SID ('unused' while SMS is off)" "unused"
set_secret TWILIO_AUTH_TOKEN "Twilio auth token ('unused' while SMS is off)" "unused"
set_secret TWILIO_FROM_NUMBER "Twilio from number in E.164 ('unused' while SMS is off)" "unused"

if [[ "$SKIP_DEPLOY" == false ]]; then
  bold "3. Building"
  [[ -f frontend/.env ]] || { echo "frontend/.env is missing. Copy frontend/.env.example and fill in the Firebase web config first." >&2; exit 1; }
  (cd functions && npm ci --no-audit --no-fund && npm run lint && npm run build)
  (cd frontend && npm ci --no-audit --no-fund && CI=true npm run build)

  bold "4. Deploying rules, indexes (incl. TTL), storage rules, functions"
  firebase deploy --only firestore:rules,firestore:indexes,storage,functions

  bold "5. Deploying hosting"
  firebase deploy --only hosting
  echo "Live at: https://$PROJECT.web.app"
fi

bold "6. First poll and centroid review"
echo "The scheduler fires within 10 minutes. Then run:"
echo "  node scripts/status.js"
echo "It prints the last poll, sensor counts, and the seeded centroids for review."
echo "Edit centroids at:"
echo "  https://console.firebase.google.com/project/$PROJECT/firestore/databases/-default-/data/~2Fconfig~2Fmunicipalities"

if [[ "$DELETE_LEGACY" == true ]]; then
  bold "7. Legacy symptomReports (contains names and ages)"
  if command -v gcloud >/dev/null 2>&1; then
    read -r -p "GCS bucket for export (blank to skip export): gs://" BUCKET
    if [[ -n "$BUCKET" ]]; then
      gcloud firestore export "gs://$BUCKET/symptomReports-$(date +%Y%m%d)" --collection-ids=symptomReports --project="$PROJECT"
    fi
  fi
  read -r -p "Delete the symptomReports collection now? [y/N] " yn
  if [[ "$yn" =~ ^[Yy]$ ]]; then
    firebase firestore:delete symptomReports --recursive --yes
    echo "Deleted. Remove the symptomReports block from firestore.rules and redeploy rules when convenient."
  fi
fi

bold "Done"
