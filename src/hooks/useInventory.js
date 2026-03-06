import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { sortByLumberSize } from '../utils/lumberSort';

// Real-time subscription to both SKUs and inventory documents.
// Returns { skus, inventory, loading, error }
export function useInventory() {
  const [skus, setSkus] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let skusDone = false;
    let invDone = false;

    const checkDone = () => {
      if (skusDone && invDone) setLoading(false);
    };

    const skuQuery = query(
      collection(db, 'skus'),
      where('isDeleted', '==', false),
      orderBy('sku')
    );

    const invQuery = query(
      collection(db, 'inventory')
    );

    const unsubSkus = onSnapshot(
      skuQuery,
      (snap) => {
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setSkus(sortByLumberSize(raw));
        skusDone = true;
        checkDone();
      },
      (err) => { setError(err); setLoading(false); }
    );

    const unsubInv = onSnapshot(
      invQuery,
      (snap) => {
        setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        invDone = true;
        checkDone();
      },
      (err) => { setError(err); setLoading(false); }
    );

    return () => { unsubSkus(); unsubInv(); };
  }, []);

  return { skus, inventory, loading, error };
}
