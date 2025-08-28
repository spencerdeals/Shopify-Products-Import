const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

// Environment variables
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;

// Trust proxy for Railway deployment
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use(express.static('frontend'));

// Intelligent Estimation System
class IntelligentEstimator {
    constructor() {
        // Category densities (cubic feet per pound)
        this.categoryDensities = {
            'small-electronics': 0.15,
            'medium-electronics': 0.25,
            'large-electronics': 0.4,
            'books': 0.08,
            'clothing': 1.5,
            'toys': 1.0,
            'furniture': 0.5,
            'tools': 0.2,
            'sports': 0.8,
            'jewelry': 0.05,
            'default': 0.5
        };

        // Keywords for classification
        this.categoryKeywords = {
            'small-electronics': ['phone', 'earbuds', 'charger', 'cable', 'adapter', 'battery', 'case', 'airpods', 'watch'],
            'medium-electronics': ['laptop', 'tablet', 'monitor', 'speaker', 'headphones', 'keyboard', 'mouse', 'printer'],
            'large-electronics': ['tv', 'television', 'refrigerator', 'washer', 'dryer', 'microwave', 'oven', 'dishwasher'],
            'books': ['book', 'paperback', 'hardcover', 'textbook', 'novel', 'magazine'],
            'clothing': ['shirt', 'pants', 'dress', 'jacket', 'coat', 'shoes', 'hat', 'clothing', 'apparel'],
            'toys': ['toy', 'game', 'puzzle', 'doll', 'action figure', 'lego', 'playset'],
            'furniture': ['chair', 'table', 'desk', 'sofa', 'bed', 'cabinet', 'shelf', 'furniture'],
            'tools': ['drill', 'hammer', 'saw', 'wrench', 'tool', 'screwdriver', 'pliers'],
            'sports': ['ball', 'racket', 'helmet', 'bike', 'weights', 'fitness', 'exercise'],
            'jewelry': ['ring', 'necklace', 'bracelet', 'earring', 'jewelry', 'watch']
        };
    }

    extractWeight(html, title) {
        console.log('Attempting to extract weight from HTML...');
        
        // Common weight patterns
        const weightPatterns = [
            /(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/gi,
            /(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)/gi,
            /weight[:\s]+(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/gi,
            /shipping\s+weight[:\s]+(\d+(?:\.\d+)?)/gi
        ];

        for (const pattern of weightPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                let weight = parseFloat(match[1]);
                
                // Convert kg to lbs if needed
                if (match[0].toLowerCase().includes('kg')) {
                    weight = weight * 2.20462;
                }
                
                if (weight > 0 && weight < 1000) {
                    console.log(`Found product weight: ${weight} lbs`);
                    return weight;
                }
            }
        }
        
        console.log('No weight found in HTML');
        return null;
    }

    classifyProduct(title, description = '') {
        const combinedText = `${title} ${description}`.toLowerCase();
        
        for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
            for (const keyword of keywords) {
                if (combinedText.includes(keyword)) {
                    console.log(`Product classified as: ${category}`);
                    return category;
                }
            }
        }
        
        console.log('Using default classification');
        return 'default';
    }

    estimateFromWeight(weight, category, confidence = 'high') {
        const density = this.categoryDensities[category];
        let cubicFeet = weight * density;
        
        // Apply confidence buffers
        const buffers = {
            'high': 1.1,
            'medium': 1.3,
            'low': 1.5,
            'fallback': 2.0
        };
        
        cubicFeet = cubicFeet * buffers[confidence];
        
        // Apply category-specific limits
        const maxSizes = {
            'small-electronics': 2,
            'medium-electronics': 5,
            'large-electronics': 20,
            'books': 3,
            'clothing': 4,
            'toys': 6,
            'furniture': 30,
            'tools': 4,
            'sports': 8,
            'jewelry': 0.5,
            'default': 10
        };
        
        cubicFeet = Math.min(cubicFeet, maxSizes[category]);
        console.log(`Weight ${weight} lbs × density ${density} = ${cubicFeet.toFixed(2)} cu ft (confidence: ${confidence})`);
        
        return Math.max(0.5, cubicFeet);
    }

