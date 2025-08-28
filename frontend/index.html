<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Instant Import Calculator</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 700px;
            width: 100%;
            padding: 40px;
            position: relative;
            overflow: hidden;
        }

        .container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 5px;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        }

        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 28px;
            text-align: center;
        }

        .subtitle {
            color: #666;
            text-align: center;
            margin-bottom: 25px;
            font-size: 14px;
        }

        /* Freight Forwarder Address Box */
        .forwarder-address {
            background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
            border: 2px solid #66bb6a;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 25px;
            position: relative;
        }

        .forwarder-header {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            color: #2e7d32;
            font-weight: 600;
            font-size: 16px;
        }

        .forwarder-header::before {
            content: '🚚';
            margin-right: 8px;
            font-size: 20px;
        }

        .forwarder-name {
            color: #2e7d32;
            font-weight: 600;
            font-size: 18px;
            margin-bottom: 5px;
        }

        .forwarder-details {
            color: #555;
            line-height: 1.6;
            margin-bottom: 10px;
        }

        .forwarder-note {
            color: #558b2f;
            font-style: italic;
            font-size: 13px;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #a5d6a7;
        }

        .input-group {
            margin-bottom: 25px;
        }

        label {
            display: block;
            color: #555;
            margin-bottom: 8px;
            font-weight: 500;
            font-size: 14px;
        }

        input {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s;
            background-color: #f8f9fa;
        }

        input:focus {
            outline: none;
            border-color: #667eea;
            background-color: white;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        /* Vendor-specific delivery fee section */
        .vendor-delivery-section {
            background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
            border: 1px solid #81c784;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 20px;
        }

        .vendor-delivery-header {
            display: flex;
            align-items: center;
            color: #2e7d32;
            font-weight: 600;
            margin-bottom: 12px;
            font-size: 15px;
        }

        .vendor-delivery-header::before {
            content: '🚚';
            margin-right: 8px;
        }

        .vendor-delivery-note {
            color: #666;
            font-size: 12px;
            font-style: italic;
            margin-top: 8px;
        }

        button {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.3s, box-shadow 0.3s;
            margin-top: 10px;
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        button:disabled {
            opacity: 0.7;
            cursor: not-allowed;
            transform: none;
        }

        .loading {
            display: none;
            text-align: center;
            margin-top: 20px;
        }

        .loading.active {
            display: block;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .loading-text {
            margin-top: 15px;
            color: #666;
            font-size: 14px;
        }

        .results {
            display: none;
            margin-top: 30px;
            padding-top: 30px;
            border-top: 2px solid #e0e0e0;
        }

        .results.active {
            display: block;
            animation: fadeIn 0.5s;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .result-item {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid #f0f0f0;
        }

        .result-item:last-child {
            border-bottom: none;
        }

        .result-label {
            color: #555;
            font-size: 14px;
        }

        .result-value {
            color: #333;
            font-weight: 600;
            font-size: 14px;
        }

        .total-row {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 2px solid #667eea;
        }

        .total-row .result-label {
            font-size: 18px;
            color: #333;
            font-weight: 600;
        }

        .total-row .result-value {
            font-size: 20px;
            color: #667eea;
            font-weight: 700;
        }

        .error {
            display: none;
            background-color: #fee;
            color: #c33;
            padding: 15px;
            border-radius: 10px;
            margin-top: 20px;
            border-left: 4px solid #c33;
        }

        .error.active {
            display: block;
        }

        .price-alert {
            background-color: #ffebee;
            border: 1px solid #ff5252;
            color: #c62828;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            font-size: 13px;
        }

        .price-alert-icon {
            width: 20px;
            height: 20px;
            background-color: #ff5252;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 10px;
            flex-shrink: 0;
        }

        .price-alert-icon::after {
            content: '!';
            color: white;
            font-weight: bold;
            font-size: 14px;
        }

        .info-text {
            color: #666;
            font-size: 12px;
            text-align: center;
            margin-top: 20px;
            line-height: 1.5;
        }

        .searching-indicator {
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 10px 0;
        }

        .searching-dot {
            width: 8px;
            height: 8px;
            background-color: #667eea;
            border-radius: 50%;
            margin: 0 3px;
            animation: searchingPulse 1.4s infinite ease-in-out both;
        }

        .searching-dot:nth-child(1) {
            animation-delay: -0.32s;
        }

        .searching-dot:nth-child(2) {
            animation-delay: -0.16s;
        }

        @keyframes searchingPulse {
            0%, 80%, 100% {
                transform: scale(0);
                opacity: 0.5;
            }
            40% {
                transform: scale(1);
                opacity: 1;
            }
        }

        .vendor-name {
            color: #667eea;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚢 Instant Import Calculator</h1>
        <p class="subtitle">Get accurate shipping costs for your Bermuda imports</p>
        
        <!-- Freight Forwarder Address Box -->
        <div class="forwarder-address">
            <div class="forwarder-header">USA Freight Forwarder Address</div>
            <div class="forwarder-name">Sealine Freight Forwarder</div>
            <div class="forwarder-details">
                Elizabeth, NJ 07201-614<br>
                New Jersey, USA
            </div>
            <div class="forwarder-note">
                Use this address when calculating shipping costs from US retailers to get accurate delivery totals.
            </div>
        </div>

        <!-- Red price alert warning -->
        <div class="price-alert">
            <div class="price-alert-icon"></div>
            <div>
                <strong>Important:</strong> Final prices may vary based on actual product dimensions and weight. This calculator provides estimates for planning purposes.
            </div>
        </div>

        <form id="calculatorForm">
            <div class="input-group">
                <label for="productUrl">Product URL</label>
                <input 
                    type="url" 
                    id="productUrl" 
                    name="productUrl" 
                    placeholder="https://www.example.com/product" 
                    required
                >
            </div>

            <!-- Vendor-specific delivery fee section -->
            <div class="vendor-delivery-section" id="deliveryFeeSection">
                <div class="vendor-delivery-header">
                    <span id="vendorDeliveryLabel">USA Delivery Fee</span>
                </div>
                <div class="input-group" style="margin-bottom: 0;">
                    <label for="usShipping">Enter any shipping costs from <span id="vendorName" class="vendor-name">the retailer</span> to our New Jersey freight forwarder address:</label>
                    <div style="display: flex; align-items: center;">
                        <span style="margin-right: 10px; color: #555;">Delivery Fee (if any): $</span>
                        <input 
                            type="number" 
                            id="usShipping" 
                            name="usShipping" 
                            placeholder="0.00" 
                            min="0" 
                            step="0.01" 
                            required
                            style="flex: 1; max-width: 150px;"
                        >
                    </div>
                    <div class="vendor-delivery-note">
                        Most retailers offer free shipping, but some may charge delivery fees to New Jersey.
                    </div>
                </div>
            </div>

            <button type="submit" id="calculateBtn">
                Calculate Import Costs
            </button>
        </form>

        <div class="loading" id="loading">
            <div class="spinner"></div>
            <div class="loading-text">
                <span id="loadingMessage">Searching for product information...</span>
                <div class="searching-indicator">
                    <div class="searching-dot"></div>
                    <div class="searching-dot"></div>
                    <div class="searching-dot"></div>
                </div>
            </div>
        </div>

        <div class="error" id="error"></div>

        <div class="results" id="results">
            <h3 style="margin-bottom: 20px; color: #333;">Cost Breakdown</h3>
            
            <div class="result-item">
                <span class="result-label">Item First Cost:</span>
                <span class="result-value" id="itemCost">-</span>
            </div>
            
            <div class="result-item">
                <span class="result-label">Bermuda Import Duty (26.5%):</span>
                <span class="result-value" id="importDuty">-</span>
            </div>
            
            <div class="result-item">
                <span class="result-label"><span id="vendorResultLabel">USA</span> Delivery Fee:</span>
                <span class="result-value" id="usaDelivery">-</span>
            </div>
            
            <div class="result-item">
                <span class="result-label">Ocean Freight & Handling:</span>
                <span class="result-value" id="freightHandling">-</span>
            </div>
            
            <div class="result-item total-row">
                <span class="result-label">Total Landed Cost:</span>
                <span class="result-value" id="totalCost">-</span>
            </div>

            <button type="button" id="createOrderBtn" style="margin-top: 20px;">
                Create Draft Order in Shopify
            </button>
        </div>

        <p class="info-text">
            This calculator uses intelligent estimation to determine shipping costs based on product category, weight, and price.
            We search multiple data points to provide the most accurate estimate possible.
        </p>
    </div>

    <script>
        let currentCalculation = null;
        const loadingMessages = [
            "Searching for product information...",
            "Analyzing product details...",
            "Calculating dimensions...",
            "Determining shipping category...",
            "Finalizing your quote..."
        ];

        // Function to extract vendor name from URL
        function getVendorFromUrl(url) {
            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname.toLowerCase();
                
                // Common vendor mappings
                if (hostname.includes('wayfair')) return 'Wayfair';
                if (hostname.includes('amazon')) return 'Amazon';
                if (hostname.includes('walmart')) return 'Walmart';
                if (hostname.includes('target')) return 'Target';
                if (hostname.includes('homedepot')) return 'Home Depot';
                if (hostname.includes('lowes')) return 'Lowes';
                if (hostname.includes('overstock')) return 'Overstock';
                if (hostname.includes('costco')) return 'Costco';
                if (hostname.includes('ikea')) return 'IKEA';
                if (hostname.includes('bestbuy')) return 'Best Buy';
                if (hostname.includes('ebay')) return 'eBay';
                if (hostname.includes('etsy')) return 'Etsy';
                if (hostname.includes('macys')) return "Macy's";
                if (hostname.includes('nordstrom')) return 'Nordstrom';
                if (hostname.includes('sephora')) return 'Sephora';
                if (hostname.includes('ulta')) return 'Ulta';
                if (hostname.includes('apple')) return 'Apple';
                if (hostname.includes('nike')) return 'Nike';
                if (hostname.includes('adidas')) return 'Adidas';
                
                // Extract domain name as fallback
                const domain = hostname.replace('www.', '').split('.')[0];
                return domain.charAt(0).toUpperCase() + domain.slice(1);
            } catch (e) {
                return 'USA';
            }
        }

        // Update vendor name when URL changes
        document.getElementById('productUrl').addEventListener('input', function(e) {
            const vendor = getVendorFromUrl(e.target.value);
            
            // Update delivery fee section
            document.getElementById('vendorDeliveryLabel').textContent = vendor + ' Delivery Fee';
            document.getElementById('vendorName').textContent = vendor;
            
            // Update result label placeholder
            document.getElementById('vendorResultLabel').textContent = vendor;
        });

        document.getElementById('calculatorForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const productUrl = document.getElementById('productUrl').value;
            const usShipping = parseFloat(document.getElementById('usShipping').value);
            const vendor = getVendorFromUrl(productUrl);
            
            // Update vendor label in results
            document.getElementById('vendorResultLabel').textContent = vendor;
            
            // Hide previous results/errors
            document.getElementById('results').classList.remove('active');
            document.getElementById('error').classList.remove('active');
            
            // Show loading
            document.getElementById('loading').classList.add('active');
            document.getElementById('calculateBtn').disabled = true;
            
            // Cycle through loading messages
            let messageIndex = 0;
            const messageInterval = setInterval(() => {
                messageIndex = (messageIndex + 1) % loadingMessages.length;
                document.getElementById('loadingMessage').textContent = loadingMessages[messageIndex];
            }, 2000);
            
            try {
                const response = await fetch('/api/calculate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: productUrl,
                        usShipping: usShipping,
                        vendor: vendor
                    })
                });
                
                clearInterval(messageInterval);
                
                if (!response.ok) {
                    throw new Error('Failed to calculate shipping');
                }
                
                const data = await response.json();
                currentCalculation = data;
                currentCalculation.vendor = vendor; // Store vendor name
                
                // Update results
                document.getElementById('itemCost').textContent = `$${data.itemCost.toFixed(2)}`;
                document.getElementById('importDuty').textContent = `$${data.importDuty.toFixed(2)}`;
                document.getElementById('usaDelivery').textContent = `$${data.usaDelivery.toFixed(2)}`;
                document.getElementById('freightHandling').textContent = `$${data.freightHandling.toFixed(2)}`;
                document.getElementById('totalCost').textContent = `$${data.totalCost.toFixed(2)}`;
                
                // Show results
                document.getElementById('loading').classList.remove('active');
                document.getElementById('results').classList.add('active');
                
            } catch (error) {
                clearInterval(messageInterval);
                document.getElementById('loading').classList.remove('active');
                document.getElementById('error').classList.add('active');
                document.getElementById('error').innerHTML = `
                    <strong>Error:</strong> Unable to calculate shipping costs. Please check the URL and try again.
                    <br><small>Tip: Make sure the product URL is complete and accessible.</small>
                `;
            } finally {
                document.getElementById('calculateBtn').disabled = false;
            }
        });

        document.getElementById('createOrderBtn')?.addEventListener('click', async () => {
            if (!currentCalculation) return;
            
            const btn = document.getElementById('createOrderBtn');
            btn.disabled = true;
            btn.textContent = 'Creating Order...';
            
            try {
                const response = await fetch('/apps/instant-import/create-draft-order', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(currentCalculation)
                });
                
                if (!response.ok) {
                    throw new Error('Failed to create draft order');
                }
                
                const data = await response.json();
                
                if (data.draftOrder && data.draftOrder.invoice_url) {
                    window.open(data.draftOrder.invoice_url, '_blank');
                    btn.textContent = 'Order Created! Opening...';
                    setTimeout(() => {
                        btn.textContent = 'Create Another Order';
                        btn.disabled = false;
                    }, 2000);
                }
            } catch (error) {
                alert('Failed to create draft order. Please try again.');
                btn.textContent = 'Create Draft Order in Shopify';
                btn.disabled = false;
            }
        });
    </script>
</body>
</html>
