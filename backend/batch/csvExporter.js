/**
 * Shopify CSV Exporter
 *
 * Builds a single Shopify-compatible CSV from Torso data for multiple products.
 * Source of truth: Torso database only (not in-memory data).
 */

const torso = require('../torso');
const { classifyCollection } = require('../lib/collectionClassifier');
const { ceilToNext5 } = require('../lib/pricingHelpers');

/**
 * Get Body (HTML) from product data
 * Uses stored description_html from Torso (already enhanced during scraping)
 * Falls back to minimal synthesis only if description is missing
 */
function generateBodyHtml(product) {
  // Use stored description_html if available (already enhanced by descriptionBuilder during scraping)
  if (product.description_html && product.description_html.trim().length > 0) {
    return product.description_html;
  }

  // Fallback: synthesize minimal description if somehow missing
  const parts = [];
  const typeLeaf = extractLeafType(product.breadcrumbs);
  const vendor = product.brand || 'SDL';

  parts.push(`<h2>${product.title || 'Product'}</h2>`);
  parts.push('<p><strong>Special Order (3–4 weeks)</strong>. Tax included.</p>');
  parts.push(`<p>Premium ${typeLeaf.toLowerCase()} from ${vendor}. ${product.title} combines quality craftsmanship with modern design, perfect for any home or office.</p>`);

  if (product.canonical_url) {
    const domain = new URL(product.canonical_url).hostname.replace('www.', '');
    parts.push(`<p><small>Source: <a href="${product.canonical_url}" target="_blank" rel="nofollow">${domain}</a></small></p>`);
  }

  return parts.join('\n');
}

/**
 * Generate smart tags from product data at CSV export time
 * Returns 5-10 normalized tags based on title, vendor, type, and category
 */
function generateSmartTags(product) {
  const tags = new Set();

  // Use GPT tags if available
  if (product.gpt_tags) {
    const gptTags = product.gpt_tags.split(',').map(t => t.trim());
    gptTags.forEach(tag => {
      if (tag) tags.add(tag.toLowerCase());
    });
    return tags;
  }

  // Extract from title - look for key product terms
  const title = (product.title || '').toLowerCase();
  const titleWords = title.split(/\s+/);

  // Function tags from title
  const functionKeywords = ['desk', 'table', 'chair', 'sofa', 'bed', 'cabinet', 'shelf', 'rack', 'stand', 'storage', 'seating', 'dining', 'adjustable', 'sectional', 'ottoman', 'bench'];
  functionKeywords.forEach(kw => {
    if (title.includes(kw)) tags.add(kw);
  });

  // Multi-word function tags
  if (title.includes('standing desk')) tags.add('standing desk');
  if (title.includes('adjustable desk')) tags.add('adjustable desk');
  if (title.includes('height adjustable')) tags.add('height adjustable');
  if (title.includes('dining set')) tags.add('dining set');
  if (title.includes('dining table')) tags.add('dining table');
  if (title.includes('patio set')) tags.add('patio set');
  if (title.includes('outdoor dining')) tags.add('outdoor dining');
  if (title.includes('coffee table')) tags.add('coffee table');
  if (title.includes('side table')) tags.add('side table');
  if (title.includes('seating set')) tags.add('seating set');

  // Special features from title
  if (title.includes('cushion')) tags.add('cushions');
  if (title.includes('ergonomic')) tags.add('ergonomic furniture');
  if (title.includes('rectangular')) tags.add('rectangular table');

  // Room/usage tags from title and breadcrumbs
  const roomKeywords = ['office', 'bedroom', 'living room', 'dining room', 'kitchen', 'bathroom', 'outdoor', 'patio', 'home', 'workspace'];
  roomKeywords.forEach(kw => {
    if (title.includes(kw)) tags.add(kw);
  });
  if (title.includes('home office')) tags.add('home office');

  // Style/material tags from title
  const styleKeywords = ['modern', 'contemporary', 'rustic', 'industrial', 'traditional', 'farmhouse', 'minimalist', 'mid-century'];
  const materialKeywords = ['wood', 'metal', 'glass', 'leather', 'fabric', 'plastic', 'wicker', 'rattan', 'all-weather'];
  [...styleKeywords, ...materialKeywords].forEach(kw => {
    if (title.includes(kw)) tags.add(kw);
  });

  // Add vendor/brand
  if (product.brand) {
    tags.add(product.brand.toLowerCase());
  }

  // Add product type from breadcrumbs
  const typeLeaf = extractLeafType(product.breadcrumbs);
  if (typeLeaf && typeLeaf !== 'Furniture') {
    tags.add(typeLeaf.toLowerCase());
  }

  // Infer context tags based on product type
  if (title.includes('desk') && title.includes('office')) {
    tags.add('home office');
  } else if (title.includes('desk')) {
    tags.add('office furniture');
  }

  if (title.includes('standing desk') || title.includes('adjustable desk')) {
    tags.add('ergonomic furniture');
  }

  if (title.includes('outdoor') || title.includes('patio')) {
    tags.add('all-weather');
  }

  if (title.includes('dining set')) {
    tags.add('seating set');
  }

  if (title.includes('outdoor') && title.includes('dining')) {
    tags.add('patio set');
  }

  // Add source
  if (product.canonical_url && product.canonical_url.includes('wayfair')) {
    tags.add('wayfair');
  }

  return tags;
}

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
 * Generates smart tags at CSV export time
 */
function buildTags(product, variant) {
  // Start with smart tags generated from product data
  const smartTags = generateSmartTags(product);
  const tags = new Set(smartTags);

  // Add variant-specific tags (Color, Size)
  if (variant.option1_name === 'Color' && variant.option1_value) {
    tags.add(`Color:${variant.option1_value}`);
  }
  if (variant.option2_name === 'Size' && variant.option2_value) {
    tags.add(`Size:${variant.option2_value}`);
  }
  if (variant.option1_name === 'Size' && variant.option1_value !== 'Default Title') {
    tags.add(`Size:${variant.option1_value}`);
  }

  // Add SKU tag
  if (variant.sku_base) {
    tags.add(`SKU:${variant.sku_base}`);
  }

  // Add rating/reviews if available
  if (product.rating) {
    tags.add(`Rating:${product.rating}`);
  }
  if (product.reviews) {
    tags.add(`Reviews:${product.reviews}`);
  }

  return Array.from(tags).join(', ');
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

  // Generate Body (HTML) at CSV export time
  // Uses existing description_html if available, otherwise synthesizes
  const bodyHtmlEnhanced = generateBodyHtml(product);

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
  buildTags,
  generateBodyHtml,
  generateSmartTags
};
