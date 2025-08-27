console.log('STARTING');
require('http').createServer((req, res) => {
  res.end('OK');
}).listen(process.env.PORT || 3000, '0.0.0.0');
console.log('RUNNING ON PORT', process.env.PORT || 3000);
