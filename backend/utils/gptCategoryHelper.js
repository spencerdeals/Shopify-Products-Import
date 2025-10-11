function detectFlatpackCategory(text = "") {
  const s = String(text).toLowerCase();

  const nonFlat = [
    "refrigerator", "fridge", "freezer", "oven", "range", "microwave",
    "washer", "dryer", "stove", "dishwasher",
    "tv", "television", "monitor", "projector",
    "bicycle", "motorcycle", "golf club", "golf clubs", "surfboard",
    "piano", "grand piano", "violin", "drum set", "mattress", "mirror"
  ];

  if (nonFlat.some(k => s.includes(k))) {
    return {
      inferredTier: "assembled",
      confidence: 0.9,
      reason: "appliance/oversize"
    };
  }

  if (/assembly|required|flat\s?pack|ships in|tools included|allen key|knockdown/i.test(s)) {
    return {
      inferredTier: "flatpack",
      confidence: 0.7,
      reason: "assembly hints"
    };
  }

  return {
    inferredTier: "flatpack",
    confidence: 0.6,
    reason: "generic furniture default"
  };
}

module.exports = { detectFlatpackCategory };
