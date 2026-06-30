// orderRoutes.js
const express = require('express');
const { createOrder } = require('../controllers/orderController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

const router = express.Router();

// @route   POST /api/orders
// @desc    Create a new order (runs the Affiliate Engine checkout logic)
// @access  Private (Customer only)
router.post('/', protect, restrictTo('Customer'), createOrder);

// Note: PUT /api/admin/orders/:id/status (order status update + wallet
// transfer logic) is intentionally defined in routes/adminRoutes.js rather
// than here, since the spec places it under the /api/admin namespace
// alongside the other Manager/Admin management endpoints. The controller
// logic itself (updateOrderStatus) still lives in controllers/orderController.js
// since it's order-domain logic.

module.exports = router;