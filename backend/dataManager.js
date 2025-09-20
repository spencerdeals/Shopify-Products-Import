// Data Manager - Save and analyze actual shipping data vs scraper estimates
const fs = require('fs').promises;
const path = require('path');

class DataManager {
  constructor() {
    this.dataFile = path.join(__dirname, 'actualShippingData.json');
    this.comparisonFile = path.join(__dirname, 'scraperComparisons.json');
  }

  // Load actual shipping data
  async loadActualData() {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.log('No existing data file found, starting fresh');
      return { actualShipments: [], summary: {} };
    }
  }

  // Save actual shipping data
  async saveActualData(data) {
    try {
      await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
      console.log('✅ Actual shipping data saved');
    } catch (error) {
      console.error('❌ Failed to save actual data:', error);
    }
  }

  // Add new actual shipment data
  async addActualShipment(shipmentData) {
    const data = await this.loadActualData();
    
    // Calculate totals
    const totalCubicFeet = shipmentData.actualBoxes.reduce((sum, box) => 
      sum + (box.length * box.width * box.height / 1728), 0
    );
    
    const overchargeCubicFeet = shipmentData.billedCubicFeet - totalCubicFeet;
    const overchargePercentage = (overchargeCubicFeet / totalCubicFeet) * 100;
    
    const newShipment = {
      ...shipmentData,
      id: `${shipmentData.productType}-${Date.now()}`,
      actualTotalCubicFeet: parseFloat(totalCubicFeet.toFixed(2)),
      overcharge: {
        cubicFeet: parseFloat(overchargeCubicFeet.toFixed(2)),
        percentage: parseFloat(overchargePercentage.toFixed(1)),
        estimatedCost: parseFloat((overchargeCubicFeet * 8.5 * 1.265).toFixed(2))
      },
      dateRecorded: new Date().toISOString().split('T')[0]
    };
    
    data.actualShipments.push(newShipment);
    data.summary = this.calculateSummary(data.actualShipments);
    
    await this.saveActualData(data);
    return newShipment;
  }

  // Calculate summary statistics
  calculateSummary(shipments) {
    const totalItems = shipments.length;
    const overchargedItems = shipments.filter(s => s.overcharge.cubicFeet > 0.1).length;
    const totalActual = shipments.reduce((sum, s) => sum + s.actualTotalCubicFeet, 0);
    const totalBilled = shipments.reduce((sum, s) => sum + s.billedCubicFeet, 0);
    const totalOvercharge = shipments.reduce((sum, s) => sum + s.overcharge.cubicFeet, 0);
    const totalCost = shipments.reduce((sum, s) => sum + s.overcharge.estimatedCost, 0);

    return {
      totalItems,
      overchargedItems,
      overchargeRate: `${((overchargedItems / totalItems) * 100).toFixed(0)}%`,
      totalActualCubicFeet: parseFloat(totalActual.toFixed(2)),
      totalBilledCubicFeet: parseFloat(totalBilled.toFixed(2)),
      totalOverchargeCubicFeet: parseFloat(totalOvercharge.toFixed(2)),
      totalEstimatedOverchargeCost: parseFloat(totalCost.toFixed(2)),
      pattern: this.detectPattern(shipments)
    };
  }

  // Detect overcharge patterns
  detectPattern(shipments) {
    const overchargedShipments = shipments.filter(s => s.overcharge.cubicFeet > 0.1);
    
    if (overchargedShipments.length === 0) return 'NO_OVERCHARGES';
    if (overchargedShipments.length === shipments.length) return 'SYSTEMATIC_OVERCHARGING';
    
    // Check if there's a size threshold
    const smallItems = shipments.filter(s => s.actualTotalCubicFeet < 3);
    const largeItems = shipments.filter(s => s.actualTotalCubicFeet >= 3);
    
    const smallOvercharged = smallItems.filter(s => s.overcharge.cubicFeet > 0.1).length;
    const largeOvercharged = largeItems.filter(s => s.overcharge.cubicFeet > 0.1).length;
    
    if (smallOvercharged === 0 && largeOvercharged > 0) {
      return 'SYSTEMATIC_OVERCHARGING_ABOVE_3_CUBIC_FEET';
    }
    
    return 'MIXED_PATTERN';
  }

  // Compare scraper estimates with actual data
  async compareScraperResults(scrapedData, actualShipmentId) {
    const actualData = await this.loadActualData();
    const actualShipment = actualData.actualShipments.find(s => s.id === actualShipmentId);
    
    if (!actualShipment) {
      throw new Error('Actual shipment not found');
    }

    const comparison = {
      productName: actualShipment.productName,
      productUrl: actualShipment.productUrl,
      scraperEstimate: {
        productDimensions: scrapedData.dimensions,
        estimatedCubicFeet: scrapedData.cubicFeet,
        price: scrapedData.price,
        variants: scrapedData.variant
      },
      actualShipping: {
        boxes: actualShipment.actualBoxes,
        totalCubicFeet: actualShipment.actualTotalCubicFeet,
        billedCubicFeet: actualShipment.billedCubicFeet
      },
      analysis: {
        scraperAccuracy: this.calculateAccuracy(scrapedData.cubicFeet, actualShipment.actualTotalCubicFeet),
        overchargeDetected: actualShipment.overcharge.cubicFeet > 0.1,
        overchargeAmount: actualShipment.overcharge.cubicFeet,
        potentialSavings: actualShipment.overcharge.estimatedCost
      },
      timestamp: new Date().toISOString()
    };

    // Save comparison
    await this.saveComparison(comparison);
    return comparison;
  }

  // Calculate scraper accuracy
  calculateAccuracy(estimated, actual) {
    const difference = Math.abs(estimated - actual);
    const accuracy = (1 - (difference / actual)) * 100;
    return {
      accuracy: `${Math.max(0, accuracy).toFixed(1)}%`,
      difference: `${difference.toFixed(2)} ft³`,
      status: accuracy > 80 ? 'EXCELLENT' : accuracy > 60 ? 'GOOD' : accuracy > 40 ? 'FAIR' : 'POOR'
    };
  }

  // Save scraper comparison
  async saveComparison(comparison) {
    try {
      let comparisons = [];
      try {
        const data = await fs.readFile(this.comparisonFile, 'utf8');
        comparisons = JSON.parse(data);
      } catch (e) {
        // File doesn't exist yet
      }
      
      comparisons.push(comparison);
      await fs.writeFile(this.comparisonFile, JSON.stringify(comparisons, null, 2));
      console.log('✅ Scraper comparison saved');
    } catch (error) {
      console.error('❌ Failed to save comparison:', error);
    }
  }

  // Get all comparisons
  async getComparisons() {
    try {
      const data = await fs.readFile(this.comparisonFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  // Generate dispute report
  async generateDisputeReport(shipmentId) {
    const actualData = await this.loadActualData();
    const shipment = actualData.actualShipments.find(s => s.id === shipmentId);
    
    if (!shipment || shipment.overcharge.cubicFeet <= 0.1) {
      return null;
    }

    return {
      shipmentId,
      productName: shipment.productName,
      disputeRecommended: true,
      actualMeasurements: shipment.actualBoxes.map(box => 
        `${box.length}" × ${box.width}" × ${box.height}" = ${box.cubicFeet} ft³`
      ),
      actualTotalCubicFeet: shipment.actualTotalCubicFeet,
      billedCubicFeet: shipment.billedCubicFeet,
      overchargeAmount: shipment.overcharge.cubicFeet,
      overchargePercentage: shipment.overcharge.percentage,
      potentialRefund: shipment.overcharge.estimatedCost,
      disputeText: this.generateDisputeText(shipment)
    };
  }

  // Generate dispute text
  generateDisputeText(shipment) {
    return `
FREIGHT CHARGE DISPUTE REQUEST

Product: ${shipment.productName}
Date: ${shipment.dateRecorded}

BILLING DISCREPANCY:
- Billed Cubic Feet: ${shipment.billedCubicFeet} ft³
- Actual Cubic Feet: ${shipment.actualTotalCubicFeet} ft³
- Overcharge: ${shipment.overcharge.cubicFeet} ft³ (${shipment.overcharge.percentage}%)

ACTUAL BOX MEASUREMENTS:
${shipment.actualBoxes.map((box, i) => 
  `Box ${i + 1}: ${box.length}" × ${box.width}" × ${box.height}" = ${box.cubicFeet} ft³`
).join('\n')}

TOTAL CALCULATED: ${shipment.actualTotalCubicFeet} ft³

REQUESTED REFUND: $${shipment.overcharge.estimatedCost}

Please provide detailed measurements used for your billing calculation and process this refund request.
    `.trim();
  }
}

module.exports = DataManager;