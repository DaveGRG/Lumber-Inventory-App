import { useState, useRef } from 'react';
import { X, Trash2, Plus, Minus } from 'lucide-react';
import ConfirmDialog from '../common/ConfirmDialog';
import { adjustInventory } from '../../utils/inventoryUpdates';
import { softDelete } from '../../utils/softDelete';
import { triggerNotification } from '../../utils/notifications';
import { NOTIFICATION_EVENTS } from '../../constants/notificationEvents';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../hooks/useTheme';

const CATEGORY_LABELS = { CDR: 'Cedar', CT: 'Cedartone', GT: 'Green Treated' };
const LOCATION_LABELS = { farm: 'Farm', mke: 'MKE' };

export default function SkuDetailPopup({ sku, invDoc, onClose }) {
  const { user } = useAuth();
  const { hiViz } = useTheme();

  const par = invDoc.location === 'farm' ? sku.farmPar : sku.mkePar;

  // Capture the original quantity at mount time to avoid race conditions
  // if another user changes inventory while this popup is open
  const originalQty = useRef(invDoc.quantity);
  const [localQty, setLocalQty] = useState(invDoc.quantity);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);

  const hasChanged = localQty !== originalQty.current;

  function handleClose() {
    if (hasChanged) {
      setShowSaveConfirm(true);
    } else {
      onClose();
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const delta = localQty - originalQty.current;
      await adjustInventory({
        skuId: sku.id,
        sku: sku.sku,
        location: invDoc.location,
        delta,
        reason: reason.trim() || 'Manual adjustment',
        userId: user.uid,
        userName: user.name || user.email,
      });
      setShowSaveConfirm(false);
      onClose();
    } catch (err) {
      setError('Save failed. Please try again.');
      setSaving(false);
    }
  }

  function handleDiscardAndClose() {
    setShowSaveConfirm(false);
    onClose();
  }

  async function handleDelete() {
    setSaving(true);
    setError(null);
    try {
      await softDelete('skus', sku.id, user.uid, user.name || user.email);
      triggerNotification(
        NOTIFICATION_EVENTS.SKU_DELETED,
        `SKU Deleted — ${sku.sku}`,
        `SKU "${sku.sku}" has been deleted.\n\nDeleted by: ${user.name || user.email}`,
      );
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      setError('Delete failed. Please try again.');
      setSaving(false);
    }
  }

  const inputBg = hiViz ? 'bg-white border-black' : 'bg-gray-50 border-gray-200';
  const labelColor = hiViz ? 'text-black' : 'text-gray-500';
  const valueColor = hiViz ? 'text-black font-bold' : 'text-gray-800';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onClick={handleClose}
      >
        {/* Sheet / Dialog */}
        <div
          className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4 border-b border-gray-100"
            style={{ backgroundColor: '#2D5016' }}
          >
            <div>
              <h2 className="text-base font-bold text-white leading-tight">{sku.sku}</h2>
              <p className="text-xs text-grg-sage mt-0.5">
                {CATEGORY_LABELS[sku.category] ?? sku.category} · {LOCATION_LABELS[invDoc.location]}
              </p>
            </div>
            <button
              onClick={handleClose}
              aria-label="Close"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white rounded-lg transition-colors"
            >
              <X size={24} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 space-y-5">
            {/* Five attributes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className={`text-xs uppercase tracking-wide mb-0.5 ${labelColor}`}>Category</p>
                <p className={`text-sm ${valueColor}`}>{CATEGORY_LABELS[sku.category] ?? sku.category}</p>
              </div>
              <div>
                <p className={`text-xs uppercase tracking-wide mb-0.5 ${labelColor}`}>Status</p>
                <p className={`text-sm capitalize ${sku.status === 'discontinued' ? 'text-red-500' : valueColor}`}>
                  {sku.status}
                </p>
              </div>
              <div>
                <p className={`text-xs uppercase tracking-wide mb-0.5 ${labelColor}`}>Par Level</p>
                <p className={`text-sm ${valueColor}`}>{par}</p>
              </div>
              <div>
                <p className={`text-xs uppercase tracking-wide mb-0.5 ${labelColor}`}>Location</p>
                <p className={`text-sm ${valueColor}`}>{LOCATION_LABELS[invDoc.location]}</p>
              </div>
              {sku.notes ? (
                <div className="col-span-2">
                  <p className={`text-xs uppercase tracking-wide mb-0.5 ${labelColor}`}>Notes</p>
                  <p className={`text-sm ${valueColor}`}>{sku.notes}</p>
                </div>
              ) : null}
            </div>

            {/* In-transit indicator */}
            {invDoc.inTransitQty > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-200">
                <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                <p className="text-xs text-orange-700 font-medium">
                  {invDoc.inTransitQty} unit{invDoc.inTransitQty !== 1 ? 's' : ''} in transit
                </p>
              </div>
            )}

            {/* Quantity adjuster */}
            <div>
              <p className={`text-xs uppercase tracking-wide mb-2 ${labelColor}`}>Adjust Count</p>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setLocalQty((q) => Math.max(0, q - 1))}
                  aria-label="Decrease quantity"
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border text-lg font-semibold transition-colors ${
                    hiViz
                      ? 'border-black text-black hover:bg-gray-100'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Minus size={20} />
                </button>

                <input
                  type="number"
                  min="0"
                  value={localQty}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 0) setLocalQty(val);
                  }}
                  className={`w-20 text-center text-2xl font-bold border rounded-lg py-2 focus:outline-none focus:ring-2 focus:ring-grg-sage ${inputBg} ${valueColor}`}
                />

                <button
                  onClick={() => setLocalQty((q) => q + 1)}
                  aria-label="Increase quantity"
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border text-lg font-semibold transition-colors ${
                    hiViz
                      ? 'border-black text-black hover:bg-gray-100'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Plus size={20} />
                </button>

                {hasChanged && (
                  <span className="text-xs text-grg-sage font-medium">
                    {localQty > originalQty.current ? '+' : ''}{localQty - originalQty.current} from {originalQty.current}
                  </span>
                )}
              </div>

              {hasChanged && (
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason for adjustment (optional)"
                  className={`mt-3 w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage ${inputBg}`}
                />
              )}
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 pb-6 gap-3">
            {/* Delete */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Delete SKU"
              disabled={saving}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-red-500 hover:text-red-700 rounded-lg transition-colors disabled:opacity-40"
            >
              <Trash2 size={22} />
            </button>

            <div className="flex gap-3 flex-1">
              <button
                onClick={handleClose}
                disabled={saving}
                className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={hasChanged ? handleSave : onClose}
                disabled={saving || !hasChanged}
                className="flex-1 min-h-[44px] rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
                style={{ backgroundColor: hasChanged ? '#4CB31D' : '#9CA3AF' }}
              >
                {saving ? 'Saving…' : hasChanged ? 'Save' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Save changes confirm — shown when closing with unsaved changes */}
      <ConfirmDialog
        open={showSaveConfirm}
        title="Save changes?"
        message={`Quantity will change from ${originalQty.current} to ${localQty}${reason.trim() ? ` — "${reason.trim()}"` : ''}.`}
        confirmLabel={saving ? 'Saving…' : 'Save'}
        cancelLabel="Discard"
        onConfirm={handleSave}
        onCancel={handleDiscardAndClose}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this SKU?"
        message={`"${sku.sku}" will be moved to trash and can be restored within 30 days.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
