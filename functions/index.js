const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// ─── HELPER: queue notification emails via pendingEmails collection ──────────
async function queueNotification(db, eventType, subject, text) {
  try {
    const snap = await db.collection("notifications")
      .where("isActive", "==", true)
      .where("events", "array-contains", eventType)
      .get();

    const emails = new Set();
    snap.docs.forEach(d => {
      const email = d.data().email;
      if (email) emails.add(email);
    });

    if (emails.size === 0) return;

    const batch = db.batch();
    for (const to of emails) {
      const ref = db.collection("pendingEmails").doc();
      batch.set(ref, { to, subject, text, event: eventType, status: "pending", createdAt: new Date() });
    }
    await batch.commit();
  } catch (err) {
    console.error(`[queueNotification] ${eventType} failed:`, err);
  }
}

// ─── EMAIL SENDER ────────────────────────────────────────────────────────────
// Triggered when a new doc is written to pendingEmails.
// Sends the email via SendGrid, then marks the doc as "sent" or "failed".
exports.onPendingEmailCreated = onDocumentCreated("pendingEmails/{docId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const { to, subject, text } = snap.data();
  console.log(`[email] Sending to ${to}: "${subject}"`);

  const sgMail = require("@sendgrid/mail");
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  try {
    await sgMail.send({
      to,
      from: "sales@grgplayscapes.com",
      subject,
      text,
    });
    await snap.ref.update({ status: "sent", sentAt: new Date() });
  } catch (err) {
    console.error("[email] SendGrid error:", err);
    await snap.ref.update({ status: "failed", error: err.message });
  }
});

// ─── MAINTENANCE (SCHEDULED) ─────────────────────────────────────────────────
// Runs once per day. Purges expired trash and checks for overdue physical counts.
exports.maintenance = onSchedule("every day 06:00", async () => {
  console.log("[maintenance] Starting scheduled run…");

  // 1. Purge expired trash
  let trashPurged = 0;
  try {
    const now = new Date();
    const trashSnap = await db.collection("trash").where("purgeAt", "<=", now).get();
    for (const trashDoc of trashSnap.docs) {
      try {
        const { originalCollection, originalId } = trashDoc.data();
        try { await db.doc(`${originalCollection}/${originalId}`).delete(); } catch {}
        await trashDoc.ref.delete();
        trashPurged++;
      } catch {}
    }
  } catch (err) {
    console.error("[maintenance] Trash purge error:", err);
  }

  // 2. Physical count overdue check per location
  let overdueLocations = 0;
  try {
    const configSnap = await db.doc("appSettings/config").get();
    if (configSnap.exists) {
      const config = configSnap.data();
      const reminderDays = config.physicalCountReminderDays ?? 35;
      const now = new Date();
      const cutoff = new Date(now.getTime() - reminderDays * 24 * 60 * 60 * 1000);

      const locations = [
        { field: "lastFarmCount", label: "Farm" },
        { field: "lastMkeCount", label: "MKE" },
      ];

      for (const loc of locations) {
        const lastCount = config[loc.field];
        const lastDate = lastCount?.toDate ? lastCount.toDate() : (lastCount ? new Date(lastCount) : null);

        if (!lastDate || lastDate < cutoff) {
          const daysSince = lastDate
            ? Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
            : "unknown";
          await queueNotification(db, "PHYSICAL_COUNT_OVERDUE",
            `Physical Count Overdue — ${loc.label}`,
            `The ${loc.label} location has not had a physical count in ${daysSince} days (threshold: ${reminderDays} days).`
          );
          overdueLocations++;
        }
      }
    }
  } catch (err) {
    console.error("[maintenance] Overdue check error:", err);
  }

  console.log(`[maintenance] Done — trash purged: ${trashPurged}, overdue locations: ${overdueLocations}`);
});
