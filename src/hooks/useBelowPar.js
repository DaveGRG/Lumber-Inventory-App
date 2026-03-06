import { useMemo } from 'react';

// Returns inventory records where qty < par, excluding discontinued SKUs.
// inventory: array of inventory docs (with skuId, location, quantity)
// skus: array of SKU docs (with id, status, farmPar, mkePar)
export function useBelowPar(inventory, skus) {
  return useMemo(() => {
    return inventory.filter(inv => {
      const sku = skus.find(s => s.id === inv.skuId);
      if (!sku || sku.status === 'discontinued') return false;
      const par = inv.location === 'farm' ? sku.farmPar : sku.mkePar;
      return inv.quantity < par;
    });
  }, [inventory, skus]);
}
