const STATUS_CONFIG = {
  pulled: {
    label: 'Pulled',
    style: { backgroundColor: '#DBEAFE', color: '#1D4ED8', border: '1px solid #BFDBFE' },
  },
  pending: {
    label: 'Pending',
    style: { backgroundColor: '#F3F4F6', color: '#4B5563', border: '1px solid #E5E7EB' },
  },
  in_transit: {
    label: 'In Transit',
    style: { backgroundColor: '#FEF3C7', color: '#D97706', border: '1px solid #FDE68A' },
  },
  complete: {
    label: 'Complete',
    style: { backgroundColor: '#D1FAE5', color: '#065F46', border: '1px solid #A7F3D0' },
  },
  requested: {
    label: 'Requested',
    style: { backgroundColor: '#DBEAFE', color: '#1D4ED8', border: '1px solid #BFDBFE' },
  },
  received: {
    label: 'Received',
    style: { backgroundColor: '#D1FAE5', color: '#065F46', border: '1px solid #A7F3D0' },
  },
};

export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold"
      style={config.style}
    >
      {config.label}
    </span>
  );
}
