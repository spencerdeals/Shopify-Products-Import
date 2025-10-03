function extractProPriceFromHTML(html) {
  const regex = /Pro savings applied.*?Consumers pay \$([0-9]+\.[0-9]{2})/i;
  const match = html?.match(regex);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

module.exports = { extractProPriceFromHTML };
