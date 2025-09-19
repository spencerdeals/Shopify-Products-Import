// backend/upcitemdb.js - UPCitemdb API Integration
const axios = require('axios');

class UPCItemDB {
  constructor() {
    this.apiKey = process.env.UPCITEMDB_API_KEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.upcitemdb.com/prod/trial/lookup';
    
    console.log('🔍 UPCItemDB Constructor:');
    console.log(`   API Key: ${this.apiKey ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set UPCITEMDB_API_KEY environment variable to enable UPC lookups');
    }
  }

  async lookupUPC(upc) {
    if (!this.enabled) {
      throw new Error('UPCItemDB not configured - missing API key');
    }

    try {
      console.log(`🔍 Looking up UPC: ${upc}`);
      
      const response = await axios.get(this.baseURL, {
        params: {
          upc: upc
        },
        headers: {
          'user_key': this.apiKey,
          'key_type': 'user_key'
        },
        timeout: 10000
      });

      if (response.data && response.data.items && response.data.items.length > 0) {
        const item = response.data.items[0];
        console.log(`✅ UPC lookup successful: ${item.title}`);
        
        return {
          name: item.title,
          brand: item.brand,
          category: item.category,
          description: item.description,
          upc: item.upc,
          ean: item.ean
        };
      }
      
      throw new Error('No product found for this UPC');
      
    } catch (error) {
      console.error(`❌ UPC lookup failed: ${error.message}`);
      throw error;
    }
  }

  isAvailable() {
    return this.enabled;
  }
}

module.exports = UPCItemDB;