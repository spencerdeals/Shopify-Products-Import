/**
 * Batch Product Processor
 *
 * Orchestrates the flow: Zyte → Torso → AdminCalc → CSV/Draft Order/PDF
 * Handles multiple product URLs in a single batch operation.
 */

const torso = require('../torso');
const { computePricing } = require('../utils/pricing');
const { extractDimensionsFromZyte } = require('../lib/dimensionUtils');
const { insertObservationAndReconcile } = require('../lib/dimensionReconciliation');

const ADMIN_CALC_VERSION = 'v1.0';

/**
 * Normalize Zyte product data to Torso-ready format
 */
function normalizeZyteProduct(zyteData) {
  const handle = (zyteData.name || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const breadcrumbs = Array.isArray(zyteData.breadcrumbs)
    ? zyteData.breadcrumbs
    : String(zyteData.breadcrumbs || '').split('/').map(s => s.trim()).filter(Boolean);

  const description_html = zyteData.descriptionHtml ||
    (zyteData.description ? `<p>${zyteData.description}</p>` : '');

  // Extract variant axes
  const colors = new Set();
  const sizes = new Set();

  if (zyteData.variants && Array.isArray(zyteData.variants)) {
    zyteData.variants.forEach(v => {
      if (v.color) {
        const cleaned = v.color.replace(/\s+selected$/i, '').trim();
        if (cleaned) colors.add(cleaned);
      }
      if (v.size) {
        const cleaned = v.size.replace(/\s+selected$/i, '').trim();
        if (cleaned) sizes.add(cleaned);
      }
    });
  }

  // Parse allVariants if available
  if (zyteData.allVariants && Array.isArray(zyteData.allVariants)) {
    zyteData.allVariants.forEach(v => {
      const colorMatch = v.match(/(?:Color|Colour):\s*([^,•|]+)/i);
      if (colorMatch) colors.add(colorMatch[1].trim().replace(/\s+selected$/i, ''));

      const sizeMatch = v.match(/(?:Size):\s*([^,•|]+)/i);
      if (sizeMatch) sizes.add(sizeMatch[1].trim().replace(/\s+selected$/i, ''));
    });
  }

  const typeLeaf = breadcrumbs.findLast?.(b => !/^SKU:/i.test(b)) ||
    breadcrumbs[breadcrumbs.length - 1] ||
    'Furniture';

  return {
    handle,
    title: zyteData.name,
    brand: zyteData.brand || '',
    canonical_url: zyteData.canonicalUrl || zyteData.url || '',
    breadcrumbs,
    rating: zyteData.ratingValue || zyteData.rating || null,
    reviews: zyteData.reviewCount || zyteData.reviews || null,
    description_html,
    typeLeaf,
    sku_base: zyteData.sku || '',
    images: zyteData.images || [],
    mainImage: zyteData.mainImage || zyteData.image || '',
    axes: {
      colors: Array.from(colors),
      sizes: Array.from(sizes)
    }
  };
}

/**
 * Determine variant axes and build combinations
 */
function buildVariantCombos(normalized) {
  const { colors, sizes } = normalized.axes;

  if (colors.length > 0 && sizes.length > 0) {
    // Two options: Color × Size Cartesian product
    return {
      axis: 'color+size',
      combos: colors.flatMap(c => sizes.map(s => ({ color: c, size: s })))
    };
  } else if (colors.length > 0) {
    // One option: Color only
    return {
      axis: 'color',
      combos: colors.map(c => ({ color: c }))
    };
  } else if (sizes.length > 0) {
    // One option: Size only
    return {
      axis: 'size',
      combos: sizes.map(s => ({ size: s }))
    };
  } else {
    // No variants
    return {
      axis: 'none',
      combos: [{ title: 'Default Title' }]
    };
  }
}

/**
 * Build variant SKU with suffixes
 */
function buildVariantSku(baseSku, combo) {
  if (!baseSku) return '';

  const parts = [baseSku];
  if (combo.color) {
    parts.push(combo.color.toUpperCase().replace(/[\s'"]+/g, '-'));
  }
  if (combo.size) {
    parts.push(combo.size.toUpperCase().replace(/[^A-Z0-9]+/g, '-'));
  }

  return parts.join('-');
}

/**
 * Extract packaging data from Zyte/normalized product
 */
function extractPackaging(product, combo) {
  // Check if product has dimensions
  const dims = product.dimensions || {};

  if (dims.length && dims.width && dims.height) {
    return {
      box_length_in: parseFloat(dims.length) || 24,
      box_width_in: parseFloat(dims.width) || 18,
      box_height_in: parseFloat(dims.height) || 12,
      box_weight_lb: parseFloat(product.weight) || 10,
      boxes_per_unit: 1
    };
  }

  // Default fallback dimensions
  return {
    box_length_in: 24,
    box_width_in: 18,
    box_height_in: 12,
    box_weight_lb: 10,
    boxes_per_unit: 1
  };
}

/**
 * Pick variant image based on color
 */
function pickVariantImage(images, color) {
  if (!images || images.length === 0) return null;

  // Try to match color in image URL or alt text
  if (color) {
    const colorLower = color.toLowerCase();
    const match = images.find(img => {
      const url = typeof img === 'string' ? img : img.url || '';
      return url.toLowerCase().includes(colorLower);
    });
    if (match) return typeof match === 'string' ? match : match.url;
  }

  // Return first image
  const first = images[0];
  return typeof first === 'string' ? first : first.url || first;
}

/**
 * Process a single product: Zyte → Torso → AdminCalc
 */
async function processProduct(zyteData, options = {}) {
  console.log(`\n[Batch] Processing: ${zyteData.name}`);
  console.log(`[Batch] ZYTE_KEYS: ${Object.keys(zyteData).join(', ')}`);

  const normalized = normalizeZyteProduct(zyteData);
  const { axis, combos } = buildVariantCombos(normalized);

  console.log(`[Batch] AXES: ${axis} (${combos.length} combinations)`);

  // 1. Upsert product to Torso
  await torso.upsertProduct({
    handle: normalized.handle,
    title: normalized.title,
    brand: normalized.brand,
    canonical_url: normalized.canonical_url,
    breadcrumbs: normalized.breadcrumbs,
    rating: normalized.rating,
    reviews: normalized.reviews,
    description_html: normalized.description_html
  });

  console.log(`[Batch] TORSO_UPSERT: ${normalized.handle}`);

  // 2. Upsert variants
  let imagePosition = 1;
  const variantIds = [];

  for (const combo of combos) {
    // Determine option names and values
    let option1_name, option1_value, option2_name, option2_value;

    if (axis === 'color+size') {
      option1_name = 'Color';
      option1_value = combo.color;
      option2_name = 'Size';
      option2_value = combo.size;
    } else if (axis === 'color') {
      option1_name = 'Color';
      option1_value = combo.color;
      option2_name = '';
      option2_value = '';
    } else if (axis === 'size') {
      option1_name = 'Size';
      option1_value = combo.size;
      option2_name = '';
      option2_value = '';
    } else {
      option1_name = 'Title';
      option1_value = 'Default Title';
      option2_name = '';
      option2_value = '';
    }

    const variant_sku = buildVariantSku(normalized.sku_base, combo);

    // Upsert variant
    const variant_id = await torso.upsertVariant({
      handle: normalized.handle,
      sku_base: normalized.sku_base,
      variant_sku,
      option1_name,
      option1_value,
      option2_name,
      option2_value
    });

    variantIds.push(variant_id);

    // 3. Extract and insert dimension observations
    const observations = extractDimensionsFromZyte(zyteData);

    if (observations && observations.length > 0) {
      for (const obs of observations) {
        if (obs.length && obs.width && obs.height) {
          try {
            await insertObservationAndReconcile(variant_id, obs);
            console.log(`[Batch] Inserted dimension observation for ${variant_sku}: ${obs.length}×${obs.width}×${obs.height}`);
          } catch (err) {
            console.error(`[Batch] Failed to insert observation for ${variant_sku}:`, err.message);
          }
        }
      }
    } else {
      // Fallback: Use extracted packaging directly
      const packaging = extractPackaging(zyteData, combo);
      await torso.upsertPackaging({
        variant_id,
        ...packaging,
        reconciled_source: 'zyte',
        reconciled_conf_level: zyteData.confidence || 0.80
      });
      console.log(`[Batch] Used fallback packaging for ${variant_sku}`);
    }

    // 4. Upsert media
    const imageUrl = pickVariantImage(normalized.images, combo.color) ||
      normalized.mainImage ||
      (normalized.images[0] && (typeof normalized.images[0] === 'string' ? normalized.images[0] : normalized.images[0].url));

    if (imageUrl) {
      await torso.upsertMedia({
        variant_id,
        image_url: imageUrl,
        position: imagePosition++,
        color_key: combo.color || null
      });
    }
  }

  console.log(`[Batch] Created ${variantIds.length} variants`);

  // 5. Compute AdminCalc pricing for each variant
  for (const variant_id of variantIds) {
    // Get packaging for this variant
    const packaging = await torso.getPackaging(variant_id);

    // Compute pricing using AdminCalc
    const pricingResult = computePricing({
      basePrice: zyteData.price || 100, // Base price from scraper
      dimensions: {
        length: packaging?.box_length_in || 24,
        width: packaging?.box_width_in || 18,
        height: packaging?.box_height_in || 12
      },
      weight: packaging?.box_weight_lb || 10,
      customMargin: options.customMargin || null
    });

    // 6. Upsert costing
    await torso.upsertCosting({
      variant_id,
      first_cost_usd: pricingResult.basePrice,
      duty_rate: 0.25,
      us_tax_rate: 0,
      freight_rate_per_ft3: pricingResult.freightCost / Math.max(1, pricingResult.cuft),
      fixed_fee_alloc: 0,
      landed_cost_usd: pricingResult.landedCost,
      calc_version: ADMIN_CALC_VERSION
    });

    // 7. Upsert pricing
    await torso.upsertPricing({
      variant_id,
      retail_price_usd: pricingResult.msrpRounded,
      compare_at_price_usd: null,
      card_fee_pct: 0.03,
      margin_applied_pct: pricingResult.marginPercent,
      rounding_rule: 'NEAREST_5_UP',
      admincalc_version: ADMIN_CALC_VERSION
    });

    // 8. Upsert inventory
    await torso.upsertInventory({
      variant_id,
      quantity: 0, // Default to 0
      barcode: '',
      grams: packaging?.box_weight_lb ? Math.round(packaging.box_weight_lb * 453.592) : 0
    });

    console.log(`[Batch] PRICE_LOCK: variant=${variant_id}, retail=$${pricingResult.msrpRounded.toFixed(2)}, cost=$${pricingResult.landedCost.toFixed(2)}`);
  }

  return {
    handle: normalized.handle,
    variantCount: variantIds.length
  };
}

/**
 * Process multiple products in batch
 */
async function processBatch(zyteDataArray, options = {}) {
  console.log(`\n========================================`);
  console.log(`BATCH PROCESSING: ${zyteDataArray.length} products`);
  console.log(`========================================\n`);

  const results = [];

  for (const zyteData of zyteDataArray) {
    try {
      const result = await processProduct(zyteData, options);
      results.push(result);
    } catch (error) {
      console.error(`[Batch] Error processing ${zyteData.name}:`, error);
      results.push({
        handle: zyteData.name,
        error: error.message
      });
    }
  }

  console.log(`\n[Batch] BATCH COMPLETE: ${results.length} products processed`);
  return results;
}

module.exports = {
  normalizeZyteProduct,
  buildVariantCombos,
  buildVariantSku,
  extractPackaging,
  pickVariantImage,
  processProduct,
  processBatch
};
