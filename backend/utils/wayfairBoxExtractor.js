function extractWayfairBoxDimensions(html) {
  if (!html) return null;

  const boxes = [];

  const hxwxdPattern = /(\d+)\s*H\s*[xX×]\s*(\d+)\s*W\s*[xX×]\s*(\d+)\s*D/g;
  let match;

  console.log('   🔍 Searching for Wayfair HxWxD patterns...');

  while ((match = hxwxdPattern.exec(html)) !== null) {
    const H = parseFloat(match[1]);
    const W = parseFloat(match[2]);
    const D = parseFloat(match[3]);

    if (H > 0 && W > 0 && D > 0 && H < 500 && W < 500 && D < 500) {
      console.log(`   📦 Found box: ${H}H × ${W}W × ${D}D`);
      boxes.push({
        H: H,
        W: W,
        L: D
      });
    }

    if (boxes.length >= 10) break;
  }

  if (boxes.length > 0) {
    const total = boxes.reduce((sum, b) => sum + (b.H * b.W * b.L) / 1728, 0);
    console.log(`   ✅ Wayfair extraction: ${boxes.length} box(es), total ${total.toFixed(2)} ft³ (before padding)`);
    return {
      boxes,
      source: 'wayfair_hxwxd',
      confidence: 0.90,
      notes: [`wayfair_HxWxD_pattern (${boxes.length} boxes)`]
    };
  }

  console.log('   ℹ️  No HxWxD patterns found in HTML');
  return null;
}

module.exports = { extractWayfairBoxDimensions };
