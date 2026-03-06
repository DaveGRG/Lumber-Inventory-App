import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth';
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { signOutUser } from '../firebase/auth';
import { SUPER_ADMIN_EMAIL, DEV_ADMIN_EMAIL, ROLES } from '../constants/roles';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Guard: wait for redirect result before processing auth state
  const redirectResolvedRef = useRef(false);
  // Lock: prevent concurrent migration attempts
  const migrationLockRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // 1. Consume any pending redirect result FIRST, before we act on auth state.
    //    getRedirectResult returns null if there was no redirect — that's fine.
    getRedirectResult(auth)
      .then((result) => {
        // Domain check for redirect logins
        if (result?.user && !result.user.email.endsWith('@grgplayscapes.com')) {
          return signOutUser().then(() => {
            if (!cancelled) setAuthError('Unauthorized: must use a @grgplayscapes.com account.');
          });
        }
      })
      .catch((err) => {
        console.error('Redirect result error:', err);
        // Non-fatal — onAuthStateChanged will still fire
      })
      .finally(() => {
        redirectResolvedRef.current = true;
        // If onAuthStateChanged already fired while we were waiting,
        // re-trigger it by getting the current user now
        const currentUser = auth.currentUser;
        if (currentUser && !cancelled) {
          handleAuthUser(currentUser);
        } else if (!currentUser && !cancelled) {
          setUser(null);
          setLoading(false);
        }
      });

    // 2. Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (cancelled) return;
      setAuthError('');

      if (!firebaseUser || !firebaseUser.email?.endsWith('@grgplayscapes.com')) {
        if (firebaseUser) await signOutUser();
        setUser(null);
        setLoading(false);
        return;
      }

      // If redirect hasn't resolved yet, skip — we'll re-process in the .finally() above
      if (!redirectResolvedRef.current) return;

      await handleAuthUser(firebaseUser);
    });

    async function handleAuthUser(firebaseUser) {
      if (cancelled) return;

      // Acquire migration lock — if another call is already running, bail out.
      // The running call will set the user when it finishes.
      if (migrationLockRef.current) return;
      migrationLockRef.current = true;

      try {
        const emailLower = firebaseUser.email.toLowerCase();

        // 1. Try UID-keyed doc (existing migrated users)
        let userSnap = await getDoc(doc(db, 'users', firebaseUser.uid));

        // 2. If not found, look for a pending email-keyed doc and migrate it
        if (!userSnap.exists()) {
          let pendingRef = doc(db, 'users', emailLower);
          let pendingSnap = await getDoc(pendingRef);

          // Fallback: scan all pending users for a case-insensitive match
          if (!pendingSnap.exists()) {
            const allUsers = await getDocs(collection(db, 'users'));
            const match = allUsers.docs.find(d => {
              const data = d.data();
              return data.isPending && data.email?.toLowerCase() === emailLower;
            });
            if (match) {
              pendingRef = doc(db, 'users', match.id);
              pendingSnap = match;
            }
          }

          if (pendingSnap.exists() && pendingSnap.data().isActive !== false) {
            // Migrate: create UID-keyed doc and remove email-keyed pending doc
            const pendingData = pendingSnap.data();
            const migratedData = {
              ...pendingData,
              email: emailLower,
              uid: firebaseUser.uid,
              name: pendingData.name || firebaseUser.displayName || emailLower.split('@')[0],
              isPending: false,
            };
            try {
              await setDoc(doc(db, 'users', firebaseUser.uid), migratedData);
              await deleteDoc(pendingRef);
            } catch (migrationErr) {
              console.error('Migration failed:', migrationErr);
              if (!cancelled) {
                setUser(null);
                setAuthError('Account setup failed — please try again. If this keeps happening, contact your administrator.');
                setLoading(false);
              }
              return;
            }
            if (!cancelled) {
              setUser({ uid: firebaseUser.uid, ...migratedData });
              setLoading(false);
            }
            return;
          }

          // 3. First-boot bootstrap — auto-create John or Dave if users collection is empty
          const isKnownAdmin = [SUPER_ADMIN_EMAIL, DEV_ADMIN_EMAIL].includes(firebaseUser.email);
          if (isKnownAdmin) {
            const usersSnap = await getDocs(collection(db, 'users'));
            const hasActiveUsers = usersSnap.docs.some(d => d.data().isActive !== false);
            if (!hasActiveUsers) {
              const role = firebaseUser.email === SUPER_ADMIN_EMAIL ? ROLES.SUPER_ADMIN : ROLES.ADMIN;
              const userData = {
                uid: firebaseUser.uid,
                name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
                email: firebaseUser.email,
                role,
                hiVizMode: false,
                createdAt: new Date(),
                isActive: true,
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), userData);
              if (!cancelled) {
                setUser({ uid: firebaseUser.uid, ...userData });
                setLoading(false);
              }
              return;
            }
          }

          // No matching doc found — not authorized
          await signOutUser();
          if (!cancelled) {
            setUser(null);
            setAuthError('Not authorized. Contact your administrator to be added.');
            setLoading(false);
          }
          return;
        }

        // Existing UID-keyed user found
        if (userSnap.data().isActive === false) {
          await signOutUser();
          if (!cancelled) {
            setUser(null);
            setAuthError('Your account has been deactivated. Contact your administrator.');
            setLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setUser({ uid: firebaseUser.uid, ...userSnap.data() });
          setLoading(false);
        }
      } catch (err) {
        console.error('Auth error:', err);
        if (!cancelled) {
          setUser(null);
          if (err.code === 'permission-denied' || err.message?.includes('Missing or insufficient permissions')) {
            setAuthError('Sign-in failed — please try again. If this keeps happening, contact your administrator.');
          } else {
            setAuthError('Sign-in failed. Please try again.');
          }
          setLoading(false);
        }
      } finally {
        migrationLockRef.current = false;
      }
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, authError }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
