const fs = require('fs');
const path = require('path');
const { extractWayfairBoxDimensions } = require('./wayfairBoxExtractor');

const DEFAULTS_PATH = path.join(__dirname, '../../data/defaults.json');

function loadDefaults() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
  } catch (err) {
    console.warn('Could not load defaults.json:', err.message);
    return { retailerSelectors: {}, vendorTierMult: {} };
  }
}

function normalizeUnit(val, unit) {
  const n = parseFloat(val);
  if (isNaN(n) || n <= 0) return 0;

  const u = (unit || '').toLowerCase();
  if (u.includes('cm') || u.includes('centimeter')) {
    return n / 2.54;
  }
  return n;
}

function parseDimensionString(text) {
  if (!text) return [];

  const boxes = [];
  const cleaned = text.replace(/["""''`]/g, '"').replace(/\s+/g, ' ');

  const patterns = [
    /Box\s*(\d+)[:\s-]*([0-9.]+)\s*[×x]\s*([0-9.]+)\s*[×x]\s*([0-9.]+)\s*(?:in|"|inch(?:es)?)?/gi,
    /Carton\s*(\d+)[:\s-]*([0-9.]+)\s*[×x]\s*([0-9.]+)\s*[×x]\s*([0-9.]+)\s*(?:in|"|inch(?:es)?)?/gi,
    /Package\s*(\d+)[:\s-]*([0-9.]+)\s*[×x]\s*([0-9.]+)\s*[×x]\s*([0-9.]+)\s*(?:in|"|inch(?:es)?)?/gi,
    /([0-9.]+)\s*(?:in|"|inch(?:es)?)?\s*[×x]\s*([0-9.]+)\s*(?:in|"|inch(?:es)?)?\s*[×x]\s*([0-9.]+)\s*(?:in|"|inch(?:es)?)?/gi
  ];

  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(cleaned)) !== null) {
      const vals = match.slice(match[1] && isNaN(match[1]) === false && parseInt(match[1]) < 20 ? 2 : 1);
      const L = parseFloat(vals[0]);
      const W = parseFloat(vals[1]);
      const H = parseFloat(vals[2]);

      if (L > 0 && W > 0 && H > 0 && L < 500 && W < 500 && H < 500) {
        boxes.push({ L, W, H });
      }
    }
    if (boxes.length > 0) break;
  }

  return boxes;
}

function extractFromZyte(zyteData) {
  if (!zyteData) return null;

  const notes = [];
  let boxes = [];
  let confidence = 0;

  const prod = zyteData.product || zyteData;

  if (prod.packaging) {
    if (Array.isArray(prod.packaging)) {
      for (const pkg of prod.packaging) {
        if (pkg.length && pkg.width && pkg.height) {
          boxes.push({
            L: normalizeUnit(pkg.length, pkg.lengthUnit),
            W: normalizeUnit(pkg.width, pkg.widthUnit),
            H: normalizeUnit(pkg.height, pkg.heightUnit)
          });
        }
      }
    } else if (typeof prod.packaging === 'object') {
      const p = prod.packaging;
      if (p.length && p.width && p.height) {
        boxes.push({
          L: normalizeUnit(p.length, p.lengthUnit),
          W: normalizeUnit(p.width, p.widthUnit),
          H: normalizeUnit(p.height, p.heightUnit)
        });
      }
    }
    if (boxes.length > 0) {
      confidence = 0.85;
      notes.push('zyte_packaging_field');
    }
  }

  if (boxes.length === 0 && prod.packageDimensions) {
    const pd = prod.packageDimensions;
    if (pd.length && pd.width && pd.height) {
      boxes.push({
        L: normalizeUnit(pd.length, pd.unit),
        W: normalizeUnit(pd.width, pd.unit),
        H: normalizeUnit(pd.height, pd.unit)
      });
      confidence = 0.85;
      notes.push('zyte_packageDimensions');
    }
  }

  if (boxes.length === 0 && prod.dimensions) {
    const d = prod.dimensions;
    if (d.packaged) {
      const pk = d.packaged;
      if (pk.length && pk.width && pk.height) {
        boxes.push({
          L: normalizeUnit(pk.length, pk.unit),
          W: normalizeUnit(pk.width, pk.unit),
          H: normalizeUnit(pk.height, pk.unit)
        });
        confidence = 0.80;
        notes.push('zyte_dimensions_packaged');
      }
    }
  }

  if (boxes.length === 0 && typeof prod === 'object') {
    const keys = Object.keys(prod);
    for (const k of keys) {
      if (/carton|package|shipping.*dim/i.test(k)) {
        const val = prod[k];
        if (typeof val === 'string') {
          const parsed = parseDimensionString(val);
          if (parsed.length > 0) {
            boxes = parsed;
            confidence = 0.75;
            notes.push(`zyte_field_${k}`);
            break;
          }
        }
      }
    }
  }

  const validBoxes = boxes.filter(b => b.L > 0 && b.W > 0 && b.H > 0);
  if (validBoxes.length === 0) return null;

  return {
    boxes: validBoxes,
    source: 'zyte',
    confidence,
    notes
  };
}

function extractFromHTML(browserHtml, retailer) {
  if (!browserHtml) return null;

  const defaults = loadDefaults();
  const config = defaults.retailerSelectors[retailer.toLowerCase()] || {};
  const labels = config.labels || [];
  const notes = [];
  let boxes = [];
  let confidence = 0;

  const text = browserHtml.substring(0, 100000);

  for (let boxNum = 1; boxNum <= 5; boxNum++) {
    const boxLabel = `Box ${boxNum} Dimensions`;
    const regex = new RegExp(
      `${boxLabel}[^\\n:]*[:\\-]?\\s*([0-9.]+)\\s*[HhWwDdLl]?\\s*[""in×x]*\\s*[×x]?\\s*([0-9.]+)\\s*[HhWwDdLl]?\\s*[""in×x]*\\s*[×x]?\\s*([0-9.]+)\\s*[HhWwDdLl]?\\s*[""in]*`,
      'i'
    );
    const match = text.match(regex);
    if (match) {
      const L = parseFloat(match[1]);
      const W = parseFloat(match[2]);
      const H = parseFloat(match[3]);
      if (L > 0 && W > 0 && H > 0 && L < 500 && W < 500 && H < 500) {
        boxes.push({ L, W, H });
        notes.push(`html_box${boxNum}`);
      }
    }
  }

  if (boxes.length > 0) {
    confidence = 0.85;
  } else {
    for (const label of labels) {
      if (label.toLowerCase().includes('box')) continue;
      const regex = new RegExp(
        `${label}[^\\n:]*[:\\-]?\\s*([0-9.]+)\\s*[""in]*\\s*[×x]\\s*([0-9.]+)\\s*[""in]*\\s*[×x]\\s*([0-9.]+)\\s*[""in]*`,
        'i'
      );
      const match = text.match(regex);
      if (match) {
        const L = parseFloat(match[1]);
        const W = parseFloat(match[2]);
        const H = parseFloat(match[3]);
        if (L > 0 && W > 0 && H > 0 && L < 500 && W < 500 && H < 500) {
          boxes.push({ L, W, H });
          confidence = 0.80;
          notes.push(`html_label_${label}`);
          break;
        }
      }
    }
  }

  if (boxes.length === 0) {
    const genericPatterns = [
      /Carton\s*Dimensions[^\\n:]*[:\\-]?\\s*([0-9.]+)\s*[""in]*\\s*[×x]\\s*([0-9.]+)\s*[""in]*\\s*[×x]\\s*([0-9.]+)\s*[""in]*/i,
      /Package\s*Dimensions[^\\n:]*[:\\-]?\\s*([0-9.]+)\s*[""in]*\\s*[×x]\\s*([0-9.]+)\s*[""in]*\\s*[×x]\\s*([0-9.]+)\s*[""in]*/i,
      /Shipping\s*Dimensions[^\\n:]*[:\\-]?\\s*([0-9.]+)\s*[""in]*\\s*[×x]\\s*([0-9.]+)\s*[""in]*\\s*[×x]\\s*([0-9.]+)\s*[""in]*/i,
      /Box\s*\\d+\s*[:\\-]\\s*([0-9.]+)\\s*[×x]\\s*([0-9.]+)\\s*[×x]\\s*([0-9.]+)\\s*(?:in|"|inch(?:es)?)?/i
    ];

    for (const pat of genericPatterns) {
      const match = text.match(pat);
      if (match) {
        const L = parseFloat(match[1]);
        const W = parseFloat(match[2]);
        const H = parseFloat(match[3]);
        if (L > 0 && W > 0 && H > 0 && L < 500 && W < 500 && H < 500) {
          boxes.push({ L, W, H });
          confidence = 0.70;
          notes.push('html_generic_pattern');
          break;
        }
      }
    }
  }

  const validBoxes = boxes.filter(b => b.L > 0 && b.W > 0 && b.H > 0);
  if (validBoxes.length === 0) return null;

  return {
    boxes: validBoxes,
    source: 'html',
    confidence,
    notes
  };
}

function extractFromJSONLD(browserHtml) {
  if (!browserHtml) return null;

  try {
    const jsonldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = jsonldRegex.exec(browserHtml)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const products = Array.isArray(data) ? data : [data];

        for (const item of products) {
          if (item['@type'] === 'Product' || item.product) {
            const prod = item.product || item;

            if (prod.additionalProperty && Array.isArray(prod.additionalProperty)) {
              for (const prop of prod.additionalProperty) {
                if (/package|carton|shipping.*dim/i.test(prop.name)) {
                  const boxes = parseDimensionString(prop.value);
                  if (boxes.length > 0) {
                    return {
                      boxes,
                      source: 'jsonld',
                      confidence: 0.85,
                      notes: ['jsonld_additionalProperty']
                    };
                  }
                }
              }
            }

            if (prod.depth && prod.width && prod.height) {
              const L = parseFloat(prod.depth);
              const W = parseFloat(prod.width);
              const H = parseFloat(prod.height);
              if (L > 0 && W > 0 && H > 0) {
                return {
                  boxes: [{ L, W, H }],
                  source: 'jsonld',
                  confidence: 0.75,
                  notes: ['jsonld_dimensions']
                };
              }
            }
          }
        }
      } catch (e) {
      }
    }
  } catch (err) {
  }

  return null;
}

async function extractCartons({ retailer, sku, url, browserHtml, zyteData }) {
  const results = [];

  if (retailer && retailer.toLowerCase() === 'wayfair' && browserHtml) {
    const wayfairResult = extractWayfairBoxDimensions(browserHtml);
    if (wayfairResult && wayfairResult.boxes.length > 0) {
      console.log(`   📦 Wayfair: Found ${wayfairResult.boxes.length} boxes via HxWxD pattern`);
      return wayfairResult;
    }
  }

  const zyteResult = extractFromZyte(zyteData);
  if (zyteResult && zyteResult.confidence >= 0.80) {
    return zyteResult;
  }
  if (zyteResult) results.push(zyteResult);

  const jsonldResult = extractFromJSONLD(browserHtml);
  if (jsonldResult && jsonldResult.confidence >= 0.80) {
    return jsonldResult;
  }
  if (jsonldResult) results.push(jsonldResult);

  const htmlResult = extractFromHTML(browserHtml, retailer);
  if (htmlResult && htmlResult.confidence >= 0.80) {
    return htmlResult;
  }
  if (htmlResult) results.push(htmlResult);

  if (results.length > 0) {
    results.sort((a, b) => b.confidence - a.confidence);
    return results[0];
  }

  return null;
}

module.exports = { extractCartons, parseDimensionString };
