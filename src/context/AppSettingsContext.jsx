import { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

const AppSettingsContext = createContext({ roleRestrictionsEnabled: false });

export function AppSettingsProvider({ children }) {
  const [roleRestrictionsEnabled, setRoleRestrictionsEnabled] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'appSettings', 'config'), (snap) => {
      if (snap.exists()) {
        setRoleRestrictionsEnabled(snap.data().roleRestrictionsEnabled ?? false);
      }
    });
    return unsub;
  }, []);

  return (
    <AppSettingsContext.Provider value={{ roleRestrictionsEnabled }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export const useAppSettings = () => useContext(AppSettingsContext);
