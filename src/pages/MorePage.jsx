import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronRight, Shield, Plus, X, Trash2, RotateCcw, Minus, Download, Send } from 'lucide-react';
import {
  collection, addDoc, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, limit,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { softDelete, restoreFromTrash } from '../utils/softDelete';
import { smartSearch } from '../utils/search';
import { useInventory } from '../hooks/useInventory';
import ConfirmDialog from '../components/common/ConfirmDialog';
import Spinner from '../components/common/Spinner';
import SearchBar from '../components/common/SearchBar';
import BulkImportTool from '../components/more/BulkImportTool';
import NotificationsView from '../components/more/NotificationsView';
import StatusBadge from '../components/common/StatusBadge';
import { SUPER_ADMIN_EMAIL, DEV_ADMIN_EMAIL } from '../constants/roles';
import { triggerNotification } from '../utils/notifications';
import { NOTIFICATION_EVENTS } from '../constants/notificationEvents';
import { runDailyMaintenance } from '../utils/dailyMaintenance';

const locLabel = (loc) => loc === 'farm' ? 'Farm' : 'MKE';

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  FIELD_CREW: 'Field Crew',
};

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Audit log filter → event type mapping
const FILTER_MAP = {
  'Stock Adjustment': ['INVENTORY_ADJUSTED'],
  'Transfer': ['TRANSFER_CREATED', 'TRANSFER_SHIPPED', 'TRANSFER_RECEIVED'],
  'Pick': ['PRODUCT_PULLED', 'PULL_UNDONE'],
  'Physical Count': ['RECONCILIATION_SUBMITTED'],
  'Item Created': ['SKU_CREATED'],
  'Item Deleted': ['ITEM_DELETED', 'SKU_DELETED'],
  'Material Added': ['MATERIAL_ADDED'],
  'Transfer Discrepancy': ['TRANSFER_DISCREPANCY'],
};

const EVENT_LABEL = {
  INVENTORY_ADJUSTED: 'Stock Adjustment',
  TRANSFER_CREATED: 'Transfer Created',
  TRANSFER_SHIPPED: 'Transfer Shipped',
  TRANSFER_RECEIVED: 'Transfer Received',
  PRODUCT_PULLED: 'Material Pick',
  PULL_UNDONE: 'Pick Undone',
  RECONCILIATION_SUBMITTED: 'Physical Count',
  SKU_CREATED: 'Item Created',
  ITEM_DELETED: 'Item Deleted',
  SKU_DELETED: 'Item Deleted',
  MATERIAL_ADDED: 'Material Added',
  TRANSFER_DISCREPANCY: 'Transfer Discrepancy',
  ITEM_RESTORED: 'Item Restored',
  PAR_EDITED: 'Par Edited',
};

function getTrashLabel(item) {
  const d = item?.data ?? {};
  return d.sku || d.contactName || d.productName || d.jobName || d.transferNumber || item?.originalId || 'item';
}

// ─── SHARED SUBPAGE HEADER ──────────────────────────────────────────────────
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

