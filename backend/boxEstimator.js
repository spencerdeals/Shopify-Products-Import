// Box Dimension Estimator - Estimates shipping box dimensions from product dimensions
class BoxEstimator {
  constructor() {
    this.packagingBuffer = {
      small: 2,    // 2" buffer for small items
      medium: 3,   // 3" buffer for medium items  
      large: 4,    // 4" buffer for large items
      xlarge: 6    // 6" buffer for very large items
    };
  }

  // Estimate box dimensions from product dimensions
  estimateBoxDimensions(productDimensions, itemType = 'furniture') {
    if (!productDimensions || !productDimensions.length || !productDimensions.width || !productDimensions.height) {
      return null;
    }

    const { length, width, height } = productDimensions;
    
    // Determine size category
    const maxDimension = Math.max(length, width, height);
    const volume = length * width * height;
    
    let sizeCategory;
    if (maxDimension > 72 || volume > 50000) {
      sizeCategory = 'xlarge';
    } else if (maxDimension > 48 || volume > 20000) {
      sizeCategory = 'large';
    } else if (maxDimension > 24 || volume > 8000) {
      sizeCategory = 'medium';
    } else {
      sizeCategory = 'small';
    }

    const buffer = this.packagingBuffer[sizeCategory];
    
    // Add packaging buffer to each dimension
    const boxDimensions = {
      length: length + buffer,
      width: width + buffer,
      height: height + buffer,
      sizeCategory,
      buffer,
      estimatedBoxes: 1
    };

    // Check if item might need multiple boxes (furniture-specific logic)
    if (itemType === 'furniture') {
      boxDimensions = this.estimateFurnitureBoxing(productDimensions, boxDimensions);
    }

    // Calculate cubic feet
    const cubicInches = boxDimensions.length * boxDimensions.width * boxDimensions.height * boxDimensions.estimatedBoxes;
    boxDimensions.cubicFeet = cubicInches / 1728;

    return boxDimensions;
  }

  // Furniture-specific boxing estimation
  estimateFurnitureBoxing(productDimensions, initialBox) {
    const { length, width, height } = productDimensions;
    
    // Large furniture often ships in multiple boxes
    const maxDimension = Math.max(length, width, height);
    const volume = length * width * height;
    
    // Sectional sofas, large dining tables, etc.
    if (maxDimension > 84 || volume > 60000) {
      // Likely 2-3 boxes
      return {
        ...initialBox,
        estimatedBoxes: 2,
        boxType: 'multi-box-large',
        notes: 'Large furniture - likely 2+ boxes'
      };
    }
    
    // Medium furniture that might be modular
    if (maxDimension > 60 || volume > 30000) {
      // Check if it's likely modular (sofas, sectionals)
      if (length > 72 || width > 36) {
        return {
          ...initialBox,
          estimatedBoxes: 2,
          boxType: 'modular',
          notes: 'Modular furniture - likely 2 boxes'
        };
      }
    }

    return {
      ...initialBox,
      boxType: 'single-box',
      notes: 'Single box expected'
    };
  }

  // Compare estimated vs actual dimensions
  compareWithActual(estimated, actualBoxes) {
    if (!estimated || !actualBoxes || actualBoxes.length === 0) {
      return null;
    }

    // Calculate actual total cubic feet
    const actualCubicFeet = actualBoxes.reduce((total, box) => {
      const cubicInches = box.length * box.width * box.height;
      return total + (cubicInches / 1728);
    }, 0);

    const estimatedCubicFeet = estimated.cubicFeet;
    const accuracy = (1 - Math.abs(actualCubicFeet - estimatedCubicFeet) / actualCubicFeet) * 100;

    return {
      estimated: {
        cubicFeet: estimatedCubicFeet,
        boxes: estimated.estimatedBoxes,
        dimensions: `${estimated.length}" × ${estimated.width}" × ${estimated.height}"`
      },
      actual: {
        cubicFeet: actualCubicFeet,
        boxes: actualBoxes.length,
        dimensions: actualBoxes.map(box => `${box.length}" × ${box.width}" × ${box.height}"`).join(', ')
      },
      accuracy: accuracy.toFixed(1) + '%',
      difference: (actualCubicFeet - estimatedCubicFeet).toFixed(2) + ' ft³'
    };
  }

