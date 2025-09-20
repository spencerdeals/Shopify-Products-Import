// gptParser.js - Clean GPT-based product parsing
const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');

const MODEL = process.env.GPT_PARSER_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = 30000;
const MAX_AXIOS_RETRIES = 1;
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
      let waitMs; // Declare once at loop scope
      // Add random delay to avoid rate limits
      if (i > 0) {
        await sleep(Math.random() * 2000 + 1000); // 1-3 second delay on retries
      }
      
      try {
      const res = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${rnd(120,125)}.0.0.0 Safari/537.36`,
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Cache-Control': 'no-cache', 'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1'
        },
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data){
        return res.data;
      }
      if (res.status === 429){
        waitMs = 5000*(i+1) + rnd(2000,5000); // Much longer delays for 429
        console.warn(`[Axios] 429. Retry ${i + 1}/3 after ${waitMs}ms`);
        await sleep(waitMs); continue;
      }
      if (res.status === 403){
        waitMs = 8000*(i+1) + rnd(3000,5000); // Much longer for 403
        console.warn(`[Axios] 403. Retry ${i + 1}/3 after ${waitMs}ms`);
        await sleep(waitMs); continue;
      }
      waitMs = 1000*(i+1) + rnd(500,1500);
      console.warn(`[Axios] ${res.status}. Retry ${i + 1}/3 after ${waitMs}ms`);
      await sleep(waitMs);
    } catch (err) {
      lastErr = err;
      waitMs = 1000*(i+1) + rnd(500,1500);
      console.warn(`[Axios] Error. Retry ${i + 1}/3 after ${waitMs}ms: ${err.message}`);
      await sleep(waitMs);
    }
  }
  throw lastErr || new Error('Axios failed after retries');
}

async function smartFetchHtml(url) {
  console.log('[GPT Parser] Starting smart HTML fetch...');
  let html = null;
  
  // Try Apify first (if available)
  try {
    // html = await fetchViaApify(url);
  } catch (err) {
    console.warn('[GPT Parser] Apify failed:', err.message);
  }
  
  if (html) {
    console.log('[GPT Parser] Got HTML via Apify');
    return html;
  }
  
  // Fallback to Axios
  try {
    html = await fetchViaAxios(url);
  } catch (err) {
    console.warn('[GPT Parser] Axios failed:', err.message);
  }
  
  if (html) {
    console.log('[GPT Parser] Got HTML via Axios');
  } else {
    console.log('[GPT Parser] All fetch methods failed');
  }
  
  return html;
}

// -------- Fetchers (Apify → Axios) --------
function vendorPromptHints(vendor){
  switch (vendor) {
    case 'Wayfair':
      return `For Wayfair: CRITICAL - ONLY use SALE/CURRENT prices. Look for prices in red text, highlighted boxes, or marked as "sale", "current", "now". IGNORE regular prices, "was" prices, and financing options. The sale price is usually larger and more prominent near "Add to Cart".`;
    case 'Amazon':
      return `For Amazon: CRITICAL - ONLY use SALE/DEAL prices. Look for prices in red, marked as "deal", "sale", or "current price". IGNORE struck-through list prices and subscription pricing.`;
    case 'Walmart':
      return `For Walmart: CRITICAL - ONLY use CURRENT/NOW prices. Look for highlighted prices marked as "now", "current", or "sale". IGNORE "was" prices and financing options.`;
    case 'Target':
      return `For Target: CRITICAL - ONLY use SALE/CURRENT prices. Look for red prices, "sale" prices, or "current" prices. IGNORE "reg" and "was" prices.`;
    case 'BestBuy':
      return `For Best Buy: CRITICAL - ONLY use SALE/CURRENT prices. Look for highlighted sale prices. IGNORE regular prices and membership pricing.`;
    case 'HomeDepot':
      return `For Home Depot: CRITICAL - ONLY use SALE/SPECIAL prices. Look for highlighted special prices. IGNORE regular prices and bulk pricing.`;
    case 'CrateAndBarrel':
      return `For Crate & Barrel: CRITICAL - ONLY use SALE/CURRENT prices. Look for highlighted sale prices. IGNORE regular prices and financing. Extract dimensions from format like "23.8"H height 85.4"W width 37"D depth".`;
    case 'IKEA':
      return `For IKEA: CRITICAL - ONLY use MEMBER/SALE prices. Look for member prices or sale prices. IGNORE regular prices and service costs.`;
    case 'LunaFurniture':
      return `For Luna Furniture: CRITICAL - ONLY use SALE/CURRENT prices. Look for sale prices. IGNORE "compare at" and "was" prices.`;
    default:
      return `CRITICAL - ONLY use SALE/CURRENT prices. Look for prices marked as "sale", "now", "current", or highlighted in red/bold. COMPLETELY IGNORE regular/list/was prices and financing options.`;
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
Return STRICT JSON format with fields:
- url (string)
- name (string)
- price (number, no currency symbols - MUST be the SALE/CURRENT price, NOT regular/list price)
- currency (ISO code)
- image (string URL)
- brand (string, optional)
- sku (string, optional)
- availability (in_stock | out_of_stock | preorder | unknown)
- breadcrumbs (array of strings, optional)
- package_dimensions (object with length,width,height in inches, optional)
- package_weight_lbs (number, optional)
- variant (string, optional - primary selected variant)
- allVariants (array of strings, optional - all available variants like ["Color: Navy", "Size: King"])

Rules:
- ${vendorPromptHints(vendor)}
- If currency is unclear, use "${currencyFallback}".
- CRITICAL: "price" field MUST ONLY contain the SALE/CURRENT price that customers actually pay.
- Look ONLY for prices that are highlighted, in red, bold, or explicitly marked as "sale", "now", "current", "special".
- COMPLETELY IGNORE and DO NOT USE: struck-through prices, "was" prices, "reg" prices, "list" prices, "MSRP", financing options, or any crossed-out prices.
- If you see multiple prices, ALWAYS choose the sale/current price over the regular price.
- The sale price is usually more prominent, larger, or in a different color (often red).
- If you see an explicit "Package Dimensions" or "Box Dimensions", include them.
- For dimensions like "23.8"H height 85.4"W width 37"D depth", convert to: length=85.4, width=37, height=23.8
- "image" should be the main product image URL if visible.
- Extract ALL variant info: color, size, style, material, orientation if clearly selected.
- "allVariants" should be array like ["Color: Navy Blue", "Size: King", "Style: Left-facing"]
- "variant" should be the primary combined variant like "Navy Blue King Left-facing"
- Look for SKU numbers in the content.
`.trim();

  const user = `URL: ${url}\nExtract product data from the provided HTML and visible text.\nReturn ONLY JSON, no explanations.`;

  console.log(`[GPT Parser] Making GPT call ${gptCallsUsed}/${MAX_GPT_CALLS_PER_RUN} for ${vendor}`);
  
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
  const variant = typeof data.variant === 'string' && data.variant.trim() ? data.variant.trim() : null;
  const allVariants = Array.isArray(data.allVariants) ? data.allVariants.filter(v => typeof v === 'string' && v.trim()) : [];

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
  } else {
    console.log(`[GPT Parser] Usage: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion tokens`);
  }

  return {
    url, name, price, currency, image, brand, sku, availability, breadcrumbs, variant, allVariants,
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