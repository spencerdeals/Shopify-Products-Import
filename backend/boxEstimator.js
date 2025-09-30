// gptParser.js
// Trimmed tokens + multi-source fetch + richer fields + package dims support.

const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const { ApifyClient } = require('apify-client');

const MODEL = process.env.GPT_PARSER_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = 30000;
const MAX_AXIOS_RETRIES = 3;
const DEFAULT_CURRENCY = (process.env.DEFAULT_CURRENCY || 'USD').toUpperCase();
const ALLOWED_CURRENCIES = ['USD','BMD','CAD','GBP','EUR'];
const MAX_GPT_CALLS_PER_RUN = parseInt(process.env.MAX_GPT_CALLS_PER_RUN || '100', 10);

let gptCallsUsed = 0;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function rnd(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function htmlToVisibleText(html){
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  return $('body').text().replace(/\s+/g,' ').trim();
}
function coerceNumber(n){
  if (typeof n === 'number') return n;
  if (typeof n === 'string'){
    const cleaned = n.replace(/[^0-9.\-]/g,'');
    const val = Number(cleaned);
    return Number.isFinite(val) ? val : null;
  }
  return null;
}
function detectRetailer(url){
  try{
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('wayfair')) return 'Wayfair';
    if (host.includes('amazon')) return 'Amazon';
    if (host.includes('walmart')) return 'Walmart';
    if (host.includes('target')) return 'Target';
    if (host.includes('bestbuy')) return 'BestBuy';
    if (host.includes('homedepot')) return 'HomeDepot';
    return 'Generic';
  }catch{ return 'Generic'; }
}

// -------- Fetchers (Bee → Apify → Axios) --------
async function fetchViaScrapingBee(url){
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) return null;
  const countries = ['CA','US','GB'];
  for (const country of countries){
    try{
      const res = await axios.get('https://app.scrapingbee.com/api/v1', {
        timeout: TIMEOUT_MS,
        params: {
          api_key: key, url,
          render_js: 'true',
          country_code: country,
          block_resources: 'false',
          // wait param optional via env if you add it to Bee plan
        },
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300 && res.data) {
        console.log(`[ScrapingBee] OK via ${country}`);
        return typeof res.data === 'string' ? res.data : res.data.toString();
      }
      console.warn(`[ScrapingBee] Non-2xx ${res.status} via ${country}`);
      if (res.status !== 429 && (res.status < 500 || res.status >= 600)) return null;
    }catch(e){
      console.warn('[ScrapingBee] Error:', e.message);
    }
  }
  return null;
}

async function fetchViaApifySnapshot(url){
  const token = process.env.APIFY_API_KEY;
  if (!token) return null;
  try{
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
    const run = await client.actor('apify/web-scraper').call(input, { timeout: 90000, memory: 1024, waitSecs: 60 });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    if (items && items[0] && items[0].html){
      console.log('[Apify snapshot] OK');
      return items[0].html;
    }
    return null;
  }catch(e){
    console.warn('[Apify snapshot] Error:', e.message);
    return null;
  }
}

