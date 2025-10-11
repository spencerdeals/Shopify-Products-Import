const express = require('express');
const router = express.Router();
const version = require('../serverVersion');

router.get('/', (req, res) => res.json(version));

module.exports = router;
