/**
 * Test script to generate CSV with proper Body (HTML) and Tags
 * Simulates: Zyte data → descriptionBuilder → gptTagGenerator → Torso → CSV
 */

require('dotenv').config();

const { buildBodyHtml } = require('./backend/lib/descriptionBuilder');
const { exportBatchCSV, generateSmartTags } = require('./backend/batch/csvExporter');
const torso = require('./backend/torso');

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
  ],
  variants: [
    { color: 'Natural Wood', size: '48" W' },
    { color: 'Espresso', size: '48" W' },
    { color: 'White', size: '48" W' },
    { color: 'Natural Wood', size: '60" W' },
    { color: 'Espresso', size: '60" W' }
  ]
};

async function main() {
  console.log('=== CSV Export Test: Putnam Standing Desk ===\n');

  // 1. Generate Body (HTML) using descriptionBuilder
  console.log('1. Generating Body (HTML)...');
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
  console.log('   ✓ Body HTML generated:', bodyHtml.length, 'chars');

  // 2. Generate tags
  console.log('\n2. Generating Tags...');
  const productForTags = {
    title: zyteData.name,
    brand: zyteData.brand,
    canonical_url: zyteData.canonicalUrl,
    breadcrumbs: zyteData.breadcrumbs,
    gpt_tags: null // Force fallback tag generation
  };
  const tags = generateSmartTags(productForTags);
  const tagsStr = Array.from(tags).join(', ');
  console.log('   ✓ Tags generated:', tagsStr);

  // 3. Insert into Torso
  console.log('\n3. Inserting into Torso...');
  const handle = 'putnam-height-adjustable-standing-desks';

  await torso.upsertProduct({
    handle,
    title: zyteData.name,
    brand: zyteData.brand,
    canonical_url: zyteData.canonicalUrl,
    breadcrumbs: zyteData.breadcrumbs,
    rating: zyteData.ratingValue,
    reviews: zyteData.reviewCount,
    description_html: bodyHtml,
    gpt_tags: tagsStr
  });
  console.log('   ✓ Product inserted');

  // 4. Insert variants with pricing
  console.log('\n4. Inserting variants...');
  const variants = [
    { color: 'Natural Wood', size: '48" W', price: 415, cost: 295, image: 0 },
    { color: 'Espresso', size: '48" W', price: 415, cost: 295, image: 1 },
    { color: 'White', size: '48" W', price: 415, cost: 295, image: 2 },
    { color: 'Natural Wood', size: '60" W', price: 470, cost: 340, image: 0 },
    { color: 'Espresso', size: '60" W', price: 470, cost: 340, image: 1 }
  ];

  for (const v of variants) {
    const variantSku = `W005417892-${v.size.replace(/[" ]/g, '')}-${v.color.replace(/\s+/g, '')}`;

    const variantId = await torso.upsertVariant({
      handle,
      sku_base: zyteData.sku,
      variant_sku: variantSku,
      option1_name: 'Size',
      option1_value: v.size,
      option2_name: 'Color',
      option2_value: v.color
    });

    // Add media
    await torso.upsertMedia({
      variant_id: variantId,
      image_url: zyteData.images[v.image].url,
      position: 1
    });

    // Add inventory
    await torso.upsertInventory({
      variant_id: variantId,
      quantity: 10,
      grams: 52000,
      barcode: variantSku
    });

    // Add costing
    await torso.upsertCosting({
      variant_id: variantId,
      first_cost_usd: v.cost * 0.6,
      landed_cost_usd: v.cost,
      duty_rate: 0.25,
      freight_rate_per_ft3: 15,
      fixed_fee_alloc: 25
    });

    // Add pricing
    await torso.upsertPricing({
      variant_id: variantId,
      retail_price_usd: v.price,
      compare_at_price_usd: Math.round(v.price * 1.2)
    });

    console.log(`   ✓ Variant: ${v.size} ${v.color}`);
  }

  // 5. Export CSV
  console.log('\n5. Exporting CSV...');
  const { content, filename } = await exportBatchCSV([handle]);

  // Save to file
  const fs = require('fs');
  const outputPath = '/tmp/cc-agent/58909120/project/putnam-standing-desk-v4.csv';
  fs.writeFileSync(outputPath, content, 'utf8');

  console.log(`   ✓ CSV saved: ${outputPath}`);
  console.log(`   ✓ Filename: ${filename}`);

  // 6. Verify content
  console.log('\n6. Verifying CSV content...');
  const lines = content.split('\n');
  const headers = lines[0].split(',');
  const bodyHtmlIdx = headers.indexOf('Body (HTML)');
  const tagsIdx = headers.indexOf('Tags');

  console.log(`   ✓ Total rows: ${lines.length - 1} (excluding header)`);
  console.log(`   ✓ Body (HTML) column index: ${bodyHtmlIdx}`);
  console.log(`   ✓ Tags column index: ${tagsIdx}`);

  // Extract first row Body HTML
  const firstRowMatch = content.match(/"<h2>.*?<\/small><\/p>"/s);
  if (firstRowMatch) {
    const bodyPreview = firstRowMatch[0].substring(0, 150) + '...';
    console.log(`   ✓ Body HTML preview: ${bodyPreview}`);
  }

  console.log('\n✅ CSV v4 generated successfully!');
  console.log(`\n📄 File location: ${outputPath}`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
