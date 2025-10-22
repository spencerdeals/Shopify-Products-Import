/**
 * Shopify CSV Exporter
 *
 * Builds a single Shopify-compatible CSV from Torso data for multiple products.
 * Source of truth: Torso database only (not in-memory data).
 */

const torso = require('../torso');
const { buildBodyHtml } = require('../lib/descriptionBuilder');
const { classifyCollection } = require('../lib/collectionClassifier');
const { ceilToNext5 } = require('../lib/pricingHelpers');

/**
 * Extract leaf type from breadcrumbs (skip SKU: patterns)
 */
function extractLeafType(breadcrumbs) {
  if (!breadcrumbs || breadcrumbs.length === 0) return 'Furniture';

  // Find last non-SKU breadcrumb
  for (let i = breadcrumbs.length - 1; i >= 0; i--) {
    const crumb = typeof breadcrumbs[i] === 'object' ? breadcrumbs[i].name : breadcrumbs[i];
    if (crumb && !/^SKU:/i.test(crumb)) {
      return crumb;
    }
  }

  return 'Furniture';
}

/**
 * Build tags from product data and variant
 */
function buildTags(product, variant) {
  const tags = new Set();

  // Add source tag if Wayfair
  if (product.canonical_url && product.canonical_url.includes('wayfair')) {
    tags.add('Wayfair');
  }

  // Add breadcrumbs (exclude SKU: patterns)
  if (product.breadcrumbs && Array.isArray(product.breadcrumbs)) {
    product.breadcrumbs.forEach(b => {
      const crumb = typeof b === 'object' ? b.name : b;
      if (crumb && !/^SKU:/i.test(crumb)) {
        tags.add(crumb);
      }
    });
  }

  // Add SKU tag
  if (variant.sku_base) {
    tags.add(`SKU:${variant.sku_base}`);
  }

  // Add rating/reviews
  if (product.rating) {
    tags.add(`Rating:${product.rating}`);
  }
  if (product.reviews) {
    tags.add(`Reviews:${product.reviews}`);
  }

  // Add variant-specific tags
  if (variant.option1_name === 'Color' && variant.option1_value) {
    tags.add(`Color:${variant.option1_value}`);
  }
  if (variant.option2_name === 'Size' && variant.option2_value) {
    tags.add(`Size:${variant.option2_value}`);
  }
  if (variant.option1_name === 'Size' && variant.option1_value !== 'Default Title') {
    tags.add(`Size:${variant.option1_value}`);
  }

  return Array.from(tags).sort().join(', ');
}

/**
 * Extract product category from breadcrumbs (full path)
 */
function extractProductCategory(breadcrumbs) {
  if (!breadcrumbs || breadcrumbs.length === 0) return '';

  const crumbs = typeof breadcrumbs === 'string'
    ? JSON.parse(breadcrumbs)
    : breadcrumbs;

  return crumbs
    .map(c => typeof c === 'object' ? c.name : c)
    .filter(c => c && !/^SKU:/i.test(c))
    .join(' > ');
}

/**
 * Build CSV rows for a single product from Torso
 */
