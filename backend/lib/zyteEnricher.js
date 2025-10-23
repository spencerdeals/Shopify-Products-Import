/**
 * Zyte Enrichment for Shopify CSV Export
 *
 * Enriches product descriptions and tags using Zyte Universal Extractor API
 * when existing descriptions are insufficient (<150 chars or just links).
 */

const axios = require('axios');

// Simple HTML entity encoder
const encodeHtml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

class ZyteEnricher {
  constructor() {
    this.apiKey = process.env.ZYTE_APIKEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.zyte.com/v1/extract';

    if (!this.enabled) {
      console.log('[ZyteEnricher] ⚠️  ZYTE_APIKEY not set - enrichment disabled');
    } else {
      console.log('[ZyteEnricher] ✅ Enabled with API key');
    }
  }

  /**
   * Check if description needs enrichment
   */
  needsEnrichment(bodyHtml) {
    if (!bodyHtml || bodyHtml.trim().length === 0) {
      return true;
    }

    const text = bodyHtml.replace(/<[^>]+>/g, '').trim();

    // Too short
    if (text.length < 150) {
      return true;
    }

    // Only contains a link (minimal content)
    const linkPattern = /<a[^>]*href=/i;
    const hasLink = linkPattern.test(bodyHtml);
    const textWithoutSpaces = text.replace(/\s/g, '');

    if (hasLink && textWithoutSpaces.length < 100) {
      return true;
    }

    return false;
  }

