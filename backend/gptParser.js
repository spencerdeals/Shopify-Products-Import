// gptParser.js - Clean GPT-based product parsing
const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');

const MODEL = process.env.GPT_PARSER_MODEL || 'gpt-4o-mini'; // Will upgrade to GPT-5 when available
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
    if (host.includes('crateandbarrel')) return 'CrateAndBarrel';
    if (host.includes('ikea')) return 'IKEA';
    if (host.includes('lunafurn')) return 'LunaFurniture';
    return 'Generic';
  }catch{ return 'Generic'; }
}

async function fetchViaAxios(url){
  let lastErr = null;
  for (let i=0;i<MAX_AXIOS_RETRIES;i++){
        const waitMs = 5000*(i+1) + rnd(2000,5000); // Much longer delays for 429
      // Add random delay to avoid rate limits
      if (i > 0) {
        await sleep(Math.random() * 2000 + 1000); // 1-3 second delay on retries
      if (res.status === 403){
        const waitMs = 8000*(i+1) + rnd(3000,5000); // Much longer for 403
        console.warn(`[Axios] 403. Retry ${i + 1}/3 after ${waitMs}ms`);
        await sleep(waitMs); continue;
      }
      }
      
      const res = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${rnd(120,125)}.0.0.0 Safari/537.36`,
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Cache-Control': 'no-cache', 'Pragma': 'no-cache',
      const waitMs = 1000*(i+1) + rnd(500,1500);
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1'
        },
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data){
// -------- Fetchers (Apify → Axios) --------
function vendorPromptHints(vendor){
  console.log('[GPT Parser] Starting smart HTML fetch...');
      return `For Wayfair: prefer the current price near the main buy button; ignore per-month and struck list prices.`;
  if (html) {
    console.log('[GPT Parser] Got HTML via Apify');
    return html;
  }
      return `For Amazon: prefer the price near "Add to Cart"; ignore subscription/per-month and struck list prices.`;
  if (html) {
    console.log('[GPT Parser] Got HTML via Axios');
  } else {
    console.log('[GPT Parser] All fetch methods failed');
  }
    case 'Walmart':
      return `For Walmart: prefer the main price above "Add to cart"; ignore fees and per-month financing.`;
      return `Prefer the most prominent product price near the buy action; ignore per-month financing and struck-through prices.`;
  }
}

async function parseWithGPT({ url, html, currencyFallback = DEFAULT_CURRENCY }){
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing for gptParser.');
  if (gptCallsUsed >= MAX_GPT_CALLS_PER_RUN) throw new Error('GPT budget limit reached for this run.');

    case 'CrateAndBarrel':
      return `For Crate & Barrel: look for the main product price, ignore financing options and membership prices.`;
    case 'IKEA':
      return `For IKEA: prefer the main price display, ignore assembly service costs.`;
    case 'LunaFurniture':
      return `For Luna Furniture: look for the current selling price, ignore compare-at prices.`;
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
- variant (string, optional - color, size, style)

Rules:
- ${vendorPromptHints(vendor)}
- If currency is unclear, use "${currencyFallback}".
- "price" must be > 0 and realistic.
- Prefer selling price (not list/was/per-month).
- If you see an explicit "Package Dimensions" or "Box Dimensions", include them.
- "image" should be the main product image URL if visible.
- Extract variant info like color, size, or style if clearly selected.
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
  console.log(`[GPT Parser] Making GPT call ${gptCallsUsed}/${MAX_GPT_CALLS_PER_RUN} for ${vendor}`);
  
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
  const variant = typeof data.variant === 'string' && data.variant.trim() ? data.variant.trim() : null;

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
      // Add random delay to avoid rate limits
      if (i > 0) {
        await sleep(Math.random() * 2000 + 1000); // 1-3 second delay on retries
      }
      
    ? data.breadcrumbs.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).slice(0, 10)
    : [];

          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${rnd(120,125)}.0.0.0 Safari/537.36`,
    console.log(`[GPT usage] prompt_tokens=${response.usage.prompt_tokens} completion_tokens=${response.usage.completion_tokens}`);
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  }
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
    console.log(`[GPT Parser] Usage: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion tokens`);
          'Upgrade-Insecure-Requests': '1'

  return {
    url, name, price, currency, image, brand, sku, availability, breadcrumbs, variant,
    package_dimensions: pkgDims,
    package_weight_lbs: pkgWeight,
    dimensions: pkgDims, // Map to expected field name
    weight: pkgWeight, // Map to expected field name
    category: breadcrumbs[breadcrumbs.length - 1] || null,
    inStock: availability === 'in_stock',
    _meta: { vendor, model: MODEL, gptCallsUsed },
  };
}

async function parseProduct(url, opts = {}){
  const { currencyFallback = DEFAULT_CURRENCY } = opts;
  await sleep(rnd(200, 600));
  console.log(`[GPT Parser] Starting product parsing for: ${url}`);
  const html = await smartFetchHtml(url);
  if (!html) throw new Error('All HTML fetch methods failed (Apify/Axios).');
  return parseWithGPT({ url, html, currencyFallback });
}

module.exports = { parseProduct };