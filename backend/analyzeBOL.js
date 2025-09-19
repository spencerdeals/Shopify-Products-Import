// BOL Data Analysis - Shipping Cost vs Retail Price Percentages
const fs = require('fs');
const path = require('path');

async function analyzeBOLData() {
    try {
        // Load the BOL data
        const bolDataPath = path.join(__dirname, 'bol-data.json');
        const rawData = await fs.promises.readFile(bolDataPath, 'utf8');
        const bolData = JSON.parse(rawData);
        
        console.log('📊 BOL DATA ANALYSIS - Shipping Cost vs Retail Price');
        console.log('=' .repeat(60));
        console.log(`Total BOL records: ${bolData.length}`);
        
        // Filter records that have both cost and volume data
        const validRecords = bolData.filter(record => {
            const hasVolume = record.volume_ft3 || record.volume_ft3_estimated;
            const hasCost = record.other_costs_usd_total && record.other_costs_usd_total > 0;
            return hasVolume && hasCost;
        });
        
        console.log(`Records with volume and cost data: ${validRecords.length}`);
        console.log('');
        
        if (validRecords.length === 0) {
            console.log('❌ No records found with both volume and cost data');
            return;
        }
        
        // Analyze each record
        const analyses = [];
        
        validRecords.forEach((record, index) => {
            const volume = record.volume_ft3 || record.volume_ft3_estimated;
            const totalCost = record.other_costs_usd_total;
            const freightCost = record.freight_cost_usd || record.freight_cost_usd_estimated;
            
            // Extract product info from raw text
            const rawText = record.raw_text_sample || '';
            const productKeywords = extractProductInfo(rawText);
            
            // Estimate retail price based on patterns
            const estimatedRetailPrice = estimateRetailPrice(rawText, totalCost, volume);
            
            // Calculate shipping percentage
            let shippingPercentage = null;
            let actualShippingCost = freightCost || (totalCost * 0.6); // Assume 60% of total cost is shipping
            
            if (estimatedRetailPrice > 0) {
                shippingPercentage = (actualShippingCost / estimatedRetailPrice) * 100;
            }
            
            const analysis = {
                recordIndex: index + 1,
                bolNumber: record.bol_number || 'Unknown',
                volume: volume,
                totalCost: totalCost,
                estimatedRetailPrice: estimatedRetailPrice,
                actualShippingCost: actualShippingCost,
                shippingPercentage: shippingPercentage,
                productKeywords: productKeywords,
                rawTextSample: rawText.substring(0, 100)
            };
            
            analyses.push(analysis);
        });
        
        // Display individual analyses
        console.log('📋 INDIVIDUAL RECORD ANALYSIS:');
        console.log('-'.repeat(60));
        
        analyses.forEach(analysis => {
            console.log(`Record #${analysis.recordIndex} (BOL: ${analysis.bolNumber})`);
            console.log(`  Volume: ${analysis.volume.toFixed(2)} ft³`);
            console.log(`  Total Cost: $${analysis.totalCost.toFixed(2)}`);
            console.log(`  Est. Retail Price: $${analysis.estimatedRetailPrice.toFixed(2)}`);
            console.log(`  Shipping Cost: $${analysis.actualShippingCost.toFixed(2)}`);
            if (analysis.shippingPercentage) {
                console.log(`  📊 SHIPPING %: ${analysis.shippingPercentage.toFixed(1)}%`);
            }
            console.log(`  Products: ${analysis.productKeywords.join(', ') || 'Unknown'}`);
            console.log(`  Sample: "${analysis.rawTextSample}..."`);
            console.log('');
        });
        
        // Calculate overall statistics
        const validPercentages = analyses.filter(a => a.shippingPercentage !== null);
        
        if (validPercentages.length > 0) {
            const percentages = validPercentages.map(a => a.shippingPercentage);
            const avgPercentage = percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
            const minPercentage = Math.min(...percentages);
            const maxPercentage = Math.max(...percentages);
            const medianPercentage = percentages.sort((a, b) => a - b)[Math.floor(percentages.length / 2)];
            
            console.log('📈 OVERALL STATISTICS:');
            console.log('=' .repeat(60));
            console.log(`Records analyzed: ${validPercentages.length}`);
            console.log(`Average shipping %: ${avgPercentage.toFixed(1)}%`);
            console.log(`Median shipping %: ${medianPercentage.toFixed(1)}%`);
            console.log(`Range: ${minPercentage.toFixed(1)}% - ${maxPercentage.toFixed(1)}%`);
            console.log('');
            
            // Categorize by percentage ranges
            const ranges = {
                'Under 20%': percentages.filter(p => p < 20).length,
                '20-40%': percentages.filter(p => p >= 20 && p < 40).length,
                '40-60%': percentages.filter(p => p >= 40 && p < 60).length,
                '60-80%': percentages.filter(p => p >= 60 && p < 80).length,
                'Over 80%': percentages.filter(p => p >= 80).length
            };
            
            console.log('📊 SHIPPING PERCENTAGE DISTRIBUTION:');
            Object.entries(ranges).forEach(([range, count]) => {
                const percentage = (count / validPercentages.length * 100).toFixed(1);
                console.log(`  ${range}: ${count} records (${percentage}%)`);
            });
            
        } else {
            console.log('❌ Could not calculate shipping percentages - insufficient data');
        }
        
    } catch (error) {
        console.error('❌ Error analyzing BOL data:', error);
    }
}

function extractProductInfo(rawText) {
    const text = rawText.toLowerCase();
    const keywords = [];
    
    // Common product terms
    const productTerms = [
        'tv', 'television', 'lights', 'led', 'furniture', 'sofa', 'chair', 'table',
        'mattress', 'bed', 'dresser', 'cabinet', 'electronics', 'appliance'
    ];
    
    productTerms.forEach(term => {
        if (text.includes(term)) {
            keywords.push(term);
        }
    });
    
    return keywords;
}

function estimateRetailPrice(rawText, totalCost, volume) {
    // Try to extract price from raw text first
    const pricePatterns = [
        /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g,
        /USD\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi,
        /price[^$]*\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi
    ];
    
    for (const pattern of pricePatterns) {
        const matches = [...rawText.matchAll(pattern)];
        for (const match of matches) {
            const price = parseFloat(match[1].replace(/,/g, ''));
            if (price > 50 && price < 50000) { // Reasonable price range
                return price;
            }
        }
    }
    
    // If no price found, estimate based on volume and cost
    // Assume total cost is about 40-60% of retail price (duty + shipping + fees)
    const estimatedRetailPrice = totalCost / 0.5; // Assume 50% markup
    
    // Sanity check based on volume
    const pricePerCubicFoot = estimatedRetailPrice / volume;
    if (pricePerCubicFoot < 10 || pricePerCubicFoot > 1000) {
        // Unrealistic, use volume-based estimate
        return volume * 100; // $100 per cubic foot average
    }
    
    return estimatedRetailPrice;
}

// Run the analysis
analyzeBOLData();