#!/usr/bin/env node
/**
 * Quick check: Is Zyte enrichment enabled?
 */

require('dotenv').config();

const apiKey = process.env.ZYTE_APIKEY;

console.log('\n🔍 Zyte Enrichment Status Check\n');
console.log('================================\n');

if (apiKey) {
  console.log('✅ ZYTE_APIKEY: SET');
  console.log(`   Value: ${apiKey.substring(0, 10)}... (${apiKey.length} chars)`);
  console.log('\n✅ Zyte enrichment is ENABLED');
  console.log('   CSV exports will include rich descriptions.\n');
} else {
  console.log('❌ ZYTE_APIKEY: NOT SET');
  console.log('\n❌ Zyte enrichment is DISABLED');
  console.log('   CSV exports will only have minimal descriptions.\n');
  console.log('To fix:');
  console.log('1. Edit .env file');
  console.log('2. Uncomment and set: ZYTE_APIKEY=your_actual_key');
  console.log('3. Restart server\n');
}
