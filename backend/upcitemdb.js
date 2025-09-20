// backend/upcitemdb.js - UPC Item Database Client
const axios = require('axios');

class UPCitemdbClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.enabled = !!apiKey;
    this.baseURL = 'https://api.upcitemdb.com/prod/trial/lookup';
    
    console.log(`🔍 UPCitemdbClient ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set UPCITEMDB_API_KEY environment variable to enable UPC lookups');
    }
  }

  isAvailable() {
    return this.enabled;
  }

  async lookupProduct(upc) {
    if (!this.enabled) {
      throw new Error('UPCitemdb not configured - no API key provided');
    }

    console.log(`🔍 Looking up UPC: ${upc}`);

    try {
      const response = await axios.get(this.baseURL, {
        params: {
          upc: upc
        },
        headers: {
          'user_key': this.apiKey,
          'key_type': 'user'
        },
        timeout: 10000
      });

      if (response.data && response.data.items && response.data.items.length > 0) {
        const item = response.data.items[0];
        
        console.log(`✅ UPC lookup successful for ${upc}`);
        
        return {
          name: item.title || null,
          brand: item.brand || null,
          category: item.category || null,
          description: item.description || null,
          upc: item.upc || upc,
          found: true
        };
      } else {
        console.log(`❌ No results found for UPC: ${upc}`);
        return {
          found: false,
          upc: upc
        };
      }

    } catch (error) {
      console.error(`❌ UPC lookup failed for ${upc}:`, error.message);
      throw error;
    }
  }

  // Batch lookup method
  async lookupMultipleProducts(upcs) {
    if (!this.enabled) {
      throw new Error('UPCitemdb not configured');
    }

    const results = [];
    
    for (const upc of upcs) {
      try {
        const result = await this.lookupProduct(upc);
        results.push(result);
        
        // Small delay between requests to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        results.push({
          upc: upc,
          found: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

module.exports = UPCitemdbClient;