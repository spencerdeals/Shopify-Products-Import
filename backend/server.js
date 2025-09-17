@@ .. @@
 // ScrapingBee scraping function - ENHANCED WITH AI EXTRACTION
 async function scrapeWithScrapingBee(url) {
   if (!USE_SCRAPINGBEE) {
     throw new Error('ScrapingBee not configured');
   }

   try {
     console.log('🐝 Starting ScrapingBee extraction for:', url);
     const startTime = Date.now();
     
     // Fast extraction without AI for speed
     const response = await axios({
       method: 'GET',
       url: 'https://app.scrapingbee.com/api/v1/',
       params: {
         api_key: SCRAPINGBEE_API_KEY,
         url: url,
         premium_proxy: 'false',  // Disable for speed
         country_code: 'us',
         render_js: 'false',      // Disable for speed
         block_resources: 'true', // Block images/css for speed
         wait: '1000'             // Minimal wait
       },
       timeout: 20000  // 20 second timeout
     });

     console.log(`   ✅ ScrapingBee extraction completed in ${Date.now() - startTime}ms`);
     
     // Parse the HTML response manually for speed
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

     // Extract product name from HTML - Wayfair specific patterns
     const titlePatterns = [
       /<h1[^>]*data-enzyme-id="ProductTitle"[^>]*>([^<]+)<\/h1>/i,
       /<h1[^>]*class="[^"]*ProductDetailInfoBlock-productTitle[^"]*"[^>]*>([^<]+)<\/h1>/i,
       /<title[^>]*>([^<]+)<\/title>/i,
       /<h1[^>]*>([^<]+)<\/h1>/i
     ];
     
     for (const pattern of titlePatterns) {
       const match = html.match(pattern);
       if (match && match[1].trim()) {
         productData.name = match[1].trim().replace(/&[^;]+;/g, '').substring(0, 200);
         console.log('   📝 Extracted title:', productData.name.substring(0, 50) + '...');
         break;
       }
     }

     // Extract price from HTML - Wayfair specific patterns
     const pricePatterns = [
       /data-enzyme-id="PriceBlock"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
       /class="[^"]*MoneyPrice[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
       /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g
     ];
     
     for (const pattern of pricePatterns) {
       const matches = [...html.matchAll(pattern)];
       for (const match of matches) {
         const price = parseFloat(match[1].replace(/,/g, ''));
         if (price > 0 && price < 100000) {
           productData.price = price;
           console.log('   💰 Extracted price: $' + productData.price);
           break;
         }
       }
       if (productData.price) break;
     }

     // Extract dimensions from HTML
     const dimPatterns = [
       /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
       /dimensions?[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
       /L:\s*(\d+(?:\.\d+)?).*W:\s*(\d+(?:\.\d+)?).*H:\s*(\d+(?:\.\d+)?)/i
     ];
     
     for (const pattern of dimPatterns) {
       const match = html.match(pattern);
       if (match) {
         productData.dimensions = {
           length: parseFloat(match[1]),
           width: parseFloat(match[2]),
           height: parseFloat(match[3])
         };
         console.log('   📏 Extracted dimensions:', productData.dimensions);
         break;
       }
     }

     // Extract weight from HTML
     const weightPatterns = [
       /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
       /weight[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
       /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i
     ];
     
     for (const pattern of weightPatterns) {
       const match = html.match(pattern);
       if (match) {
         let weight = parseFloat(match[1]);
         // Convert to pounds if needed
         if (/kg/i.test(match[0])) weight *= 2.205;
         
         productData.weight = Math.round(weight * 10) / 10;
         console.log('   ⚖️ Extracted weight:', productData.weight + ' lbs');
         break;
       }
     }

     // Extract image URL
     const imagePatterns = [
       /src="([^"]+)"[^>]*(?:class="[^"]*product[^"]*image|data-testid="[^"]*image)/i,
       /<img[^>]+src="([^"]+)"[^>]*product/i,
       /property="og:image"[^>]+content="([^"]+)"/i
     ];
     
     for (const pattern of imagePatterns) {
       const match = html.match(pattern);
       if (match && match[1].startsWith('http')) {
         productData.image = match[1];
         break;
       }
     }

     // Check availability  
     const outOfStockKeywords = /out of stock|unavailable|sold out|not available/i;
     productData.inStock = !outOfStockKeywords.test(html);

     console.log('📦 ScrapingBee results:', {
       hasName: !!productData.name,
       hasPrice: !!productData.price,
       hasImage: !!productData.image,
       hasDimensions: !!productData.dimensions,
       hasWeight: !!productData.weight
     });

     return productData;

   } catch (error) {
     console.error('❌ ScrapingBee extraction failed:', error.message);
     if (error.response) {
       console.error('Response status:', error.response.status);
       if (error.response.status === 400) {
         console.error('Bad request - check API key and parameters');
       }
     }
     throw error;
   }
 }