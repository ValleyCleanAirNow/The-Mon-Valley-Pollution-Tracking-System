import { haversineKm } from '../src/alerts/geo';
import { computeStatus } from '../src/alerts/status';
import { decide, isInQuietHours, localHHmm, nextState, AlertState } from '../src/alerts/decide';
import { composeAlert, composeImproving, emailText, smsText } from '../src/alerts/messages';
import { sendEmail, sendPush, sendSms, Providers } from '../src/alerts/deliver';
import { evaluateAlerts } from '../src/alerts/evaluate';
import { DEFAULT_CENTROIDS } from '../src/alerts/config';
import { MUNICIPALITIES } from '../src/lib/municipalities';

jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const T0 = new Date('2026-09-05T15:00:00.000Z'); // 11:00 in New York (EDT)
const min = (n: number) => new Date(T0.getTime() + n * 60000);

describe('geo and centroids', () => {
  it('haversine: Clairton to McKeesport is about 6.3 km', () => {
    const d = haversineKm(40.2923, -79.8817, 40.3479, -79.8642);
    expect(d).toBeGreaterThan(5.5);
    expect(d).toBeLessThan(7);
    expect(haversineKm(40, -80, 40, -80)).toBe(0);
  });
  it('has a default centroid for every municipality', () => {
    for (const m of MUNICIPALITIES) expect(DEFAULT_CENTROIDS[m]).toBeDefined();
  });
});

describe('computeStatus', () => {
  const sensors = [
    { id: 'a', lat: 40.293, lng: -79.882, pm25_corrected: 40, excluded: false }, // in Clairton
    { id: 'b', lat: 40.300, lng: -79.870, pm25_corrected: 60, excluded: false }, // ~1.3 km
    { id: 'c', lat: 40.293, lng: -79.882, pm25_corrected: 500, excluded: true }, // excluded
    { id: 'd', lat: 40.348, lng: -79.864, pm25_corrected: 10, excluded: false }, // McKeesport, far
    { id: 'e', lat: 40.293, lng: -79.882, pm25_corrected: null, excluded: false }, // no value
  ];
  it('averages non-excluded sensors within the radius', () => {
    const s = computeStatus('Clairton', DEFAULT_CENTROIDS.Clairton, 2, sensors, T0);
    expect(s.sensor_ids).toEqual(['a', 'b']);
    expect(s.pm25_corrected).toBe(50);
    expect(s.aqi_category).toBe('Unhealthy for Sensitive Groups');
    expect(s.history).toHaveLength(1);
  });
  it('returns nulls with no nearby sensors and caps history at 6', () => {
    const prev = Array.from({ length: 6 }, (_, i) => ({ at: min(-10 * (6 - i)), pm25_corrected: 5, aqi_category: 'Good' as const }));
    const s = computeStatus('Rankin', DEFAULT_CENTROIDS.Rankin, 2, sensors, T0, prev);
    expect(s.pm25_corrected).toBeNull();
    expect(s.aqi_category).toBeNull();
    expect(s.history).toHaveLength(6);
    expect(s.history[5].aqi_category).toBeNull();
  });
});

