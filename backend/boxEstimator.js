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
}

module.exports = BoxEstimator;