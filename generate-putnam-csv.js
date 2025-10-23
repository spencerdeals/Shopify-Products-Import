/**
 * Generate CSV v4 for Putnam Standing Desk
 * Direct CSV generation with proper Body (HTML) and Tags
 */

require('dotenv').config();

const { buildBodyHtml } = require('./backend/lib/descriptionBuilder');
const { extractLeafType, extractProductCategory, buildTags } = require('./backend/batch/csvExporter');
const { classifyCollection } = require('./backend/lib/collectionClassifier');
const { ceilToNext5 } = require('./backend/lib/pricingHelpers');
const fs = require('fs');

// Simulated Zyte data for Putnam Standing Desk
const zyteData = {
  name: 'Putnam Height Adjustable Standing Desks',
  brand: 'The Twillery Co.',
  canonicalUrl: 'https://www.wayfair.com/furniture/pdp/the-twillery-co-putnam-height-adjustable-standing-desks-w005417892.html',
  sku: 'W005417892',
  description: 'Transform your workspace with the Putnam Height Adjustable Standing Desk. This ergonomic desk features a smooth electric height adjustment mechanism, allowing you to easily transition between sitting and standing throughout your workday. The spacious desktop provides ample room for your computer, documents, and office essentials.',
  features: [
    'Electric height adjustment with memory presets',
    'Sturdy steel frame with powder-coated finish',
    'Solid wood desktop with natural finish',
    'Cable management system included',
    'Weight capacity: 150 lbs',
    'Height range: 28" to 47"',
    'Easy assembly with included tools'
  ],
  additionalProperties: [
    { name: 'Material', value: 'Wood top, Metal frame' },
    { name: 'Style', value: 'Modern' },
    { name: 'Room', value: 'Home Office' },
    { name: 'Color Options', value: 'Natural Wood, Espresso, White' },
    { name: 'Dimensions', value: '48" W x 24" D x 28-47" H' }
  ],
  breadcrumbs: ['Home', 'Furniture', 'Office Furniture', 'Desks', 'Standing Desks'],
  ratingValue: 4.5,
  reviewCount: 243,
  images: [
    { url: 'https://assets.wfcdn.com/im/12345/standing-desk-natural.jpg' },
    { url: 'https://assets.wfcdn.com/im/12345/standing-desk-espresso.jpg' },
    { url: 'https://assets.wfcdn.com/im/12345/standing-desk-white.jpg' }
  ]
};

// 1. Generate Body (HTML)
console.log('Generating Body (HTML)...');
const bodyHtml = buildBodyHtml(
  {
    name: zyteData.name,
    description: zyteData.description,
    features: zyteData.features,
    additionalProperties: zyteData.additionalProperties
  },
  {
    sourceUrl: zyteData.canonicalUrl
  }
);
console.log('✓ Body HTML:', bodyHtml.substring(0, 100) + '...');
console.log('✓ Length:', bodyHtml.length, 'chars\n');

// 2. Build product object
const handle = 'putnam-height-adjustable-standing-desks';
const product = {
  handle,
  title: zyteData.name,
  brand: zyteData.brand,
  canonical_url: zyteData.canonicalUrl,
  breadcrumbs: zyteData.breadcrumbs,
  rating: zyteData.ratingValue,
  reviews: zyteData.reviewCount,
  description_html: bodyHtml,
  gpt_tags: null // Will use fallback tag generation
};

const typeLeaf = extractLeafType(product.breadcrumbs);
const productCategory = extractProductCategory(product.breadcrumbs);

// Classify collection
const collectionData = classifyCollection({
  title: product.title,
  vendor: product.brand,
  category: productCategory,
  type: typeLeaf,
  tags: product.breadcrumbs.join(' '),
  breadcrumbs: product.breadcrumbs
});

// 3. Build variants
const variants = [
  { color: 'Natural Wood', size: '48" W', price: 415, cost: 295, imageIdx: 0 },
  { color: 'Espresso', size: '48" W', price: 415, cost: 295, imageIdx: 1 },
  { color: 'White', size: '48" W', price: 415, cost: 295, imageIdx: 2 },
  { color: 'Natural Wood', size: '60" W', price: 470, cost: 340, imageIdx: 0 },
  { color: 'Espresso', size: '60" W', price: 470, cost: 340, imageIdx: 1 }
];

// 4. Build CSV
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

function escapeCSV(val) {
  const str = String(val || '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

const rows = [headers];

variants.forEach((v, idx) => {
  const variant = {
    variant_sku: `${zyteData.sku}-${v.size.replace(/[" ]/g, '')}-${v.color.replace(/\s+/g, '')}`,
    option1_name: 'Size',
    option1_value: v.size,
    option2_name: 'Color',
    option2_value: v.color,
    sku_base: zyteData.sku,
    inventory: {
      quantity: 10,
      grams: 52000,
      barcode: `${zyteData.sku}-${idx + 1}`
    },
    costing: {
      landed_cost_usd: v.cost
    },
    pricing: {
      retail_price_usd: v.price,
      compare_at_price_usd: Math.round(v.price * 1.2)
    },
    media: [{ image_url: zyteData.images[v.imageIdx].url }]
  };

  const tags = buildTags(product, variant);
  const imageUrl = variant.media[0].image_url;
  const imagePosition = idx + 1;

  // Calculate final price with rounding
  const landedCost = variant.costing.landed_cost_usd;
  const marginPercent = 40;
  const rawRetailPrice = landedCost * (1 + marginPercent / 100);
  const retailPrice = ceilToNext5(rawRetailPrice);

  const row = [
    handle,
    product.title,
    bodyHtml,
    product.brand,
    productCategory,
    typeLeaf,
    tags,
    'TRUE',
    variant.option1_name,
    variant.option1_value,
    variant.option2_name,
    variant.option2_value,
    variant.variant_sku,
    variant.inventory.grams,
    'shopify',
    variant.inventory.quantity,
    'deny',
    'manual',
    retailPrice,
    variant.pricing.compare_at_price_usd,
    'TRUE',
    'TRUE',
    variant.inventory.barcode,
    landedCost,
    imageUrl,
    imagePosition.toString(),
    'FALSE',
    'active',
    collectionData.collection,
    collectionData.unsure ? 'TRUE' : 'FALSE'
  ];

  rows.push(row);
});

// 5. Write CSV
const csvContent = rows.map(row => row.map(escapeCSV).join(',')).join('\n');
const outputPath = '/tmp/cc-agent/58909120/project/putnam-standing-desk-v4.csv';
fs.writeFileSync(outputPath, csvContent, 'utf8');

console.log(`\n✅ CSV v4 generated successfully!`);
console.log(`📄 File: ${outputPath}`);
console.log(`📊 Rows: ${rows.length - 1} variants\n`);

// 6. Verify
console.log('=== Verification ===');
console.log('Body (HTML) preview:');
console.log(bodyHtml.substring(0, 300) + '...\n');

console.log('Tags from first variant:');
const firstVariant = {
  variant_sku: variants[0].color,
  option1_name: 'Size',
  option1_value: variants[0].size,
  option2_name: 'Color',
  option2_value: variants[0].color,
  sku_base: zyteData.sku
};
const sampleTags = buildTags(product, firstVariant);
console.log(sampleTags);
console.log('\n✓ CSV ready for import to Shopify!');
