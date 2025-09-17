const axios = require('axios');
const { ApifyClient } = require('apify-client');

class ApifyScraper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new ApifyClient({ token: apiKey }) : null;
    this.enabled = !!apiKey;
    
    if (this.enabled) {
      console.log('✅ ApifyScraper initialized successfully');
    } else {
      console.log('❌ ApifyScraper disabled - no API key provided');
    }
  }

  isAvailable() {
    return this.enabled;
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Apify not configured');
    }

    try {
      console.log('🏠 Scraping Wayfair with multiple methods...');
      
        urls: [url],
        extractImages: true,
      // Try the specialized Wayfair scraper first
      try {
        const input = {
          startUrls: [{ url }],
          maxRequestsPerCrawl: 1,
          proxyConfiguration: { useApifyProxy: true }
        };

      const actorId = 'apify/web-scraper';

      // Run the actor
        const run = await this.client.actor('123webdata/wayfair-scraper').call(input, {
          timeout: 45000,
          memory: 512
        });

      // Get results
        const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
        
        if (items && items.length > 0) {
          const item = items[0];
          console.log('✅ Wayfair specialized scraper successful');
          
          const productData = {
            name: item.productName || item.title || item.name || null,
            price: this.extractPrice(item),
            image: item.productImage || item.imageUrl || item.image || null,
            dimensions: this.extractDimensions(item),
            weight: this.extractWeight(item),
            brand: item.brand || item.manufacturer || null,
            category: null,
            inStock: item.availability !== 'out of stock' && item.inStock !== false
          };
          
          // If we got good data, return it
          if (productData.name && productData.name !== 'null' && productData.price) {
            return productData;
          }
        }
      } catch (error) {
        console.log('❌ Wayfair specialized scraper failed:', error.message);
      }
      
      // Fallback to Pro Web Content Crawler for Wayfair
      console.log('🔄 Falling back to Pro Web Content Crawler for Wayfair...');
      return await this.scrapeWithProCrawler(url);
      
    } catch (error) {
      console.error('❌ All Wayfair scraping methods failed:', error.message);
      return null;
    }
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'Amazon';
      if (domain.includes('wayfair.com')) return 'Wayfair';
      if (domain.includes('target.com')) return 'Target';
      if (domain.includes('walmart.com')) return 'Walmart';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }

  extractPrice(item) {
    // Try various price fields
    const priceFields = [
      'price', 'currentPrice', 'salePrice', 'regularPrice', 
      'productPrice', 'listPrice', 'retailPrice', 'finalPrice',
      'priceRange', 'minPrice', 'maxPrice'
    ];
    
    for (const field of priceFields) {
      if (item[field]) {
        let priceValue = item[field];
        
        // Handle price ranges - take the first/lower price
        if (typeof priceValue === 'string' && priceValue.includes('-')) {
          priceValue = priceValue.split('-')[0];
        }
        
        const price = typeof priceValue === 'string' ? 
          parseFloat(priceValue.replace(/[^0-9.]/g, '')) : 
          parseFloat(priceValue);
        
        if (price > 0 && price < 50000) {
          console.log(`   💰 Extracted price from ${field}: $${price}`);
          return price;
        }
      }
    }
    
    // Try to extract from any text field that might contain price
    const allFields = Object.keys(item);
    for (const field of allFields) {
      if (typeof item[field] === 'string' && item[field].includes('$')) {
        const match = item[field].match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
        if (match) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 0 && price < 50000) {
            console.log(`   💰 Extracted price from ${field} text: $${price}`);
            return price;
          }
        }
      }
    }
    
    console.log('   ❌ No valid price found in item data');
    return null;
  }

  extractDimensions(item) {
    // Try to find dimensions in various fields
    const dimensionFields = ['dimensions', 'size', 'specs', 'details'];
    
    for (const field of dimensionFields) {
      if (item[field]) {
        const dimText = typeof item[field] === 'string' ? item[field] : JSON.stringify(item[field]);
        const match = dimText.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/i);
        
        if (match) {
          return {
            length: parseFloat(match[1]),
            width: parseFloat(match[2]),
            height: parseFloat(match[3])
          };
        }
      }
    }
    
    return null;
  }

  extractWeight(item) {
    // Try to find weight in various fields
    const weightFields = ['weight', 'shippingWeight', 'itemWeight'];
    
    for (const field of weightFields) {
      if (item[field]) {
        const weightText = typeof item[field] === 'string' ? item[field] : String(item[field]);
        const match = weightText.match(/(\d+\.?\d*)\s*(lb|pound|kg|g|oz)?/i);
        
        if (match) {
          let weight = parseFloat(match[1]);
          const unit = (match[2] || 'lb').toLowerCase();
          
          // Convert to pounds
          switch(unit) {
            case 'kg': return weight * 2.205;
            case 'g': return weight * 0.00220462;
            case 'oz': return weight * 0.0625;
            default: return weight; // assume pounds
          }
        }
      }
    }
    
    return null;
  }
}

module.exports = ApifyScraper;