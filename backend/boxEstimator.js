// Enhanced Box Dimension Estimator with Multi-box Detection
class BoxEstimator {
  constructor() {
    this.productTypes = {
      sectional: {
        keywords: ['sectional', 'sofa', 'chaise', 'couch'],
        flatPacked: true,
        multiBox: true,
        estimateMethod: 'sectionalEstimate'
      },
      desk: {
        keywords: ['desk', 'table', 'workstation'],
        flatPacked: true,
        multiBox: false,
        estimateMethod: 'deskEstimate'
      },
      chair: {
        keywords: ['chair', 'seat', 'stool'],
        flatPacked: true,
        multiBox: false,
        estimateMethod: 'chairEstimate'
      },
      bed: {
        keywords: ['bed', 'mattress', 'frame'],
        flatPacked: true,
        multiBox: true,
        estimateMethod: 'bedEstimate'
      },
      dresser: {
        keywords: ['dresser', 'chest', 'cabinet', 'wardrobe'],
        flatPacked: true,
        multiBox: false,
        estimateMethod: 'dresserEstimate'
      }
    };
  }

  detectProductType(productName, category) {
    const searchText = `${productName} ${category}`.toLowerCase();
    
    for (const [type, config] of Object.entries(this.productTypes)) {
      if (config.keywords.some(keyword => searchText.includes(keyword))) {
        return { type, config };
      }
    }
    
    return { type: 'generic', config: { flatPacked: false, multiBox: false, estimateMethod: 'genericEstimate' } };
  }

  estimateBoxDimensions(product) {
    const { type, config } = this.detectProductType(product.name, product.category);
    
    console.log(`📦 Detected product type: ${type}`);
    console.log(`📦 Flat-packed: ${config.flatPacked}, Multi-box: ${config.multiBox}`);
    
    // If we have actual shipping dimensions, use those
    if (product.package_dimensions) {
      console.log('📦 Using actual shipping dimensions');
      return [{
        length: product.package_dimensions.length,
        width: product.package_dimensions.width,
        height: product.package_dimensions.height,
        weight: product.package_weight_lbs || null
      }];
    }
    
    // Otherwise estimate based on product type
    return this[config.estimateMethod](product);
  }

  sectionalEstimate(product) {
    const dims = product.dimensions || { length: 89, width: 65, height: 33 };
    
    // Sectionals typically ship in 2-3 boxes when flat-packed
    // Base box: seat sections (usually longest dimension becomes length)
    // Chaise box: chaise section (usually smaller)
    
    const boxes = [
      {
        // Main sofa section box (flat-packed)
        length: Math.min(dims.length * 0.5, 45), // More realistic for flat-pack
        width: Math.min(dims.width * 0.7, 43),   // Based on actual data
        height: 20, // Flat-packed height
        weight: (product.weight || 191) * 0.6
      },
      {
        // Chaise section box (flat-packed)
        length: Math.min(dims.width, 65),  // Based on actual: 45" × 65" × 20"
        width: Math.min(dims.length * 0.5, 45), // Based on actual: 43" × 45" × 20"
        height: 20, // Flat-packed height
        weight: (product.weight || 191) * 0.4
      }
    ];
    
    console.log('📦 Estimated sectional boxes:', boxes);
    return boxes;
  }

  deskEstimate(product) {
    const dims = product.dimensions || { length: 48, width: 24, height: 30 };
    
    // Desks usually ship flat-packed in one box
    return [{
      length: Math.max(dims.length, dims.width), // Longest dimension
      width: Math.min(dims.length, dims.width),  // Shorter dimension
      height: 8, // Flat-packed height (desktop + legs)
      weight: product.weight || 50
    }];
  }

  chairEstimate(product) {
    const dims = product.dimensions || { length: 24, width: 24, height: 36 };
    
    // Chairs usually ship flat-packed or partially assembled
    return [{
      length: Math.max(dims.length, dims.width) + 2, // Add packaging
      width: Math.min(dims.length, dims.width) + 2,
      height: 12, // Flat-packed height
      weight: product.weight || 25
    }];
  }

  bedEstimate(product) {
    const dims = product.dimensions || { length: 80, width: 60, height: 12 };
    
    // Beds often ship in 2+ boxes (headboard, frame, slats)
    const boxes = [
      {
        // Headboard box
        length: dims.width + 4, // Width becomes length for shipping
        width: 8, // Headboard thickness
        height: dims.height + 10, // Headboard height
        weight: (product.weight || 100) * 0.4
      },
      {
        // Frame and slats box
        length: dims.length * 0.6, // Folded frame
        width: dims.width * 0.5,
        height: 8,
        weight: (product.weight || 100) * 0.6
      }
    ];
    
    return boxes;
  }

  dresserEstimate(product) {
    const dims = product.dimensions || { length: 48, width: 18, height: 36 };
    
    // Dressers usually ship flat-packed in one large box
    return [{
      length: Math.max(dims.length, dims.height), // Longest dimension
      width: dims.width + 4, // Depth plus packaging
      height: 12, // Flat-packed height
      weight: product.weight || 80
    }];
  }

  genericEstimate(product) {
    const dims = product.dimensions || { length: 24, width: 18, height: 12 };
    
    // Generic estimation - assume some flat-packing
    return [{
      length: dims.length + 2,
      width: dims.width + 2,
      height: Math.min(dims.height * 0.7, dims.height), // Slight compression
      weight: product.weight || 20
    }];
  }

  calculateTotalVolume(boxes) {
    return boxes.reduce((total, box) => {
      const volume = (box.length * box.width * box.height) / 1728; // Convert to cubic feet
      return total + volume;
    }, 0);
  }

  calculateShippingCost(boxes, baseRate = 8.00, handlingFee = 15.00) {
    const totalVolume = this.calculateTotalVolume(boxes);
    const baseCost = Math.max(15, totalVolume * baseRate);
    
    // Add oversize fees for any box over 48" in any dimension
    let oversizeFee = 0;
    boxes.forEach(box => {
      if (Math.max(box.length, box.width, box.height) > 48) {
        oversizeFee += 50;
      }
    });
    
    const totalCost = baseCost + oversizeFee + handlingFee;
    
    console.log(`📦 Shipping calculation:
      Total volume: ${totalVolume.toFixed(2)} cubic feet
      Base cost: $${baseCost.toFixed(2)}
      Oversize fee: $${oversizeFee.toFixed(2)}
      Handling fee: $${handlingFee.toFixed(2)}
      Total: $${totalCost.toFixed(2)}`);
    
    return {
      totalVolume,
      baseCost,
      oversizeFee,
      handlingFee,
      totalCost,
      boxes
    };
  }
}

module.exports = BoxEstimator;