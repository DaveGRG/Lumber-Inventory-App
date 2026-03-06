import { createContext, useContext, useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../hooks/useAuth';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [hiViz, setHiViz] = useState(false);

  // Restore hi-viz preference from Firestore on login
  useEffect(() => {
    if (user?.hiVizMode !== undefined) setHiViz(user.hiVizMode);
  }, [user]);

  const toggleHiViz = async () => {
    const next = !hiViz;
    setHiViz(next);
    if (user?.uid) {
      await updateDoc(doc(db, 'users', user.uid), { hiVizMode: next });
    }
  };

  return (
    <ThemeContext.Provider value={{ hiViz, toggleHiViz }}>
      <div className={`h-full overflow-hidden ${hiViz ? 'hiviz' : ''}`}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
