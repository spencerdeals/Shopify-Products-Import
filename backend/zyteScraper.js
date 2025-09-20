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
      const strategies = [
        {
          name: "ai-extraction",
          payload: {
            url: url,
            product: true,
            productOptions: {
              extractFrom: "httpResponseBody"
            }
          }
        },
        {
          name: "browser-request", 
          payload: {
            url: url,
            browserHtml: true,
            product: true
          }
        },
        {
          name: "default-extraction",
          payload: {
            url: url,
            product: true
          }
        }
      ];
      
      let lastError = null;
      let lastGoodResult = null;
      
      for (const strategy of strategies) {
        console.log(`   🎯 Trying strategy: ${strategy.name}`);
        
        try {
          const response = await axios.post(this.baseURL, strategy.payload, {
            auth: {
              username: this.apiKey,
              password: ''
            },
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip, deflate'
            },
            timeout: 60000
          });
          
          console.log(`   ✅ Strategy ${strategy.name} succeeded!`);
          console.log('📊 Response status:', response.status);
          
          if (response.data && response.data.product) {
            const confidence = response.data.product.metadata?.probability;
            console.log(`   🎯 Confidence: ${confidence ? (confidence * 100).toFixed(1) + '%' : 'unknown'}`);
            
            if (confidence && confidence > 0.8) {
              console.log(`   🚀 High confidence result with strategy: ${strategy.name}`);
              return this.parseZyteResponse(response.data, url, retailer);
            } else if (confidence && confidence > 0.3) {
              console.log(`   ⚠️ Medium confidence result with strategy: ${strategy.name}, continuing...`);
              // Store this result but try next strategy
              lastGoodResult = { data: response.data, strategy: strategy.name };
            }
          }
          
          console.log(`   ⚠️ Strategy ${strategy.name} low/no confidence, trying next...`);
          
        } catch (error) {
          console.log(`   ❌ Strategy ${strategy.name} failed: ${error.message}`);
          lastError = error;
          continue;
        }
      }
      
      // If we have a medium confidence result, use it
      if (lastGoodResult) {
        console.log(`   📊 Using medium confidence result from ${lastGoodResult.strategy}`);
        return this.parseZyteResponse(lastGoodResult.data, url, retailer);
      }
      
      throw lastError || new Error('All strategies failed');
      
    } catch (error) {
      return this.handleZyteError(error);
    }
  }

  async scrapeProductFallback(url) {
    const retailer = this.detectRetailer(url);
    console.log('🔄 Fallback scraping with browser HTML...');
    
    try {
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
        timeout: 90000  // Increased to 90 seconds for complex pages
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
    
    // Debug what we received
    console.log('📊 Response confidence:', data.product?.metadata?.probability);
    console.log('📊 Has product data:', !!data.product);
    console.log('📊 Browser HTML length:', data.browserHtml?.length || 0);
    console.log('📊 Raw Zyte price data:', {
      price: data.product?.price,
      priceType: typeof data.product?.price,
      salePrice: data.product?.salePrice,
      currentPrice: data.product?.currentPrice,
      specialPrice: data.product?.specialPrice
    });
    
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
      allVariants: [],
      confidence: null
    };

    // Priority 1: Use Zyte's automatic product extraction
    if (data.product) {
      const product = data.product;
      console.log('   ✅ Using Zyte automatic extraction data with confidence:', product.metadata?.probability);
      
      // Product name
      productData.name = product.name || null;
      if (productData.name) {
        productData.name = productData.name.trim().substring(0, 200);
        console.log('   📝 Product name:', productData.name.substring(0, 50) + '...');
      }

      // Enhanced price parsing - use the main price from Zyte (it's already the correct sale price)
      if (product.price) {
        // Try different price fields in priority order
        let priceValue = null;
        
        // Priority 1: Sale/Special prices
        if (product.salePrice) {
          priceValue = product.salePrice;
          console.log('   💰 Using salePrice:', priceValue);
        } else if (product.currentPrice) {
          priceValue = product.currentPrice;
          console.log('   💰 Using currentPrice:', priceValue);
        } else if (product.specialPrice) {
          priceValue = product.specialPrice;
          console.log('   💰 Using specialPrice:', priceValue);
        } else {
          // Priority 2: Main price field
          priceValue = product.price;
          console.log('   💰 Using main price:', priceValue);
        }
        
        // Parse the price value
        if (typeof priceValue === 'string') {
          // Remove currency symbols and parse
          const cleanPrice = priceValue.replace(/[$,]/g, '');
          productData.price = parseFloat(cleanPrice);
        } else if (typeof priceValue === 'number') {
          productData.price = priceValue;
        }
        
        if (productData.price && productData.price > 0) {
          console.log('   💰 Final Price: $' + productData.price);
        } else {
          console.log('   ❌ Failed to parse price from:', priceValue);
        }
      }

      // Enhanced image extraction - prefer high-quality variant images
      if (product.images && product.images.length > 0) {
        // Use the main image (highest quality) from Zyte
        const mainImageUrl = product.mainImage?.url || product.images[0]?.url || product.images[0];
        if (mainImageUrl && mainImageUrl.startsWith('http')) {
          productData.image = mainImageUrl;
          console.log('   🖼️ Main Image: Found');
        }
      } else if (product.mainImage && product.mainImage.url) {
        productData.image = product.mainImage.url;
        console.log('   🖼️ Main Image: Found');
      }

      // Brand
      if (product.brand && product.brand.name) {
        productData.brand = product.brand.name;
        console.log('   🏷️ Brand:', productData.brand);
      }

      // Category from breadcrumbs
      if (product.breadcrumbs && Array.isArray(product.breadcrumbs) && product.breadcrumbs.length > 0) {
        const lastCrumb = product.breadcrumbs[product.breadcrumbs.length - 1];
        productData.category = typeof lastCrumb === 'object' ? lastCrumb.name : lastCrumb;
        console.log('   📂 Category:', productData.category);
      } else if (product.breadcrumbs && typeof product.breadcrumbs === 'string') {
        productData.category = product.breadcrumbs.split(' / ').pop() || null;
        console.log('   📂 Category:', productData.category);
      }

      // Enhanced variant extraction using Zyte's rich variant data
      const variants = [];
      
      // Use Zyte's variants array if available (this is the gold standard)
      if (product.variants && Array.isArray(product.variants)) {
        console.log('   🎯 Using Zyte variants array:', product.variants.length, 'variants');
        
        product.variants.forEach(variant => {
          if (variant.color) {
            // Clean up the color variant
            const colorValue = variant.color.replace(' selected', '').trim();
            if (colorValue && !variants.some(v => v.includes(colorValue))) {
              variants.push(`Color: ${colorValue}`);
            }
          }
          if (variant.size) {
            // Clean up the size variant
            const sizeValue = variant.size.replace('Size: ', '').trim();
            if (sizeValue && !variants.some(v => v.includes(sizeValue))) {
              variants.push(`Size: ${sizeValue}`);
            }
          }
        });
      }
      
      // Add orientation from additionalProperties
      if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
        const orientationProp = product.additionalProperties.find(prop => prop.name === 'orientation');
        if (orientationProp && orientationProp.value) {
          variants.push(`Orientation: ${orientationProp.value}`);
          console.log('   🧭 Orientation variant:', orientationProp.value);
        }
        
        const fabricProp = product.additionalProperties.find(prop => prop.name === 'fabric');
        if (fabricProp && fabricProp.value && !variants.some(v => v.includes(fabricProp.value))) {
          variants.push(`Fabric: ${fabricProp.value}`);
          console.log('   🧵 Fabric variant:', fabricProp.value);
        }
      }
      
      // Fallback to individual fields if variants array not available
      if (variants.length === 0) {
        if (product.color) {
          const colorValue = product.color.replace(' selected', '').trim();
          variants.push(`Color: ${colorValue}`);
          console.log('   🎨 Color variant:', colorValue);
        }
        
        if (product.size) {
          variants.push(`Size: ${product.size}`);
          console.log('   📏 Size variant:', product.size);
        }
      }
      
      // Extract dimensions from size if available
      const sizeInfo = product.size || product.additionalProperties?.find(p => p.name === 'size')?.value;
      if (sizeInfo) {
        const sizeMatch = sizeInfo.match(/(\d+(?:\.\d+)?)"?\s*H\s*x\s*(\d+(?:\.\d+)?)"?\s*W\s*x\s*(\d+(?:\.\d+)?)"?\s*D/);
        if (sizeMatch) {
          productData.dimensions = {
            height: parseFloat(sizeMatch[1]),
            length: parseFloat(sizeMatch[2]), // Width becomes length
            width: parseFloat(sizeMatch[3])   // Depth becomes width  
          };
          console.log('   📏 Dimensions extracted:', `${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
        }
      }
      
      // Store all variants
      productData.allVariants = variants;
      
      // Create a comprehensive primary variant
      if (variants.length > 0) {
        productData.variant = variants.join(' • ');
        console.log('   🎯 Final variants:', productData.variant);
      }

      // Availability
      if (product.availability) {
        productData.inStock = product.availability.toLowerCase() === 'instock';
        console.log('   📦 In Stock:', productData.inStock);
      }


      // Confidence score
      if (product.metadata && product.metadata.probability) {
        productData.confidence = parseFloat(product.metadata.probability);
        console.log('   🎯 Confidence:', (productData.confidence * 100).toFixed(1) + '%');
      }

      console.log('   ✅ Zyte extraction successful!');
      return productData;
    }

    console.log('   ✅ Zyte parsing completed!');

    return productData;
  }

  extractPriceFromHTML(html) {
    if (!html) return null;
    
    const $ = cheerio.load(html);
    
    // Wayfair-specific price selectors - PRIORITIZE SALE PRICES
    const priceSelectors = [
      // Sale/current prices first (highest priority)
      '.SalePriceBlock .MoneyPrice',
      '.CurrentPriceBlock .MoneyPrice', 
      '.price-current',
      '.sale-price',
      '.current-price',
      '[data-testid="current-price"]',
      '[data-testid="sale-price"]',
      '.price-now',
      '.price-special',
      // Standard price selectors (lower priority)
      '.MoneyPrice',
      '[data-testid="price"]',
      '.BasePriceBlock .MoneyPrice',
      '.PriceBlock .MoneyPrice'
    ];

    return this.extractSalePriceFromHTML(html);
  }

  extractSalePriceFromHTML(html) {
    if (!html) return null;
    
    const $ = cheerio.load(html);
    
    // Enhanced Wayfair-specific sale price selectors
    const salePriceSelectors = [
      // Wayfair sale price selectors (highest priority)
      '.SalePriceBlock .MoneyPrice',
      '.CurrentPriceBlock .MoneyPrice',
      '[data-testid="current-price"]',
      '[data-testid="sale-price"]',
      '.price-current',
      '.sale-price',
      '.price-now',
      '.price-special',
      // Look for prices in red or highlighted containers
      '.price-red .MoneyPrice',
      '.highlight-price .MoneyPrice',
      '.special-price .MoneyPrice',
      // Generic sale price patterns
      '[class*="sale"] [class*="price"]',
      '[class*="current"] [class*="price"]',
      '[class*="now"] [class*="price"]'
    ];
    
    const regularPriceSelectors = [
      '.MoneyPrice',
      '[data-testid="price"]',
      '.BasePriceBlock .MoneyPrice',
      '.PriceBlock .MoneyPrice',
      '.price'
    ];
    
    console.log('   🔍 Searching for price in HTML...');
    
    // First, try to find sale prices
    for (const selector of salePriceSelectors) {
      const elements = $(selector);
      console.log(`   🔍 Checking sale price selector: ${selector} (${elements.length} elements)`);
      
      elements.each((i, el) => {
        const priceText = $(el).text().trim();
        console.log(`   💰 Sale price text found: "${priceText}"`);
        
        const priceMatch = priceText.match(/\$?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (price >= 10 && price <= 10000) {
            console.log(`   ✅ SALE PRICE FOUND: $${price} from ${selector}`);
            return price;
          }
        }
      });
    }
    
    // If no sale price found, look for regular prices
    console.log('   ⚠️ No sale price found, checking regular prices...');
    let foundPrices = [];
    
    for (const selector of regularPriceSelectors) {
      const elements = $(selector);
      console.log(`   🔍 Checking regular price selector: ${selector} (${elements.length} elements)`);
      
      elements.each((i, el) => {
        const priceText = $(el).text().trim();
        console.log(`   💰 Regular price text: "${priceText}"`);
        
        const priceMatch = priceText.match(/\$?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (price >= 10 && price <= 10000) {
            foundPrices.push({ price, selector, text: priceText });
            console.log(`   ✅ Regular price found: $${price} from ${selector}`);
          }
        }
      });
    }
    
    // Return the first regular price found
    if (foundPrices.length > 0) {
      const bestPrice = foundPrices[0];
      console.log(`   🎯 Using regular price $${bestPrice.price} from ${bestPrice.selector}`);
      return bestPrice.price;
    }
    
    // Final fallback: Search for price patterns in raw HTML with sale priority
    const pricePatterns = [
      // Sale price patterns (highest priority)
      /(?:sale|now|current|special|save)[\s\S]{0,50}?\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi,
      /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)[\s\S]{0,50}?(?:sale|now|current|special|save)/gi,
      // Regular price patterns
      /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      const validPrices = [];
      
      for (const match of matches) {
        const price = parseFloat(match[1].replace(/,/g, ''));
        if (price >= 10 && price <= 10000) {
          validPrices.push(price);
        }
      }
      
      if (validPrices.length > 0) {
        if (pattern.source.includes('sale|now|current|special|save')) {
          console.log(`   ✅ SALE PRICE found in HTML pattern: $${validPrices[0]}`);
          return validPrices[0];
        } else {
          const priceFreq = {};
          validPrices.forEach(p => priceFreq[p] = (priceFreq[p] || 0) + 1);
          const mostCommonPrice = Object.keys(priceFreq).reduce((a, b) => 
            priceFreq[a] > priceFreq[b] ? a : b
          );
          console.log(`   ✅ Most common regular price in HTML: $${mostCommonPrice}`);
          return parseFloat(mostCommonPrice);
        }
      }
    }
    
    console.log('   ❌ No valid price found in HTML at all');
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
      weight: null,
      allVariants: [],
      variant: null
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
  
  parseHTMLWithVariants(html, url, retailer) {
    const productData = this.parseHTML(html, url, retailer);
    
    // Enhanced variant extraction from HTML
    const variants = [];
    const $ = require('cheerio').load(html);
    
    // Wayfair-specific variant selectors
    if (retailer === 'Wayfair') {
      // Look for selected options
      $('.SelectedOption, .option-selected, .selected-swatch').each((i, el) => {
        const variantText = $(el).text().trim();
        if (variantText && variantText.length < 50) {
          variants.push(variantText);
        }
      });
      
      // Look for color swatches
      $('[data-testid*="color"], .color-option.selected, .ColorOption.selected').each((i, el) => {
        const colorText = $(el).attr('aria-label') || $(el).text().trim();
        if (colorText && colorText.length < 30) {
          variants.push(`Color: ${colorText}`);
        }
      });
      
      // Look for size options
      $('[data-testid*="size"], .size-option.selected, .SizeOption.selected').each((i, el) => {
        const sizeText = $(el).attr('aria-label') || $(el).text().trim();
        if (sizeText && sizeText.length < 30) {
          variants.push(`Size: ${sizeText}`);
        }
      });
    }
    
    // Generic variant extraction for other retailers
    $('.selected, .selected-option, .selected-variant, [aria-selected="true"]').each((i, el) => {
      const variantText = $(el).text().trim();
      if (variantText && variantText.length > 2 && variantText.length < 50) {
        variants.push(variantText);
      }
    });
    
    productData.allVariants = variants;
    productData.variant = variants.length > 0 ? variants.join(' | ') : null;
    
    if (variants.length > 0) {
      console.log('   🎨 HTML variants found:', variants);
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