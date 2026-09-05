# Legacy Cloud Functions (deployed December 2025)

Archived source of the Cloud Functions that were running in the
`mv-pollution-tracking-system` project before Stage 1 but were never
committed to this repository. Recovered on 2026-09-05 from the Cloud
Functions source bucket (`gcf-sources-245354192374-us-central1`) after the
Stage 1 deploy removed them.

**Nothing here is deployed or built.** It is kept so the work is not lost
and can be ported onto the Stage 1 data model when a later stage needs it.

## What was removed from the project

45 first-generation functions, all `us-central1`, last deployed 2025-12-03.
Their source is in `src/`; `index.ts` re-exports the modules listed below.

| Area | Modules |
| --- | --- |
| Data warehouse | `syncToAzure.ts`, `azureDataLake.ts`, `exportToBigQuery.ts`, `exportToSynapse.ts` |
| Health data pipeline | `aggregateHealthData.ts`, `dataIntegrity.ts`, `hipaaCompliance.ts`, `auditLogging.ts`, `vcanDataAccess.ts` |
| Regulatory | `automatedRegulatoryReporting.ts`, `breachNotification.ts`, `epaEchoService.ts`, `epaEchoNoncomplianceService.ts`, `epaTriService.ts` |
| External data | `achdScraper.ts`, `acqdDataService.ts`, `nasaTempoService.ts`, `openAQService.ts`, `sniffer4dService.ts`, `wprdcService.ts` |
| HTTP endpoints in `index.ts` | Title V facilities, ACHD air quality, wind, Smell PGH, risk calculation, an older PurpleAir fetcher, and the pre-Stage 1 BreatheAI proxy |

## What was changed before archiving

- Three hardcoded copies of the Together AI key in `index.ts` were replaced
  with `process.env.TOGETHER_API_KEY`. That key should be considered
  exposed and rotated if it has not been already.
- `.env` and `.runtimeconfig.json` were **not** copied. They held EPA AQS,
  OpenAQ, PurpleAir, OpenWeather, Together AI and an admin secret. Those
  values still exist in the source bucket archives and in the providers'
  dashboards; rotate any that are still in use.
- `node_modules`, `coverage`, and compiled `lib/` were dropped.

## Why they were removed

`firebase deploy --only functions --force` deletes any function that exists
in the project but not in the deployed source, and this repository never
contained these. The Stage 1 functions (`pollPurpleAir`, `onPollComplete`,
`aggregateReports`, `llama3Chat`, `healthCheck`) replaced the parts that
the app uses. If any of the removed functions was feeding an external
system (a BigQuery dataset, an Azure Data Lake, Synapse), that feed stopped
on 2026-09-05.
