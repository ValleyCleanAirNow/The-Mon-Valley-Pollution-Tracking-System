import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { auth } from '../firebase';

export interface AnonymousAuthState {
  /** Stable pseudonymous id for this device, or null while signing in. */
  uid: string | null;
  loading: boolean;
  error: string | null;
}

function isRealAuth(a: unknown): boolean {
  return !!a && typeof (a as { onAuthStateChanged?: unknown }).onAuthStateChanged === 'function';
}

/**
 * Ensures the device has a Firebase Anonymous Auth session and returns its
 * uid. The uid persists in the browser's storage, so the same device keeps
 * the same pseudonym across visits until site data is cleared.
 */
export function useAnonymousAuth(): AnonymousAuthState {
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isRealAuth(auth)) {
      setLoading(false);
      return undefined;
    }
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        setUid(user.uid);
        setLoading(false);
        return;
      }
      try {
        const cred = await signInAnonymously(auth);
        setUid(cred.user.uid);
        setError(null);
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        setError(
          code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation'
            ? 'Reporting is not enabled yet. Anonymous sign-in must be turned on in Firebase.'
            : (err as Error).message,
        );
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  return { uid, loading, error };
}
