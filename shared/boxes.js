function round2(n) {
  return Math.round(n * 100) / 100;
}

function parseBoxesTextToCuft(boxesText) {
  if (!boxesText || typeof boxesText !== 'string') {
    return null;
  }

  const lines = boxesText.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) {
    return null;
  }

  const boxes = [];
  let totalCuft = 0;

  for (const line of lines) {
    const match = line.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      const [, h, w, d] = match.map(Number);
      const cuft = (h * w * d) / 1728;
      boxes.push({ h, w, d, cuft: round2(cuft) });
      totalCuft += cuft;
    }
  }

  if (!boxes.length) {
    return null;
  }

  return {
    boxes,
    totalCuft: round2(totalCuft),
    count: boxes.length
  };
}

module.exports = {
  round2,
  parseBoxesTextToCuft
};
