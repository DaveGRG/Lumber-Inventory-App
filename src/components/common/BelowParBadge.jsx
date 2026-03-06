// Red triangle with ! — appears wherever a SKU is below its par level
export default function BelowParBadge({ className = '' }) {
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
      aria-label="Below par"
      title="Below par"
    >
      <svg width="18" height="16" viewBox="0 0 18 16" fill="none" aria-hidden="true">
        <path
          d="M9 1.5L1.5 14.5h15L9 1.5z"
          fill="#EF4444"
          stroke="#EF4444"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        <text
          x="9"
          y="13"
          textAnchor="middle"
          fill="white"
          fontSize="8.5"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          !
        </text>
      </svg>
    </span>
  );
}
