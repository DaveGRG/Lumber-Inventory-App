import { useState, useEffect } from 'react';
import { ChevronRight, Plus, X, Pencil, Trash2 } from 'lucide-react';
import {
  collection, addDoc, updateDoc, doc,
  onSnapshot, query, where, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { EVENT_ORDER, EVENT_LABELS } from '../../constants/notificationEvents';
import ConfirmDialog from '../common/ConfirmDialog';

// Local SubpageHeader (same pattern as MorePage — not exported from there)
function SubpageHeader({ title, onBack, action }) {
  return (
    <div className="sticky top-0 z-20 bg-white border-b border-gray-200 flex items-center gap-3 px-4 py-3">
      <button
        onClick={onBack}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
        aria-label="Back"
      >
        <ChevronRight size={22} className="rotate-180" />
      </button>
      <h2 className="text-lg font-bold flex-1" style={{ color: '#2D5016' }}>{title}</h2>
      {action}
    </div>
  );
}

// ─── ADD / EDIT RECIPIENT POPUP ──────────────────────────────────────────────
function RecipientPopup({ existing, user, onClose }) {
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [events, setEvents] = useState(new Set(existing?.events || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleEvent = (evt) => {
    setEvents(prev => {
      const next = new Set(prev);
      if (next.has(evt)) next.delete(evt);
      else next.add(evt);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    if (events.size === 0) { setError('Select at least one event.'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'notifications', existing.id), {
          name: name.trim(),
          email: email.trim(),
          events: [...events],
        });
      } else {
        await addDoc(collection(db, 'notifications'), {
          name: name.trim(),
          email: email.trim(),
          events: [...events],
          isActive: true,
          createdAt: serverTimestamp(),
          createdBy: user.name || user.email,
        });
      }
      onClose();
    } catch {
      setError('Save failed. Try again.');
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
        className="relative bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col max-h-[90dvh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold" style={{ color: '#2D5016' }}>
            {isEdit ? 'Edit Recipient' : 'Add Recipient'}
          </h2>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Name *</label>
              <input
                type="text" value={name} autoFocus onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                placeholder="John LaPointe"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Email *</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                placeholder="lapointe@grgplayscapes.com"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 mb-2 block">Subscribed Events *</label>
              <div className="flex flex-col gap-1.5">
                {EVENT_ORDER.map(evt => (
                  <label key={evt} className="flex items-center gap-2.5 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={events.has(evt)}
                      onChange={() => toggleEvent(evt)}
                      className="w-4 h-4 rounded border-gray-300 text-grg-sage focus:ring-grg-sage accent-[#4CB31D]"
                    />
                    <span className="text-sm text-gray-700">{EVENT_LABELS[evt]}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Recipient'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS VIEW ──────────────────────────────────────────────────────
export default function NotificationsView({ onBack, user }) {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'notifications'),
      where('isActive', '==', true),
    );
    const unsub = onSnapshot(q, snap => {
      setRecipients(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      );
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await updateDoc(doc(db, 'notifications', deleteTarget.id), { isActive: false });
    } catch { /* silent */ }
    setDeleting(false);
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <SubpageHeader
        title="Notifications"
        onBack={onBack}
        action={
          <button
            onClick={() => setShowAdd(true)}
            className="min-h-[44px] px-4 rounded-lg text-white text-sm font-semibold flex items-center gap-1"
            style={{ backgroundColor: '#4CB31D' }}
          >
            <Plus size={16} /> Add
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        <div className="p-4 flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            Manage who receives email notifications for each event. Emails are queued and sent via Cloud Functions.
          </p>

          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : recipients.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No recipients configured yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {recipients.map(r => (
                <div key={r.id} className="flex items-center gap-2 bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{r.name}</p>
                    <p className="text-xs text-gray-500 truncate">{r.email}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {r.events?.length || 0} event{(r.events?.length || 0) !== 1 ? 's' : ''} subscribed
                    </p>
                  </div>
                  <button
                    onClick={() => setEditTarget(r)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-500 hover:text-gray-700 rounded-lg"
                    aria-label="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(r)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-500 hover:text-red-700 rounded-lg"
                    aria-label="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Popup */}
      {showAdd && (
        <RecipientPopup user={user} onClose={() => setShowAdd(false)} />
      )}

      {/* Edit Popup */}
      {editTarget && (
        <RecipientPopup existing={editTarget} user={user} onClose={() => setEditTarget(null)} />
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove recipient?"
        message={`"${deleteTarget?.name}" will no longer receive notifications.`}
        confirmLabel={deleting ? 'Removing…' : 'Remove'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
