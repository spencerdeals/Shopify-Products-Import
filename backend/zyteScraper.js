// backend/zyteScraper.js - Fixed Zyte API Integration with Automatic Extraction
const axios = require('axios');

class ZyteScraper {
  constructor() {
    this.apiKey = process.env.ZYTE_API_KEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.zyte.com/v1/extract';
    
    console.log('🕷️ ZyteScraper Constructor:');
    console.log(`   API Key: ${this.apiKey ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED (v3.0 - Auto Extraction)' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set ZYTE_API_KEY environment variable to enable Zyte scraping');
    } else {
      console.log('   🎯 Ready to use Zyte API with automatic product extraction');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Zyte not configured - missing API key');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🕷️ Zyte scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      console.log('   📤 Sending request to Zyte API with automatic extraction...');
      
      // Use automatic product extraction - this is the key fix!
      const response = await axios.post(this.baseURL, {
        url: url,
        product: true,
        productOptions: {
          extractFrom: 'httpResponseBody'
        },
        httpResponseBody: true
      }, {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 45000
      });

      console.log('✅ Zyte request completed successfully');
      console.log('📊 Response status:', response.status);
      
      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      // Parse the Zyte response using automatic extraction data
      const productData = this.parseZyteResponse(response.data, url, retailer);
      
      console.log('📦 Zyte extraction results:', {
        hasName: !!productData.name,
        hasPrice: !!productData.price,
        hasImage: !!productData.image,
        hasDimensions: !!productData.dimensions,
        hasWeight: !!productData.weight,
        hasVariant: !!productData.variant,
        confidence: productData.confidence
      });

      return productData;

    } catch (error) {
      return this.handleZyteError(error);
    }
  }

  handleZyteError(error) {
    console.error('❌ Zyte scraping failed:', error.message);
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
      
      if (error.response.status === 401) {
        console.error('❌ Authentication failed - check Zyte API key');
      } else if (error.response.status === 403) {
        console.error('❌ Access forbidden - check Zyte subscription');
      } else if (error.response.status >= 500) {
        console.error('❌ Zyte server error - try again later');
      }
    }
    
    throw error;
  }

  parseZyteResponse(data, url, retailer) {
    console.log('🔍 Parsing Zyte response with automatic extraction...');
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true,
      variant: null,
      confidence: null
    };

    // Priority 1: Use Zyte's automatic product extraction
    if (data.product) {
      const product = data.product;
      console.log('   ✅ Using Zyte automatic extraction data');
      
      // Product name
      productData.name = product.name || null;
      if (productData.name) {
        productData.name = productData.name.trim().substring(0, 200);
        console.log('   📝 Product name:', productData.name.substring(0, 50) + '...');
      }

      // Price - handle current price vs regular price
      if (product.price) {
        productData.price = parseFloat(product.price);
        console.log('   💰 Current Price: $' + productData.price);
        
        // Log if there's a sale
        if (product.regularPrice && product.regularPrice > product.price) {
          console.log('   🏷️ Regular Price: $' + product.regularPrice + ' (ON SALE!)');
        }
      } else if (product.regularPrice) {
        productData.price = parseFloat(product.regularPrice);
        console.log('   💰 Regular Price: $' + productData.price);
      }

      // Main image
      if (product.mainImage && product.mainImage.url) {
        productData.image = product.mainImage.url;
        console.log('   🖼️ Main Image: Found');
      } else if (product.images && product.images.length > 0) {
        const firstImage = product.images[0];
        productData.image = typeof firstImage === 'object' ? firstImage.url : firstImage;
        console.log('   🖼️ Image: Found (from images array)');
      }

      // Brand
      if (product.brand && product.brand.name) {
        productData.brand = product.brand.name;
        console.log('   🏷️ Brand:', productData.brand);
      }

      // Category from breadcrumbs
      if (product.breadcrumbs) {
        productData.category = product.breadcrumbs.split(' / ').pop() || null;
        console.log('   📂 Category:', productData.category);
      }

      // Weight
      if (product.weight && product.weight.value) {
        productData.weight = parseFloat(product.weight.value);
        console.log('   ⚖️ Weight:', productData.weight + ' ' + (product.weight.unit || 'lbs'));
      }

      // Dimensions from additionalProperties
      if (product.additionalProperties) {
        const dimensions = this.extractDimensionsFromProperties(product.additionalProperties);
        if (dimensions) {
          productData.dimensions = dimensions;
          console.log('   📏 Dimensions:', `${dimensions.length}" × ${dimensions.width}" × ${dimensions.height}"`);
        }
      }

      // Variants - handle color, size, etc.
      const variantParts = [];
      
      if (product.color) {
        variantParts.push(`Color: ${product.color}`);
      }
      
