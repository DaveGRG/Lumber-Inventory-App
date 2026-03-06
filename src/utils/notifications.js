import { db } from '../firebase/config';
import { collection, addDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';

/**
 * Queries the `notifications` collection for active recipients subscribed to eventType,
 * then writes one doc per recipient to `pendingEmails`.
 *
 * @param {string} eventType  - One of NOTIFICATION_EVENTS constants
 * @param {string} subject    - Email subject line
 * @param {string} text       - Email body (plain text)
 * @param {object} [options]
 * @param {string[]} [options.extraRecipients] - Additional emails (e.g. vendor email)
 */
export async function triggerNotification(eventType, subject, text, options = {}) {
  try {
    const { extraRecipients = [] } = options;

    // Query active recipients subscribed to this event type
    const q = query(
      collection(db, 'notifications'),
      where('isActive', '==', true),
      where('events', 'array-contains', eventType),
    );
    const snap = await getDocs(q);

    // Collect unique emails
    const emails = new Set();
    snap.docs.forEach(d => {
      const email = d.data().email;
      if (email) emails.add(email);
    });
    extraRecipients.forEach(e => { if (e) emails.add(e); });

    if (emails.size === 0) {
      console.log(`[triggerNotification] ${eventType} — no recipients`);
      return;
    }

    // Write one pendingEmail doc per recipient
    const writes = [...emails].map(to =>
      addDoc(collection(db, 'pendingEmails'), {
        to,
        subject,
        text,
        event: eventType,
        status: 'pending',
        createdAt: serverTimestamp(),
      })
    );
    await Promise.all(writes);

    console.log(`[triggerNotification] ${eventType} — queued ${emails.size} email(s)`);
  } catch (err) {
    // Notification failure must never block the primary action
    console.error(`[triggerNotification] ${eventType} failed:`, err);
  }
}
