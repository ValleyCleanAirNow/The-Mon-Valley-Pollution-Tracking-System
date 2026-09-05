# Phase 0 security remediation

This phase removes the confirmed credential exposures from the TRACKER source tree and establishes a blocking full-history secret scan. It does not deploy Firebase, change the WEBSITE, or alter production data.

## Source changes

| Area | Remediation |
| --- | --- |
| Together AI | The unauthenticated `testTogetherAI` and `testTogetherAINew` endpoints are removed. `llama3Chat` reads `TOGETHER_API_KEY` through `defineSecret` and declares the secret in its HTTPS function options. Credential-derived debug output is removed. |
| EPA AQS | The generated response `Header` is removed from `rag_data/epa_aqs.json`. Generated `rag_data/*.json` files are ignored, and the ingestion README documents environment-only credentials plus a pre-commit header check. |
| PurpleAir | The browser console statement that printed `REACT_APP_PURPLEAIR_API_KEY` is removed. The remaining browser-direct integration is intentionally deferred to Phase 1, where the key moves to Firebase Secret Manager. |
| Firebase web configuration | The helper no longer contains project-specific web configuration values; it writes `frontend/.env` only from explicitly supplied environment variables. |
| Build | The TypeScript compiler is aligned with the current test declarations. Library declaration checking is skipped, while strict checking remains enabled for application source. |

## CI behavior

The `secret-scan` job runs before frontend and Functions jobs. It checks out full history and runs gitleaks in a pinned container; any finding fails the workflow. The repository configuration extends the default gitleaks rules with an EPA AQS URL-credential rule scoped to generated JSON under `rag_data/`.

## Required secret names

The Phase 0 code refers only to secret names. Firebase Secret Manager must contain `TOGETHER_API_KEY` before `llama3Chat` is deployed. Phase 1 adds `PURPLEAIR_API_KEY`, `OPENWEATHER_API_KEY`, `EPA_AQS_EMAIL`, and `EPA_AQS_KEY` to the relevant functions; values must never be committed or placed in PR text.

## Rotation and history rewrite

Removing a value from the current tree does not remove it from Git history. Before the rewrite, VCAN must confirm rotation of the Together AI and EPA AQS credentials; PurpleAir rotation is also recommended because the former frontend logged it at runtime. The rewrite will use exact-value replacements, cover every ref, create a backup bundle, and require collaborators to clone again afterward. No force update is performed without a separate explicit confirmation.

## Local verification

From `functions/`, run `npm ci --ignore-scripts` and `npm run build`. From the repository root, run a current-tree gitleaks scan and, after the approved rewrite, a full-history scan. A clean result must contain zero findings under both the default rules and the repository’s AQS rule.
