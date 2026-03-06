// Run this once to initialize appSettings/config in Firestore.
// Call seedAppSettings() from a one-time admin button or browser console.
import { db } from './config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export async function seedAppSettings() {
  await setDoc(doc(db, 'appSettings', 'config'), {
    physicalCountReminderDays: 35,
    lastFarmCount: null,
    lastMkeCount: null,
    largeAdjustmentThreshold: 20,
  }, { merge: true });
  console.log('appSettings/config seeded');
}
