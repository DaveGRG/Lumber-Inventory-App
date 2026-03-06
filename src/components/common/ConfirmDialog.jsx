import { X } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Large X close button — top right */}
        <button
          onClick={onCancel}
          aria-label="Close"
          className="absolute top-3 right-3 min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg transition-colors"
        >
          <X size={22} />
        </button>

        <h2 className="text-base font-semibold pr-8" style={{ color: '#2D5016' }}>
          {title}
        </h2>
        {message && (
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{message}</p>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium transition-colors text-white ${
              destructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-grg-green hover:bg-grg-moss'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
