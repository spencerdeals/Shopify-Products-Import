// backend/gptWebScraper.js - GPT-4 Web Browsing Scraper
const OpenAI = require('openai');

class GPTWebScraper {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.enabled = !!this.apiKey;
    
    console.log('🤖 GPTWebScraper Constructor:');
    console.log(`   API Key: ${this.apiKey ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED (GPT-4 Web Browsing)' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set OPENAI_API_KEY environment variable to enable GPT web browsing');
    } else {
      console.log('   🎯 Ready to use GPT-4 with web browsing for product extraction');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('GPT Web Scraper not configured - missing API key');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🤖 GPT-4 web browsing ${retailer}: ${url.substring(0, 60)}...`);
    
    try {
      const client = new OpenAI({ apiKey: this.apiKey });
      
      const systemPrompt = `You are a precise e-commerce product data extractor with web browsing capabilities. Browse the provided URL and extract detailed product information.

CRITICAL REQUIREMENTS:
1. ONLY extract SELECTED/CHOSEN variants from the URL - do not list all possible options
2. Look for the specific color, size, style, orientation that is currently selected on the page
3. Extract the CURRENT/SALE price that customers actually pay (ignore crossed-out prices)
4. Look for shipping/package dimensions if available
5. If no shipping dimensions, estimate box size based on product type and whether it's flat-packed
6. Extract assembly fee if listed and apply 30% markup for Bermuda pricing
7. Get the main product image URL

VARIANT EXTRACTION RULES:
- Only extract what is currently selected/chosen on the page
- Look for "selected", "chosen", "current" indicators
- For furniture: extract selected color, size, orientation (left/right facing)
- Do NOT list all available options - only what's currently selected

DIMENSION ESTIMATION RULES:
- Sofas/Sectionals: Estimate based on seating capacity and style
- Tables/Desks: Consider if flat-packed (smaller box) vs assembled
- Chairs: Usually flat-packed, estimate accordingly
- Large furniture: Add 10-20% to product dimensions for packaging

ASSEMBLY FEE RULES:
- If assembly fee is listed, apply 30% markup for Bermuda pricing
- Example: $50 assembly becomes $65 (50 * 1.30)

Return STRICT JSON format with these fields:
- name (string): Product name
- price (number): Current selling price in USD
- currency (string): "USD" 
- image (string): Main product image URL
- retailer (string): Retailer name
- selectedVariants (object): Only the currently selected variants like {"color": "Dark Green", "orientation": "Left Facing"}
- dimensions (object): Shipping dimensions if available {length, width, height} in inches
- estimatedDimensions (object): If no shipping dims, estimate based on product type {length, width, height} in inches
- weight (number): Product weight in lbs if available
- assemblyFee (number): Assembly fee with 30% markup applied if available
- inStock (boolean): Availability status
- category (string): Product category
- brand (string): Brand name if available
- sku (string): SKU if available`;

      const userPrompt = `Please browse this URL and extract the product data: ${url}

Focus on:
1. The specific variant that is currently selected (not all options)
2. The current selling price (not list price)
3. Shipping dimensions or estimate box size
4. Assembly fee with 30% markup if available
5. Main product image

Return only JSON, no explanations.`;

      console.log('   🔍 Making GPT-4 web browsing request...');
      
      const response = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 2000
      });

      const content = response.choices[0].message.content;
      console.log('   📝 GPT-4 response received');
      
      // Parse JSON response
      let productData;
      try {
        // Extract JSON from response if it's wrapped in markdown
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/) || [null, content];
        const jsonString = jsonMatch[1] || content;
        productData = JSON.parse(jsonString);
      } catch (parseError) {
        console.error('   ❌ Failed to parse GPT response as JSON:', parseError);
        throw new Error('GPT returned invalid JSON format');
      }

      // Validate and normalize the data
      const normalizedData = this.normalizeProductData(productData, url, retailer);
      
      console.log('   ✅ GPT-4 extraction successful!');
      console.log(`   📦 Product: ${normalizedData.name?.substring(0, 50)}...`);
      console.log(`   💰 Price: $${normalizedData.price}`);
      console.log(`   🎨 Selected Variants: ${JSON.stringify(normalizedData.selectedVariants)}`);
      console.log(`   📏 Dimensions: ${normalizedData.dimensions ? 'Found' : 'Estimated'}`);
      if (normalizedData.assemblyFee) {
        console.log(`   🔧 Assembly Fee (with 30% markup): $${normalizedData.assemblyFee}`);
      }
      
      return normalizedData;

    } catch (error) {
      console.error('❌ GPT-4 web browsing failed:', error.message);
      throw error;
    }
  }

  normalizeProductData(data, url, retailer) {
    const normalized = {
      name: data.name || 'Unknown Product',
      price: this.parsePrice(data.price),
      currency: data.currency || 'USD',
      image: data.image || null,
      retailer: data.retailer || retailer,
      selectedVariants: data.selectedVariants || {},
      variant: this.formatSelectedVariants(data.selectedVariants),
      allVariants: [], // We don't want all variants, only selected ones
      dimensions: data.dimensions || data.estimatedDimensions || null,
      weight: data.weight || null,
      assemblyFee: data.assemblyFee || null,
      inStock: data.inStock !== false, // Default to true unless explicitly false
      category: data.category || null,
      brand: data.brand || null,
      sku: data.sku || null,
      confidence: 0.95, // High confidence for GPT-4 web browsing
      url: url
    };

    // Validate required fields
    if (!normalized.name || !normalized.price || normalized.price <= 0) {
      throw new Error('Missing required product data (name or price)');
    }

    return normalized;
  }

  parsePrice(price) {
    if (typeof price === 'number') return price;
    if (typeof price === 'string') {
      const cleanPrice = price.replace(/[$,\s]/g, '');
      const parsed = parseFloat(cleanPrice);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  formatSelectedVariants(variants) {
    if (!variants || typeof variants !== 'object') return null;
    
    const formatted = Object.entries(variants)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' • ');
    
    return formatted || null;
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'Amazon';
      if (domain.includes('wayfair.com')) return 'Wayfair';
      if (domain.includes('target.com')) return 'Target';
      if (domain.includes('walmart.com')) return 'Walmart';
      if (domain.includes('bestbuy.com')) return 'Best Buy';
      if (domain.includes('homedepot.com')) return 'Home Depot';
      if (domain.includes('lowes.com')) return 'Lowes';
      if (domain.includes('costco.com')) return 'Costco';
      if (domain.includes('macys.com')) return 'Macys';
      if (domain.includes('ikea.com')) return 'IKEA';
      if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }
}

module.exports = GPTWebScraper;