@@ .. @@
 // ScrapingBee scraping function - ENHANCED WITH AI EXTRACTION
 async function scrapeWithScrapingBee(url) {
   if (!USE_SCRAPINGBEE) {
     throw new Error('ScrapingBee not configured');
   }

   try {
    console.log('🐝 Starting FAST ScrapingBee extraction...');
     const startTime = Date.now();
     
    // FAST extraction - no AI, no premium
    const response = await Promise.race([
      axios({
        method: 'GET',
        url: 'https://app.scrapingbee.com/api/v1/',
        params: {
          api_key: SCRAPINGBEE_API_KEY,
          url: url,
          premium_proxy: 'false',
          country_code: 'us',
          render_js: 'false',
          block_resources: 'true',
          wait: '1000'
        },
        timeout: SCRAPINGBEE_TIMEOUT
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('ScrapingBee timeout')), SCRAPINGBEE_TIMEOUT)
      )
    ]);

    console.log(`   ✅ ScrapingBee completed in ${Date.now() - startTime}ms`);
    
    const html = response.data;
    if (!html || typeof html !== 'string') {
      throw new Error('No HTML content received');
    }
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      inStock: true
    };

    // WAYFAIR-SPECIFIC extraction patterns
    const wayfairTitlePatterns = [
      /<h1[^>]*data-enzyme-id="ProductTitle"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*class="[^"]*ProductDetailInfoBlock-productTitle[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<title[^>]*>([^|]+)\s*\|/i,
      /<h1[^>]*>([^<]+)<\/h1>/i
    ];
    
    for (const pattern of wayfairTitlePatterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        productData.name = match[1].trim().replace(/&[^;]+;/g, '').substring(0, 200);
        console.log('   📝 Found title');
        break;
      }
    }

    // WAYFAIR-SPECIFIC price patterns
    const wayfairPricePatterns = [
      /data-enzyme-id="PriceBlock"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /class="[^"]*MoneyPrice[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /"currentPrice":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/i,
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    for (const pattern of wayfairPricePatterns) {
      if (pattern.global) {
        const matches = [...html.matchAll(pattern)];
        for (const match of matches) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 10 && price < 50000) {
            productData.price = price;
            console.log('   💰 Found price: $' + price);
            break;
          }
        }
      } else {
        const match = html.match(pattern);
        if (match) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 10 && price < 50000) {
            productData.price = price;
            console.log('   💰 Found price: $' + price);
            break;
          }
        }
      }
      if (productData.price) break;
    }

    // WAYFAIR dimensions - look for product specs
    const wayfairDimPatterns = [
      /Overall:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
      /Dimensions[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i
    ];
    
    for (const pattern of wayfairDimPatterns) {
      const match = html.match(pattern);
      if (match) {
        const dims = {
          length: parseFloat(match[1]),
          width: parseFloat(match[2]),
          height: parseFloat(match[3])
        };
        if (dims.length > 0 && dims.width > 0 && dims.height > 0) {
          productData.dimensions = dims;
          console.log('   📏 Found dimensions');
          break;
        }
      }
    }

    // Extract main product image
    const wayfairImagePatterns = [
      /data-hb="MediaGallery"[^>]*>[\s\S]*?src="([^"]+)"/i,
      /class="[^"]*MediaGallery[^"]*"[^>]*>[\s\S]*?src="([^"]+)"/i,
      /property="og:image"[^>]+content="([^"]+)"/i
    ];
    
    for (const pattern of wayfairImagePatterns) {
      const match = html.match(pattern);
      if (match && match[1].startsWith('http')) {
        productData.image = match[1];
        console.log('   🖼️ Found image');
        break;
      }
    }

    return productData;

  } catch (error) {
    console.error('❌ ScrapingBee failed:', error.message);
    throw error;
  }
}