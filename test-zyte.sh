#!/bin/bash

# Test Zyte API directly with curl
# Replace YOUR_API_KEY with your actual API key

curl -X POST "https://api.zyte.com/v1/extract" \
  --user "YOUR_API_KEY:" \
  --header "Content-Type: application/json" \
  --header "Accept: application/json" \
  --data '{
    "url": "https://www.crateandbarrel.com/retreat-2-piece-chaise-sectional-sofa/s199555",
    "browserHtml": true,
    "product": true,
    "productOptions": {
      "extractFrom": "browserHtml",
      "ai": true
    }
  }' \
  --compressed

echo ""
echo "=== Test completed ==="