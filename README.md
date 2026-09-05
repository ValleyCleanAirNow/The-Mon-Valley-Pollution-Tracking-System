# Mon Valley Pollution Tracking System

Community air-quality map, symptom reporting, and the BreatheAI assistant for
the Monongahela Valley in Allegheny County, Pennsylvania. Built for
[Valley Clean Air Now (VCAN)](https://valleycleanair.com).

Contact: Qiyam Ansari, Executive Director, VCAN, qiyam@valleycleanair.com

## What it does

- **Sensor map.** PurpleAir PM2.5 sensors across the Mon Valley, corrected with
  the EPA (Barkjohn 2021) equation and coloured by the 2024 US AQI categories.
  Sensors that are indoor, low confidence, or silent for over two hours are
  shown but flagged and left out of public averages.
- **Community dashboard.** Mon Valley average corrected PM2.5 and AQI, with
  plain-language guidance.
- **Community reports.** A one-minute Odor, Symptoms, Actions, suspected
  Cause form. Reports are pseudonymous (Firebase Anonymous Auth), readable
  only by their author, and published only as hourly per-municipality
  aggregates once three or more people report in the same hour.
- **BreatheAI.** Chat assistant for air quality and health questions.

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Create React App, react-leaflet, Firebase JS SDK |
| Backend | Firebase Cloud Functions v2 (Node 22, TypeScript) |
| Data | Cloud Firestore |
| Hosting | Firebase Hosting |
| Secrets | Firebase Secret Manager via `defineSecret` |

Third-party APIs (PurpleAir, Together AI) are called only from Cloud
Functions. The browser never holds an API key; it reads Firestore.

```
PurpleAir API ──(every 10 min)──> pollPurpleAir ──> Firestore sensors/{id}
                                                        └── readings/{ts}  (30 day TTL)
                                                              │
Browser <──── onSnapshot ───────────────────────────────────┘
```

## Setup

### Prerequisites

- Node.js 22 (functions) and 18+ (frontend)
- Firebase CLI: `npm install -g firebase-tools`, then `firebase login`
- Java 11+ for the Firestore emulator
- A Firebase project on the **Blaze** plan (scheduled functions and outbound
  HTTP require it). Project id: `mv-pollution-tracking-system`.

### Install

```bash
git clone <repo-url>
cd The-Mon-Valley-Pollution-Tracking-System
(cd functions && npm ci)
(cd frontend && npm ci)
```

### Configure the frontend

```bash
cp frontend/.env.example frontend/.env
# fill in the Firebase web app config from the Firebase console
```

### Configure server secrets

Secrets are never committed. Set each one once per project:

```bash
firebase functions:secrets:set PURPLEAIR_API_KEY   # read key from develop.purpleair.com
firebase functions:secrets:set TOGETHER_API_KEY    # BreatheAI chat
```

`functions/.env.example` lists every secret the functions expect.

### Run locally with the emulator suite

```bash
# Terminal 1: functions + firestore + auth + hosting emulators
cp functions/.env.example functions/.secret.local   # fill in values for local testing
(cd functions && npm run build)
firebase emulators:start

# Terminal 2: frontend dev server
(cd frontend && npm start)
```

To trigger the poller by hand in the emulator, open the Functions shell
(`cd functions && npm run shell`) and run `pollPurpleAir()`.

### Enable Anonymous sign-in (one time)

The report form signs every device in anonymously so reports carry a stable
pseudonymous `uid`. In the Firebase console open Authentication, Sign-in
method, and enable **Anonymous**. Until this is on, the form shows
"Reporting is not enabled yet".

### Grant an admin

Admins can read every report. Set the custom claim once per admin account
with the Admin SDK (never from the client):

```js
// node -e "..." with GOOGLE_APPLICATION_CREDENTIALS set
const admin = require('firebase-admin');
admin.initializeApp();
admin.auth().setCustomUserClaims('<uid>', { admin: true });
```

### Tests

```bash
(cd functions && npm test)      # jest: correction, AQI, transform, backoff, poll, aggregates
(cd frontend && CI=true npm test -- --watchAll=false)
(cd rules-tests && npm install && npm test)   # Firestore rules against the emulator
(cd e2e && npm install && npm run build:frontend && npm test)   # full smoke test in the emulator
```

The end-to-end test seeds sensors, files anonymous reports under the real
rules, checks the aggregation trigger, and drives the built app in headless
Chromium. See `e2e/README.md` and OPERATIONS.md.

## Deployment

```bash
(cd frontend && npm run build)
firebase deploy --only firestore:rules,firestore:indexes   # rules + TTL policy
firebase deploy --only functions
firebase deploy --only hosting
```

Deploying `firestore:indexes` applies the 30 day TTL policy on
`readings.expires_at` (declared in `firestore.indexes.json`). A TTL policy can
take up to 24 hours to become active and deletes lazily, typically within a
day of expiry. To verify:

```bash
gcloud firestore fields ttls list --collection-group=readings --project=mv-pollution-tracking-system
```

CI (`.github/workflows/ci-cd.yml`) runs a full-history secret scan, builds
and tests both packages, runs the Firestore rules tests in the emulator, and
deploys on pushes to `main`. Cloud Storage is not used; `storage.rules`
denies everything.

## PurpleAir API usage

The poller requests 13 fields for every sensor in the bounding box every 10
minutes (4,320 requests per month). PurpleAir charges per request plus per
sensor per field. With roughly 40 sensors that is about 4.5 million points a
month. To reduce cost, trim `REQUESTED_FIELDS` or lengthen the schedule in
`functions/src/purpleair/config.ts` and `poll.ts`.

## Data dictionary

All timestamps are Firestore `Timestamp` values unless noted.

### `sensors/{sensorIndex}`

Latest snapshot per sensor. Document id is the PurpleAir `sensor_index`.
Written only by `pollPurpleAir`; public read.

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | string | Data source, `purpleair`. Later stages add `airnow`, `smellpgh`, etc. |
| `source_id` | string | Id within the source (PurpleAir `sensor_index`). |
| `name` | string | Sensor name as registered with PurpleAir. |
| `lat`, `lng` | number | Location in decimal degrees. |
| `location_type` | number or null | PurpleAir: 0 outdoor, 1 indoor. |
| `pollutant` | string | `pm25`. |
| `units` | string | `ug/m3`. |
| `raw` | map | Unmodified PurpleAir fields: `pm25_cf_1`, `pm25_atm`, `pm25_10minute`, `pm25_60minute`, `pm25_24hour`, `humidity`, `temperature`, `confidence`, `last_seen` (Unix seconds). |
| `pm25_corrected` | number or null | `max(0, 0.524 * pm25_cf_1 - 0.0862 * humidity + 5.75)`, one decimal. Null when inputs are missing. |
| `correction_model` | string | Equation used, currently `barkjohn_2021`. |
| `aqi` | number or null | US AQI from `pm25_corrected`, 2024 breakpoints. |
| `aqi_category` | string or null | `Good`, `Moderate`, `Unhealthy for Sensitive Groups`, `Unhealthy`, `Very Unhealthy`, `Hazardous`. |
| `excluded` | boolean | True if the sensor must not count toward public averages. |
| `exclude_reason` | string or null | Comma-joined reasons: `low_confidence` (< 70), `indoor`, `stale` (> 2 h), `missing_data`. |
| `last_seen_at` | Timestamp or null | Sensor's own last report time. |
| `updated_at` | Timestamp | Time of the poll that wrote this snapshot. |

### `sensors/{sensorIndex}/readings/{isoTimestamp}`

One document per sensor per poll. Document id is the poll time in ISO-8601.
Retained 30 days via a TTL policy on `expires_at`.

| Field | Type | Meaning |
| --- | --- | --- |
| `source`, `pollutant`, `units` | string | As above. |
| `pm25_cf_1`, `pm25_atm`, `humidity`, `temperature`, `confidence` | number or null | Raw values at poll time. |
| `pm25_corrected`, `correction_model`, `aqi`, `aqi_category` | see above | Derived values at poll time. |
| `excluded`, `exclude_reason` | see above | Exclusion status at poll time. |
| `observed_at` | Timestamp or null | Sensor `last_seen`. |
| `polled_at` | Timestamp | Poll time. |
| `expires_at` | Timestamp | `polled_at` + 30 days. TTL field. |

### `meta/purpleair_poll`

Status of the most recent poll. Public read.

| Field | Type | Meaning |
| --- | --- | --- |
| `last_run_at` | Timestamp | Start of the most recent run. |
| `last_success_at` | Timestamp | Most recent run that wrote data. |
| `last_error`, `last_error_at` | string, Timestamp | Present after a failed run. |
| `fetched`, `included`, `excluded` | number | Row counts from the last run. |
| `data_time_stamp` | number or null | PurpleAir's server data timestamp (Unix seconds). |

### `reports/{reportId}`

One community report. Created by the client under Firebase Anonymous Auth.
Readable and deletable only by its author (`uid`) or an admin claim. Never
listed publicly. `firestore.rules` rejects any document with keys outside
this table, which is what keeps names, emails and phone numbers out.

| Field | Type | Meaning |
| --- | --- | --- |
| `uid` | string | Anonymous Auth uid of the reporting device. Must equal the caller. |
| `schema_version` | number | `2`. |
| `odor.present` | boolean | Whether an odor was noticed. |
| `odor.types` | string[] | Any of `rotten_eggs_sulfur`, `tar_asphalt`, `burning_smoke`, `chemical_solvent`, `metallic`, `sweet`, `other`. |
| `odor.intensity` | 1 to 5 or null | Strength of the odor. Null when `present` is false. |
| `symptoms.list` | string[] | Any of `coughing`, `wheezing`, `shortness_of_breath`, `chest_tightness`, `throat_irritation`, `eye_irritation`, `headache`, `nausea`, `dizziness`, `fatigue`, `none`, `other`. |
| `symptoms.severity` | 1 to 5 or null | Overall severity. Null when the list is `none`. |
| `actions` | string[] | Any of `closed_windows`, `stayed_inside`, `used_inhaler_or_medication`, `ran_air_purifier`, `left_area`, `called_achd`, `none`, `other`. |
| `cause` | string | One of `clairton_coke_works`, `edgar_thomson_works`, `irvin_works`, `traffic`, `other_industry`, `dont_know`, `other`. |
| `occurred_at` | Timestamp | When the reporter says it happened. |
| `hour_bucket` | string | UTC hour of `occurred_at`, `YYYY-MM-DDTHH`. Aggregation key. |
| `municipality` | string | One of the municipalities in `functions/src/lib/municipalities.ts`. |
| `location` | map or null | `{lat, lng}` rounded to 3 decimals (about 100 m), inside the Mon Valley box. Never a street address. |
| `note` | string or null | Free text, at most 500 characters. |
| `created_at` | Timestamp | Server time; the rules require `request.time`. |

### `aggregates/{municipality}_{hourBucket}`

Hourly summary per municipality, maintained by the `aggregateReports`
trigger on every report write. **Buckets with fewer than 3 reports are
deleted, not written**, so a lone report can never be inferred. Public read.
This is what the map and dashboard use.

| Field | Type | Meaning |
| --- | --- | --- |
| `municipality` | string | Municipality name. |
| `hour_bucket` | string | UTC hour, `YYYY-MM-DDTHH`. |
| `hour_start` | Timestamp | Start of that hour. |
| `report_count` | number | Reports in the bucket (always 3 or more). |
| `odor_present_count` | number | Reports with `odor.present` true. |
| `top_symptoms`, `top_odors`, `top_actions`, `top_causes` | `{value, count}[]` | Up to 5 most common values; `none` is excluded. |
| `mean_symptom_severity`, `mean_odor_intensity` | number or null | Means to one decimal. |
| `updated_at` | Timestamp | Last recompute. |

### Legacy collections

`symptomReports`, `users`, `healthAssessments` predate Stage 1. Nothing
writes to them any more. `symptomReports` is admin read-only and is removed
in the cleanup work item.

## Repository layout

```
frontend/            React app (Create React App)
  src/components/    SensorMap, AqiLegend, Dashboard, SymptomReportForm, BreatheAI
  src/hooks/         useSensors, useAggregates, useMyReports, useAnonymousAuth
  src/lib/           aqi.ts (mirror of functions/src/lib/aqi.ts), municipalities.ts
  src/types/         sensor.ts, report.ts
functions/           Cloud Functions
  src/purpleair/     Poller: config, client (backoff), transform, poll
  src/reports/       Report schema and the aggregateReports trigger
  src/lib/           AQI, EPA correction, municipalities
  test/              Jest unit tests
rules-tests/         Firestore security rules tests (emulator)
e2e/                 End-to-end smoke test (emulator + headless Chromium)
firestore.rules      Security rules
firestore.indexes.json  Indexes and the readings TTL policy
OPERATIONS.md        Runbook: keys, logs, thresholds, municipalities
docs/                Planning and protocol documents; docs/archive/ is pre-Stage 1
rag_ingest/          Offline scripts that build the BreatheAI knowledge base
```

## Status

Stage 1 work items 1 (server-side PurpleAir polling), 2 (community reports
and aggregates), and 4 (cleanup and handoff) are complete. Work item 3,
threshold alerts, is deferred; nothing in the system sends notifications.

## License

MIT.
