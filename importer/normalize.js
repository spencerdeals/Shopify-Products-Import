// importer/normalize.js
// Zyte→product normalizer for Instant Import API
// Converts raw Zyte extraction data to standardized product format

/**
 * Normalize Zyte extraction data to standard product format
 * @param {Object} zyteData - Raw data from Zyte API
 * @param {string} url - Original product URL
 * @returns {Object} Normalized product data
 */
function normalizeZyteProduct(zyteData, url) {
  if (!zyteData || typeof zyteData !== 'object') {
    throw new Error('Invalid Zyte data provided');
  }

  const product = zyteData.product || zyteData;
  
  // Extract basic product information
  const normalized = {
    url: url || product.url || '',
    name: extractName(product),
    price: extractPrice(product),
    currency: extractCurrency(product),
    image: extractImage(product),
    brand: extractBrand(product),
    category: extractCategory(product),
    inStock: extractAvailability(product),
    dimensions: extractDimensions(product),
    weight: extractWeight(product),
    variant: extractVariant(product),
    allVariants: extractAllVariants(product),
    confidence: extractConfidence(zyteData),
    retailer: detectRetailer(url),
    extractedAt: new Date().toISOString()
  };

  // Validate required fields
  if (!normalized.name || !normalized.price) {
    throw new Error('Missing required fields: name and price');
  }

  return normalized;
}

/**
 * Extract product name from Zyte data
 */
function extractName(product) {
  const candidates = [
    product.name,
    product.title,
    product.productName,
    product.displayName
  ];
  
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().substring(0, 200);
    }
  }
  
  return null;
}

/**
 * Extract price with priority for sale/current prices
 */
function extractPrice(product) {
  // Priority order: sale prices first, then regular prices
  const priceFields = [
    'salePrice',
    'currentPrice',
    'specialPrice',
    'price',
    'regularPrice',
    'listPrice'
  ];
  
  for (const field of priceFields) {
    const priceValue = product[field];
    if (priceValue) {
      let parsedPrice = null;
      
      if (typeof priceValue === 'string') {
        const cleanPrice = priceValue.replace(/[$,\s]/g, '');
        parsedPrice = parseFloat(cleanPrice);
      } else if (typeof priceValue === 'number') {
        parsedPrice = priceValue;
      } else if (typeof priceValue === 'object' && priceValue.value) {
        parsedPrice = parseFloat(priceValue.value);
      }
      
      if (parsedPrice && parsedPrice > 0 && parsedPrice < 50000) {
        return parsedPrice;
      }
    }
  }
  
  return null;
}

/**
 * Extract currency code
 */
function extractCurrency(product) {
  const candidates = [
    product.currency,
    product.price?.currency,
    product.salePrice?.currency,
    product.currentPrice?.currency
  ];
  
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string') {
      const currency = candidate.toUpperCase().trim();
      if (['USD', 'CAD', 'GBP', 'EUR', 'BMD'].includes(currency)) {
        return currency;
      }
    }
  }
  
  return 'USD'; // Default fallback
}

/**
 * Extract main product image
 */
function extractImage(product) {
  const candidates = [
    product.mainImage?.url,
    product.heroImage?.url,
    product.primaryImage?.url,
    product.images?.[0]?.url,
    product.images?.[0],
    product.image
  ];
  
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string' && candidate.startsWith('http')) {
      return candidate;
    }
  }
  
  return null;
}

/**
 * Extract brand information
 */
function extractBrand(product) {
  const candidates = [
    product.brand?.name,
    product.brand,
    product.manufacturer,
    product.brandName
  ];
  
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  
  return null;
}

/**
 * Extract category from breadcrumbs
 */
function extractCategory(product) {
  if (product.breadcrumbs && Array.isArray(product.breadcrumbs) && product.breadcrumbs.length > 0) {
    const lastCrumb = product.breadcrumbs[product.breadcrumbs.length - 1];
    return typeof lastCrumb === 'object' ? lastCrumb.name : lastCrumb;
  }
  
  if (product.category && typeof product.category === 'string') {
    return product.category;
  }
  
  return null;
}

/**
 * Extract availability status
 */
function extractAvailability(product) {
  if (product.availability) {
    const availability = product.availability.toLowerCase();
    return availability === 'instock' || availability === 'in_stock';
  }
  
  if (product.inStock !== undefined) {
    return Boolean(product.inStock);
  }
  
  return true; // Default to in stock
}

/**
 * Extract dimensions
 */
function extractDimensions(product) {
  // Check additionalProperties for dimensions
  if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
    for (const prop of product.additionalProperties) {
      if (prop.name && prop.value) {
        const propName = prop.name.toLowerCase();
        if (propName.includes('dimension') || propName.includes('size') || propName === 'overall') {
          const dims = parseDimensionString(prop.value);
          if (dims) return dims;
        }
      }
    }
  }
  
  // Check direct dimension fields
  if (product.dimensions) {
    return normalizeDimensions(product.dimensions);
  }
  
  return null;
}

/**
 * Parse dimension strings with multiple formats
 */
function parseDimensionString(text) {
  if (!text || typeof text !== 'string') return null;
  
  const patterns = [
    /(\d+(?:\.\d+)?)"?\s*H\s*x\s*(\d+(?:\.\d+)?)"?\s*W\s*x\s*(\d+(?:\.\d+)?)"?\s*D/i,
    /H:\s*(\d+(?:\.\d+)?)"?\s*W:\s*(\d+(?:\.\d+)?)"?\s*D:\s*(\d+(?:\.\d+)?)"?/i,
    /Height:\s*(\d+(?:\.\d+)?),?\s*Width:\s*(\d+(?:\.\d+)?),?\s*Depth:\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const height = parseFloat(match[1]);
      const width = parseFloat(match[2]);
      const depth = parseFloat(match[3]);
      
      if (height > 0 && height < 200 && width > 0 && width < 200 && depth > 0 && depth < 200) {
        return {
          height: height,
          length: width,
          width: depth
        };
      }
    }
  }
  
  return null;
}

