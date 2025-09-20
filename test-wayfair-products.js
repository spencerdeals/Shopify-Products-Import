const { parseProduct } = require('./backend/boxEstimator');

async function testWayfairProducts() {
  console.log('🧪 Testing Wayfair Products Against Known BOL Data');
  console.log('================================================');
  
  const testProducts = [
    {
      name: 'Flaubert Gwendoly Sofa and Chaise',
      url: 'https://www.wayfair.com/furniture/pdp/latitude-run-flaubert-gwendoly-sofa-and-chaise-w100063422.html?piid=1222175087%2C1261760516%2C1262971467',
      expectedCubicFeet: 67.5,
      expectedType: 'Sofa'
    },
    {
      name: 'Putnam Height Adjustable Standing Desk',
      url: 'https://www.wayfair.com/furniture/pdp/the-twillery-co-putnam-height-adjustable-standing-desks-w008127716.html?piid=194064652%2C194064658',
      expectedCubicFeet: 2.6,
      expectedType: 'Desk'
    },
    {
      name: 'Dickens Ergonomic Mesh Task Chair',
      url: 'https://www.wayfair.com/furniture/pdp/ivy-bronx-dickens-ergonomic-mesh-task-chair-w100383013.html?piid=1312886536',
      expectedCubicFeet: 3.7,
      expectedType: 'Chair'
    }
  ];

  const results = [];

  for (const product of testProducts) {
    console.log(`\n🔍 Testing: ${product.name}`);
    console.log(`Expected: ${product.expectedCubicFeet} cubic feet`);
    console.log(`URL: ${product.url.substring(0, 80)}...`);
    
    try {
      const startTime = Date.now();
      const scraped = await parseProduct(product.url);
      const endTime = Date.now();
      
      // Calculate cubic feet from dimensions
      let calculatedCubicFeet = null;
      let accuracy = null;
      
      if (scraped.dimensions) {
        const { length, width, height } = scraped.dimensions;
        if (length && width && height) {
          const cubicInches = length * width * height;
          calculatedCubicFeet = cubicInches / 1728; // Convert to cubic feet
          
          // Calculate accuracy percentage
          const difference = Math.abs(calculatedCubicFeet - product.expectedCubicFeet);
          const percentDiff = (difference / product.expectedCubicFeet) * 100;
          accuracy = Math.max(0, 100 - percentDiff);
        }
      }
      
      const result = {
        product: product.name,
        expectedCubicFeet: product.expectedCubicFeet,
        scraped: {
          name: scraped.name,
          price: scraped.price,
          currency: scraped.currency,
          dimensions: scraped.dimensions,
          calculatedCubicFeet: calculatedCubicFeet,
          accuracy: accuracy ? `${accuracy.toFixed(1)}%` : 'N/A',
          scrapeTime: `${endTime - startTime}ms`,
          vendor: scraped._meta?.vendor,
          model: scraped._meta?.model
        }
      };
      
      results.push(result);
      
      console.log(`✅ Scraped successfully in ${endTime - startTime}ms`);
      console.log(`   Name: ${scraped.name}`);
      console.log(`   Price: $${scraped.price} ${scraped.currency}`);
      
      if (scraped.dimensions) {
        console.log(`   Dimensions: ${scraped.dimensions.length}" × ${scraped.dimensions.width}" × ${scraped.dimensions.height}"`);
        console.log(`   Calculated: ${calculatedCubicFeet?.toFixed(2)} cubic feet`);
        console.log(`   Expected: ${product.expectedCubicFeet} cubic feet`);
        console.log(`   Accuracy: ${accuracy ? accuracy.toFixed(1) + '%' : 'N/A'}`);
      } else {
        console.log(`   ❌ No dimensions extracted`);
      }
      
    } catch (error) {
      console.log(`❌ Failed: ${error.message}`);
      results.push({
        product: product.name,
        expectedCubicFeet: product.expectedCubicFeet,
        error: error.message
      });
    }
  }

  // Summary Report
  console.log('\n📊 SUMMARY REPORT');
  console.log('==================');
  
  const successful = results.filter(r => !r.error && r.scraped?.calculatedCubicFeet);
  const failed = results.filter(r => r.error || !r.scraped?.calculatedCubicFeet);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    const avgAccuracy = successful.reduce((sum, r) => {
      const acc = parseFloat(r.scraped.accuracy);
      return sum + (isNaN(acc) ? 0 : acc);
    }, 0) / successful.length;
    
    console.log(`📈 Average Accuracy: ${avgAccuracy.toFixed(1)}%`);
    
    console.log('\n🎯 Detailed Results:');
    successful.forEach(result => {
      console.log(`\n${result.product}:`);
      console.log(`  Expected: ${result.expectedCubicFeet} ft³`);
      console.log(`  Scraped: ${result.scraped.calculatedCubicFeet?.toFixed(2)} ft³`);
      console.log(`  Accuracy: ${result.scraped.accuracy}`);
      console.log(`  Dimensions: ${result.scraped.dimensions?.length}" × ${result.scraped.dimensions?.width}" × ${result.scraped.dimensions?.height}"`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\n❌ Failed Products:');
    failed.forEach(result => {
      console.log(`  ${result.product}: ${result.error || 'No dimensions extracted'}`);
    });
  }
  
  return results;
}

// Run the test
testWayfairProducts()
  .then(results => {
    console.log('\n🏁 Test completed!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });