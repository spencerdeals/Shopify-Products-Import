// backend/upcitemdb.js
const axios = require('axios');

class UPCItemDB {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.upcitemdb.com/prod/v1';
    this.enabled = !!apiKey;
    
    console.log('🔍 UPCitemdb Constructor Debug:');
    console.log(`   Raw API Key: ${apiKey}`);
    console.log(`   API Key type: ${typeof apiKey}`);
    console.log(`   API Key length: ${apiKey ? apiKey.length : 0}`);
    console.log(`   API Key truthy: ${!!apiKey}`);
    console.log(`   Expected format: 32 character hex string`);
    
    if (this.enabled) {
      console.log('✅ UPCitemdb initialized successfully');
      console.log(`   Using API endpoint: ${this.baseURL} (DEV PLAN - 2000 searches/day)`);
    } else {
      console.log('❌ UPCitemdb disabled - no API key provided');
      console.log('   Check Railway environment variables:');
      console.log('   - UPCITEMDB_API_KEY');
      console.log('   - UPC_ITEMDB_API_KEY'); 
      console.log('   - UPCITEMDB_KEY');
    }
  }

  async searchByName(productName) {
    if (!this.enabled) return null;
    
    try {
      console.log(`🔍 UPCitemdb: Searching for "${productName.substring(0, 50)}..."`);
      
      // Minimal delay for DEV plan
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      
      // Try different authentication methods for paid API
      const authHeaders = {
        'user_key': this.apiKey,
        'key_type': '3scale',
        'Content-Type': 'application/json'
      };
      
      console.log('🔑 Using auth headers:', { user_key: this.apiKey.substring(0, 8) + '...', key_type: '3scale' });
      
      const response = await axios.get(`${this.baseURL}/search`, {
        params: {
          s: productName,
          match_mode: '0', // Best match
          type: 'product'
        },
        headers: authHeaders,
        timeout: 15000 // Increased timeout
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
      if (error.response?.status === 429) {
        console.error('❌ UPCitemdb rate limited - DEV plan limit reached (2000/day)');
      } else {
        console.error('❌ UPCitemdb search failed:', error.response?.status, error.message);
      }
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