// ─── ADD VENDOR POPUP ────────────────────────────────────────────────────────
function AddVendorPopup({ user, onClose }) {
  const [form, setForm] = useState({ contactName: '', company: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleCreate = async () => {
    if (!form.contactName.trim()) { setError('Contact name is required.'); return; }
    if (!form.company.trim()) { setError('Company is required.'); return; }
    if (!form.email.trim()) { setError('Email is required.'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'vendors'), {
        contactName: form.contactName.trim(),
        company: form.company.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        isDeleted: false,
        createdAt: serverTimestamp(),
        createdBy: user.name || user.email,
      });
      onClose();
    } catch {
      setError('Failed to add vendor. Try again.');
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
        <button onClick={onClose} aria-label="Close"
          className="absolute top-3 right-3 min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
          <X size={22} />
        </button>
        <h2 className="text-base font-semibold pr-8 mb-4" style={{ color: '#2D5016' }}>Add Vendor</h2>
        <div className="flex flex-col gap-3">
          {[
            { key: 'contactName', label: 'Contact Name *', placeholder: 'Jane Smith', type: 'text' },
            { key: 'company', label: 'Company *', placeholder: 'Acme Lumber Co.', type: 'text' },
            { key: 'email', label: 'Email *', placeholder: 'jane@company.com', type: 'email' },
            { key: 'phone', label: 'Phone (optional)', placeholder: '(555) 555-5555', type: 'tel' },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={e => set(key, e.target.value)}
                autoFocus={key === 'contactName'}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                placeholder={placeholder}
              />
            </div>
          ))}
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Adding…' : 'Add Vendor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── VENDOR CONTACTS VIEW ────────────────────────────────────────────────────
function VendorContactsView({ onBack, user }) {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'vendors'),
      where('isDeleted', '==', false),
      orderBy('company')
    );
    return onSnapshot(q,
      snap => { setVendors(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error('Vendor query error:', err); setLoading(false); }
    );
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try { await softDelete('vendors', deleteTarget.id, user.uid, user.name || user.email); } catch {}
    setDeleteSaving(false);
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <SubpageHeader
        title="Vendor Contacts"
        onBack={onBack}
        action={
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-white text-sm font-semibold"
            style={{ backgroundColor: '#4CB31D' }}
          >
            <Plus size={18} /> Add
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : vendors.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No vendor contacts yet. Tap Add to create one.</p>
          </div>
        ) : vendors.map((v, idx) => (
          <div
            key={v.id}
            className={`flex items-center gap-3 px-4 py-3 min-h-[60px] border-b border-gray-100 ${
              idx % 2 === 1 ? 'bg-[#F0F0E8]/30' : 'bg-white'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">{v.contactName}</p>
              <p className="text-xs text-gray-500">{v.company}</p>
              <p className="text-xs text-gray-400">
                {v.email}{v.phone ? ` · ${v.phone}` : ''}
              </p>
            </div>
            <button
              onClick={() => setDeleteTarget({ id: v.id, name: v.contactName })}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-500 hover:text-red-700 rounded flex-shrink-0"
              aria-label={`Delete ${v.contactName}`}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && <AddVendorPopup user={user} onClose={() => setShowAdd(false)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Vendor?"
        message={`"${deleteTarget?.name}" will be soft-deleted. Recoverable from Admin Control within 30 days.`}
        confirmLabel={deleteSaving ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── ADD USER POPUP ──────────────────────────────────────────────────────────
function AddUserPopup({ currentUser, onClose }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'ADMIN' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleCreate = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.email.trim().endsWith('@grgplayscapes.com')) {
      setError('Must be a @grgplayscapes.com email address.'); return;
    }
    setSaving(true);
    try {
      // Stored with email as key — migrated to UID on first login (see AuthContext)
      // Lowercase the email so it matches Google's firebaseUser.email on login
      const normalizedEmail = form.email.trim().toLowerCase();
      await setDoc(doc(db, 'users', normalizedEmail), {
        name: form.name.trim(),
        email: normalizedEmail,
        role: form.role,
        isActive: true,
        hiVizMode: false,
        isPending: true,
        uid: null,
        createdAt: serverTimestamp(),
        createdBy: currentUser.name || currentUser.email,
      });
      await addDoc(collection(db, 'auditLog'), {
        event: 'USER_ADDED',
        skuId: null, sku: null, location: null,
        userId: currentUser.uid,
        userName: currentUser.name || currentUser.email,
        oldValue: null,
        newValue: form.role,
        reason: `User added: ${normalizedEmail}`,
        relatedId: null,
        timestamp: serverTimestamp(),
      });
      triggerNotification(
        NOTIFICATION_EVENTS.USER_ADDED,
        `New User Added — ${form.name.trim()}`,
        `A new user has been added.\n\nName: ${form.name.trim()}\nEmail: ${normalizedEmail}\nRole: ${form.role}\nAdded by: ${currentUser.name || currentUser.email}`,
      );
      onClose();
    } catch {
      setError('Failed to add user. Try again.');
      setSaving(false);
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
        <h2 className="text-base font-semibold pr-8 mb-4" style={{ color: '#2D5016' }}>Add User</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Full Name *</label>
            <input type="text" value={form.name} autoFocus onChange={e => set('name', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="Jane Smith" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">GRG Email *</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="jane@grgplayscapes.com" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Role</label>
            <select value={form.role} onChange={e => set('role', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px] bg-white">
              <option value="ADMIN">Admin</option>
              <option value="FIELD_CREW">Field Crew</option>
            </select>
          </div>
          <p className="text-xs text-gray-400 italic">
            User will be activated automatically on their first login with this Google account.
          </p>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Adding…' : 'Add User'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EDIT USER POPUP ─────────────────────────────────────────────────────────
function EditUserPopup({ targetUser, currentUser, onClose }) {
  const [role, setRole] = useState(targetUser.role || 'ADMIN');
  const [isActive, setIsActive] = useState(targetUser.isActive !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isSuperAdmin = currentUser.email === SUPER_ADMIN_EMAIL;
  const isSelf = targetUser.id === currentUser.uid || targetUser.email === currentUser.email;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', targetUser.id), { role, isActive });
      await addDoc(collection(db, 'auditLog'), {
        event: 'USER_UPDATED',
        skuId: null, sku: null, location: null,
        userId: currentUser.uid,
        userName: currentUser.name || currentUser.email,
        oldValue: targetUser.role,
        newValue: role,
        reason: `User updated: ${targetUser.email}`,
        relatedId: targetUser.id,
        timestamp: serverTimestamp(),
      });
      onClose();
    } catch {
      setError('Failed to save. Try again.');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'users', targetUser.id));
      await addDoc(collection(db, 'auditLog'), {
        event: 'USER_DELETED',
        skuId: null, sku: null, location: null,
        userId: currentUser.uid,
        userName: currentUser.name || currentUser.email,
        oldValue: targetUser.role,
        newValue: null,
        reason: `User deleted: ${targetUser.email}`,
        relatedId: targetUser.id,
        timestamp: serverTimestamp(),
      });
      onClose();
    } catch {
      setError('Failed to delete. Try again.');
      setSaving(false);
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
        <h2 className="text-base font-semibold pr-8 mb-0.5" style={{ color: '#2D5016' }}>Edit User</h2>
        <p className="text-sm text-gray-400 mb-4">{targetUser.name} · {targetUser.email}</p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px] bg-white">
              {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
              <option value="ADMIN">Admin</option>
              <option value="FIELD_CREW">Field Crew</option>
            </select>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
            <span className="text-sm font-medium text-gray-700">Account Active</span>
            <button
              onClick={() => setIsActive(a => !a)}
              className="w-12 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0"
              style={{ backgroundColor: isActive ? '#4CB31D' : '#d1d5db' }}
              aria-label="Toggle active"
            >
              <span className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${isActive ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          {/* Delete button — not allowed on yourself */}
          {!isSelf && (
            <button onClick={() => setShowDeleteConfirm(true)} disabled={saving}
              className="min-h-[44px] px-3 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1 text-sm font-medium disabled:opacity-50 flex-shrink-0">
              <Trash2 size={16} />
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete User"
        message={`Permanently remove ${targetUser.name || targetUser.email}? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

// ─── USER MANAGEMENT VIEW ────────────────────────────────────────────────────
function UserManagementView({ onBack, user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL;
  const isDevAdmin = user?.email === DEV_ADMIN_EMAIL;
  const canManageUsers = isSuperAdmin || isDevAdmin;

  useEffect(() => {
    return onSnapshot(collection(db, 'users'),
      snap => { setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
  }, []);

  const canEdit = (targetUser) => {
    if (isSuperAdmin) return true;
    if (isDevAdmin) return true;
    return false;
  };

  const roleBadgeStyle = (role) => {
    if (role === 'SUPER_ADMIN') return { backgroundColor: '#2D5016', color: '#fff' };
    if (role === 'ADMIN') return { backgroundColor: '#4CB31D', color: '#fff' };
    return { backgroundColor: '#6BBF3D', color: '#fff' };
  };

  const sorted = useMemo(() =>
    [...users].sort((a, b) => {
      if ((a.isActive !== false) !== (b.isActive !== false))
        return (a.isActive !== false) ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    }), [users]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <SubpageHeader
        title="User Management"
        onBack={onBack}
        action={
          canManageUsers && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-white text-sm font-semibold"
              style={{ backgroundColor: '#4CB31D' }}
            >
              <Plus size={18} /> Add User
            </button>
          )
        }
      />

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : sorted.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No users found.</p>
          </div>
        ) : sorted.map((u, idx) => (
          <div
            key={u.id}
            className={`flex items-center gap-3 px-4 py-3 min-h-[60px] border-b border-gray-100 ${
              u.isActive === false ? 'opacity-50' : ''
            } ${idx % 2 === 1 ? 'bg-[#F0F0E8]/30' : 'bg-white'}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-gray-800">{u.name || '—'}</p>
                {u.isPending && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                    Pending login
                  </span>
                )}
                {u.isActive === false && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                    Inactive
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">{u.email}</p>
            </div>
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
              style={roleBadgeStyle(u.role)}
            >
              {ROLE_LABELS[u.role] || u.role}
            </span>
            {canEdit(u) && (
              <button
                onClick={() => setEditTarget(u)}
                className="min-h-[36px] px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 flex-shrink-0"
              >
                Edit
              </button>
            )}
          </div>
        ))}
      </div>

      {showAdd && <AddUserPopup currentUser={user} onClose={() => setShowAdd(false)} />}
      {editTarget && (
        <EditUserPopup targetUser={editTarget} currentUser={user} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

// ─── RESTORE CENTER COLLAPSIBLE ─────────────────────────────────────────────
function RestoreCenterCollapsible({ cardBg, loadingTrash, trashItems, onRestore, onPermDelete }) {
  const [open, setOpen] = useState(false);
  const count = trashItems.length;

  return (
    <div className={`rounded-xl ${cardBg} overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div>
          <h3 className="font-semibold" style={{ color: '#2D5016' }}>
            Restore Center
            {count > 0 && (
              <span className="ml-2 inline-flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1">
                {count}
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Items are permanently deleted 30 days after being trashed.
          </p>
        </div>
        {open ? (
          <ChevronRight size={18} className="rotate-90 text-gray-400 flex-shrink-0 ml-3 transition-transform" />
        ) : (
          <ChevronRight size={18} className="text-gray-400 flex-shrink-0 ml-3 transition-transform" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {loadingTrash ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : count === 0 ? (
            <p className="text-sm text-gray-400 italic">Trash is empty.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {trashItems.map(item => (
                <div key={item.id}
                  className="flex items-center gap-2 bg-white rounded-lg p-3 border border-gray-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {getTrashLabel(item)}
                    </p>
                    <p className="text-xs text-gray-400">
                      {item.originalCollection} · Deleted by {item.deletedBy} · {formatDate(item.deletedAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => onRestore(item)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-white flex-shrink-0"
                    style={{ backgroundColor: '#4CB31D' }}
                    aria-label="Restore"
                    title="Restore"
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    onClick={() => onPermDelete(item)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-500 hover:text-red-700 rounded flex-shrink-0"
                    aria-label="Permanently delete"
                    title="Delete forever"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN CONTROL VIEW ──────────────────────────────────────────────────────
function AdminControlView({ onBack, user }) {
  const [trashItems, setTrashItems] = useState([]);
  const [loadingTrash, setLoadingTrash] = useState(true);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [permDeleteTarget, setPermDeleteTarget] = useState(null);
  const [actionSaving, setActionSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const [threshold, setThreshold] = useState(35);
  const [thresholdEdit, setThresholdEdit] = useState(null);
  const [roleRestrictionsEnabled, setRoleRestrictionsEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const [adjThreshold, setAdjThreshold] = useState(20);
  const [adjThresholdEdit, setAdjThresholdEdit] = useState(null);
  const [maintenanceRunning, setMaintenanceRunning] = useState(false);
  const [maintenanceResult, setMaintenanceResult] = useState(null);

  const [daveUser, setDaveUser] = useState(null);
  const [editDave, setEditDave] = useState(false);
  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL;

  const cardBg = 'bg-gray-50 border border-gray-200';

  useEffect(() => {
    // Trash items (all, newest first)
    const trashUnsub = onSnapshot(
      query(collection(db, 'trash'), orderBy('deletedAt', 'desc')),
      snap => { setTrashItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoadingTrash(false); },
      () => setLoadingTrash(false)
    );

    // App settings
    const settingsUnsub = onSnapshot(
      doc(db, 'appSettings', 'config'),
      snap => {
        if (snap.exists()) {
          setThreshold(snap.data().physicalCountReminderDays ?? 35);
          setRoleRestrictionsEnabled(snap.data().roleRestrictionsEnabled ?? false);
          setAdjThreshold(snap.data().largeAdjustmentThreshold ?? 20);
        }
        setSettingsLoading(false);
      },
      () => setSettingsLoading(false)
    );

    return () => { trashUnsub(); settingsUnsub(); };
  }, []);

  // John-only: load Dave's user doc
  useEffect(() => {
    if (!isSuperAdmin) return;
    return onSnapshot(
      query(collection(db, 'users'), where('email', '==', DEV_ADMIN_EMAIL)),
      snap => {
        if (!snap.empty) setDaveUser({ id: snap.docs[0].id, ...snap.docs[0].data() });
      }
    );
  }, [isSuperAdmin]);

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setActionSaving(true);
    try {
      await restoreFromTrash(restoreTarget.id, user.uid, user.name || user.email);
    } catch (err) {
      console.error('Restore failed:', err);
      alert('Restore failed. Please try again.');
    }
    setActionSaving(false);
    setRestoreTarget(null);
  };

  const handlePermDelete = async () => {
    if (!permDeleteTarget) return;
    setActionSaving(true);
    try { await deleteDoc(doc(db, 'trash', permDeleteTarget.id)); } catch {}
    setActionSaving(false);
    setPermDeleteTarget(null);
  };

  const handleThresholdBlur = async (val) => {
    const parsed = parseInt(val, 10);
    setThresholdEdit(null);
    if (isNaN(parsed) || parsed < 1 || parsed === threshold) return;
    try { await updateDoc(doc(db, 'appSettings', 'config'), { physicalCountReminderDays: parsed }); } catch {}
  };

  const handleRoleToggle = async () => {
    const next = !roleRestrictionsEnabled;
    setRoleRestrictionsEnabled(next);
    try { await updateDoc(doc(db, 'appSettings', 'config'), { roleRestrictionsEnabled: next }); }
    catch { setRoleRestrictionsEnabled(!next); }
  };

  const handleAdjThresholdBlur = async (val) => {
    const parsed = parseInt(val, 10);
    setAdjThresholdEdit(null);
    if (isNaN(parsed) || parsed < 1 || parsed === adjThreshold) return;
    try { await updateDoc(doc(db, 'appSettings', 'config'), { largeAdjustmentThreshold: parsed }); } catch {}
  };

  const handleRunMaintenance = async () => {
    setMaintenanceRunning(true);
    setMaintenanceResult(null);
    try {
      const result = await runDailyMaintenance();
      setMaintenanceResult(result);
    } catch {
      setMaintenanceResult({ error: true });
    }
    setMaintenanceRunning(false);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <SubpageHeader title="Admin Control" onBack={onBack} />

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        <div className="p-4 flex flex-col gap-4">

          {/* ── Restore Center (collapsible) ────────────────────────── */}
          <RestoreCenterCollapsible
            cardBg={cardBg}
            loadingTrash={loadingTrash}
            trashItems={trashItems}
            onRestore={setRestoreTarget}
            onPermDelete={setPermDeleteTarget}
          />

          {/* ── Bulk Import ─────────────────────────────────────────── */}
          <div className={`rounded-xl p-4 ${cardBg}`}>
            <h3 className="font-semibold mb-1" style={{ color: '#2D5016' }}>Bulk Import SKUs</h3>
            <p className="text-sm text-gray-500 mb-3">
              Import SKUs from CSV. Required columns: SKU, Category, Farm Par, MKE Par, Status.
            </p>
            <button
              onClick={() => setShowImport(true)}
              className="min-h-[44px] px-5 rounded-lg text-white font-semibold"
              style={{ backgroundColor: '#4CB31D' }}
            >
              Open Import Tool
            </button>
          </div>

          {/* ── Physical Count Threshold ─────────────────────────────── */}
          <div className={`rounded-xl p-4 ${cardBg}`}>
            <h3 className="font-semibold mb-1" style={{ color: '#2D5016' }}>Physical Count Reminder</h3>
            <p className="text-sm text-gray-500 mb-3">
              Send overdue reminder after this many days without a count (per location).
            </p>
            {settingsLoading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  value={thresholdEdit !== null ? thresholdEdit : threshold}
                  onFocus={() => setThresholdEdit(String(threshold))}
                  onChange={e => setThresholdEdit(e.target.value)}
                  onBlur={e => handleThresholdBlur(e.target.value)}
                  className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                />
                <span className="text-sm text-gray-500">days</span>
              </div>
            )}
          </div>

          {/* ── Role Restrictions ────────────────────────────────────── */}
          <div className={`rounded-xl p-4 ${cardBg}`}>
            <h3 className="font-semibold mb-1" style={{ color: '#2D5016' }}>Role Restrictions</h3>
            <p className="text-sm text-gray-500 mb-3">
              When enabled, role-based feature restrictions apply. Off by default.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRoleToggle}
                className="w-12 h-6 rounded-full transition-colors flex items-center px-0.5"
                style={{ backgroundColor: roleRestrictionsEnabled ? '#4CB31D' : '#d1d5db' }}
                aria-label="Toggle role restrictions"
              >
                <span className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  roleRestrictionsEnabled ? 'translate-x-6' : 'translate-x-0'
                }`} />
              </button>
              <span className="text-sm text-gray-600">
                {roleRestrictionsEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>

          {/* ── Large Adjustment Threshold ────────────────────────────── */}
          <div className={`rounded-xl p-4 ${cardBg}`}>
            <h3 className="font-semibold mb-1" style={{ color: '#2D5016' }}>Large Adjustment Threshold</h3>
            <p className="text-sm text-gray-500 mb-3">
              Trigger a notification when a single adjustment changes quantity by this amount or more.
            </p>
            {settingsLoading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  value={adjThresholdEdit !== null ? adjThresholdEdit : adjThreshold}
                  onFocus={() => setAdjThresholdEdit(String(adjThreshold))}
                  onChange={e => setAdjThresholdEdit(e.target.value)}
                  onBlur={e => handleAdjThresholdBlur(e.target.value)}
                  className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                />
                <span className="text-sm text-gray-500">units</span>
              </div>
            )}
          </div>

          {/* ── Daily Maintenance ──────────────────────────────────────── */}
          <div className={`rounded-xl p-4 ${cardBg}`}>
            <h3 className="font-semibold mb-1" style={{ color: '#2D5016' }}>Maintenance</h3>
            <p className="text-sm text-gray-500 mb-3">
              Purges expired trash and checks for overdue physical counts.
            </p>
            <button
              onClick={handleRunMaintenance}
              disabled={maintenanceRunning}
              className="min-h-[44px] px-5 rounded-lg text-white font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#4CB31D' }}
            >
              {maintenanceRunning ? 'Running…' : 'Run Now'}
            </button>
            {maintenanceResult && !maintenanceResult.error && (
              <div className="mt-3 bg-white rounded-lg border border-gray-100 p-3 text-sm text-gray-700">
                <p>Trash purged: <strong>{maintenanceResult.trashPurged}</strong></p>
                <p>Overdue locations: <strong>{maintenanceResult.overdueLocations}</strong></p>
              </div>
            )}
            {maintenanceResult?.error && (
              <p className="mt-3 text-sm text-red-600">Maintenance failed. Check console for details.</p>
            )}
          </div>

          {/* ── John-only: Manage Dave's Account ────────────────────── */}
          {isSuperAdmin && (
            <div className="rounded-xl p-4 border-2 border-dashed" style={{ borderColor: '#2D5016' }}>
              <h3 className="font-semibold mb-1" style={{ color: '#2D5016' }}>Manage Dave's Account</h3>
              <p className="text-xs text-gray-400 mb-3">Visible to John only.</p>
              {daveUser ? (
                <div className="flex items-center gap-3 bg-white rounded-lg p-3 border border-gray-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{daveUser.name}</p>
                    <p className="text-xs text-gray-400">
                      {daveUser.email} · {ROLE_LABELS[daveUser.role] || daveUser.role}
                    </p>
                    {daveUser.isActive === false && (
                      <p className="text-xs text-red-600 font-medium mt-0.5">Account Inactive</p>
                    )}
                  </div>
                  <button
                    onClick={() => setEditDave(true)}
                    className="min-h-[36px] px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 flex-shrink-0"
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">Dave's account not found.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Popups */}
      {showImport && <BulkImportTool onClose={() => setShowImport(false)} />}

      <ConfirmDialog
        open={!!restoreTarget}
        title="Restore item?"
        message={`Restore "${getTrashLabel(restoreTarget)}" back to ${restoreTarget?.originalCollection ?? 'its collection'}?`}
        confirmLabel={actionSaving ? 'Restoring…' : 'Restore'}
        cancelLabel="Cancel"
        onConfirm={handleRestore}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        open={!!permDeleteTarget}
        title="Delete forever?"
        message={`"${getTrashLabel(permDeleteTarget)}" will be permanently deleted and cannot be recovered.`}
        confirmLabel={actionSaving ? 'Deleting…' : 'Delete Forever'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handlePermDelete}
        onCancel={() => setPermDeleteTarget(null)}
      />

      {editDave && daveUser && (
        <EditUserPopup
          targetUser={daveUser}
          currentUser={user}
          onClose={() => setEditDave(false)}
        />
      )}
    </div>
  );
}

// ─── ADD PRODUCT POPUP ───────────────────────────────────────────────────────
function AddProductPopup({ user, skus, onClose }) {
  const [productName, setProductName] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [bom, setBom] = useState([]);
  const [skuSearch, setSkuSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const searchResults = useMemo(() => {
    if (!skuSearch.trim()) return [];
    return smartSearch(skus, skuSearch, ['sku', 'category'])
      .filter(s => !bom.some(b => b.skuId === s.id))
      .slice(0, 6);
  }, [skus, skuSearch, bom]);

  const addBomItem = (sku) => {
    setBom(prev => [...prev, { skuId: sku.id, sku: sku.sku, qty: 1 }]);
    setSkuSearch('');
  };

  const removeBomItem = (skuId) => setBom(prev => prev.filter(b => b.skuId !== skuId));

  const adjustBomQty = (skuId, delta) =>
    setBom(prev => prev.map(b => b.skuId === skuId ? { ...b, qty: Math.max(1, b.qty + delta) } : b));

  const handleSave = async () => {
    if (!productName.trim()) { setError('Product name is required.'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'productLibrary'), {
        productName: productName.trim(),
        catalogId: catalogId.trim() || null,
        bom: bom.map(b => ({ skuId: b.skuId, sku: b.sku, qty: b.qty })),
        isDeleted: false,
        createdAt: serverTimestamp(),
        createdBy: user.name || user.email,
      });
      await addDoc(collection(db, 'auditLog'), {
        event: 'ITEM_CREATED',
        skuId: null, sku: null, location: null,
        userId: user.uid, userName: user.name || user.email,
        oldValue: null, newValue: productName.trim(),
        reason: `Product template created: ${productName.trim()}`,
        relatedId: null, timestamp: serverTimestamp(),
      });
      onClose();
    } catch {
      setError('Failed to save product. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold" style={{ color: '#2D5016' }}>New Product Template</h2>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Product Name</label>
            <input value={productName} onChange={e => setProductName(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="e.g., Standard Arbor Kit" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Catalogue ID (optional)</label>
            <input value={catalogId} onChange={e => setCatalogId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="e.g., ARB-001" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Bill of Materials</label>
            <SearchBar value={skuSearch} onChange={setSkuSearch} placeholder="Search SKU to add…" />
            {searchResults.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                {searchResults.map(sku => (
                  <button key={sku.id} onClick={() => addBomItem(sku)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors">
                    <span className="font-medium text-gray-800">{sku.sku}</span>
                    <span className="text-xs text-gray-400">{sku.category}</span>
                  </button>
                ))}
              </div>
            )}
            {bom.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                {bom.map(item => (
                  <div key={item.skuId}
                    className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-sm font-medium text-gray-800 flex-1 truncate">{item.sku}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => adjustBomQty(item.skuId, -1)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-100">
                        <Minus size={14} />
                      </button>
                      <span className="w-10 text-center text-sm font-bold">{item.qty}</span>
                      <button onClick={() => adjustBomQty(item.skuId, 1)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-100">
                        <Plus size={14} />
                      </button>
                      <button onClick={() => removeBomItem(item.skuId)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-400 hover:text-red-600 rounded ml-1"
                        aria-label="Remove">
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {bom.length === 0 && !skuSearch && (
              <p className="text-xs text-gray-400 italic mt-2">No materials added yet.</p>
            )}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ASSIGN TO JOB POPUP ────────────────────────────────────────────────────
function AssignToJobPopup({ template, user, onClose }) {
  const [location, setLocation] = useState('farm');
  const [jobName, setJobName] = useState('');
  const [jobs, setJobs] = useState([]);
  const [jobSearchFocused, setJobSearchFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'jobs'), where('isDeleted', '==', false), orderBy('jobName'));
    return onSnapshot(q, snap => setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
  }, []);

  const jobSuggestions = useMemo(() => {
    if (!jobName.trim() || !jobSearchFocused) return [];
    return jobs.filter(j => j.jobName.toLowerCase().includes(jobName.toLowerCase())).slice(0, 5);
  }, [jobs, jobName, jobSearchFocused]);

  const handleAssign = async () => {
    if (!jobName.trim()) { setError('Job name is required.'); return; }
    setSaving(true);
    try {
      const trimmedJob = jobName.trim();
      let jobId = null;
      const existingJob = jobs.find(j => j.jobName.toLowerCase() === trimmedJob.toLowerCase());
      if (existingJob) {
        jobId = existingJob.id;
      } else {
        const jobRef = await addDoc(collection(db, 'jobs'), {
          jobName: trimmedJob,
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: user.name || user.email,
        });
        jobId = jobRef.id;
      }

      const bom = (template.bom ?? []).map(b => ({ skuId: b.skuId, sku: b.sku, qty: b.qty, pulled: false }));

      const prodRef = await addDoc(collection(db, 'products'), {
        productName: template.productName,
        catalogId: template.catalogId || null,
        description: null,
        location,
        jobId,
        jobName: trimmedJob,
        bom,
        status: 'pending',
        isDeleted: false,
        createdAt: serverTimestamp(),
        createdBy: user.name || user.email,
      });

      await addDoc(collection(db, 'auditLog'), {
        event: 'ITEM_CREATED',
        skuId: null, sku: null, location,
        userId: user.uid, userName: user.name || user.email,
        oldValue: null, newValue: template.productName,
        reason: `Product assigned to job "${trimmedJob}" from library`,
        relatedId: prodRef.id, timestamp: serverTimestamp(),
      });

      onClose();
    } catch {
      setError('Failed to assign. Try again.');
      setSaving(false);
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
        <h2 className="text-base font-semibold pr-8 mb-1" style={{ color: '#2D5016' }}>Assign to Job</h2>
        <p className="text-xs text-gray-400 mb-4">{template.productName} · {template.bom?.length ?? 0} SKUs</p>

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Location</label>
            <div className="flex gap-2">
              {['farm', 'mke'].map(loc => (
                <button key={loc} onClick={() => setLocation(loc)}
                  className={`flex-1 min-h-[44px] rounded-lg border text-sm font-medium transition-colors ${
                    location === loc ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                  style={location === loc ? { backgroundColor: '#4CB31D' } : {}}>
                  {locLabel(loc)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Job Name</label>
            <input value={jobName} onChange={e => setJobName(e.target.value)}
              onFocus={() => setJobSearchFocused(true)}
              onBlur={() => setTimeout(() => setJobSearchFocused(false), 200)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="Type to search or create new…" />
            {jobSuggestions.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {jobSuggestions.map(j => (
                  <button key={j.id} onClick={() => { setJobName(j.jobName); setJobSearchFocused(false); }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
                    {j.jobName}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleAssign} disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCT LIBRARY VIEW ────────────────────────────────────────────────────
function ProductLibraryView({ onBack, user }) {
  const { skus } = useInventory();
  const [products, setProducts] = useState([]);
  const [allProducts, setAllProducts] = useState([]); // all created products for job lookup
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, 'productLibrary'),
      where('isDeleted', '==', false)
    );
    const unsub1 = onSnapshot(q,
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        docs.sort((a, b) => (a.productName || '').localeCompare(b.productName || ''));
        setProducts(docs);
        setLoading(false);
      },
      (err) => { console.error('ProductLibrary query error:', err); setLoading(false); }
    );
    return () => unsub1();
  }, []);

  // Separate effect for job usage lookup — won't break productLibrary if it fails
  useEffect(() => {
    const qAll = query(
      collection(db, 'products'),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(qAll,
      snap => { setAllProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      (err) => { console.error('Products (for library) query error:', err); }
    );
    return () => unsub();
  }, []);

  // Map template name → list of jobs it's been used for
  const jobsByTemplate = useMemo(() => {
    const map = {};
    for (const p of allProducts) {
      const key = (p.productName || '').toLowerCase().trim();
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push({
        jobName: p.jobName || '—',
        location: p.location,
        status: p.status || 'pending',
        catalogId: p.catalogId,
        completedAt: p.completedAt,
      });
    }
    return map;
  }, [allProducts]);

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    return smartSearch(products, search, ['productName', 'catalogId']);
  }, [products, search]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try { await softDelete('productLibrary', deleteTarget.id, user.uid, user.name || user.email); } catch {}
    setDeleteSaving(false);
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <SubpageHeader
        title="Product Library"
        onBack={onBack}
        action={
          <button onClick={() => setShowAdd(true)}
            className="min-h-[44px] px-4 flex items-center gap-1.5 rounded-lg text-white text-sm font-semibold"
            style={{ backgroundColor: '#4CB31D' }}>
            <Plus size={16} /> Add
          </button>
        }
      />

      <div className="px-4 py-2 border-b border-gray-100">
        <SearchBar value={search} onChange={setSearch} placeholder="Search templates…" />
      </div>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {search ? `No templates match "${search}"` : 'No product templates yet. Tap Add to create one.'}
            </p>
          </div>
        ) : filtered.map((product, idx) => (
          <div key={product.id}
            className={`border-b border-gray-100 ${idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'}`}>
            <div className="flex items-center px-4 py-3 min-h-[60px]">
              <button
                onClick={() => setExpanded(expanded === product.id ? null : product.id)}
                className="flex-1 flex items-center gap-2 text-left min-w-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: '#2D5016' }}>{product.productName}</p>
                  {product.catalogId && (
                    <p className="text-xs text-gray-500 mt-0.5">{product.catalogId}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {product.bom?.length ?? 0} SKU{(product.bom?.length ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
                <ChevronRight
                  size={16}
                  className={`text-gray-400 flex-shrink-0 transition-transform ${
                    expanded === product.id ? 'rotate-90' : ''
                  }`}
                />
              </button>
              <button onClick={() => setAssignTarget(product)}
                className="min-h-[36px] px-3 flex items-center gap-1 rounded-lg text-xs font-semibold text-white flex-shrink-0 ml-2"
                style={{ backgroundColor: '#4CB31D' }}
                title="Assign to Job">
                <Send size={13} /> Assign
              </button>
              <button onClick={() => setDeleteTarget(product)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-400 hover:text-red-600 rounded ml-1 flex-shrink-0"
                aria-label="Delete template">
                <Trash2 size={16} />
              </button>
            </div>

            {expanded === product.id && (() => {
              const templateKey = (product.productName || '').toLowerCase().trim();
              const jobs = jobsByTemplate[templateKey] || [];
              return (
                <div className="px-4 pb-3 space-y-3">
                  {/* BOM */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Materials</p>
                    {(product.bom ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No BOM items.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {product.bom.map((item, i) => (
                          <div key={item.skuId || `item-${i}`}
                            className="flex items-center justify-between py-1.5 px-2 bg-white rounded border border-gray-100">
                            <p className={`text-sm ${item.nonInventory ? 'text-gray-400 italic' : 'text-gray-700'}`}>{item.sku}</p>
                            <p className="text-xs font-bold text-gray-600">x{item.qty}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Job usage */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Used in Jobs ({jobs.length})</p>
                    {jobs.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Not yet assigned to any jobs.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {jobs.map((j, i) => (
                          <div key={i}
                            className="flex items-center justify-between py-1.5 px-2 bg-white rounded border border-gray-100">
                            <div className="min-w-0">
                              <p className="text-sm text-gray-700 truncate">{j.jobName}</p>
                              <p className="text-xs text-gray-400">{j.location === 'farm' ? 'Farm' : 'MKE'}{j.catalogId ? ` · ${j.catalogId}` : ''}</p>
                            </div>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${
                              j.status === 'complete' ? 'bg-green-100 text-green-700' :
                              j.status === 'pulled' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {j.status === 'complete' ? 'Complete' : j.status === 'pulled' ? 'Pulled' : 'Pending'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>

      {showAdd && <AddProductPopup user={user} skus={skus} onClose={() => setShowAdd(false)} />}
      {assignTarget && <AssignToJobPopup template={assignTarget} user={user} onClose={() => setAssignTarget(null)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Template?"
        message={`"${deleteTarget?.productName}" will be soft-deleted and can be restored from Admin Control.`}
        confirmLabel={deleteSaving ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── QUOTE REQUEST DETAIL POPUP ──────────────────────────────────────────────
function QRDetailPopup({ qr, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-base font-bold" style={{ color: '#2D5016' }}>{qr.qrNumber}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(qr.sentAt)} · {qr.sentBy}</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg ml-3">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          <p className="text-sm font-medium text-gray-700 mb-1">
            {qr.vendorName}
            {qr.vendorContact ? ` — ${qr.vendorContact}` : ''}
          </p>
          <p className="text-xs text-gray-400 mb-4">{qr.vendorEmail}</p>

          <div className="flex flex-col gap-2 mb-4">
            {(qr.items ?? []).map((item, idx) => (
              <div key={idx} className={`flex items-center justify-between py-2 border-b border-gray-50 ${
                idx % 2 === 1 ? 'bg-[#F0F0E8]/20 px-2 rounded' : ''
              }`}>
                <div>
                  <p className="text-sm font-medium text-gray-800">{item.sku}</p>
                  {item.location && (
                    <p className="text-xs text-gray-400 uppercase">{item.location}</p>
                  )}
                </div>
                <p className="text-sm font-bold text-gray-700">Qty: {item.qty}</p>
              </div>
            ))}
          </div>

          {qr.notes && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-500 mb-1">Notes</p>
              <p className="text-sm text-gray-700">{qr.notes}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── QUOTE REQUESTS VIEW ─────────────────────────────────────────────────────
function QuoteRequestsView({ onBack }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, 'quoteRequests'),
      where('isDeleted', '==', false),
      orderBy('sentAt', 'desc')
    );
    return onSnapshot(q,
      snap => { setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <SubpageHeader title="Quote Requests" onBack={onBack} />

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : requests.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No quote requests sent yet.</p>
          </div>
        ) : requests.map((qr, idx) => (
          <button
            key={qr.id}
            onClick={() => setSelected(qr)}
            className={`w-full flex items-center gap-3 px-4 py-3 min-h-[60px] text-left border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors ${
              idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold" style={{ color: '#2D5016' }}>{qr.qrNumber}</p>
                <span className="text-xs text-gray-400">{formatDate(qr.sentAt)}</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                {qr.vendorName} · {qr.items?.length ?? 0} SKU{(qr.items?.length ?? 0) !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-gray-400">Sent by {qr.sentBy}</p>
            </div>
            <ChevronRight size={18} className="text-gray-400 flex-shrink-0" />
          </button>
        ))}
      </div>

      {selected && <QRDetailPopup qr={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ─── AUDIT LOG VIEW ─────────────────────────────────────────────────────────
function AuditLogView({ onBack }) {
  const [events, setEvents] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'auditLog'), orderBy('timestamp', 'desc'), limit(500));
    const unsub = onSnapshot(
      q,
      snap => {
        setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoadingAudit(false);
      },
      () => setLoadingAudit(false)
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    let list = events;
    if (activeFilter) {
      const allowed = FILTER_MAP[activeFilter] ?? [];
      list = list.filter(e => allowed.includes(e.event));
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      list = list.filter(e => {
        if (!e.timestamp) return false;
        const d = e.timestamp.toDate ? e.timestamp.toDate() : new Date(e.timestamp);
        return d >= from;
      });
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter(e => {
        if (!e.timestamp) return false;
        const d = e.timestamp.toDate ? e.timestamp.toDate() : new Date(e.timestamp);
        return d <= to;
      });
    }
    if (!search.trim()) return list;
    return smartSearch(
      list.map(e => ({
        ...e,
        _sku: e.sku ?? '',
        _reason: e.reason ?? '',
        _user: e.userName ?? '',
        _date: e.timestamp ? formatDate(e.timestamp) : '',
      })),
      search,
      ['_sku', '_reason', '_user', '_date']
    );
  }, [events, activeFilter, search, dateFrom, dateTo]);

  const handleExport = () => {
    const rows = [['Date', 'Event', 'SKU', 'Location', 'Reason', 'User', 'Old Value', 'New Value']];
    filtered.forEach(e => {
      rows.push([
        formatDate(e.timestamp),
        EVENT_LABEL[e.event] ?? e.event,
        e.sku ?? '',
        e.location ?? '',
        e.reason ?? '',
        e.userName ?? '',
        e.oldValue ?? '',
        e.newValue ?? '',
      ]);
    });
    const csv = rows.map(r =>
      r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
          <h2 onClick={onBack} className="text-lg font-bold flex-1 cursor-pointer hover:underline" style={{ color: '#2D5016' }}>Audit Log</h2>

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search SKU, user, reason…" />
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2 px-4 pb-2">
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[36px]"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[36px]"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="text-xs text-gray-400 hover:text-gray-700 min-h-[36px] px-1"
              aria-label="Clear dates">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
          {Object.keys(FILTER_MAP).map(label => (
            <button
              key={label}
              onClick={() => setActiveFilter(prev => prev === label ? null : label)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[32px]"
              style={
                activeFilter === label
                  ? { backgroundColor: '#4CB31D', color: '#fff' }
                  : { backgroundColor: '#f3f4f6', color: '#4b5563' }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loadingAudit ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {search || activeFilter ? 'No matching events.' : 'No audit events yet.'}
            </p>
          </div>
        ) : (
          filtered.map((e, idx) => (
            <div
              key={e.id}
              className={`px-4 py-3 border-b border-gray-100 ${
                idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span
                      className="text-xs font-semibold uppercase tracking-wide"
                      style={{ color: '#4CB31D' }}
                    >
                      {EVENT_LABEL[e.event] ?? e.event}
                    </span>
                    {e.sku && (
                      <span className="text-sm font-medium text-gray-800">{e.sku}</span>
                    )}
                    {e.location && (
                      <span className="text-xs text-gray-400 uppercase">{e.location}</span>
                    )}
                  </div>
                  {e.reason && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{e.reason}</p>
                  )}
                  {e.oldValue !== null && e.oldValue !== undefined &&
                   e.newValue !== null && e.newValue !== undefined && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {e.oldValue} → {e.newValue}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">{formatDate(e.timestamp)}</p>
                  {e.userName && (
                    <p className="text-xs text-gray-400 mt-0.5">{e.userName}</p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── RECONCILIATION REPORTS VIEW ─────────────────────────────────────────────
function ReconciliationReportsView({ onBack }) {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'farm' | 'mke'
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'reconciliationReports'), where('isDeleted', '==', false), orderBy('submittedAt', 'desc'));
    return onSnapshot(q,
      snap => { setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); setError(null); },
      err => { console.error('[ReconciliationReports] Query error:', err); setError(err.message); setLoading(false); }
    );
  }, []);

  // One-time migration: rename old RC#/RR# formats to RR# 0001 style
  useEffect(() => {
    if (loading || reports.length === 0) return;
    // Sort oldest first for sequential numbering
    const sorted = [...reports].sort((a, b) => {
      const ta = a.submittedAt?.toDate ? a.submittedAt.toDate() : new Date(0);
      const tb = b.submittedAt?.toDate ? b.submittedAt.toDate() : new Date(0);
      return ta - tb;
    });
    sorted.forEach((r, i) => {
      const expected = `RR# ${String(i + 1).padStart(4, '0')}`;
      if (r.rcNumber !== expected) {
        updateDoc(doc(db, 'reconciliationReports', r.id), { rcNumber: expected }).catch(() => {});
      }
    });
  }, [loading, reports]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return reports;
    return reports.filter(r => r.location === activeTab);
  }, [reports, activeTab]);

  const handleDownloadPdf = (report) => {
    // Build plain-text content for the report
    const locLabel = report.location === 'farm' ? 'Farm' : 'MKE';
    const date = report.submittedAt?.toDate ? report.submittedAt.toDate().toLocaleDateString() : '—';
    let text = `Reconciliation Report: ${report.rcNumber}\n`;
    text += `Location: ${locLabel}\n`;
    text += `Date: ${date}\n`;
    text += `Submitted by: ${report.submittedBy}\n\n`;
    text += `SKU                    System  Counted  Discrepancy\n`;
    text += `${'─'.repeat(60)}\n`;
    (report.items ?? []).forEach(item => {
      const disc = item.delta > 0 ? `+${item.delta}` : `${item.delta}`;
      text += `${item.sku.padEnd(23)}${String(item.systemQty).padStart(6)}  ${String(item.countedQty).padStart(7)}  ${disc.padStart(11)}\n`;
    });

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.rcNumber}-${report.location}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try { await softDelete('reconciliationReports', deleteTarget.id, user.uid, user.name || user.email); } catch {}
    setDeleteSaving(false);
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <SubpageHeader title="Reconciliation Reports" onBack={onBack} />

      {/* Tabs: All / Farm / MKE */}
      <div className="px-4 py-3 flex gap-2 border-b border-gray-100">
        {[
          { id: 'all', label: 'All' },
          { id: 'farm', label: 'Farm' },
          { id: 'mke', label: 'MKE' },
        ].map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-h-[40px] rounded-lg border text-sm font-semibold transition-colors ${
              activeTab === tab.id ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
            style={activeTab === tab.id ? { backgroundColor: '#4CB31D' } : {}}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="px-4 py-12 text-center">
            <p className="text-red-500 text-sm">Failed to load reports: {error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No reconciliation reports yet.</p>
          </div>
        ) : filtered.map((r, idx) => (
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
                    <div className="flex items-center text-xs font-semibold text-gray-400 uppercase px-2 py-1">
                      <span className="flex-1">SKU</span>
                      <span className="w-16 text-center">System</span>
                      <span className="w-16 text-center">Counted</span>
                      <span className="w-20 text-right">Discrepancy</span>
                    </div>
                    {r.items.map(item => (
                      <div key={item.skuId}
                        className="flex items-center py-1.5 px-2 bg-white rounded border border-gray-100">
                        <p className="text-sm text-gray-700 flex-1">{item.sku}</p>
                        <span className="w-16 text-center text-xs text-gray-400">{item.systemQty}</span>
                        <span className="w-16 text-center text-xs text-gray-700 font-medium">{item.countedQty}</span>
                        <span className={`w-20 text-right text-xs font-bold ${item.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {item.delta > 0 ? '+' : ''}{item.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Actions row */}
                <div className="flex items-center gap-4 mt-3">
                  <button
                    onClick={() => handleDownloadPdf(r)}
                    className="hidden md:flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-grg-green">
                    <Download size={14} /> Download Report
                  </button>
                  <button
                    onClick={() => setDeleteTarget(r)}
                    className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-600">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Report?"
        message={`"${deleteTarget?.rcNumber}" will be soft-deleted. Recoverable from Admin Control within 30 days.`}
        confirmLabel={deleteSaving ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── PROJECTS VIEW ──────────────────────────────────────────────────────────
function ProjectsView({ onBack, user }) {
  const [jobs, setJobs] = useState([]);
  const [pulls, setPulls] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  useEffect(() => {
    const qJobs = query(collection(db, 'jobs'), where('isDeleted', '==', false), orderBy('createdAt', 'desc'));
    const unsub1 = onSnapshot(qJobs,
      snap => { setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
    const qPulls = query(collection(db, 'pulls'), where('isDeleted', '==', false));
    const unsub2 = onSnapshot(qPulls,
      snap => { setPulls(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      () => {}
    );
    const qProducts = query(collection(db, 'products'), where('isDeleted', '==', false));
    const unsub3 = onSnapshot(qProducts,
      snap => { setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      () => {}
    );
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return jobs;
    return smartSearch(jobs, search, ['jobName']);
  }, [jobs, search]);

  const pullsByJob = useMemo(() => {
    const map = {};
    pulls.forEach(p => {
      const key = p.jobId || 'unknown';
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return map;
  }, [pulls]);

  const productsByJob = useMemo(() => {
    const map = {};
    products.forEach(p => {
      const key = p.jobId || 'unknown';
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return map;
  }, [products]);

  const getProductStatus = (product) => {
    const status = product.status ?? 'pending';
    if (status === 'complete') return 'complete';
    if (status === 'pulled') return 'pulled';
    const bom = (product.bom ?? []).map(b => ({ ...b, pulled: b.pulled ?? false }));
    if (bom.length > 0 && bom.every(b => b.pulled)) return 'pulled';
    return 'pending';
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      await softDelete('jobs', deleteTarget.id, user.uid, user.name || user.email);
    } catch (err) {
      console.error('Failed to delete job:', err);
    }
    setDeleteSaving(false);
    setDeleteTarget(null);
    setExpanded(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <SubpageHeader title="Projects" onBack={onBack} />

      <div className="px-4 py-2 border-b border-gray-100">
        <SearchBar value={search} onChange={setSearch} placeholder="Search projects…" />
      </div>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {search ? `No projects match "${search}"` : 'No projects yet.'}
            </p>
          </div>
        ) : filtered.map((job, idx) => {
          const jobPulls = pullsByJob[job.id] ?? [];
          const jobProducts = productsByJob[job.id] ?? [];
          const totalPulls = jobPulls.length;
          const totalProducts = jobProducts.length;
          return (
            <div key={job.id}
              className={`border-b border-gray-100 ${idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'}`}>
              <div className="flex items-center px-4 py-3 min-h-[60px]">
                <button
                  onClick={() => setExpanded(expanded === job.id ? null : job.id)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: '#2D5016' }}>{job.jobName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDate(job.createdAt)} · {totalProducts} product{totalProducts !== 1 ? 's' : ''} · {totalPulls} pull{totalPulls !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <ChevronRight size={16}
                    className={`text-gray-400 flex-shrink-0 transition-transform ${expanded === job.id ? 'rotate-90' : ''}`} />
                </button>
                <button onClick={() => setDeleteTarget(job)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-400 hover:text-red-600 rounded ml-2 flex-shrink-0"
                  aria-label="Delete project">
                  <Trash2 size={16} />
                </button>
              </div>

              {expanded === job.id && (
                <div className="px-4 pb-4">
                  {/* Products section */}
                  {jobProducts.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Products</p>
                      <div className="flex flex-col gap-1">
                        {jobProducts.map(prod => (
                          <div key={prod.id}
                            className="flex items-center justify-between py-1.5 px-2 bg-white rounded border border-gray-100">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-gray-700 truncate">{prod.productName}</p>
                              <p className="text-xs text-gray-400">
                                {prod.bom?.length ?? 0} SKU{(prod.bom?.length ?? 0) !== 1 ? 's' : ''}
                                {prod.location && ` · ${locLabel(prod.location)}`}
                              </p>
                            </div>
                            <StatusBadge status={getProductStatus(prod)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pulls section */}
                  {jobPulls.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Pulls</p>
                      <div className="flex flex-col gap-1">
                        {jobPulls.map(pull => (
                          <div key={pull.id}
                            className="flex items-center justify-between py-1.5 px-2 bg-white rounded border border-gray-100">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-gray-700">{pull.pullNumber || pull.id}</p>
                              <p className="text-xs text-gray-400">
                                {formatDate(pull.pulledAt)} · {pull.pulledBy || '—'} · {pull.location || '—'}
                              </p>
                            </div>
                            <p className="text-xs font-medium text-gray-500 flex-shrink-0 ml-2">
                              {pull.items?.length ?? 0} item{(pull.items?.length ?? 0) !== 1 ? 's' : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {jobProducts.length === 0 && jobPulls.length === 0 && (
                    <p className="text-xs text-gray-400 italic">No products or pulls for this project yet.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Project?"
        message={`"${deleteTarget?.jobName}" will be soft-deleted and can be restored from Admin Control.`}
        confirmLabel={deleteSaving ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── MAIN MENU ───────────────────────────────────────────────────────────────
export default function MorePage() {
  const { user } = useAuth();
  const { hiViz } = useTheme();
  const [view, setView] = useState('menu');
  const location = useLocation();

  // Reset to main menu when nav tab is clicked while on a subpage
  useEffect(() => {
    if (location.state?.reset) setView('menu');
  }, [location.state?.reset]);

  if (view === 'auditLog') return <AuditLogView onBack={() => setView('menu')} />;
  if (view === 'vendorContacts') return <VendorContactsView onBack={() => setView('menu')} user={user} />;
  if (view === 'userManagement') return <UserManagementView onBack={() => setView('menu')} user={user} />;
  if (view === 'quoteRequests') return <QuoteRequestsView onBack={() => setView('menu')} />;
  if (view === 'reconciliationReports') return <ReconciliationReportsView onBack={() => setView('menu')} />;
  if (view === 'productLibrary') return <ProductLibraryView onBack={() => setView('menu')} user={user} />;
  if (view === 'projects') return <ProjectsView onBack={() => setView('menu')} user={user} />;
  if (view === 'adminControl') return <AdminControlView onBack={() => setView('menu')} user={user} />;
  if (view === 'notifications') return <NotificationsView onBack={() => setView('menu')} user={user} />;

  const isAdmin = user?.email === SUPER_ADMIN_EMAIL || user?.email === DEV_ADMIN_EMAIL;
  const cardBg = hiViz ? 'bg-white border-2 border-black' : 'bg-gray-50 border border-gray-200';

  const cards = [
    { id: 'vendorContacts', label: 'Vendor Contacts', desc: 'Manage vendor contacts for quote requests.', active: true },
    { id: 'userManagement', label: 'User Management', desc: 'Add and manage team members.', active: true },
    { id: 'quoteRequests', label: 'Quote Requests', desc: 'View all sent quote requests.', active: true },
    { id: 'notifications', label: 'Notifications', desc: 'Configure notification recipients per event.', active: true },
    { id: 'reconciliationReports', label: 'Reconciliation Reports', desc: 'View past physical count reports.', active: true },
    { id: 'productLibrary', label: 'Product Library', desc: 'Browse and assign product templates.', active: true },
    { id: 'projects', label: 'Projects', desc: 'Browse completed and active projects.', active: true },
    { id: 'auditLog', label: 'Audit Log', desc: 'Browse all inventory and system events.', active: true },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="p-4 flex flex-col gap-2">
        {cards.map(card => (
          <button
            key={card.id}
            disabled={!card.active}
            onClick={() => card.active && setView(card.id)}
            className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-left w-full transition-colors ${cardBg} ${
              card.active ? 'hover:bg-gray-100 active:bg-gray-200' : 'opacity-40 cursor-default'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: '#2D5016' }}>{card.label}</p>
              <p className="text-xs text-gray-500">{card.desc}</p>
            </div>
            {card.active && <ChevronRight size={18} className="text-gray-400 flex-shrink-0 ml-3" />}
          </button>
        ))}

        {/* Admin Control — John and Dave only */}
        {isAdmin && (
          <button
            onClick={() => setView('adminControl')}
            className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-left w-full transition-colors ${cardBg} hover:bg-gray-100 active:bg-gray-200`}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Shield size={18} style={{ color: '#4CB31D' }} className="flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold" style={{ color: '#2D5016' }}>Admin Control</p>
                <p className="text-xs text-gray-500">Restore center, bulk import, settings.</p>
              </div>
            </div>
            <ChevronRight size={18} className="text-gray-400 flex-shrink-0 ml-3" />
          </button>
        )}
      </div>
    </div>
  );
}
