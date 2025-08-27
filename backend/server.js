// Add this function to search for similar products when dimensions not found
async function findSimilarProductDimensions(productName, category) {
  console.log(`Searching for similar products to: ${productName}`);
  
  // Clean product name for search
  const searchTerms = productName
    .replace(/[^\w\s]/g, '') // Remove special chars
    .split(' ')
    .slice(0, 5) // Take first 5 words
    .join(' ');
  
  // Search multiple sources for dimensions
  const searchQueries = [
    `${searchTerms} dimensions inches specifications`,
    `${searchTerms} size measurements shipping`,
    `${searchTerms} "W x D x H"`,
    `${searchTerms} cubic feet`
  ];
  
  for (const query of searchQueries) {
    try {
      // Use ScrapingBee to search Google Shopping or retailer sites
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=shop`;
      const html = await scrapingBeeRequest(searchUrl);
      
      // Extract dimensions from search results
      const dimPatterns = [
        /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches|")/gi,
        /(\d+(?:\.\d+)?)"?\s*W\s*[x×]\s*(\d+(?:\.\d+)?)"?\s*D\s*[x×]\s*(\d+(?:\.\d+)?)"?\s*H/gi,
        /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/gi
      ];
      
      for (const pattern of dimPatterns) {
        const matches = [...html.matchAll(pattern)];
        if (matches.length > 0) {
          // Take the most common dimensions found
          const dimensions = matches.map(m => ({
            length: parseFloat(m[1]),
            width: parseFloat(m[2]),
            height: parseFloat(m[3])
          }));
          
          // Filter out unrealistic dimensions
          const validDims = dimensions.filter(d => 
            d.length > 0 && d.length < 120 &&
            d.width > 0 && d.width < 120 &&
            d.height > 0 && d.height < 120
          );
          
          if (validDims.length > 0) {
            // Use median dimensions for reliability
            const sortedByVolume = validDims.sort((a, b) => 
              (a.length * a.width * a.height) - (b.length * b.width * b.height)
            );
            const median = sortedByVolume[Math.floor(sortedByVolume.length / 2)];
            
            console.log(`Found similar product dimensions: ${median.length}x${median.width}x${median.height}`);
            
            // Apply 1.2x buffer for safety
            return {
              length: median.length * 1.2,
              width: median.width * 1.2,
              height: median.height * 1.2,
              source: 'similar-product'
            };
          }
        }
      }
    } catch (error) {
      console.log(`Search attempt failed: ${error.message}`);
    }
  }
  
  return null;
}

// Update the main scrapeProduct function
async function scrapeProduct(url) {
  const retailer = detectRetailer(url);
  
  if (USE_SCRAPINGBEE) {
    try {
      console.log(`Using ScrapingBee for ${retailer}: ${url}`);
      const html = await scrapingBeeRequest(url);
      const productData = await parseScrapingBeeHTML(html, url);
      
      if (productData.name) {
        const category = categorizeProduct(productData.name || '', url);
        let dimensions = productData.dimensions;
        let dimensionSource = 'product-page';
        
        // If no dimensions found on product page, search for similar products
        if (!dimensions) {
          console.log(`No dimensions found on product page, searching for similar products...`);
          const similarDims = await findSimilarProductDimensions(productData.name, category);
          
          if (similarDims) {
            dimensions = similarDims;
            dimensionSource = 'similar-product';
          } else {
            // Last resort: Use smart category estimates with larger multiplier
            dimensions = estimateDimensions(category, productData.name);
            // Apply extra buffer since we're guessing
            dimensions.length *= 1.5;
            dimensions.width *= 1.5;
            dimensions.height *= 1.5;
            dimensionSource = 'category-estimate';
          }
        }
        
        const validatedDimensions = validateDimensions(dimensions, category, productData.name);
        const weight = estimateWeight(validatedDimensions, category);
        const shippingCost = calculateShippingCost(validatedDimensions, weight, productData.price || 0);

        return {
          id: generateProductId(),
          name: productData.name || 'Unknown Product',
          price: productData.price || null,
          image: productData.image || 'https://placehold.co/120x120/7CB342/FFFFFF/png?text=SDL',
          retailer: retailer,
          category: category,
          dimensions: validatedDimensions,
          dimensionSource: dimensionSource,
          weight: weight,
          shippingCost: shippingCost,
          url: url,
          needsManualPrice: !productData.price,
          priceMessage: !productData.price ? 'Price could not be detected automatically' : null,
          quantity: 1,
          scraped: true,
          method: 'ScrapingBee',
          estimateWarning: dimensionSource !== 'product-page' ? 
            `ESTIMATED DIMENSIONS (${dimensionSource}) - Manual verification recommended` : null
        };
      }
    } catch (error) {
      console.log(`ScrapingBee failed for ${url}:`, error.message);
    }
  }
  
  // Fallback continues...
}

// Also update shipping calculation for better accuracy
function calculateShippingCost(dimensions, weight, orderTotal = 0) {
  let { length, width, height } = dimensions;
  
  const MAX_SINGLE_BOX = 96;
  
  length = Math.min(length, MAX_SINGLE_BOX);
  width = Math.min(width, MAX_SINGLE_BOX); 
  height = Math.min(height, MAX_SINGLE_BOX);
  
  let volume = length * width * height;
  let cubicFeet = volume / 1728;
  
  // More realistic minimum cubic feet for different price ranges
  if (orderTotal > 300) {
    cubicFeet = Math.max(cubicFeet, 3); // At least 3 cu ft for $300+ items
  }
  if (orderTotal > 500) {
    cubicFeet = Math.max(cubicFeet, 5); // At least 5 cu ft for $500+ items
  }
  if (orderTotal > 1000) {
    cubicFeet = Math.max(cubicFeet, 8); // At least 8 cu ft for $1000+ items
  }
  
  const baseCost = cubicFeet * 7.5;
  
  let marginMultiplier;
  if (orderTotal < 400) {
    marginMultiplier = 1.45;
  } else if (orderTotal < 1500) {
    marginMultiplier = 1.30;
  } else {
    marginMultiplier = 1.20;
  }
  
  let finalCost = baseCost * marginMultiplier;
  
  // Set realistic minimums based on order value
  const minShipping = orderTotal > 0 ? Math.max(35, orderTotal * 0.15) : 35;
  
  return Math.max(minShipping, Math.round(finalCost * 100) / 100);
}
