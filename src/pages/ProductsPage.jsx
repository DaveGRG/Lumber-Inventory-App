import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, X, ChevronRight, Minus, ArrowLeft, Trash2, Upload, Check, AlertTriangle } from 'lucide-react';
import {
  collection, addDoc, doc, updateDoc, onSnapshot,
  query, where, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../hooks/useInventory';
import { adjustInventory } from '../utils/inventoryUpdates';
import { softDelete } from '../utils/softDelete';
import { smartSearch } from '../utils/search';
import { generateRecordNumber } from '../utils/recordNumbers';
import Spinner from '../components/common/Spinner';
import SearchBar from '../components/common/SearchBar';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { triggerNotification } from '../utils/notifications';
import { NOTIFICATION_EVENTS } from '../constants/notificationEvents';
import StatusBadge from '../components/common/StatusBadge';

const locLabel = (loc) => loc === 'farm' ? 'Farm' : 'MKE';

// ─── CSV HELPERS ──────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

function fuzzyMatchSku(skuName, skus) {
  if (!skuName) return null;
  const norm = skuName.toLowerCase().replace(/\s+/g, '');
  // Exact match first
  const exact = skus.find(s => s.sku.toLowerCase().replace(/\s+/g, '') === norm);
  if (exact) return exact;
  // Partial match
  const partial = skus.find(s => s.sku.toLowerCase().replace(/\s+/g, '').includes(norm) || norm.includes(s.sku.toLowerCase().replace(/\s+/g, '')));
  return partial || null;
}

// ─── PRODUCT FORM POPUP (create + edit) ─────────────────────────────────────
function ProductFormPopup({ skus, user, jobs, onClose, product }) {
  const isEdit = !!product;
  const [productName, setProductName] = useState(product?.productName ?? '');
  const [catalogId, setCatalogId] = useState(product?.catalogId ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [location, setLocation] = useState(product?.location ?? 'farm');
  const [jobName, setJobName] = useState(product?.jobName ?? '');
  const [bom, setBom] = useState(
    (product?.bom ?? []).map(b => ({ ...b, pulled: b.pulled ?? false }))
  );
  const [skuSearch, setSkuSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [jobSearchFocused, setJobSearchFocused] = useState(false);

  const jobSuggestions = useMemo(() => {
    if (!jobName.trim() || !jobSearchFocused) return [];
    return jobs.filter(j => j.jobName.toLowerCase().includes(jobName.toLowerCase())).slice(0, 5);
  }, [jobs, jobName, jobSearchFocused]);

  const searchResults = useMemo(() => {
    if (!skuSearch.trim()) return [];
    return smartSearch(skus, skuSearch, ['sku', 'category'])
      .filter(s => !bom.some(b => b.skuId === s.id))
      .slice(0, 6);
  }, [skus, skuSearch, bom]);

  const addBomItem = (sku) => {
    setBom(prev => [...prev, { skuId: sku.id, sku: sku.sku, qty: 1, pulled: false }]);
    setSkuSearch('');
  };

  const removeBomItem = (skuId) => setBom(prev => prev.filter(b => b.skuId !== skuId));

  const adjustBomQty = (skuId, delta) =>
    setBom(prev => prev.map(b => b.skuId === skuId ? { ...b, qty: Math.max(1, b.qty + delta) } : b));

  const handleSave = async () => {
    if (!productName.trim()) { setError('Product name is required.'); return; }
    setSaving(true);
    try {
      // Resolve or create job
      let jobId = null;
      const trimmedJob = jobName.trim();
      if (trimmedJob) {
        const existingJob = jobs.find(j => j.jobName.toLowerCase() === trimmedJob.toLowerCase());
        if (existingJob) {
          jobId = existingJob.id;
        } else {
          const jobRef = await addDoc(collection(db, 'jobs'), {
            jobName: trimmedJob,
            isDeleted: false,
            createdAt: serverTimestamp(),
            createdBy: user.name || user.email,
          });
          jobId = jobRef.id;
        }
      }

      const productData = {
        productName: productName.trim(),
        catalogId: catalogId.trim() || null,
        description: description.trim() || null,
        location,
        jobId,
        jobName: trimmedJob || null,
        bom: bom.map(b => ({ skuId: b.skuId, sku: b.sku, qty: b.qty, pulled: b.pulled ?? false, ...(b.nonInventory ? { nonInventory: true } : {}) })),
        status: 'pending',
      };

      if (isEdit) {
        // Preserve current status on edit — don't reset to 'pending'
        const { status: _omit, ...editData } = productData;
        await updateDoc(doc(db, 'products', product.id), editData);
        await addDoc(collection(db, 'auditLog'), {
          event: 'PRODUCT_UPDATED',
          skuId: null, sku: null, location,
          userId: user.uid, userName: user.name || user.email,
          oldValue: product.productName,
          newValue: productName.trim(),
          reason: `Product updated: ${productName.trim()}`,
          relatedId: product.id, timestamp: serverTimestamp(),
        });
      } else {
        const prodRef = await addDoc(collection(db, 'products'), {
          ...productData,
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: user.name || user.email,
        });

        // Also write to product library
        await addDoc(collection(db, 'productLibrary'), {
          productName: productName.trim(),
          catalogId: catalogId.trim() || null,
          bom: bom.map(b => ({ skuId: b.skuId, sku: b.sku, qty: b.qty, ...(b.nonInventory ? { nonInventory: true } : {}) })),
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: user.name || user.email,
        });

        await addDoc(collection(db, 'auditLog'), {
          event: 'ITEM_CREATED',
          skuId: null, sku: null, location,
          userId: user.uid, userName: user.name || user.email,
          oldValue: null, newValue: productName.trim(),
          reason: `Product created: ${productName.trim()}`,
          relatedId: prodRef.id, timestamp: serverTimestamp(),
        });
      }
      onClose();
    } catch {
      setError('Failed to save product. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold" style={{ color: '#2D5016' }}>{isEdit ? 'Edit Product' : 'New Product'}</h2>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Product Name</label>
            <input value={productName} onChange={e => setProductName(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="e.g., Standard Arbor Kit" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Catalogue ID (optional)</label>
            <input value={catalogId} onChange={e => setCatalogId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="e.g., ARB-001" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Location</label>
            <div className="flex gap-2">
              {['farm', 'mke'].map(loc => (
                <button key={loc} onClick={() => setLocation(loc)}
                  className={`flex-1 min-h-[44px] rounded-lg border text-sm font-medium transition-colors ${
                    location === loc ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                  style={location === loc ? { backgroundColor: '#4CB31D' } : {}}>
                  {locLabel(loc)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Job Name</label>
            <input value={jobName} onChange={e => setJobName(e.target.value)}
              onFocus={() => setJobSearchFocused(true)}
              onBlur={() => setTimeout(() => setJobSearchFocused(false), 200)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
              placeholder="Type to search or create new…" />
            {jobSuggestions.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {jobSuggestions.map(j => (
                  <button key={j.id} onClick={() => { setJobName(j.jobName); setJobSearchFocused(false); }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
                    {j.jobName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Description (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage"
              rows={2} placeholder="Brief description of this product" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Bill of Materials</label>
            <SearchBar value={skuSearch} onChange={setSkuSearch} placeholder="Search SKU to add…" />
            {searchResults.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                {searchResults.map(sku => (
                  <button key={sku.id} onClick={() => addBomItem(sku)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors">
                    <span className="font-medium text-gray-800">{sku.sku}</span>
                    <span className="text-xs text-gray-400">{sku.category}</span>
                  </button>
                ))}
              </div>
            )}
            {bom.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                {bom.map(item => (
                  <div key={item.skuId}
                    className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-sm font-medium text-gray-800 flex-1 truncate">{item.sku}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => adjustBomQty(item.skuId, -1)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-100">
                        <Minus size={14} />
                      </button>
                      <span className="w-10 text-center text-sm font-bold">{item.qty}</span>
                      <button onClick={() => adjustBomQty(item.skuId, 1)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-100">
                        <Plus size={14} />
                      </button>
                      <button onClick={() => removeBomItem(item.skuId)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-400 hover:text-red-600 rounded ml-1"
                        aria-label="Remove">
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {bom.length === 0 && !skuSearch && (
              <p className="text-xs text-gray-400 italic mt-2">No materials added yet.</p>
            )}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4CB31D' }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Product'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CSV UPLOAD POPUP ─────────────────────────────────────────────────────────
function CSVUploadPopup({ skus, inventory, user, jobs, onClose }) {
  const fileRef = useRef(null);
  const [step, setStep] = useState(1);
  const [csvRows, setCsvRows] = useState([]);
  const [parseError, setParseError] = useState('');
  // Step 2 fields
  const [productName, setProductName] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [location, setLocation] = useState('farm');
  const [jobName, setJobName] = useState('');
  const [jobSearchFocused, setJobSearchFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const jobSuggestions = useMemo(() => {
    if (!jobName.trim() || !jobSearchFocused) return [];
    return jobs.filter(j => j.jobName.toLowerCase().includes(jobName.toLowerCase())).slice(0, 5);
  }, [jobs, jobName, jobSearchFocused]);

  // Resolve CSV rows to BOM items with SKU matching
  const resolvedBom = useMemo(() => {
    return csvRows.map(row => {
      const skuName = row.sku || row.skulabel || row.skuname || '';
      const qty = parseInt(row.qty || row.quantity || '1', 10) || 1;
      const matched = fuzzyMatchSku(skuName, skus);
      const invDoc = matched ? inventory.find(i => i.id === `${matched.id}_${location}`) : null;
      const stock = invDoc?.quantity ?? 0;
      return {
        skuName,
        qty,
        matched,
        stock,
        outOfStock: matched ? stock < qty : false,
      };
    });
  }, [csvRows, skus, inventory, location]);

  const handleFile = (e) => {
    setParseError('');
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const { headers, rows } = parseCSV(evt.target.result);
      // Check required columns (normalized)
      const hasCatalogId = headers.includes('catalogueid') || headers.includes('catalogid');
      const hasProductName = headers.includes('productname');
      const hasSku = headers.includes('sku') || headers.includes('skulabel') || headers.includes('skuname');
      const hasQty = headers.includes('qty') || headers.includes('quantity');

      if (!hasSku || !hasQty) {
        setParseError('CSV must have at least SKU and QTY columns.');
        return;
      }

      // Extract product name / catalog from any row that has it (typically the first)
      for (const row of rows) {
        if (hasProductName && row.productname && !productName) {
          setProductName(row.productname);
        }
        if (hasCatalogId) {
          const cid = row.catalogueid || row.catalogid || '';
          if (cid && !catalogId) setCatalogId(cid);
        }
      }

      // Also check 'name' header as alias for product name
      const hasName = headers.includes('name');
      if (hasName && !hasProductName && rows[0]?.name) {
        setProductName(rows[0].name);
      }

      // Filter to only rows that have a non-empty SKU value — skip product header rows
      const skuKey = headers.includes('sku') ? 'sku' : headers.includes('skulabel') ? 'skulabel' : 'skuname';
      const materialRows = rows.filter(row => {
        const val = (row[skuKey] || '').trim();
        return val.length > 0;
      });

      setCsvRows(materialRows);
      setStep(2);
    };
    reader.readAsText(file);
  };

  const handleCreate = async () => {
    if (!productName.trim()) { setError('Product name is required.'); return; }
    if (!catalogId.trim()) { setError('Catalogue ID is required.'); return; }
    if (!jobName.trim()) { setError('Job name is required.'); return; }
    if (resolvedBom.length === 0) { setError('No BOM items found.'); return; }
    setSaving(true);
    try {
      // Resolve or create job
      let jobId = null;
      const trimmedJob = jobName.trim();
      if (trimmedJob) {
        const existingJob = jobs.find(j => j.jobName.toLowerCase() === trimmedJob.toLowerCase());
        if (existingJob) {
          jobId = existingJob.id;
        } else {
          const jobRef = await addDoc(collection(db, 'jobs'), {
            jobName: trimmedJob,
            isDeleted: false,
            createdAt: serverTimestamp(),
            createdBy: user.name || user.email,
          });
          jobId = jobRef.id;
        }
      }

      const bom = resolvedBom.map(r => r.matched
        ? { skuId: r.matched.id, sku: r.matched.sku, qty: r.qty, pulled: false }
        : { skuId: null, sku: r.skuName, qty: r.qty, pulled: false, nonInventory: true }
      );

      const prodRef = await addDoc(collection(db, 'products'), {
        productName: productName.trim(),
        catalogId: catalogId.trim() || null,
        description: null,
        location,
        jobId,
        jobName: trimmedJob || null,
        bom,
        status: 'pending',
        isDeleted: false,
        createdAt: serverTimestamp(),
        createdBy: user.name || user.email,
      });

      // Also write to product library
      await addDoc(collection(db, 'productLibrary'), {
        productName: productName.trim(),
        catalogId: catalogId.trim() || null,
        bom: bom.map(b => ({ skuId: b.skuId, sku: b.sku, qty: b.qty, ...(b.nonInventory ? { nonInventory: true } : {}) })),
        isDeleted: false,
        createdAt: serverTimestamp(),
        createdBy: user.name || user.email,
      });

      await addDoc(collection(db, 'auditLog'), {
        event: 'ITEM_CREATED',
        skuId: null, sku: null, location,
        userId: user.uid, userName: user.name || user.email,
        oldValue: null, newValue: productName.trim(),
        reason: `Product created via CSV: ${productName.trim()} (${bom.length} SKUs)`,
        relatedId: prodRef.id, timestamp: serverTimestamp(),
      });

      onClose();
    } catch {
      setError('Failed to create product. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold" style={{ color: '#2D5016' }}>
            {step === 1 ? 'Upload Product CSV' : 'Complete Product Setup'}
          </h2>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          {step === 1 ? (
            <>
              <p className="text-sm text-gray-600">
                Upload a CSV with columns: <span className="font-medium">SKU, QTY</span>
                <br />
                <span className="text-xs text-gray-400">Optional: Catalogue ID, Product Name</span>
              </p>
              <button onClick={() => fileRef.current?.click()}
                className="w-full min-h-[120px] border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-gray-400 transition-colors">
                <Upload size={28} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Tap to select CSV file</span>
              </button>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
              {parseError && <p className="text-red-600 text-sm">{parseError}</p>}
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Product Name <span className="text-red-500">*</span></label>
                <input value={productName} onChange={e => setProductName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                  placeholder="e.g., Custom Arbor Kit" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Catalogue ID <span className="text-red-500">*</span></label>
                <input value={catalogId} onChange={e => setCatalogId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                  placeholder="e.g., ARB-001" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Location <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  {['farm', 'mke'].map(loc => (
                    <button key={loc} onClick={() => setLocation(loc)}
                      className={`flex-1 min-h-[44px] rounded-lg border text-sm font-medium transition-colors ${
                        location === loc ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                      style={location === loc ? { backgroundColor: '#4CB31D' } : {}}>
                      {locLabel(loc)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <label className="text-xs font-medium text-gray-500 mb-1 block">Job Name <span className="text-red-500">*</span></label>
                <input value={jobName} onChange={e => setJobName(e.target.value)}
                  onFocus={() => setJobSearchFocused(true)}
                  onBlur={() => setTimeout(() => setJobSearchFocused(false), 200)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grg-sage min-h-[44px]"
                  placeholder="Type to search or create new…" />
                {jobSuggestions.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {jobSuggestions.map(j => (
                      <button key={j.id} onClick={() => { setJobName(j.jobName); setJobSearchFocused(false); }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
                        {j.jobName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">
                  Materials Preview ({resolvedBom.length} rows)
                </p>
                <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                  {resolvedBom.map((item, idx) => (
                    <div key={idx}
                      className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm ${
                        !item.matched ? 'bg-gray-50 border border-gray-200' :
                        item.outOfStock ? 'bg-red-50 border border-red-200' :
                        'bg-gray-50'
                      }`}>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate ${item.outOfStock ? 'text-red-600' : 'text-gray-800'}`}>
                          {item.matched ? item.matched.sku : item.skuName}
                        </p>
                        {!item.matched && (
                          <p className="text-xs text-gray-500">Non-inventory item — included for reference</p>
                        )}
                        {item.outOfStock && (
                          <p className="text-xs text-red-600">Low stock ({item.stock} on hand)</p>
                        )}
                      </div>
                      <span className="text-xs font-bold text-gray-600 ml-2">x{item.qty}</span>
                    </div>
                  ))}
                </div>
                {resolvedBom.some(r => !r.matched) && (
                  <p className="text-xs text-gray-500 mt-2">
                    {resolvedBom.filter(r => r.matched).length} of {resolvedBom.length} items are tracked inventory. Non-inventory items included for reference.
                  </p>
                )}
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}
            </>
          )}
        </div>

        {step === 2 && (
          <div className="flex gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
            <button onClick={() => { setStep(1); setCsvRows([]); }}
              className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Back
            </button>
            <button onClick={handleCreate} disabled={saving || resolvedBom.length === 0}
              className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#4CB31D' }}>
              {saving ? 'Creating…' : 'Create Product'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ADD MATERIAL POPUP (for detail view) ────────────────────────────────────
function AddMaterialPopup({ skus, existingBom, onAdd, onClose }) {
  const [search, setSearch] = useState('');
  const results = useMemo(() => {
    if (!search.trim()) return [];
    return smartSearch(skus, search, ['sku', 'category'])
      .filter(s => !existingBom.some(b => b.skuId === s.id))
      .slice(0, 8);
  }, [skus, search, existingBom]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold" style={{ color: '#2D5016' }}>Add Material</h3>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={20} />
          </button>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search SKU…" />
        {results.length > 0 && (
          <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden shadow-sm max-h-[300px] overflow-y-auto">
            {results.map(sku => (
              <button key={sku.id} onClick={() => { onAdd(sku); onClose(); }}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors">
                <span className="font-medium text-gray-800">{sku.sku}</span>
                <span className="text-xs text-gray-400">{sku.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PRODUCT DETAIL VIEW ──────────────────────────────────────────────────────
function ProductDetailView({ productId, inventory, skus, user, onBack }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [completeTarget, setCompleteTarget] = useState(false);
  const [completeSaving, setCompleteSaving] = useState(false);
  const [undoTarget, setUndoTarget] = useState(null);
  const [undoSaving, setUndoSaving] = useState(false);
  const [pullQtys, setPullQtys] = useState({});
  const [shortfallInfo, setShortfallInfo] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    return onSnapshot(doc(db, 'products', productId),
      snap => {
        if (snap.exists()) {
          const data = snap.data();
          setProduct({
            id: snap.id,
            ...data,
            status: data.status ?? 'pending',
            bom: (data.bom ?? []).map(b => ({ ...b, pulled: b.pulled ?? false })),
          });
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [productId]);

  const bom = product?.bom ?? [];
  const location = product?.location ?? 'farm';
  const inventoryBom = bom.filter(b => !b.nonInventory);
  const allPulled = inventoryBom.length > 0 && inventoryBom.every(b => b.pulled);
  const anyChecked = checked.size > 0;

  const getStock = (skuId) => {
    const invDoc = inventory.find(i => i.id === `${skuId}_${location}`);
    return invDoc?.quantity ?? 0;
  };

  const getPullQty = (skuId, defaultQty) => pullQtys[skuId] ?? defaultQty;
  const setPullQty = (skuId, qty) => setPullQtys(prev => ({ ...prev, [skuId]: Math.max(0, qty) }));

  // Pre-check stock before pulling — show shortfall warning if needed
  const handlePullClick = () => {
    if (checked.size === 0) return;
    const checkedItems = bom.filter(b => checked.has(b.skuId) && !b.pulled && !b.nonInventory);
    const itemsWithStock = checkedItems.map(b => {
      const requestedQty = getPullQty(b.skuId, b.shortQty ?? b.qty);
      const stock = getStock(b.skuId);
      const actualPull = Math.min(requestedQty, stock);
      const short = requestedQty - actualPull;
      return { ...b, requestedQty, stock, actualPull, short };
    });

    const hasShortfall = itemsWithStock.some(i => i.short > 0);
    const allZeroStock = itemsWithStock.every(i => i.actualPull === 0);

    if (allZeroStock) {
      setShortfallInfo({ items: itemsWithStock, allZero: true });
      return;
    }
    if (hasShortfall) {
      setShortfallInfo({ items: itemsWithStock, allZero: false });
      return;
    }
    // All sufficient — pull directly
    handleSubmitPull(itemsWithStock);
  };

  const handleSubmitPull = async (preCalculatedItems) => {
    if (!preCalculatedItems || preCalculatedItems.length === 0) return;
    setSaving(true);
    setShortfallInfo(null);
    try {
      const pullNumber = await generateRecordNumber('pulls');

      for (const item of preCalculatedItems) {
        if (item.actualPull > 0) {
          await adjustInventory({
            skuId: item.skuId, sku: item.sku,
            location, delta: -item.actualPull,
            reason: `Material pull: ${pullNumber}`,
            relatedId: product.id,
            userId: user.uid, userName: user.name || user.email,
          });
        }
      }

      // Build a lookup from pre-calculated items
      const pullLookup = {};
      for (const item of preCalculatedItems) {
        pullLookup[item.skuId] = item;
      }

      // Update BOM with pull metadata
      const now = new Date().toISOString();
      const pulledByName = user.name || user.email;
      const updatedBom = bom.map(b => {
        const calc = pullLookup[b.skuId];
        if (!calc) return b;
        const prevPulled = b.pulledQty ?? 0;
        const totalPulled = prevPulled + calc.actualPull;
        const fullyPulled = totalPulled >= b.qty;
        const result = {
          ...b,
          pulledQty: totalPulled,
          pulledAt: now,
          pulledBy: pulledByName,
        };
        if (fullyPulled) {
          result.pulled = true;
          delete result.shortQty;
        } else {
          result.pulled = false;
          result.shortQty = b.qty - totalPulled;
        }
        return result;
      });
      const newAllPulled = updatedBom.filter(b => !b.nonInventory).every(b => b.pulled);

      await updateDoc(doc(db, 'products', product.id), {
        bom: updatedBom,
        status: newAllPulled ? 'pulled' : 'pending',
      });

      // Write pull record
      await addDoc(collection(db, 'pulls'), {
        pullNumber,
        productId: product.id,
        productName: product.productName,
        location,
        jobId: product.jobId || null,
        items: preCalculatedItems.map(i => ({
          skuId: i.skuId, sku: i.sku,
          qty: i.actualPull, originalQty: i.requestedQty,
          ...(i.short > 0 ? { shortQty: i.short } : {}),
          type: (i.pulledQty ?? 0) > 0 ? 'remainder' : i.short > 0 ? 'partial' : 'full',
        })),
        notes: '',
        pulledBy: user.name || user.email,
        pulledByUid: user.uid,
        pulledAt: serverTimestamp(),
        isDeleted: false,
      });

      await addDoc(collection(db, 'auditLog'), {
        event: 'PRODUCT_PULLED',
        skuId: null, sku: null, location,
        userId: user.uid, userName: user.name || user.email,
        oldValue: null, newValue: pullNumber,
        reason: `Material pull: ${product.productName} from ${locLabel(location)} (${preCalculatedItems.length} SKU${preCalculatedItems.length !== 1 ? 's' : ''})`,
        relatedId: product.id, timestamp: serverTimestamp(),
      });

      setChecked(new Set());
      setPullQtys({});
    } catch {
      setActionError('Failed to pull materials. Please try again.');
    }
    setSaving(false);
  };

  const handleUndoPull = async (bomItem) => {
    setUndoSaving(true);
    try {
      const restoredQty = bomItem.pulledQty ?? bomItem.qty;
      await adjustInventory({
        skuId: bomItem.skuId, sku: bomItem.sku,
        location, delta: restoredQty,
        reason: `Pull undone: ${product.productName}`,
        relatedId: product.id,
        userId: user.uid, userName: user.name || user.email,
      });

      const updatedBom = bom.map(b => {
        if (b.skuId !== bomItem.skuId) return b;
        const { pulledQty, pulledAt, pulledBy, shortQty, ...rest } = b;
        return { ...rest, pulled: false };
      });

      await updateDoc(doc(db, 'products', product.id), {
        bom: updatedBom,
        status: 'pending',
      });

      await addDoc(collection(db, 'auditLog'), {
        event: 'PULL_UNDONE',
        skuId: bomItem.skuId, sku: bomItem.sku, location,
        userId: user.uid, userName: user.name || user.email,
        oldValue: null, newValue: null,
        reason: `Pull undone: ${bomItem.sku} for ${product.productName}`,
        relatedId: product.id, timestamp: serverTimestamp(),
      });
    } catch {
      setActionError('Failed to undo pull. Please try again.');
    }
    setUndoTarget(null);
    setUndoSaving(false);
  };

  const handleDelete = async () => {
    setDeleteSaving(true);
    try {
      // Restore inventory for any pulled or partially pulled items (skip non-inventory)
      for (const item of bom.filter(b => (b.pulled || b.pulledQty > 0) && !b.nonInventory)) {
        await adjustInventory({
          skuId: item.skuId, sku: item.sku,
          location, delta: item.pulledQty ?? item.qty,
          reason: `Product deleted — inventory restored: ${product.productName}`,
          relatedId: product.id,
          userId: user.uid, userName: user.name || user.email,
        });
      }
      await softDelete('products', product.id, user.uid, user.name || user.email);
      onBack();
    } catch {
      setDeleteSaving(false);
      setDeleteTarget(false);
    }
  };

  const handleComplete = async () => {
    setCompleteSaving(true);
    try {
      await updateDoc(doc(db, 'products', product.id), {
        status: 'complete',
        completedAt: serverTimestamp(),
        completedBy: user.name || user.email,
      });
      await addDoc(collection(db, 'auditLog'), {
        event: 'PRODUCT_COMPLETED',
        skuId: null, sku: null, location,
        userId: user.uid, userName: user.name || user.email,
        oldValue: product.status, newValue: 'complete',
        reason: `Product completed: ${product.productName}`,
        relatedId: product.id, timestamp: serverTimestamp(),
      });
      triggerNotification(
        NOTIFICATION_EVENTS.PRODUCT_COMPLETE,
        `Product Complete — ${product.productName}`,
        `Product "${product.productName}" has been marked complete.\n\nLocation: ${locLabel(location)}\nCompleted by: ${user.name || user.email}`,
      );
      onBack();
    } catch {
      setCompleteSaving(false);
      setCompleteTarget(false);
    }
  };

  const handleAddMaterial = async (sku) => {
    const updatedBom = [...bom, { skuId: sku.id, sku: sku.sku, qty: 1, pulled: false }];
    await updateDoc(doc(db, 'products', product.id), { bom: updatedBom });
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-white">
        <Spinner />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-white">
        <div className="sticky top-0 z-20 bg-white border-b border-gray-200 flex items-center gap-3 px-4 py-3">
          <button onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100">
            <ArrowLeft size={22} />
          </button>
          <h2 className="text-lg font-bold" style={{ color: '#2D5016' }}>Product Not Found</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {actionError && (
        <div className="mx-4 mt-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 text-red-500 hover:text-red-700"><X size={16} /></button>
        </div>
      )}
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold truncate" style={{ color: '#2D5016' }}>{product.productName}</h2>
              <StatusBadge status={product.status} />
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {product.catalogId && <span>{product.catalogId} · </span>}
              {locLabel(location)}
              {product.jobName && <span> · {product.jobName}</span>}
            </p>
          </div>
          <button onClick={() => setDeleteTarget(true)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-red-400 hover:text-red-600 hover:bg-red-50">
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      {/* Materials list */}
      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Materials ({bom.length})
          </p>
          <button onClick={() => setShowAddMaterial(true)}
            className="flex items-center gap-1 text-xs font-semibold px-3 min-h-[36px] rounded-lg text-white"
            style={{ backgroundColor: '#4CB31D' }}>
            <Plus size={14} /> Add Material
          </button>
        </div>

        {bom.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-gray-400 text-sm italic">No materials in BOM. Tap Add Material to start.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {bom.flatMap((item, idx) => {
              const isNonInventory = item.nonInventory;
              const stock = isNonInventory ? null : getStock(item.skuId);
              const isPulled = item.pulled;
              const isPartial = !item.pulled && (item.pulledQty ?? 0) > 0;
              const isChecked = checked.has(item.skuId);
              const defaultQty = isPartial ? (item.shortQty ?? item.qty) : item.qty;
              const rowBg = idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white';

              // Partial items render TWO rows: pulled portion + remainder
              if (isPartial) {
                return [
                  // Row 1: Pulled portion with Partial badge + undo
                  <div key={`${item.skuId}-partial`}
                    className={`flex items-center gap-3 px-4 py-3 min-h-[60px] border-b border-gray-100 ${rowBg}`}>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <StatusBadge status="partial" />
                      <button onClick={() => setUndoTarget(item)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-red-500 rounded"
                        title="Undo pull">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-gray-800">{item.sku}</p>
                      <p className="text-xs text-gray-400">
                        {`Pulled: ${item.pulledQty} of ${item.qty}`}
                        {item.pulledBy && (
                          <span> · {item.pulledBy}{item.pulledAt ? ` ${new Date(item.pulledAt).toLocaleDateString()}` : ''}</span>
                        )}
                      </p>
                    </div>
                  </div>,
                  // Row 2: Remainder with checkbox + qty stepper
                  <div key={`${item.skuId}-remainder`}
                    className={`flex items-center gap-3 px-4 py-2.5 min-h-[52px] border-b border-gray-100 ${rowBg}`}
                    style={{ borderLeft: '3px solid #F59E0B' }}>
                    <button
                      onClick={() => setChecked(prev => {
                        const next = new Set(prev);
                        if (next.has(item.skuId)) next.delete(item.skuId);
                        else next.add(item.skuId);
                        return next;
                      })}
                      className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border-2 transition-colors flex-shrink-0 ${
                        isChecked ? 'border-[#4CB31D] bg-[#4CB31D]' : 'border-gray-300 bg-white hover:border-gray-400'
                      }`}>
                      {isChecked && <Check size={16} className="text-white" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: '#92400E' }}>
                        Remainder: {item.shortQty} of {item.sku}
                      </p>
                      <p className="text-xs text-gray-400">
                        {`Stock: ${stock}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setPullQty(item.skuId, getPullQty(item.skuId, defaultQty) - 1)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm">
                        −
                      </button>
                      <span className="min-w-[28px] text-center text-sm font-semibold text-gray-800">
                        {getPullQty(item.skuId, defaultQty)}
                      </span>
                      <button
                        onClick={() => setPullQty(item.skuId, getPullQty(item.skuId, defaultQty) + 1)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm">
                        +
                      </button>
                    </div>
                  </div>,
                ];
              }

              // Normal single row for all other item types
              return (
                <div key={item.skuId || `non-inv-${idx}`}
                  className={`flex items-center gap-3 px-4 py-3 min-h-[60px] border-b border-gray-100 ${rowBg}`}>

                  {isNonInventory ? (
                    <div className="min-h-[36px] min-w-[36px] flex items-center justify-center flex-shrink-0 text-gray-300">
                      —
                    </div>
                  ) : isPulled ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <StatusBadge status="pulled" />
                      <button onClick={() => setUndoTarget(item)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-red-500 rounded"
                        title="Undo pull">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setChecked(prev => {
                        const next = new Set(prev);
                        if (next.has(item.skuId)) next.delete(item.skuId);
                        else next.add(item.skuId);
                        return next;
                      })}
                      className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border-2 transition-colors flex-shrink-0 ${
                        isChecked ? 'border-[#4CB31D] bg-[#4CB31D]' : 'border-gray-300 bg-white hover:border-gray-400'
                      }`}>
                      {isChecked && <Check size={16} className="text-white" />}
                    </button>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isNonInventory ? 'text-gray-400 italic' : 'text-gray-800'}`}>{item.sku}</p>
                    <p className="text-xs text-gray-400">
                      {isNonInventory
                        ? `Qty: ${item.qty} · Non-inventory`
                        : isPulled
                          ? `Pulled: ${item.pulledQty ?? item.qty} of ${item.qty} · Stock: ${stock}`
                          : `Need: ${item.qty} · Stock: ${stock}`}
                      {isPulled && item.pulledBy && (
                        <span> · {item.pulledBy}{item.pulledAt ? ` ${new Date(item.pulledAt).toLocaleDateString()}` : ''}</span>
                      )}
                    </p>
                  </div>

                  {!isNonInventory && !isPulled && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setPullQty(item.skuId, getPullQty(item.skuId, defaultQty) - 1)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm">
                        −
                      </button>
                      <span className="min-w-[28px] text-center text-sm font-semibold text-gray-800">
                        {getPullQty(item.skuId, defaultQty)}
                      </span>
                      <button
                        onClick={() => setPullQty(item.skuId, getPullQty(item.skuId, defaultQty) + 1)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm">
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3 flex flex-col gap-2">
        {product.status !== 'complete' && (
          <button onClick={() => setCompleteTarget(true)}
            className="w-full min-h-[48px] rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#065F46' }}>
            Mark Product Complete
          </button>
        )}
        <div className="flex gap-3">
          {anyChecked ? (
            <button onClick={handlePullClick} disabled={saving}
              className="flex-1 min-h-[48px] rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#4CB31D' }}>
              {saving ? 'Pulling…' : `Submit Pulled (${checked.size})`}
            </button>
          ) : (
            <div className="flex-1 min-h-[48px] flex items-center justify-center text-sm text-gray-400">
              {bom.length > 0 ? 'Check materials to pull' : 'Add materials to get started'}
            </div>
          )}
        </div>
      </div>

      {/* Popups */}
      {showAddMaterial && (
        <AddMaterialPopup
          skus={skus}
          existingBom={bom}
          onAdd={handleAddMaterial}
          onClose={() => setShowAddMaterial(false)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget}
        title="Delete Product?"
        message={`"${product.productName}" will be deleted.${
          bom.some(b => b.pulled || b.pulledQty > 0) ? ' Pulled inventory will be restored.' : ''
        }`}
        confirmLabel={deleteSaving ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        destructive
        saving={deleteSaving}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(false)}
      />

      <ConfirmDialog
        open={completeTarget}
        title="Mark Complete?"
        message={`Mark "${product.productName}" as complete?${
          !allPulled ? ' Note: not all materials have been pulled.' : ''
        }`}
        confirmLabel={completeSaving ? 'Completing…' : 'Complete'}
        cancelLabel="Cancel"
        saving={completeSaving}
        onConfirm={handleComplete}
        onCancel={() => setCompleteTarget(false)}
      />

      <ConfirmDialog
        open={!!undoTarget}
        title="Undo Pull?"
        message={`"${undoTarget?.sku}" (×${undoTarget?.pulledQty ?? undoTarget?.qty}) will be returned to ${locLabel(location)} inventory.`}
        confirmLabel={undoSaving ? 'Undoing…' : 'Undo'}
        cancelLabel="Cancel"
        destructive
        saving={undoSaving}
        onConfirm={() => handleUndoPull(undoTarget)}
        onCancel={() => setUndoTarget(null)}
      />

      {/* Shortfall Warning Dialog */}
      {shortfallInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShortfallInfo(null)}>
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col max-h-[80dvh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
                <h3 className="text-base font-semibold text-gray-800">
                  {shortfallInfo.allZero ? 'No Stock Available' : 'Insufficient Stock'}
                </h3>
              </div>
              <button onClick={() => setShortfallInfo(null)} aria-label="Close"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg">
                <X size={22} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4">
              <p className="text-sm text-gray-600 mb-3">
                {shortfallInfo.allZero
                  ? 'None of the selected items have stock available to pull.'
                  : 'Some items have less stock than requested:'}
              </p>
              <div className="flex flex-col gap-2">
                {shortfallInfo.items.map(item => (
                  <div key={item.skuId} className={`px-3 py-2 rounded-lg text-sm ${
                    item.actualPull === 0 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'
                  }`}>
                    <p className="font-medium text-gray-800">{item.sku}</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {item.actualPull === 0
                        ? `Need ${item.requestedQty} — Cannot pull (no stock)`
                        : item.short > 0
                          ? `Need ${item.requestedQty}, Stock ${item.stock} — Will pull ${item.actualPull} (short ${item.short})`
                          : `Need ${item.requestedQty}, Stock ${item.stock} — OK`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setShortfallInfo(null)}
                className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              {!shortfallInfo.allZero && (
                <button onClick={() => handleSubmitPull(shortfallInfo.items)}
                  className="flex-1 min-h-[44px] rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: '#D97706' }}>
                  Pull Available
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PRODUCT LIST VIEW ────────────────────────────────────────────────────────
function ProductListView({ products, skus, inventory, user, jobs, onSelectProduct, onShowCompleted }) {
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  // Filter out completed products
  const activeProducts = useMemo(() =>
    products.filter(p => (p.status ?? 'pending') !== 'complete'),
    [products]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return activeProducts;
    return smartSearch(activeProducts, search, ['productName', 'description', 'jobName', 'catalogId']);
  }, [activeProducts, search]);

  const getStatus = (product) => {
    const bom = (product.bom ?? []).map(b => ({ ...b, pulled: b.pulled ?? false }));
    if (product.status === 'complete') return 'complete';
    if (product.status === 'pulled') return 'pulled';
    if (bom.length > 0 && bom.every(b => b.pulled)) return 'pulled';
    return 'pending';
  };

  return (
    <>
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 pt-3 pb-3 space-y-2">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onShowCompleted}
            className="min-h-[44px] px-3 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            Completed
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-white text-sm font-semibold"
            style={{ backgroundColor: '#4CB31D' }}
          >
            <Plus size={18} /> New
          </button>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search products…" />
      </div>

      {/* Product list */}
      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {search ? `No products match "${search}"` : 'No active products. Tap New to create one.'}
            </p>
          </div>
        ) : filtered.map((product, idx) => {
          const status = getStatus(product);
          return (
            <button
              key={product.id}
              onClick={() => onSelectProduct(product.id)}
              className={`w-full text-left flex items-center px-4 py-3 min-h-[60px] gap-3 border-b border-gray-100 transition-colors hover:bg-gray-50 ${
                idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate" style={{ color: '#2D5016' }}>{product.productName}</p>
                  <StatusBadge status={status} />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {product.catalogId && <span>{product.catalogId} · </span>}
                  {product.bom?.length ?? 0} SKU{(product.bom?.length ?? 0) !== 1 ? 's' : ''}
                  {product.jobName && <span> · {product.jobName}</span>}
                  {product.location && <span> · {locLabel(product.location)}</span>}
                </p>
              </div>
              <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
            </button>
          );
        })}
      </div>

      {showNew && <CSVUploadPopup skus={skus} inventory={inventory} user={user} jobs={jobs} onClose={() => setShowNew(false)} />}
    </>
  );
}

// ─── COMPLETED PRODUCTS VIEW ─────────────────────────────────────────────────
function CompletedProductsView({ products, onBack }) {
  const [search, setSearch] = useState('');

  const completedProducts = useMemo(() =>
    products.filter(p => p.status === 'complete'),
    [products]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return completedProducts;
    return smartSearch(completedProducts, search, ['productName', 'jobName', 'catalogId']);
  }, [completedProducts, search]);

  return (
    <>
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 pt-3 pb-3 space-y-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2">
            <ArrowLeft size={20} style={{ color: '#2D5016' }} />
          </button>
          <h1 className="text-xl font-bold" style={{ color: '#2D5016' }}>Completed Products</h1>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search completed products…" />
      </div>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {search ? `No completed products match "${search}"` : 'No completed products yet.'}
            </p>
          </div>
        ) : filtered.map((product, idx) => {
          const bom = product.bom ?? [];
          const completedDate = product.completedAt?.toDate ? product.completedAt.toDate().toLocaleDateString() : product.completedAt ? new Date(product.completedAt).toLocaleDateString() : '—';
          return (
            <div
              key={product.id}
              className={`w-full text-left px-4 py-3 min-h-[60px] border-b border-gray-100 ${
                idx % 2 === 1 ? 'bg-[#F0F0E8]/20' : 'bg-white'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold truncate" style={{ color: '#2D5016' }}>{product.productName}</p>
                <StatusBadge status="complete" />
              </div>
              <p className="text-xs text-gray-400">
                {product.catalogId && <span>{product.catalogId} · </span>}
                {bom.length} SKU{bom.length !== 1 ? 's' : ''}
                {product.jobName && <span> · {product.jobName}</span>}
                {product.location && <span> · {locLabel(product.location)}</span>}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Completed: {completedDate}{product.completedBy ? ` by ${product.completedBy}` : ''}
              </p>
              {/* Show pulled details */}
              <div className="mt-2 space-y-0.5">
                {bom.map((item, i) => (
                  <p key={i} className="text-xs text-gray-400">
                    {item.sku} x{item.qty}
                    {item.nonInventory ? ' (non-inventory)' : ''}
                    {item.pulledBy ? ` — pulled by ${item.pulledBy}${item.pulledAt ? ` on ${new Date(item.pulledAt).toLocaleDateString()}` : ''}` : ''}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── PRODUCTS PAGE ───────────────────────────────────────────────────────────
export default function ProductsPage() {
  const { user } = useAuth();
  const { skus, inventory } = useInventory();
  const [products, setProducts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [view, setView] = useState('list'); // 'list' | 'detail' | 'completed'
  const [selectedProductId, setSelectedProductId] = useState(null);

  useEffect(() => {
    const qProducts = query(
      collection(db, 'products'),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc')
    );
    const unsub1 = onSnapshot(qProducts,
      snap => { setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); setListError(''); },
      (err) => { console.error('Products query error:', err); setLoading(false); setListError('Failed to load products. Check your connection.'); }
    );

    const qJobs = query(collection(db, 'jobs'), where('isDeleted', '==', false), orderBy('jobName'));
    const unsub2 = onSnapshot(qJobs,
      snap => { setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      (err) => { console.error('Jobs query error:', err); setListError('Failed to load jobs. Check your connection.'); }
    );

    return () => { unsub1(); unsub2(); };
  }, []);

  const handleSelectProduct = (productId) => {
    setSelectedProductId(productId);
    setView('detail');
  };

  const handleBack = () => {
    setView('list');
    setSelectedProductId(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-white">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {listError && (
        <div className="mx-4 mt-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{listError}</div>
      )}
      {view === 'detail' && selectedProductId ? (
        <ProductDetailView
          productId={selectedProductId}
          inventory={inventory}
          skus={skus}
          user={user}
          onBack={handleBack}
        />
      ) : view === 'completed' ? (
        <CompletedProductsView
          products={products}
          onBack={handleBack}
        />
      ) : (
        <ProductListView
          products={products}
          skus={skus}
          inventory={inventory}
          user={user}
          jobs={jobs}
          onSelectProduct={handleSelectProduct}
          onShowCompleted={() => setView('completed')}
        />
      )}
    </div>
  );
}
