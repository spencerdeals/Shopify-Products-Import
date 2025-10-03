function extractProPriceFromHTML(html, url) {
  if (!html) return null;

  // Vendor-specific price override patterns
  const pricePatterns = [
    // Wayfair Pro pricing
    {
      pattern: /Pro savings applied.*?Consumers pay \$([0-9]+\.[0-9]{2})/i,
      vendors: ['wayfair.com']
    },
    // Wayfair Sale Price (JSON-LD)
    {
      pattern: /"salesPrice":"\$([0-9]+\.[0-9]{2})"/i,
      vendors: ['wayfair.com']
    },
    // Amazon Business pricing
    {
      pattern: /With Business Price.*?\$([0-9]+\.[0-9]{2})/i,
      vendors: ['amazon.com']
    },
    // Amazon price (JSON-LD)
    {
      pattern: /"price":"([0-9]+\.[0-9]{2})"/i,
      vendors: ['amazon.com']
    },
    // Overstock sale price (JSON-LD)
    {
      pattern: /"priceCurrency":"USD","price":"([0-9]+\.[0-9]{2})"/i,
      vendors: ['overstock.com']
    },
    // Generic sale price patterns
    {
      pattern: /sale[:\s]+\$([0-9]+\.[0-9]{2})/i,
      vendors: ['*'] // all vendors
    },
    {
      pattern: /discounted price[:\s]+\$([0-9]+\.[0-9]{2})/i,
      vendors: ['*']
    }
  ];

  // Detect vendor from URL if provided
  let vendorDomain = null;
  if (url) {
    try {
      const urlObj = new URL(url);
      vendorDomain = urlObj.hostname.replace('www.', '');
    } catch (e) {
      // Invalid URL, continue without vendor detection
    }
  }

  // Try vendor-specific patterns first, then generic patterns
  for (const { pattern, vendors } of pricePatterns) {
    // Check if pattern applies to this vendor
    const isVendorMatch = vendors.includes('*') ||
                          (vendorDomain && vendors.some(v => vendorDomain.includes(v)));

    if (isVendorMatch) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const price = parseFloat(match[1]);
        if (price > 0) {
          return price;
        }
      }
    }
  }

  return null;
}

module.exports = { extractProPriceFromHTML };
