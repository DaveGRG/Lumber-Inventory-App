export default function Spinner({ className = '' }) {
  return (
    <div className={`flex items-center justify-center py-12 ${className}`}>
      <div className="w-7 h-7 border-3 border-grg-sage border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
