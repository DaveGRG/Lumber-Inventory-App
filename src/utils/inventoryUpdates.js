import { db } from '../firebase/config';
import { doc, getDoc, runTransaction, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { triggerNotification } from './notifications';
import { NOTIFICATION_EVENTS } from '../constants/notificationEvents';

// All inventory mutations go through this single function.
// Never write directly to inventory documents from components.
export async function adjustInventory({ skuId, sku = null, location, delta, reason, relatedId = null, userId, userName }) {
  const invRef = doc(db, 'inventory', `${skuId}_${location}`);
  let oldQty, newQty;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invRef);
    if (!snap.exists()) {
      throw new Error(`Inventory document not found: ${skuId}_${location}`);
    }
    oldQty = snap.data().quantity ?? 0;
    newQty = Math.max(0, oldQty + delta);
    tx.update(invRef, { quantity: newQty });
  });

  await addDoc(collection(db, 'auditLog'), {
    event: 'INVENTORY_ADJUSTED',
    skuId,
    sku,
    location,
    userId,
    userName,
    oldValue: oldQty,
    newValue: newQty,
    reason,
    relatedId,
    timestamp: serverTimestamp(),
  });

  // ── Post-adjustment notification checks (never block primary action) ──
  try {
    const absDelta = Math.abs(delta);

    // 1. Large inventory adjustment
    let threshold = 20;
    try {
      const configSnap = await getDoc(doc(db, 'appSettings', 'config'));
      if (configSnap.exists()) {
        threshold = configSnap.data().largeAdjustmentThreshold ?? 20;
      }
    } catch { /* use default */ }

    if (absDelta >= threshold) {
      triggerNotification(
        NOTIFICATION_EVENTS.LARGE_INVENTORY_ADJUSTMENT,
        `Large Adjustment — ${sku || skuId}`,
        `A large inventory adjustment was made.\n\nSKU: ${sku || skuId}\nLocation: ${location === 'farm' ? 'Farm' : 'MKE'}\nChange: ${oldQty} → ${newQty} (${delta >= 0 ? '+' : ''}${delta})\nReason: ${reason}\nAdjusted by: ${userName}`,
      );
    }

    // 2. SKU below par (only fire when crossing below par, not when already below)
    try {
      const skuSnap = await getDoc(doc(db, 'skus', skuId));
      if (skuSnap.exists()) {
        const skuData = skuSnap.data();
        const par = location === 'farm' ? (skuData.farmPar ?? 0) : (skuData.mkePar ?? 0);
        if (par > 0 && oldQty >= par && newQty < par) {
          triggerNotification(
            NOTIFICATION_EVENTS.SKU_BELOW_PAR,
            `SKU Below Par — ${sku || skuId}`,
            `SKU "${sku || skuId}" has dropped below par level.\n\nLocation: ${location === 'farm' ? 'Farm' : 'MKE'}\nPar: ${par}\nNew Qty: ${newQty}\nAdjusted by: ${userName}`,
          );
        }
      }
    } catch { /* silent — notification checks must not block */ }
  } catch { /* silent */ }
}
