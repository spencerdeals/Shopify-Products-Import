/**
 * Shopify CSV Exporter
 *
 * Builds a single Shopify-compatible CSV from Torso data for multiple products.
 * Source of truth: Torso database only (not in-memory data).
 */

const torso = require('../torso');

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
 * Build Body HTML with source link
 */
function buildBodyHtml(product) {
  let html = product.description_html || '';

  // Append source link if not already present
  if (product.canonical_url && !html.includes(product.canonical_url)) {
    const sourceLink = `<p><small>Source: <a href="${product.canonical_url}" target="_blank" rel="nofollow">Wayfair product page</a></small></p>`;
    html += html ? '<br><br>' + sourceLink : sourceLink;
  }

  return html;
}

/**
 * Build CSV rows for a single product from Torso
 */
async function buildProductRows(handle) {
  // Get complete product data from Torso
  const product = await torso.getProductComplete(handle);
  if (!product) {
    throw new Error(`Product not found in Torso: ${handle}`);
  }

  const rows = [];
  const typeLeaf = extractLeafType(product.breadcrumbs);
  const bodyHtml = buildBodyHtml(product);

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

    // Build CSV row
    rows.push([
      handle,                                          // Handle
      product.title,                                   // Title
      bodyHtml,                                        // Body (HTML)
      product.brand || 'SDL',                          // Vendor
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
      variant.pricing.retail_price_usd,                // Variant Price
      variant.pricing.compare_at_price_usd || '',      // Variant Compare At Price
      'TRUE',                                          // Variant Requires Shipping
      'TRUE',                                          // Variant Taxable
      variant.inventory?.barcode || '',                // Variant Barcode
      imageUrl,                                        // Image Src
      imagePosition.toString(),                        // Image Position
      'FALSE',                                         // Gift Card
      'active',                                        // Status
      variant.costing.landed_cost_usd,                 // Cost per item
      ''                                               // Collection (empty for now)
    ]);
  });

  return rows;
}

/**
 * Export batch of products to single Shopify CSV
 */
async function exportBatchCSV(handles) {
  console.log(`\n[CSV] Building Shopify CSV for ${handles.length} products`);

  const headers = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value',
    'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty',
    'Variant Inventory Policy', 'Variant Fulfillment Service',
    'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping', 'Variant Taxable',
    'Variant Barcode',
    'Image Src', 'Image Position', 'Gift Card', 'Status',
    'Cost per item', 'Collection'
  ];

  const allRows = [headers];
  const validationErrors = [];

  // Build rows for each product
  for (const handle of handles) {
    try {
      const productRows = await buildProductRows(handle);

      // Validate each row
      productRows.forEach((row, idx) => {
        const variantPrice = row[17]; // Variant Price
        const costPerItem = row[26];  // Cost per item

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
  buildTags,
  buildBodyHtml
};
