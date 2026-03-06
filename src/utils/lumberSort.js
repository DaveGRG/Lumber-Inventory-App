// Parses dimensions from a SKU name like "CDR 1x4x8", "GT 2x6x12", "CT 1x10x16"
function parseDimensions(skuName) {
  const match = String(skuName).match(/(\d+)x(\d+)(?:x(\d+))?/i);
  if (!match) return null;
  return {
    t: parseInt(match[1], 10),   // thickness (1, 2, 3…)
    w: parseInt(match[2], 10),   // width (4, 6, 8, 10, 12…)
    l: parseInt(match[3] ?? 0, 10), // length (8, 10, 12, 16…)
  };
}

/**
 * Sort an array of items by lumber size: thickness → width → length.
 * Items without a recognizable NxN dimension pattern sort last, alphabetically.
 *
 * @param {Array} items  - array of any objects
 * @param {Function} getName - extracts the SKU/name string from an item (default: item => item.sku)
 */
export function sortByLumberSize(items, getName = (item) => item.sku) {
  return [...items].sort((a, b) => {
    const da = parseDimensions(getName(a));
    const db = parseDimensions(getName(b));

    // Non-dimensional items fall to the bottom
    if (!da && !db) return String(getName(a)).localeCompare(String(getName(b)));
    if (!da) return 1;
    if (!db) return -1;

    if (da.t !== db.t) return da.t - db.t;
    if (da.w !== db.w) return da.w - db.w;
    return da.l - db.l;
  });
}
