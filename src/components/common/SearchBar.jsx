import { Search, X } from 'lucide-react';

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
}) {
  return (
    <div className={`relative flex items-center ${className}`}>
      <Search
        size={18}
        className="absolute left-3 text-gray-400 pointer-events-none flex-shrink-0"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-grg-sage focus:border-transparent min-h-[44px]"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
