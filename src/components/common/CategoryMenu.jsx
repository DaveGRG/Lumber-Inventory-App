import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function CategoryMenu({
  title,
  children,
  defaultOpen = false,
  forceOpen = false,
  badge = null,
  count = null,
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);

  // When forceOpen changes (e.g. search active), override local state
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <div className="border-b border-gray-200 last:border-b-0">
      {/* Sticky collapsible header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="sticky top-0 z-10 w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-left transition-colors"
        style={{ backgroundColor: '#F0F0E8' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="font-semibold text-sm uppercase tracking-wide"
            style={{ color: '#2D5016' }}
          >
            {title}
          </span>
          {badge}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {count !== null && (
            <span className="text-sm font-semibold" style={{ color: '#2D5016' }}>{count}</span>
          )}
          {open ? (
            <ChevronDown size={18} style={{ color: '#2D5016' }} />
          ) : (
            <ChevronRight size={18} style={{ color: '#2D5016' }} />
          )}
        </div>
      </button>

      {/* Collapsible rows */}
      {open && <div className="divide-y divide-gray-100">{children}</div>}
    </div>
  );
}
