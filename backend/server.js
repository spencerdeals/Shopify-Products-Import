// FIX 1: Complete the cut-off line 1100 (Walmart thumbnail)
// FIND: // Walmart image U
// REPLACE WITH:
      } else if (retailer === 'Walmart' && image.includes('walmart')) {
        thumbnail = image.includes('?') ? image + '&odnWidth=100&odnHeight=100' : image + '?odnWidth=100&odnHeight=100';
      } else {
        thumbnail = image;
      }
    }
    
    // Extract SKU
    const sku = data.sku || null;
    
    console.log(`   💰 Price: ${price || 'Not found'}`);
    console.log(`   🎨 Variant: ${variant || 'Not specified'}`);
    console.log(`   📋 SKU: ${sku || 'Not found'}`);
    console.log(`   🖼️ Thumbnail: ${thumbnail && thumbnail !== image ? 'Separate' : 'Same as main'}`);
    
    return {
      price: price,
      title: data.title || 'Product',
      image: image,
      thumbnail: thumbnail || image,
      variant: variant,
      sku: sku,
      brand: data.brand || null
    };
    
  } catch (error) {
    console.log('   ❌ ScrapingBee failed:', error.message);
    return {
      price: null,
      title: 'Product from ' + retailer,
      image: null,
      thumbnail: null,
      variant: null,
      sku: null
    };
  }
}

// FIX 2: Add Luna Furniture simple mode (insert at line 555, right after detecting retailer)
// In scrapeWithScrapingBee function, after: const retailer = detectRetailer(url);
// ADD:
  
  // Luna Furniture needs simpler scraping
  if (retailer === 'Luna Furniture' || retailer === 'Other Retailer') {
    scrapingParams.premium_proxy = 'false';
    scrapingParams.wait = '2000';
    console.log('   Using simple mode for smaller retailer');
  }

// FIX 3: Add missing fields to product object (around line 920 in processProduct function)
// FIND where you build the product object and ADD these 3 fields:
  variant: scraped.variant || null,
  thumbnail: scraped.thumbnail || scraped.image,
  sku: scraped.sku || null,

// FIX 4: Add processProduct function if missing (looks like it might be cut off too)
// This goes right before the /api/scrape endpoint:

async function processProduct(url, index, urls) {
  console.log(`[${index + 1}/${urls.length}] Processing: ${url.substring(0, 80)}...`);
  
  const retailer = detectRetailer(url);
  console.log(`   Retailer: ${retailer}`);
  
  const learned = getLearnedData(url);
  if (learned && learned.price) {
    console.log('   📚 Using cached data from previous scrape');
    return { ...learned, fromCache: true };
  }
  
  const scraped = await scrapeWithScrapingBee(url);
  const productName = scraped.title || `${retailer} Product ${index + 1}`;
  const category = categorizeProduct(productName, url);
  
  let dimensions = scraped.dimensions || estimateDimensionsFromBOL(category, productName, retailer);
  let weight = scraped.weight || estimateWeightFromBOL(dimensions, category);
  let packaging = 'ASSEMBLED';
  
  const isFlatPack = isFlatPackable(category, productName, retailer);
  if (isFlatPack) {
    console.log(`   📦 FLAT-PACK DETECTED`);
    dimensions = calculateFlatPackDimensions(dimensions, productName);
    weight = adjustFlatPackWeight(weight, category);
    packaging = 'FLAT-PACK';
  }
  
  const baseShippingCost = calculateShippingCost(dimensions, weight, scraped.price || 100);
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  const landedCost = (scraped.price || 100) + baseShippingCost + ((scraped.price || 100) * BERMUDA_DUTY_RATE);
  const marginRate = calculateSDLMargin(cubicFeet, landedCost);
  const marginAmount = Math.round(baseShippingCost * marginRate);
  const totalShippingWithMargin = Math.round(baseShippingCost + marginAmount);
  
  const product = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    url: url,
    name: productName,
    variant: scraped.variant || null,  // ADDED
    thumbnail: scraped.thumbnail || scraped.image,  // ADDED
    sku: scraped.sku || null,  // ADDED
    price: scraped.price,
    image: scraped.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=No+Image',
    category: category,
    retailer: retailer,
    dimensions: dimensions,
    weight: weight,
    isFlatPack: isFlatPack,
    packaging: packaging,
    baseShippingCost: Math.round(baseShippingCost),
    marginRate: marginRate,
    marginAmount: marginAmount.toFixed(2),
    shippingCost: totalShippingWithMargin,
    dataCompleteness: {
      hasName: !!scraped.title,
      hasPrice: !!scraped.price,
      hasImage: !!scraped.image,
      hasDimensions: !!scraped.dimensions,
      hasWeight: !!scraped.weight,
      hasVariant: !!scraped.variant,
      hasThumbnail: !!scraped.thumbnail && scraped.thumbnail !== scraped.image,
      hasSku: !!scraped.sku
    },
    fromCache: false
  };
  
  learnFromProduct(url, product);
  return product;
}

// FIX 5: Complete the /api/scrape endpoint (if it's cut off)
app.post('/api/scrape', scrapeRateLimiter, async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'No URLs provided' });
    }
    
    const sdlUrls = urls.filter(url => isSDLDomain(url));
    if (sdlUrls.length > 0) {
      return res.status(400).json({ 
        error: 'SDL domain detected. This calculator is for importing products from other retailers.' 
      });
    }
    
    console.log(`\n========================================`);
    console.log(`SCRAPING ${urls.length} PRODUCTS`);
    console.log(`========================================\n`);
    
    const products = [];
    
    for (let i = 0; i < urls.length; i++) {
      try {
        const product = await processProduct(urls[i], i, urls);
        products.push(product);
      } catch (error) {
        console.error(`   ❌ Failed to process: ${error.message}`);
        
        const retailer = detectRetailer(urls[i]);
        products.push({
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          url: urls[i],
          name: 'Product from ' + retailer + ' - Please check retailer website',
          variant: null,
          thumbnail: 'https://placehold.co/100x100/7CB342/FFFFFF/png?text=Not+Found',
          sku: null,
          price: null,
          image: 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=Not+Found',
          category: 'general',
          retailer: retailer,
          dimensions: estimateDimensionsFromBOL('general', '', retailer),
          weight: 50,
          shippingCost: 60,
          error: true
        });
      }
    }
    
    const successful = products.filter(p => p.price).length;
    const withVariants = products.filter(p => p.variant).length;
    const withThumbnails = products.filter(p => p.thumbnail && p.thumbnail !== p.image).length;
    
    console.log(`\n========================================`);
    console.log(`RESULTS: ${products.length} products processed`);
    console.log(`   Scraped: ${successful}`);
    console.log(`   Failed: ${products.length - successful}`);
    console.log(`   With variants: ${withVariants}`);
    console.log(`   With thumbnails: ${withThumbnails}`);
    console.log(`========================================\n`);
    
    res.json({ products });
    
  } catch (error) {
    console.error('❌ Scraping endpoint error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
  }
});
