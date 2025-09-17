// backend/amazonCrawler.js
const amazonCrawler = require('amazon-crawler');

class AmazonCrawler {
  constructor() {
    this.enabled = true;
    console.log('🛒 AmazonCrawler initialized');
  }

  isAvailable() {
    return this.enabled;
  }

  async scrapeProduct(url) {
    console.log(`🛒 AmazonCrawler scraping: ${url.substring(0, 60)}...`);
    
    try {
      // Extract ASIN from URL
      const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (!asinMatch) {
        throw new Error('Could not extract ASIN from Amazon URL');
      }
      
      const asin = asinMatch[1];
      console.log(`   📦 Extracted ASIN: ${asin}`);
      
      // Use amazon-crawler to get product data
      const results = await amazonCrawler({
        keyword: asin,
        number: 1,
        country: 'US',
        category: 'aps',
        cookie: '',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });
      
      if (!results || !results.result || results.result.length === 0) {
        throw new Error('No results from amazon-crawler');
      }
      
      const product = results.result[0];
      console.log(`✅ Amazon crawler found product: ${product.title?.substring(0, 50)}...`);
      
      return {
        name: product.title || null,
        price: this.extractPrice(product),
        image: this.extractImage(product),
        variant: this.extractVariant(product),
        dimensions: this.extractDimensions(product),
        weight: this.extractWeight(product),
        brand: product.brand || null,
        category: product.category || null,
        inStock: this.extractStock(product)
      };
      
    } catch (error) {
      console.error(`❌ AmazonCrawler failed: ${error.message}`);
      throw error;
    }
  }
  
  extractPrice(product) {
    if (product.price && typeof product.price === 'object') {
      // Try different price fields
      return product.price.current_price || 
             product.price.discounted_price || 
             product.price.price || 
             null;
    }
    
    if (typeof product.price === 'string') {
      const priceMatch = product.price.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
      return priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
    }
    
    return typeof product.price === 'number' ? product.price : null;
  }
  
  extractImage(product) {
    return product.thumbnail || 
           product.image || 
           product.main_image || 
           product.images?.[0] || 
           null;
  }
  
  extractVariant(product) {
    // Look for variant information in title or other fields
    if (product.variant) return product.variant;
    if (product.color) return product.color;
    if (product.size) return product.size;
    if (product.style) return product.style;
    
    // Try to extract from title
    const title = product.title || '';
    const colorMatch = title.match(/\b(Black|White|Red|Blue|Green|Yellow|Orange|Purple|Pink|Brown|Gray|Grey|Silver|Gold)\b/i);
    if (colorMatch) return colorMatch[1];
    
    const sizeMatch = title.match(/\b(Small|Medium|Large|XL|XXL|S|M|L|\d+["\s]?x\s?\d+["\s]?|\d+\s?inch|\d+\s?ft)\b/i);
    if (sizeMatch) return sizeMatch[1];
    
    return null;
  }
  
  extractDimensions(product) {
    const dimensionText = product.dimensions || product.description || '';
    if (dimensionText) {
      const dimMatch = dimensionText.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
      if (dimMatch) {
        return {
          length: parseFloat(dimMatch[1]),
          width: parseFloat(dimMatch[2]),
          height: parseFloat(dimMatch[3])
        };
      }
    }
    return null;
  }
  
  extractWeight(product) {
    const weightText = product.weight || product.description || '';
    if (weightText) {
      const weightMatch = weightText.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|kg)/i);
      if (weightMatch) {
        let weight = parseFloat(weightMatch[1]);
        if (weightText.toLowerCase().includes('kg')) {
          weight *= 2.205; // Convert to pounds
        }
        return weight;
      }
    }
    return null;
  }
  
  extractStock(product) {
    // If product has reviews, it's likely in stock
    if (product.reviews && product.reviews.total_reviews > 0) return true;
    if (product.rating && product.rating > 0) return true;
    
    // Check availability text
    const availability = (product.availability || '').toLowerCase();
    if (availability.includes('out of stock') || availability.includes('unavailable')) {
      return false;
    }
    
    return true; // Default to in stock
  }
}

module.exports = AmazonCrawler;