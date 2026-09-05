import React, { useEffect, useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import './SymptomReportForm.css';
import './AlertsView.css';
import { db } from '../firebase';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { useAlertSubscription } from '../hooks/useAlertSubscription';
import { useMunicipalityStatus } from '../hooks/useMunicipalityStatus';
import { MUNICIPALITIES } from '../lib/municipalities';
import { colorFor, textColorFor } from '../lib/aqi';
import { pushConfigured, requestPushToken } from '../lib/push';
import { THRESHOLD_OPTIONS, type Channel, type ThresholdLevel } from '../types/alerts';

const SMS_ENABLED = process.env.REACT_APP_SMS_ALERTS_ENABLED === 'true';
const EMAIL_RE = /.+@.+\..+/;
const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;

/** Normalise a US phone number typed casually into E.164. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

const AlertsView: React.FC = () => {
  const { uid, loading: authLoading, error: authError } = useAnonymousAuth();
  const { subscription, loaded } = useAlertSubscription(uid);
  const { statuses } = useMunicipalityStatus();

  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [threshold, setThreshold] = useState<ThresholdLevel>('usg');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tokens, setTokens] = useState<string[]>([]);
  const [quietOn, setQuietOn] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Load the existing subscription into the form once.
  useEffect(() => {
    if (!loaded || hydrated) return;
    if (subscription) {
      setMunicipalities(subscription.municipalities);
      setThreshold(subscription.threshold);
      setChannels(subscription.channels);
      setEmail(subscription.contact.email ?? '');
      setPhone(subscription.contact.phone ?? '');
      setTokens(subscription.contact.fcm_tokens ?? []);
      if (subscription.quiet_hours) {
        setQuietOn(true);
        setQuietStart(subscription.quiet_hours.start);
        setQuietEnd(subscription.quiet_hours.end);
      }
    }
    setHydrated(true);
  }, [loaded, subscription, hydrated]);

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const enablePush = async () => {
    setPushMessage(null);
    const res = await requestPushToken();
    if (res.ok) {
      setTokens((t) => Array.from(new Set([...t, res.token])).slice(-10));
      setChannels((c) => (c.includes('push') ? c : [...c, 'push']));
      setPushMessage('Notifications are on for this device.');
    } else {
      setPushMessage(res.reason);
    }
  };

  const validate = (): string | null => {
    if (!uid) return 'Still connecting. Please try again in a moment.';
    if (municipalities.length === 0) return 'Choose at least one municipality.';
    if (channels.length === 0) return 'Choose how you want to be alerted.';
    if (channels.includes('email') && !EMAIL_RE.test(email.trim())) return 'Enter a valid email address.';
    if (channels.includes('sms') && !PHONE_RE.test(normalizePhone(phone))) return 'Enter a valid mobile number, for example 412 555 0100.';
    if (channels.includes('push') && tokens.length === 0) return 'Turn on notifications for this device, or pick another channel.';
    return null;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const contact: Record<string, unknown> = {};
      if (channels.includes('email')) contact.email = email.trim();
      if (channels.includes('sms')) contact.phone = normalizePhone(phone);
      if (channels.includes('push')) contact.fcm_tokens = tokens;
      await setDoc(doc(db, 'alert_subscriptions', uid as string), {
        municipalities,
        threshold,
        channels,
        contact,
        quiet_hours: quietOn ? { start: quietStart, end: quietEnd } : null,
        created_at: subscription?.created_at ? Timestamp.fromDate(subscription.created_at) : serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      setSavedAt(new Date());
    } catch (err) {
      setError(`Could not save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const turnOff = async () => {
    if (!uid) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'alert_subscriptions', uid));
      setMunicipalities([]);
      setChannels([]);
      setSavedAt(null);
    } catch (err) {
      setError(`Could not turn off alerts: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const chosenStatuses = useMemo(() => municipalities.map((m) => statuses[m]).filter(Boolean), [municipalities, statuses]);

  return (
    <div>
      <form className="report-form" onSubmit={save} aria-label="Air quality alerts" noValidate>
        <h2>Air quality alerts</h2>
        <p className="report-form__intro">
          Get a message when the air in your area reaches a level you choose, and another when it clears. Alerts are
          based on two hourly readings in a row, so a single spike will not page you.
        </p>

        {authError && <div className="report-form__error" role="alert">{authError}</div>}
        {error && <div className="report-form__error" role="alert">{error}</div>}
        {savedAt && (
          <div className="report-form__success" role="status">
            Alerts saved. You will hear from us when the air in {municipalities.join(', ')} reaches your level.
          </div>
        )}

        <fieldset>
          <legend>Where</legend>
          <p className="hint">Pick every municipality you care about.</p>
          <div className="chips" role="group" aria-label="Municipalities">
            {MUNICIPALITIES.map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={municipalities.includes(m)} onClick={() => setMunicipalities(toggle(municipalities, m))}>
                {m}
              </button>
            ))}
          </div>
          {chosenStatuses.length > 0 && (
            <ul className="status-list" aria-label="Current air quality">
              {chosenStatuses.map((s) => (
                <li key={s.municipality}>
                  <span className="status-list__name">{s.municipality}</span>
                  <span className="status-list__badge" style={{ background: colorFor(s.aqi_category), color: textColorFor(s.aqi_category) }}>
                    {s.aqi_category ?? 'No nearby sensors'}
                    {s.pm25_corrected != null && ` · PM2.5 ${s.pm25_corrected.toFixed(0)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <fieldset>
          <legend>Alert me when air quality is</legend>
          <div role="radiogroup" aria-label="Alert level" className="threshold-options">
            {THRESHOLD_OPTIONS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={threshold === o.value} className="threshold-option" onClick={() => setThreshold(o.value)}>
                <span className="threshold-option__label">{o.label}</span>
                <span className="threshold-option__help">{o.help}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>How to reach you</legend>
          <div className="chips" role="group" aria-label="Channels">
            <button type="button" className="chip" aria-pressed={channels.includes('push')} onClick={() => (channels.includes('push') ? setChannels(toggle(channels, 'push')) : enablePush())}>
              Notification on this device
            </button>
            <button type="button" className="chip" aria-pressed={channels.includes('email')} onClick={() => setChannels(toggle(channels, 'email'))}>
              Email
            </button>
            {SMS_ENABLED && (
              <button type="button" className="chip" aria-pressed={channels.includes('sms')} onClick={() => setChannels(toggle(channels, 'sms'))}>
                Text message
              </button>
            )}
          </div>
          {!pushConfigured() && <p className="hint" style={{ marginTop: 8 }}>Device notifications are not set up on this site yet.</p>}
          {pushMessage && <p className="hint" style={{ marginTop: 8 }}>{pushMessage}</p>}
          {channels.includes('email') && (
            <>
              <label className="block" htmlFor="alert-email">Email address</label>
              <input id="alert-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </>
          )}
          {channels.includes('sms') && (
            <>
              <label className="block" htmlFor="alert-phone">Mobile number</label>
              <input id="alert-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="412 555 0100" />
              <p className="hint">Standard text rates apply. Reply STOP to any message to unsubscribe.</p>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Quiet hours (optional)</legend>
          <button type="button" className="chip" aria-pressed={quietOn} onClick={() => setQuietOn(!quietOn)}>
            {quietOn ? 'Quiet hours on' : 'Do not message me overnight'}
          </button>
          {quietOn && (
            <div className="quiet-hours">
              <label className="block" htmlFor="quiet-start">From</label>
              <input id="quiet-start" type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
              <label className="block" htmlFor="quiet-end">Until</label>
              <input id="quiet-end" type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
              <p className="hint">Eastern time. If the air is still bad when quiet hours end, you get the alert then.</p>
            </div>
          )}
        </fieldset>

        <button type="submit" className="btn btn--primary" disabled={saving || authLoading || !!authError}>
          {saving ? 'Saving…' : subscription ? 'Update alerts' : 'Turn on alerts'}
        </button>
        {subscription && (
          <button type="button" className="btn btn--secondary" style={{ width: '100%', marginTop: 10 }} onClick={turnOff} disabled={saving}>
            Turn off all alerts
          </button>
        )}
        <p className="report-form__privacy">
          Your contact details are stored only with your alert settings, tied to a random id for this device, and are
          never combined with symptom reports. Every email and text includes a way to stop.
        </p>
      </form>
    </div>
  );
};

export default AlertsView;
