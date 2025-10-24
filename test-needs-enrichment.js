#!/usr/bin/env node
/**
 * Test the needsEnrichment logic to verify it correctly identifies
 * descriptions that need Zyte enrichment
 */

const ZyteEnricher = require('./backend/lib/zyteEnricher');

const enricher = new ZyteEnricher();

console.log('\n🧪 Testing needsEnrichment Logic\n');
console.log('=' .repeat(60) + '\n');

// Test cases
const testCases = [
  {
    name: 'Empty description',
    html: '',
    expected: true
  },
  {
    name: 'Very short description',
    html: '<h2>Product</h2><p>Short text.</p>',
    expected: true
  },
  {
    name: 'Boilerplate with Special Order notice (YOUR CASE)',
    html: `<h2>Putnam Height Adjustable Standing Desks</h2>
<p><strong>Special Order (3–4 weeks)</strong>. Tax included.</p>
<p>Premium quality furniture item. Contact us for details.</p>
<p><small>Source: <a href="https://www.wayfair.com/..." target="_blank" rel="nofollow">wayfair.com</a></small></p>`,
    expected: true // Should return TRUE now!
  },
  {
    name: 'Minimal content with only source link',
    html: '<p><small>Source: <a href="https://www.wayfair.com/..." rel="nofollow">Wayfair product page</a></small></p>',
    expected: true
  },
  {
    name: 'Rich content with features',
    html: `<h2>Product Name</h2>
<p>Detailed description with lots of information about the product.</p>
<h3>Features</h3>
<ul>
  <li>Feature 1</li>
  <li>Feature 2</li>
</ul>`,
    expected: false
  },
  {
    name: 'Rich content with specifications table',
    html: `<h2>Product</h2>
<p>Description text here.</p>
<h3>Specifications</h3>
<table>
  <tr><td>Dimensions</td><td>60" x 30"</td></tr>
</table>`,
    expected: false
  },
  {
    name: 'Long description without rich content',
    html: '<h2>Product</h2><p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(5) + '</p>',
    expected: false
  },
  {
    name: 'Medium length with list but no features header',
    html: `<h2>Product</h2>
<p>This product includes:</p>
<ul>
  <li>Item 1</li>
  <li>Item 2</li>
</ul>`,
    expected: false // Has list, so already has some structure
  }
];

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = enricher.needsEnrichment(testCase.html);
  const success = result === testCase.expected;

  if (success) {
    passed++;
    console.log(`✅ Test ${index + 1}: ${testCase.name}`);
  } else {
    failed++;
    console.log(`❌ Test ${index + 1}: ${testCase.name}`);
    console.log(`   Expected: ${testCase.expected}, Got: ${result}`);

    // Show text analysis
    const text = testCase.html.replace(/<[^>]+>/g, '').trim();
    const textWithoutSpaces = text.replace(/\s/g, '');
    console.log(`   Text length: ${text.length} chars`);
    console.log(`   Text without spaces: ${textWithoutSpaces.length} chars`);
    console.log(`   Preview: ${text.substring(0, 100)}...`);
  }
  console.log('');
});

console.log('=' .repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('✅ All tests passed!\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Check the logic.\n');
  process.exit(1);
}
