// backend/routes/affiliateRoutes.js
const express = require('express');
const {
  applyForAffiliate,
  getAffiliateDashboard,
  getAffiliateLedger,
  confirmAffiliatePayout,
} = require('../controllers/affiliateController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/apply', protect, restrictTo('Customer'), applyForAffiliate);
router.get('/dashboard', protect, restrictTo('Affiliate'), getAffiliateDashboard);

// @route   GET /api/affiliates/ledger
// @desc    Real per-affiliate ledger (order count, top product, payable
//          commission) — replaces the hardcoded mock array.
// @access  Private (Manager/Admin only)
router.get('/ledger', protect, restrictTo('Manager', 'Admin'), getAffiliateLedger);

// @route   PUT /api/affiliates/:profileId/confirm-payout
// @desc    Zeroes an affiliate's withdrawableBalance once the manager has
//          actually sent the payout outside the platform.
// @access  Private (Manager/Admin only)
router.put('/:profileId/confirm-payout', protect, restrictTo('Manager', 'Admin'), confirmAffiliatePayout);

module.exports = router;