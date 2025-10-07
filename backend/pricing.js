// backend/pricing.js
module.exports = {
  FREIGHT_RATE_PER_CUFT: 8.50,
  CUSTOMS_CLEAR_FEE_PER_VENDOR: 10,
  DEFAULT_HANDLING_FEE: 15,
  CARD_FEE_RATE: 0.04,
  MARGIN_RATE: 0.20, // 20% total order margin

  calculatePricing(volumeFt3, vendors = 1) {
    const freight = volumeFt3 * this.FREIGHT_RATE_PER_CUFT;
    const customs = vendors * this.CUSTOMS_CLEAR_FEE_PER_VENDOR;
    const handling = this.DEFAULT_HANDLING_FEE;
    const subtotal = freight + customs + handling;

    // Safety buffer: round up to nearest multiple of 5
    const total = Math.ceil(subtotal / 5) * 5;

    // Add 20% margin on total order level (applied later, not per line)
    const withMargin = total * (1 + this.MARGIN_RATE);

    return {
      freight,
      customs,
      handling,
      subtotal: total,
      total_with_margin: withMargin,
      notes: `Freight $${this.FREIGHT_RATE_PER_CUFT}/ft³ | Customs $${this.CUSTOMS_CLEAR_FEE_PER_VENDOR}/vendor | Handling $${this.DEFAULT_HANDLING_FEE}`
    };
  }
};
