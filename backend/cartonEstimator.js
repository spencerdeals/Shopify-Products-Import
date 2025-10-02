const OCEAN_RATE_PER_FT3 = 7;
const MULTIPLIER_MIN = 1.7;
const MULTIPLIER_MAX = 2.5;
const MULTIPLIER_FALLBACK = 1.95;

function detectBrand(product) {
  if (!product) return null;

  const brand = (product.brand || '').toLowerCase();
  const name = (product.name || '').toLowerCase();
  const url = (product.url || '').toLowerCase();
  const retailer = (product.retailer || '').toLowerCase();

  if (brand.includes('ikea') || name.includes('ikea') || url.includes('ikea') || retailer.includes('ikea')) {
    return 'IKEA';
  }

  if (url.includes('wayfair') || retailer.includes('wayfair')) {
    return 'Wayfair';
  }

  return 'Generic';
}

function detectCategory(product) {
  if (!product) return 'default';

  const text = `${product.name || ''} ${product.category || ''} ${product.breadcrumbs?.join(' ') || ''}`.toLowerCase();

  if (/\b(sectional)\b/.test(text)) return 'sectional';
  if (/\b(sofa|loveseat|outdoor seating)\b/.test(text)) return 'sofa';
  if (/\b(armchair|chair)\b/.test(text)) return 'chair';
  if (/\b(dining table|table)\b/.test(text)) return 'table';
  if (/\b(bed frame|bed)\b/.test(text)) return 'bed';

  return 'default';
}

function estimateCarton(product) {
  if (!product) {
    return {
      cubic_feet: 6.9,
      boxes: 1,
      dimensions: { length: 34, width: 22, height: 16 },
      estimation_notes: 'No product data; used generic default',
      dimension_source: 'estimated'
    };
  }

  const brand = detectBrand(product);
  const category = detectCategory(product);

  let boxes = 1;
  let dimensions = null;
  let notes = `Brand: ${brand}, Category: ${category}`;

  if (brand === 'IKEA') {
    switch (category) {
      case 'sectional':
      case 'sofa':
        boxes = 2;
        dimensions = { length: 46, width: 27, height: 12 };
        break;
      case 'chair':
        boxes = 1;
        dimensions = { length: 24, width: 24, height: 16 };
        break;
      case 'table':
        boxes = 2;
        dimensions = { length: 58, width: 32, height: 5 };
        break;
      case 'bed':
        boxes = 2;
        dimensions = { length: 80, width: 10, height: 8 };
        break;
      default:
        boxes = 1;
        dimensions = { length: 30, width: 20, height: 10 };
    }
  } else if (brand === 'Wayfair') {
    switch (category) {
      case 'sectional':
        dimensions = { length: 78, width: 32, height: 24 };
        break;
      case 'sofa':
        dimensions = { length: 72, width: 32, height: 20 };
        break;
      case 'chair':
        dimensions = { length: 32, width: 28, height: 24 };
        break;
      case 'table':
        dimensions = { length: 65, width: 38, height: 8 };
        break;
      case 'bed':
        dimensions = { length: 82, width: 12, height: 10 };
        break;
      default:
        dimensions = { length: 36, width: 24, height: 18 };
    }
  } else {
    switch (category) {
      case 'sectional':
        dimensions = { length: 76, width: 32, height: 24 };
        break;
      case 'sofa':
        dimensions = { length: 70, width: 32, height: 20 };
        break;
      case 'chair':
        dimensions = { length: 30, width: 26, height: 22 };
        break;
      case 'table':
        dimensions = { length: 60, width: 36, height: 8 };
        break;
      case 'bed':
        dimensions = { length: 80, width: 12, height: 10 };
        break;
      default:
        dimensions = { length: 34, width: 22, height: 16 };
    }
  }

  let cubic_feet = (dimensions.length * dimensions.width * dimensions.height) / 1728;

  if (boxes > 1) {
    cubic_feet *= boxes;
    notes += `; Multi-box (${boxes}x)`;
  }

  if (product.weight && cubic_feet > 0) {
    const density = product.weight / cubic_feet;

    if (density < 1) {
      dimensions.length = Math.round(dimensions.length * 1.1);
      dimensions.width = Math.round(dimensions.width * 1.1);
      dimensions.height = Math.round(dimensions.height * 1.1);
      cubic_feet = (dimensions.length * dimensions.width * dimensions.height * boxes) / 1728;
      notes += `; Adjusted for low density (${density.toFixed(2)} lb/ft³)`;
    } else if (density > 60) {
      const maxDim = Math.max(dimensions.length, dimensions.width, dimensions.height);
      if (maxDim === dimensions.length) dimensions.length = Math.round(dimensions.length * 1.15);
      else if (maxDim === dimensions.width) dimensions.width = Math.round(dimensions.width * 1.15);
      else dimensions.height = Math.round(dimensions.height * 1.15);
      cubic_feet = (dimensions.length * dimensions.width * dimensions.height * boxes) / 1728;
      notes += `; Adjusted for high density (${density.toFixed(2)} lb/ft³)`;
    }
  }

  return {
    cubic_feet: Math.round(cubic_feet * 100) / 100,
    boxes,
    dimensions,
    estimation_notes: notes,
    dimension_source: 'estimated'
  };
}

function applyMultiplierGuardrails(finalTotal, itemPrice) {
  if (!itemPrice || itemPrice <= 0) {
    return {
      adjustedTotal: finalTotal,
      multiplier_fallback_used: false,
      implied_multiplier: null,
      fallback_multiplier: null,
      multiplier_bounds: [MULTIPLIER_MIN, MULTIPLIER_MAX]
    };
  }

  const impliedMultiplier = finalTotal / itemPrice;

  if (impliedMultiplier < MULTIPLIER_MIN || impliedMultiplier > MULTIPLIER_MAX) {
    return {
      adjustedTotal: itemPrice * MULTIPLIER_FALLBACK,
      multiplier_fallback_used: true,
      implied_multiplier: impliedMultiplier,
      fallback_multiplier: MULTIPLIER_FALLBACK,
      multiplier_bounds: [MULTIPLIER_MIN, MULTIPLIER_MAX]
    };
  }

  return {
    adjustedTotal: finalTotal,
    multiplier_fallback_used: false,
    implied_multiplier: impliedMultiplier,
    fallback_multiplier: null,
    multiplier_bounds: [MULTIPLIER_MIN, MULTIPLIER_MAX]
  };
}

module.exports = {
  estimateCarton,
  applyMultiplierGuardrails,
  OCEAN_RATE_PER_FT3,
  MULTIPLIER_MIN,
  MULTIPLIER_MAX,
  MULTIPLIER_FALLBACK
};
