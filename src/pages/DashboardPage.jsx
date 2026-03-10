import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronRight, Plus, X, Trash2, Download, Minus, ClipboardList, AlertTriangle } from 'lucide-react';
import {
  collection, addDoc, setDoc, doc, updateDoc, serverTimestamp,
  onSnapshot, query, orderBy, where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { useInventory } from '../hooks/useInventory';
import { useBelowPar } from '../hooks/useBelowPar';
import { softDelete } from '../utils/softDelete';
import { smartSearch } from '../utils/search';
import Spinner from '../components/common/Spinner';
import { generateRecordNumber } from '../utils/recordNumbers';
import { adjustInventory } from '../utils/inventoryUpdates';
import SearchBar from '../components/common/SearchBar';
import CategoryMenu from '../components/common/CategoryMenu';
import BelowParBadge from '../components/common/BelowParBadge';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { triggerNotification } from '../utils/notifications';
import { NOTIFICATION_EVENTS } from '../constants/notificationEvents';

const CATEGORIES = ['CDR', 'CT', 'GT'];
const CATEGORY_LABELS = { CDR: 'Cedar', CT: 'Cedartone', GT: 'Green Treated' };

// Red triangle warning badge shown on category headers when items are below par
function BelowParWarning({ count }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 bg-red-600 text-white text-[11px] font-bold rounded px-1.5 py-0.5 leading-none">
      <AlertTriangle size={11} strokeWidth={2.5} />
      {count}
    </span>
  );
}


