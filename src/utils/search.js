// Smart search — case insensitive, partial match, multi-token
// Each word in the query must appear somewhere across the searched fields.
// Usage: smartSearch(items, query, ['sku', 'category'])
export function smartSearch(items, query, fields) {
  if (!query || query.trim() === '') return items;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    // Combine all searchable field values into one string
    const blob = fields
      .map(field => String(item[field] ?? '').toLowerCase())
      .join(' ');
    // Every token must appear somewhere in the combined text
    return tokens.every(token => blob.includes(token));
  });
}
