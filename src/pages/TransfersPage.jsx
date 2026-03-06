import { useState, useMemo, useEffect } from 'react';
import { Plus, X, Trash2, ArrowRight, Eye, Minus, Pencil } from 'lucide-react';
import {
  collection, addDoc, doc, updateDoc, serverTimestamp,
  onSnapshot, query, where, orderBy, increment,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { useInventory } from '../hooks/useInventory';
import { adjustInventory } from '../utils/inventoryUpdates';
import { softDelete } from '../utils/softDelete';
import { smartSearch } from '../utils/search';
import { generateRecordNumber } from '../utils/recordNumbers';
import Spinner from '../components/common/Spinner';
import SearchBar from '../components/common/SearchBar';
import StatusBadge from '../components/common/StatusBadge';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { triggerNotification } from '../utils/notifications';
import { NOTIFICATION_EVENTS } from '../constants/notificationEvents';

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const locLabel = (loc) => loc === 'farm' ? 'Farm' : 'MKE';

// ─── NEW TRANSFER POPUP ──────────────────────────────────────────────────────
function NewTransferPopup({ skus, user, onClose }) {
  const [from, setFrom] = useState('farm');
  const [skuSearch, setSkuSearch] = useState('');
  const [selectedItems, setSelectedItems] = useState({});
  const [notes, setNotes] = useState('');
  const [tNumber, setTNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const to = from === 'farm' ? 'mke' : 'farm';

  useEffect(() => {
    generateRecordNumber('transfers').then(setTNumber).catch(() => setTNumber('T#—'));
  }, []);

  const searchResults = useMemo(() => {
    if (!skuSearch.trim()) return [];
    return smartSearch(skus, skuSearch, ['sku', 'category'])
      .filter(s => !selectedItems[s.id] && s.status !== 'discontinued')
      .slice(0, 6);
  }, [skus, skuSearch, selectedItems]);

  const addSku = (sku) => {
    setSelectedItems(prev => ({
      ...prev,
      [sku.id]: { skuId: sku.id, sku: sku.sku, qty: 1 },
    }));
    setSkuSearch('');
  };

  const removeSku = (skuId) => {
    setSelectedItems(prev => { const n = { ...prev }; delete n[skuId]; return n; });
  };

  const adjustQty = (skuId, delta) => {
    setSelectedItems(prev => ({
      ...prev,
      [skuId]: { ...prev[skuId], qty: Math.max(1, prev[skuId].qty + delta) },
    }));
  };

  const handleCreate = async () => {
    const items = Object.values(selectedItems);
    if (items.length === 0) { setError('Add at least one SKU.'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'transfers'), {
        transferNumber: tNumber,
        from,
        to,
        status: 'requested',
        items: items.map(i => ({
          skuId: i.skuId, sku: i.sku,
          requestedQty: i.qty, receivedQty: null,
        })),
        notes: notes.trim(),
        createdBy: user.name || user.email,
        createdByUid: user.uid,
        shippedBy: null, receivedBy: null,
        shippedAt: null, receivedAt: null,
        discrepancyFlagged: false,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'auditLog'), {
        event: 'TRANSFER_CREATED',
        skuId: null, sku: null, location: null,
        userId: user.uid,
        userName: user.name || user.email,
        oldValue: null, newValue: tNumber,
        reason: `Transfer created: ${locLabel(from)} → ${locLabel(to)} (${items.length} SKU${items.length !== 1 ? 's' : ''})`,
        relatedId: null,
        timestamp: serverTimestamp(),
      });
      onClose();
    } catch {
      setError('Failed to create transfer. Try again.');
      setSaving(false);
    }
  };

  const selectedList = Object.values(selectedItems);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#2D5016' }}>New Transfer</h2>
            <p className="text-xs text-gray-400 mt-0.5">{tNumber || '…'}</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          {/* From → To */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1 block">From</label>
              <select value={from} onChange={e => setFrom(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px] bg-white">
                <option value="farm">Farm</option>
                <option value="mke">MKE</option>
              </select>
            </div>
            <ArrowRight size={20} className="text-gray-400 mt-5 flex-shrink-0" />
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1 block">To</label>
              <div className="px-3 py-2.5 border border-gray-100 rounded-lg bg-gray-50 text-sm font-medium text-gray-700 min-h-[44px] flex items-center">
                {locLabel(to)}
              </div>
            </div>
          </div>

          {/* SKU search */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Add Items</label>
            <SearchBar value={skuSearch} onChange={setSkuSearch} placeholder="Search SKU…" />
            {searchResults.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                {searchResults.map(sku => (
                  <button key={sku.id} onClick={() => addSku(sku)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors">
                    <span className="font-medium text-gray-800">{sku.sku}</span>
                    <span className="text-xs text-gray-400">{sku.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected SKUs */}
          {selectedList.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">
                Selected ({selectedList.length})
              </p>
              <div className="flex flex-col gap-2">
                {selectedList.map(item => (
                  <div key={item.skuId}
                    className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-sm font-medium text-gray-800 flex-1 truncate">{item.sku}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => adjustQty(item.skuId, -1)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-100">
                        <Minus size={14} />
                      </button>
                      <span className="w-10 text-center text-sm font-bold">{item.qty}</span>
                      <button onClick={() => adjustQty(item.skuId, 1)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-100">
                        <Plus size={14} />
                      </button>
                      <button onClick={() => removeSku(item.skuId)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-400 hover:text-red-600 rounded ml-1"
                        aria-label="Remove">
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Date */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Date</label>
            <div className="px-3 py-2.5 border border-gray-100 rounded-lg bg-gray-50 text-sm text-gray-700 min-h-[44px] flex items-center">
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage"
              rows={2} placeholder="Optional notes" />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving || selectedList.length === 0}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Creating…' : 'Request Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EDIT TRANSFER POPUP ─────────────────────────────────────────────────────
function EditTransferPopup({ transfer, skus, user, onClose }) {
  const [selectedItems, setSelectedItems] = useState(() => {
    const map = {};
    transfer.items?.forEach(item => {
      map[item.skuId] = { skuId: item.skuId, sku: item.sku, qty: item.requestedQty };
    });
    return map;
  });
  const [notes, setNotes] = useState(transfer.notes ?? '');
  const [skuSearch, setSkuSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const searchResults = useMemo(() => {
    if (!skuSearch.trim()) return [];
    return smartSearch(skus, skuSearch, ['sku', 'category'])
      .filter(s => !selectedItems[s.id] && s.status !== 'discontinued')
      .slice(0, 6);
  }, [skus, skuSearch, selectedItems]);

  const addSku = (sku) => {
    setSelectedItems(prev => ({ ...prev, [sku.id]: { skuId: sku.id, sku: sku.sku, qty: 1 } }));
    setSkuSearch('');
  };

  const removeSku = (skuId) => {
    setSelectedItems(prev => { const n = { ...prev }; delete n[skuId]; return n; });
  };

  const adjustQty = (skuId, delta) => {
    setSelectedItems(prev => ({
      ...prev,
      [skuId]: { ...prev[skuId], qty: Math.max(1, prev[skuId].qty + delta) },
    }));
  };

  const handleSave = async () => {
    const items = Object.values(selectedItems);
    if (items.length === 0) { setError('Add at least one SKU.'); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'transfers', transfer.id), {
        items: items.map(i => ({
          skuId: i.skuId, sku: i.sku,
          requestedQty: i.qty, receivedQty: null,
        })),
        notes: notes.trim(),
      });
      await addDoc(collection(db, 'auditLog'), {
        event: 'TRANSFER_UPDATED',
        skuId: null, sku: null, location: null,
        userId: user.uid, userName: user.name || user.email,
        oldValue: null, newValue: transfer.transferNumber,
        reason: `Transfer updated: ${transfer.transferNumber} (${items.length} SKU${items.length !== 1 ? 's' : ''})`,
        relatedId: transfer.id,
        timestamp: serverTimestamp(),
      });
      onClose();
    } catch {
      setError('Failed to save changes. Try again.');
      setSaving(false);
    }
  };

  const selectedList = Object.values(selectedItems);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#2D5016' }}>Edit Transfer</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {transfer.transferNumber} · {locLabel(transfer.from)} → {locLabel(transfer.to)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Add SKU</label>
            <SearchBar value={skuSearch} onChange={setSkuSearch} placeholder="Search SKU name or category…" />
            {searchResults.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                {searchResults.map(sku => (
                  <button key={sku.id} onClick={() => addSku(sku)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors">
                    <span className="font-medium text-gray-800">{sku.sku}</span>
                    <span className="text-xs text-gray-400">{sku.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedList.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">SKUs ({selectedList.length})</p>
              <div className="flex flex-col gap-2">
                {selectedList.map(item => (
                  <div key={item.skuId}
                    className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-sm font-medium text-gray-800 flex-1 truncate">{item.sku}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => adjustQty(item.skuId, -1)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-100">
                        <Minus size={14} />
                      </button>
                      <span className="w-10 text-center text-sm font-bold">{item.qty}</span>
                      <button onClick={() => adjustQty(item.skuId, 1)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-100">
                        <Plus size={14} />
                      </button>
                      <button onClick={() => removeSku(item.skuId)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-400 hover:text-red-600 rounded ml-1"
                        aria-label="Remove">
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage"
              rows={2} placeholder="Optional notes" />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || selectedList.length === 0}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── VIEW SKUs POPUP ─────────────────────────────────────────────────────────
function ViewSkusPopup({ transfer, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-base font-bold" style={{ color: '#2D5016' }}>{transfer.transferNumber}</p>
            <p className="text-xs text-gray-400">{locLabel(transfer.from)} → {locLabel(transfer.to)}</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg ml-3">
            <X size={22} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3">
          {transfer.items?.map((item, idx) => (
            <div key={item.skuId}
              className={`flex items-center justify-between py-3 border-b border-gray-100 ${
                idx % 2 === 1 ? '' : ''
              }`}>
              <p className="text-sm font-medium text-gray-800">{item.sku}</p>
              <div className="text-right">
                <p className="text-sm font-bold text-gray-700">Req: {item.requestedQty}</p>
                {item.receivedQty !== null && item.receivedQty !== undefined && (
                  <p className={`text-xs font-medium ${
                    item.receivedQty !== item.requestedQty ? 'text-orange-500' : 'text-gray-400'
                  }`}>
                    Rec: {item.receivedQty}
                  </p>
                )}
              </div>
            </div>
          ))}
          {transfer.notes ? (
            <div className="mt-3 bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 font-medium mb-1">Notes</p>
              <p className="text-sm text-gray-700">{transfer.notes}</p>
            </div>
          ) : null}
          {transfer.discrepancyFlagged && (
            <p className="text-xs text-orange-600 font-medium mt-3">⚠ Discrepancy was flagged on receipt</p>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="w-full min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SHIP POPUP ──────────────────────────────────────────────────────────────
function ShipPopup({ transfer, user, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const handleShip = async () => {
    setConfirming(true);
    try {
      await updateDoc(doc(db, 'transfers', transfer.id), {
        status: 'in_transit',
        shippedBy: user.name || user.email,
        shippedAt: serverTimestamp(),
      });

      // Set inTransitQty on from-location inventory docs (display only — not adjustInventory)
      await Promise.all(
        transfer.items.map(item =>
          updateDoc(doc(db, 'inventory', `${item.skuId}_${transfer.from}`), {
            inTransitQty: increment(item.requestedQty),
          })
        )
      );

      await addDoc(collection(db, 'auditLog'), {
        event: 'TRANSFER_SHIPPED',
        skuId: null, sku: null,
        location: transfer.from,
        userId: user.uid,
        userName: user.name || user.email,
        oldValue: 'requested', newValue: 'in_transit',
        reason: `Transfer shipped: ${locLabel(transfer.from)} → ${locLabel(transfer.to)}`,
        relatedId: transfer.id,
        timestamp: serverTimestamp(),
      });

      triggerNotification(
        NOTIFICATION_EVENTS.TRANSFER_SHIPPED,
        `Transfer ${transfer.transferNumber} Shipped`,
        `Transfer ${transfer.transferNumber} has been shipped.\n\nFrom: ${locLabel(transfer.from)}\nTo: ${locLabel(transfer.to)}\nItems:\n${transfer.items.map(i => `  ${i.sku} — Qty: ${i.requestedQty}`).join('\n')}\n\nShipped by: ${user.name || user.email}`,
      );

      onClose();
    } catch {
      setError('Failed to confirm shipment. Try again.');
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close"
          className="absolute top-3 right-3 min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
          <X size={22} />
        </button>
        <h2 className="text-base font-semibold pr-8 mb-0.5" style={{ color: '#2D5016' }}>Confirm Shipment</h2>
        <p className="text-sm text-gray-500 mb-4">
          {transfer.transferNumber} · {locLabel(transfer.from)} → {locLabel(transfer.to)}
        </p>

        <div className="bg-gray-50 rounded-lg p-3 mb-3">
          {transfer.items?.map(item => (
            <div key={item.skuId}
              className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
              <p className="text-sm text-gray-700">{item.sku}</p>
              <p className="text-sm font-semibold text-gray-700">×{item.requestedQty}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400 mb-4">
          Quantities stay unchanged until received. Items will show as "in transit" at {locLabel(transfer.from)}.
        </p>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleShip} disabled={confirming}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {confirming ? 'Confirming…' : 'Confirm Shipment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RECEIVE POPUP ───────────────────────────────────────────────────────────
function ReceivePopup({ transfer, user, onClose }) {
  const [receivedQtys, setReceivedQtys] = useState(() => {
    const map = {};
    transfer.items?.forEach(item => { map[item.skuId] = item.requestedQty; });
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hasDiscrepancy = transfer.items?.some(
    item => (receivedQtys[item.skuId] ?? item.requestedQty) !== item.requestedQty
  );

  const handleReceive = async () => {
    setSaving(true);
    try {
      const updatedItems = transfer.items.map(item => ({
        ...item,
        receivedQty: receivedQtys[item.skuId] ?? item.requestedQty,
      }));

      for (const item of updatedItems) {
        const qty = item.receivedQty;
        // Positive delta on "to" location
        await adjustInventory({
          skuId: item.skuId, sku: item.sku,
          location: transfer.to, delta: qty,
          reason: `Transfer received: ${transfer.transferNumber}`,
          relatedId: transfer.id,
          userId: user.uid, userName: user.name || user.email,
        });
        // Negative delta on "from" location
        await adjustInventory({
          skuId: item.skuId, sku: item.sku,
          location: transfer.from, delta: -qty,
          reason: `Transfer shipped out: ${transfer.transferNumber}`,
          relatedId: transfer.id,
          userId: user.uid, userName: user.name || user.email,
        });
        // Decrement inTransitQty on "from" location (supports concurrent transfers)
        await updateDoc(doc(db, 'inventory', `${item.skuId}_${transfer.from}`), {
          inTransitQty: increment(-item.requestedQty),
        });
      }

      await updateDoc(doc(db, 'transfers', transfer.id), {
        status: 'received',
        receivedBy: user.name || user.email,
        receivedAt: serverTimestamp(),
        discrepancyFlagged: hasDiscrepancy,
        items: updatedItems,
      });

      await addDoc(collection(db, 'auditLog'), {
        event: 'TRANSFER_RECEIVED',
        skuId: null, sku: null,
        location: transfer.to,
        userId: user.uid,
        userName: user.name || user.email,
        oldValue: 'in_transit', newValue: 'received',
        reason: `Transfer received: ${locLabel(transfer.from)} → ${locLabel(transfer.to)}`,
        relatedId: transfer.id,
        timestamp: serverTimestamp(),
      });

      if (hasDiscrepancy) {
        await addDoc(collection(db, 'auditLog'), {
          event: 'TRANSFER_DISCREPANCY',
          skuId: null, sku: null, location: null,
          userId: user.uid, userName: user.name || user.email,
          oldValue: null, newValue: null,
          reason: `Qty discrepancy flagged on ${transfer.transferNumber}`,
          relatedId: transfer.id,
          timestamp: serverTimestamp(),
        });
        const discrepancies = updatedItems
          .filter(i => i.receivedQty !== i.requestedQty)
          .map(i => `  ${i.sku}: expected ${i.requestedQty}, received ${i.receivedQty}`)
          .join('\n');
        triggerNotification(
          NOTIFICATION_EVENTS.TRANSFER_DISCREPANCY,
          `Transfer Discrepancy — ${transfer.transferNumber}`,
          `A quantity discrepancy was flagged on transfer ${transfer.transferNumber}.\n\nFrom: ${locLabel(transfer.from)}\nTo: ${locLabel(transfer.to)}\n\nDiscrepancies:\n${discrepancies}\n\nReceived by: ${user.name || user.email}`,
        );
      }

      triggerNotification(
        NOTIFICATION_EVENTS.TRANSFER_RECEIVED,
        `Transfer ${transfer.transferNumber} Received`,
        `Transfer ${transfer.transferNumber} has been received.\n\nFrom: ${locLabel(transfer.from)}\nTo: ${locLabel(transfer.to)}\nItems:\n${updatedItems.map(i => `  ${i.sku} — Requested: ${i.requestedQty}, Received: ${i.receivedQty}`).join('\n')}\n\nReceived by: ${user.name || user.email}`,
      );
      onClose();
    } catch {
      setError('Failed to receive transfer. Try again.');
      setSaving(false);
    }
  };

  const setQty = (skuId, val) =>
    setReceivedQtys(p => ({ ...p, [skuId]: Math.max(0, parseInt(val, 10) || 0) }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col max-h-[90dvh]"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#2D5016' }}>Receive Transfer</h2>
            <p className="text-xs text-gray-400">{transfer.transferNumber} · {locLabel(transfer.from)} → {locLabel(transfer.to)}</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg ml-3">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          <p className="text-xs text-gray-500 mb-3">Enter the quantity actually received for each SKU.</p>
          <div className="flex flex-col gap-3">
            {transfer.items?.map(item => {
              const rec = receivedQtys[item.skuId] ?? item.requestedQty;
              const isDisc = rec !== item.requestedQty;
              return (
                <div key={item.skuId}
                  className={`rounded-lg p-3 ${isDisc ? 'bg-orange-50 border border-orange-200' : 'bg-gray-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-800">{item.sku}</p>
                    <p className="text-xs text-gray-400">Requested: {item.requestedQty}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQty(item.skuId, rec - 1)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded border border-gray-200 bg-white text-base font-bold hover:bg-gray-50">
                      −
                    </button>
                    <input
                      type="number" min="0" value={rec}
                      onChange={e => setQty(item.skuId, e.target.value)}
                      className="flex-1 text-center text-base font-bold border border-gray-200 rounded min-h-[40px] focus:outline-none focus:ring-2 focus:ring-grg-sage bg-white"
                    />
                    <button
                      onClick={() => setQty(item.skuId, rec + 1)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded border border-gray-200 bg-white text-base font-bold hover:bg-gray-50">
                      +
                    </button>
                  </div>
                  {isDisc && (
                    <p className="text-xs text-orange-600 font-medium mt-1.5">
                      ⚠ {rec < item.requestedQty
                        ? `${item.requestedQty - rec} short`
                        : `${rec - item.requestedQty} extra`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {hasDiscrepancy && (
            <p className="text-xs text-orange-600 bg-orange-50 rounded-lg p-3 mt-3 border border-orange-200">
              Discrepancies will be flagged in the audit log and a notification will be sent.
            </p>
          )}
          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleReceive} disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Receiving…' : 'Confirm Receive'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TRANSFERS PAGE ──────────────────────────────────────────────────────────
export default function TransfersPage() {
  const { user } = useAuth();
  const { hiViz } = useTheme();
  const { skus } = useInventory();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [viewTarget, setViewTarget] = useState(null);
  const [shipTarget, setShipTarget] = useState(null);
  const [receiveTarget, setReceiveTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'transfers'),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q,
      snap => { setTransfers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error('Transfers query error:', err); setLoading(false); }
    );
  }, []);

  const filtered = useMemo(() => {
    let list = statusFilter === 'all' ? transfers : transfers.filter(t => t.status === statusFilter);
    if (!search.trim()) return list;
    return smartSearch(
      list.map(t => ({ ...t, _loc: `${t.from} ${t.to}` })),
      search,
      ['transferNumber', '_loc', 'status', 'createdBy']
    );
  }, [transfers, search, statusFilter]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try { await softDelete('transfers', deleteTarget.id, user.uid, user.name || user.email); } catch {}
    setDeleteSaving(false);
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 pt-3 pb-3 space-y-2">
        <div className="flex items-center justify-end">
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-white text-sm font-semibold"
            style={{ backgroundColor: '#4CB31D' }}
          >
            <Plus size={18} /> New
          </button>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search transfers…" />
        <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
          {[
            { key: 'all', label: 'All' },
            { key: 'requested', label: 'Requested' },
            { key: 'in_transit', label: 'In Transit' },
            { key: 'received', label: 'Received' },
          ].map(chip => (
            <button key={chip.key}
              onClick={() => setStatusFilter(chip.key)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[32px]"
              style={statusFilter === chip.key
                ? { backgroundColor: '#4CB31D', color: '#fff' }
                : { backgroundColor: '#f3f4f6', color: '#4b5563' }}>
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transfer list */}
      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {search ? `No transfers match "${search}"` : 'No transfers yet. Tap New to create one.'}
            </p>
          </div>
        ) : filtered.map((t, idx) => (
          <div
            key={t.id}
            className={`px-4 py-3 border-b border-gray-100 active:bg-gray-100 transition-colors ${idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'}`}
          >
            {/* Top row: T# + direction + status + discrepancy flag */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-sm font-bold" style={{ color: '#2D5016' }}>
                {t.transferNumber}
              </span>
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <span className="font-medium">{locLabel(t.from)}</span>
                <ArrowRight size={12} className="text-gray-400" />
                <span className="font-medium">{locLabel(t.to)}</span>
              </div>
              <StatusBadge status={t.status} />
              {t.discrepancyFlagged && (
                <span className="text-xs text-orange-500 font-semibold">⚠ Discrepancy</span>
              )}
            </div>

            {/* Bottom row: meta + action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">
                {t.items?.length ?? 0} SKU{(t.items?.length ?? 0) !== 1 ? 's' : ''}
              </span>
              {t.createdAt && (
                <span className="text-xs text-gray-400">· {formatDate(t.createdAt)}</span>
              )}
              {t.createdBy && (
                <span className="text-xs text-gray-400">· {t.createdBy}</span>
              )}

              <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
                {/* View SKUs */}
                <button
                  onClick={() => setViewTarget(t)}
                  className="min-h-[36px] px-2 sm:px-2.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-1"
                >
                  <Eye size={13} /> SKUs
                </button>

                {/* Edit button — requested only */}
                {t.status === 'requested' && (
                  <button
                    onClick={() => setEditTarget(t)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                    aria-label="Edit transfer"
                  >
                    <Pencil size={14} />
                  </button>
                )}

                {/* Ship button — requested only */}
                {t.status === 'requested' && (
                  <button
                    onClick={() => setShipTarget(t)}
                    className="min-h-[36px] px-3 rounded-lg text-xs font-semibold text-white"
                    style={{ backgroundColor: '#4CB31D' }}
                  >
                    Ship
                  </button>
                )}

                {/* Receive button — in_transit only */}
                {t.status === 'in_transit' && (
                  <button
                    onClick={() => setReceiveTarget(t)}
                    className="min-h-[36px] px-3 rounded-lg text-xs font-semibold text-white"
                    style={{ backgroundColor: '#D97706' }}
                  >
                    Receive
                  </button>
                )}

                {/* Delete — requested only */}
                {t.status === 'requested' && (
                  <button
                    onClick={() => setDeleteTarget(t)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-500 hover:text-red-700 rounded"
                    aria-label="Delete transfer"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Popups */}
      {showNew && <NewTransferPopup skus={skus} user={user} onClose={() => setShowNew(false)} />}
      {editTarget && <EditTransferPopup transfer={editTarget} skus={skus} user={user} onClose={() => setEditTarget(null)} />}
      {viewTarget && <ViewSkusPopup transfer={viewTarget} onClose={() => setViewTarget(null)} />}
      {shipTarget && <ShipPopup transfer={shipTarget} user={user} onClose={() => setShipTarget(null)} />}
      {receiveTarget && <ReceivePopup transfer={receiveTarget} user={user} onClose={() => setReceiveTarget(null)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Transfer?"
        message={`"${deleteTarget?.transferNumber}" will be soft-deleted. Only Requested transfers can be deleted.`}
        confirmLabel={deleteSaving ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
