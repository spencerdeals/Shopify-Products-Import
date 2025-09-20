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

      // Enhanced price parsing - prioritize sale prices
      if (product.price) {
        let finalPrice = null;
        
        // Check if Zyte provides multiple price options
        if (product.salePrice || product.currentPrice || product.specialPrice) {
          // Prioritize sale/current/special prices
          finalPrice = product.salePrice || product.currentPrice || product.specialPrice;
          console.log('   💰 Found sale/current price:', finalPrice);
        } else if (product.price) {
          // Use main price as fallback
          finalPrice = product.price;
          console.log('   💰 Using main price:', finalPrice);
        }
        
        // Convert to number if needed
        if (typeof finalPrice === 'string') {
          productData.price = parseFloat(finalPrice);
        } else if (typeof finalPrice === 'number') {
          productData.price = finalPrice;
        }
        
        if (productData.price && productData.price > 0) {
          console.log('   💰 Final Price: $' + productData.price);
        }
      }
      
      // Enhanced image extraction - prefer high-quality variant images
      if (product.images && product.images.length > 0) {
        // Look for the largest/highest quality image
        let bestImage = null;
        let maxSize = 0;
        
        product.images.forEach(img => {
          const imageUrl = typeof img === 'object' ? img.url : img;
          if (imageUrl && imageUrl.startsWith('http')) {
            // Try to detect image size from URL patterns
            const sizeMatch = imageUrl.match(/(\d+)x(\d+)/);
            if (sizeMatch) {
              const size = parseInt(sizeMatch[1]) * parseInt(sizeMatch[2]);
              if (size > maxSize) {
                maxSize = size;
                bestImage = imageUrl;
              }
            } else if (!bestImage) {
              bestImage = imageUrl; // Fallback to first valid image
            }
          }
        });
        
        productData.image = bestImage;
        console.log('   🖼️ Best Image: Found (quality optimized)');
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

      // Enhanced variant extraction - look for multiple variant types
      const variants = [];
      
      // Extract size/dimensions as variant
      if (product.size) {
        variants.push(`Size: ${product.size}`);
        const sizeMatch = product.size.match(/(\d+(?:\.\d+)?)"W\s*x\s*(\d+(?:\.\d+)?)"D/);
        if (sizeMatch) {
          productData.dimensions = {
            length: parseFloat(sizeMatch[1]), // Width becomes length
            width: parseFloat(sizeMatch[2]),  // Depth becomes width  
            height: 36 // Estimate height for sofa
          };
          console.log('   📏 Dimensions from size:', `${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
        }
      }
      
      // Extract color variants
      if (product.color) {
        variants.push(`Color: ${product.color}`);
        console.log('   🎨 Color variant:', product.color);
      }
      
      // Extract style/material variants
      if (product.style) {
        variants.push(`Style: ${product.style}`);
        console.log('   ✨ Style variant:', product.style);
      }
      
      if (product.material) {
        variants.push(`Material: ${product.material}`);
        console.log('   🪵 Material variant:', product.material);
      }
      
      // Look for variants in product features or options
      if (product.features && Array.isArray(product.features)) {
        product.features.forEach(feature => {
          if (typeof feature === 'string' && feature.length < 50) {
            variants.push(feature);
          }
        });
      }
      
      // Store all variants
      productData.allVariants = variants;
      
      // Create a comprehensive primary variant
      if (variants.length > 0) {
        productData.variant = variants.join(' | ');
        console.log('   🎯 Combined variants:', productData.variant);
      } else if (product.size) {
        productData.variant = product.size;
        console.log('   📏 Size variant:', productData.variant);
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

    // Fallback: Enhanced HTML parsing if automatic extraction failed  
    if (!productData.name && data.browserHtml) {
      console.log('   🔍 Falling back to HTML parsing...');
      const htmlData = this.parseHTMLWithVariants(data.browserHtml, url, retailer);
      
      // Merge data - prefer automatic extraction but fill gaps with HTML parsing
      productData.name = productData.name || htmlData.name;
      productData.price = productData.price || htmlData.price;
      productData.image = productData.image || htmlData.image;
      productData.dimensions = productData.dimensions || htmlData.dimensions;
      productData.weight = productData.weight || htmlData.weight;
      productData.allVariants = productData.allVariants || htmlData.allVariants || [];
      productData.variant = productData.variant || htmlData.variant;
    }

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
    
    console.log('   🔍 Searching for price in HTML...');
    
    let foundPrices = [];
    
    for (const selector of priceSelectors) {
      const elements = $(selector);
      console.log(`   🔍 Found ${elements.length} elements for selector: ${selector}`);
      
      elements.each((i, el) => {
        const priceText = $(el).text().trim();
        console.log(`   💰 Price text found with ${selector}: "${priceText}"`);
        
        // Extract price from text like "$349.99" or "349.99"
        const priceMatch = priceText.match(/\$?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          // Filter for reasonable furniture prices
          if (price >= 50 && price <= 10000) {
            foundPrices.push({ price, selector, text: priceText });
            console.log(`   ✅ Valid price found with ${selector}: $${price}`);
          }
        }
      });
    }
    
    // Return the first valid price found (sale prices are checked first)
    if (foundPrices.length > 0) {
      const bestPrice = foundPrices[0];
      console.log(`   🎯 Using price $${bestPrice.price} from ${bestPrice.selector}`);
      return bestPrice.price;
    }
    
    // Fallback: Search for price patterns in raw HTML
    const pricePatterns = [
      // Look for sale price patterns first
      /(?:sale|now|current|special)[\s\S]*?\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi,
      // Standard price patterns
      /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      const validPrices = [];
      
      for (const match of matches) {
        const priceIndex = match.length > 2 ? 1 : 1; // Handle capture groups
        const price = parseFloat(match[priceIndex].replace(/,/g, ''));
        if (price >= 50 && price <= 10000) {
          validPrices.push(price);
        }
      }
      
      if (validPrices.length > 0) {
        // For sale price patterns, return the first (likely sale price)
        // For standard patterns, return the most common
        if (pattern.source.includes('sale|now|current')) {
          console.log(`   ✅ Sale price found in HTML: $${validPrices[0]}`);
          return validPrices[0];
        } else {
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