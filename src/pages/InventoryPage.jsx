import { useState, useMemo } from 'react';
import { useInventory } from '../hooks/useInventory';
import { useBelowPar } from '../hooks/useBelowPar';
import { useTheme } from '../hooks/useTheme';
import { smartSearch } from '../utils/search';
import Spinner from '../components/common/Spinner';
import SearchBar from '../components/common/SearchBar';
import CategoryMenu from '../components/common/CategoryMenu';
import BelowParBadge from '../components/common/BelowParBadge';
import SkuDetailPopup from '../components/inventory/SkuDetailPopup';

const CATEGORIES = ['CDR', 'CT', 'GT'];
const CATEGORY_LABELS = { CDR: 'Cedar', CT: 'Cedartone', GT: 'Green Treated' };

// Small red dot badge for CategoryMenu header
function CategoryBelowParDot() {
  return (
    <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" aria-label="Items below par" />
  );
}

// Orange dot for in-transit
function InTransitDot() {
  return (
    <span
      className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0"
      title="Units in transit"
      aria-label="In transit"
    />
  );
}

function TabBadge({ count }) {
  if (!count) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1">
      {count}
    </span>
  );
}

export default function InventoryPage() {
  const { skus, inventory, loading, error } = useInventory();
  const { hiViz } = useTheme();

  const [activeTab, setActiveTab] = useState('farm');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null); // { sku, invDoc }

  const belowParAll = useBelowPar(inventory, skus);

  const farmBelowParCount = useMemo(
    () => belowParAll.filter((i) => i.location === 'farm').length,
    [belowParAll]
  );
  const mkeBelowParCount = useMemo(
    () => belowParAll.filter((i) => i.location === 'mke').length,
    [belowParAll]
  );

  // Join inventory docs with their SKU, filtered to current tab location
  const tabItems = useMemo(() => {
    return inventory
      .filter((inv) => inv.location === activeTab)
      .map((inv) => {
        const sku = skus.find((s) => s.id === inv.skuId);
        return sku ? { sku, inv } : null;
      })
      .filter(Boolean);
  }, [inventory, skus, activeTab]);

  // Apply smart search across sku name and category fields
  const searched = useMemo(() => {
    if (!searchQuery.trim()) return tabItems;
    // Build flat objects for smartSearch
    const flat = tabItems.map(({ sku, inv }) => ({
      ...inv,
      sku: sku.sku,
      category: sku.category,
      _sku: sku,
      _inv: inv,
    }));
    return smartSearch(flat, searchQuery, ['sku', 'category']).map((item) => ({
      sku: item._sku,
      inv: item._inv,
    }));
  }, [tabItems, searchQuery]);

  // Parse lumber dimensions for natural sort (e.g. "CDR 2x10x12" → [2,10,12])
  function lumberSortKey(skuName) {
    const nums = skuName.match(/\d+/g);
    return nums ? nums.map(Number) : [Infinity];
  }

  function compareLumber(a, b) {
    const ka = lumberSortKey(a.sku.sku);
    const kb = lumberSortKey(b.sku.sku);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const va = ka[i] ?? 0;
      const vb = kb[i] ?? 0;
      if (va !== vb) return va - vb;
    }
    return a.sku.sku.localeCompare(b.sku.sku);
  }

  // Group searched items by category, sorted by lumber dimensions
  const grouped = useMemo(() => {
    return CATEGORIES.reduce((acc, cat) => {
      acc[cat] = searched.filter(({ sku }) => sku.category === cat).sort(compareLumber);
      return acc;
    }, {});
  }, [searched]);

  // Below-par sets for quick lookup
  const belowParIds = useMemo(
    () => new Set(belowParAll.map((i) => `${i.skuId}_${i.location}`)),
    [belowParAll]
  );

  function isBelowPar(inv) {
    return belowParIds.has(`${inv.skuId}_${inv.location}`);
  }

  function categoryHasBelowPar(cat) {
    return (grouped[cat] ?? []).some(({ inv }) => isBelowPar(inv));
  }

  const tabBase = 'flex-1 flex items-center justify-center min-h-[44px] text-sm font-semibold rounded-lg transition-colors';
  const tabActive = hiViz
    ? 'bg-black text-white border-2 border-black'
    : 'bg-grg-green text-white shadow-sm';
  const tabInactive = hiViz
    ? 'text-black border-2 border-black bg-white'
    : 'text-gray-500 hover:text-grg-green bg-transparent';

  if (loading) {
    return <Spinner />;
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-red-600 text-sm">Failed to load inventory. Please refresh.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search + Tabs — sticky top bar */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 pt-3 pb-2 space-y-2">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search SKU or category…"
        />

        {/* Farm / MKE tab switcher */}
        <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
          <button
            onClick={() => setActiveTab('farm')}
            className={`${tabBase} ${activeTab === 'farm' ? tabActive : tabInactive}`}
          >
            Farm
            <TabBadge count={farmBelowParCount} />
          </button>
          <button
            onClick={() => setActiveTab('mke')}
            className={`${tabBase} ${activeTab === 'mke' ? tabActive : tabInactive}`}
          >
            MKE
            <TabBadge count={mkeBelowParCount} />
          </button>
        </div>
      </div>

      {/* Category menus — key resets expanded state on tab switch */}
      <div key={activeTab} className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {CATEGORIES.map((cat) => {
          const items = grouped[cat] ?? [];
          const hasBelowPar = categoryHasBelowPar(cat);

          return (
            <CategoryMenu
              key={cat}
              title={CATEGORY_LABELS[cat]}
              badge={hasBelowPar ? <CategoryBelowParDot /> : null}
            >
              {items.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-400 italic">No items</p>
              ) : (
                items.map(({ sku, inv }, idx) => {
                  const inTransitQty = inv.inTransitQty ?? 0;
                  const displayQty = inv.quantity - inTransitQty;
                  const belowPar = isBelowPar(inv);
                  const inTransit = inTransitQty > 0;

                  return (
                    <button
                      key={inv.id}
                      onClick={() => setSelectedItem({ sku, invDoc: inv })}
                      className={`w-full flex items-center justify-between px-4 py-3 min-h-[52px] text-left transition-colors hover:bg-grg-tan/40 active:bg-grg-tan/60 ${
                        idx % 2 === 1 ? 'bg-[#F0F0E8]/30' : 'bg-white'
                      }`}
                    >
                      {/* SKU name + indicators */}
                      <div className="flex items-center gap-2 min-w-0">
                        {belowPar && <BelowParBadge />}
                        {inTransit && !belowPar && <InTransitDot />}
                        <span
                          className={`text-sm font-medium truncate ${
                            hiViz ? 'text-black' : 'text-gray-800'
                          }`}
                        >
                          {sku.sku}
                        </span>
                        {inTransit && belowPar && (
                          <InTransitDot />
                        )}
                      </div>

                      {/* Quantity */}
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        {inTransit && (
                          <span className="text-xs text-orange-500 font-medium">
                            {inTransitQty} in transit
                          </span>
                        )}
                        <span
                          className={`text-base font-bold w-10 text-right ${
                            belowPar
                              ? 'text-red-600'
                              : hiViz
                              ? 'text-black'
                              : 'text-gray-800'
                          }`}
                        >
                          {displayQty}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </CategoryMenu>
          );
        })}

        {/* Empty state when search returns nothing */}
        {searchQuery && CATEGORIES.every((cat) => (grouped[cat] ?? []).length === 0) && (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No SKUs match "{searchQuery}"</p>
          </div>
        )}

        {/* Empty state when no inventory at all */}
        {!searchQuery && inventory.filter((i) => i.location === activeTab).length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No inventory at {activeTab === 'farm' ? 'Farm' : 'MKE'} yet.</p>
          </div>
        )}
      </div>

      {/* SKU Detail Popup */}
      {selectedItem && (
        <SkuDetailPopup
          sku={selectedItem.sku}
          invDoc={selectedItem.invDoc}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