  /**
   * Extract product data from canonical URL using Zyte
   */
  async extractFromUrl(url) {
    if (!this.enabled) {
      throw new Error('Zyte enrichment not enabled - ZYTE_APIKEY not set');
    }

    console.log(`[ZyteEnricher] Extracting from: ${url.substring(0, 60)}...`);

    try {
      const response = await axios.post(
        this.baseURL,
        {
          url: url,
          browserHtml: true,
          product: true,
          productOptions: {
            extractFrom: 'browserHtml'
          }
        },
        {
          auth: {
            username: this.apiKey,
            password: ''
          },
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 45000
        }
      );

      if (!response.data || !response.data.product) {
        console.log('[ZyteEnricher] ⚠️  No product data returned');
        return null;
      }

      const product = response.data.product;

      return {
        description: product.description || product.descriptionText || null,
        descriptionHtml: product.descriptionHtml || null,
        features: product.features || [],
        specifications: product.specifications || product.attributes || [],
        additionalProperties: product.additionalProperties || []
      };

    } catch (error) {
      console.log(`[ZyteEnricher] ⚠️  Failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Sanitize HTML - keep only safe tags
   */
  sanitizeHtml(html) {
    if (!html) return '';

    // Remove scripts, styles, iframes
    html = html.replace(/<\s*(script|style|iframe)[\s\S]*?<\/\s*\1\s*>/gi, '');

    // Remove event handlers
    html = html.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
    html = html.replace(/\son\w+\s*=\s*[^\s>]*/gi, '');

    // Allowed tags: p, ul, li, table, tr, td, h2, h3, strong, em, a
    const allowedTags = ['p', 'br', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'h2', 'h3', 'strong', 'em', 'a', 'b', 'i'];
    const allowedPattern = new RegExp(`<\\/?(${allowedTags.join('|')})(\\s+[^>]*)?>`, 'gi');

    // Mark allowed tags
    html = html.replace(/</g, '\u0001').replace(/>/g, '\u0002');
    html = html.replace(allowedPattern, (m) => m.replace(/\u0001/g, '<').replace(/\u0002/g, '>'));
    html = html.replace(/\u0001.*?\u0002/g, ''); // Remove disallowed tags

    // Enforce rel="nofollow" on links
    html = html.replace(/<a\b([^>]*?)>/gi, (match, attrs) => {
      if (!/rel\s*=/i.test(attrs)) {
        return `<a${attrs} rel="nofollow">`;
      }
      // Replace existing rel with nofollow
      return `<a${attrs.replace(/rel\s*=\s*["'][^"']*["']/gi, 'rel="nofollow"')}>`;
    });

    return html.trim();
  }

  /**
   * Build rich HTML description from Zyte data
   */
  buildRichDescription({ title, description, features, specifications, additionalProperties, sourceUrl }) {
    const parts = [];

    // Title
    if (title) {
      parts.push(`<h2>${encodeHtml(title)}</h2>`);
    }

    // Description
    if (description) {
      const sanitized = this.sanitizeHtml(description);
      if (sanitized) {
        parts.push(`<p>${sanitized}</p>`);
      }
    }

    // Features
    if (features && features.length > 0) {
      const items = features
        .slice(0, 12)
        .map(f => `<li>${encodeHtml(String(f))}</li>`)
        .join('');
      parts.push(`<h3>Features</h3><ul>${items}</ul>`);
    }

    // Specifications
    if (specifications && specifications.length > 0) {
      const rows = specifications
        .slice(0, 15)
        .map(spec => {
          const name = encodeHtml(String(spec.name || spec.label || spec.key || ''));
          const value = encodeHtml(String(spec.value || ''));
          return `<tr><td><strong>${name}</strong></td><td>${value}</td></tr>`;
        })
        .join('');
      if (rows) {
        parts.push(`<h3>Specifications</h3><table>${rows}</table>`);
      }
    }

    // Additional Properties (fallback)
    if ((!specifications || specifications.length === 0) && additionalProperties && additionalProperties.length > 0) {
      const rows = additionalProperties
        .slice(0, 15)
        .map(prop => {
          const name = encodeHtml(String(prop.name || prop.label || ''));
          const value = encodeHtml(String(prop.value || ''));
          return `<tr><td><strong>${name}</strong></td><td>${value}</td></tr>`;
        })
        .join('');
      if (rows) {
        parts.push(`<h3>Details</h3><table>${rows}</table>`);
      }
    }

    // Source link
    if (sourceUrl) {
      try {
        const domain = new URL(sourceUrl).hostname.replace(/^www\./, '');
        parts.push(`<p><small>Source: <a href="${encodeHtml(sourceUrl)}" target="_blank" rel="nofollow">${encodeHtml(domain)}</a></small></p>`);
      } catch (e) {
        // Invalid URL, skip
      }
    }

    return parts.join('\n');
  }

  /**
   * Generate tags from Zyte data
   */
  generateTags({ title, vendor, type, features, specifications, additionalProperties }) {
    const tags = new Set();

    // Helper to add normalized tags
    const add = (...values) => {
      values
        .filter(Boolean)
        .forEach(val => {
          String(val)
            .split(/[\/,&|]/)
            .forEach(part => {
              const clean = part.trim().toLowerCase().replace(/[^\w\s\-]/g, '');
              if (clean && clean.length > 2 && clean.length <= 30) {
                tags.add(clean);
              }
            });
        });
    };

    // Core tags
    add(vendor, type);

    // Title keywords
    if (title) {
      const keywords = ['desk', 'table', 'chair', 'sofa', 'bed', 'cabinet', 'shelf', 'storage',
                        'standing', 'adjustable', 'ergonomic', 'outdoor', 'modern', 'wood', 'metal'];
      const lowerTitle = title.toLowerCase();
      keywords.forEach(kw => {
        if (lowerTitle.includes(kw)) tags.add(kw);
      });
    }

    // Features
    if (features && features.length > 0) {
      features.slice(0, 8).forEach(f => add(f));
    }

    // Specifications attributes
    if (specifications && specifications.length > 0) {
      specifications.slice(0, 8).forEach(spec => {
        add(spec.value);
      });
    }

    // Additional properties
    if (additionalProperties && additionalProperties.length > 0) {
      additionalProperties.slice(0, 8).forEach(prop => {
        const name = (prop.name || '').toLowerCase();
        // Extract useful attributes
        if (['color', 'material', 'style', 'finish', 'room'].includes(name)) {
          add(prop.value);
        }
      });
    }

    // Room/context tags from title
    if (title) {
      const t = title.toLowerCase();
      if (t.includes('desk') && (t.includes('office') || t.includes('home'))) {
        tags.add('home office');
      }
      if (t.includes('standing desk')) {
        tags.add('standing desk');
      }
      if (t.includes('outdoor') || t.includes('patio')) {
        tags.add('outdoor furniture');
        tags.add('all-weather');
      }
    }

    // Limit to 5-10 tags
    return Array.from(tags).slice(0, 10);
  }

  /**
   * Enrich a product if needed
   * Returns { bodyHtml, tags } or null if no enrichment performed
   */
  async enrichProduct(product) {
    // Check if enrichment needed
    if (!this.needsEnrichment(product.description_html)) {
      return null;
    }

    // Need canonical URL
    if (!product.canonical_url) {
      console.log(`[ZyteEnricher] ⚠️  No URL for ${product.handle}, skipping`);
      return null;
    }

    // Extract from Zyte
    const zyteData = await this.extractFromUrl(product.canonical_url);

    if (!zyteData) {
      return null;
    }

    // Build rich description
    const bodyHtml = this.buildRichDescription({
      title: product.title,
      description: zyteData.description || zyteData.descriptionHtml,
      features: zyteData.features,
      specifications: zyteData.specifications,
      additionalProperties: zyteData.additionalProperties,
      sourceUrl: product.canonical_url
    });

    // Generate tags
    const tags = this.generateTags({
      title: product.title,
      vendor: product.brand,
      type: product.breadcrumbs ? product.breadcrumbs[product.breadcrumbs.length - 1] : null,
      features: zyteData.features,
      specifications: zyteData.specifications,
      additionalProperties: zyteData.additionalProperties
    });

    return {
      bodyHtml,
      tags
    };
  }
}

module.exports = ZyteEnricher;