  // Add data point to our tracking
  addDataPoint(productType, actualCubicFeet, billedCubicFeet, actualBoxes = []) {
    const overcharge = this.detectOvercharge(actualCubicFeet, billedCubicFeet);
    const dataPoint = {
      timestamp: new Date().toISOString(),
      productType,
      actualCubicFeet,
      billedCubicFeet,
      overcharge: overcharge.isOvercharge ? parseFloat(overcharge.overchargeAmount) : 0,
      overchargePercent: overcharge.isOvercharge ? parseFloat(overcharge.percentageOver) : 0,
      potentialRefund: overcharge.isOvercharge ? parseFloat(overcharge.potentialSavings.totalOvercharge) : 0,
      actualBoxes
    };
    
    console.log(`📊 Data Point Added: ${productType}`);
    console.log(`   Actual: ${actualCubicFeet} ft³`);
    console.log(`   Billed: ${billedCubicFeet} ft³`);
    if (overcharge.isOvercharge) {
      console.log(`   🚨 OVERCHARGE: ${overcharge.overchargeAmount} ft³ (${overcharge.percentageOver}%)`);
      console.log(`   💰 Potential Refund: $${overcharge.potentialSavings.totalOvercharge}`);
    } else {
      console.log(`   ✅ Fair billing`);
    }
    
    return dataPoint;
  }

  // Analyze all collected data points
  analyzeOverchargePattern(dataPoints) {
    if (!dataPoints || dataPoints.length === 0) return null;
    
    const totalActual = dataPoints.reduce((sum, dp) => sum + dp.actualCubicFeet, 0);
    const totalBilled = dataPoints.reduce((sum, dp) => sum + dp.billedCubicFeet, 0);
    const totalOvercharge = dataPoints.reduce((sum, dp) => sum + dp.overcharge, 0);
    const totalRefund = dataPoints.reduce((sum, dp) => sum + dp.potentialRefund, 0);
    
    const overchargeRate = (totalOvercharge / totalActual) * 100;
    const overchargedItems = dataPoints.filter(dp => dp.overcharge > 0).length;
    
    return {
      totalItems: dataPoints.length,
      overchargedItems,
      overchargeRate: `${overchargeRate.toFixed(1)}%`,
      totalActualCubicFeet: totalActual.toFixed(2),
      totalBilledCubicFeet: totalBilled.toFixed(2),
      totalOverchargeCubicFeet: totalOvercharge.toFixed(2),
      totalPotentialRefund: `$${totalRefund.toFixed(2)}`,
      pattern: overchargedItems > dataPoints.length * 0.5 ? 'SYSTEMATIC_OVERCHARGING' : 'OCCASIONAL_ERRORS'
    };
  }

  // Learn from actual shipping data to improve estimates
  learnFromActual(productDimensions, actualBoxes, productType = 'furniture') {
    const comparison = this.compareWithActual(
      this.estimateBoxDimensions(productDimensions, productType),
      actualBoxes
    );

    if (comparison) {
      console.log('📦 Box Estimation Learning:');
      console.log(`   Product: ${productDimensions.length}" × ${productDimensions.width}" × ${productDimensions.height}"`);
      console.log(`   Estimated: ${comparison.estimated.cubicFeet.toFixed(2)} ft³ (${comparison.estimated.boxes} boxes)`);
      console.log(`   Actual: ${comparison.actual.cubicFeet.toFixed(2)} ft³ (${comparison.actual.boxes} boxes)`);
      console.log(`   Accuracy: ${comparison.accuracy}`);
      console.log(`   Difference: ${comparison.difference}`);
      
      // Store learning data for future improvements
      this.storeLearningData(productDimensions, actualBoxes, comparison, productType);
    }

    return comparison;
  }

  storeLearningData(productDimensions, actualBoxes, comparison, productType) {
    // In a real system, this would save to a database
    // For now, we'll just log it for manual analysis
    const learningData = {
      timestamp: new Date().toISOString(),
      productType,
      productDimensions,
      actualBoxes,
      comparison,
      notes: this.generateLearningNotes(comparison)
    };

    console.log('💡 Learning Notes:', learningData.notes);
  }

  generateLearningNotes(comparison) {
    const accuracy = parseFloat(comparison.accuracy);
    
    if (accuracy > 90) {
      return 'Excellent estimate - current algorithm works well for this type';
    } else if (accuracy > 75) {
      return 'Good estimate - minor adjustments could improve accuracy';
    } else if (accuracy > 50) {
      return 'Fair estimate - algorithm needs improvement for this product type';
    } else {
      return 'Poor estimate - significant algorithm changes needed';
    }
  }