describe('decide', () => {
  const h = (cats: Array<string | null>) =>
    cats.map((c, i) => ({ at: min(-10 * (cats.length - 1 - i)), pm25_corrected: c ? 40 : null, aqi_category: c as any }));
  const USG = 'Unhealthy for Sensitive Groups';

  it('needs two consecutive polls at or above threshold', () => {
    expect(decide({ threshold: 'usg', history: h(['Good', USG]), state: null, now: T0 })).toMatchObject({ action: 'none' });
    expect(decide({ threshold: 'usg', history: h([USG, USG]), state: null, now: T0 })).toMatchObject({ action: 'alert', level: USG });
    expect(decide({ threshold: 'unhealthy', history: h([USG, USG]), state: null, now: T0 })).toMatchObject({ action: 'none' });
    expect(decide({ threshold: 'unhealthy', history: h(['Unhealthy', 'Very Unhealthy']), state: null, now: T0 })).toMatchObject({ action: 'alert', level: 'Very Unhealthy' });
  });

  it('does not resend the same level within 3 hours, but does when it rises or after 3 hours', () => {
    const state: AlertState = { active: true, last_level: USG, last_sent_at: min(-60) };
    expect(decide({ threshold: 'usg', history: h([USG, USG]), state, now: T0 })).toEqual({ action: 'none', reason: 'recently_sent' });
    expect(decide({ threshold: 'usg', history: h(['Unhealthy', 'Unhealthy']), state, now: T0 })).toMatchObject({ action: 'alert', level: 'Unhealthy' });
    const old: AlertState = { ...state, last_sent_at: min(-181) };
    expect(decide({ threshold: 'usg', history: h([USG, USG]), state: old, now: T0 })).toMatchObject({ action: 'alert' });
  });

  it('sends improving only after two clear polls and only when an alert is active', () => {
    const active: AlertState = { active: true, last_level: USG, last_sent_at: min(-30) };
    expect(decide({ threshold: 'usg', history: h([USG, 'Moderate']), state: active, now: T0 })).toMatchObject({ action: 'none' });
    expect(decide({ threshold: 'usg', history: h(['Moderate', 'Good']), state: active, now: T0 })).toMatchObject({ action: 'improving', level: 'Good' });
    expect(decide({ threshold: 'usg', history: h(['Moderate', 'Good']), state: null, now: T0 })).toMatchObject({ action: 'none' });
  });

  it('holds during quiet hours and handles missing data', () => {
    expect(localHHmm(T0)).toBe('11:00');
    expect(isInQuietHours(T0, { start: '22:00', end: '07:00' })).toBe(false);
    expect(isInQuietHours(T0, { start: '10:00', end: '12:00' })).toBe(true);
    expect(isInQuietHours(new Date('2026-09-05T03:30:00Z'), { start: '22:00', end: '07:00' })).toBe(true); // 23:30 NY
    expect(decide({ threshold: 'usg', history: h([USG, USG]), state: null, now: T0, quietHours: { start: '10:00', end: '12:00' } })).toEqual({ action: 'none', reason: 'quiet_hours' });
    expect(decide({ threshold: 'usg', history: h([null, USG]), state: null, now: T0 })).toEqual({ action: 'none', reason: 'no_data' });
    expect(decide({ threshold: 'usg', history: h([USG]), state: null, now: T0 })).toEqual({ action: 'none', reason: 'insufficient_history' });
  });

  it('nextState tracks active alerts', () => {
    expect(nextState({ action: 'alert', level: USG, pm25: 40 }, null, T0)).toEqual({ active: true, last_level: USG, last_sent_at: T0 });
    expect(nextState({ action: 'improving', level: 'Good', pm25: 5 }, null, T0)).toEqual({ active: false, last_level: null, last_sent_at: T0 });
    expect(nextState({ action: 'none', reason: 'x' }, null, T0)).toBeNull();
  });
});

describe('messages', () => {
  it('matches the agreed USG copy and includes unsubscribe lines', () => {
    const c = composeAlert('Clairton', 'Unhealthy for Sensitive Groups', 42.4);
    expect(c.body).toBe(
      'Air quality in Clairton is Unhealthy for Sensitive Groups right now (PM2.5 about 42). If you have asthma or COPD, consider staying indoors and running an air purifier. From Valley Clean Air Now.',
    );
    expect(emailText(c, 'https://app.example')).toMatch(/To stop these alerts, open https:\/\/app.example/);
    expect(smsText(c)).toMatch(/Reply STOP to unsubscribe\.$/);
    expect(composeImproving('Clairton', 'Moderate', 20).body).toMatch(/improved to Moderate \(PM2.5 about 20\)\. It is now below your alert level/);
    expect(composeAlert('Clairton', 'Unhealthy', null).body).not.toMatch(/PM2.5 about/);
  });
});

