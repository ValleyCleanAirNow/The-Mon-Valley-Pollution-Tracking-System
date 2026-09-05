/**
 * End-to-end smoke test. Run via `npm test` in this directory, which wraps it
 * in `firebase emulators:exec --only auth,firestore,functions`.
 *
 * 1. Seeds the `sensors` collection through the same transform/write path the
 *    poller uses (no PurpleAir key needed).
 * 2. Signs in anonymously with the client SDK and files reports under the
 *    real security rules; checks the aggregateReports trigger publishes a
 *    bucket at 3 reports and not at 2.
 * 3. Drives the built frontend (frontend/build, built with
 *    REACT_APP_USE_EMULATORS=true) in headless Chromium: dashboard, map,
 *    and a report submission.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const FN = path.join(ROOT, 'functions');
const admin = require(path.join(FN, 'node_modules', 'firebase-admin'));
const { transformRow } = require(path.join(FN, 'lib', 'purpleair', 'transform.js'));
const { writeSensors } = require(path.join(FN, 'lib', 'purpleair', 'poll.js'));

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInAnonymously } = require('firebase/auth');
const {
  getFirestore, connectFirestoreEmulator, collection, addDoc, doc, getDoc, serverTimestamp, Timestamp,
} = require('firebase/firestore');

const PROJECT = 'demo-mvpts';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[smoke]', ...a);

async function waitFor(fn, { timeoutMs = 20000, every = 500, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await sleep(every);
  }
}

async function seedSensors(db) {
  const now = new Date();
  const sec = Math.floor(now.getTime() / 1000);
  const rows = [
    { sensor_index: 1001, name: 'Clairton Center', latitude: 40.292, longitude: -79.881, location_type: 0, last_seen: sec - 120, confidence: 100, humidity: 45, temperature: 70, 'pm2.5_cf_1': 12, 'pm2.5_atm': 10, 'pm2.5_10minute': 12, 'pm2.5_60minute': 11, 'pm2.5_24hour': 9 },
    { sensor_index: 1002, name: 'Glassport Riverfront', latitude: 40.325, longitude: -79.892, location_type: 0, last_seen: sec - 60, confidence: 95, humidity: 40, temperature: 70, 'pm2.5_cf_1': 70, 'pm2.5_atm': 55, 'pm2.5_10minute': 70, 'pm2.5_60minute': 65, 'pm2.5_24hour': 40 },
    { sensor_index: 1003, name: 'McKeesport Hill', latitude: 40.348, longitude: -79.864, location_type: 0, last_seen: sec - 30, confidence: 100, humidity: 50, temperature: 70, 'pm2.5_cf_1': 130, 'pm2.5_atm': 100, 'pm2.5_10minute': 130, 'pm2.5_60minute': 120, 'pm2.5_24hour': 80 },
    { sensor_index: 1004, name: 'Indoor Kitchen', latitude: 40.30, longitude: -79.87, location_type: 1, last_seen: sec - 30, confidence: 100, humidity: 40, temperature: 72, 'pm2.5_cf_1': 5, 'pm2.5_atm': 4, 'pm2.5_10minute': 5, 'pm2.5_60minute': 5, 'pm2.5_24hour': 5 },
    { sensor_index: 1005, name: 'Duquesne Stale', latitude: 40.37, longitude: -79.85, location_type: 0, last_seen: sec - 3 * 3600, confidence: 100, humidity: 40, temperature: 72, 'pm2.5_cf_1': 8, 'pm2.5_atm': 7, 'pm2.5_10minute': 8, 'pm2.5_60minute': 8, 'pm2.5_24hour': 8 },
  ];
  const results = rows.map((r) => transformRow(r, now)).filter(Boolean);
  await writeSensors(db, results, now);
  await db.collection('meta').doc('purpleair_poll').set({ last_run_at: now, ok: true, last_success_at: now, fetched: rows.length, included: 3, excluded: 2 });
  const cats = results.map((r) => `${r.sensor.name}: ${r.sensor.pm25_corrected} -> ${r.sensor.aqi_category}${r.sensor.excluded ? ' (excluded: ' + r.sensor.exclude_reason + ')' : ''}`);
  log('seeded sensors:\n  ' + cats.join('\n  '));
  assert.strictEqual(results.filter((r) => !r.sensor.excluded).length, 3);
  assert.strictEqual(results.find((r) => r.sensorIndex === '1004').sensor.exclude_reason, 'indoor');
  assert.strictEqual(results.find((r) => r.sensorIndex === '1005').sensor.exclude_reason, 'stale');
  assert.strictEqual(results.find((r) => r.sensorIndex === '1002').sensor.aqi_category, 'Unhealthy for Sensitive Groups');
}

function reportDoc(uid, municipality, occurred) {
  return {
    uid,
    schema_version: 2,
    odor: { present: true, types: ['rotten_eggs_sulfur'], intensity: 4 },
    symptoms: { list: ['headache', 'throat_irritation'], severity: 3 },
    actions: ['closed_windows'],
    cause: 'clairton_coke_works',
    occurred_at: Timestamp.fromDate(occurred),
    hour_bucket: occurred.toISOString().slice(0, 13),
    municipality,
    location: null,
    note: null,
    created_at: serverTimestamp(),
  };
}

async function fileReportsAndCheckAggregates(adminDb) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` });
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  const occurred = new Date();
  const bucket = occurred.toISOString().slice(0, 13);

  // Three different devices report from Clairton in the same hour.
  for (let i = 0; i < 3; i++) {
    await auth.signOut().catch(() => {});
    const cred = await signInAnonymously(auth);
    const ref = await addDoc(collection(db, 'reports'), reportDoc(cred.user.uid, 'Clairton', occurred));
    log(`report ${i + 1} filed by ${cred.user.uid.slice(0, 8)}… as ${ref.id}`);
    // Another device must not be able to read it.
    await auth.signOut();
    const other = await signInAnonymously(auth);
    await assert.rejects(getDoc(doc(db, 'reports', ref.id)), /permission|insufficient/i, 'cross-device read must fail');
    void other;
  }
  // Two devices report from Glassport: must stay suppressed.
  for (let i = 0; i < 2; i++) {
    await auth.signOut();
    const cred = await signInAnonymously(auth);
    await addDoc(collection(db, 'reports'), reportDoc(cred.user.uid, 'Glassport', occurred));
  }

  const agg = await waitFor(async () => {
    const snap = await adminDb.collection('aggregates').doc(`Clairton_${bucket}`).get();
    return snap.exists && snap.data().report_count >= 3 ? snap.data() : null;
  }, { label: 'Clairton aggregate from trigger' });
  log('aggregate published:', JSON.stringify({ report_count: agg.report_count, top_symptoms: agg.top_symptoms, top_odors: agg.top_odors }));
  assert.strictEqual(agg.report_count, 3);
  assert.strictEqual(agg.top_symptoms[0].count, 3);

  await sleep(3000);
  const glassport = await adminDb.collection('aggregates').doc(`Glassport_${bucket}`).get();
  assert.strictEqual(glassport.exists, false, 'Glassport bucket with 2 reports must be suppressed');
  log('Glassport bucket with 2 reports correctly suppressed');
  return { bucket };
}

async function checkAlerts(adminDb) {
  // Subscribe a test device to Glassport (seeded USG) and Clairton (seeded Good).
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, 'alerts');
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const cred = await signInAnonymously(auth);
  const uid = cred.user.uid;
  const { setDoc } = require('firebase/firestore');
  await setDoc(doc(db, 'alert_subscriptions', uid), {
    municipalities: ['Glassport', 'Clairton'],
    threshold: 'usg',
    channels: ['email', 'sms'],
    contact: { email: 'resident@example.test', phone: '+14125550100' },
    quiet_hours: null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  log('alert subscription saved for', uid.slice(0, 8) + '…');

  // First poll completion already happened in seedSensors (history length 1).
  const status1 = await waitFor(async () => {
    const s = await adminDb.collection('municipality_status').doc('Glassport').get();
    return s.exists ? s.data() : null;
  }, { label: 'municipality_status/Glassport' });
  assert.strictEqual(status1.aqi_category, 'Unhealthy for Sensitive Groups');
  assert.strictEqual(status1.sensor_count, 1);
  log('municipality_status: Glassport', status1.aqi_category, 'PM2.5', status1.pm25_corrected, '| Clairton', (await adminDb.collection('municipality_status').doc('Clairton').get()).data().aqi_category);
  let logs = await adminDb.collection('alert_log').get();
  assert.strictEqual(logs.size, 0, 'no alert after a single poll');

  // Second poll completion 10 minutes later: two consecutive USG polls -> alert.
  const later = new Date(Date.now() + 10 * 60 * 1000);
  await adminDb.collection('meta').doc('purpleair_poll').set({ last_run_at: later, ok: true, last_success_at: later, fetched: 5, included: 3, excluded: 2 });
  logs = await waitFor(async () => {
    const snap = await adminDb.collection('alert_log').get();
    return snap.size >= 2 ? snap : null;
  }, { label: 'alert_log entries after second poll' });
  const entries = logs.docs.map((d) => d.data());
  const channels = entries.map((e) => e.channel).sort();
  assert.deepStrictEqual(channels, ['email', 'sms']);
  for (const e of entries) {
    assert.strictEqual(e.uid, uid);
    assert.strictEqual(e.municipality, 'Glassport');
    assert.strictEqual(e.kind, 'alert');
    assert.strictEqual(e.level, 'Unhealthy for Sensitive Groups');
    assert.strictEqual(e.status, 'sent');
    assert.strictEqual(e.provider_message_id, 'dry-run');
  }
  const state = await adminDb.collection('alert_state').doc(`${uid}_Glassport`).get();
  assert.strictEqual(state.data().active, true);
  log('alert sent (dry run) on email + sms for Glassport after two consecutive USG polls; Clairton stayed quiet');

  // Third poll: same level again within 3 hours -> no new log entries.
  const third = new Date(Date.now() + 20 * 60 * 1000);
  await adminDb.collection('meta').doc('purpleair_poll').set({ last_run_at: third, ok: true, last_success_at: third, fetched: 5, included: 3, excluded: 2 });
  await sleep(4000);
  assert.strictEqual((await adminDb.collection('alert_log').get()).size, 2, 'same level must not be re-sent within 3 hours');
  log('no duplicate alert on third poll (3 hour re-send gap)');
  await adminDb.collection('alert_subscriptions').doc(uid).delete();
}

function serveBuild(dir, port) {
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.map': 'application/json' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(dir, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function driveBrowser() {
  const buildDir = path.join(ROOT, 'frontend', 'build');
  if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
    throw new Error('frontend/build missing. Run `npm run build:frontend` in e2e/ first.');
  }
  const { chromium } = require('playwright');
  const server = await serveBuild(buildDir, 5055);
  const shots = path.join(__dirname, 'screenshots');
  fs.mkdirSync(shots, { recursive: true });
  // CHROMIUM_PATH lets CI or a sandbox point at a pre-installed browser.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('http://127.0.0.1:5055/');
    await page.getByText(/Mon Valley air quality right now/).waitFor();
    await page.getByText(/^AQI \d+$/).waitFor({ timeout: 15000 });
    const aqiText = await page.getByText(/^AQI \d+$/).textContent();
    log('dashboard headline:', aqiText, '|', await page.locator('.dashboard__headline-category').textContent());
    assert.match(await page.locator('.dashboard__meta').textContent(), /3 of 5 PurpleAir sensors/);
    assert.match(await page.locator('.card__value').first().textContent(), /^\d+(\.\d)?$/);
    await page.screenshot({ path: path.join(shots, '1-dashboard.png'), fullPage: true });

    await page.getByRole('button', { name: /Sensor Map/ }).click();
    await page.getByText('3 of 5 sensors used in averages').waitFor({ timeout: 15000 });
    await waitFor(async () => (await page.locator('.leaflet-interactive').count()) === 5, { label: '5 map markers' });
    await page.locator('.leaflet-interactive').nth(1).click();
    await page.getByText(/Corrected PM2.5/).first().waitFor();
    log('map: 5 markers, popup shows', (await page.locator('.leaflet-popup-content').textContent()).slice(0, 90).replace(/\s+/g, ' '), '…');
    await page.screenshot({ path: path.join(shots, '2-map.png'), fullPage: true });

    await page.getByRole('button', { name: /Report Symptoms/ }).click();
    await page.getByText('Report what you noticed').waitFor();
    await page.getByRole('radio', { name: 'Yes' }).click();
    await page.getByRole('button', { name: 'Burning / smoke' }).click();
    await page.getByRole('radiogroup', { name: 'Odor intensity' }).getByText('3', { exact: true }).click();
    await page.getByRole('button', { name: 'Coughing' }).click();
    await page.getByRole('radiogroup', { name: 'Symptom severity' }).getByText('2', { exact: true }).click();
    await page.getByRole('button', { name: 'Stayed inside' }).click();
    await page.getByRole('radio', { name: 'Edgar Thomson Works' }).click();
    await page.getByLabel('Municipality').selectOption('Braddock');
    await page.screenshot({ path: path.join(shots, '3-report-form.png'), fullPage: true });
    await page.getByRole('button', { name: 'Send report' }).click();
    await page.getByText(/Your report was filed/).waitFor({ timeout: 15000 });
    await page.getByText(/Your reports on this device/).waitFor({ timeout: 15000 });
    log('report submitted from the browser; history shows it');
    await page.screenshot({ path: path.join(shots, '4-report-success.png'), fullPage: true });

    await page.getByRole('button', { name: /Alerts/ }).click();
    await page.getByText('Air quality alerts').waitFor();
    await page.getByRole('button', { name: 'Glassport' }).click();
    await page.getByLabel('Current air quality').getByText(/Unhealthy for Sensitive Groups/).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Email' }).click();
    await page.getByLabel('Email address').fill('resident@example.test');
    await page.getByRole('button', { name: 'Turn on alerts' }).click();
    await page.getByText(/Alerts saved/).waitFor({ timeout: 15000 });
    log('alert subscription saved from the browser; status badge shows Glassport USG');
    await page.screenshot({ path: path.join(shots, '5-alerts.png'), fullPage: true });

    const realErrors = errors.filter((e) => !/favicon|manifest|tile.openstreetmap|net::ERR/i.test(e));
    if (realErrors.length) log('browser console errors:', realErrors);
    assert.strictEqual(realErrors.length, 0, 'no browser errors');
  } finally {
    await browser.close();
    server.close();
  }
}

(async () => {
  admin.initializeApp({ projectId: PROJECT });
  const adminDb = admin.firestore();
  await seedSensors(adminDb);
  await fileReportsAndCheckAggregates(adminDb);
  await checkAlerts(adminDb);
  await driveBrowser();
  log('ALL CHECKS PASSED');
  process.exit(0);
})().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
