/**
 * Quote PDF Generator
 *
 * Generates professional, branded PDF quotes for customers.
 * Uses SDL branding and comprehensive itemization.
 */

const PDFDocument = require('pdfkit');
const torso = require('../torso');

/**
 * Format currency
 */
function formatCurrency(amount) {
  return `$${parseFloat(amount).toFixed(2)}`;
}

/**
 * Format date
 */
function formatDate(date) {
  const d = date || new Date();
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Generate quote number
 */
function generateQuoteNumber() {
  const date = new Date();
  const yyyyMMdd = date.toISOString().split('T')[0].replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SDLQ-${yyyyMMdd}-${random}`;
}

/**
 * Generate Quote PDF
 */
async function generateQuotePDF(handles, options = {}) {
  console.log(`\n[PDF] Generating quote for ${handles.length} products`);

  // Create PDF document
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 50, bottom: 50, left: 50, right: 50 }
  });

  // Buffer to store PDF
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));

  const quoteNumber = generateQuoteNumber();
  const quoteDate = formatDate();
  const validUntilDate = formatDate(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)); // +3 days

  // Colors (SDL brand greens)
  const primaryColor = '#2D7A4F';   // SDL Green
  const secondaryColor = '#52B788';  // Light Green
  const textColor = '#1B263B';       // Dark Blue-Gray
  const mutedColor = '#6C757D';      // Muted Gray

  // ======================
  // HEADER
  // ======================

  // Company Logo & Info (Left)
  doc.fontSize(20)
    .fillColor(primaryColor)
    .text('SDL', 50, 50)
    .fontSize(10)
    .fillColor(textColor)
    .text('Spencer Deals Ltd.', 50, 75)
    .fontSize(9)
    .fillColor(mutedColor)
    .text('123 Warehouse Way', 50, 90)
    .text('Hamilton, Bermuda HM 12', 50, 102)
    .text('Phone: (441) 555-1234', 50, 114)
    .text('Email: quotes@sdl.bm', 50, 126)
    .text('Web: www.sdl.bm', 50, 138);

  // Quote Info (Right)
  doc.fontSize(24)
    .fillColor(primaryColor)
    .text('QUOTE', 400, 50, { align: 'right' })
    .fontSize(10)
    .fillColor(textColor)
    .text(`Quote #: ${quoteNumber}`, 400, 85, { align: 'right' })
    .text(`Date: ${quoteDate}`, 400, 100, { align: 'right' })
    .fontSize(9)
    .fillColor(mutedColor)
    .text(`Valid Until: ${validUntilDate}`, 400, 115, { align: 'right' })
    .text('(Quote valid for 3 days)', 400, 130, { align: 'right' });

  // Horizontal line
  doc.strokeColor(secondaryColor)
    .lineWidth(2)
    .moveTo(50, 170)
    .lineTo(562, 170)
    .stroke();

  // ======================
  // CUSTOMER INFO
  // ======================

  let currentY = 190;

  if (options.customerName || options.customerEmail) {
    doc.fontSize(12)
      .fillColor(primaryColor)
      .text('CUSTOMER:', 50, currentY);

    currentY += 20;

    if (options.customerName) {
      doc.fontSize(10)
        .fillColor(textColor)
        .text(options.customerName, 50, currentY);
      currentY += 15;
    }

    if (options.customerEmail) {
      doc.fontSize(9)
        .fillColor(mutedColor)
        .text(options.customerEmail, 50, currentY);
      currentY += 15;
    }

    if (options.customerPhone) {
      doc.fontSize(9)
        .fillColor(mutedColor)
        .text(options.customerPhone, 50, currentY);
      currentY += 15;
    }

    currentY += 10;
  }

  // ======================
  // ITEMS TABLE
  // ======================

  currentY += 20;

  doc.fontSize(12)
    .fillColor(primaryColor)
    .text('ITEMS:', 50, currentY);

  currentY += 25;

  // Table header
  doc.rect(50, currentY, 512, 25)
    .fillAndStroke(secondaryColor, primaryColor);

  doc.fontSize(9)
    .fillColor('white')
    .text('Item', 55, currentY + 8, { width: 200 })
    .text('Options', 260, currentY + 8, { width: 100 })
    .text('Qty', 365, currentY + 8, { width: 30, align: 'center' })
    .text('Unit Price', 400, currentY + 8, { width: 70, align: 'right' })
    .text('Subtotal', 475, currentY + 8, { width: 80, align: 'right' });

  currentY += 25;

  // Fetch product data and build rows
  const lineItems = [];
  let subtotal = 0;

  for (const handle of handles) {
    const product = await torso.getProductComplete(handle);
    if (!product) continue;

    product.variants.forEach(variant => {
      if (!variant.pricing) return;

      const qty = options.quantities?.[variant.variant_sku] || 1;
      const unitPrice = variant.pricing.retail_price_usd;
      const lineTotal = unitPrice * qty;

      // Build options string
      let optionsStr = '';
      if (variant.option1_value && variant.option1_value !== 'Default Title') {
        optionsStr = variant.option1_value;
      }
      if (variant.option2_value) {
        optionsStr += optionsStr ? ` / ${variant.option2_value}` : variant.option2_value;
      }

      lineItems.push({
        title: product.title,
        options: optionsStr,
        qty,
        unitPrice,
        lineTotal
      });

      subtotal += lineTotal;
    });
  }

  // Draw table rows
  lineItems.forEach((item, idx) => {
    const rowY = currentY;

    // Alternate row background
    if (idx % 2 === 0) {
      doc.rect(50, rowY, 512, 30)
        .fillColor('#F8F9FA')
        .fill();
    }

    // Row content
    doc.fontSize(9)
      .fillColor(textColor)
      .text(item.title, 55, rowY + 8, { width: 200, ellipsis: true })
      .fillColor(mutedColor)
      .text(item.options, 260, rowY + 8, { width: 100, ellipsis: true })
      .fillColor(textColor)
      .text(item.qty.toString(), 365, rowY + 8, { width: 30, align: 'center' })
      .text(formatCurrency(item.unitPrice), 400, rowY + 8, { width: 70, align: 'right' })
      .text(formatCurrency(item.lineTotal), 475, rowY + 8, { width: 80, align: 'right' });

    currentY += 30;
  });

  // Table bottom border
  doc.strokeColor(secondaryColor)
    .lineWidth(1)
    .moveTo(50, currentY)
    .lineTo(562, currentY)
    .stroke();

  currentY += 20;

  // ======================
  // TOTALS
  // ======================

  const totalsX = 380;

  doc.fontSize(10)
    .fillColor(textColor)
    .text('Subtotal:', totalsX, currentY, { width: 90, align: 'right' })
    .text(formatCurrency(subtotal), totalsX + 95, currentY, { width: 80, align: 'right' });

  currentY += 20;

  // Grand Total (bold, larger)
  doc.fontSize(14)
    .fillColor(primaryColor)
    .text('Grand Total:', totalsX, currentY, { width: 90, align: 'right' })
    .text(formatCurrency(subtotal), totalsX + 95, currentY, { width: 80, align: 'right' });

  currentY += 40;

  // ======================
  // FOOTER
  // ======================

  currentY += 20;

  doc.fontSize(9)
    .fillColor(mutedColor)
    .text('Prices in USD. Freight, taxes, and duties as described.', 50, currentY, { align: 'center' })
    .text('Quote valid for 3 days.', 50, currentY + 15, { align: 'center' })
    .text('Thank you for shopping with SDL.', 50, currentY + 35, { align: 'center', underline: false });

  currentY += 65;

  doc.fontSize(7)
    .fillColor(mutedColor)
    .text('Product specs and availability subject to vendor confirmation.', 50, currentY, { align: 'center' });

  // Finalize PDF
  doc.end();

  // Wait for PDF to finish
  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      console.log(`[PDF] PDF generated: ${pdfBuffer.length} bytes`);
      resolve({
        buffer: pdfBuffer,
        filename: `SDL_Quote_${quoteDate.replace(/-/g, '')}_${quoteNumber.split('-')[2]}.pdf`,
        quoteNumber
      });
    });
    doc.on('error', reject);
  });
}

module.exports = {
  generateQuotePDF,
  generateQuoteNumber,
  formatCurrency,
  formatDate
};
