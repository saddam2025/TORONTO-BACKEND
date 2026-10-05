// backend/routes/orderRoutes.js
const express = require('express');
const {
  createOrder,
  previewOrderPricing,
  getMyOrders,
  cancelMyOrder,
  getOrders,
  initiatePaymobPayment,
  paymobWebhook,
} = require('../controllers/orderController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

const router = express.Router();

// @route   POST /api/orders
// @desc    Create a new order (Cash On Delivery / general checkout)
// @access  Private (Customer only)
router.post('/', protect, restrictTo('Customer', 'Affiliate', 'Admin', 'Manager'), createOrder);
router.post('/preview', previewOrderPricing);

// @route   GET /api/orders/my-orders
// @desc    Get the currently authenticated user's own orders
// @access  Private (any authenticated user)
router.get('/my-orders', protect, getMyOrders);

router.put('/:id/cancel', protect, restrictTo('Customer'), cancelMyOrder);

// @route   GET /api/orders
// @desc    Get all orders, optionally filtered by ?status=
// @access  Private (Manager/Admin only)
router.get('/', protect, restrictTo('Manager', 'Admin'), getOrders);

// @route   POST /api/orders/pay/paymob
// @desc    Create an order and run the Paymob 3-step flow (Auth Token ->
//          Register Order -> Payment Key), returning an iframe URL.
// @access  Private (Customer/Affiliate/Admin/Manager)
router.post(
  '/pay/paymob',
  protect,
  restrictTo('Customer', 'Affiliate', 'Admin', 'Manager'),
  initiatePaymobPayment
);

// @route   POST /api/orders/webhook/paymob
// @desc    Paymob "Transaction Processed" server-to-server callback.
//          Public route — NOT behind `protect`, since Paymob can't send a
//          JWT. Trust is established purely via HMAC signature validation.
router.post('/webhook/paymob', paymobWebhook);

// Note: PUT /api/admin/orders/:id/status (order status update + wallet
// transfer logic) is intentionally defined in routes/adminRoutes.js.

module.exports = router;