async function fetchViaAxios(url){
  let lastErr = null;
  for (let i=0;i<MAX_AXIOS_RETRIES;i++){
    try{
      const res = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${rnd(118,126)} Safari/537.36`,
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache', 'Pragma': 'no-cache',
        },
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data){
        console.log('[Axios] OK');
        return typeof res.data === 'string' ? res.data : res.data.toString();
      }
      if (res.status === 429){
        const waitMs = 1500*(i+1) + rnd(0,1500);
        console.warn(`[Axios] 429. Retry ${i + 1}/3 after ${waitMs}ms`);
        await sleep(waitMs); continue;
      }
      if (res.status >= 500 && res.status < 600){
        const waitMs = 1000*(i+1);
        console.warn(`[Axios] ${res.status}. Retry ${i + 1}/3 after ${waitMs}ms`);
        await sleep(waitMs); continue;
      }
      console.warn(`[Axios] Non-OK status: ${res.status}`);
      return null;
    }catch(e){
      lastErr = e;
      const waitMs = 800*(i+1);
      console.warn(`[Axios] Error ${i + 1}/3: ${e.message}. Waiting ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }
  if (lastErr) console.warn('[Axios] Final error:', lastErr.message);
  return null;
}

async function smartFetchHtml(url){
  let html = await fetchViaScrapingBee(url);
  if (html) return html;
  html = await fetchViaApifySnapshot(url);
  if (html) return html;
  html = await fetchViaAxios(url);
  return html;
}
// ------------------------------------------------

function vendorPromptHints(vendor){
  switch(vendor){
    case 'Wayfair':
      return `For Wayfair: prefer the current price near the main buy button; ignore per-month and struck list prices.`;
    case 'Amazon':
      return `For Amazon: prefer the price near "Add to Cart"; ignore subscription/per-month and struck list prices.`;
    case 'Walmart':
      return `For Walmart: prefer the main price above "Add to cart"; ignore fees and per-month financing.`;
    default:
      return `Prefer the most prominent product price near the buy action; ignore per-month financing and struck-through prices.`;
  }
}

async function parseWithGPT({ url, html, currencyFallback = DEFAULT_CURRENCY }){
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing for gptParser.');
  if (gptCallsUsed >= MAX_GPT_CALLS_PER_RUN) throw new Error('GPT budget limit reached for this run.');

  const client = new OpenAI({ apiKey });
  const vendor = detectRetailer(url);

  // Trim context to control tokens
  const visibleText = htmlToVisibleText(html).slice(0, 20000);
  const htmlSlice = html.slice(0, 20000);

  const system = `
You are a precise e-commerce product extractor.
Return STRICT JSON with fields:
- url (string)
- name (string)
- price (number, no currency symbols)
- currency (ISO code)
- image (string URL)
- brand (string, optional)
- sku (string, optional)
- availability (in_stock | out_of_stock | preorder | unknown)
- breadcrumbs (array of strings, optional)
- package_dimensions (object with length,width,height in inches, optional)
- package_weight_lbs (number, optional)

Rules:
- ${vendorPromptHints(vendor)}
- If currency is unclear, use "${currencyFallback}".
- "price" must be > 0 and realistic.
- Prefer selling price (not list/was/per-month).
- If you see an explicit "Package Dimensions" or "Box Dimensions", include them.
- "image" should be the main product image URL if visible.
`.trim();

  const user = `URL: ${url}\nExtract product data from the provided HTML and visible text.\nReturn ONLY JSON, no explanations.`;

  gptCallsUsed += 1;
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
  try { data = JSON.parse(response.choices[0].message.content || '{}'); }
  catch (e) { throw new Error(`LLM returned invalid JSON: ${e.message}`); }

  let currency = (typeof data.currency === 'string' ? data.currency.toUpperCase().trim() : '') || currencyFallback;
  if (!ALLOWED_CURRENCIES.includes(currency)) currency = currencyFallback;

  const price = coerceNumber(data.price);
  const name = typeof data.name === 'string' ? data.name.trim() : null;
  const image = typeof data.image === 'string' && data.image.startsWith('http') ? data.image : null;
  const brand = typeof data.brand === 'string' && data.brand.trim() ? data.brand.trim() : null;
  const sku = typeof data.sku === 'string' && data.sku.trim() ? data.sku.trim() : null;

  // Optional package dims normalization
  let pkgDims = null;
  if (data.package_dimensions && typeof data.package_dimensions === 'object') {
    const l = coerceNumber(data.package_dimensions.length);
    const w = coerceNumber(data.package_dimensions.width);
    const h = coerceNumber(data.package_dimensions.height);
    if ([l, w, h].every(Number.isFinite)) {
      pkgDims = { length: l, width: w, height: h };
    }
  }
  const pkgWeight = data.package_weight_lbs != null ? coerceNumber(data.package_weight_lbs) : null;

  if (!name || !price || price <= 0 || price > 200000) {
    throw new Error('GPT parse missing/invalid required fields (name/price).');
  }

  const availabilityRaw = (data.availability || '').toString().toLowerCase();
  const availability = ['in_stock','out_of_stock','preorder','unknown'].includes(availabilityRaw) ? availabilityRaw : 'unknown';

  const breadcrumbs = Array.isArray(data.breadcrumbs)
    ? data.breadcrumbs.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).slice(0, 10)
    : [];

  if (response.usage) {
    console.log(`[GPT usage] prompt_tokens=${response.usage.prompt_tokens} completion_tokens=${response.usage.completion_tokens}`);
  }

  return {
    url, name, price, currency, image, brand, sku, availability, breadcrumbs,
    package_dimensions: pkgDims,
    package_weight_lbs: pkgWeight,
    dimensions: null, weight: null, // keep placeholders for other parts of pipeline
    category: breadcrumbs[breadcrumbs.length - 1] || null,
    inStock: availability === 'in_stock',
    _meta: { vendor, model: MODEL, gptCallsUsed },
  };
}

async function parseProduct(url, opts = {}){
  const { currencyFallback = DEFAULT_CURRENCY } = opts;
  await sleep(rnd(200, 600));
  const html = await smartFetchHtml(url);
  if (!html) throw new Error('All HTML fetch methods failed (Bee/Apify/Axios).');
  return parseWithGPT({ url, html, currencyFallback });
}

module.exports = { parseProduct };
