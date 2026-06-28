const express = require('express');
const { applyForAffiliate } = require('../controllers/affiliateController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

const router = express.Router();

// @route   POST /api/affiliates/apply
// @desc    Submit an application to become an Affiliate
// @access  Private (Customer only)
router.post('/apply', protect, restrictTo('Customer'), applyForAffiliate);

module.exports = router;
