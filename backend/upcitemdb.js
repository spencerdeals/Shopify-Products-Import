// backend/upcitemdb.js
const axios = require('axios');

class UPCItemDB {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.upcitemdb.com/prod/trial';
    this.enabled = !!apiKey;
    
    console.log('🔍 UPCitemdb initialization check:');
    console.log(`   API Key provided: ${apiKey ? 'YES (length: ' + apiKey.length + ')' : 'NO'}`);
    console.log(`   API Key preview: ${apiKey ? apiKey.substring(0, 8) + '...' : 'undefined'}`);
    console.log(`   Base URL: ${this.baseURL}`);
    
    if (this.enabled) {
      console.log('✅ UPCitemdb initialized');
    } else {
      console.log('❌ UPCitemdb disabled - no API key provided');
      console.log('   Check Railway environment variable: UPCITEMDB_API_KEY');
    }
  }

  async searchByName(productName) {
    if (!this.enabled) return null;
    
    try {
      console.log(`🔍 UPCitemdb: Searching for "${productName.substring(0, 50)}..."`);
      
      const response = await axios.get(`${this.baseURL}/search`, {
        params: {
          s: productName,
          match_mode: '0', // Best match
          type: 'product'
        },
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.data && response.data.items && response.data.items.length > 0) {
        const item = response.data.items[0]; // Get best match
        console.log(`✅ UPCitemdb found: ${item.title || 'Unknown'}`);
        
        return {
          name: item.title,
          brand: item.brand,
          upc: item.upc,
          dimensions: this.extractDimensions(item),
          weight: this.extractWeight(item),
          image: item.images?.[0],
          description: item.description
        };
      }
      
      console.log('❌ UPCitemdb: No results found');
      return null;
      
    } catch (error) {
      console.error('❌ UPCitemdb search failed:', error.message);
      return null;
    }
  }

  extractDimensions(item) {
    // Check if item has dimension field
    if (item.dimension) {
      // Parse dimension string like "10 x 8 x 2 inches"
      const match = item.dimension.match(/(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)/i);
      if (match) {
        return {
          length: parseFloat(match[1]),
          width: parseFloat(match[2]),
          height: parseFloat(match[3])
        };
      }
    }
    
    // Check individual dimension fields
    if (item.length && item.width && item.height) {
      return {
        length: parseFloat(item.length),
        width: parseFloat(item.width),
        height: parseFloat(item.height)
      };
    }
    
    return null;
  }

  extractWeight(item) {
    if (item.weight) {
      // If it's already a number
      if (typeof item.weight === 'number') {
        return item.weight;
      }
      
      // Parse weight string
      const match = item.weight.match(/(\d+\.?\d*)\s*(lb|pound|kg|g|oz)?/i);
      if (match) {
        const value = parseFloat(match[1]);
        const unit = (match[2] || 'lb').toLowerCase();
        
        // Convert to pounds
        switch(unit) {
          case 'kg': return value * 2.205;
          case 'g': return value * 0.00220462;
          case 'oz': return value * 0.0625;
          default: return value; // assume pounds
        }
      }
    }
    
    return null;
  }
}

module.exports = UPCItemDB;