    estimateFromPrice(price, category) {
        console.log(`Using price-based estimation: $${price} in category ${category}`);
        
        // Price to volume ratios by category
        const priceRatios = {
            'small-electronics': { under100: 0.5, under500: 1.5, under1000: 2.5, over1000: 3 },
            'medium-electronics': { under100: 1, under500: 2, under1000: 4, over1000: 6 },
            'large-electronics': { under100: 2, under500: 5, under1000: 10, over1000: 15 },
            'books': { under100: 0.3, under500: 1, under1000: 2, over1000: 3 },
            'clothing': { under100: 1, under500: 2, under1000: 3, over1000: 4 },
            'toys': { under100: 1.5, under500: 3, under1000: 5, over1000: 8 },
            'furniture': { under100: 3, under500: 8, under1000: 15, over1000: 25 },
            'tools': { under100: 0.5, under500: 1.5, under1000: 3, over1000: 5 },
            'sports': { under100: 2, under500: 4, under1000: 6, over1000: 10 },
            'jewelry': { under100: 0.1, under500: 0.2, under1000: 0.3, over1000: 0.4 },
            'default': { under100: 1, under500: 3, under1000: 5, over1000: 8 }
        };
        
        const ratios = priceRatios[category] || priceRatios['default'];
        let cubicFeet;
        
        if (price < 100) cubicFeet = ratios.under100;
        else if (price < 500) cubicFeet = ratios.under500;
        else if (price < 1000) cubicFeet = ratios.under1000;
        else cubicFeet = ratios.over1000;
        
        // Apply confidence buffer for price-based estimation
        cubicFeet = cubicFeet * 1.5;
        
        console.log(`Price-based estimation: ${cubicFeet.toFixed(2)} cu ft`);
        return Math.max(0.5, cubicFeet);
    }

    estimateDimensions(productData) {
        const { title, price, html } = productData;
        
        // Extract weight if possible
        const weight = this.extractWeight(html, title);
        
        // Classify product
        const category = this.classifyProduct(title);
        
        let cubicFeet;
        let confidence;
        
        if (weight) {
            // Best case: we have weight
            confidence = 'high';
            cubicFeet = this.estimateFromWeight(weight, category, confidence);
        } else {
            // Fallback to price-based estimation
            confidence = 'fallback';
            cubicFeet = this.estimateFromPrice(price, category);
        }
        
        // Apply order value minimums
        if (price >= 1000) {
            cubicFeet = Math.max(cubicFeet, 10);
        } else if (price >= 500) {
            cubicFeet = Math.max(cubicFeet, 6);
        } else if (price >= 300) {
            cubicFeet = Math.max(cubicFeet, 3.5);
        }
        
        console.log(`Final estimation: ${cubicFeet.toFixed(2)} cu ft (category: ${category}, confidence: ${confidence})`);
        
        return {
            cubicFeet: parseFloat(cubicFeet.toFixed(2)),
            category,
            confidence,
            weight
        };
    }
}

// Scraping function
async function scrapeProduct(url) {
    console.log('Scraping URL:', url);
    
    try {
        const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
            params: {
                api_key: SCRAPINGBEE_API_KEY,
                url: url,
                render_js: 'true',
                premium_proxy: 'true',
                country_code: 'us'
            }
        });

        const html = response.data;
        
        // Extract price
        const priceMatch = html.match(/[\$]([0-9,]+\.?[0-9]*)/);
        const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : 0;
        
        // Extract title
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1] : '';
        
        console.log('Scraped price:', price);
        console.log('Scraped title:', title);
        
        return {
            price,
            title,
            html: html.substring(0, 50000) // Limit HTML size for processing
        };
    } catch (error) {
        console.error('Scraping error:', error.message);
        throw error;
    }
}

// Margin calculation
function calculateMargin(orderValue) {
    if (orderValue <= 400) {
        return 0.45; // 45% margin
    } else if (orderValue <= 1500) {
        return 0.30; // 30% margin
    } else {
        return 0.20; // 20% margin
    }
}

