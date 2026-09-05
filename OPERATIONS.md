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
| `onPollComplete` | Cloud Functions v2 Firestore trigger on `meta/purpleair_poll` | function logs, `alert_log` |
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

## Check that alerts are healthy

1. `municipality_status/<name>` documents should update every poll; each
   holds the last 6 readings in `history`.
2. `alert_log` records every attempted send with `status` and any provider
   `error`. Query by `municipality` or `uid` (indexes exist for both).
3. Logs: `firebase functions:log --only onPollComplete`. Each run logs
   `Alert evaluation complete` with counts of sends and failures, and one
   `Alert decision` line per message.

If `alert_log` shows `failed` with `not configured`, the secret is missing.
If nothing is ever sent, check that a subscription exists and that the
municipality's `history` has two consecutive polls at or above the level.

## Rotate a key

Secrets live in Firebase Secret Manager. They are never in git or in the
browser bundle.

```bash
# 1. Create the new key with the provider, then store it:
firebase functions:secrets:set PURPLEAIR_API_KEY     # or TOGETHER_API_KEY, SENDGRID_API_KEY,
                                                     # TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
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
| Alert radius and centroids | Firestore `config/municipalities` (no deploy) | 2 km, borough centres |
| Consecutive polls before alerting | `functions/src/alerts/config.ts` `CONSECUTIVE_POLLS_REQUIRED` | 2 |
| Re-send gap for the same level | `functions/src/alerts/config.ts` `RESEND_AFTER_MS` | 3 h |
| Alert thresholds offered | `functions/src/alerts/decide.ts` `THRESHOLD_CATEGORY` and `frontend/src/types/alerts.ts` | USG, Unhealthy |
| Message wording | `functions/src/alerts/messages.ts` | see file |
| SMS on or off | `SMS_ALERTS_ENABLED` param in `functions/.env` and `REACT_APP_SMS_ALERTS_ENABLED` | off |

Changing the poll frequency or field list changes PurpleAir point usage:
requests per month times (1 + sensors times fields times per-field cost).

## Add a municipality

The list is duplicated on purpose (rules cannot import code). Update all of
these, then deploy rules and functions and rebuild the frontend.

1. `functions/src/lib/municipalities.ts`
2. `frontend/src/lib/municipalities.ts`
3. `firestore.rules`: the lists in `isMunicipality` and `isValidSubscription`
4. `functions/src/alerts/config.ts` `DEFAULT_CENTROIDS`, and add the same
   centroid to the live `config/municipalities` document in Firestore

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

## Turn SMS alerts on

SMS is off by default because every message costs money.

1. Set the three Twilio secrets (see Rotate a key).
2. In `functions/.env` set `SMS_ALERTS_ENABLED=true` and redeploy functions.
3. In `frontend/.env` set `REACT_APP_SMS_ALERTS_ENABLED=true`, rebuild, and
   redeploy hosting so the option appears in the Alerts screen.

Twilio handles STOP replies automatically for US numbers; the subscription
document stays until the resident turns alerts off in the app.

## Test an alert without waiting for bad air

In the emulator: `cd e2e && npm test` seeds sensors that put Glassport into
Unhealthy for Sensitive Groups, subscribes a test device, writes two poll
completions, and checks `alert_log`. In production, set `ALERT_DRY_RUN=true`
in `functions/.env`, redeploy, subscribe yourself, and temporarily lower
`THRESHOLD_CATEGORY` or wait for a real episode; entries land in `alert_log`
with `provider_message_id: "dry-run"`. Remember to set it back to false.
