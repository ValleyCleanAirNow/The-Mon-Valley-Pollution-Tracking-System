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
#   scripts/go-live.sh --yes             # never prompt; take values from env
#
# Non-interactive mode (CI, or an agent session) reads:
#   GOOGLE_APPLICATION_CREDENTIALS       path to a service account key, or
#   GOOGLE_APPLICATION_CREDENTIALS_JSON  the key's JSON content, or
#   GOOGLE_APPLICATION_CREDENTIALS_B64   the key file base64-encoded on one line
#   PURPLEAIR_API_KEY, TOGETHER_API_KEY, SENDGRID_API_KEY,
#   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
#                                        secret values (unset ones default to "unused",
#                                        except PURPLEAIR_API_KEY which is required)
#   FIREBASE_WEB_API_KEY                 to generate frontend/.env when it is missing
#   EXPORT_BUCKET                        GCS bucket for the symptomReports export
#
# Each step is idempotent; rerun safely.
set -euo pipefail

PROJECT="${FIREBASE_PROJECT:-mv-pollution-tracking-system}"
SKIP_DEPLOY=false
DELETE_LEGACY=false
YES=false
for arg in "$@"; do
  case "$arg" in
    --skip-deploy) SKIP_DEPLOY=true ;;
    --delete-legacy) DELETE_LEGACY=true ;;
    --yes) YES=true ;;
    *) echo "unknown flag $arg" >&2; exit 2 ;;
  esac
done

# Service account handed over as content: materialise it for the CLIs.
if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS_B64:-}" ]]; then
    CRED_FILE="$(mktemp)"
    trap 'rm -f "$CRED_FILE"' EXIT
    printf '%s' "$GOOGLE_APPLICATION_CREDENTIALS_B64" | tr -d '\n\r ' | base64 -d > "$CRED_FILE"
    export GOOGLE_APPLICATION_CREDENTIALS="$CRED_FILE"
  elif [[ -n "${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}" ]]; then
    CRED_FILE="$(mktemp)"
    trap 'rm -f "$CRED_FILE"' EXIT
    printf '%s' "$GOOGLE_APPLICATION_CREDENTIALS_JSON" > "$CRED_FILE"
    export GOOGLE_APPLICATION_CREDENTIALS="$CRED_FILE"
  fi
  if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$GOOGLE_APPLICATION_CREDENTIALS" \
      || { echo "The service account credential is not valid JSON. Check the environment variable." >&2; exit 1; }
  fi
fi

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. $2" >&2; exit 1; }; }

need firebase "Install with: npm install -g firebase-tools"
need node "Install Node 22."
need npm "Install Node 22."

bold "0. Checking Firebase access to $PROJECT"
firebase projects:list --project "$PROJECT" 2>/dev/null | grep -q "$PROJECT" || {
  echo "No Firebase access. Either run 'firebase login' or set GOOGLE_APPLICATION_CREDENTIALS to a service account key." >&2; exit 1; }
echo "ok"

# Access token for Google APIs: gcloud if present, else the service account.
access_token() {
  if command -v gcloud >/dev/null 2>&1 && gcloud auth print-access-token 2>/dev/null; then return 0; fi
  if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    node -e '
      const { GoogleAuth } = require("./functions/node_modules/google-auth-library");
      new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] })
        .getAccessToken().then((t) => process.stdout.write(t)).catch((e) => { console.error(e.message); process.exit(1); });
    ' 2>/dev/null && return 0
  fi
  return 1
}

if [[ ! -f frontend/.env && -n "${FIREBASE_WEB_API_KEY:-}" ]]; then
  bold "0b. Writing frontend/.env from FIREBASE_WEB_API_KEY"
  sed "s|^REACT_APP_FIREBASE_API_KEY=.*|REACT_APP_FIREBASE_API_KEY=$FIREBASE_WEB_API_KEY|" frontend/.env.example > frontend/.env
  echo "written (gitignored)."
fi

bold "1. Enabling Anonymous sign-in"
[[ -d functions/node_modules ]] || (cd functions && npm ci --no-audit --no-fund >/dev/null)
if TOKEN="$(access_token)"; then
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
  echo "No Google API token available; enable Anonymous in the console:"
  echo "  https://console.firebase.google.com/project/$PROJECT/authentication/providers"
  if [[ "$YES" == false ]]; then read -r -p "Press Enter when done. " _; fi
fi

bold "2. Secrets"
set_secret() {
  local name="$1" hint="$2" default="${3:-}"
  if firebase functions:secrets:access "$name" --project "$PROJECT" >/dev/null 2>&1; then
    echo "$name already set (keeping current value)."
    return
  fi
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    if [[ "$YES" == true ]]; then
      value="$default"
      [[ -n "$value" ]] || { echo "$name is required: set it in the environment." >&2; exit 1; }
    else
      echo "$name: $hint"
      if [[ -n "$default" ]]; then
        read -r -p "  Value [$default]: " value
        value="${value:-$default}"
      else
        read -r -s -p "  Value: " value; echo
      fi
    fi
  fi
  [[ -n "$value" ]] || { echo "  empty value, aborting" >&2; exit 1; }
  printf '%s' "$value" | firebase functions:secrets:set "$name" --project "$PROJECT" --data-file=- >/dev/null
  echo "$name stored."
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
  firebase deploy --only firestore:rules,firestore:indexes,storage,functions --project "$PROJECT" --non-interactive --force

  bold "5. Deploying hosting"
  firebase deploy --only hosting --project "$PROJECT" --non-interactive
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
  BUCKET="${EXPORT_BUCKET:-}"
  if [[ -z "$BUCKET" && "$YES" == false ]]; then
    read -r -p "GCS bucket for export (blank to skip export): gs://" BUCKET
  fi
  if [[ -n "$BUCKET" ]]; then
    if command -v gcloud >/dev/null 2>&1; then
      gcloud firestore export "gs://$BUCKET/symptomReports-$(date +%Y%m%d)" --collection-ids=symptomReports --project="$PROJECT"
    else
      TOKEN="$(access_token)" && curl -sS -X POST \
        "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default):exportDocuments" \
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        -d "{\"outputUriPrefix\":\"gs://$BUCKET/symptomReports-$(date +%Y%m%d)\",\"collectionIds\":[\"symptomReports\"]}"
      echo
    fi
  else
    echo "No export bucket given; skipping export."
  fi
  yn="n"
  if [[ "$YES" == true ]]; then yn="y"; else read -r -p "Delete the symptomReports collection now? [y/N] " yn; fi
  if [[ "$yn" =~ ^[Yy]$ ]]; then
    firebase firestore:delete symptomReports --recursive --yes --project "$PROJECT"
    echo "Deleted. Remove the symptomReports block from firestore.rules and redeploy rules when convenient."
  fi
fi

bold "Done"
