import { db } from '../firebase/config';
import { doc, runTransaction } from 'firebase/firestore';

// Generates auto-incrementing record numbers that reset each year
// type: 'transfers' | 'quoteRequests' | 'reconciliationReports' | 'pulls'
// Returns: 'T#2026-0001' | 'PR#-0001' | 'RR#2026-0001' | 'P#2026-0001'
export async function generateRecordNumber(type) {
  const year = new Date().getFullYear();
  const prefix = {
    transfers: 'T',
    quoteRequests: 'PR',
    reconciliationReports: 'RR',
    pulls: 'P',
  }[type];

  const counterRef = doc(db, 'recordCounters', String(year));

  const newNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data()[type] ?? 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { [type]: next }, { merge: true });
    return next;
  });

  if (type === 'reconciliationReports') {
    return `RR# ${String(newNumber).padStart(4, '0')}`;
  }
  if (type === 'quoteRequests') {
    return `PR#-${String(newNumber).padStart(4, '0')}`;
  }
  return `${prefix}#${year}-${String(newNumber).padStart(4, '0')}`;
}
