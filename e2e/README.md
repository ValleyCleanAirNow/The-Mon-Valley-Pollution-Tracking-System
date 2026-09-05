# End-to-end smoke test

Runs the whole system locally against the Firebase Emulator Suite, with no
PurpleAir key and no production project.

```bash
cd e2e
npm install
npm run build:frontend   # builds frontend/ pointed at the emulators
npm test                 # starts emulators, runs smoke.js, shuts down
```

`smoke.js` seeds five sensors through the poller's own transform and write
code (three usable, one indoor, one stale), files three anonymous reports
from Clairton and two from Glassport under the real security rules, waits
for the `aggregateReports` trigger, asserts the Clairton bucket is published
and the Glassport one is suppressed, then drives the built app in headless
Chromium: dashboard headline, map markers and popup, and a report submitted
through the form. Screenshots land in `e2e/screenshots/`.

Requires Java (for the Firestore emulator) and a Chromium that Playwright
can find.
