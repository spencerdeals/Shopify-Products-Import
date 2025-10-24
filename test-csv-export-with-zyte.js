#!/usr/bin/env node
/**
 * Test CSV export WITH Zyte enrichment
 * This simulates the actual export flow to diagnose issues
 */

require('dotenv').config();
const { exportBatchCSV } = require('./backend/batch/csvExporter');

async function testExport() {
  console.log('\n🧪 Testing CSV Export with Zyte Enrichment\n');

  // Check environment
  const zyteKey = process.env.ZYTE_APIKEY;
  console.log('Environment Check:');
  console.log('==================');
  console.log('ZYTE_APIKEY:', zyteKey ? `✅ Set (${zyteKey.substring(0, 8)}...)` : '❌ NOT SET');
  console.log('');

  if (!zyteKey) {
    console.log('⚠️  WARNING: ZYTE_APIKEY is not set!');
    console.log('   Enrichment will be DISABLED.');
    console.log('   To enable, set ZYTE_APIKEY in .env file or environment.\n');
  }

  // Test with the Putnam desk handle from your CSV
  const testHandle = 'putnam-height-adjustable-standing-desks';

  console.log(`Testing CSV export for handle: ${testHandle}\n`);

  try {
    const { content, filename, rowCount } = await exportBatchCSV([testHandle]);

    console.log('\n✅ CSV Export Succeeded!');
    console.log('========================');
    console.log('Filename:', filename);
    console.log('Row count:', rowCount);
    console.log('');

    // Parse CSV to check Body (HTML) column
    const lines = content.split('\n');
    const headers = lines[0].split(',');
    const bodyHtmlIndex = headers.findIndex(h => h.includes('Body (HTML)'));

    if (bodyHtmlIndex >= 0 && lines.length > 1) {
      // Extract body HTML from first data row
      const dataRow = lines[1];

      // Simple CSV parsing (handle quoted fields)
      const match = dataRow.match(/"([^"]*(?:""[^"]*)*)"/g);
      if (match && match[bodyHtmlIndex]) {
        let bodyHtml = match[bodyHtmlIndex]
          .replace(/^"|"$/g, '')  // Remove outer quotes
          .replace(/""/g, '"');    // Unescape inner quotes

        console.log('Body (HTML) Content:');
        console.log('====================');
        console.log(bodyHtml.substring(0, 500));
        if (bodyHtml.length > 500) {
          console.log('... (truncated)');
        }
        console.log('');
        console.log('Length:', bodyHtml.length, 'characters');
        console.log('');

        // Analyze content
        console.log('Content Analysis:');
        console.log('=================');
        console.log('Contains <h2>:', bodyHtml.includes('<h2>') ? '✅' : '❌');
        console.log('Contains <h3>:', bodyHtml.includes('<h3>') ? '✅' : '❌');
        console.log('Contains <ul>:', bodyHtml.includes('<ul>') ? '✅' : '❌');
        console.log('Contains <table>:', bodyHtml.includes('<table>') ? '✅' : '❌');
        console.log('Contains Features:', bodyHtml.includes('Features') ? '✅' : '❌');
        console.log('Contains Specifications:', bodyHtml.includes('Specifications') ? '✅' : '❌');
        console.log('');

        // Determine if enrichment happened
        const hasRichContent = bodyHtml.includes('<h3>') || bodyHtml.includes('<ul>') || bodyHtml.includes('<table>');
        const onlyHasLink = bodyHtml.includes('Source:') && bodyHtml.length < 200;

        console.log('Result:');
        console.log('=======');
        if (hasRichContent) {
          console.log('✅ ENRICHMENT SUCCESSFUL - Rich content detected!');
        } else if (onlyHasLink) {
          console.log('❌ NO ENRICHMENT - Only source link present');
          console.log('   This means Zyte enrichment did not run.');
          console.log('');
          console.log('Possible reasons:');
          console.log('1. ZYTE_APIKEY not set');
          console.log('2. Product already has rich description (>150 chars)');
          console.log('3. Product has no canonical_url in Torso');
          console.log('4. Zyte API call failed');
        } else {
          console.log('⚠️  PARTIAL CONTENT - Some content but not fully enriched');
        }
      }
    }

    // Save CSV for inspection
    const fs = require('fs');
    const outputFile = 'test-export-output.csv';
    fs.writeFileSync(outputFile, content);
    console.log('');
    console.log(`💾 Full CSV saved to: ${outputFile}`);

  } catch (error) {
    console.error('❌ CSV Export Failed:', error.message);
    console.error('');
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

testExport();
