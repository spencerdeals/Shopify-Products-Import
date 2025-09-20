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
      return `For Wayfair: prefer the current price near the main buy button; ignore per-month and struck list prices. Look for shipping/package dimensions if available.`;
    case 'Amazon':
      return `For Amazon: prefer the price near "Add to Cart"; ignore subscription/per-month and struck list prices. Check for shipping weight/dimensions in product details.`;
    case 'Walmart':
      return `For Walmart: prefer the main price above "Add to cart"; ignore fees and per-month financing. Look for shipping dimensions if listed.`;
    case 'Target':
      return `For Target: look for the main product price, ignore membership prices and financing. Check product specifications for shipping info.`;
    case 'BestBuy':
      return `For Best Buy: prefer the main price display, ignore membership discounts and financing. Electronics often have shipping dimensions listed.`;
    case 'HomeDepot':
      return `For Home Depot: look for the main selling price, ignore bulk pricing and special offers. Appliances may have shipping specifications.`;
    case 'CrateAndBarrel':
      return `For Crate & Barrel: look for the main product price (like $2,899.00), ignore financing options and membership prices. Extract dimensions from format like "23.8"H height 85.4"W width 37"D depth". Look for shipping/package dimensions if available.`;
    case 'IKEA':
      return `For IKEA: prefer the main price display, ignore assembly service costs. IKEA often lists package dimensions and weight.`;
    case 'LunaFurniture':
      return `For Luna Furniture: look for the current selling price, ignore compare-at prices. Check for shipping specifications.`;
    default:
      return `Prefer the most prominent product price near the buy action; ignore per-month financing and struck-through prices. Look for any shipping/package dimension information.`;
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

  // Extract URL parameters for variant detection
  const urlParams = new URL(url).searchParams.toString();
  const system = `
You are a precise e-commerce product extractor that returns accurate json data.
Return STRICT JSON with fields:
- url (string)
- name (string)
- price (number, no currency symbols - look for the CURRENT selling price like $639.99 or $809.99, not list/was/financing prices)
- currency (ISO code)
- image (string URL)
- brand (string, optional)
- sku (string, optional)
- availability (in_stock | out_of_stock | preorder | unknown)
- breadcrumbs (array of strings, optional)
- package_dimensions (object with length,width,height in inches, optional)
- package_weight_lbs (number, optional)
- variant (string, optional - SELECTED color/fabric, size, orientation from URL params or active elements)

CRITICAL VARIANT DETECTION:
- Look for SELECTED/ACTIVE options in HTML (aria-selected="true", .selected, .active)
- Parse URL parameters like piid=1222175087,1261760516,1262971467 to understand selections
- For Wayfair: Look for selected fabric color and orientation (Left/Right Hand Facing)
- Match the product image to the SELECTED variant, not the default

CRITICAL PRICE DETECTION:
- Look for the main selling price near "Add to Cart" or buy buttons
- For Wayfair: Look for prices like $639.99 or $809.99, ignore financing options
- Ignore struck-through "was" prices and monthly payment options
- The price should be realistic for furniture (typically $200-$5000)

- Look for the main selling price (like $639.99 or $809.99)
- Ignore struck-through "was" prices and financing options
- If you see an explicit "Package Dimensions" or "Box Dimensions", include them.
- "image" should match the SELECTED variant, not the default product image.
`.trim();

  const user = `URL: ${url}
URL Parameters: ${urlParams}

Extract product data and return json. Pay special attention to:
1. SELECTED variant options (not defaults)
2. Current selling price (not list prices)  
3. Product image matching the selected variant

Return ONLY valid json, no explanations.`;
  
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

  // Parse GPT's shipping box estimate
  let shippingBox = null;
  if (data.estimated_shipping_box && typeof data.estimated_shipping_box === 'object') {
    const box = data.estimated_shipping_box;
    const l = coerceNumber(box.length);
    const w = coerceNumber(box.width);
    const h = coerceNumber(box.height);
    const cf = coerceNumber(box.cubic_feet);
    const conf = coerceNumber(box.confidence);
    
    if ([l, w, h, cf].every(Number.isFinite) && l > 0 && w > 0 && h > 0 && cf > 0) {
      shippingBox = {
        length: l,
        width: w,
        height: h,
        cubic_feet: cf,
        confidence: conf || 75,
        reasoning: typeof box.reasoning === 'string' ? box.reasoning : 'GPT shipping analysis'
      };
    }
  }
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
    url, name, price, currency, image, brand, sku, availability, breadcrumbs, variant,
    package_dimensions: pkgDims,
    package_weight_lbs: pkgWeight,
    dimensions: pkgDims, // Map to expected field name
    weight: pkgWeight, // Map to expected field name
    estimated_shipping_box: shippingBox,
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
