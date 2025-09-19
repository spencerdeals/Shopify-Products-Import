const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const { URL } = require('url');
require('dotenv').config();

// Configuration
const MAX_AXIOS_RETRIES = 0; // Just one attempt, no retries
const AXIOS_TIMEOUT = 15000;
const MAX_HTML_SIZE = 2 * 1024 * 1024; // 2MB limit

// Initialize OpenAI client
let openaiClient = null;
if (process.env.OPENAI_API_KEY) {
  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

console.log('[GPT Parser] Initialized:', {
  openaiAvailable: !!openaiClient,
  maxRetries: MAX_AXIOS_RETRIES,
  timeout: AXIOS_TIMEOUT
});

// Smart HTML fetching with multiple methods
async function fetchHTML(url) {
  console.log('[GPT Parser] Starting smart HTML fetch...');
  
  // Method 1: Direct Axios (fastest, but often blocked)
  try {
    console.log('[Axios] Attempting direct fetch...');
    const response = await axios.get(url, {
      timeout: AXIOS_TIMEOUT,
      maxContentLength: MAX_HTML_SIZE,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    if (response.data && response.data.length > 100) {
      console.log('[Axios] ✅ Success');
      return response.data;
    }
    throw new Error('Empty or invalid response');
  } catch (error) {
    console.log(`[Axios] ${error.response?.status || 'Network error'}. No retries configured.`);
    throw new Error('Axios failed after retries');
  }
}

// Enhanced product parsing with GPT-4
async function parseProduct(url) {
  if (!openaiClient) {
    throw new Error('OpenAI API key not configured');
  }
  
  console.log(`[GPT Parser] Starting product parsing for: ${url}`);
  
  try {
    // Fetch HTML content
    const html = await fetchHTML(url);
    console.log(`[GPT Parser] HTML fetched successfully (${html.length} chars)`);
    
    // Truncate HTML if too large (GPT has token limits)
    const truncatedHtml = html.length > 50000 ? html.substring(0, 50000) + '...[truncated]' : html;
    
    // Detect retailer for specialized parsing
    const domain = new URL(url).hostname.toLowerCase();
    let retailerInstructions = '';
    
    if (domain.includes('crateandbarrel.com')) {
      retailerInstructions = `
SPECIAL INSTRUCTIONS FOR CRATE & BARREL:
- Extract dimensions from format like "23.8"H height 85.4"W width 37"D depth" 
- Convert to: length=85.4, width=37, height=23.8 (W=length, D=width, H=height)
- Look for price in elements with class "MoneyPrice" or similar
- Product name is usually in h1 or .ProductName elements`;
    } else if (domain.includes('wayfair.com')) {
      retailerInstructions = `
SPECIAL INSTRUCTIONS FOR WAYFAIR:
- Look for dimensions in product specifications or details section
- Price is often in elements with "price" in the class name
- Product name is usually in h1 or main heading`;
    } else if (domain.includes('amazon.com')) {
      retailerInstructions = `
SPECIAL INSTRUCTIONS FOR AMAZON:
- Look for dimensions in "Product Dimensions" or "Package Dimensions"
- Price is in elements with id "price" or class containing "price"
- Product name is in span with id "productTitle"`;
    }
    
    const prompt = `Extract product information from this webpage HTML and return ONLY valid JSON with these exact fields:
{
  "name": "product name as string",
  "price": numeric_price_without_currency_symbols,
  "dimensions": {
    "length": numeric_inches,
    "width": numeric_inches, 
    "height": numeric_inches
  },
  "image": "main_product_image_url",
  "brand": "brand_name_if_found",
  "category": "product_category",
  "variant": "color_size_or_variant_if_found",
  "inStock": true_or_false
}

${retailerInstructions}

CRITICAL RULES:
- Return ONLY valid JSON, no explanations
- Price must be numeric (remove $, commas, etc.)
- Dimensions must be in inches as numbers
- If dimensions not found, omit the dimensions field entirely
- Extract the main product image URL if visible
- Focus on the primary product being sold

HTML Content:
${truncatedHtml}`;

    console.log('[GPT Parser] Sending to OpenAI...');
    
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a product data extraction specialist. Return only valid JSON with the requested product information.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log('[GPT Parser] ✅ Successfully parsed product:', {
      hasName: !!result.name,
      hasPrice: !!result.price,
      hasDimensions: !!result.dimensions,
      hasImage: !!result.image
    });
    
    return result;
    
  } catch (error) {
    console.log('[GPT Parser] ❌ Parsing failed:', error.message);
    
    if (error.message.includes('Axios failed')) {
      throw new Error('All HTML fetch methods failed (Apify/Axios).');
    }
    
    throw new Error(`GPT parsing failed: ${error.message}`);
  }
}

module.exports = { parseProduct };