import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
export const auth = getAuth(app);

// Sign in anonymously for simple multiplayer without full auth flow
// Fallback to local storage ID if anonymous auth is not enabled in Firebase Console
export const getPlayerId = async () => {
  try {
    const userCredential = await signInAnonymously(auth);
    return userCredential.user.uid;
  } catch (error) {
    console.warn("Anonymous auth failed, falling back to local ID. Enable Anonymous Auth in Firebase Console for security.", error);
    
    let localId = localStorage.getItem('straffe_player_id');
    if (!localId) {
      localId = 'local_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('straffe_player_id', localId);
    }
    return localId;
  }
};
