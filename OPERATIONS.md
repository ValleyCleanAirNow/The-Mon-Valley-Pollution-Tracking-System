# Operations

Day-to-day runbook for the Mon Valley Pollution Tracking System.
Firebase project: `mv-pollution-tracking-system`. Contact: Qiyam Ansari,
qiyam@valleycleanair.com.

## Where things run

| Component | Where | How to see it |
| --- | --- | --- |
| Web app | Firebase Hosting | Firebase console, Hosting |
| `pollPurpleAir` | Cloud Functions v2, `us-central1`, every 10 minutes | Cloud Scheduler job + function logs |
| `aggregateReports` | Cloud Functions v2 Firestore trigger on `reports/{id}` | function logs |
| `llama3Chat`, `healthCheck` | Cloud Functions v2 HTTPS | function logs |
| Data | Cloud Firestore | Firebase console, Firestore Database |

## Check that polling is healthy

1. Firestore, document `meta/purpleair_poll`. `last_success_at` should be
   within the last 10 to 20 minutes. `fetched` should be roughly the number
   of PurpleAir sensors in the box (about 40). If `last_error` is present,
   read it first.
2. Logs:

   ```bash
   firebase functions:log --only pollPurpleAir
   ```

   Every run logs `PurpleAir poll complete` with counts, or
   `PurpleAir poll failed, skipping this cycle` with the error. A 429 shows
   as `PurpleAir 429, backing off` before the retry.
3. The map footer shows "Data may be stale" when the newest sensor update is
   older than 30 minutes.

Common causes: the `PURPLEAIR_API_KEY` secret is missing or was rotated
without redeploying (see below); the PurpleAir account is out of points;
the Cloud Scheduler job was paused.

## Rotate a key

Secrets live in Firebase Secret Manager. They are never in git or in the
browser bundle.

```bash
# 1. Create the new key with the provider, then store it:
firebase functions:secrets:set PURPLEAIR_API_KEY     # or TOGETHER_API_KEY
# 2. Functions bind a secret version at deploy time, so redeploy:
firebase deploy --only functions
# 3. Confirm the next poll succeeds (meta/purpleair_poll), then revoke the old
#    key with the provider and prune old versions:
firebase functions:secrets:prune
```

Firebase web config values in `frontend/.env` (API key, app id) are not
secrets. If they change, rebuild and redeploy hosting.

## Adjust thresholds

All tunables are constants in code. Change, run `npm test` in `functions/`,
then `firebase deploy --only functions`.

| Setting | File | Default |
| --- | --- | --- |
| Bounding box | `functions/src/purpleair/config.ts` `BOUNDING_BOX` | nw 40.45, -80.05; se 40.20, -79.75 |
| Fields requested (cost) | `functions/src/purpleair/config.ts` `REQUESTED_FIELDS` | 13 fields |
| Exclusion: min confidence | `functions/src/purpleair/config.ts` `EXCLUSION.minConfidence` | 70 |
| Exclusion: max age | `functions/src/purpleair/config.ts` `EXCLUSION.maxAgeSeconds` | 7200 (2 h) |
| Poll frequency | `functions/src/purpleair/poll.ts` `schedule` | `every 10 minutes` |
| Reading retention | `functions/src/purpleair/config.ts` `READING_RETENTION_DAYS` and the TTL in `firestore.indexes.json` | 30 days |
| Correction equation | `functions/src/lib/correction.ts` `CORRECTION_MODEL` | `barkjohn_2021` |
| AQI breakpoints | `functions/src/lib/aqi.ts` and `frontend/src/lib/aqi.ts` | EPA 2024 |
| Aggregate suppression floor | `functions/src/reports/aggregate.ts` `MIN_REPORTS_PER_BUCKET` | 3 |
| Stale-data banner | `frontend/src/components/SensorMap.tsx` `STALE_AFTER_MS` | 30 min |

Changing the poll frequency or field list changes PurpleAir point usage:
requests per month times (1 + sensors times fields times per-field cost).

## Add a municipality

The list is duplicated in three places on purpose (rules cannot import
code). Update all three, then deploy rules and functions and rebuild the
frontend.

1. `functions/src/lib/municipalities.ts`
2. `frontend/src/lib/municipalities.ts`
3. `firestore.rules`, function `isMunicipality`

Then `cd rules-tests && npm test` to confirm the rules still pass, and
`firebase deploy --only firestore:rules,functions` followed by a hosting
deploy.

## Grant or revoke admin

Admins can read all `reports` and the legacy `symptomReports`. Set the
claim with the Admin SDK using a service account, never from the client:

```bash
node -e "
const admin = require('firebase-admin'); admin.initializeApp();
admin.auth().setCustomUserClaims(process.argv[1], { admin: true }).then(() => console.log('ok'));
" <uid>
```

Revoke with `{ admin: null }`. The user must sign out and in again.

## Delete the legacy `symptomReports` collection

It contains full names and ages collected by the pre-Stage 1 form. Export
if needed, then delete:

```bash
gcloud firestore export gs://<bucket>/symptomReports-backup --collection-ids=symptomReports
firebase firestore:delete symptomReports --recursive --yes
```

Afterwards remove the `symptomReports` block from `firestore.rules`.

## Local development

```bash
(cd functions && npm run build)
firebase emulators:start                     # auth 9099, firestore 8080, functions 5001, UI 4000
(cd frontend && REACT_APP_USE_EMULATORS=true npm start)
```

Run the poller once in the emulator with a real key in
`functions/.secret.local`: `cd functions && npm run shell`, then
`pollPurpleAir()`.

## Test suites

| Suite | Command | What it covers |
| --- | --- | --- |
| Functions unit | `cd functions && npm test` | correction, AQI, transform, backoff, poll loop, aggregates |
| Frontend unit | `cd frontend && CI=true npm test -- --watchAll=false` | map, dashboard, report form, app shell |
| Firestore rules | `cd rules-tests && npm test` | every allow/deny in `firestore.rules`, in the emulator |
| End to end | `cd e2e && npm run build:frontend && npm test` | seeds sensors, files reports through anonymous auth, checks the aggregate trigger, drives the built app in a headless browser |

## Not yet built

Threshold alerts (subscriptions, municipality status, push, email, SMS) are
specified in the Stage 1 plan but deliberately deferred. Nothing in the
current system sends messages to anyone.
