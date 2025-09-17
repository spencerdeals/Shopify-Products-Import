      Promise.race([
        apifyScraper.scrapeProduct(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Apify timeout')), 45000))
      ])
 // ScrapingBee scraping function - ENHANCED WITH AI EXTRACTION
 async function scrapeWithScrapingBee(url) {
   if (!USE_SCRAPINGBEE) {
     throw new Error('ScrapingBee not configured');
   }

   try {
-    console.log('🐝 Starting ScrapingBee AI extraction for:', url);
+    console.log('🐝 Starting ScrapingBee extraction for:', url);
     const startTime = Date.now();
     
-    // Use AI extraction for universal compatibility
+    // Fast extraction without AI for speed
     const response = await axios({
       method: 'GET',
       url: 'https://app.scrapingbee.com/api/v1/',
       params: {
         api_key: SCRAPINGBEE_API_KEY,
         url: url,
-        premium_proxy: 'true',
+        premium_proxy: 'false',  // Disable for speed
         country_code: 'us',
-        render_js: 'true',
-        wait: '2000',  // Reduced wait time
-        ai_extract_rules: JSON.stringify({
-          price: "Product Price in USD",
-          title: "Product Title or Name",
-          description: "Product Description",
-          dimensions: "Product Dimensions, Package Dimensions, or Size",
-          weight: "Product Weight or Shipping Weight",
-          brand: "Brand Name or Manufacturer",
-          availability: "Stock Status or Availability",
-          image: "Main Product Image URL"
-        })
+        render_js: 'false',      // Disable for speed
+        block_resources: 'true', // Block images/css for speed
+        wait: '1000'             // Minimal wait
       },
-      timeout: SCRAPING_TIMEOUT
+      timeout: 20000  // 20 second timeout
     });

     console.log(`   ✅ ScrapingBee extraction completed in ${Date.now() - startTime}ms`);
     
-    // Parse the AI-extracted data
-    const extracted = response.data;
+    // Parse the HTML response manually for speed
+    const html = response.data;
+    if (!html || typeof html !== 'string') {
+      throw new Error('No HTML content received');
+    }
     
     const productData = {
       name: null,
@@ -1089,108 +1089,85 @@ async function scrapeWithScrapingBee(url) {
       inStock: true
     };

-    // Extract product name
-    if (extracted.title) {
-      productData.name = extracted.title.trim();
-      console.log('   📝 AI extracted title:', productData.name.substring(0, 50) + '...');
+    // Extract product name from HTML - Wayfair specific patterns
+    const titlePatterns = [
+      /<h1[^>]*data-enzyme-id="ProductTitle"[^>]*>([^<]+)<\/h1>/i,
+      /<h1[^>]*class="[^"]*ProductDetailInfoBlock-productTitle[^"]*"[^>]*>([^<]+)<\/h1>/i,
+      /<title[^>]*>([^<]+)<\/title>/i,
+      /<h1[^>]*>([^<]+)<\/h1>/i
+    ];
+    
+    for (const pattern of titlePatterns) {
+      const match = html.match(pattern);
+      if (match && match[1].trim()) {
+        productData.name = match[1].trim().replace(/&[^;]+;/g, '').substring(0, 200);
+        console.log('   📝 Extracted title:', productData.name.substring(0, 50) + '...');
+        break;
+      }
     }

-    // Parse the price from AI extraction - robust parsing
-    if (extracted.price) {
-      // Try multiple patterns to extract price
-      const pricePatterns = [
-        /[\$£€]?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,  // $123.45 or 123.45
-        /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*[\$£€]/,  // 123.45$
-        /USD\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,     // USD 123.45
-        /(\d+(?:\.\d{2})?)/,                        // Just numbers
-        /\$\s*(\d+\s*\.\s*\d{2})/                  // Spaced decimals
-      ];
-      
-      for (const pattern of pricePatterns) {
-        const match = extracted.price.match(pattern);
-        if (match) {
-          const priceStr = match[1].replace(/[,\s]/g, '');
-          productData.price = parseFloat(priceStr);
-          if (productData.price > 0 && productData.price < 1000000) {
-            console.log('   💰 AI extracted price: $' + productData.price);
-            break;
-          }
+    // Extract price from HTML - Wayfair specific patterns
+    const pricePatterns = [
+      /data-enzyme-id="PriceBlock"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
+      /class="[^"]*MoneyPrice[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
+      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g
+    ];
+    
+    for (const pattern of pricePatterns) {
+      const matches = [...html.matchAll(pattern)];
+      for (const match of matches) {
+        const price = parseFloat(match[1].replace(/,/g, ''));
+        if (price > 0 && price < 100000) {
+          productData.price = price;
+          console.log('   💰 Extracted price: $' + productData.price);
+          break;
         }
       }
+      if (productData.price) break;
     }

-    // Parse dimensions if AI found them
-    if (extracted.dimensions) {
-      const dimPatterns = [
-        /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
-        /L:\s*(\d+(?:\.\d+)?).*W:\s*(\d+(?:\.\d+)?).*H:\s*(\d+(?:\.\d+)?)/i,
-        /(\d+(?:\.\d+)?)"?\s*[WL]\s*[x×]\s*(\d+(?:\.\d+)?)"?\s*[DW]\s*[x×]\s*(\d+(?:\.\d+)?)"?\s*[HT]/i
-      ];
-      
-      for (const pattern of dimPatterns) {
-        const match = extracted.dimensions.match(pattern);
-        if (match) {
-          productData.dimensions = {
-            length: parseFloat(match[1]),
-            width: parseFloat(match[2]),
-            height: parseFloat(match[3])
-          };
-          console.log('   📏 AI extracted dimensions:', productData.dimensions);
-          break;
-        }
+    // Extract dimensions from HTML
+    const dimPatterns = [
+      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
+      /dimensions?[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
+      /L:\s*(\d+(?:\.\d+)?).*W:\s*(\d+(?:\.\d+)?).*H:\s*(\d+(?:\.\d+)?)/i
+    ];
+    
+    for (const pattern of dimPatterns) {
+      const match = html.match(pattern);
+      if (match) {
+        productData.dimensions = {
+          length: parseFloat(match[1]),
+          width: parseFloat(match[2]),
+          height: parseFloat(match[3])
+        };
+        console.log('   📏 Extracted dimensions:', productData.dimensions);
+        break;
       }
     }

-    // Parse weight if AI found it
-    if (extracted.weight) {
-      const weightPatterns = [
-        /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
-        /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i,
-        /(\d+(?:\.\d+)?)\s*(?:ounces?|oz)/i
-      ];
-      
-      for (const pattern of weightPatterns) {
-        const match = extracted.weight.match(pattern);
-        if (match) {
-          let weight = parseFloat(match[1]);
-          // Convert to pounds if needed
-          if (/kg/i.test(extracted.weight)) weight *= 2.205;
-          if (/oz/i.test(extracted.weight)) weight *= 0.0625;
-          
-          productData.weight = Math.round(weight * 10) / 10;
-          console.log('   ⚖️ AI extracted weight:', productData.weight + ' lbs');
-          break;
-        }
+    // Extract weight from HTML
+    const weightPatterns = [
+      /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
+      /weight[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
+      /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i
+    ];
+    
+    for (const pattern of weightPatterns) {
+      const match = html.match(pattern);
+      if (match) {
+        let weight = parseFloat(match[1]);
+        // Convert to pounds if needed
+        if (/kg/i.test(match[0])) weight *= 2.205;
+        
+        productData.weight = Math.round(weight * 10) / 10;
+        console.log('   ⚖️ Extracted weight:', productData.weight + ' lbs');
+        break;
       }
     }

-    // Extract brand
-    if (extracted.brand) {
      Promise.race([
-      productData.brand = extracted.brand.trim();
        scrapeWithScrapingBee(url),
-
        new Promise((_, reject) => setTimeout(() => reject(new Error('ScrapingBee timeout')), 20000))
-    // Extract image URL
      ])
-    if (extracted.image) {
-      productData.image = extracted.image;
+    // Extract image URL
+    const imagePatterns = [
+      /src="([^"]+)"[^>]*(?:class="[^"]*product[^"]*image|data-testid="[^"]*image)/i,
    Promise.race([
+      /<img[^>]+src="([^"]+)"[^>]*product/i,
      scrapeWithBasicScraper(url),
+      const match = html.match(pattern);
      new Promise((_, reject) => setTimeout(() => reject(new Error('Basic scraper timeout')), 8000))
+      if (match && match[1].startsWith('http')) {
    ])
+        productData.image = match[1];
+        break;
+      }
     }
  // Wait for all scrapers to complete with overall timeout

  const results = await Promise.race([
-      const outOfStockKeywords = /out of stock|unavailable|sold out|not available/i;
    Promise.all(scrapingPromises),
-      productData.inStock = !outOfStockKeywords.test(extracted.availability);
    new Promise((_, reject) => setTimeout(() => reject(new Error('Overall timeout')), 50000))
-    }
  ]).catch(() => scrapingPromises.map(() => ({ success: false, error: 'Timeout' })));
+    // Check availability  
+    const outOfStockKeywords = /out of stock|unavailable|sold out|not available/i;
+    productData.inStock = !outOfStockKeywords.test(html);

-    console.log('📦 ScrapingBee AI results:', {
+    console.log('📦 ScrapingBee results:', {
       hasName: !!productData.name,
       hasPrice: !!productData.price,
       hasImage: !!productData.image,
@@ -1202,7 +1179,7 @@ async function scrapeWithScrapingBee(url) {

   } catch (error) {
-    console.error('❌ ScrapingBee AI extraction failed:', error.message);
+    console.error('❌ ScrapingBee extraction failed:', error.message);
     if (error.response) {
       console.error('Response status:', error.response.status);
       if (error.response.status === 400) {