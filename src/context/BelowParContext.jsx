import { createContext, useContext, useMemo } from 'react';
import { useInventory } from '../hooks/useInventory';
import { useBelowPar } from '../hooks/useBelowPar';

const BelowParContext = createContext(0);

// Provides the total below-par count (both locations) to the NavBar badge.
// Mounted once at the app level so all components share one Firestore subscription.
export function BelowParProvider({ children }) {
  const { skus, inventory } = useInventory();
  const belowParItems = useBelowPar(inventory, skus);

  const totalCount = useMemo(() => belowParItems.length, [belowParItems]);

  return (
    <BelowParContext.Provider value={totalCount}>
      {children}
    </BelowParContext.Provider>
  );
}

export const useBelowParCount = () => useContext(BelowParContext);
