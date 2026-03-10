import { db } from '../firebase/config';
import { doc, getDoc, updateDoc, setDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';

// Soft delete: copies document to trash, marks original as deleted, logs to auditLog.
// Never call doc.ref.delete() directly from the app — only the scheduled Cloud Function purges trash.
export async function softDelete(collectionName, docId, userId, userName) {
  const originalRef = doc(db, collectionName, docId);
  const snap = await getDoc(originalRef);

  if (!snap.exists()) throw new Error(`Document ${collectionName}/${docId} not found`);

  const data = snap.data();
  const now = new Date();
  const purgeAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Copy to trash
  await setDoc(doc(db, 'trash', docId), {
    originalCollection: collectionName,
    originalId: docId,
    data,
    deletedBy: userName,
    deletedByUid: userId,
    deletedAt: serverTimestamp(),
    purgeAt,
  });

  // Mark original as deleted
  await updateDoc(originalRef, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
  });

  // Log to audit
  await addDoc(collection(db, 'auditLog'), {
    event: 'ITEM_DELETED',
    skuId: data.skuId ?? data.id ?? null,
    sku: data.sku ?? null,
    location: data.location ?? null,
    userId,
    userName,
    oldValue: null,
    newValue: null,
    reason: `Soft deleted from ${collectionName}`,
    relatedId: docId,
    timestamp: serverTimestamp(),
  });
}

// Restore from trash: copies data back to original collection, removes trash doc.
export async function restoreFromTrash(trashId, userId, userName) {
  const trashRef = doc(db, 'trash', trashId);
  const snap = await getDoc(trashRef);

  if (!snap.exists()) throw new Error(`Trash document ${trashId} not found`);

  const { originalCollection, originalId, data } = snap.data();

  // Restore to original collection
  await setDoc(doc(db, originalCollection, originalId), {
    ...data,
    isDeleted: false,
    deletedAt: null,
  });

  // Remove from trash immediately
  await deleteDoc(trashRef);

  // Log to audit
  await addDoc(collection(db, 'auditLog'), {
    event: 'ITEM_RESTORED',
    skuId: data.skuId ?? null,
    sku: data.sku ?? null,
    location: data.location ?? null,
    userId,
    userName,
    oldValue: null,
    newValue: null,
    reason: `Restored from trash (${originalCollection})`,
    relatedId: originalId,
    timestamp: serverTimestamp(),
  });
}
