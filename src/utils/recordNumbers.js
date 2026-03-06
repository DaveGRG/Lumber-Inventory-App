import { db } from '../firebase/config';
import { doc, runTransaction } from 'firebase/firestore';

// Generates auto-incrementing record numbers that reset each year
// type: 'transfers' | 'quoteRequests' | 'reconciliationReports' | 'pulls'
// Returns: 'T#2026-0001' | 'QR#2026-0001' | 'RC#2026-0001' | 'P#2026-0001'
export async function generateRecordNumber(type) {
  const year = new Date().getFullYear();
  const prefix = {
    transfers: 'T',
    quoteRequests: 'QR',
    reconciliationReports: 'RC',
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

  return `${prefix}#${year}-${String(newNumber).padStart(4, '0')}`;
}
