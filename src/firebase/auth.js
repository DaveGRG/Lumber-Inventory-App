import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  setPersistence,
  browserLocalPersistence,
  signOut,
} from 'firebase/auth';
import { auth } from './config';

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: 'grgplayscapes.com', prompt: 'select_account' });

// Set persistence once at module load — session never auto-expires
setPersistence(auth, browserLocalPersistence).catch(console.error);

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    // Domain check — if not @grgplayscapes.com, sign out immediately
    if (!result.user.email.endsWith('@grgplayscapes.com')) {
      await signOut(auth);
      throw new Error('Unauthorized: must use a @grgplayscapes.com account.');
    }
    // onAuthStateChanged in AuthContext handles the rest (doc lookup, migration)
  } catch (err) {
    // If popup was blocked, fall back to redirect (common on mobile)
    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request'
    ) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export async function signOutUser() {
  await signOut(auth);
}
