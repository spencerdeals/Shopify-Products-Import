// gptWebScraper.js - Use GPT's web browsing capability
const OpenAI = require('openai');

class GPTWebScraper {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.enabled = !!this.apiKey;
    
    if (this.enabled) {
      console.log('🤖 GPT Web Scraper initialized - Using GPT web browsing');
    } else {
      console.log('🤖 GPT Web Scraper disabled - No OpenAI API Key');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('OpenAI API key not configured');
    }

    console.log(`🤖 GPT Web browsing: ${url}`);
    
    const client = new OpenAI({ apiKey: this.apiKey });
    
    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o', // Use GPT-4 with web browsing
        messages: [
          {
            role: 'system',
            content: `You are a product information extractor. When given a product URL, browse to it and extract detailed product information.

Return ONLY a JSON object with these exact fields:
{
  "name": "Product name",
  "price": 123.45,
  "currency": "USD",
  "image": "https://image-url.com/image.jpg",
  "brand": "Brand name",
  "sku": "SKU123",
  "availability": "in_stock",
  "dimensions": {
    "length": 89.5,
    "width": 65,
    "height": 33
  },
  "weight": 191,
  "variant": "Dark Green Corduroy Left Hand Facing",
  "allVariants": ["Dark Green Corduroy", "Beige Corduroy", "Black Corduroy"],
  "category": "Sectionals",
  "description": "Brief product description"
}

CRITICAL RULES:
1. Extract the CURRENT/SALE price that customers actually pay
2. IGNORE struck-through "was" prices, list prices, or financing options
3. For dimensions, use the actual product dimensions in inches
4. If multiple variants exist, list the currently selected one in "variant"
5. Include all available color/size options in "allVariants"
6. Use the main product image URL
7. Return valid JSON only, no explanations`
          },
          {
            role: 'user',
            content: `Please browse to this URL and extract the product information: ${url}`
          }
        ],
        temperature: 0
      });

      const content = response.choices[0].message.content;
      console.log('🤖 GPT Response:', content);
      
      let productData;
      try {
        productData = JSON.parse(content);
      } catch (parseError) {
        console.error('❌ Failed to parse GPT response as JSON:', parseError);
        throw new Error('GPT returned invalid JSON');
      }

      // Validate required fields
      if (!productData.name || !productData.price) {
        throw new Error('Missing required product data (name or price)');
      }

      // Ensure dimensions exist
      if (!productData.dimensions) {
        productData.dimensions = { length: 24, width: 18, height: 12 };
      }

      // Add retailer detection
      const hostname = new URL(url).hostname.toLowerCase();
      let retailer = 'Unknown';
      if (hostname.includes('wayfair')) retailer = 'Wayfair';
      else if (hostname.includes('amazon')) retailer = 'Amazon';
      else if (hostname.includes('walmart')) retailer = 'Walmart';
      else if (hostname.includes('target')) retailer = 'Target';
      else if (hostname.includes('bestbuy')) retailer = 'Best Buy';
      else if (hostname.includes('homedepot')) retailer = 'Home Depot';
      else if (hostname.includes('crateandbarrel')) retailer = 'Crate & Barrel';
      else if (hostname.includes('ikea')) retailer = 'IKEA';

      console.log(`✅ GPT Web success! Product: "${productData.name}" Price: $${productData.price}`);

      return {
        url,
        name: productData.name,
        price: productData.price,
        currency: productData.currency || 'USD',
        image: productData.image,
        brand: productData.brand,
        sku: productData.sku,
        dimensions: productData.dimensions,
        weight: productData.weight,
        variant: productData.variant,
        allVariants: productData.allVariants || [],
        category: productData.category,
        description: productData.description,
        inStock: productData.availability === 'in_stock',
        retailer,
        manualEntryRequired: false
      };

    } catch (error) {
      console.error(`❌ GPT Web browsing failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = GPTWebScraper;