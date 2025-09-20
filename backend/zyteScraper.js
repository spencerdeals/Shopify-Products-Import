// backend/zyteScraper.js - Fixed Zyte API Integration with Automatic Extraction
const axios = require('axios');
const cheerio = require('cheerio');

class ZyteScraper {
  constructor() {
    this.apiKey = process.env.ZYTE_API_KEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.zyte.com/v1/extract';
    
    console.log('🕷️ ZyteScraper Constructor:');
    console.log(`   API Key: ${this.apiKey ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED (v4.0 - Fixed Price Parsing)' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set ZYTE_API_KEY environment variable to enable Zyte scraping');
    } else {
      console.log('   🎯 Ready to use Zyte API with automatic product extraction and smart price parsing');
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
      
      // DEBUG: Log the exact request we're sending
      const requestPayload = {
        url: url,
        browserHtml: true,
        product: true,
        productOptions: {
          extractFrom: "browserHtml",
          ai: true
        }
      };
      
      console.log('🚨 DEBUG: Exact request payload:', JSON.stringify(requestPayload, null, 2));
      console.log('🚨 DEBUG: API Key (first 8 chars):', this.apiKey.substring(0, 8) + '...');
      console.log('🚨 DEBUG: Base URL:', this.baseURL);
      
      // DEBUG: Log exact axios config
      const axiosConfig = {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate'
        },
        timeout: 90000
      };
      
      console.log('🚨 DEBUG: Exact axios config:', JSON.stringify(axiosConfig, null, 2));
      
      // Use the EXACT same format as Zyte playground - simplified request
      const response = await axios.post(this.baseURL, requestPayload, axiosConfig);

      console.log('✅ Zyte request completed successfully');
      console.log('📊 Response status:', response.status);
      console.log('📊 Response headers:', JSON.stringify(response.headers, null, 2));
      
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
    
    // EMERGENCY DEBUG - Let's see what Zyte is actually returning!
    console.log('🚨 EMERGENCY DEBUG - Raw Zyte response:');
    console.log('🚨 Full data object:', JSON.stringify(data, null, 2));
    if (data.product) {
      console.log('🚨 Product object:', JSON.stringify(data.product, null, 2));
    }
    if (data.httpResponseBody) {
      console.log('🚨 HTML length:', data.httpResponseBody.length);
      console.log('🚨 HTML preview:', data.httpResponseBody.substring(0, 500));
    }
    
    // EMERGENCY DEBUG - Let's see what Zyte is actually returning!
    console.log('🚨 EMERGENCY DEBUG - Raw Zyte response:');
    console.log('🚨 Full data object:', JSON.stringify(data, null, 2));
    if (data.product) {
      console.log('🚨 Product object:', JSON.stringify(data.product, null, 2));
    }
    if (data.httpResponseBody) {
      console.log('🚨 HTML length:', data.httpResponseBody.length);
      console.log('🚨 HTML preview:', data.httpResponseBody.substring(0, 500));
    }
    
    // CRITICAL: Check if we got blocked by anti-bot
    if (data.httpResponseBody) {
      const html = data.httpResponseBody;
      if (html.includes('akam-sw.js') || 
          html.includes('challenge') || 
          html.includes('bot detection') ||
          html.includes('SDk4Z/hTt/AOPx') ||
          html.length < 5000) {
        console.log('🚨 DETECTED BOT BLOCKING! Crate & Barrel is using anti-bot protection');
        console.log('🚨 HTML length:', html.length);
        console.log('🚨 Contains akam-sw.js:', html.includes('akam-sw.js'));
        throw new Error('Bot detection triggered - need different approach');
      }
    }
    
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

      // SMART PRICE PARSING - Fixed to handle incorrect Zyte prices
      let extractedPrice = null;
      let regularPrice = null;
      
      if (product.price) {
        // Handle different price formats from Zyte
        if (typeof product.price === 'object' && product.price.value) {
          extractedPrice = parseFloat(product.price.value);
        } else if (typeof product.price === 'string') {
          // Extract number from string like "$2,899.00"
          const priceMatch = product.price.match(/[\d,]+\.?\d*/);
          if (priceMatch) {
            extractedPrice = parseFloat(priceMatch[0].replace(/,/g, ''));
          }
        } else {
          extractedPrice = parseFloat(product.price);
        }
        console.log('   💰 Zyte extracted price: $' + extractedPrice);
      }
      
      if (product.regularPrice) {
        if (typeof product.regularPrice === 'object' && product.regularPrice.value) {
          regularPrice = parseFloat(product.regularPrice.value);
        } else if (typeof product.regularPrice === 'string') {
          const priceMatch = product.regularPrice.match(/[\d,]+\.?\d*/);
          if (priceMatch) {
            regularPrice = parseFloat(priceMatch[0].replace(/,/g, ''));
          }
        } else {
          regularPrice = parseFloat(product.regularPrice);
        }
        console.log('   🏷️ Zyte regular price: $' + regularPrice);
      }
      
      // Validate if Zyte's price makes sense
      let priceIsValid = true;
      if (extractedPrice && regularPrice && extractedPrice > 0 && regularPrice > 0) {
        // If extracted price is less than 30% of regular price, it's probably wrong
        const discountPercent = (regularPrice - extractedPrice) / regularPrice;
        if (discountPercent > 0.7) {
          console.log('   ⚠️ Zyte price seems too low (>70% discount), will verify with HTML parsing');
          priceIsValid = false;
        }
      } else if (extractedPrice && extractedPrice > 0) {
        // If we only have extracted price and it's valid, use it
        priceIsValid = true;
      }
      
      if (priceIsValid && extractedPrice && extractedPrice > 0) {
        productData.price = extractedPrice;
        console.log('   ✅ Using Zyte price: $' + productData.price);
      } else {
        console.log('   🔍 Zyte price invalid, falling back to HTML parsing...');
        const htmlPrice = this.extractPriceFromHTML(data.httpResponseBody);
        if (htmlPrice) {
          productData.price = htmlPrice;
          console.log('   ✅ Using HTML parsed price: $' + productData.price);
        } else {
          if (extractedPrice && extractedPrice > 0) {
            productData.price = extractedPrice; // Use Zyte price as last resort
            console.log('   ⚠️ Using Zyte price as fallback: $' + productData.price);
          } else {
            console.log('   ❌ No valid price found anywhere');
          }
        }
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
      if (product.breadcrumbs && typeof product.breadcrumbs === 'string') {
        productData.category = product.breadcrumbs.split(' / ').pop() || null;
        console.log('   📂 Category:', productData.category);
      } else if (product.breadcrumbs && Array.isArray(product.breadcrumbs)) {
        productData.category = product.breadcrumbs[product.breadcrumbs.length - 1] || null;
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

  extractPriceFromHTML(html) {
    if (!html) return null;
    
    const $ = cheerio.load(html);
    
    // Wayfair-specific price selectors (most specific first)
    const priceSelectors = [
      '.MoneyPrice',
      '[data-testid="price"]',
      '.BasePriceBlock .MoneyPrice',
      '.PriceBlock .MoneyPrice',
      '.price-current',
      '.current-price'
    ];
    
    console.log('   🔍 Searching for price in HTML...');
    
    for (const selector of priceSelectors) {
      const elements = $(selector);
      console.log(`   🔍 Found ${elements.length} elements for selector: ${selector}`);
      
      elements.each((i, el) => {
        const priceText = $(el).text().trim();
        console.log(`   💰 Price text found: "${priceText}"`);
        
        // Extract price from text like "$349.99" or "349.99"
        const priceMatch = priceText.match(/\$?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          // Filter for reasonable furniture prices
          if (price >= 50 && price <= 10000) {
            console.log(`   ✅ Valid price found: $${price}`);
            return price;
          }
        }
      });
    }
    
    // Fallback: Search for price patterns in raw HTML
    const pricePatterns = [
      /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      const validPrices = [];
      
      for (const match of matches) {
        const price = parseFloat(match[1].replace(/,/g, ''));
        if (price >= 50 && price <= 10000) {
          validPrices.push(price);
        }
      }
      
      if (validPrices.length > 0) {
        // Return the most common price (likely the current price)
        const priceFreq = {};
        validPrices.forEach(p => priceFreq[p] = (priceFreq[p] || 0) + 1);
        const mostCommonPrice = Object.keys(priceFreq).reduce((a, b) => 
          priceFreq[a] > priceFreq[b] ? a : b
        );
        console.log(`   ✅ Most common price in HTML: $${mostCommonPrice}`);
        return parseFloat(mostCommonPrice);
      }
    }
    
    console.log('   ❌ No valid price found in HTML');
    return null;
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
    productData.price = this.extractPriceFromHTML(html);

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