  // Detect potential freight overcharges
  detectOvercharge(estimatedCubicFeet, billedCubicFeet, tolerance = 0.15) {
    const difference = billedCubicFeet - estimatedCubicFeet;
    const percentageOver = (difference / estimatedCubicFeet) * 100;
    
    if (percentageOver > tolerance * 100) {
      const potentialSavings = this.calculateOverchargeCost(difference);
      
      return {
        isOvercharge: true,
        estimatedCubicFeet,
        billedCubicFeet,
        overchargeAmount: difference.toFixed(2),
        percentageOver: percentageOver.toFixed(1),
        potentialSavings,
        recommendation: 'DISPUTE THIS CHARGE - Request detailed box measurements'
      };
    }
    
    return {
      isOvercharge: false,
      difference: difference.toFixed(2),
      status: 'Billing appears accurate'
    };
  }

  calculateOverchargeCost(excessCubicFeet, shippingRate = 8.50, dutyRate = 0.265) {
    const excessShipping = excessCubicFeet * shippingRate;
    const excessDuty = excessShipping * dutyRate;
    const totalOvercharge = excessShipping + excessDuty;
    
    return {
      excessShipping: excessShipping.toFixed(2),
      excessDuty: excessDuty.toFixed(2),
      totalOvercharge: totalOvercharge.toFixed(2)
    };
  }

  // Generate dispute documentation
  generateDisputeReport(actualBoxes, billedCubicFeet) {
    const actualCubicFeet = actualBoxes.reduce((total, box) => {
      return total + (box.length * box.width * box.height / 1728);
    }, 0);
    
    const overchargeAnalysis = this.detectOvercharge(actualCubicFeet, billedCubicFeet);
    
    if (overchargeAnalysis.isOvercharge) {
      return {
        disputeRecommended: true,
        actualMeasurements: actualBoxes.map(box => 
          `${box.length}" × ${box.width}" × ${box.height}"`
        ),
        actualCubicFeet: actualCubicFeet.toFixed(2),
        billedCubicFeet: billedCubicFeet.toFixed(2),
        overchargeAmount: overchargeAnalysis.overchargeAmount,
        potentialRefund: overchargeAnalysis.potentialSavings.totalOvercharge,
        disputeText: this.generateDisputeText(actualBoxes, billedCubicFeet, overchargeAnalysis)
      };
    }
    
    return { disputeRecommended: false };
  }

  generateDisputeText(actualBoxes, billedCubicFeet, analysis) {
    return `
FREIGHT CHARGE DISPUTE REQUEST

Order Details:
- Billed Cubic Feet: ${billedCubicFeet} ft³
- Actual Cubic Feet: ${analysis.estimatedCubicFeet} ft³
- Overcharge: ${analysis.overchargeAmount} ft³ (${analysis.percentageOver}%)

Actual Box Measurements:
${actualBoxes.map((box, i) => 
  `Box ${i + 1}: ${box.length}" × ${box.width}" × ${box.height}" = ${(box.length * box.width * box.height / 1728).toFixed(2)} ft³`
).join('\n')}

Total Calculated: ${analysis.estimatedCubicFeet} ft³

Requested Refund: $${analysis.potentialSavings.totalOvercharge}
- Excess Shipping: $${analysis.potentialSavings.excessShipping}
- Excess Duty: $${analysis.potentialSavings.excessDuty}

Please provide detailed measurements used for billing calculation.
    `.trim();
  }

  // Quick calculation method for manual data entry
  quickCalculate(dimensions, billedCubicFeet = null) {
    const actualCubicFeet = (dimensions.length * dimensions.width * dimensions.height) / 1728;
    
    console.log('📦 Quick Calculation:');
    console.log(`   Dimensions: ${dimensions.length}" × ${dimensions.width}" × ${dimensions.height}"`);
    console.log(`   Actual Cubic Feet: ${actualCubicFeet.toFixed(2)} ft³`);
    
    if (billedCubicFeet) {
      const overcharge = this.detectOvercharge(actualCubicFeet, billedCubicFeet);
      console.log(`   Billed Cubic Feet: ${billedCubicFeet} ft³`);
      
      if (overcharge.isOvercharge) {
        console.log(`   🚨 OVERCHARGE: ${overcharge.overchargeAmount} ft³ (${overcharge.percentageOver}%)`);
        console.log(`   💰 Potential Refund: $${overcharge.potentialSavings.totalOvercharge}`);
      } else {
        console.log(`   ✅ Billing appears accurate (${overcharge.difference} ft³ difference)`);
      }
    }
    
    return {
      actualCubicFeet: actualCubicFeet.toFixed(2),
      billedCubicFeet,
      dimensions: `${dimensions.length}" × ${dimensions.width}" × ${dimensions.height}"`
    };
  }
}

module.exports = BoxEstimator;