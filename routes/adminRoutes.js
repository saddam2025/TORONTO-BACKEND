// adminRoutes.js
const express = require('express');
const {
  getAllApplications,
  approveApplication,
  rejectApplication,
} = require('../controllers/affiliateController');
const {
  updateSystemSettings,
  createAdmin,
  getAllUsers,
  getUserById,
  updateUserStatus,
  getAnalytics,
} = require('../controllers/adminController');
const { updateOrderStatus } = require('../controllers/orderController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/applications', protect, restrictTo('Manager', 'Admin'), getAllApplications);

router.put('/applications/:id/approve', protect, restrictTo('Manager', 'Admin'), approveApplication);

router.put('/applications/:id/reject', protect, restrictTo('Manager', 'Admin'), rejectApplication);

router.put('/settings', protect, restrictTo('Manager'), updateSystemSettings);

router.post('/create-admin', protect, restrictTo('Manager'), createAdmin);

router.get('/users', protect, restrictTo('Manager', 'Admin'), getAllUsers);

// @route   GET /api/admin/users/:id
// @desc    Full profile detail for one user — powers the "click a name"
//          view in the Manager Dashboard's Users tab.
// @access  Private (Manager/Admin only)
router.get('/users/:id', protect, restrictTo('Manager', 'Admin'), getUserById);

router.put('/users/:id/status', protect, restrictTo('Manager'), updateUserStatus);

router.put('/orders/:id/status', protect, restrictTo('Admin', 'Manager'), updateOrderStatus);

router.get('/analytics', protect, restrictTo('Admin', 'Manager'), getAnalytics);

module.exports = router;