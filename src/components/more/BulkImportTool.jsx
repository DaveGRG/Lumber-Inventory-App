import { useState, useRef } from 'react';
import { X, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { db } from '../../firebase/config';
import { doc, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const REQUIRED_COLUMNS = ['SKU', 'Category', 'Farm Par', 'MKE Par', 'Status'];

// Accept common column name variations from different spreadsheet exports
const COLUMN_ALIASES = {
  'Farm_Par_Level': 'Farm Par',
  'MKE_Par_Level': 'MKE Par',
  'Farm Par Level': 'Farm Par',
  'MKE Par Level': 'MKE Par',
  'FarmPar': 'Farm Par',
  'MKEPar': 'MKE Par',
  // Quantity columns (optional)
  'Farm Qty': 'Farm Qty',
  'Farm Quantity': 'Farm Qty',
  'Farm_Qty': 'Farm Qty',
  'FarmQty': 'Farm Qty',
  'Farm QTY': 'Farm Qty',
  'MKE Qty': 'MKE Qty',
  'MKE Quantity': 'MKE Qty',
  'MKE_Qty': 'MKE Qty',
  'MKEQty': 'MKE Qty',
  'MKE QTY': 'MKE Qty',
};

function normalizeHeader(h) {
  return COLUMN_ALIASES[h] ?? h;
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const headers = rawHeaders.map(normalizeHeader);
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

export default function BulkImportTool({ onClose }) {
  const { user } = useAuth();
  const { hiViz } = useTheme();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [importCount, setImportCount] = useState(0);

  function handleFile(e) {
    setError('');
    setPreview(null);
    setDone(false);
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const { headers, rows } = parseCSV(evt.target.result);
      const missing = REQUIRED_COLUMNS.filter(col => !headers.includes(col));
      if (missing.length > 0) {
        setError(`Missing required columns: ${missing.join(', ')}`);
        return;
      }
      setPreview({ headers, rows });
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    setError('');

    try {
      let batch = writeBatch(db);
      let opsInBatch = 0;
      let count = 0;

      for (const row of preview.rows) {
        const sku = row['SKU']?.trim();
        const category = row['Category']?.trim().toUpperCase();
        const farmPar = parseInt(row['Farm Par'], 10) || 0;
        const mkePar = parseInt(row['MKE Par'], 10) || 0;
        const rawStatus = row['Status']?.trim().toLowerCase();
        const status = (rawStatus === 'discontinued' || rawStatus === 'discontinuing') ? 'discontinued' : 'active';
        const notes = row['Notes']?.trim() ?? '';
        const farmQty = parseInt(row['Farm Qty'], 10) || 0;
        const mkeQty = parseInt(row['MKE Qty'], 10) || 0;

        if (!sku || !category) continue;

        // Use SKU name as document ID (URL-safe slug)
        const skuId = sku.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');

        // Write to skus collection
        batch.set(doc(db, 'skus', skuId), {
          sku,
          category,
          farmPar,
          mkePar,
          status,
          notes,
          createdAt: serverTimestamp(),
          createdBy: user.name ?? user.email,
          isDeleted: false,
          deletedAt: null,
        });

        // Create/update Farm inventory doc — merge to preserve inTransitQty
        batch.set(doc(db, 'inventory', `${skuId}_farm`), {
          skuId,
          sku,
          category,
          location: 'farm',
          quantity: farmQty,
          inTransitQty: 0,
        }, { merge: true });

        // Create/update MKE inventory doc — merge to preserve inTransitQty
        batch.set(doc(db, 'inventory', `${skuId}_mke`), {
          skuId,
          sku,
          category,
          location: 'mke',
          quantity: mkeQty,
          inTransitQty: 0,
        }, { merge: true });

        count++;
        opsInBatch += 3; // 3 writes per SKU

        // Firestore batch limit is 500 ops — flush and start a new batch at 450
        if (opsInBatch >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          opsInBatch = 0;
        }
      }

      if (opsInBatch > 0) await batch.commit();
      setImportCount(count);
      setDone(true);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  const base = hiViz
    ? 'bg-white text-black'
    : 'bg-white text-gray-900';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className={`relative w-full max-w-2xl rounded-2xl shadow-xl p-6 ${base}`}>
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-gray-100"
          aria-label="Close"
        >
          <X size={24} />
        </button>

        <h2 className="text-xl font-bold mb-1" style={{ color: '#2D5016' }}>Bulk Import SKUs</h2>
        <p className="text-sm text-gray-500 mb-4">
          Required: SKU, Category, Farm Par, MKE Par, Status. Optional: Farm Qty, MKE Qty, Notes.
        </p>

        {!done && (
          <>
            {/* File picker */}
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 hover:border-grg-green min-h-[44px] w-full justify-center text-gray-600 hover:text-grg-green transition mb-4"
            >
              <Upload size={20} />
              {preview ? `${preview.rows.length} rows loaded — click to replace` : 'Choose CSV file'}
            </button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />

            {error && (
              <div className="flex items-start gap-2 text-red-600 text-sm mb-4">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Preview table */}
            {preview && (
              <div className="overflow-auto max-h-64 border rounded-lg mb-4">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      {preview.headers.map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-700">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 20).map((row, i) => (
                      <tr key={i} className={i % 2 === 1 ? 'bg-[#F0F0E8]' : ''}>
                        {preview.headers.map(h => (
                          <td key={h} className="px-3 py-1.5">{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                    {preview.rows.length > 20 && (
                      <tr>
                        <td colSpan={preview.headers.length} className="px-3 py-2 text-gray-400 text-center">
                          …and {preview.rows.length - 20} more rows
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-5 py-2 min-h-[44px] rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!preview || importing}
                className="px-5 py-2 min-h-[44px] rounded-lg text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#4CB31D' }}
              >
                {importing ? 'Importing…' : `Import ${preview?.rows.length ?? 0} SKUs`}
              </button>
            </div>
          </>
        )}

        {done && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle size={48} className="text-green-600" />
            <p className="text-lg font-semibold">Import complete!</p>
            <p className="text-gray-500">{importCount} SKUs imported with Farm + MKE inventory docs created.</p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2 min-h-[44px] rounded-lg text-white font-semibold"
              style={{ backgroundColor: '#4CB31D' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
