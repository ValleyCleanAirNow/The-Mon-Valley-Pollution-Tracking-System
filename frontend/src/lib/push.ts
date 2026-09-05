/**
 * Web push registration for alert notifications through Firebase Cloud
 * Messaging. Requires REACT_APP_FIREBASE_VAPID_KEY (Firebase console >
 * Project settings > Cloud Messaging > Web Push certificates).
 *
 * The messaging service worker is registered under FCM's own scope so it does
 * not replace the app's offline service worker.
 */
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app } from '../firebase';

export const VAPID_KEY = process.env.REACT_APP_FIREBASE_VAPID_KEY || '';

export function pushConfigured(): boolean {
  return VAPID_KEY.length > 0;
}

function swUrl(): string {
  const params = new URLSearchParams({
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY || '',
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || '',
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.REACT_APP_FIREBASE_APP_ID || '',
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export type PushResult = { ok: true; token: string } | { ok: false; reason: string };

/** Ask for notification permission and return this browser's FCM token. */
export async function requestPushToken(): Promise<PushResult> {
  if (!pushConfigured()) return { ok: false, reason: 'Push notifications are not set up on this site yet.' };
  if (!(await isSupported())) return { ok: false, reason: 'This browser does not support push notifications.' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'Notifications were not allowed. You can change this in your browser settings.' };
  try {
    const registration = await navigator.serviceWorker.register(swUrl(), { scope: '/firebase-cloud-messaging-push-scope' });
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, reason: 'Could not get a notification token. Try again.' };
    return { ok: true, token };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