/**
 * Normalize dimensions object
 */
function normalizeDimensions(dims) {
  if (!dims || typeof dims !== 'object') return null;
  
  const length = parseFloat(dims.length || dims.width || 0);
  const width = parseFloat(dims.width || dims.depth || 0);
  const height = parseFloat(dims.height || 0);
  
  if (length > 0 && width > 0 && height > 0) {
    return { length, width, height };
  }
  
  return null;
}

/**
 * Extract weight information
 */
function extractWeight(product) {
  const candidates = [
    product.weight,
    product.shippingWeight,
    product.packageWeight
  ];
  
  for (const candidate of candidates) {
    if (candidate) {
      const weight = parseWeightString(candidate);
      if (weight) return weight;
    }
  }
  
  // Check additionalProperties
  if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
    for (const prop of product.additionalProperties) {
      if (prop.name && prop.name.toLowerCase().includes('weight')) {
        const weight = parseWeightString(prop.value);
        if (weight) return weight;
      }
    }
  }
  
  return null;
}

/**
 * Parse weight strings
 */
function parseWeightString(text) {
  if (!text) return null;
  
  const textStr = typeof text === 'string' ? text : text.toString();
  
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/i,
    /(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)/i,
    /Weight:\s*(\d+(?:\.\d+)?)/i
  ];
  
  for (const pattern of patterns) {
    const match = textStr.match(pattern);
    if (match) {
      let weight = parseFloat(match[1]);
      
      // Convert kg to lbs if needed
      if (pattern.source.includes('kg')) {
        weight = weight * 2.20462;
      }
      
      if (weight > 0 && weight < 500) {
        return weight;
      }
    }
  }
  
  return null;
}

/**
 * Extract primary variant
 */
function extractVariant(product) {
  const variants = extractAllVariants(product);
  return variants.length > 0 ? variants.join(' • ') : null;
}

/**
 * Extract all variants
 */
function extractAllVariants(product) {
  const variants = [];
  
  // Extract from variants array
  if (product.variants && Array.isArray(product.variants)) {
    product.variants.forEach(variant => {
      if (variant.color) variants.push(`Color: ${cleanVariantValue(variant.color)}`);
      if (variant.size) variants.push(`Size: ${cleanVariantValue(variant.size)}`);
      if (variant.style) variants.push(`Style: ${cleanVariantValue(variant.style)}`);
      if (variant.material) variants.push(`Material: ${cleanVariantValue(variant.material)}`);
    });
  }
  
  // Extract from direct fields
  if (product.color) variants.push(`Color: ${cleanVariantValue(product.color)}`);
  if (product.size) variants.push(`Size: ${cleanVariantValue(product.size)}`);
  if (product.style) variants.push(`Style: ${cleanVariantValue(product.style)}`);
  
  // Extract from additionalProperties
  if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
    product.additionalProperties.forEach(prop => {
      const propName = prop.name?.toLowerCase();
      const propValue = cleanVariantValue(prop.value);
      
      if (!propValue) return;
      
      if (propName === 'orientation') variants.push(`Orientation: ${propValue}`);
      else if (propName === 'fabric') variants.push(`Fabric: ${propValue}`);
      else if (propName === 'finish') variants.push(`Finish: ${propValue}`);
      else if (propName === 'configuration') variants.push(`Configuration: ${propValue}`);
    });
  }
  
  return [...new Set(variants)]; // Remove duplicates
}

/**
 * Clean variant values
 */
function cleanVariantValue(value) {
  if (!value || typeof value !== 'string') return null;
  
  return value
    .replace(/\s*selected\s*/gi, '')
    .replace(/\s*chosen\s*/gi, '')
    .replace(/^(color|size|style|material):\s*/gi, '')
    .trim();
}

/**
 * Extract confidence score
 */
function extractConfidence(zyteData) {
  if (zyteData.product?.metadata?.probability) {
    return parseFloat(zyteData.product.metadata.probability);
  }
  
  if (zyteData.confidence) {
    return parseFloat(zyteData.confidence);
  }
  
  return null;
}

/**
 * Detect retailer from URL
 */
function detectRetailer(url) {
  if (!url) return 'Unknown';
  
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    if (hostname.includes('amazon')) return 'Amazon';
    if (hostname.includes('wayfair')) return 'Wayfair';
    if (hostname.includes('target')) return 'Target';
    if (hostname.includes('walmart')) return 'Walmart';
    if (hostname.includes('bestbuy')) return 'Best Buy';
    if (hostname.includes('homedepot')) return 'Home Depot';
    if (hostname.includes('lowes')) return 'Lowes';
    if (hostname.includes('costco')) return 'Costco';
    if (hostname.includes('macys')) return 'Macys';
    if (hostname.includes('ikea')) return 'IKEA';
    if (hostname.includes('crateandbarrel')) return 'Crate & Barrel';
    if (hostname.includes('cb2')) return 'CB2';
    if (hostname.includes('westelm')) return 'West Elm';
    if (hostname.includes('potterybarn')) return 'Pottery Barn';
    
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

module.exports = {
  normalizeZyteProduct,
  extractName,
  extractPrice,
  extractCurrency,
  extractImage,
  extractBrand,
  extractCategory,
  extractAvailability,
  extractDimensions,
  extractWeight,
  extractVariant,
  extractAllVariants,
  extractConfidence,
  detectRetailer
};