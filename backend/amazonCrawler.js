// backend/amazonCrawler.js
const amazonCrawler = require('amazon-crawler');

class AmazonCrawler {
  constructor() {
    this.enabled = true;
    console.log('🛒 AmazonCrawler initialized with junglee/amazon-crawler');
  }

  isAvailable() {
    return this.enabled;
  }

  // Extract ASIN from Amazon URL
  extractASIN(url) {
    try {
      // Common ASIN patterns in Amazon URLs
      const asinPatterns = [
        /\/dp\/([A-Z0-9]{10})/i,
        /\/gp\/product\/([A-Z0-9]{10})/i,
        /\/product\/([A-Z0-9]{10})/i,
        /asin=([A-Z0-9]{10})/i,
        /\/([A-Z0-9]{10})(?:\/|\?|$)/i
      ];
      
      for (const pattern of asinPatterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting ASIN:', error);
      return null;
    }
  }

  // Extract search keyword from Amazon URL or product title
  extractKeyword(url) {
    try {
      const urlObj = new URL(url);
      
      // Try to get keyword from URL parameters
      const keywords = urlObj.searchParams.get('keywords') || 
                      urlObj.searchParams.get('k') || 
                      urlObj.searchParams.get('field-keywords');
      
      if (keywords) {
        return decodeURIComponent(keywords);
      }
      
      // Extract from URL path
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      
      // Look for meaningful parts (skip common Amazon path segments)
      const skipParts = ['dp', 'gp', 'product', 's', 'ref'];
      const meaningfulParts = pathParts.filter(part => 
        !skipParts.includes(part.toLowerCase()) && 
        !/^[A-Z0-9]{10}$/i.test(part) && // Skip ASINs
        part.length > 2
      );
      
      if (meaningfulParts.length > 0) {
        return meaningfulParts.join(' ').replace(/-/g, ' ');
      }
      
      // Fallback: use a generic search term
      return 'product';
      
    } catch (error) {
      console.error('Error extracting keyword:', error);
      return 'product';
    }
  }

  async scrapeProduct(url) {
    console.log(`🛒 Amazon crawler processing: ${url.substring(0, 60)}...`);
    
    try {
      // Extract ASIN first
      const asin = this.extractASIN(url);
      console.log(`   📋 Extracted ASIN: ${asin || 'Not found'}`);
      
      // Extract keyword for search
      const keyword = this.extractKeyword(url);
      console.log(`   🔍 Using keyword: "${keyword}"`);
      
      // Use amazon-crawler to search for the product
      const searchResults = await amazonCrawler({
        keyword: keyword,
        number: 5, // Get top 5 results to find the best match
        country: 'US',
        category: 'aps', // All departments
        cookie: '', // No cookie needed for basic search
        cli: false,
        filetype: '',
        asyncToCsv: false,
        bulk: false,
        sort: false,
        discount: false,
        sponsored: true,
        host: 'www.amazon.com'
      });
      
      if (!searchResults || !Array.isArray(searchResults) || searchResults.length === 0) {
        throw new Error('No results from amazon-crawler');
      }
      
      console.log(`   📦 Found ${searchResults.length} Amazon results`);
      
      // If we have an ASIN, try to find exact match first
      let selectedProduct = null;
      
      if (asin) {
        selectedProduct = searchResults.find(product => 
          product.asin === asin || 
          (product.url && product.url.includes(asin))
        );
        
        if (selectedProduct) {
          console.log(`   ✅ Found exact ASIN match`);
        }
      }
      
      // If no exact match, use the first result (most relevant)
      if (!selectedProduct) {
        selectedProduct = searchResults[0];
        console.log(`   📍 Using first search result as best match`);
      }
      
      // Extract and clean the product data
      const productData = this.extractProductData(selectedProduct);
      
      console.log(`   📝 Extracted data:`, {
        hasName: !!productData.name,
        hasPrice: !!productData.price,
        hasImage: !!productData.image,
        hasVariant: !!productData.variant,
        hasDimensions: !!productData.dimensions,
        hasWeight: !!productData.weight
      });
      
      return productData;
      
    } catch (error) {
      console.error(`❌ Amazon crawler failed: ${error.message}`);
      throw error;
    }
  }

  extractProductData(product) {
    const data = {
      name: null,
      price: null,
      image: null,
      variant: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };
    
    // Extract name/title
    if (product.title) {
      data.name = this.cleanText(product.title);
    }
    
    // Extract price with multiple fallbacks
    data.price = this.extractPrice(product);
    
    // Extract image
    if (product.thumbnail) {
      data.image = product.thumbnail;
    } else if (product.image) {
      data.image = product.image;
    }
    
    // Extract variant information from title or other fields
    data.variant = this.extractVariant(product);
    
    // Extract dimensions and weight from description if available
    if (product.description) {
      const dimensions = this.extractDimensions(product.description);
      if (dimensions) {
        data.dimensions = dimensions;
      }
      
      const weight = this.extractWeight(product.description);
      if (weight) {
        data.weight = weight;
      }
    }
    
    // Extract brand
    if (product.brand) {
      data.brand = this.cleanText(product.brand);
    }
    
    // Extract category
    if (product.category) {
      data.category = this.cleanText(product.category);
    }
    
    // Determine stock status (if reviews > 0, likely in stock)
    if (product.reviews && typeof product.reviews === 'object') {
      const reviewCount = product.reviews.total_reviews || 0;
      data.inStock = reviewCount > 0;
    }
    
    return data;
  }

  extractPrice(product) {
    // Try multiple price fields
    const priceFields = ['price', 'current_price', 'sale_price', 'list_price'];
    
    for (const field of priceFields) {
      if (product[field]) {
        const price = this.parsePrice(product[field]);
        if (price && price > 0) {
          return price;
        }
      }
    }
    
    // Try to extract from title if price is mentioned
    if (product.title) {
      const priceMatch = product.title.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
      if (priceMatch) {
        return parseFloat(priceMatch[1].replace(/,/g, ''));
      }
    }
    
    return null;
  }

  parsePrice(priceValue) {
    if (typeof priceValue === 'number') {
      return priceValue;
    }
    
    if (typeof priceValue === 'string') {
      // Remove currency symbols and extract number
      const cleaned = priceValue.replace(/[^0-9.,]/g, '');
      const number = parseFloat(cleaned.replace(/,/g, ''));
      return isNaN(number) ? null : number;
    }
    
    if (typeof priceValue === 'object' && priceValue !== null) {
      // Handle price objects
      const possibleFields = ['value', 'amount', 'price', 'current', 'sale'];
      for (const field of possibleFields) {
        if (priceValue[field]) {
          const parsed = this.parsePrice(priceValue[field]);
          if (parsed) return parsed;
        }
      }
    }
    
    return null;
  }

  extractVariant(product) {
    // Look for variant information in various fields
    const variantSources = [];
    
    // Check for color information
    if (product.color) {
      variantSources.push(this.cleanText(product.color));
    }
    
    // Check for size information
    if (product.size) {
      variantSources.push(this.cleanText(product.size));
    }
    
    // Check for style information
    if (product.style) {
      variantSources.push(this.cleanText(product.style));
    }
    
    // Extract from title - look for common variant patterns
    if (product.title) {
      const title = product.title;
      
      // Look for color patterns
      const colorMatch = title.match(/(?:Color|Colour):\s*([^,\-\|]+)/i) ||
                        title.match(/\b(Black|White|Red|Blue|Green|Yellow|Orange|Purple|Pink|Brown|Gray|Grey|Silver|Gold)\b/i);
      
      if (colorMatch && colorMatch[1]) {
        variantSources.push(colorMatch[1].trim());
      }
      
      // Look for size patterns
      const sizeMatch = title.match(/(?:Size|Dimensions?):\s*([^,\-\|]+)/i) ||
                       title.match(/\b(Small|Medium|Large|XL|XXL|XS|\d+["\s]*x\s*\d+["\s]*|\d+\s*inch|\d+\s*ft)\b/i);
      
      if (sizeMatch && sizeMatch[1]) {
        variantSources.push(sizeMatch[1].trim());
      }
    }
    
    // Return the first meaningful variant found
    const variant = variantSources.find(v => v && v.length > 1 && v.length < 50);
    return variant || null;
  }

  extractDimensions(text) {
    if (!text) return null;
    
    // Look for dimension patterns
    const patterns = [
      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
      /(?:dimensions?|size):\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
      /L:\s*(\d+(?:\.\d+)?).*W:\s*(\d+(?:\.\d+)?).*H:\s*(\d+(?:\.\d+)?)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          length: parseFloat(match[1]),
          width: parseFloat(match[2]),
          height: parseFloat(match[3])
        };
      }
    }
    
    return null;
  }

  extractWeight(text) {
    if (!text) return null;
    
    // Look for weight patterns
    const patterns = [
      /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
      /(?:weight|shipping weight):\s*(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
      /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        let weight = parseFloat(match[1]);
        
        // Convert kg to lbs if needed
        if (/kg/i.test(match[0])) {
          weight *= 2.205;
        }
        
        return Math.round(weight * 10) / 10;
      }
    }
    
    return null;
  }

  cleanText(text) {
    if (!text) return null;
    
    return text
      .toString()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-.,()]/g, '')
      .substring(0, 200);
  }
}

module.exports = AmazonCrawler;