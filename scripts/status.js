#!/usr/bin/env node
/**
 * Print production status: last poll, sensor counts, municipality status,
 * seeded centroids, and recent alert log. Read-only.
 *
 * Auth: uses Application Default Credentials. Run one of
 *   gcloud auth application-default login
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 * Requires functions/node_modules (run `npm ci` in functions/ first).
 */
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT = process.env.FIREBASE_PROJECT || 'mv-pollution-tracking-system';
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const fmt = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleString() : String(ts ?? 'n/a'));

(async () => {
  console.log(`Project: ${PROJECT}\n`);

  const poll = await db.collection('meta').doc('purpleair_poll').get();
  console.log('== Last poll (meta/purpleair_poll)');
  if (!poll.exists) console.log('  none yet. The scheduler runs every 10 minutes after functions deploy.');
  else {
    const p = poll.data();
    console.log(`  last_run_at      ${fmt(p.last_run_at)}   ok=${p.ok}`);
    console.log(`  last_success_at  ${fmt(p.last_success_at)}`);
    console.log(`  fetched ${p.fetched}  included ${p.included}  excluded ${p.excluded}`);
    if (p.last_error) console.log(`  last_error       ${p.last_error} (${fmt(p.last_error_at)})`);
  }

  const sensors = await db.collection('sensors').get();
  const byCat = {};
  sensors.forEach((d) => { const c = d.data().excluded ? 'excluded' : d.data().aqi_category || 'no data'; byCat[c] = (byCat[c] || 0) + 1; });
  console.log(`\n== Sensors: ${sensors.size}`);
  for (const [k, v] of Object.entries(byCat)) console.log(`  ${v.toString().padStart(3)}  ${k}`);

  const cfg = await db.collection('config').doc('municipalities').get();
  console.log('\n== Centroids (config/municipalities)');
  if (!cfg.exists) console.log('  not seeded yet; created by the first successful poll.');
  else {
    const c = cfg.data();
    console.log(`  radius_km ${c.radius_km}`);
    const status = await db.collection('municipality_status').get();
    const st = {}; status.forEach((d) => { st[d.id] = d.data(); });
    console.log('  municipality          lat        lng        sensors  category');
    for (const [m, ll] of Object.entries(c.centroids).sort()) {
      const s = st[m] || {};
      console.log(`  ${m.padEnd(20)} ${ll.lat.toFixed(4)}  ${ll.lng.toFixed(4)}   ${String(s.sensor_count ?? '-').padStart(3)}     ${s.aqi_category ?? 'no data'}`);
    }
    console.log('  Municipalities with 0 sensors will never alert; widen radius_km or move the centroid.');
  }

  const subs = await db.collection('alert_subscriptions').count().get();
  const logs = await db.collection('alert_log').orderBy('timestamp', 'desc').limit(5).get();
  console.log(`\n== Alerts: ${subs.data().count} subscriptions, last ${logs.size} log entries`);
  logs.forEach((d) => { const l = d.data(); console.log(`  ${fmt(l.timestamp)}  ${l.municipality.padEnd(18)} ${l.kind.padEnd(9)} ${l.channel.padEnd(5)} ${l.status}${l.error ? '  ' + l.error : ''}`); });

  const legacy = await db.collection('symptomReports').count().get();
  console.log(`\n== Legacy symptomReports documents: ${legacy.data().count}${legacy.data().count > 0 ? '  (export and delete; see OPERATIONS.md)' : ''}`);
  process.exit(0);
})().catch((err) => { console.error(err.message); process.exit(1); });
