#!/usr/bin/env node
/**
 * Test script for Zyte CSV enrichment
 *
 * Usage: ZYTE_APIKEY=xxx node test-zyte-enrichment.js
 */

require('dotenv').config();
const ZyteEnricher = require('./backend/lib/zyteEnricher');

async function testEnrichment() {
  console.log('\n🧪 Testing Zyte CSV Enrichment\n');

  const enricher = new ZyteEnricher();

  if (!enricher.enabled) {
    console.log('❌ ZYTE_APIKEY not set. Set it and try again:');
    console.log('   ZYTE_APIKEY=your_key node test-zyte-enrichment.js\n');
    process.exit(1);
  }

  // Test 1: Check needsEnrichment()
  console.log('Test 1: Check needsEnrichment()');
  console.log('  Short description (<150 chars):');
  const shortHtml = '<p>Simple desk.</p>';
  console.log(`    Input: "${shortHtml}"`);
  console.log(`    Needs enrichment: ${enricher.needsEnrichment(shortHtml)}`);

  console.log('\n  Link-only description:');
  const linkOnlyHtml = '<p><small>Source: <a href="https://example.com">example.com</a></small></p>';
  console.log(`    Input: "${linkOnlyHtml}"`);
  console.log(`    Needs enrichment: ${enricher.needsEnrichment(linkOnlyHtml)}`);

  console.log('\n  Rich description (>150 chars):');
  const richHtml = '<h2>Title</h2><p>' + 'Long description text '.repeat(10) + '</p>';
  console.log(`    Input: "${richHtml.substring(0, 50)}..."`);
  console.log(`    Needs enrichment: ${enricher.needsEnrichment(richHtml)}`);

  // Test 2: Generate tags
  console.log('\n\nTest 2: Generate tags');
  const tags = enricher.generateTags({
    title: 'Putnam Height Adjustable Standing Desk',
    vendor: 'The Twillery Co.',
    type: 'Desks',
    features: ['Electric height adjustment', 'Dual motor system', 'Memory presets'],
    specifications: [
      { name: 'Material', value: 'Wood' },
      { name: 'Color', value: 'Walnut Brown' }
    ],
    additionalProperties: [
      { name: 'room', value: 'Home Office' }
    ]
  });
  console.log(`  Generated tags: ${tags.join(', ')}`);

  // Test 3: Sanitize HTML
  console.log('\n\nTest 3: Sanitize HTML');
  const unsafeHtml = '<script>alert("xss")</script><p onclick="alert()">Test</p><a href="http://example.com">Link</a>';
  console.log(`  Input: ${unsafeHtml}`);
  const safeHtml = enricher.sanitizeHtml(unsafeHtml);
  console.log(`  Output: ${safeHtml}`);

  // Test 4: Build rich description
  console.log('\n\nTest 4: Build rich description');
  const richDescription = enricher.buildRichDescription({
    title: 'Test Product',
    description: 'A high-quality standing desk with premium features.',
    features: ['Feature 1', 'Feature 2', 'Feature 3'],
    specifications: [
      { name: 'Dimension', value: '60" x 30"' },
      { name: 'Weight', value: '85 lbs' }
    ],
    sourceUrl: 'https://www.wayfair.com/test-product'
  });
  console.log('  Generated HTML:');
  console.log('  ' + richDescription.split('\n').join('\n  '));

  // Test 5: Extract from real URL (if provided)
  const testUrl = process.argv[2];
  if (testUrl) {
    console.log('\n\nTest 5: Extract from real URL');
    console.log(`  URL: ${testUrl}`);
    try {
      const extracted = await enricher.extractFromUrl(testUrl);
      if (extracted) {
        console.log('  ✅ Extraction successful!');
        console.log(`     Description: ${extracted.description ? extracted.description.substring(0, 100) + '...' : 'N/A'}`);
        console.log(`     Features: ${extracted.features ? extracted.features.length : 0} items`);
        console.log(`     Specifications: ${extracted.specifications ? extracted.specifications.length : 0} items`);
      } else {
        console.log('  ⚠️  No data extracted');
      }
    } catch (error) {
      console.log(`  ❌ Extraction failed: ${error.message}`);
    }
  } else {
    console.log('\n\nTest 5: Extract from real URL (skipped)');
    console.log('  To test real extraction, pass a product URL:');
    console.log('  node test-zyte-enrichment.js https://www.wayfair.com/...');
  }

  console.log('\n✅ All tests completed!\n');
}

testEnrichment().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
