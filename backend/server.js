// backend/zyteScraper.js - Fixed Zyte API Integration
const axios = require('axios');

class ZyteScraper {
  constructor() {
    this.apiKey = process.env.ZYTE_API_KEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.zyte.com/v1/extract';
    
    console.log('🕷️ ZyteScraper Constructor:');
    console.log(`   API Key: ${this.apiKey ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   API Key (first 8 chars): ${this.apiKey ? this.apiKey.substring(0, 8) + '...' : 'N/A'}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED (v2.0)' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set ZYTE_API_KEY environment variable to enable Zyte scraping');
    } else {
      console.log('   🎯 Ready to use Zyte API for web scraping');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Zyte not configured - missing API key');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🕷️ Zyte scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      console.log('   📤 Sending request to Zyte API...');
      
      // Use Basic Auth with API key as username, empty password
      const response = await axios.post(this.baseURL, {
        url: url,
        httpResponseBody: true,
        product: true,
        productOptions: {
          extractFrom: 'httpResponseBody'
        }
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
      console.log('📊 Response headers:', Object.keys(response.headers || {}));
      
      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      // Parse the Zyte response
      const productData = this.parseZyteResponse(response.data, url, retailer);
      
      console.log('📦 Zyte extraction results:', {
        hasName: !!productData.name,
        hasPrice: !!productData.price,
        hasImage: !!productData.image,
        hasDimensions: !!productData.dimensions,
        hasVariant: !!productData.variant
      });

      // Fill in missing data with estimations
      const productName = productData.name || `Product from ${retailer}`;
      const category = productData.category || categorizeProduct(productName, url);
      
      console.log(`   🏷️ Product category: ${category}`);
      
      if (!productData.dimensions) {
        // Try AI estimation first
        // const aiEstimate = await learningSystem.getSmartEstimation(category, productName, retailer);
        // if (aiEstimate) {
        //   productData.dimensions = aiEstimate.dimensions;
        //   productData.weight = productData.weight || aiEstimate.weight;
        //   console.log(`   🤖 AI: Applied learned patterns (confidence: ${(aiEstimate.confidence * 100).toFixed(0)}%)`);
        // } else {
          productData.dimensions = estimateDimensions(category, productName);
          console.log(`   📐 Used category-based estimation for: ${category}`);
        // }
      }
      
      if (!productData.weight) {
        productData.weight = estimateWeight(productData.dimensions, category);
        console.log(`   ⚖️ Estimated weight: ${productData.weight} lbs`);
      }
      
      // Calculate shipping cost
      const shippingCost = calculateShippingCost(
        productData.dimensions,
        productData.weight,
        productData.price || 100
      );
      
      // SAFEGUARD: Final shipping cost validation
      const itemPrice = productData.price || 100;
      const shippingPercentage = (shippingCost / itemPrice) * 100;
      
      if (shippingPercentage > 60) {
        console.log(`   🚨 WARNING: Shipping cost is ${shippingPercentage.toFixed(0)}% of item price - may need manual review`);
      }
      
      // Prepare final product object
      const product = {
        name: productData.name,
        price: productData.price,
        image: productData.image,
        dimensions: productData.dimensions,
        weight: productData.weight,
        brand: productData.brand,
        category: category,
        inStock: productData.inStock,
        variant: productData.variant,
        shippingCost: shippingCost,
        retailer: retailer,
        url: url
      };

      return product;

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
    console.log('🔍 Parsing Zyte response...');
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true,
      variant: null
    };

    // Priority 1: Extract from Zyte's automatic product extraction
    if (data.product) {
      const product = data.product;
      
      // Product name
      productData.name = product.name || product.title || null;
      if (productData.name) {
        productData.name = productData.name.trim().substring(0, 200);
        console.log('   📝 Product name:', productData.name.substring(0, 50) + '...');
      }

      // Price - handle multiple formats
      if (product.price) {
        let priceValue = product.price;
        if (typeof priceValue === 'object' && priceValue.value) {
          priceValue = priceValue.value;
        }
        productData.price = parseFloat(String(priceValue).replace(/[^0-9.]/g, ''));
        if (productData.price > 0 && productData.price < 100000) {
          console.log('   💰 Price: $' + productData.price);
        } else {
          productData.price = null;
        }
      } else if (product.regularPrice) {
        productData.price = parseFloat(String(product.regularPrice).replace(/[^0-9.]/g, ''));
        console.log('   💰 Regular Price: $' + productData.price);
      }

      // Images - handle multiple formats
      if (product.images && product.images.length > 0) {
        const firstImage = product.images[0];
        productData.image = typeof firstImage === 'object' ? firstImage.url : firstImage;
        console.log('   🖼️ Image: Found');
      } else if (product.mainImage) {
        productData.image = typeof product.mainImage === 'object' ? product.mainImage.url : product.mainImage;
        console.log('   🖼️ Image: Found (main)');
      }

      // Brand
      productData.brand = product.brand || null;

      // Category/Breadcrumbs
      if (product.breadcrumbs && product.breadcrumbs.length > 0) {
        productData.category = product.breadcrumbs[product.breadcrumbs.length - 1].name || 
                              product.breadcrumbs[product.breadcrumbs.length - 1];
      }

      // Availability
      if (product.availability) {
        const availability = String(product.availability).toLowerCase();
        productData.inStock = !availability.includes('out of stock') && 
                             !availability.includes('unavailable') &&
                             !availability.includes('sold out');
      }

      // Variants - Enhanced extraction
      if (product.variants && product.variants.length > 0) {
        const selectedVariant = product.variants.find(v => v.selected) || product.variants[0];
        if (selectedVariant) {
          const variantParts = [];
          
          // Smart variant detection - check what the value actually represents
          if (selectedVariant.color) {
            const colorValue = selectedVariant.color.toLowerCase();
          }
          // Collect ALL variant properties from selected variant
          this.extractVariantProperties(selectedVariant, variantParts);
          
          if (variantParts.length > 0) {
            productData.variant = variantParts.join(', ');
            console.log('   🎨 Variant:', productData.variant);
          }
        }
      } else if (product.color || product.size || product.style || product.material || product.finish) {
        // Direct variant properties from product level
        const variantParts = [];
        this.extractVariantProperties(product, variantParts);
        
        if (variantParts.length > 0) {
          productData.variant = variantParts.join(', ');
          console.log('   🎨 Direct Variant:', productData.variant);
        }
      }
    }

    // Priority 2: Parse from browser HTML if structured data is incomplete
    if (data.httpResponseBody && (!productData.name || !productData.price)) {
      console.log('   🔍 Falling back to HTML parsing...');
      const htmlData = this.parseHTML(data.httpResponseBody, url, retailer);
      
      // Merge data - prefer structured data but fill gaps with HTML parsing
      productData.name = productData.name || htmlData.name;
      productData.price = productData.price || htmlData.price;
      productData.image = productData.image || htmlData.image;
      productData.dimensions = productData.dimensions || htmlData.dimensions;
      productData.weight = productData.weight || htmlData.weight;
      // For variants, prefer HTML parsing as it's more accurate
      productData.variant = htmlData.variant || productData.variant;
    }

    return productData;
  }

  extractVariantProperties(obj, variantParts) {
    for (const [prop, value] of Object.entries(obj)) {
      if (value && typeof value === 'string' && value.trim()) {
        const trimmedValue = value.trim();
        if (trimmedValue.length >= 2 && trimmedValue.length <= 50) {
          // Smart categorization based on actual content
          const lowerValue = trimmedValue.toLowerCase();
          
          if (this.isColorValue(lowerValue)) {
            variantParts.push(`Color: ${trimmedValue}`);
          } else if (this.isSizeValue(lowerValue)) {
            variantParts.push(`Size: ${trimmedValue}`);
          } else if (prop === 'material') {
            variantParts.push(`Material: ${trimmedValue}`);
          } else if (prop === 'finish') {
            variantParts.push(`Finish: ${trimmedValue}`);
          } else if (prop === 'style') {
            variantParts.push(`Style: ${trimmedValue}`);
          } else {
            // Generic property
            variantParts.push(trimmedValue);
          }
        }
      }
    }
  }

  isColorValue(value) {
    const colors = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'gray', 'grey', 'brown', 'pink', 'purple', 'orange', 'beige', 'tan', 'navy', 'cream', 'ivory', 'gold', 'silver', 'bronze'];
    return colors.some(color => value.includes(color));
  }

  isSizeValue(value) {
    return /\b(small|medium|large|xl|xxl|xs|twin|full|queen|king|cal|california)\b/.test(value) ||
           /\d+(\.\d+)?\s*(inch|in|ft|feet|cm|mm|x|\"|')/i.test(value);
  }

  parseHTML(html, url, retailer) {
    // Basic HTML parsing fallback
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      variant: null
    };

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      productData.name = titleMatch[1].trim().substring(0, 200);
    }

    // Extract price - look for common price patterns
    const pricePatterns = [
      /\$[\d,]+\.?\d*/g,
      /price[^>]*>[\s\S]*?\$?([\d,]+\.?\d*)/gi,
      /cost[^>]*>[\s\S]*?\$?([\d,]+\.?\d*)/gi
    ];

    for (const pattern of pricePatterns) {
      const matches = html.match(pattern);
      if (matches) {
        for (const match of matches) {
          const price = parseFloat(match.replace(/[^0-9.]/g, ''));
          if (price > 0 && price < 100000) {
            productData.price = price;
            break;
          }
        }
        if (productData.price) break;
      }
    }

    // Extract main image
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch) {
      productData.image = imgMatch[1];
    }

    return productData;
  }

  detectRetailer(url) {
    const domain = url.toLowerCase();
    if (domain.includes('wayfair')) return 'Wayfair';
    if (domain.includes('overstock')) return 'Overstock';
    if (domain.includes('amazon')) return 'Amazon';
    if (domain.includes('homedepot')) return 'Home Depot';
    if (domain.includes('lowes')) return 'Lowes';
    if (domain.includes('target')) return 'Target';
    if (domain.includes('walmart')) return 'Walmart';
    if (domain.includes('crateandbarrel')) return 'Crate & Barrel';
    if (domain.includes('westelm')) return 'West Elm';
    if (domain.includes('potterybarn')) return 'Pottery Barn';
    if (domain.includes('cb2')) return 'CB2';
    if (domain.includes('restorationhardware')) return 'Restoration Hardware';
    return 'Unknown';
  }
}

// Extract product information from manual content with real dimensions
function extractProductFromContent(content, url, retailer, category) {
  console.log('🔍 Extracting product data from manual content...');
  console.log(`   📄 Content length: ${content.length} characters`);
  console.log(`   🏷️ Category: ${category}`);
  console.log(`   🏪 Retailer: ${retailer}`);
  
  const productData = {
    name: null,
    price: null,
    image: null,
    dimensions: null,
    weight: null,
    variant: null
  };
  
  // CRITICAL: Extract REAL product dimensions from content
  console.log('🔍 Searching for product dimensions in content...');
  
  // Show a sample of the content for debugging
  const contentSample = content.substring(0, 1000);
  console.log(`   📄 Content sample: ${contentSample.substring(0, 200)}...`);
  
  const dimPatterns = [
    // Standard dimension formats
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|"|'')/i,
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/i,
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimeters?)/i,
    // Dimension with labels
    /(?:dimensions?|size|measurements?)[\s:]*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    // L x W x H format
    /(?:l|length)[\s:]*(\d+(?:\.\d+)?).*?(?:w|width)[\s:]*(\d+(?:\.\d+)?).*?(?:h|height)[\s:]*(\d+(?:\.\d+)?)/i,
    // Width x Depth x Height
    /(?:width|w)[\s:]*(\d+(?:\.\d+)?).*?(?:depth|d)[\s:]*(\d+(?:\.\d+)?).*?(?:height|h)[\s:]*(\d+(?:\.\d+)?)/i
  ];
  
  console.log(`   🔍 Testing ${dimPatterns.length} dimension patterns...`);
  
  for (const pattern of dimPatterns) {
    const match = content.match(pattern);
    console.log(`   🔍 Pattern ${dimPatterns.indexOf(pattern) + 1}: ${match ? 'MATCH FOUND' : 'no match'}`);
    if (match) {
      console.log(`   ✅ Raw match: "${match[0]}"`);
      console.log(`   📐 Extracted: ${match[1]} x ${match[2]} x ${match[3]}`);
      
      let length = parseFloat(match[1]);
      let width = parseFloat(match[2]);
      let height = parseFloat(match[3]);
      
      // Convert cm to inches if needed
      if (content.toLowerCase().includes('cm') || content.toLowerCase().includes('centimeter')) {
        length = length / 2.54;
        width = width / 2.54;
        height = height / 2.54;
        console.log('   📐 Converted from cm to inches');
      }
      
      // Validate dimensions are reasonable
      if (length > 0 && width > 0 && height > 0 && 
          length < 200 && width < 200 && height < 200) {
        
        console.log(`   ✅ Valid product dimensions: ${length}" × ${width}" × ${height}"`);
        
        // CRITICAL: Add packaging padding based on category
        const paddingFactors = {
          'electronics': 1.3,      // 30% padding for fragile items
          'lighting': 1.4,         // 40% padding for delicate items
          'textiles': 1.2,         // 20% padding for soft goods
          'appliances': 1.15,      // 15% padding for heavy items
          'furniture': 1.25,       // 25% padding for furniture
          'outdoor': 1.2,          // 20% padding for outdoor items
          'rugs': 1.1,             // 10% padding for flat items
          'decor': 1.3,            // 30% padding for decorative items
          'accessories': 1.35      // 35% padding for small fragile items
        };
        
        const paddingFactor = paddingFactors[category] || 1.25;
        console.log(`   📦 Applying ${((paddingFactor - 1) * 100).toFixed(0)}% packaging padding for ${category}`);
        
        productData.dimensions = {
          length: Math.round(length * paddingFactor * 10) / 10,
          width: Math.round(width * paddingFactor * 10) / 10,
          height: Math.round(height * paddingFactor * 10) / 10
        };
        
        console.log(`   📐 Found product dimensions: ${length}" × ${width}" × ${height}"`);
        console.log(`   📦 Added ${((paddingFactor - 1) * 100).toFixed(0)}% packaging padding for ${category}`);
        console.log(`   📦 Final shipping dimensions: ${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
        break;
      } else {
        console.log(`   ❌ Invalid dimensions: ${length}" × ${width}" × ${height}" (out of range)`);
      }
    }
  }
  
