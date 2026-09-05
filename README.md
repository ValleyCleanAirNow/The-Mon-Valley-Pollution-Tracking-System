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
- **Symptom reports.** Community health reports (being restructured to the
  Odor, Symptoms, Actions, Cause framework in Stage 1).
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

### Tests

```bash
(cd functions && npm test)      # jest: correction, AQI, transform, backoff, poll
(cd frontend && CI=true npm test -- --watchAll=false)
```

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
and tests both packages, and deploys on pushes to `main`.

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

### Legacy collections

`symptomReports`, `users`, `healthAssessments` predate Stage 1 and are being
replaced. Their rules remain in `firestore.rules` until the reports work item
migrates them.

## Repository layout

```
frontend/            React app (Create React App)
  src/components/    SensorMap, Dashboard, SymptomReportForm, BreatheAI
  src/hooks/         useSensors (Firestore onSnapshot)
  src/lib/aqi.ts     Client AQI helpers (mirror of functions/src/lib/aqi.ts)
functions/           Cloud Functions
  src/purpleair/     Poller: config, client (backoff), transform, poll
  src/lib/           AQI and EPA correction
  test/              Jest unit tests
firestore.rules      Security rules
firestore.indexes.json  Indexes and the readings TTL policy
docs/                Planning and protocol documents
rag_ingest/          Offline scripts that build the BreatheAI knowledge base
```

## License

MIT.
