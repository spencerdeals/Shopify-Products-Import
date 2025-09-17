// gptParser.js
// GPT-backed parser with resilient HTML fetch:
// 1) ScrapingBee (render_js) -> 2) Apify web-scraper snapshot -> 3) Axios w/ retries
// Env: OPENAI_API_KEY (required), SCRAPINGBEE_API_KEY (optional), APIFY_API_KEY (optional)

const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const { ApifyClient } = require('apify-client');

const MODEL = process.env.GPT_PARSER_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = 30000;
const MAX_AXIOS_RETRIES = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

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

// ---------- FETCHERS ----------
async function fetchViaScrapingBee(url) {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) return null;
  try {
    const res = await axios.get('https://app.scrapingbee.com/api/v1', {
      timeout: TIMEOUT_MS,
      params: {
        api_key: key,
        url,
        render_js: 'true',
        country_code: 'US',
        block_resources: 'false',
      },
      validateStatus: () => true,
    });
    if (res.status >= 200 && res.status < 300 && res.data) {
      return typeof res.data === 'string' ? res.data : res.data.toString();
    }
    console.warn(`[ScrapingBee] Non-2xx: ${res.status}`);
    return null;
  } catch (e) {
    console.warn('[ScrapingBee] Error:', e.message);
    return null;
  }
}

async function fetchViaApifySnapshot(url) {
  const token = process.env.APIFY_API_KEY;
  if (!token) return null;
  try {
    const client = new ApifyClient({ token });
    const input = {
      startUrls: [{ url }],
      maxRequestsPerCrawl: 1,
      proxyConfiguration: { useApifyProxy: true },
      pageFunction: `
        async function pageFunction(context) {
          const { page, request } = context;
          await page.waitForTimeout(2500);
          const html = await page.content();
          return { url: request.url, html };
        }
      `,
    };
    const run = await client.actor('apify/web-scraper').call(input, {
      timeout: 90000,
      memory: 1024,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    if (items && items[0] && items[0].html) return items[0].html;
    return null;
  } catch (e) {
    console.warn('[Apify snapshot] Error:', e.message);
    return null;
  }
}

async function fetchViaAxios(url) {
  // Basic axios with UA, retries, jitter, and 429 backoff
  let lastErr = null;
  for (let i = 0; i < MAX_AXIOS_RETRIES; i++) {
    try {
      const res = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${rnd(118, 126)} Safari/537.36`,
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data) {
        return typeof res.data === 'string' ? res.data : res.data.toString();
      }
      if (res.status === 429) {
        const waitMs = 1500 * (i + 1) + rnd(0, 1500);
        console.warn(`[Axios] 429 rate-limited. Retry ${i + 1}/${MAX_AXIOS_RETRIES} after ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500 && res.status < 600) {
        const waitMs = 1000 * (i + 1);
        console.warn(`[Axios] ${res.status} server error. Retry ${i + 1}/${MAX_AXIOS_RETRIES} after ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      console.warn(`[Axios] Non-OK status: ${res.status}`);
      return null;
    } catch (e) {
      lastErr = e;
      const waitMs = 800 * (i + 1);
      console.warn(`[Axios] Error ${i + 1}/${MAX_AXIOS_RETRIES}: ${e.message}. Waiting ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }
  if (lastErr) console.warn('[Axios] Final error:', lastErr.message);
  return null;
}

async function smartFetchHtml(url) {
  // Try ScrapingBee -> Apify snapshot -> Axios
  let html = await fetchViaScrapingBee(url);
  if (html) return html;

  html = await fetchViaApifySnapshot(url);
  if (html) return html;

  html = await fetchViaAxios(url);
  return html;
}
// ---------- END FETCHERS ----------

async function parseWithGPT({ url, html, currencyFallback = 'USD' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing for gptParser.');
  const client = new OpenAI({ apiKey });

  const visibleText = htmlToVisibleText(html).slice(0, 100000);
  const htmlSlice = html.slice(0, 100000);

  const system = `
You are a precise e-commerce product extractor.
Return STRICT JSON with fields: url, name, price, currency, image, brand (optional).
Rules:
- "price" must be a number (no symbols).
- If currency is unclear, use "${currencyFallback}".
- Prefer main product price (not per-month or struck list price).
- "image" should be the primary product image URL if visible.
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

  if (!result.name || result.price == null) {
    throw new Error('GPT parse missing required fields (name/price).');
  }
  return result;
}

/**
 * Public: parseProduct(url)
 * - Fetches HTML (Bee -> Apify -> Axios)
 * - Uses GPT to extract { name, price, image, currency, ... }
 */
async function parseProduct(url, opts = {}) {
  const { currencyFallback = 'USD' } = opts;

  // Random small jitter before fetching to reduce bursts
  await sleep(rnd(200, 600));

  const html = await smartFetchHtml(url);
  if (!html) throw new Error('All HTML fetch methods failed (Bee/Apify/Axios).');

  return parseWithGPT({ url, html, currencyFallback });
}

module.exports = { parseProduct };