// Main calculation endpoint
app.post('/api/calculate', async (req, res) => {
    console.log('=== New Calculation Request ===');
    const { url, usShipping = 0 } = req.body;
    
    try {
        // Scrape product data
        const productData = await scrapeProduct(url);
        
        if (!productData.price || productData.price === 0) {
            return res.status(400).json({ 
                error: 'Could not extract price from the product page' 
            });
        }
        
        // Initialize estimator
        const estimator = new IntelligentEstimator();
        
        // Estimate dimensions
        const estimation = estimator.estimateDimensions(productData);
        
        // Calculate costs
        const itemCost = productData.price;
        const importDuty = itemCost * 0.265; // 26.5% import duty
        const usaDelivery = usShipping;
        
        // Calculate freight
        const freightRate = 7.50; // $7.50 per cubic foot
        let baseFreight = estimation.cubicFeet * freightRate;
        
        // Apply minimums
        const absoluteMin = 35;
        const percentageMin = itemCost * 0.15;
        baseFreight = Math.max(baseFreight, absoluteMin, percentageMin);
        
        // Apply maximum (50% of order value)
        const maxFreight = itemCost * 0.5;
        baseFreight = Math.min(baseFreight, maxFreight);
        
        // Calculate margin
        const marginRate = calculateMargin(itemCost);
        const margin = baseFreight * marginRate;
        
        // Total freight and handling (includes margin)
        const freightHandling = baseFreight + margin;
        
        // Total cost
        const totalCost = itemCost + importDuty + usaDelivery + freightHandling;
        
        console.log('=== Calculation Summary ===');
        console.log(`Product: ${productData.title}`);
        console.log(`Category: ${estimation.category}`);
        console.log(`Weight: ${estimation.weight || 'Not found'}`);
        console.log(`Cubic Feet: ${estimation.cubicFeet}`);
        console.log(`Base Freight: $${baseFreight.toFixed(2)}`);
        console.log(`Margin (${(marginRate * 100)}%): $${margin.toFixed(2)}`);
        console.log(`Total Freight & Handling: $${freightHandling.toFixed(2)}`);
        console.log('========================');
        
        res.json({
            itemCost,
            importDuty,
            usaDelivery,
            freightHandling,
            totalCost,
            productTitle: productData.title,
            estimation: {
                cubicFeet: estimation.cubicFeet,
                category: estimation.category,
                confidence: estimation.confidence
            }
        });
        
    } catch (error) {
        console.error('Calculation error:', error);
        res.status(500).json({ 
            error: 'Failed to calculate shipping costs',
            details: error.message 
        });
    }
});

// Create Shopify draft order endpoint
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
    console.log('Creating Shopify draft order...');
    const { itemCost, importDuty, usaDelivery, freightHandling, totalCost, productTitle } = req.body;
    
    try {
        const draftOrder = {
            draft_order: {
                line_items: [
                    {
                        title: productTitle || "Imported Product",
                        quantity: 1,
                        price: itemCost.toFixed(2)
                    },
                    {
                        title: "Bermuda Import Duty (26.5%)",
                        quantity: 1,
                        price: importDuty.toFixed(2)
                    },
                    {
                        title: "USA Delivery Fee",
                        quantity: 1,
                        price: usaDelivery.toFixed(2)
                    },
                    {
                        title: "Ocean Freight & Handling",
                        quantity: 1,
                        price: freightHandling.toFixed(2)
                    }
                ],
                customer: {
                    email: "customer@example.com"
                },
                use_customer_default_address: true,
                tags: "instant-import"
            }
        };
        
        const response = await axios.post(
            `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/draft_orders.json`,
            draftOrder,
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('Draft order created successfully:', response.data.draft_order.id);
        res.json({ 
            success: true, 
            draftOrder: response.data.draft_order 
        });
        
    } catch (error) {
        console.error('Error creating draft order:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Failed to create draft order',
            details: error.response?.data || error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        version: '2.1',
        features: ['intelligent-estimation', 'weight-detection', 'category-classification']
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Intelligent Estimation System: ACTIVE');
    console.log('Environment:', process.env.NODE_ENV || 'development');
});
