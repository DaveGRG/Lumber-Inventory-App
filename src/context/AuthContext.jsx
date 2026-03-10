import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth';
import {
  doc, getDoc, updateDoc, setDoc,
  collection, query, where, getDocs,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { signOutUser } from '../firebase/auth';
import { SUPER_ADMIN_EMAIL, DEV_ADMIN_EMAIL, ROLES } from '../constants/roles';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;

    // Handle redirect result (mobile fallback) — non-blocking
    getRedirectResult(auth).catch(() => {});

    // Single listener for all auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (cancelled) return;
      setAuthError('');

      // No user or wrong domain → signed out
      if (!firebaseUser || !firebaseUser.email?.endsWith('@grgplayscapes.com')) {
        if (firebaseUser) await signOutUser();
        if (!cancelled) { setUser(null); setLoading(false); }
        return;
      }

      try {
        const userData = await findUserByEmail(firebaseUser);

        if (!userData) {
          await signOutUser();
          if (!cancelled) {
            setUser(null);
            setAuthError('Not authorized. Contact your administrator to be added.');
            setLoading(false);
          }
          return;
        }

        if (userData.isActive === false) {
          await signOutUser();
          if (!cancelled) {
            setUser(null);
            setAuthError('Your account has been deactivated. Contact your administrator.');
            setLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setUser({ uid: firebaseUser.uid, ...userData });
          setLoading(false);
        }
      } catch (err) {
        console.error('Auth error:', err);
        if (!cancelled) {
          setUser(null);
          setAuthError('Sign-in failed. Please try again.');
          setLoading(false);
        }
      }
    });

    return () => { cancelled = true; unsubscribe(); };
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, authError }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Find user doc by email. Handles all document ID formats:
 *   - email as doc ID (e.g. "abe@grgplayscapes.com")
 *   - UID as doc ID (e.g. "5vgyiGrPuGZGfuKlJ501vo0h48D2")
 *
 * If found, stamps the Firebase UID onto the doc (if missing/changed)
 * so subsequent reads are fast. Does NOT delete or recreate docs.
 */
async function findUserByEmail(firebaseUser) {
  const emailLower = firebaseUser.email.toLowerCase();

  // 1. Fast path: try doc keyed by email (how User Management creates them)
  const emailDoc = await getDoc(doc(db, 'users', emailLower));
  if (emailDoc.exists()) {
    await stampUid(emailDoc.ref, emailDoc.data(), firebaseUser);
    return { ...emailDoc.data(), email: emailLower, uid: firebaseUser.uid, docId: emailLower };
  }

  // 2. Try doc keyed by UID (already-migrated users like Dave, Kate, Lisa, Mary, Pat)
  const uidDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
  if (uidDoc.exists()) {
    return { ...uidDoc.data(), uid: firebaseUser.uid, docId: firebaseUser.uid };
  }

  // 3. Fallback: query by email field (handles any doc ID format)
  const q = query(collection(db, 'users'), where('email', '==', emailLower));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const matchDoc = snap.docs[0];
    await stampUid(matchDoc.ref, matchDoc.data(), firebaseUser);
    return { ...matchDoc.data(), email: emailLower, uid: firebaseUser.uid, docId: matchDoc.id };
  }

  // 4. Bootstrap: auto-create John or Dave if no users exist yet
  if ([SUPER_ADMIN_EMAIL, DEV_ADMIN_EMAIL].includes(emailLower)) {
    const allUsers = await getDocs(collection(db, 'users'));
    if (allUsers.empty) {
      const role = emailLower === SUPER_ADMIN_EMAIL ? ROLES.SUPER_ADMIN : ROLES.ADMIN;
      const newUser = {
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || emailLower.split('@')[0],
        email: emailLower,
        role,
        hiVizMode: false,
        isActive: true,
        isPending: false,
        createdAt: new Date(),
      };
      await setDoc(doc(db, 'users', emailLower), newUser);
      return newUser;
    }
  }

  return null; // Not authorized
}

/** Stamp UID and clear isPending on the user doc if needed */
async function stampUid(docRef, data, firebaseUser) {
  const updates = {};
  if (data.uid !== firebaseUser.uid) updates.uid = firebaseUser.uid;
  if (data.isPending !== false) updates.isPending = false;
  if (!data.name && firebaseUser.displayName) updates.name = firebaseUser.displayName;
  if (Object.keys(updates).length > 0) {
    await updateDoc(docRef, updates);
  }
}

export const useAuth = () => useContext(AuthContext);
