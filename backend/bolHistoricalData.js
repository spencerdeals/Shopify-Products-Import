// backend/bolHistoricalData.js - BOL Historical Data Analysis System
const fs = require('fs').promises;
const path = require('path');

class BOLHistoricalData {
  constructor() {
    this.initialized = false;
    this.volumePatterns = new Map(); // Category -> volume statistics
    this.productPatterns = new Map(); // Product keywords -> volume data
    this.rawData = [];
    this.FIXED_RATE_PER_FT3 = 6.00; // Fixed at $6/ft³ for competitive pricing
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      console.log('📚 Initializing BOL Historical Data System...');
      
      // Load the BOL data (you'll need to save your JSON data to this file)
      const bolDataPath = path.join(__dirname, 'bol-data.json');
      
      try {
        const rawData = await fs.readFile(bolDataPath, 'utf8');
        this.rawData = JSON.parse(rawData);
        console.log(`   📊 Loaded ${this.rawData.length} BOL records`);
      } catch (error) {
        console.log('   ⚠️ BOL data file not found, using sample data for demo');
        this.rawData = this.getSampleBOLData();
      }
      
      this.processHistoricalData();
      this.buildVolumePatterns();
      
      this.initialized = true;
      console.log('✅ BOL Historical Data System Ready');
      
    } catch (error) {
      console.error('❌ BOL initialization failed:', error);
      this.initialized = false;
    }
  }

  processHistoricalData() {
    console.log('   🔍 Processing historical volume data...');
    
    const validRecords = this.rawData.filter(record => 
      record.volume_ft3 || record.volume_ft3_estimated
    );
    
    console.log(`   📈 Found ${validRecords.length} records with volume data`);
    
    // Extract product information from raw text samples
    validRecords.forEach(record => {
      const volume = record.volume_ft3 || record.volume_ft3_estimated;
      const cost = record.other_costs_usd_total || 0;
      const rawText = record.raw_text_sample || '';
      
      // Extract product keywords from raw text
      const productKeywords = this.extractProductKeywords(rawText);
      const category = this.categorizeFromText(rawText, productKeywords);
      
      // Store the data
      const dataPoint = {
        volume: volume,
        cost: cost,
        keywords: productKeywords,
        category: category,
        bolNumber: record.bol_number,
        rawText: rawText.substring(0, 100) // First 100 chars for reference
      };
      
      // Add to product patterns
      productKeywords.forEach(keyword => {
        if (!this.productPatterns.has(keyword)) {
          this.productPatterns.set(keyword, []);
        }
        this.productPatterns.get(keyword).push(dataPoint);
      });
    });
    
    console.log(`   🏷️ Identified ${this.productPatterns.size} product keywords`);
  }

  extractProductKeywords(rawText) {
    const text = rawText.toLowerCase();
    const keywords = [];
    
    // Common product keywords to look for
    const productTerms = [
      'mattress', 'bed', 'pillow', 'sleep', 'foam', 'spring', 'hybrid',
      'tv', 'television', 'lights', 'led', 'furniture', 'sofa', 'chair', 'table',
      'bed', 'mattress', 'dresser', 'cabinet', 'desk', 'lamp', 'mirror',
      'electronics', 'appliance', 'refrigerator', 'washer', 'dryer',
      'outdoor', 'patio', 'garden', 'grill', 'umbrella'
    ];
    
    productTerms.forEach(term => {
      if (text.includes(term)) {
        keywords.push(term);
      }
    });
    
    // Extract any product-like words (capitalized words that might be brands/products)
    const matches = rawText.match(/[A-Z][a-z]+/g);
    if (matches) {
      matches.forEach(match => {
        if (match.length > 3 && !['Invoice', 'Date', 'Reference', 'Freight'].includes(match)) {
          keywords.push(match.toLowerCase());
        }
      });
    }
    
    return [...new Set(keywords)]; // Remove duplicates
  }

  categorizeFromText(rawText, keywords) {
    const text = rawText.toLowerCase();
    
    // Category mapping based on keywords
    if (keywords.some(k => ['mattress', 'bed', 'pillow', 'sleep', 'foam', 'spring'].includes(k))) {
      return 'furniture';
    }
    if (keywords.some(k => ['tv', 'television', 'led', 'lights', 'electronics'].includes(k))) {
      return 'electronics';
    }
    if (keywords.some(k => ['furniture', 'sofa', 'chair', 'table', 'bed', 'dresser', 'cabinet', 'desk'].includes(k))) {
      return 'furniture';
    }
    if (keywords.some(k => ['outdoor', 'patio', 'garden', 'grill', 'umbrella'].includes(k))) {
      return 'outdoor';
    }
    if (keywords.some(k => ['appliance', 'refrigerator', 'washer', 'dryer'].includes(k))) {
      return 'appliances';
    }
    
    return 'general';
  }

  buildVolumePatterns() {
    console.log('   📊 Building volume patterns by category...');
    
    // Group data by category
    const categoryData = {};
    
    this.productPatterns.forEach((dataPoints, keyword) => {
      dataPoints.forEach(point => {
        if (!categoryData[point.category]) {
          categoryData[point.category] = [];
        }
        categoryData[point.category].push(point.volume);
      });
    });
    
    // Calculate statistics for each category
    Object.entries(categoryData).forEach(([category, volumes]) => {
      if (volumes.length > 0) {
        const stats = this.calculateVolumeStats(volumes);
        this.volumePatterns.set(category, stats);
        
        console.log(`   📈 ${category}: ${volumes.length} samples, avg ${stats.average.toFixed(1)} ft³ (${stats.min}-${stats.max} ft³)`);
      }
    });
  }

  calculateVolumeStats(volumes) {
    const sorted = volumes.sort((a, b) => a - b);
    const sum = volumes.reduce((a, b) => a + b, 0);
    
    return {
      count: volumes.length,
      average: sum / volumes.length,
      median: sorted[Math.floor(sorted.length / 2)],
      min: Math.min(...volumes),
      max: Math.max(...volumes),
      q25: sorted[Math.floor(sorted.length * 0.25)],
      q75: sorted[Math.floor(sorted.length * 0.75)]
    };
  }

  // Main function to get volume estimate based on product info
  async getVolumeEstimate(productName, category, retailer) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const estimate = {
      volume: null,
      confidence: 0,
      source: 'none',
      samples: 0,
      reasoning: ''
    };
    
    // Try to match by product keywords first
    const productKeywords = this.extractProductKeywords(productName);
    let bestMatch = null;
    let bestScore = 0;
    
    productKeywords.forEach(keyword => {
      if (this.productPatterns.has(keyword)) {
        const dataPoints = this.productPatterns.get(keyword);
        const score = dataPoints.length; // More samples = better score
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            keyword: keyword,
            dataPoints: dataPoints,
            source: 'product-keyword'
          };
        }
      }
    });
    
    // If we found a product match
    if (bestMatch && bestMatch.dataPoints.length >= 2) {
      const volumes = bestMatch.dataPoints.map(dp => dp.volume);
      const stats = this.calculateVolumeStats(volumes);
      
      estimate.volume = stats.average;
      estimate.confidence = Math.min(0.9, 0.3 + (bestMatch.dataPoints.length * 0.1));
      estimate.source = `product-keyword: ${bestMatch.keyword}`;
      estimate.samples = bestMatch.dataPoints.length;
      estimate.reasoning = `Found ${bestMatch.dataPoints.length} historical shipments matching "${bestMatch.keyword}"`;
      
      return estimate;
    }
    
    // Fallback to category patterns
    if (this.volumePatterns.has(category)) {
      const stats = this.volumePatterns.get(category);
      
      estimate.volume = stats.average;
      estimate.confidence = Math.min(0.7, 0.2 + (stats.count * 0.05));
      estimate.source = `category: ${category}`;
      estimate.samples = stats.count;
      estimate.reasoning = `Based on ${stats.count} historical ${category} shipments`;
      
      return estimate;
    }
    
    // No match found
    estimate.reasoning = 'No historical data match found';
    return estimate;
  }

  // Convert volume to dimensions (reverse engineering)
  volumeToDimensions(volumeFt3, category) {
    // Convert cubic feet to cubic inches
    const volumeInches = volumeFt3 * 1728;
    
    // Use category-specific aspect ratios to estimate L×W×H
    const aspectRatios = {
      'electronics': { l: 2.0, w: 1.5, h: 1.0 }, // TV-like shape
      'furniture': { l: 3.0, w: 2.0, h: 1.5 },   // Sofa-like shape
      'outdoor': { l: 2.5, w: 2.0, h: 1.2 },     // Patio furniture
      'appliances': { l: 1.5, w: 1.5, h: 2.0 },  // Tall appliance
      'general': { l: 2.0, w: 1.5, h: 1.0 }      // Generic box
    };
    
    const ratio = aspectRatios[category] || aspectRatios['general'];
    const totalRatio = ratio.l * ratio.w * ratio.h;
    const baseSize = Math.cbrt(volumeInches / totalRatio);
    
    return {
      length: Math.round(baseSize * ratio.l * 10) / 10,
      width: Math.round(baseSize * ratio.w * 10) / 10,
      height: Math.round(baseSize * ratio.h * 10) / 10
    };
  }

  // Main function to get smart dimension estimate
  async getSmartEstimate(productName, category, retailer) {
    const volumeEstimate = await this.getVolumeEstimate(productName, category, retailer);
    
    if (volumeEstimate.volume && volumeEstimate.confidence > 0.3) {
      const dimensions = this.volumeToDimensions(volumeEstimate.volume, category);
      
      return {
        dimensions: dimensions,
        volume: volumeEstimate.volume,
        confidence: volumeEstimate.confidence,
        source: volumeEstimate.source,
        samples: volumeEstimate.samples,
        reasoning: volumeEstimate.reasoning,
        shippingCost: Math.round(volumeEstimate.volume * this.FIXED_RATE_PER_FT3)
      };
    }
    
    return null; // No good estimate available
  }

  // Get insights about the historical data
  getInsights() {
    if (!this.initialized) return;
    
    console.log('\n📊 BOL HISTORICAL DATA INSIGHTS:');
    console.log(`   Total records: ${this.rawData.length}`);
    console.log(`   Records with volume: ${this.rawData.filter(r => r.volume_ft3 || r.volume_ft3_estimated).length}`);
    console.log(`   Product keywords identified: ${this.productPatterns.size}`);
    console.log(`   Categories with patterns: ${this.volumePatterns.size}`);
    
    console.log('\n📈 VOLUME PATTERNS BY CATEGORY:');
    this.volumePatterns.forEach((stats, category) => {
      const avgCost = Math.round(stats.average * this.FIXED_RATE_PER_FT3);
      console.log(`   ${category}: ${stats.average.toFixed(1)} ft³ avg → $${avgCost} shipping (${stats.count} samples)`);
    });
    
    console.log('\n🔍 TOP PRODUCT KEYWORDS:');
    const topKeywords = Array.from(this.productPatterns.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);
    
    topKeywords.forEach(([keyword, dataPoints]) => {
      const avgVolume = dataPoints.reduce((sum, dp) => sum + dp.volume, 0) / dataPoints.length;
      console.log(`   "${keyword}": ${dataPoints.length} samples, ${avgVolume.toFixed(1)} ft³ avg`);
    });
    
    console.log('');
  }

  // Sample data for demo (using your actual data structure)
  getSampleBOLData() {
    return [
      {
        "bol_number": "FF243341",
        "volume_ft3": null,
        "volume_ft3_estimated": 11.33,
        "volume_ft3_was_estimated": true,
        "other_costs_usd_total": 617.0,
        "raw_text_sample": "LED TV LIGHTS ZZ SUPPLEMENTARY CODE: ZB ADDITIONAL INFORMATION: BCD# TRADER REFERENCE FF243341"
      },
      {
        "bol_number": "FF240001",
        "volume_ft3": 18.0,
        "volume_ft3_estimated": 18.0,
        "volume_ft3_was_estimated": false,
        "other_costs_usd_total": 244.99,
        "raw_text_sample": "Items Ordered Fi=J TV Lights outdoor furniture patio set"
      },
      {
        "bol_number": "FF240002",
        "volume_ft3": null,
        "volume_ft3_estimated": 25.5,
        "volume_ft3_was_estimated": true,
        "other_costs_usd_total": 850.0,
        "raw_text_sample": "SOFA SECTIONAL FURNITURE living room set cushions"
      }
    ];
  }
}

module.exports = BOLHistoricalData;