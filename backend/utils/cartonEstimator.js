// Minimal, deterministic box estimator used ONLY for freight cuft; NEVER touches scraped dimensions.
const IN2FT3 = 1 / 1728;

function cuft(L, W, H) {
  return Math.max(0, Number(L)) * Math.max(0, Number(W)) * Math.max(0, Number(H)) * IN2FT3;
}

function pick(p, arr) {
  const s = (p || '').toLowerCase();
  return arr.some(k => s.includes(k));
}

function estimateCarton(product = {}) {
  const title = (product.title || product.name || '').toLowerCase();
  const breadcrumbs = (Array.isArray(product.breadcrumbs) ? product.breadcrumbs.join(' ') : (product.category || '')).toLowerCase();
  const vendor = (product.vendor || product.brand?.name || product.brand || '').toLowerCase();
  const text = `${title} ${breadcrumbs}`;
  const is = (keys) => pick(text, keys);
  const isVendor = (keys) => pick(vendor, keys);

  // classify
  const sofa = is(['sofa', 'loveseat', 'sectional', 'outdoor seating', 'couch']);
  const chair = is(['chair', 'armchair']);
  const table = is(['dining table', 'table']);
  const bed = is(['bed frame', 'bed']);

  let L = 36, W = 24, H = 18, boxes = 1, note = 'generic default';
  if (isVendor(['ikea'])) {
    if (sofa) { L = 46; W = 27; H = 12; boxes = 2; note = 'IKEA sofa flat-pack x2'; }
    else if (chair) { L = 24; W = 24; H = 16; boxes = 1; note = 'IKEA chair flat-pack'; }
    else if (table) { L = 58; W = 32; H = 5; boxes = 2; note = 'IKEA table flat-pack x2'; }
    else if (bed) { L = 80; W = 10; H = 8; boxes = 2; note = 'IKEA bed frame x2'; }
    else { L = 30; W = 20; H = 10; boxes = 1; note = 'IKEA default'; }
  } else if (isVendor(['wayfair'])) {
    if (sofa) { L = 72; W = 32; H = 20; boxes = 1; note = 'Wayfair sofa conservative'; }
    else if (chair) { L = 32; W = 28; H = 24; boxes = 1; note = 'Wayfair chair'; }
    else if (table) { L = 65; W = 38; H = 8; boxes = 1; note = 'Wayfair dining table'; }
    else if (bed) { L = 82; W = 12; H = 10; boxes = 1; note = 'Wayfair bed frame'; }
    else { L = 36; W = 24; H = 18; boxes = 1; note = 'Wayfair default'; }
  } else {
    if (sofa) { L = 70; W = 32; H = 20; boxes = 1; note = 'Generic sofa'; }
    else if (chair) { L = 30; W = 26; H = 22; boxes = 1; note = 'Generic chair'; }
    else if (table) { L = 60; W = 36; H = 8; boxes = 1; note = 'Generic table'; }
    else if (bed) { L = 80; W = 12; H = 10; boxes = 1; note = 'Generic bed'; }
  }

  // optional density sanity if weight present
  const weight = Number(product.weight_lbs || product.weight || 0);
  let perBox = cuft(L, W, H), total = perBox * boxes;
  if (weight > 0 && total > 0) {
    const density = weight / total;
    if (density < 1) {
      L *= 1.10; W *= 1.10; H *= 1.10;
      perBox = cuft(L, W, H);
      total = perBox * boxes;
      note += ' | low density +10%';
    } else if (density > 60) {
      // lighten by widening largest dim
      const maxDim = Math.max(L, W, H);
      if (maxDim === L) L *= 1.15;
      else if (maxDim === W) W *= 1.15;
      else H *= 1.15;
      perBox = cuft(L, W, H);
      total = perBox * boxes;
      note += ' | high density +15% on largest dim';
    }
  }

  return {
    carton: {
      length_in: Math.round(L),
      width_in: Math.round(W),
      height_in: Math.round(H),
      boxes
    },
    cubic_feet: Number(total.toFixed(2)),
    dimension_source: 'estimated',
    estimation_notes: note
  };
}

module.exports = { estimateCarton };
