// gptParser.js
// Lightweight GPT-backed parser used ONLY as a fallback.
// Requires: OPENAI_API_KEY in your environment (or Apify actor Secrets)

const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');

const MODEL = process.env.GPT_PARSER_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = 30000;

function htmlToVisibleText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function coerceNumber(n) {
  if (typeof n === 'number') return n;
  if (typeof n === 'string') {
    const cleaned = n.replace(/[^0-9.]/g, '');
    const val = Number(cleaned);
    return Number.isFinite(val) ? val : null;
  }
  return null;
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: TIMEOUT_MS,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    // NOTE: If you have a proxy, add it here.
  });
  return res.data;
}

async function parseWithGPT({ url, html, currencyFallback = 'USD' }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing for gptParser.');
  }

  const visibleText = htmlToVisibleText(html).slice(0, 100000);
  const htmlSlice = html.slice(0, 100000);

  const system = `
You are a precise e-commerce product extractor.
Return STRICT JSON with fields: url, name, price, currency, image, brand (optional).
Rules:
- "price" must be a number (no symbols).
- If currency is unclear, use "${currencyFallback}".
- Prefer main product price (not per-month or struck list price).
- image should be a primary product image URL if visible.
  `.trim();

  const user = `
URL: ${url}
Extract product data from the provided HTML and visible text.
Return ONLY JSON, no explanations.
  `.trim();

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
      { role: 'user', content: `VISIBLE_TEXT:\n${visibleText}` },
      { role: 'user', content: `HTML:\n${htmlSlice}` },
    ],
  });

  let data = {};
  try {
    data = JSON.parse(response.choices[0].message.content || '{}');
  } catch (e) {
    throw new Error(`LLM returned invalid JSON: ${e.message}`);
  }

  // Minimal normalization / validation
  const result = {
    url,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null,
    price: coerceNumber(data.price),
    currency: typeof data.currency === 'string' && data.currency.trim()
      ? data.currency.trim().toUpperCase()
      : currencyFallback,
    image: typeof data.image === 'string' && data.image.startsWith('http') ? data.image : null,
    brand: typeof data.brand === 'string' && data.brand.trim() ? data.brand.trim() : null,
    dimensions: null,
    weight: null,
    category: null,
    inStock: true,
  };

  if (!result.name || !result.price) {
    throw new Error('GPT parse missing required fields (name/price).');
  }
  return result;
}

/**
 * Public function: parseProduct(url)
 * - Fetches HTML
 * - Uses GPT to extract { name, price, image, currency, ... }
 */
async function parseProduct(url, opts = {}) {
  const { currencyFallback = 'USD' } = opts;
  const html = await fetchHtml(url);
  return parseWithGPT({ url, html, currencyFallback });
}

module.exports = {
  parseProduct,
};