async function buildProductRows(handle, options = {}) {
  const { customMargin = null } = options;

  // Get complete product data from Torso
  const product = await torso.getProductComplete(handle);
  if (!product) {
    throw new Error(`Product not found in Torso: ${handle}`);
  }

  const rows = [];
  const typeLeaf = extractLeafType(product.breadcrumbs);
  const productCategory = extractProductCategory(product.breadcrumbs);

  // Build enhanced Body (HTML) using descriptionBuilder
  const bodyHtmlEnhanced = buildBodyHtml(
    {
      name: product.title,
      description: product.description_html,
      descriptionHtml: product.description_html,
      features: null, // These would come from scraper if stored
      additionalProperties: null
    },
    {
      sourceUrl: product.canonical_url,
      domain: product.canonical_url ? new URL(product.canonical_url).hostname.replace('www.', '') : null
    }
  );

  // Classify collection
  const collectionData = classifyCollection({
    title: product.title,
    vendor: product.brand,
    category: productCategory,
    type: typeLeaf,
    tags: product.breadcrumbs ? product.breadcrumbs.join(' ') : '',
    breadcrumbs: product.breadcrumbs
  });

  // Process each variant
  product.variants.forEach((variant, idx) => {
    // Validation: must have pricing and costing
    if (!variant.pricing || !variant.costing) {
      console.warn(`[CSV] Variant ${variant.variant_sku} missing pricing or costing data`);
      return;
    }

    const tags = buildTags(product, variant);

    // Get image from media
    const imageUrl = variant.media && variant.media.length > 0
      ? variant.media[0].image_url
      : '';

    const imagePosition = idx + 1;

    // Calculate final price with rounding
    const landedCost = variant.costing.landed_cost_usd;
    const marginPercent = customMargin || 40; // Default 40% margin
    const rawRetailPrice = landedCost * (1 + marginPercent / 100);
    const retailPrice = ceilToNext5(rawRetailPrice);

    // Build CSV row with new columns
    rows.push([
      handle,                                          // Handle
      product.title,                                   // Title
      bodyHtmlEnhanced,                                // Body (HTML) - enhanced
      product.brand || 'SDL',                          // Vendor
      productCategory,                                 // Product Category - NEW
      typeLeaf,                                        // Type
      tags,                                            // Tags
      'TRUE',                                          // Published
      variant.option1_name || 'Title',                 // Option1 Name
      variant.option1_value || 'Default Title',        // Option1 Value
      variant.option2_name || '',                      // Option2 Name
      variant.option2_value || '',                     // Option2 Value
      variant.variant_sku,                             // Variant SKU
      variant.inventory?.grams || 0,                   // Variant Grams
      'shopify',                                       // Variant Inventory Tracker
      variant.inventory?.quantity || 0,                // Variant Inventory Qty
      'deny',                                          // Variant Inventory Policy
      'manual',                                        // Variant Fulfillment Service
      retailPrice,                                     // Variant Price - rounded to next $5
      variant.pricing.compare_at_price_usd || '',      // Variant Compare At Price
      'TRUE',                                          // Variant Requires Shipping
      'TRUE',                                          // Variant Taxable
      variant.inventory?.barcode || '',                // Variant Barcode
      landedCost,                                      // Cost per item - landed cost
      imageUrl,                                        // Image Src
      imagePosition.toString(),                        // Image Position
      'FALSE',                                         // Gift Card
      'active',                                        // Status
      collectionData.collection,                       // Collection - NEW
      collectionData.unsure ? 'TRUE' : 'FALSE'         // Collection_Unsure - NEW
    ]);
  });

  return rows;
}

/**
 * Export batch of products to single Shopify CSV
 */
async function exportBatchCSV(handles, options = {}) {
  console.log(`\n[CSV] Building Shopify CSV for ${handles.length} products`);

  const headers = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value',
    'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty',
    'Variant Inventory Policy', 'Variant Fulfillment Service',
    'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping', 'Variant Taxable',
    'Variant Barcode', 'Cost per item',
    'Image Src', 'Image Position', 'Gift Card', 'Status',
    'Collection', 'Collection_Unsure'
  ];

  const allRows = [headers];
  const validationErrors = [];

  // Build rows for each product
  for (const handle of handles) {
    try {
      const productRows = await buildProductRows(handle, options);

      // Validate each row
      productRows.forEach((row, idx) => {
        const bodyHtml = row[2];      // Body (HTML)
        const variantPrice = row[18]; // Variant Price (after adding Product Category)
        const costPerItem = row[23];  // Cost per item (after reordering)

        if (!bodyHtml || bodyHtml.trim().length === 0) {
          validationErrors.push(`${handle}: Row ${idx + 1} missing Body (HTML)`);
        }
        if (!variantPrice || variantPrice === 0) {
          validationErrors.push(`${handle}: Row ${idx + 1} missing Variant Price`);
        }
        if (!costPerItem || costPerItem === 0) {
          validationErrors.push(`${handle}: Row ${idx + 1} missing Cost per item`);
        }
      });

      allRows.push(...productRows);
      console.log(`[CSV] Added ${productRows.length} rows for ${handle}`);
    } catch (error) {
      console.error(`[CSV] Error building rows for ${handle}:`, error);
      validationErrors.push(`${handle}: ${error.message}`);
    }
  }

  // Fail-fast validation
  if (validationErrors.length > 0) {
    console.error('\n❌ CSV VALIDATION FAILURES:');
    validationErrors.forEach(err => console.error(`  - ${err}`));
    throw new Error('CSV validation failed. See errors above.');
  }

  console.log(`\n[CSV] CSV_FILE: shopify-products-BATCH.csv, ${allRows.length - 1} rows`);
  console.log('✅ All validations passed!');

  // Convert to CSV string
  const csvContent = allRows.map(row =>
    row.map(cell => {
      const str = String(cell || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',')
  ).join('\n');

  return {
    content: csvContent,
    filename: 'shopify-products-BATCH.csv',
    rowCount: allRows.length - 1
  };
}

module.exports = {
  exportBatchCSV,
  buildProductRows,
  extractLeafType,
  extractProductCategory,
  buildTags
};
