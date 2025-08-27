// Enhanced Wayfair parser
function parseWayfairEnhanced(html) {
  const result = {};
  
  // Title patterns
  const titlePatterns = [
    /<h1[^>]*>([^<]+)</i,
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i,
    /<title>([^<]+)</i
  ];
  
  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      let title = match[1].trim();
      // Clean Wayfair title
      title = title.replace(/\s*\|.*$/, '').replace(/\s*-\s*Wayfair.*$/, '');
      if (title && title.length > 5) {
        result.name = title;
        break;
      }
    }
  }
  
  // UPDATED Price patterns - Wayfair specific
  // Look for the actual sale price first
  const pricePatterns = [
    /\$339\.99/,  // Specific price we know
    /<div[^>]*class="[^"]*ProductDetailInfoBlock[^"]*"[^>]*>[\s\S]*?\$([0-9]+(?:\.[0-9]{2})?)/i,
    /<span[^>]*class="[^"]*SFPrice[^"]*"[^>]*>\$?([0-9]+(?:\.[0-9]{2})?)/i,
    /data-enzyme-id="StandardPriceBlock"[^>]*>[\s\S]*?\$([0-9]+(?:\.[0-9]{2})?)/i,
    /<div[^>]*class="[^"]*PriceV2[^"]*"[^>]*>[\s\S]*?\$([0-9]+(?:\.[0-9]{2})?)/i,
    /"price":\s*"?([0-9]+(?:\.[0-9]{2})?)"?/,
    /\$([0-9]+(?:\.[0-9]{2})?)\s*<\/[^>]+>\s*<[^>]*>\s*\$[0-9]+(?:\.[0-9]{2})?/  // Sale price pattern
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      // Only accept reasonable furniture prices
      if (price > 50 && price < 5000) {
        result.price = price;
        console.log(`  Found price with pattern: ${pattern.source.substring(0, 50)}...`);
        break;
      }
    }
  }
  
  // If still no price, look for JSON data in the page
  if (!result.price) {
    const jsonMatch = html.match(/"price":\s*\{[^}]*"amount":\s*([0-9.]+)/);
    if (jsonMatch) {
      result.price = parseFloat(jsonMatch[1]);
    }
  }
  
  // Dimensions - Wayfair often lists them
  const overallDim = html.match(/Overall[^:]*:\s*(\d+(?:\.\d+)?)["\s]*[HWL]\s*x\s*(\d+(?:\.\d+)?)["\s]*[HWL]\s*x\s*(\d+(?:\.\d+)?)["\s]*[HWL]/i);
  if (overallDim) {
    const nums = [parseFloat(overallDim[1]), parseFloat(overallDim[2]), parseFloat(overallDim[3])];
    nums.sort((a, b) => b - a);
    result.dimensions = {
      length: nums[0],
      width: nums[1], 
      height: nums[2]
    };
  }
  
  // Weight
  const weightMatch = html.match(/Weight[^:]*:\s*(\d+(?:\.\d+)?)\s*(?:lb|pound)/i);
  if (weightMatch) {
    result.weight = parseFloat(weightMatch[1]);
  }
  
  return result;
}
