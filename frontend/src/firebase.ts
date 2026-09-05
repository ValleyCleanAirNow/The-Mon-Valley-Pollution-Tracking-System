import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

/**
 * Firebase web config. These values identify the project and are safe in the
 * browser bundle; access control lives in firestore.rules. Copy
 * frontend/.env.example to frontend/.env and fill them in.
 */
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || 'mv-pollution-tracking-system',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Local development against the Emulator Suite: set REACT_APP_USE_EMULATORS=true.
if (process.env.REACT_APP_USE_EMULATORS === 'true') {
  const host = process.env.REACT_APP_EMULATOR_HOST || '127.0.0.1';
  connectFirestoreEmulator(db, host, 8080);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
}

export { app, db, auth };
