import { useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { AlertSubscription } from '../types/alerts';

function toDate(v: unknown): Date | null {
  return v instanceof Timestamp ? v.toDate() : null;
}

/** Live view of this device's alert subscription, or null when none exists. */
export function useAlertSubscription(uid: string | null): { subscription: AlertSubscription | null; loaded: boolean; error: string | null } {
  const [subscription, setSubscription] = useState<AlertSubscription | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !db || typeof (db as { type?: unknown }).type !== 'string') {
      setLoaded(!!uid || true);
      return undefined;
    }
    return onSnapshot(
      doc(db, 'alert_subscriptions', uid),
      (snap) => {
        if (!snap.exists()) {
          setSubscription(null);
        } else {
          const d = snap.data();
          setSubscription({
            municipalities: d.municipalities ?? [],
            threshold: d.threshold ?? 'usg',
            channels: d.channels ?? [],
            contact: d.contact ?? {},
            quiet_hours: d.quiet_hours ?? null,
            created_at: toDate(d.created_at),
            updated_at: toDate(d.updated_at),
          });
        }
        setLoaded(true);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoaded(true);
      },
    );
  }, [uid]);

  return { subscription, loaded, error };
}