function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Add SKU Popup ──────────────────────────────────────────────────────────────
function AddSkuPopup({ user, onClose }) {
  const [form, setForm] = useState({
    sku: '', category: 'CDR', farmPar: '', mkePar: '', status: 'active', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleCreate = async () => {
    if (!form.sku.trim()) { setError('SKU name is required.'); return; }
    const farmPar = parseInt(form.farmPar, 10);
    const mkePar = parseInt(form.mkePar, 10);
    if (isNaN(farmPar) || farmPar < 0) { setError('Valid Farm Par required (0 or more).'); return; }
    if (isNaN(mkePar) || mkePar < 0) { setError('Valid MKE Par required (0 or more).'); return; }

    setSaving(true);
    setError('');
    try {
      const skuRef = await addDoc(collection(db, 'skus'), {
        sku: form.sku.trim(),
        category: form.category,
        farmPar,
        mkePar,
        status: form.status,
        notes: form.notes.trim(),
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      const newId = skuRef.id;

      await Promise.all([
        setDoc(doc(db, 'inventory', `${newId}_farm`), {
          skuId: newId,
          location: 'farm',
          quantity: 0,
          inTransitQty: 0,
        }),
        setDoc(doc(db, 'inventory', `${newId}_mke`), {
          skuId: newId,
          location: 'mke',
          quantity: 0,
          inTransitQty: 0,
        }),
        addDoc(collection(db, 'auditLog'), {
          event: 'SKU_CREATED',
          skuId: newId,
          sku: form.sku.trim(),
          location: null,
          userId: user.uid,
          userName: user.name || user.email,
          oldValue: null,
          newValue: null,
          reason: 'SKU created',
          relatedId: null,
          timestamp: serverTimestamp(),
        }),
      ]);

      onClose();
    } catch {
      setError('Failed to create SKU. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg"
        >
          <X size={22} />
        </button>

        <h2 className="text-base font-semibold pr-8 mb-4" style={{ color: '#2D5016' }}>Add SKU</h2>

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">SKU Name *</label>
            <input
              type="text"
              value={form.sku}
              onChange={e => set('sku', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="e.g. CDR 2x4x8"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Category *</label>
            <select
              value={form.category}
              onChange={e => set('category', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px] bg-white"
            >
              <option value="CDR">Cedar (CDR)</option>
              <option value="CT">Cedartone (CT)</option>
              <option value="GT">Green Treated (GT)</option>
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1 block">Farm Par *</label>
              <input
                type="number"
                min="0"
                value={form.farmPar}
                onChange={e => set('farmPar', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                placeholder="0"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1 block">MKE Par *</label>
              <input
                type="number"
                min="0"
                value={form.mkePar}
                onChange={e => set('mkePar', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Status</label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px] bg-white"
            >
              <option value="active">Active</option>
              <option value="discontinued">Discontinued</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage"
              rows={2}
              placeholder="Optional notes"
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}
          >
            {saving ? 'Creating…' : 'Create SKU'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Manage SKUs Subpage ────────────────────────────────────────────────────────
function ManageSkusView({ onBack, user }) {
  const { skus, inventory, loading } = useInventory();
  const belowParAll = useBelowPar(inventory, skus);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, sku }
  const [deleteSaving, setDeleteSaving] = useState(false);

  // Track inline par edits: key = `${skuId}_farmPar` or `${skuId}_mkePar`, value = string
  const [parEdits, setParEdits] = useState({});

  const belowParSkuIds = useMemo(
    () => new Set(belowParAll.map(i => i.skuId)),
    [belowParAll]
  );

  const searched = useMemo(() => {
    if (!search.trim()) return skus;
    return smartSearch(skus, search, ['sku', 'category']);
  }, [skus, search]);

  const grouped = useMemo(() => {
    return CATEGORIES.reduce((acc, cat) => {
      acc[cat] = searched.filter(s => s.category === cat);
      return acc;
    }, {});
  }, [searched]);

  const handleParFocus = (skuId, field, currentVal) => {
    setParEdits(p => ({ ...p, [`${skuId}_${field}`]: String(currentVal) }));
  };

  const handleParChange = (skuId, field, val) => {
    setParEdits(p => ({ ...p, [`${skuId}_${field}`]: val }));
  };

  const handleParBlur = async (sku, field, rawValue) => {
    const key = `${sku.id}_${field}`;
    setParEdits(p => { const n = { ...p }; delete n[key]; return n; });

    const parsed = parseInt(rawValue, 10);
    if (isNaN(parsed) || parsed < 0 || parsed === sku[field]) return;

    try {
      await updateDoc(doc(db, 'skus', sku.id), { [field]: parsed });
      await addDoc(collection(db, 'auditLog'), {
        event: 'PAR_EDITED',
        skuId: sku.id,
        sku: sku.sku,
        location: null,
        userId: user.uid,
        userName: user.name || user.email,
        oldValue: sku[field],
        newValue: parsed,
        reason: `${field === 'farmPar' ? 'Farm' : 'MKE'} par updated`,
        relatedId: null,
        timestamp: serverTimestamp(),
      });
    } catch { /* silent — real-time listener will revert on failure */ }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      await softDelete('skus', deleteTarget.id, user.uid, user.name || user.email);
      triggerNotification(
        NOTIFICATION_EVENTS.SKU_DELETED,
        `SKU Deleted — ${deleteTarget.sku}`,
        `SKU "${deleteTarget.sku}" has been deleted.\n\nDeleted by: ${user.name || user.email}`,
      );
    } catch { /* silent */ }
    setDeleteSaving(false);
    setDeleteTarget(null);
  };

  if (loading) {
    return (
      <Spinner />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Subpage header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
            aria-label="Back"
          >
            <ChevronRight size={22} className="rotate-180" />
          </button>
          <h2 onClick={onBack} className="text-lg font-bold flex-1 cursor-pointer hover:underline" style={{ color: '#2D5016' }}>Manage SKUs</h2>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-white text-sm font-semibold"
            style={{ backgroundColor: '#4CB31D' }}
          >
            <Plus size={18} />
            Add SKU
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <SearchBar value={search} onChange={setSearch} placeholder="Search SKU or category…" />
        </div>
      </div>

      {/* Category menus */}
      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {CATEGORIES.map(cat => {
          const items = grouped[cat] ?? [];
          const belowParCount = items.filter(s => belowParSkuIds.has(s.id)).length;
          return (
            <CategoryMenu key={cat} title={CATEGORY_LABELS[cat]} defaultOpen={false} count={items.length} badge={<BelowParWarning count={belowParCount} />}>
              {items.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-400 italic">No items</p>
              ) : (
                <>
                  {/* Column header row inside each expanded section */}
                  <div className="sticky top-[44px] z-[9] flex items-center px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-100">
                    <span className="flex-1">SKU</span>
                    <span className="w-20 text-center">Farm Par</span>
                    <span className="w-20 text-center">MKE Par</span>
                    <span className="w-10" />
                  </div>
                  {items.map((sku, idx) => {
                  const isBP = belowParSkuIds.has(sku.id);
                  const farmKey = `${sku.id}_farmPar`;
                  const mkeKey = `${sku.id}_mkePar`;
                  const farmVal = parEdits[farmKey] !== undefined ? parEdits[farmKey] : sku.farmPar;
                  const mkeVal = parEdits[mkeKey] !== undefined ? parEdits[mkeKey] : sku.mkePar;

                  return (
                    <div
                      key={sku.id}
                      className={`flex items-center px-4 py-2.5 min-h-[52px] ${
                        idx % 2 === 1 ? 'bg-[#F0F0E8]/30' : 'bg-white'
                      }`}
                    >
                      {/* SKU name */}
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {isBP && <BelowParBadge />}
                        <span className="text-sm font-medium text-gray-800 truncate">{sku.sku}</span>
                      </div>

                      {/* Farm Par — inline editable */}
                      <div className="w-20 flex justify-center">
                        <input
                          type="number"
                          min="0"
                          value={farmVal}
                          onFocus={() => handleParFocus(sku.id, 'farmPar', sku.farmPar)}
                          onChange={e => handleParChange(sku.id, 'farmPar', e.target.value)}
                          onBlur={e => handleParBlur(sku, 'farmPar', e.target.value)}
                          className="w-14 text-center text-sm font-medium border border-transparent rounded focus:border-grg-sage focus:outline-none focus:ring-1 focus:ring-grg-sage py-1 min-h-[36px]"
                        />
                      </div>

                      {/* MKE Par — inline editable */}
                      <div className="w-20 flex justify-center">
                        <input
                          type="number"
                          min="0"
                          value={mkeVal}
                          onFocus={() => handleParFocus(sku.id, 'mkePar', sku.mkePar)}
                          onChange={e => handleParChange(sku.id, 'mkePar', e.target.value)}
                          onBlur={e => handleParBlur(sku, 'mkePar', e.target.value)}
                          className="w-14 text-center text-sm font-medium border border-transparent rounded focus:border-grg-sage focus:outline-none focus:ring-1 focus:ring-grg-sage py-1 min-h-[36px]"
                        />
                      </div>

                      {/* Trash */}
                      <div className="w-10 flex justify-center">
                        <button
                          onClick={() => setDeleteTarget({ id: sku.id, sku: sku.sku })}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-500 hover:text-red-700 rounded"
                          aria-label={`Delete ${sku.sku}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  );
                })
                }</>
              )}
            </CategoryMenu>
          );
        })}

        {search && CATEGORIES.every(cat => (grouped[cat] ?? []).length === 0) && (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No SKUs match "{search}"</p>
          </div>
        )}
      </div>

      {showAdd && <AddSkuPopup user={user} onClose={() => setShowAdd(false)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete SKU?"
        message={`"${deleteTarget?.sku}" will be soft-deleted and hidden from inventory. It can be restored from Admin Control within 30 days.`}
        confirmLabel={deleteSaving ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── Generate Purchase Request Popup ──────────────────────────────────────────────
function GenerateQRPopup({ selectedItems, user, onClose, onSent }) {
  const [recipients, setRecipients] = useState([]);
  const [recipientId, setRecipientId] = useState('');
  const [qtys, setQtys] = useState(() => {
    const map = {};
    selectedItems.forEach(item => { map[item.key] = 0; });
    return map;
  });
  const [notes, setNotes] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Load team members for Send To dropdown and generate PR# on mount
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('isActive', '==', true)),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRecipients(list);
        if (!recipientId && list.length > 0) setRecipientId(list[0].id);
      }
    );
    generateRecordNumber('quoteRequests').then(setPrNumber).catch(() => setPrNumber('PR#—'));
    return unsub;
  }, []);

  const adjustQty = (key, delta) => {
    setQtys(prev => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + delta) }));
  };

  const handleSend = async () => {
    if (!recipientId) { setError('Please select a recipient.'); return; }
    const recipient = recipients.find(r => r.id === recipientId);
    if (!recipient) { setError('Recipient not found.'); return; }

    setSending(true);
    try {
      const items = selectedItems.map(item => ({
        skuId: item.sku.id,
        sku: item.sku.sku,
        location: item.inv.location,
        qty: qtys[item.key] ?? 0,
      }));

      await addDoc(collection(db, 'quoteRequests'), {
        qrNumber: prNumber,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        items,
        notes: notes.trim(),
        sentAt: serverTimestamp(),
        sentBy: user.name || user.email,
        sentByUid: user.uid,
        isDeleted: false,
      });

      await addDoc(collection(db, 'auditLog'), {
        event: 'PURCHASE_REQUEST_SENT',
        skuId: null,
        sku: null,
        location: null,
        userId: user.uid,
        userName: user.name || user.email,
        oldValue: null,
        newValue: prNumber,
        reason: `Purchase request sent to ${recipient.name} (${items.length} SKU${items.length !== 1 ? 's' : ''})`,
        relatedId: null,
        timestamp: serverTimestamp(),
      });

      triggerNotification(
        NOTIFICATION_EVENTS.PURCHASE_REQUEST_SENT,
        `Purchase Request ${prNumber} — ${recipient.name}`,
        `Purchase Request: ${prNumber}\nDate: ${new Date().toLocaleDateString()}\nSent to: ${recipient.name} (${recipient.email})\n\nThe following is a list of suggested lumber purchases:\n${items.map(i => `  ${i.sku} — Qty: ${i.qty}`).join('\n')}\n${notes.trim() ? `\nNotes: ${notes.trim()}` : ''}\n\nSent by: ${user.name || user.email}`,
        { extraRecipients: [recipient.email] },
      );

      onSent();
      onClose();
    } catch {
      setError('Failed to send purchase request. Try again.');
      setSending(false);
    }
  };

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#2D5016' }}>Generate Purchase Request</h2>
            <p className="text-xs text-gray-400 mt-0.5">{prNumber || '…'} · {today}</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={22} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-4">
          {/* Send To */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Send To *</label>
            {recipients.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No recipients available.</p>
            ) : (
              <select
                value={recipientId}
                onChange={e => setRecipientId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px] bg-white"
              >
                {recipients.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* SKUs with qty adjusters */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">SKUs ({selectedItems.length})</p>
            <div className="flex flex-col gap-2">
              {selectedItems.map(item => (
                <div key={item.key}
                  className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.sku.sku}</p>
                    <p className="text-xs text-gray-400 uppercase">{item.inv.location}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => adjustQty(item.key, -1)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded border border-gray-200 hover:bg-gray-100"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={qtys[item.key] ?? 0}
                      onChange={(e) => {
                        const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0);
                        setQtys(prev => ({ ...prev, [item.key]: val }));
                      }}
                      onFocus={(e) => e.target.select()}
                      className="w-14 text-center text-sm font-semibold border border-gray-200 rounded py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      onClick={() => adjustQty(item.key, 1)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded border border-gray-200 hover:bg-gray-100"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage"
              rows={2}
              placeholder="Optional notes for this purchase request"
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || recipients.length === 0}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}
          >
            {sending ? 'Sending…' : 'Send Purchase Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Par Report View ────────────────────────────────────────────────────────────
function ParReportView({ onBack, user }) {
  const { skus, inventory, loading } = useInventory();
  const belowParAll = useBelowPar(inventory, skus);
  const [activeTab, setActiveTab] = useState('farm');
  const [selected, setSelected] = useState(new Set()); // keys: `${skuId}_${location}`
  const [showQR, setShowQR] = useState(false);
  const [sent, setSent] = useState(false);

  // Enrich below-par items with SKU data
  const enriched = useMemo(() => {
    return belowParAll.map(inv => {
      const sku = skus.find(s => s.id === inv.skuId);
      if (!sku) return null;
      const par = inv.location === 'farm' ? sku.farmPar : sku.mkePar;
      const shortfall = par - inv.quantity;
      return { inv, sku, par, shortfall, key: `${inv.skuId}_${inv.location}` };
    }).filter(Boolean);
  }, [belowParAll, skus]);

  // Items for the active tab, grouped by category
  const tabItems = useMemo(
    () => enriched.filter(i => i.inv.location === activeTab),
    [enriched, activeTab]
  );

  const grouped = useMemo(() =>
    CATEGORIES.reduce((acc, cat) => {
      acc[cat] = tabItems.filter(i => i.sku.category === cat);
      return acc;
    }, {}),
    [tabItems]
  );

  const toggleSelect = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectedItems = useMemo(
    () => enriched.filter(i => selected.has(i.key)),
    [enriched, selected]
  );

  if (loading) {
    return (
      <Spinner />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
            aria-label="Back"
          >
            <ChevronRight size={22} className="rotate-180" />
          </button>
          <h2 onClick={onBack} className="text-lg font-bold flex-1 cursor-pointer hover:underline" style={{ color: '#2D5016' }}>Par Report</h2>
          {selected.size > 0 && (
            <span className="text-sm text-gray-500">{selected.size} selected</span>
          )}
        </div>

        {/* Farm / MKE tab switcher */}
        <div className="px-4 pb-3 flex gap-2">
          {['farm', 'mke'].map(loc => (
            <button
              key={loc}
              onClick={() => setActiveTab(loc)}
              className={`flex-1 min-h-[40px] rounded-lg border text-sm font-semibold transition-colors ${
                activeTab === loc ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              style={activeTab === loc ? { backgroundColor: '#4CB31D' } : {}}
            >
              {loc === 'farm' ? 'Farm' : 'MKE'}
            </button>
          ))}
        </div>
      </div>

      {/* Body — key resets expanded state on tab switch */}
      <div key={activeTab} className={`flex-1 overflow-y-auto ${selected.size > 0 ? 'pb-28' : 'pb-20 md:pb-4'}`}>
        {tabItems.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <p className="text-gray-400 text-sm">
              All {activeTab === 'farm' ? 'Farm' : 'MKE'} SKUs are at or above par.
            </p>
          </div>
        ) : (
          CATEGORIES.map(cat => {
            const items = grouped[cat] ?? [];
            return (
              <CategoryMenu
                key={cat}
                title={CATEGORY_LABELS[cat]}
                defaultOpen={false}
                count={items.length > 0 ? items.length : null}
                badge={<BelowParWarning count={items.length} />}
              >
                {items.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-400 italic">All at par.</p>
                ) : items.map((item, idx) => {
                  const isSelected = selected.has(item.key);
                  return (
                    <button
                      key={item.key}
                      onClick={() => toggleSelect(item.key)}
                      className={`w-full flex items-center gap-3 px-4 py-3 min-h-[52px] text-left transition-colors ${
                        isSelected
                          ? 'bg-grg-tan/40'
                          : idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'
                      }`}
                    >
                      {/* Checkbox */}
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'border-grg-green' : 'border-gray-300'
                        }`}
                        style={isSelected ? { backgroundColor: '#4CB31D', borderColor: '#4CB31D' } : {}}
                      >
                        {isSelected && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>

                      {/* SKU info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{item.sku.sku}</p>
                        <p className="text-xs text-red-500 font-medium">
                          Below by {item.shortfall} · Par: {item.par}
                        </p>
                      </div>

                      {/* Current qty */}
                      <div className="text-right flex-shrink-0">
                        <p className="text-base font-bold text-red-600">{item.inv.quantity}</p>
                        <p className="text-xs text-gray-400">in stock</p>
                      </div>
                    </button>
                  );
                })}
              </CategoryMenu>
            );
          })
        )}
      </div>

      {/* Sticky Generate QR button */}

      {selected.size > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 px-4 pb-4 pt-3 bg-white border-t border-gray-200 z-10">
          <button
            onClick={() => setShowQR(true)}
            className="w-full min-h-[52px] rounded-xl text-white font-semibold text-base"
            style={{ backgroundColor: '#4CB31D' }}
          >
            Generate Purchase Request ({selected.size} item{selected.size !== 1 ? 's' : ''})
          </button>
        </div>
      )}

      {showQR && (
        <GenerateQRPopup
          selectedItems={selectedItems}
          user={user}
          onClose={() => setShowQR(false)}
          onSent={() => { setSelected(new Set()); setSent(true); }}
        />
      )}
    </div>
  );
}

// ─── All Pulls View ─────────────────────────────────────────────────────────────
function AllPullsView({ onBack }) {
  const [pulls, setPulls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'pulls'), where('isDeleted', '==', false), orderBy('pulledAt', 'desc'));
    return onSnapshot(q,
      snap => { setPulls(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return pulls;
    return smartSearch(pulls, search, ['pullNumber', 'productName', 'pulledBy', 'location']);
  }, [pulls, search]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
            aria-label="Back">
            <ChevronRight size={22} className="rotate-180" />
          </button>
          <h2 onClick={onBack} className="text-lg font-bold flex-1 cursor-pointer hover:underline" style={{ color: '#2D5016' }}>All Pulls</h2>
        </div>
        <div className="px-4 pb-3">
          <SearchBar value={search} onChange={setSearch} placeholder="Search product, pull#, location…" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {search ? `No pulls match "${search}"` : 'No pulls recorded yet.'}
            </p>
          </div>
        ) : filtered.map((pull, idx) => (
          <div key={pull.id} className={`border-b border-gray-100 ${idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'}`}>
            <button
              onClick={() => setExpanded(expanded === pull.id ? null : pull.id)}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[60px] text-left active:bg-gray-100 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold" style={{ color: '#2D5016' }}>{pull.pullNumber}</span>
                  <span className="text-sm font-medium text-gray-700 truncate">{pull.productName}</span>
                  <span className="text-xs font-medium text-gray-500 uppercase">{pull.location === 'farm' ? 'Farm' : 'MKE'}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDate(pull.pulledAt)} · {pull.pulledBy}
                </p>
              </div>
              <ChevronRight size={16}
                className={`text-gray-400 flex-shrink-0 transition-transform ${expanded === pull.id ? 'rotate-90' : ''}`} />
            </button>
            {expanded === pull.id && (
              <div className="px-4 pb-4">
                <div className="flex flex-wrap gap-1 mb-2">
                  {pull.items?.map(item => (
                    <span key={item.skuId}
                      className="inline-block text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
                      {item.sku} ×{item.qty}
                    </span>
                  ))}
                </div>
                {pull.notes ? <p className="text-xs text-gray-400 italic">{pull.notes}</p> : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Reconciliation History View ─────────────────────────────────────────────────
function ReconciliationHistoryView({ onBack }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'reconciliationReports'), where('isDeleted', '==', false), orderBy('submittedAt', 'desc'));
    return onSnapshot(q,
      snap => { setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); setError(null); },
      err => { console.error('[ReconciliationHistory] Query error:', err); setError(err.message); setLoading(false); }
    );
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 flex items-center gap-3 px-4 py-3">
        <button onClick={onBack}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
          aria-label="Back">
          <ChevronRight size={22} className="rotate-180" />
        </button>
        <h2 onClick={onBack} className="text-lg font-bold flex-1 cursor-pointer hover:underline" style={{ color: '#2D5016' }}>Count History</h2>
      </div>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="px-4 py-12 text-center">
            <p className="text-red-500 text-sm">Failed to load reports: {error}</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No physical counts submitted yet.</p>
          </div>
        ) : reports.map((r, idx) => (
          <div key={r.id} className={`border-b border-gray-100 ${idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'}`}>
            <button
              onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[60px] text-left">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: '#2D5016' }}>{r.rcNumber}</span>
                  <span className="text-xs font-semibold uppercase text-gray-500">{r.location === 'farm' ? 'Farm' : 'MKE'}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDate(r.submittedAt)} · {r.submittedBy} · {r.items?.length ?? 0} adjustment{(r.items?.length ?? 0) !== 1 ? 's' : ''}
                </p>
              </div>
              <ChevronRight size={16}
                className={`text-gray-400 flex-shrink-0 transition-transform ${expanded === r.id ? 'rotate-90' : ''}`} />
            </button>
            {expanded === r.id && (
              <div className="px-4 pb-4">
                {(r.items ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No adjustments — all counts matched.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {/* Column headers */}
                    <div className="flex items-center py-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      <span className="flex-1">SKU</span>
                      <span className="w-14 text-center">System</span>
                      <span className="w-16 text-center">Counted</span>
                      <span className="w-20 text-right">Discrepancy</span>
                    </div>
                    {r.items.map(item => (
                      <div key={item.skuId}
                        className="flex items-center py-1.5 px-2 bg-white rounded border border-gray-100">
                        <p className="text-sm text-gray-700 flex-1 truncate">{item.sku}</p>
                        <span className="w-14 text-center text-xs text-gray-500">{item.systemQty}</span>
                        <span className="w-16 text-center text-xs text-gray-500">{item.countedQty}</span>
                        <span className={`w-20 text-right text-xs font-bold ${item.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {item.delta > 0 ? '+' : ''}{item.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Desktop-only download */}
                <button
                  onClick={() => {
                    const locLabel = r.location === 'farm' ? 'Farm' : 'MKE';
                    const date = r.submittedAt?.toDate ? r.submittedAt.toDate().toLocaleDateString() : '—';
                    let text = `Reconciliation Report: ${r.rcNumber}\nLocation: ${locLabel}\nDate: ${date}\nSubmitted by: ${r.submittedBy}\n\nSKU                    System  Counted  Discrepancy\n${'─'.repeat(60)}\n`;
                    (r.items ?? []).forEach(item => {
                      const disc = item.delta > 0 ? `+${item.delta}` : `${item.delta}`;
                      text += `${item.sku.padEnd(23)}${String(item.systemQty).padStart(6)}  ${String(item.countedQty).padStart(7)}  ${disc.padStart(11)}\n`;
                    });
                    const blob = new Blob([text], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${r.rcNumber}-${r.location}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="hidden md:flex items-center gap-1.5 mt-3 text-xs font-medium text-gray-500 hover:text-grg-green">
                  <Download size={14} /> Download Report
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Purchase Requests View ────────────────────────────────────────────────────────
function QuoteRequestsView({ onBack }) {
  const [qrs, setQrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const q = query(
      collection(db, 'quoteRequests'),
      where('isDeleted', '==', false),
      orderBy('sentAt', 'desc')
    );
    return onSnapshot(q,
      snap => { setQrs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return qrs;
    return smartSearch(qrs, search, ['qrNumber', 'recipientName', 'sentBy']);
  }, [qrs, search]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
            aria-label="Back">
            <ChevronRight size={22} className="rotate-180" />
          </button>
          <h2 onClick={onBack} className="text-lg font-bold flex-1 cursor-pointer hover:underline" style={{ color: '#2D5016' }}>Purchase Requests</h2>
        </div>
        <div className="px-4 pb-3">
          <SearchBar value={search} onChange={setSearch} placeholder="Search PR#, recipient, sent by…" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {search ? `No purchase requests match "${search}"` : 'No purchase requests yet.'}
            </p>
          </div>
        ) : filtered.map((qr, idx) => (
          <div key={qr.id} className={`border-b border-gray-100 ${idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'}`}>
            <button
              onClick={() => setExpanded(expanded === qr.id ? null : qr.id)}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[60px] text-left">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold" style={{ color: '#2D5016' }}>{qr.qrNumber}</span>
                  <span className="text-sm font-medium text-gray-700">{qr.recipientName}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {qr.items?.length ?? 0} SKU{(qr.items?.length ?? 0) !== 1 ? 's' : ''} · {formatDate(qr.sentAt)} · {qr.sentBy}
                </p>
              </div>
              <ChevronRight size={16}
                className={`text-gray-400 flex-shrink-0 transition-transform ${expanded === qr.id ? 'rotate-90' : ''}`} />
            </button>

            {expanded === qr.id && (
              <div className="px-4 pb-4">
                <div className="flex flex-col gap-1 mb-2">
                  {qr.items?.map(item => (
                    <div key={item.skuId}
                      className="flex items-center justify-between py-1.5 px-2 bg-white rounded border border-gray-100">
                      <div>
                        <p className="text-sm text-gray-700">{item.sku}</p>
                        <p className="text-xs text-gray-400 uppercase">{item.location}</p>
                      </div>
                      <p className="text-sm font-bold text-gray-700">×{item.qty}</p>
                    </div>
                  ))}
                </div>
                {qr.notes ? (
                  <p className="text-xs text-gray-500 italic">{qr.notes}</p>
                ) : null}
                {qr.recipientEmail && (
                  <p className="text-xs text-gray-400 mt-1">Sent to: {qr.recipientEmail}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Physical Count View ────────────────────────────────────────────────────────
function PhysicalCountView({ onBack, user }) {
  const { skus, inventory, loading } = useInventory();
  const belowParAll = useBelowPar(inventory, skus);
  const [location, setLocation] = useState('');
  const belowParIds = useMemo(
    () => new Set(belowParAll.filter(i => i.location === location).map(i => i.skuId)),
    [belowParAll, location]
  );
  const [counts, setCounts] = useState({}); // skuId → number (default 0)
  const [touchedSkus, setTouchedSkus] = useState(new Set());
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [userName, setUserName] = useState(user.name || user.email || '');
  const [countDate, setCountDate] = useState(new Date().toISOString().slice(0, 10));
  const [rcNumber, setRcNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [search, setSearch] = useState('');

  const activeSkus = useMemo(
    () => skus.filter(s => s.status !== 'discontinued'),
    [skus]
  );

  const filteredSkus = useMemo(() => {
    if (!search.trim()) return activeSkus;
    return smartSearch(activeSkus, search, ['sku']);
  }, [activeSkus, search]);

  const grouped = useMemo(() =>
    CATEGORIES.reduce((acc, cat) => {
      acc[cat] = filteredSkus.filter(s => s.category === cat);
      return acc;
    }, {}),
    [filteredSkus]
  );

  const getSystemQty = useCallback((skuId) => {
    const inv = inventory.find(i => i.id === `${skuId}_${location}`);
    return inv?.quantity ?? 0;
  }, [inventory, location]);

  const markTouched = useCallback((skuId) => {
    setTouchedSkus(prev => {
      if (prev.has(skuId)) return prev;
      const next = new Set(prev);
      next.add(skuId);
      return next;
    });
  }, []);

  const handleIncrement = useCallback((skuId) => {
    markTouched(skuId);
    setCounts(prev => ({ ...prev, [skuId]: (prev[skuId] ?? 0) + 1 }));
  }, [markTouched]);

  const handleDecrement = useCallback((skuId) => {
    markTouched(skuId);
    setCounts(prev => ({ ...prev, [skuId]: Math.max(0, (prev[skuId] ?? 0) - 1) }));
  }, [markTouched]);

  const handleCountInput = useCallback((skuId, value) => {
    markTouched(skuId);
    const n = parseInt(value, 10);
    setCounts(prev => ({ ...prev, [skuId]: isNaN(n) ? 0 : Math.max(0, n) }));
  }, [markTouched]);

  const deltas = useMemo(() => {
    const result = [];
    activeSkus.forEach(sku => {
      if (!touchedSkus.has(sku.id)) return;
      const counted = counts[sku.id] ?? 0;
      const system = getSystemQty(sku.id);
      if (counted !== system) {
        result.push({ sku, system, counted, delta: counted - system });
      }
    });
    return result;
  }, [activeSkus, counts, touchedSkus, getSystemQty]);

  const openSubmitModal = async () => {
    try {
      const rc = await generateRecordNumber('reconciliationReports');
      setRcNumber(rc);
    } catch {
      setRcNumber('RR# —');
    }
    setSubmitError('');
    setShowSubmitModal(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      for (const item of deltas) {
        await adjustInventory({
          skuId: item.sku.id,
          sku: item.sku.sku,
          location,
          delta: item.delta,
          reason: `Physical count: ${rcNumber}`,
          relatedId: null,
          userId: user.uid,
          userName,
        });
      }

      await addDoc(collection(db, 'reconciliationReports'), {
        rcNumber,
        location,
        countDate,
        itemsCounted: touchedSkus.size,
        items: deltas.map(d => ({
          skuId: d.sku.id,
          sku: d.sku.sku,
          systemQty: d.system,
          countedQty: d.counted,
          delta: d.delta,
        })),
        submittedBy: userName,
        submittedByUid: user.uid,
        submittedAt: serverTimestamp(),
        isDeleted: false,
      });

      await addDoc(collection(db, 'auditLog'), {
        event: 'RECONCILIATION_SUBMITTED',
        skuId: null, sku: null,
        location,
        userId: user.uid,
        userName,
        oldValue: null,
        newValue: rcNumber,
        reason: `Physical count submitted for ${location === 'farm' ? 'Farm' : 'MKE'} — ${deltas.length} adjustment${deltas.length !== 1 ? 's' : ''}`,
        relatedId: null,
        timestamp: serverTimestamp(),
      });

      // Update last count timestamp in appSettings
      const countField = location === 'farm' ? 'lastFarmCount' : 'lastMkeCount';
      await setDoc(doc(db, 'appSettings', 'config'), { [countField]: serverTimestamp() }, { merge: true });

      const locName = location === 'farm' ? 'Farm' : 'MKE';
      triggerNotification(
        NOTIFICATION_EVENTS.RECONCILIATION_SUBMITTED,
        `Reconciliation Report ${rcNumber} — ${locName}`,
        `Reconciliation Report: ${rcNumber}\nLocation: ${locName}\nCount Date: ${countDate}\nSubmitted by: ${userName}\n\nAdjustments (${deltas.length}):\n${deltas.map(d => `  ${d.sku.sku}: ${d.system} → ${d.counted} (${d.delta >= 0 ? '+' : ''}${d.delta})`).join('\n')}`,
      );

      setShowSubmitModal(false);
      setSubmitted(true);
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="sticky top-0 z-20 bg-white border-b border-gray-200 flex items-center gap-3 px-4 py-3">
          <button onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
            aria-label="Back">
            <ChevronRight size={22} className="rotate-180" />
          </button>
          <h2 onClick={onBack} className="text-lg font-bold flex-1 cursor-pointer hover:underline" style={{ color: '#2D5016' }}>Physical Count</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20 text-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4CB31D' }}>
            <ClipboardList size={32} className="text-white" />
          </div>
          <h3 className="text-xl font-bold" style={{ color: '#2D5016' }}>Count Submitted</h3>
          <p className="text-sm text-gray-500">
            {rcNumber} — {deltas.length} adjustment{deltas.length !== 1 ? 's' : ''} applied to {location === 'farm' ? 'Farm' : 'MKE'} inventory.
          </p>
          <button
            onClick={onBack}
            className="mt-4 min-h-[44px] px-8 rounded-xl text-white font-semibold text-sm"
            style={{ backgroundColor: '#4CB31D' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
            aria-label="Back">
            <ChevronRight size={22} className="rotate-180" />
          </button>
          <h2 onClick={onBack} className="text-lg font-bold flex-1 cursor-pointer hover:underline" style={{ color: '#2D5016' }}>Physical Count</h2>
        </div>

        {/* Location dropdown */}
        <div className="px-4 pb-3">
          <select
            value={location}
            onChange={e => { setLocation(e.target.value); setCounts({}); setTouchedSkus(new Set()); setSearch(''); }}
            className="w-full min-h-[44px] rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-grg-sage">
            <option value="">Select a location</option>
            <option value="farm">Farm</option>
            <option value="mke">MKE</option>
          </select>
        </div>

        {location !== '' && (
          <div className="px-4 pb-3">
            <SearchBar value={search} onChange={setSearch} placeholder="Search SKUs…" />
          </div>
        )}
      </div>

      {location === '' ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <p className="text-gray-400 text-sm">Select a location to begin counting.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-28 md:pb-20">
          {loading ? (
            <Spinner />
          ) : (
            CATEGORIES.map(cat => {
              const items = grouped[cat] ?? [];
              if (items.length === 0) return null;
              const catBelowPar = items.filter(s => belowParIds.has(s.id)).length;
              return (
                <CategoryMenu key={cat} title={CATEGORY_LABELS[cat]} defaultOpen={false} count={items.length} badge={<BelowParWarning count={catBelowPar} />}>
                  <div className="sticky top-[44px] z-[9] flex items-center px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-100">
                    <span className="flex-1">SKU</span>
                    <span className="w-[140px] text-center">Count</span>
                  </div>
                  {items.map((sku, idx) => {
                    const systemQty = getSystemQty(sku.id);
                    const counted = counts[sku.id] ?? 0;
                    const isTouched = touchedSkus.has(sku.id);
                    const isDifferent = isTouched && counted !== systemQty;
                    return (
                      <div key={sku.id}
                        className={`flex items-center px-4 py-2 min-h-[52px] ${
                          isDifferent
                            ? 'bg-amber-50 border-l-4 border-amber-400'
                            : idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'
                        }`}>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800 truncate block">{sku.sku}</span>
                          {belowParIds.has(sku.id) && <BelowParBadge />}
                        </div>
                        <div className="w-[140px] flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDecrement(sku.id)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 flex-shrink-0"
                            aria-label={`Decrease ${sku.sku}`}>
                            <Minus size={16} />
                          </button>
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={counted}
                            onChange={e => handleCountInput(sku.id, e.target.value)}
                            className={`w-12 text-center text-sm font-semibold border rounded py-1 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-grg-sage ${
                              isDifferent ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => handleIncrement(sku.id)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 flex-shrink-0"
                            aria-label={`Increase ${sku.sku}`}>
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </CategoryMenu>
              );
            })
          )}
        </div>
      )}

      {/* Submit button — only visible when at least one SKU has been touched */}
      {touchedSkus.size > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 px-4 pb-4 pt-3 bg-white border-t border-gray-200 z-10">
          <button
            onClick={openSubmitModal}
            className="w-full min-h-[52px] rounded-xl text-white font-semibold text-base"
            style={{ backgroundColor: '#4CB31D' }}>
            Submit Reconciliation Report
          </button>
        </div>
      )}

      {/* Submit Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold" style={{ color: '#2D5016' }}>Submit Reconciliation Report</h3>
                <p className="text-xs text-gray-400 mt-0.5">{rcNumber}</p>
              </div>
              <button onClick={() => setShowSubmitModal(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
                aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Name field */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Your Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={e => setUserName(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage"
                  placeholder="Enter your name"
                />
              </div>

              {/* Date field */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Count Date</label>
                <input
                  type="date"
                  value={countDate}
                  onChange={e => setCountDate(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage"
                />
              </div>

              {/* Summary box */}
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Location</span>
                  <span className="font-semibold text-gray-800">{location === 'farm' ? 'Farm' : 'MKE'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Items Counted</span>
                  <span className="font-semibold text-gray-800">{touchedSkus.size}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Discrepancies Found</span>
                  <span className={`font-semibold ${deltas.length > 0 ? 'text-amber-600' : 'text-gray-800'}`}>{deltas.length}</span>
                </div>
              </div>

              {/* Adjustments list */}
              {deltas.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Adjustments</p>
                  <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
                    {deltas.map(item => (
                      <div key={item.sku.id} className="flex items-center px-3 py-2 text-sm">
                        <span className="flex-1 font-medium text-gray-800 truncate">{item.sku.sku}</span>
                        <span className="text-gray-400 mr-2">{item.system} → {item.counted}</span>
                        <span className={`font-bold ${item.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {item.delta > 0 ? '+' : ''}{item.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {submitError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowSubmitModal(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !userName.trim() || !countDate}
                className="flex-1 min-h-[44px] rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#4CB31D' }}>
                {submitting ? 'Submitting…' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard Main Menu ────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth();
  const { hiViz } = useTheme();
  const [view, setView] = useState('menu');
  const location = useLocation();

  // Reset to main menu when nav tab is clicked while on a subpage
  useEffect(() => {
    if (location.state?.reset) setView('menu');
  }, [location.state?.reset]);

  // Load inventory for the below-par badge on the Par Report card
  const { skus, inventory } = useInventory();
  const belowParAll = useBelowPar(inventory, skus);
  const belowParCount = belowParAll.length;

  if (view === 'manageSkus') return <ManageSkusView onBack={() => setView('menu')} user={user} />;
  if (view === 'parReport') return <ParReportView onBack={() => setView('menu')} user={user} />;
  if (view === 'physicalCount') return <PhysicalCountView onBack={() => setView('menu')} user={user} />;
  if (view === 'quoteRequests') return <QuoteRequestsView onBack={() => setView('menu')} />;
  if (view === 'allPulls') return <AllPullsView onBack={() => setView('menu')} />;
  if (view === 'countHistory') return <ReconciliationHistoryView onBack={() => setView('menu')} />;

  const cardBg = hiViz
    ? 'bg-white border-2 border-black'
    : 'bg-gray-50 border border-gray-200';

  const cards = [
    {
      id: 'manageSkus',
      label: 'Manage SKUs',
      desc: 'Add, edit par levels, and manage SKUs.',
      active: true,
      badge: null,
    },
    {
      id: 'parReport',
      label: 'Par Report',
      desc: 'View below-par items and generate purchase requests.',
      active: true,
      badge: belowParCount > 0 ? belowParCount : null,
    },
    {
      id: 'physicalCount',
      label: 'Physical Count',
      desc: 'Conduct a physical count and submit reconciliation report.',
      active: true,
      badge: null,
    },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="p-4 flex flex-col gap-3">
        {cards.map(card => (
          <button
            key={card.id}
            disabled={!card.active}
            onClick={() => card.active && setView(card.id)}
            className={`flex items-center justify-between p-4 rounded-xl text-left w-full transition-colors ${cardBg} ${
              card.active
                ? 'hover:bg-gray-100 active:bg-gray-200'
                : 'opacity-40 cursor-default'
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold" style={{ color: '#2D5016' }}>{card.label}</p>
                {card.badge && (
                  <span className="inline-flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1">
                    {card.badge}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{card.desc}</p>
            </div>
            {card.active && (
              <ChevronRight size={20} className="text-gray-400 flex-shrink-0 ml-3" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
