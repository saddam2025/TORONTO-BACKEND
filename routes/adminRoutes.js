const express = require('express');
const {
  getAllApplications,
  approveApplication,
  rejectApplication,
} = require('../controllers/affiliateController');
const { updateSystemSettings, createAdmin } = require('../controllers/adminController');
const { updateOrderStatus } = require('../controllers/orderController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

const router = express.Router();

// @route   GET /api/admin/applications
// @desc    View all affiliate applications (optionally filter with ?status=)
// @access  Private (Manager/Admin only)
router.get('/applications', protect, restrictTo('Manager', 'Admin'), getAllApplications);

// @route   PUT /api/admin/applications/:id/approve
// @desc    Approve an application: promotes User to Affiliate + creates AffiliateProfile
// @access  Private (Manager/Admin only)
router.put(
  '/applications/:id/approve',
  protect,
  restrictTo('Manager', 'Admin'),
  approveApplication
);

// @route   PUT /api/admin/applications/:id/reject
// @desc    Reject an application (counterpart to approve; frees up the requested code)
// @access  Private (Manager/Admin only)
router.put(
  '/applications/:id/reject',
  protect,
  restrictTo('Manager', 'Admin'),
  rejectApplication
);

// @route   PUT /api/admin/settings
// @desc    Update global discount/commission rates
// @access  Private (Manager ONLY)
router.put('/settings', protect, restrictTo('Manager'), updateSystemSettings);

// @route   POST /api/admin/create-admin
// @desc    Manually create a new Admin account
// @access  Private (Manager ONLY)
router.post('/create-admin', protect, restrictTo('Manager'), createAdmin);

// @route   PUT /api/admin/orders/:id/status
// @desc    Update an order's status; auto-settles affiliate wallet on Delivered
// @access  Private (Admin/Manager)
router.put('/orders/:id/status', protect, restrictTo('Admin', 'Manager'), updateOrderStatus);

module.exports = router;
