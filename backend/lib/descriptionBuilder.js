/**
 * Description Builder
 *
 * Extracts, normalizes, and builds product descriptions from scraped data.
 * Handles description, features, specs, and HTML normalization.
 */

const cheerio = require('cheerio');

/**
 * Normalize HTML: remove inline styles, keep only simple tags
 */
function normalizeHtml(html) {
  if (!html) return '';

  const $ = cheerio.load(html);

  // Remove script and style tags
  $('script, style').remove();

  // Remove all inline styles
  $('[style]').removeAttr('style');

  // Remove class and id attributes
  $('[class]').removeAttr('class');
  $('[id]').removeAttr('id');

  // Allow only simple tags: p, ul, li, table, tr, td, th, h1-h6, strong, em, br
  const allowedTags = ['p', 'ul', 'li', 'table', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'br', 'a'];

  $('*').each((i, elem) => {
    const tagName = $(elem).prop('tagName').toLowerCase();
    if (!allowedTags.includes(tagName)) {
      $(elem).replaceWith($(elem).html() || '');
    }
  });

  // Clean up whitespace
  let cleaned = $.html().trim();

  // Remove excessive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned;
}

/**
 * Extract description from Zyte product data
 */
function extractDescription(product, browserHtml = null) {
  // Try various description fields
  const descFields = [
    product.description,
    product.descriptionHtml,
    product.longDescription,
    product.productDescription,
    product.fullDescription
  ];

  for (const desc of descFields) {
    if (desc && typeof desc === 'string' && desc.trim().length > 50) {
      return normalizeHtml(desc);
    }
  }

  // If we have browserHtml, try to extract from common selectors
  if (browserHtml) {
    const $ = cheerio.load(browserHtml);
    const selectors = [
      '.product-description',
      '#product-description',
      '[data-desc]',
      '.description',
      '#description'
    ];

    for (const sel of selectors) {
      const elem = $(sel);
      if (elem.length > 0 && elem.text().trim().length > 50) {
        return normalizeHtml(elem.html());
      }
    }
  }

  return null;
}

/**
 * Extract features/bullets from product data
 */
function extractFeatures(product, browserHtml = null) {
  const features = [];

  // Try Zyte features array
  if (product.features && Array.isArray(product.features)) {
    features.push(...product.features.filter(f => f && f.trim().length > 0));
  }

  // Try additionalProperties for features
  if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
    product.additionalProperties.forEach(prop => {
      if (prop.name && prop.name.toLowerCase().includes('feature')) {
        if (Array.isArray(prop.value)) {
          features.push(...prop.value.filter(v => v && v.trim().length > 0));
        } else if (typeof prop.value === 'string') {
          features.push(prop.value);
        }
      }
    });
  }

  // If we have browserHtml and no features yet, try to extract bullets
  if (features.length === 0 && browserHtml) {
    const $ = cheerio.load(browserHtml);

    // Try multiple selectors for feature lists
    const selectors = [
      'ul li',                    // Generic list items
      '.features li',             // Features list
      '.bullets li',              // Bullets list
      '[class*="feature"] li',    // Any class containing "feature"
      '[class*="bullet"] li',     // Any class containing "bullet"
      '[id*="feature"] li',       // Any ID containing "feature"
      '.product-details li',      // Product details
      '.specifications li',       // Specifications
      '#details li'               // Details section
    ];

    for (const selector of selectors) {
      const bullets = $(selector).slice(0, 15); // Get up to 15 items
      bullets.each((i, elem) => {
        const text = $(elem).text().trim();
        // Filter out navigation items, short text, very long text
        if (text.length > 10 && text.length < 500 && !text.toLowerCase().includes('add to cart') && !text.toLowerCase().includes('sign in')) {
          features.push(text);
        }
      });

      // If we found enough features, stop looking
      if (features.length >= 5) {
        break;
      }
    }
  }

  return features.length > 0 ? features : null;
}

/**
 * Extract specs/dimensions from product data
 */
function extractSpecs(product) {
  const specs = [];

  // Try additionalProperties
  if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
    product.additionalProperties.forEach(prop => {
      if (prop.name && prop.value) {
        const label = prop.name.trim();
        const value = typeof prop.value === 'object' ? JSON.stringify(prop.value) : String(prop.value).trim();

        // Skip features (already handled)
        if (label.toLowerCase().includes('feature')) return;

        // Include useful specs
        if (value.length > 0 && value.length < 200) {
          specs.push({ label, value });
        }
      }
    });
  }

  // Add dimensions if available
  if (product.dimensions) {
    const dims = product.dimensions;
    if (dims.length || dims.width || dims.height) {
      const dimStr = `${dims.length || '?'} × ${dims.width || '?'} × ${dims.height || '?'} ${dims.unit || 'in'}`;
      specs.push({ label: 'Dimensions', value: dimStr });
    }
  }

  if (product.packageDimensions) {
    const dims = product.packageDimensions;
    if (dims.length || dims.width || dims.height) {
      const dimStr = `${dims.length || '?'} × ${dims.width || '?'} × ${dims.height || '?'} ${dims.unit || 'in'}`;
      specs.push({ label: 'Package Dimensions', value: dimStr });
    }
  }

  // Add weight if available
  if (product.weight) {
    specs.push({ label: 'Weight', value: `${product.weight} ${product.weightUnit || 'lb'}` });
  }

  return specs.length > 0 ? specs : null;
}