      if (product.size) {
        variantParts.push(`Size: ${product.size}`);
      }
      
      if (product.material) {
        variantParts.push(`Material: ${product.material}`);
      }
      
      // Check variants array
      if (product.variants && product.variants.length > 0) {
        product.variants.forEach(variant => {
          if (variant.size && !variantParts.some(p => p.includes('Size'))) {
            variantParts.push(`Size: ${variant.size}`);
          }
          if (variant.color && !variantParts.some(p => p.includes('Color'))) {
            variantParts.push(`Color: ${variant.color}`);
          }
        });
      }
      
      if (variantParts.length > 0) {
        productData.variant = variantParts.join(', ');
        console.log('   🎨 Variant:', productData.variant);
      }

      // Confidence score
      if (data.probability) {
        productData.confidence = parseFloat(data.probability);
        console.log('   🎯 Confidence:', (productData.confidence * 100).toFixed(1) + '%');
      }

      // Availability
      productData.inStock = true; // Assume in stock unless we find evidence otherwise
    }

    // Fallback: Parse from HTML if automatic extraction failed
    if (!productData.name && data.httpResponseBody) {
      console.log('   🔍 Falling back to HTML parsing...');
      const htmlData = this.parseHTML(data.httpResponseBody, url, retailer);
      
      // Merge data - prefer automatic extraction but fill gaps with HTML parsing
      productData.name = productData.name || htmlData.name;
      productData.price = productData.price || htmlData.price;
      productData.image = productData.image || htmlData.image;
      productData.dimensions = productData.dimensions || htmlData.dimensions;
      productData.weight = productData.weight || htmlData.weight;
    }

    return productData;
  }

  extractDimensionsFromProperties(properties) {
    if (!properties || typeof properties !== 'string') return null;
    
    // Look for dimension patterns in the properties string
    const patterns = [
      // Pattern: "overall: 25'' H X 30'' W X 60'' L"
      /(\d+(?:\.\d+)?)''\s*H\s*X\s*(\d+(?:\.\d+)?)''\s*W\s*X\s*(\d+(?:\.\d+)?)''\s*L/i,
      // Pattern: "25'' H X 30'' W X 60'' L"
      /(\d+(?:\.\d+)?)''\s*H.*?(\d+(?:\.\d+)?)''\s*W.*?(\d+(?:\.\d+)?)''\s*L/i,
      // Pattern: "25 H X 30 W X 60 L"
      /(\d+(?:\.\d+)?)\s*H\s*X\s*(\d+(?:\.\d+)?)\s*W\s*X\s*(\d+(?:\.\d+)?)\s*L/i,
      // Pattern: "25x30x60"
      /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i
    ];
    
    for (const pattern of patterns) {
      const match = properties.match(pattern);
      if (match) {
        return {
          height: parseFloat(match[1]),
          width: parseFloat(match[2]),
          length: parseFloat(match[3])
        };
      }
    }
    
    return null;
  }

  parseHTML(html, url, retailer) {
    // Fallback HTML parsing - simplified since we have automatic extraction
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null
    };

    // Extract product name from HTML title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      productData.name = titleMatch[1].trim().replace(/\s*\|\s*Wayfair.*$/i, '').substring(0, 200);
    }

    // Extract price from HTML
    const pricePatterns = [
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        const price = parseFloat(match[1].replace(/,/g, ''));
        if (price > 0 && price < 100000) {
          productData.price = price;
          break;
        }
      }
      if (productData.price) break;
    }

    return productData;
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'Amazon';
      if (domain.includes('wayfair.com')) return 'Wayfair';
      if (domain.includes('target.com')) return 'Target';
      if (domain.includes('walmart.com')) return 'Walmart';
      if (domain.includes('bestbuy.com')) return 'Best Buy';
      if (domain.includes('homedepot.com')) return 'Home Depot';
      if (domain.includes('lowes.com')) return 'Lowes';
      if (domain.includes('costco.com')) return 'Costco';
      if (domain.includes('macys.com')) return 'Macys';
      if (domain.includes('ikea.com')) return 'IKEA';
      if (domain.includes('lunafurn.com')) return 'Luna Furniture';
      if (domain.includes('overstock.com')) return 'Overstock';
      if (domain.includes('cb2.com')) return 'CB2';
      if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
      if (domain.includes('westelm.com')) return 'West Elm';
      if (domain.includes('potterybarn.com')) return 'Pottery Barn';
      if (domain.includes('ashleyfurniture.com')) return 'Ashley Furniture';
      if (domain.includes('roomstogo.com')) return 'Rooms To Go';
      if (domain.includes('livingspaces.com')) return 'Living Spaces';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }
}

module.exports = ZyteScraper;