describe('deliver', () => {
  const base: Providers = { sendgridKey: 'sg', fromEmail: 'alerts@x.org', twilioSid: 'AC1', twilioToken: 'tok', twilioFrom: '+14125550100', smsEnabled: true, appUrl: 'https://app', dryRun: false };
  const copy = composeAlert('Clairton', 'Unhealthy', 60);

  it('dry run logs as sent without calling providers', async () => {
    const post = jest.fn();
    const p = { ...base, dryRun: true, http: { post } as any };
    expect(await sendEmail('a@b.c', copy, p)).toMatchObject({ status: 'sent', provider_message_id: 'dry-run' });
    expect(await sendSms('+14125550123', copy, p)).toMatchObject({ status: 'sent', provider_message_id: 'dry-run' });
    expect(await sendPush(['t1'], copy, {}, p)).toMatchObject({ status: 'sent', recipient_count: 1 });
    expect(post).not.toHaveBeenCalled();
  });

  it('email posts to SendGrid with bearer auth and captures the message id', async () => {
    const post = jest.fn().mockResolvedValue({ status: 202, headers: { 'x-message-id': 'sg-1' } });
    const r = await sendEmail('a@b.c', copy, { ...base, http: { post } as any });
    expect(r).toMatchObject({ status: 'sent', provider_message_id: 'sg-1' });
    const [url, body, cfg] = post.mock.calls[0];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(body.personalizations[0].to[0].email).toBe('a@b.c');
    expect(body.content[0].value).toMatch(/To stop these alerts/);
    expect(cfg.headers.Authorization).toBe('Bearer sg');
  });

  it('sms respects the feature flag and posts to Twilio with basic auth', async () => {
    const post = jest.fn().mockResolvedValue({ data: { sid: 'SM1' } });
    expect(await sendSms('+14125550123', copy, { ...base, smsEnabled: false, http: { post } as any })).toMatchObject({ status: 'skipped', error: 'sms_disabled' });
    expect(post).not.toHaveBeenCalled();
    const r = await sendSms('+14125550123', copy, { ...base, http: { post } as any });
    expect(r).toMatchObject({ status: 'sent', provider_message_id: 'SM1' });
    const [url, form, cfg] = post.mock.calls[0];
    expect(url).toContain('/Accounts/AC1/Messages.json');
    expect(new URLSearchParams(form).get('Body')).toMatch(/Reply STOP to unsubscribe\.$/);
    expect(cfg.auth).toEqual({ username: 'AC1', password: 'tok' });
  });

  it('reports provider failures instead of throwing', async () => {
    const post = jest.fn().mockRejectedValue({ response: { status: 401, data: { errors: ['bad key'] } } });
    const r = await sendEmail('a@b.c', copy, { ...base, http: { post } as any });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/HTTP 401/);
    expect(await sendEmail('a@b.c', copy, { ...base, sendgridKey: '' })).toMatchObject({ status: 'failed', error: /not configured/ });
  });

  it('push prunes dead tokens', async () => {
    const messaging = {
      sendEachForMulticast: jest.fn().mockResolvedValue({
        successCount: 1, failureCount: 1,
        responses: [{ success: true, messageId: 'm1' }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }],
      }),
    };
    const r = await sendPush(['good', 'dead'], copy, { k: 'v' }, { ...base, messaging: messaging as any });
    expect(r).toMatchObject({ status: 'sent', provider_message_id: 'm1', invalid_tokens: ['dead'] });
  });
});