/**
 * Synthesize description from features and specs if main description is empty
 */
function synthesizeDescription(features, specs) {
  let parts = [];

  if (features && features.length > 0) {
    parts.push('<h3>Features</h3>');
    parts.push('<ul>');
    features.slice(0, 8).forEach(f => {
      parts.push(`<li>${f}</li>`);
    });
    parts.push('</ul>');
  }

  if (specs && specs.length > 0) {
    parts.push('<h3>Specifications</h3>');
    parts.push('<table>');
    specs.forEach(spec => {
      parts.push(`<tr><td><strong>${spec.label}</strong></td><td>${spec.value}</td></tr>`);
    });
    parts.push('</table>');
  }

  return parts.join('\n');
}

/**
 * Build complete Body (HTML) for Shopify using template
 */
function buildBodyHtml(product, options = {}) {
  const { sourceUrl = null, domain = null } = options;

  console.log('[DescBuilder] Building Body HTML for:', product.name);
  console.log('[DescBuilder] Input fields:', {
    hasDescription: !!product.description,
    hasDescriptionHtml: !!product.descriptionHtml,
    hasFeatures: !!product.features,
    hasAdditionalProps: !!product.additionalProperties,
    hasBrowserHtml: !!product.browserHtml,
    browserHtmlLength: product.browserHtml ? product.browserHtml.length : 0
  });

  // Extract all components
  const description = extractDescription(product, product.browserHtml);
  const features = extractFeatures(product, product.browserHtml);
  const specs = extractSpecs(product);

  console.log('[DescBuilder] Extracted:', {
    descriptionLength: description ? description.length : 0,
    featuresCount: features ? features.length : 0,
    specsCount: specs ? specs.length : 0
  });

  // Log first few features for debugging
  if (features && features.length > 0) {
    console.log('[DescBuilder] First 3 features:', features.slice(0, 3));
  } else {
    console.log('[DescBuilder] ⚠️  No features extracted! This may result in minimal description.');
  }

  let parts = [];

  // Title
  parts.push(`<h2>${product.name || 'Product'}</h2>`);

  // Special order notice
  parts.push('<p><strong>Special Order (3–4 weeks)</strong>. Tax included.</p>');

  // Main description
  if (description) {
    console.log('[DescBuilder] Using vendor description');
    parts.push(description);
  } else if (features || specs) {
    // Synthesize from features/specs if no description
    console.log('[DescBuilder] Synthesizing from features/specs');
    parts.push(synthesizeDescription(features, specs));
  } else {
    // Absolute fallback
    console.log('[DescBuilder] Using fallback description');
    parts.push('<p>Premium quality furniture item. Contact us for details.</p>');
  }

  // Features (if not already in synthesized description)
  if (description && features && features.length > 0) {
    parts.push('<h3>Features</h3>');
    parts.push('<ul>');
    features.forEach(f => {
      parts.push(`<li>${f}</li>`);
    });
    parts.push('</ul>');
  }

  // Specs (if not already in synthesized description)
  if (description && specs && specs.length > 0) {
    parts.push('<h3>Specifications</h3>');
    parts.push('<table>');
    specs.forEach(spec => {
      parts.push(`<tr><td><strong>${spec.label}</strong></td><td>${spec.value}</td></tr>`);
    });
    parts.push('</table>');
  }

  // Source link
  if (sourceUrl) {
    // Detect actual domain from URL
    const url = new URL(sourceUrl);
    const actualDomain = url.hostname.replace('www.', '');
    const displayName = actualDomain.includes('amazon.') ? 'Amazon' :
                        actualDomain.includes('wayfair.') ? 'Wayfair' :
                        actualDomain;
    parts.push(`<p><small>Source: <a href="${sourceUrl}" target="_blank" rel="nofollow">${displayName} product page</a></small></p>`);
  }

  return parts.join('\n');
}

module.exports = {
  normalizeHtml,
  extractDescription,
  extractFeatures,
  extractSpecs,
  synthesizeDescription,
  buildBodyHtml
};
