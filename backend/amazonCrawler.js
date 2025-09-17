// backend/amazonCrawler.js
// Specialized Amazon crawler using amazon-buddy

const amazonBuddy = require('amazon-buddy');

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
      
      // Use amazon-buddy to scrape
      const options = {
        number: 1,
        save: false,
        cli: false,
        scrapeType: 'products',
        asin: asin,
        timeout: 30000
      };
      
      const results = await amazonBuddy(options);
      
      if (!results || !results.result || results.result.length === 0) {
        throw new Error('No results from Amazon crawler');
      }
      
      const product = results.result[0];
      console.log(`✅ AmazonCrawler found product: ${product.title?.substring(0, 50)}...`);
      
      // Extract variant information from title and features
      let variant = null;
      if (product.title) {
        // Look for common variant patterns in title
        const variantPatterns = [
          /\b(Color|Colour):\s*([^,\-\|]+)/i,
          /\b(Size):\s*([^,\-\|]+)/i,
          /\b(Style):\s*([^,\-\|]+)/i,
          /\-\s*([^,\-\|]{3,30})\s*$/i, // End of title variants
          /\|\s*([^,\-\|]{3,30})\s*$/i  // Pipe separated variants
        ];
        
        for (const pattern of variantPatterns) {
          const match = product.title.match(pattern);
          if (match && match[1] && match[1].trim().length > 2 && match[1].trim().length < 50) {
            variant = match[1].trim();
            console.log(`   🎨 Found variant in title: ${variant}`);
            break;
          }
        }
      }
      
      // If no variant in title, check features
      if (!variant && product.feature_bullets) {
        for (const feature of product.feature_bullets) {
          const variantMatch = feature.match(/^(Color|Size|Style|Material):\s*(.+)$/i);
          if (variantMatch && variantMatch[2]) {
            variant = variantMatch[2].trim();
            console.log(`   🎨 Found variant in features: ${variant}`);
            break;
          }
        }
      }
      
      // Clean and validate price
      let price = null;
      if (product.price && product.price.current_price) {
        price = parseFloat(product.price.current_price.toString().replace(/[^0-9.]/g, ''));
        if (price <= 0 || price > 50000) {
          price = null;
        }
      }
      
      // Try discounted price if main price is missing
      if (!price && product.price && product.price.discounted_price) {
        price = parseFloat(product.price.discounted_price.toString().replace(/[^0-9.]/g, ''));
        if (price <= 0 || price > 50000) {
          price = null;
        }
      }
      
      // Extract dimensions from product details
      let dimensions = null;
      if (product.product_information) {
        const info = product.product_information;
        
        // Look for dimensions in various fields
        const dimensionFields = ['Product Dimensions', 'Package Dimensions', 'Item Dimensions', 'Dimensions'];
        
        for (const field of dimensionFields) {
          if (info[field]) {
            const dimMatch = info[field].match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*inches?/i);
            if (dimMatch) {
              dimensions = {
                length: parseFloat(dimMatch[1]),
                width: parseFloat(dimMatch[2]),
                height: parseFloat(dimMatch[3])
              };
              console.log(`   📏 Found dimensions: ${dimensions.length}x${dimensions.width}x${dimensions.height}`);
              break;
            }
          }
        }
      }
      
      // Extract weight
      let weight = null;
      if (product.product_information) {
        const info = product.product_information;
        const weightFields = ['Item Weight', 'Package Weight', 'Shipping Weight'];
        
        for (const field of weightFields) {
          if (info[field]) {
            const weightMatch = info[field].match(/(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)/i);
            if (weightMatch) {
              weight = parseFloat(weightMatch[1]);
              if (weightMatch[2].toLowerCase().includes('kg')) {
                weight *= 2.205; // Convert to pounds
              }
              console.log(`   ⚖️ Found weight: ${weight} lbs`);
              break;
            }
          }
        }
      }
      
      return {
        name: product.title || null,
        price: price,
        variant: variant,
        image: product.main_image || null,
        dimensions: dimensions,
        weight: weight,
        brand: product.brand || null,
        category: this.categorizeFromTitle(product.title),
        inStock: product.availability !== 'Currently unavailable',
        rating: product.reviews ? product.reviews.rating : null,
        reviewCount: product.reviews ? product.reviews.total_reviews : null
      };
      
    } catch (error) {
      console.error(`❌ AmazonCrawler failed: ${error.message}`);
      throw error;
    }
  }
  
  categorizeFromTitle(title) {
    if (!title) return null;
    
    const text = title.toLowerCase();
    
    if (/\b(sofa|sectional|loveseat|couch|chair|recliner|ottoman|table|desk|dresser|nightstand|bookshelf|cabinet|wardrobe|armoire|bed|frame|headboard|mattress|dining|kitchen|office)\b/.test(text)) return 'furniture';
    if (/\b(tv|television|monitor|laptop|computer|tablet|phone|smartphone|camera|speaker|headphone|earbuds|router|gaming|console|xbox|playstation|nintendo)\b/.test(text)) return 'electronics';
    if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|range|freezer|ac|air.conditioner|heater|vacuum)\b/.test(text)) return 'appliances';
    if (/\b(shirt|pants|dress|jacket|coat|shoes|boots|sneakers|clothing|apparel|jeans|sweater|hoodie|shorts|skirt)\b/.test(text)) return 'clothing';
    if (/\b(book|novel|textbook|magazine|journal|encyclopedia|bible|dictionary)\b/.test(text)) return 'books';
    if (/\b(toy|game|puzzle|doll|action.figure|lego|playset|board.game|video.game|stuffed|plush)\b/.test(text)) return 'toys';
    if (/\b(exercise|fitness|gym|bike|bicycle|treadmill|weights|dumbbells|yoga|golf|tennis|basketball|football|soccer)\b/.test(text)) return 'sports';
    if (/\b(decor|decoration|vase|picture|frame|artwork|painting|candle|lamp|mirror|pillow|curtain|rug|carpet)\b/.test(text)) return 'home-decor';
    if (/\b(tool|hardware|drill|saw|hammer|screwdriver|wrench|toolbox)\b/.test(text)) return 'tools';
    if (/\b(garden|plant|pot|soil|fertilizer|hose|mower|outdoor)\b/.test(text)) return 'garden';
    
    return 'general';
  }
}

module.exports = AmazonCrawler;