describe('evaluateAlerts', () => {
  function fakeDb(subs: Record<string, any>, states: Record<string, any> = {}) {
    const writes: Array<{ path: string; data: any }> = [];
    const updates: Array<{ path: string; data: any }> = [];
    const docRef = (path: string): any => ({
      path,
      get: async () => {
        const id = path.split('/')[1];
        const col = path.split('/')[0];
        const store = col === 'alert_state' ? states : {};
        return { exists: id in store, data: () => store[id] };
      },
    });
    const db: any = {
      collection: (name: string) => ({
        get: async () => ({
          size: Object.keys(subs).length,
          docs: Object.entries(subs).map(([id, data]) => ({ id, data: () => data, ref: docRef(`${name}/${id}`) })),
        }),
        doc: (id?: string) => docRef(`${name}/${id ?? 'auto' + writes.length}`),
      }),
      batch: () => {
        const ops: any[] = [];
        return {
          set: (ref: any, data: any) => ops.push({ path: ref.path, data }),
          update: (ref: any, data: any) => updates.push({ path: ref.path, data }),
          commit: async () => {
 writes.push(...ops);
},
        };
      },
    };
    return { db, writes, updates };
  }
  const USG = 'Unhealthy for Sensitive Groups' as const;
  const hist = (cats: any[]) => cats.map((c, i) => ({ at: min(-10 * (cats.length - 1 - i)), pm25_corrected: 42, aqi_category: c }));
  const status = (m: string, cats: any[]) => ({
    municipality: m, centroid: { lat: 0, lng: 0 }, radius_km: 2, pm25_corrected: 42, aqi: 117, aqi_category: cats[cats.length - 1],
    sensor_count: 1, sensor_ids: ['a'], computed_at: T0, history: hist(cats),
  });
  const providers: Providers = { sendgridKey: '', fromEmail: 'a@b', twilioSid: '', twilioToken: '', twilioFrom: '', smsEnabled: false, appUrl: 'https://app', dryRun: true };

  it('sends to a matching subscriber, logs it, and records state', async () => {
    const { db, writes } = fakeDb({ u1: { municipalities: ['Clairton'], threshold: 'usg', channels: ['email', 'sms'], contact: { email: 'x@y.z', phone: '+1412' } } });
    const s = await evaluateAlerts(db, providers, T0, [status('Clairton', [USG, USG]), status('Glassport', ['Good', 'Good'])]);
    expect(s.sends).toBe(1); // email sent; sms skipped by flag, not counted as failure
    expect(s.failures).toBe(0);
    const log = writes.find((w) => w.path.startsWith('alert_log/'))!.data;
    expect(log).toMatchObject({ uid: 'u1', channel: 'email', kind: 'alert', level: USG, municipality: 'Clairton', provider_message_id: 'dry-run', status: 'sent' });
    expect(writes.find((w) => w.path === 'alert_state/u1_Clairton')!.data).toMatchObject({ active: true, last_level: USG });
  });

  it('skips subscribers whose municipality is not elevated and dedupes active alerts', async () => {
    const { db, writes } = fakeDb(
      { u1: { municipalities: ['Clairton', 'Glassport'], threshold: 'usg', channels: ['email'], contact: { email: 'x@y.z' } } },
      { u1_Clairton: { active: true, last_level: USG, last_sent_at: min(-20) } },
    );
    const s = await evaluateAlerts(db, providers, T0, [status('Clairton', [USG, USG]), status('Glassport', ['Good', 'Good'])]);
    expect(s.sends).toBe(0);
    expect(s.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ municipality: 'Clairton', action: 'none', reason: 'recently_sent' }),
      expect.objectContaining({ municipality: 'Glassport', action: 'none' }),
    ]));
    expect(writes).toHaveLength(0);
  });

  it('sends improving when an active alert clears', async () => {
    const { db, writes } = fakeDb(
      { u1: { municipalities: ['Clairton'], threshold: 'usg', channels: ['email'], contact: { email: 'x@y.z' } } },
      { u1_Clairton: { active: true, last_level: USG, last_sent_at: min(-20) } },
    );
    const s = await evaluateAlerts(db, providers, T0, [status('Clairton', ['Moderate', 'Good'])]);
    expect(s.sends).toBe(1);
    expect(writes.find((w) => w.path.startsWith('alert_log/'))!.data.kind).toBe('improving');
    expect(writes.find((w) => w.path === 'alert_state/u1_Clairton')!.data.active).toBe(false);
  });

  it('does not advance state when every channel fails', async () => {
    const { db, writes } = fakeDb({ u1: { municipalities: ['Clairton'], threshold: 'usg', channels: ['email'], contact: { email: 'x@y.z' } } });
    const s = await evaluateAlerts(db, { ...providers, dryRun: false, sendgridKey: '' }, T0, [status('Clairton', [USG, USG])]);
    expect(s.failures).toBe(1);
    expect(writes.some((w) => w.path.startsWith('alert_log/') && w.data.status === 'failed')).toBe(true);
    expect(writes.some((w) => w.path.startsWith('alert_state/'))).toBe(false);
  });
});
