// Exact selected colour names, never the catalog's generic "Blue" group.
const normalize = value => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function isGarden23(name) {
  return /\b(?:neo )?garden(?: party)? 23\b|\bmini garden(?: party)?\b|\bgarden party mini\b/.test(normalize(name));
}

export function stockPriority(product) {
  if (!isGarden23(product.name)) return {rank: 4, label: ''};
  const colours = normalize(product.color).split(/\s*[/,;|]\s*/);
  if (colours.some(c => /^(?:bleu paradis|blue paradise|paradise blue|???|???)$/.test(c)))
    return {rank: 1, label: '??? Garden 23'};
  if (colours.some(c => /^(?:bleu zephyr|blue zephyr|zephyr blue|???|???)$/.test(c)))
    return {rank: 2, label: '??? Garden 23'};
  return {rank: 3, label: ''};
}

export function prioritizeProducts(products) {
  return [...products].sort((a, b) => stockPriority(a).rank - stockPriority(b).rank);
}

export function priorityWatchCandidates(market) {
  if (!['US', 'CA'].includes(market)) throw new Error('Unsupported priority market');
  // Observed Neo Garden 23 reference (including a canvas/leather version).
  // https://baguseek.com/hermes-new-arrivals?page=1 is discovery ONLY.
  // Its colour and stock are deliberately not copied. The exact local official
  // page must establish the SKU, actual colour and enabled purchase action.
  const sku = 'H088612CKAQ';
  return [{market, marketName: market === 'US' ? 'Herm�s USA' : 'Herm�s Canada',
    sku, name: 'Neo Garden 23 bag', color: '', price: '', watchOnly: true,
    url: `https://www.hermes.com/${market.toLowerCase()}/en/product/neo-garden-23-bag-${sku}/`}];
}