  // If no dimensions found, try to extract from URL or use category-based estimation
  if (!productData.dimensions) {
    console.log('   ⚠️ No dimensions found in content, trying URL extraction...');
    console.log(`   🔍 URL: ${url}`);
    
    // Try to extract size from URL (like "85" from "mallorca-85-wood-outdoor-sofa")
    const urlSizeMatch = url.match(/[-_](\d{2,3})[-_]/);
    console.log(`   🔍 URL size pattern: ${urlSizeMatch ? `Found "${urlSizeMatch[1]}"` : 'no match'}`);
    
    if (urlSizeMatch) {
      const extractedSize = parseInt(urlSizeMatch[1]);
      console.log(`   📏 Extracted size from URL: ${extractedSize}"`);
      
      if (extractedSize >= 20 && extractedSize <= 120) {
        // Use extracted size as length, estimate width/height based on category
        const categoryRatios = {
          'furniture': { w: 0.6, h: 0.4 },
          'outdoor': { w: 0.7, h: 0.5 },
          'lighting': { w: 0.3, h: 1.2 },
          'rugs': { w: 0.75, h: 0.01 },
          'general': { w: 0.5, h: 0.5 }
        };
        
        const ratio = categoryRatios[category] || categoryRatios['general'];
        const paddingFactor = 1.15; // 15% padding
        console.log(`   📦 Using category ratios for ${category}: w=${ratio.w}, h=${ratio.h}`);
        
        productData.dimensions = {
          length: Math.round(extractedSize * paddingFactor * 10) / 10,
          width: Math.round(extractedSize * ratio.w * paddingFactor * 10) / 10,
          height: Math.round(extractedSize * ratio.h * paddingFactor * 10) / 10
        };
        
        console.log(`   📐 Extracted size ${extractedSize}" from URL`);
        console.log(`   📦 Estimated shipping dimensions: ${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
      } else {
        console.log(`   ❌ Extracted size ${extractedSize}" is out of valid range (20-120)`);
      }
    }
  }
  
  // Last resort: reasonable category-based estimates (NOT random!)
  if (!productData.dimensions) {
    console.log('   ⚠️ No dimensions found anywhere, using category-based estimate...');
    console.log(`   🏷️ Using estimates for category: ${category}`);
    
    const categoryEstimates = {
      'high-end-furniture': { length: 72, width: 32, height: 30 },
      'furniture': { length: 48, width: 24, height: 30 },
      'outdoor': { length: 60, width: 30, height: 32 },
      'electronics': { length: 20, width: 12, height: 8 },
      'lighting': { length: 18, width: 18, height: 24 },
      'rugs': { length: 96, width: 72, height: 1 },
      'textiles': { length: 24, width: 18, height: 6 },
      'decor': { length: 12, width: 8, height: 10 },
      'accessories': { length: 8, width: 6, height: 4 },
      'appliances': { length: 36, width: 24, height: 36 },
      'general': { length: 24, width: 18, height: 12 }
    };
    
    const estimate = categoryEstimates[category] || categoryEstimates['general'];
    productData.dimensions = {
      length: estimate.length,
      width: estimate.width,
      height: estimate.height
    };
    
    console.log(`   📦 Category-based estimate: ${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
  }
  
  return productData;
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  // High-end furniture retailers get special treatment
  if (/\b(crate|barrel|west.elm|pottery.barn|cb2|restoration.hardware)\b/.test(text)) {
    return 'high-end-furniture';
  }
  
  if (/\b(sofa|sectional|loveseat|couch|chair|recliner|ottoman|table|desk|dresser|nightstand|bookshelf|cabinet|wardrobe|armoire|bed|frame|headboard|mattress|dining|kitchen|office)\b/.test(text)) return 'furniture';
 if (/\b(outdoor|patio|garden|deck|poolside|backyard|exterior|weather|teak|wicker|rattan)\b/.test(text)) return 'outdoor';
  if (/\b(outdoor|patio|garden|deck|poolside|backyard|exterior|weather|teak|wicker|rattan)\b/.test(text)) return 'outdoor';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|smartphone|camera|speaker|headphone|earbuds|router|gaming|console|xbox|playstation|nintendo)\b/.test(text)) return 'electronics';
  if (/\b(lamp|light|lighting|chandelier|sconce|pendant|floor.lamp|table.lamp)\b/.test(text)) return 'lighting';
  if (/\b(rug|carpet|mat|runner)\b/.test(text)) return 'rugs';
  if (/\b(curtain|blind|shade|drape|window.treatment)\b/.test(text)) return 'window-treatments';
  if (/\b(pillow|cushion|throw|blanket|bedding|sheet|comforter|duvet)\b/.test(text)) return 'textiles';
  if (/\b(art|artwork|painting|print|poster|frame|mirror|wall.decor)\b/.test(text)) return 'decor';
  if (/\b(vase|candle|plant|pot|planter|decorative|ornament)\b/.test(text)) return 'accessories';
  if (/\b(appliance|refrigerator|stove|oven|microwave|dishwasher|washer|dryer)\b/.test(text)) return 'appliances';
  
  return 'general';
}

function estimateDimensions(category, productName) {
  const name = productName.toLowerCase();
  
  // Extract any dimensions from the product name first
  const dimensionMatch = name.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
  if (dimensionMatch) {
    return {
      length: parseFloat(dimensionMatch[1]),
      width: parseFloat(dimensionMatch[2]),
      height: parseFloat(dimensionMatch[3])
    };
  }

  // Category-based estimation
  switch (category) {
    case 'high-end-furniture':
      if (name.includes('sofa') || name.includes('sectional')) {
        return { length: 84, width: 36, height: 32 };
      }
      if (name.includes('chair')) {
        return { length: 32, width: 32, height: 36 };
      }
      if (name.includes('table')) {
        return { length: 60, width: 36, height: 30 };
      }
      return { length: 48, width: 24, height: 30 };
      
    case 'furniture':
      if (name.includes('sofa') || name.includes('sectional')) {
        return { length: 78, width: 34, height: 30 };
      }
      if (name.includes('chair')) {
        return { length: 28, width: 28, height: 32 };
      }
      if (name.includes('table')) {
        return { length: 48, width: 30, height: 29 };
      }
      if (name.includes('dresser')) {
        return { length: 60, width: 18, height: 32 };
      }
      if (name.includes('bed')) {
        if (name.includes('king')) return { length: 80, width: 76, height: 14 };
        if (name.includes('queen')) return { length: 80, width: 60, height: 14 };
        return { length: 75, width: 54, height: 14 };
      }
      return { length: 36, width: 18, height: 24 };
      
    case 'outdoor':
      if (name.includes('table')) {
        return { length: 60, width: 36, height: 29 };
      }
      if (name.includes('chair')) {
        return { length: 24, width: 24, height: 36 };
      }
      return { length: 48, width: 24, height: 30 };
      
    case 'lighting':
      if (name.includes('chandelier')) {
        return { length: 24, width: 24, height: 36 };
      }
      if (name.includes('floor')) {
        return { length: 12, width: 12, height: 60 };
      }
      return { length: 12, width: 12, height: 18 };
      
    case 'rugs':
      if (name.includes('runner')) {
        return { length: 96, width: 30, height: 0.5 };
      }
      if (name.includes('large') || name.includes('9x12')) {
        return { length: 144, width: 108, height: 0.5 };
      }
      return { length: 96, width: 72, height: 0.5 };
      
    case 'electronics':
      if (name.includes('tv')) {
        return { length: 48, width: 28, height: 3 };
      }
      if (name.includes('laptop')) {
        return { length: 14, width: 10, height: 1 };
      }
      return { length: 12, width: 8, height: 6 };
      
    default:
      return { length: 24, width: 12, height: 12 };
  }
}

function estimateWeight(dimensions, category) {
  const volume = dimensions.length * dimensions.width * dimensions.height;
  
  // Weight estimation based on category and volume
  switch (category) {
    case 'high-end-furniture':
      return Math.max(15, Math.round(volume * 0.008)); // Heavier, quality materials
      
    case 'furniture':
      return Math.max(10, Math.round(volume * 0.006));
      
    case 'outdoor':
      return Math.max(8, Math.round(volume * 0.005)); // Weather-resistant materials
      
    case 'electronics':
      return Math.max(2, Math.round(volume * 0.01)); // Dense but compact
      
    case 'lighting':
      return Math.max(3, Math.round(volume * 0.003)); // Lighter materials
      
    case 'rugs':
      return Math.max(5, Math.round(volume * 0.02)); // Fabric density
      
    case 'textiles':
      return Math.max(1, Math.round(volume * 0.001)); // Very light
      
    case 'appliances':
      return Math.max(25, Math.round(volume * 0.015)); // Heavy materials
      
    default:
      return Math.max(5, Math.round(volume * 0.004));
  }
}

function calculateShippingCost(dimensions, weight, itemPrice) {
  // Base shipping calculation
  const volume = dimensions.length * dimensions.width * dimensions.height;
  const volumeWeight = volume / 166; // Dimensional weight factor
  const billableWeight = Math.max(weight, volumeWeight);
  
  // Base cost calculation
  let shippingCost = 15; // Base rate
  
  // Weight-based pricing
  if (billableWeight <= 10) {
    shippingCost += billableWeight * 2;
  } else if (billableWeight <= 50) {
    shippingCost += 20 + (billableWeight - 10) * 3;
  } else if (billableWeight <= 150) {
    shippingCost += 140 + (billableWeight - 50) * 4;
  } else {
    shippingCost += 540 + (billableWeight - 150) * 5;
  }
  
  // Size surcharges
  const maxDimension = Math.max(dimensions.length, dimensions.width, dimensions.height);
  if (maxDimension > 96) {
    shippingCost += 100; // Oversized surcharge
  } else if (maxDimension > 72) {
    shippingCost += 50;
  } else if (maxDimension > 48) {
    shippingCost += 25;
  }
  
  // Item value adjustment
  if (itemPrice > 1000) {
    shippingCost *= 1.2; // Premium handling
  } else if (itemPrice < 50) {
    shippingCost = Math.min(shippingCost, itemPrice * 0.5); // Cap at 50% of item value
  }
  
  // Final safeguards
  shippingCost = Math.max(15, Math.min(shippingCost, 800)); // Min $15, Max $800
  
  return Math.round(shippingCost);
}

module.exports = ZyteScraper;