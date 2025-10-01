#!/usr/bin/env node

const axios = require('axios');

const WAYFAIR_TEST_URL = 'https://www.wayfair.com/outdoor/pdp/ebern-designs-swain-5-piece-rattan-sofa-seating-group-with-cushions-w002989946.html';
const API_URL = process.env.API_URL || 'http://localhost:3000';

async function testWayfairPrice() {
  console.log('🧪 Wayfair Price Extraction Smoke Test');
  console.log('=====================================\n');
  console.log(`Testing URL: ${WAYFAIR_TEST_URL}`);
  console.log(`API: ${API_URL}\n`);

  try {
    console.log('⏳ Scraping product...\n');

    const response = await axios.post(`${API_URL}/api/scrape`, {
      urls: [WAYFAIR_TEST_URL]
    }, {
      timeout: 60000
    });

    const product = response.data.products[0];

    console.log('📊 Results:');
    console.log('===========\n');

    // Basic info
    console.log(`Product Name: ${product.name || 'MISSING'}`);
    console.log(`Price: ${product.price ? `$${product.price}` : 'MISSING ❌'}`);
    console.log(`Retailer: ${product.retailer}`);
    console.log(`Quote Status: ${product.quoteStatus}`);
    console.log(`Can Quote: ${product.canQuote ? '✅' : '❌'}\n`);

    // Telemetry
    if (product.telemetry) {
      console.log('📈 Telemetry:');
      console.log(`  Data Source: ${product.telemetry.dataSource}`);
      console.log(`  Price Source: ${product.telemetry.priceSource || 'N/A'}`);
      console.log(`  Missing Fields: ${product.telemetry.missingFields.join(', ') || 'none'}`);
      console.log(`  Zyte Confidence: ${product.telemetry.zyteConfidence ? (product.telemetry.zyteConfidence * 100).toFixed(1) + '%' : 'N/A'}`);
      console.log(`  Override Reason: ${product.telemetry.overrideReason || 'none'}\n`);
    }

    // Price Debug
    if (product.telemetry?.priceDebug) {
      console.log('🔍 Price Debug:');
      console.log(`  Attempted Fields: ${product.telemetry.priceDebug.attemptedFields.join(', ')}`);
      console.log(`  Chosen Field: ${product.telemetry.priceDebug.chosenField || 'none'}`);
      console.log(`  Chosen Value: ${product.telemetry.priceDebug.chosenValue ? `$${product.telemetry.priceDebug.chosenValue}` : 'none'}\n`);

      if (Object.keys(product.telemetry.priceDebug.rawValues).length > 0) {
        console.log('  Raw Values Found:');
        Object.entries(product.telemetry.priceDebug.rawValues).forEach(([field, value]) => {
          console.log(`    ${field}: ${JSON.stringify(value)}`);
        });
        console.log('');
      }
    }

    // Shipping
    if (product.shipping) {
      console.log('🚢 Shipping:');
      console.log(`  Cost: ${product.shipping.cost ? `$${product.shipping.cost}` : 'N/A'}`);
      console.log(`  Status: ${product.shipping.status}`);
      console.log(`  Reason: ${product.shipping.reason || 'N/A'}\n`);
    }

    // Field Sources
    if (product.fieldSources) {
      console.log('📋 Field Sources:');
      console.log(`  Price: ${product.fieldSources.price}`);
      console.log(`  Dimensions: ${product.fieldSources.dimensions}`);
      console.log(`  Weight: ${product.fieldSources.weight}\n`);
    }

    // Assertions
    console.log('✅ Assertions:');
    const assertions = [
      { name: 'Price > 0', pass: product.price > 0 },
      { name: 'Data source is zyte or zyte+selectors', pass: ['zyte', 'zyte+selectors', 'zyte+gpt'].includes(product.telemetry?.dataSource) },
      { name: 'Quote status is NOT blocked_missing_price', pass: product.quoteStatus !== 'blocked_missing_price' },
      { name: 'Can quote is true', pass: product.canQuote === true }
    ];

    let allPassed = true;
    assertions.forEach(assertion => {
      const icon = assertion.pass ? '✅' : '❌';
      console.log(`  ${icon} ${assertion.name}`);
      if (!assertion.pass) allPassed = false;
    });

    console.log('');

    if (allPassed) {
      console.log('🎉 All tests PASSED!');
      process.exit(0);
    } else {
      console.log('❌ Some tests FAILED!');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Test FAILED with error:');
    console.error(error.response?.data || error.message);
    process.exit(1);
  }
}

testWayfairPrice();
