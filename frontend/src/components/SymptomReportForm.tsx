import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import './SymptomReportForm.css';
import { db } from '../firebase';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { useMyReports } from '../hooks/useMyReports';
import { MUNICIPALITIES } from '../lib/municipalities';
import {
  ACTIONS,
  CAUSES,
  hourBucketFor,
  labelFor,
  ODOR_TYPES,
  REPORT_SCHEMA_VERSION,
  roundCoord,
  SYMPTOMS,
  type Option,
  type Report,
} from '../types/report';

interface SymptomReportFormProps {
  onSuccess?: (reportId: string) => void;
}

const LAST_MUNICIPALITY_KEY = 'mvpts.lastMunicipality';

function readLastMunicipality(): string {
  try {
    return window.localStorage.getItem(LAST_MUNICIPALITY_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Local-time value for <input type="datetime-local">. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ChipGroup: React.FC<{
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  exclusiveValue?: string;
  label: string;
}> = ({ options, selected, onChange, multi = true, exclusiveValue, label }) => {
  const toggle = (value: string) => {
    if (!multi) {
      onChange([value]);
      return;
    }
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
      return;
    }
    if (exclusiveValue && value === exclusiveValue) {
      onChange([value]);
      return;
    }
    onChange([...selected.filter((v) => v !== exclusiveValue), value]);
  };
  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return multi ? (
          <button key={o.value} type="button" className="chip" aria-pressed={on} onClick={() => toggle(o.value)}>
            {o.label}
          </button>
        ) : (
          <button key={o.value} type="button" role="radio" className="chip" aria-checked={on} onClick={() => toggle(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

const Scale: React.FC<{ value: number | null; onChange: (v: number) => void; label: string; low: string; high: string }> = ({
  value,
  onChange,
  label,
  low,
  high,
}) => (
  <div>
    <div className="scale" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" className="chip" aria-checked={value === n} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
    </div>
    <div className="scale__labels" aria-hidden="true">
      <span>{low}</span>
      <span>{high}</span>
    </div>
  </div>
);

const SymptomReportForm: React.FC<SymptomReportFormProps> = ({ onSuccess }) => {
  const { uid, loading: authLoading, error: authError } = useAnonymousAuth();
  const { reports } = useMyReports(uid);

  const [odorPresent, setOdorPresent] = useState<boolean | null>(null);
  const [odorTypes, setOdorTypes] = useState<string[]>([]);
  const [odorIntensity, setOdorIntensity] = useState<number | null>(null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState<number | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [cause, setCause] = useState<string>('');
  const [when, setWhen] = useState<string>(() => toLocalInputValue(new Date()));
  const [municipality, setMunicipality] = useState<string>(readLastMunicipality);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  useEffect(() => {
    if (odorPresent === false) {
      setOdorTypes([]);
      setOdorIntensity(null);
    }
  }, [odorPresent]);

  const hasRealSymptoms = useMemo(() => symptoms.some((s) => s !== 'none'), [symptoms]);

  const validate = (): string | null => {
    if (!uid) return 'Still connecting. Please wait a moment and try again.';
    if (odorPresent === null) return 'Tell us whether you noticed an odor.';
    if (odorPresent && odorTypes.length === 0) return 'Pick at least one odor type.';
    if (odorPresent && odorIntensity === null) return 'Rate how strong the odor was.';
    if (symptoms.length === 0) return 'Pick your symptoms, or "No symptoms".';
    if (hasRealSymptoms && severity === null) return 'Rate how bad your symptoms are.';
    if (!cause) return 'Pick a suspected cause, or "Don\'t know".';
    if (!municipality) return 'Choose your municipality.';
    const occurred = new Date(when);
    if (Number.isNaN(occurred.getTime())) return 'Check the date and time.';
    if (occurred.getTime() > Date.now() + 5 * 60 * 1000) return 'The time cannot be in the future.';
    return null;
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setError('Location is not available on this device.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude) });
        setLocating(false);
      },
      () => {
        setError('Could not get your location. You can still file the report.');
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  };

  const reset = () => {
    setOdorPresent(null);
    setOdorTypes([]);
    setOdorIntensity(null);
    setSymptoms([]);
    setSeverity(null);
    setActions([]);
    setCause('');
    setWhen(toLocalInputValue(new Date()));
    setLocation(null);
    setNote('');
    setError(null);
    setSubmittedId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const occurred = new Date(when);
      const doc = {
        uid,
        schema_version: REPORT_SCHEMA_VERSION,
        odor: { present: odorPresent === true, types: odorTypes, intensity: odorPresent ? odorIntensity : null },
        symptoms: { list: symptoms, severity: hasRealSymptoms ? severity : null },
        actions,
        cause,
        occurred_at: Timestamp.fromDate(occurred),
        hour_bucket: hourBucketFor(occurred),
        municipality,
        location,
        note: note.trim() ? note.trim().slice(0, 500) : null,
        created_at: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'reports'), doc);
      try {
        window.localStorage.setItem(LAST_MUNICIPALITY_KEY, municipality);
      } catch {
        /* storage unavailable */
      }
      setSubmittedId(ref.id);
      onSuccess?.(ref.id);
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setError(
        code === 'permission-denied'
          ? 'The report was rejected. Please check your answers and try again.'
          : `Could not send the report: ${(err as Error).message}`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedId) {
    return (
      <div className="report-form">
        <div className="report-form__success" role="status">
          <h2>Thank you. Your report was filed.</h2>
          <p>
            It is stored under a pseudonymous id for this device only. Once three or more reports come in from{' '}
            {municipality} in the same hour, they appear together on the public map.
          </p>
          <button type="button" className="btn btn--primary" onClick={reset}>
            File another report
          </button>
        </div>
        <ReportHistory reports={reports} />
      </div>
    );
  }

  return (
    <div>
      <form className="report-form" onSubmit={handleSubmit} aria-label="Community air report" noValidate>
        <h2>Report what you noticed</h2>
        <p className="report-form__intro">About a minute. No name, email, or address is collected.</p>

        {authError && <div className="report-form__error" role="alert">{authError}</div>}
        {error && <div className="report-form__error" role="alert">{error}</div>}

        <fieldset>
          <legend>Odor</legend>
          <p className="hint">Did you notice a smell?</p>
          <div className="chips" role="radiogroup" aria-label="Odor present">
            <button type="button" role="radio" className="chip" aria-checked={odorPresent === true} onClick={() => setOdorPresent(true)}>
              Yes
            </button>
            <button type="button" role="radio" className="chip" aria-checked={odorPresent === false} onClick={() => setOdorPresent(false)}>
              No
            </button>
          </div>
          {odorPresent && (
            <>
              <p className="hint" style={{ marginTop: 12 }}>What did it smell like? Pick all that apply.</p>
              <ChipGroup options={ODOR_TYPES} selected={odorTypes} onChange={setOdorTypes} label="Odor type" />
              <p className="hint" style={{ marginTop: 12 }}>How strong?</p>
              <Scale value={odorIntensity} onChange={setOdorIntensity} label="Odor intensity" low="Faint" high="Overpowering" />
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Symptoms</legend>
          <p className="hint">Pick all that apply.</p>
          <ChipGroup options={SYMPTOMS} selected={symptoms} onChange={setSymptoms} exclusiveValue="none" label="Symptoms" />
          {hasRealSymptoms && (
            <>
              <p className="hint" style={{ marginTop: 12 }}>Overall, how bad?</p>
              <Scale value={severity} onChange={setSeverity} label="Symptom severity" low="Mild" high="Severe" />
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>What did you do?</legend>
          <ChipGroup options={ACTIONS} selected={actions} onChange={setActions} exclusiveValue="none" label="Actions taken" />
        </fieldset>

        <fieldset>
          <legend>What do you think caused it?</legend>
          <ChipGroup options={CAUSES} selected={cause ? [cause] : []} onChange={(v) => setCause(v[0] ?? '')} multi={false} label="Suspected cause" />
        </fieldset>

        <fieldset>
          <legend>When and where</legend>
          <label className="block" htmlFor="report-when">When</label>
          <input id="report-when" type="datetime-local" value={when} max={toLocalInputValue(new Date())} onChange={(e) => setWhen(e.target.value)} />

          <label className="block" htmlFor="report-municipality">Municipality</label>
          <select id="report-municipality" value={municipality} onChange={(e) => setMunicipality(e.target.value)} required>
            <option value="">Choose…</option>
            {MUNICIPALITIES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <div className="location-row">
            <button type="button" className="btn btn--secondary" onClick={useMyLocation} disabled={locating}>
              {locating ? 'Locating…' : location ? 'Update approximate location' : 'Add approximate location (optional)'}
            </button>
            {location && (
              <span className="hint" style={{ margin: 0 }}>
                Saved to about 100 m: {location.lat}, {location.lng}{' '}
                <button type="button" className="chip" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => setLocation(null)}>
                  Remove
                </button>
              </span>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Anything else? (optional)</legend>
          <textarea
            aria-label="Note"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Please do not include names, addresses, or phone numbers."
          />
        </fieldset>

        <button type="submit" className="btn btn--primary" disabled={submitting || authLoading || !!authError}>
          {submitting ? 'Sending…' : 'Send report'}
        </button>
        <p className="report-form__privacy">
          Your report is tied to a random id for this device, not to you. Only you can see your own reports. The public
          map shows hourly counts per municipality and only when at least three people report.
        </p>
      </form>
      <ReportHistory reports={reports} />
    </div>
  );
};

export const ReportHistory: React.FC<{ reports: Report[] }> = ({ reports }) => {
  if (reports.length === 0) return null;
  return (
    <section className="report-history" aria-label="Your reports">
      <h3>Your reports on this device</h3>
      <ul>
        {reports.map((r) => (
          <li key={r.id}>
            <div className="report-history__when">
              {r.occurred_at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {r.municipality}
            </div>
            <div className="report-history__meta">
              {r.odor.present ? `Odor: ${r.odor.types.map((t) => labelFor(ODOR_TYPES, t)).join(', ')} (${r.odor.intensity}/5)` : 'No odor'}
              {' · '}
              {r.symptoms.list.includes('none') || r.symptoms.list.length === 0
                ? 'No symptoms'
                : `Symptoms: ${r.symptoms.list.map((s) => labelFor(SYMPTOMS, s)).join(', ')} (${r.symptoms.severity}/5)`}
              {' · '}
              Cause: {labelFor(CAUSES, r.cause)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default SymptomReportForm;
