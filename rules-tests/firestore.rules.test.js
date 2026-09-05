/**
 * Firestore security rules tests. Requires the Firestore emulator:
 *   cd rules-tests && npm install && npm test
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, addDoc, collection, getDocs, query, where, serverTimestamp, Timestamp, deleteDoc, updateDoc } = require('firebase/firestore');

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-mvpts',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

function validReport(uid, over = {}) {
  return {
    uid,
    schema_version: 2,
    odor: { present: true, types: ['rotten_eggs_sulfur'], intensity: 3 },
    symptoms: { list: ['headache'], severity: 2 },
    actions: ['closed_windows'],
    cause: 'clairton_coke_works',
    occurred_at: Timestamp.fromDate(new Date('2026-09-05T14:10:00Z')),
    hour_bucket: '2026-09-05T14',
    municipality: 'Clairton',
    location: null,
    note: null,
    created_at: serverTimestamp(),
    ...over,
  };
}

describe('sensors and aggregates', () => {
  test('anyone can read sensors, readings, meta, aggregates', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'sensors/1'), { name: 'A' });
      await setDoc(doc(db, 'sensors/1/readings/t'), { aqi: 1 });
      await setDoc(doc(db, 'meta/purpleair_poll'), { ok: true });
      await setDoc(doc(db, 'aggregates/Clairton_2026-09-05T14'), { report_count: 3 });
    });
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'sensors/1')));
    await assertSucceeds(getDoc(doc(db, 'sensors/1/readings/t')));
    await assertSucceeds(getDoc(doc(db, 'meta/purpleair_poll')));
    await assertSucceeds(getDoc(doc(db, 'aggregates/Clairton_2026-09-05T14')));
  });

  test('nobody can write sensors or aggregates from the client', async () => {
    const admin = env.authenticatedContext('admin', { admin: true }).firestore();
    await assertFails(setDoc(doc(admin, 'sensors/1'), { name: 'x' }));
    await assertFails(setDoc(doc(admin, 'aggregates/x'), { report_count: 9 }));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'sensors/1'), { name: 'x' }));
  });
});

describe('reports', () => {
  test('a signed-in device can create a valid report with its own uid', async () => {
    const db = env.authenticatedContext('device-a').firestore();
    await assertSucceeds(addDoc(collection(db, 'reports'), validReport('device-a')));
  });

  test('unauthenticated users cannot create reports', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a')));
  });

  test('cannot spoof another uid', async () => {
    const db = env.authenticatedContext('device-a').firestore();
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-b')));
  });

  test('rejects identity fields', async () => {
    const db = env.authenticatedContext('device-a').firestore();
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a', { name: 'Pat' })));
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a', { email: 'p@example.com' })));
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a', { phone: '412' })));
  });

  test('rejects unknown municipality, bad scales, long notes, far-away location', async () => {
    const db = env.authenticatedContext('device-a').firestore();
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a', { municipality: 'Pittsburgh' })));
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a', { odor: { present: true, types: ['sweet'], intensity: 9 } })));
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a', { note: 'x'.repeat(501) })));
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a', { location: { lat: 34.0, lng: -118.2 } })));
    await assertSucceeds(addDoc(collection(db, 'reports'), validReport('device-a', { location: { lat: 40.292, lng: -79.881 } })));
  });

  test('rejects a client-supplied created_at', async () => {
    const db = env.authenticatedContext('device-a').firestore();
    await assertFails(addDoc(collection(db, 'reports'), validReport('device-a', { created_at: Timestamp.fromDate(new Date('2020-01-01')) })));
  });

  test('only the author (and admins) can read a report; others cannot list', async () => {
    let id;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), 'reports'), validReport('device-a', { created_at: Timestamp.now() }));
      id = ref.id;
    });
    await assertSucceeds(getDoc(doc(env.authenticatedContext('device-a').firestore(), `reports/${id}`)));
    await assertFails(getDoc(doc(env.authenticatedContext('device-b').firestore(), `reports/${id}`)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `reports/${id}`)));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('admin', { admin: true }).firestore(), `reports/${id}`)));

    const own = env.authenticatedContext('device-a').firestore();
    await assertSucceeds(getDocs(query(collection(own, 'reports'), where('uid', '==', 'device-a'))));
    const other = env.authenticatedContext('device-b').firestore();
    await assertFails(getDocs(collection(other, 'reports')));
    await assertFails(getDocs(query(collection(other, 'reports'), where('uid', '==', 'device-a'))));
  });

  test('author can delete but not change uid or created_at', async () => {
    let id;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), 'reports'), validReport('device-a', { created_at: Timestamp.now() }));
      id = ref.id;
    });
    const own = env.authenticatedContext('device-a').firestore();
    await assertFails(updateDoc(doc(own, `reports/${id}`), { uid: 'device-b' }));
    await assertFails(updateDoc(doc(own, `reports/${id}`), { created_at: Timestamp.now() }));
    await assertFails(deleteDoc(doc(env.authenticatedContext('device-b').firestore(), `reports/${id}`)));
    await assertSucceeds(deleteDoc(doc(own, `reports/${id}`)));
  });
});

describe('legacy symptomReports', () => {
  test('is admin read-only', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'symptomReports/x'), { userId: 'u' });
    });
    await assertFails(getDoc(doc(env.authenticatedContext('u').firestore(), 'symptomReports/x')));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('admin', { admin: true }).firestore(), 'symptomReports/x')));
    await assertFails(setDoc(doc(env.authenticatedContext('u').firestore(), 'symptomReports/y'), { userId: 'u' }));
  });
});
