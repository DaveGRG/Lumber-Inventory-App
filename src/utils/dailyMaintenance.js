import { db } from '../firebase/config';
import {
  collection, query, where, getDocs, getDoc, doc, deleteDoc,
} from 'firebase/firestore';
import { triggerNotification } from './notifications';
import { NOTIFICATION_EVENTS } from '../constants/notificationEvents';

/**
 * Runs maintenance tasks:
 * 1. Purge expired trash items (purgeAt <= now)
 * 2. Check for overdue physical counts
 *
 * Returns a summary of what was done.
 */
export async function runDailyMaintenance() {
  let trashPurged = 0;
  let overdueLocations = 0;

  // ── 1. Trash purge ──────────────────────────────────────────────────────
  try {
    const now = new Date();
    const trashSnap = await getDocs(
      query(collection(db, 'trash'), where('purgeAt', '<=', now)),
    );
    for (const trashDoc of trashSnap.docs) {
      try {
        const { originalCollection, originalId } = trashDoc.data();
        // Hard-delete the original (if it still exists as isDeleted)
        try { await deleteDoc(doc(db, originalCollection, originalId)); } catch { /* may already be gone */ }
        // Hard-delete the trash doc
        await deleteDoc(doc(db, 'trash', trashDoc.id));
        trashPurged++;
      } catch { /* skip individual failures */ }
    }
  } catch (err) {
    console.error('[maintenance] Trash purge error:', err);
  }

  // ── 2. Physical count overdue check ─────────────────────────────────────
  try {
    const configSnap = await getDoc(doc(db, 'appSettings', 'config'));
    if (configSnap.exists()) {
      const config = configSnap.data();
      const reminderDays = config.physicalCountReminderDays ?? 35;
      const cutoff = new Date(Date.now() - reminderDays * 24 * 60 * 60 * 1000);

      const locations = [
        { field: 'lastFarmCount', label: 'Farm' },
        { field: 'lastMkeCount', label: 'MKE' },
      ];

      for (const loc of locations) {
        const lastCount = config[loc.field];
        const lastDate = lastCount?.toDate ? lastCount.toDate() : (lastCount ? new Date(lastCount) : null);

        if (!lastDate || lastDate < cutoff) {
          overdueLocations++;
          const daysSince = lastDate
            ? Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
            : 'unknown';
          triggerNotification(
            NOTIFICATION_EVENTS.PHYSICAL_COUNT_OVERDUE,
            `Physical Count Overdue — ${loc.label}`,
            `The ${loc.label} location has not had a physical count in ${daysSince} days (threshold: ${reminderDays} days).`,
          );
        }
      }
    }
  } catch (err) {
    console.error('[maintenance] Overdue check error:', err);
  }

  return { trashPurged, overdueLocations };
}
