// backend/controllers/orderController.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AffiliateProfile = require('../models/AffiliateProfile');
const User = require('../models/User');

const PAYMOB_BASE_URL = process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com/api';
const PAYMOB_API_KEY = process.env.PAYMOB_API_KEY;
const PAYMOB_INTEGRATION_ID_CARD = process.env.PAYMOB_INTEGRATION_ID_CARD;
const PAYMOB_IFRAME_ID = process.env.PAYMOB_IFRAME_ID;
const PAYMOB_HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET;

/**
 * @desc    Create a new order (Cash on Delivery / general checkout)
 * @route   POST /api/orders
 * @access  Private (Customer only)
 *
 * Body: { items: [{ productId, quantity, size?, color? }], affiliateCode?,
 *         shippingDetails?: { name, phone, address, city } }
 */
const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { items, affiliateCode, shippingDetails } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Order must include at least one item.',
      });
    }

    let affiliateProfile = null;
    let affiliateUser = null;

    if (affiliateCode && String(affiliateCode).trim().length > 0) {
      const normalizedCode = String(affiliateCode).trim().toUpperCase();

      affiliateProfile = await AffiliateProfile.findOne({
        customCode: normalizedCode,
      }).session(session);

      if (!affiliateProfile) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Invalid affiliate code.',
        });
      }

      affiliateUser = await User.findById(affiliateProfile.userId).session(session);

      if (!affiliateUser || affiliateUser.role !== 'Affiliate') {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'This affiliate code is no longer active.',
        });
      }
    }

    let subtotal = 0;
    let totalDiscount = 0;
    let totalAffiliateCommission = 0;
    const orderItems = [];

    for (let i = 0; i < items.length; i += 1) {
      const requestedItem = items[i] || {};
      const productId = requestedItem.productId;
      const quantity = Number(requestedItem.quantity);

      if (!productId || !mongoose.Types.ObjectId.isValid(productId) || !Number.isFinite(quantity) || quantity < 1) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Item at index ${i} requires a valid productId and a quantity of at least 1.`,
        });
      }

      const product = await Product.findById(productId).session(session);

      if (!product) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: `Product not found: ${productId}` });
      }

      if (product.stock < quantity) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.nameEn}". Available: ${product.stock}, requested: ${quantity}.`,
        });
      }

      product.stock -= quantity;
      await product.save({ session });

      const lineTotal = product.price * quantity;
      subtotal += lineTotal;

      if (affiliateProfile) {
        totalDiscount += (product.productDiscount || 0) * quantity;
        totalAffiliateCommission += (product.affiliateCommission || 0) * quantity;
      }

      orderItems.push({
        productId: product._id,
        name: product.nameEn,
        quantity,
        price: product.price,
        // FIX: now actually captured from the request instead of dropped.
        size: requestedItem.size || null,
        color: requestedItem.color || null,
      });
    }

    const totalOrderPrice = subtotal - totalDiscount;

    const order = await Order.create(
      [
        {
          customerId: req.user._id,
          items: orderItems,
          subtotal,
          affiliateId: affiliateUser ? affiliateUser._id : null,
          totalDiscount,
          totalAffiliateCommission,
          totalOrderPrice,
          status: 'Pending',
          paymentMethod: 'COD',
          paymentStatus: 'Pending',
          // FIX: was never read from req.body at all before.
          shippingDetails: {
            name: shippingDetails?.name || null,
            phone: shippingDetails?.phone || null,
            address: shippingDetails?.address || null,
            city: shippingDetails?.city || null,
          },
        },
      ],
      { session }
    );

    if (affiliateProfile && totalAffiliateCommission > 0) {
      affiliateProfile.pendingBalance += totalAffiliateCommission;
      await affiliateProfile.save({ session });
    }

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      order: order[0],
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(500).json({
      success: false,
      message: 'Server error while creating order.',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ customerId: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, results: orders.length, orders });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching your orders.',
      error: error.message,
    });
  }
};

const getOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const allowedStatuses = ['Pending', 'Shipped', 'Delivered', 'Cancelled'];

    const filter = {};
    if (status) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${allowedStatuses.join(', ')}.`,
        });
      }
      filter.status = status;
    }

    const orders = await Order.find(filter)
      .populate('customerId', 'name email')
      .populate('affiliateId', 'name email')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, results: orders.length, orders });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching orders.',
      error: error.message,
    });
  }
};

const updateOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { status } = req.body;
    const allowedStatuses = ['Pending', 'Shipped', 'Delivered', 'Cancelled'];

    if (!status || !allowedStatuses.includes(status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${allowedStatuses.join(', ')}.`,
      });
    }

    const order = await Order.findById(req.params.id).session(session);

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const isNewlyDelivered = order.status !== 'Delivered' && status === 'Delivered';
    const previousStatus = order.status;

    order.status = status;
    await order.save({ session });

    let walletTransfer = null;

    if (isNewlyDelivered && order.affiliateId && order.totalAffiliateCommission > 0) {
      const affiliateProfile = await AffiliateProfile.findOne({ userId: order.affiliateId }).session(session);

      if (affiliateProfile) {
        const commission = order.totalAffiliateCommission;
        affiliateProfile.pendingBalance = Math.max(0, affiliateProfile.pendingBalance - commission);
        affiliateProfile.withdrawableBalance += commission;
        await affiliateProfile.save({ session });

        walletTransfer = {
          affiliateProfileId: affiliateProfile._id,
          customCode: affiliateProfile.customCode,
          amountMoved: commission,
          newPendingBalance: affiliateProfile.pendingBalance,
          newWithdrawableBalance: affiliateProfile.withdrawableBalance,
        };
      }
    }

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: `Order status updated from '${previousStatus}' to '${status}'.`,
      order,
      walletTransfer,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(500).json({
      success: false,
      message: 'Server error while updating order status.',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

const extractPaymobErrorDetail = (data) => {
  if (!data) return null;
  if (typeof data === 'string') return data;
  return data.detail || data.message || data.error || JSON.stringify(data);
};

const getPaymobAuthToken = async () => {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable. This server requires Node.js 18 or newer.');
  }

  const response = await fetch(`${PAYMOB_BASE_URL}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: PAYMOB_API_KEY }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.token) {
    console.error('[Paymob] auth/tokens failed:', response.status, data);
    throw new Error(`Paymob auth failed (status ${response.status}): ${extractPaymobErrorDetail(data) || 'no detail returned'}`);
  }

  return data.token;
};

const registerPaymobOrder = async (authToken, { amountCents, merchantOrderId, items }) => {
  const response = await fetch(`${PAYMOB_BASE_URL}/ecommerce/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: 'EGP',
      merchant_order_id: merchantOrderId,
      items,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    console.error('[Paymob] ecommerce/orders failed:', response.status, data);
    throw new Error(`Paymob order registration failed (status ${response.status}): ${extractPaymobErrorDetail(data) || 'no detail returned'}`);
  }

  return data.id;
};

const getPaymobPaymentKey = async (authToken, { amountCents, paymobOrderId, billingData }) => {
  const payload = {
    auth_token: authToken,
    amount_cents: amountCents,
    expiration: 3600,
    order_id: paymobOrderId,
    billing_data: billingData,
    currency: 'EGP',
    integration_id: Number(PAYMOB_INTEGRATION_ID_CARD),
  };

  const response = await fetch(`${PAYMOB_BASE_URL}/acceptance/payment_keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.token) {
    console.error('[Paymob] payment_keys failed:', response.status, data);
    throw new Error(`Paymob payment key generation failed (status ${response.status}): ${extractPaymobErrorDetail(data) || 'no detail returned'}`);
  }

  return data.token;
};

/**
 * @desc    Create an order and start the Paymob 3-step payment flow
 * @route   POST /api/orders/pay/paymob
 * @access  Private (Customer/Affiliate/Admin/Manager)
 *
 * Body: { items: [{ productId, quantity, size?, color? }], affiliateCode?,
 *         shippingDetails?: { name, phone, address, city } }
 */
const initiatePaymobPayment = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { items, affiliateCode, shippingDetails } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Order must include at least one item.' });
    }

    if (!PAYMOB_API_KEY || !PAYMOB_INTEGRATION_ID_CARD || !PAYMOB_IFRAME_ID || !PAYMOB_HMAC_SECRET) {
      await session.abortTransaction();
      return res.status(500).json({
        success: false,
        message: 'Paymob is not configured on the server. Missing environment variables.',
      });
    }

    let affiliateProfile = null;
    let affiliateUser = null;

    if (affiliateCode && String(affiliateCode).trim().length > 0) {
      const normalizedCode = String(affiliateCode).trim().toUpperCase();
      affiliateProfile = await AffiliateProfile.findOne({ customCode: normalizedCode }).session(session);
      if (!affiliateProfile) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Invalid affiliate code.' });
      }
      affiliateUser = await User.findById(affiliateProfile.userId).session(session);
      if (!affiliateUser || affiliateUser.role !== 'Affiliate') {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'This affiliate code is no longer active.' });
      }
    }

    let subtotal = 0;
    let totalDiscount = 0;
    let totalAffiliateCommission = 0;
    const orderItems = [];
    const paymobItemLines = [];

    for (let i = 0; i < items.length; i += 1) {
      const requestedItem = items[i] || {};
      const productId = requestedItem.productId;
      const quantity = Number(requestedItem.quantity);

      if (!productId || !mongoose.Types.ObjectId.isValid(productId) || !Number.isFinite(quantity) || quantity < 1) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Item at index ${i} requires a valid productId and a quantity of at least 1.`,
        });
      }

      const product = await Product.findById(productId).session(session);
      if (!product) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: `Product not found: ${productId}` });
      }

      if (product.stock < quantity) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.nameEn}". Available: ${product.stock}, requested: ${quantity}.`,
        });
      }

      product.stock -= quantity;
      await product.save({ session });

      const lineTotal = product.price * quantity;
      subtotal += lineTotal;

      let lineDiscount = 0;
      if (affiliateProfile) {
        lineDiscount = (product.productDiscount || 0) * quantity;
        totalDiscount += lineDiscount;
        totalAffiliateCommission += (product.affiliateCommission || 0) * quantity;
      }

      orderItems.push({
        productId: product._id,
        name: product.nameEn,
        quantity,
        price: product.price,
        size: requestedItem.size || null,
        color: requestedItem.color || null,
      });
      paymobItemLines.push({
        name: product.nameEn,
        amountCents: Math.round((lineTotal - lineDiscount) * 100),
        quantity,
      });
    }

    const totalOrderPrice = subtotal - totalDiscount;

    if (totalOrderPrice <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Order total must be greater than zero.' });
    }

    const amountCents = Math.round(totalOrderPrice * 100);

    const itemsCentsSum = paymobItemLines.reduce((sum, line) => sum + line.amountCents, 0);
    const remainder = amountCents - itemsCentsSum;
    if (remainder !== 0 && paymobItemLines.length > 0) {
      paymobItemLines[paymobItemLines.length - 1].amountCents += remainder;
    }

    const paymobItems = paymobItemLines.map((line) => ({
      name: line.name,
      amount_cents: Math.max(0, line.amountCents),
      description: line.name,
      quantity: line.quantity,
    }));

    const order = await Order.create(
      [
        {
          customerId: req.user._id,
          items: orderItems,
          subtotal,
          affiliateId: affiliateUser ? affiliateUser._id : null,
          totalDiscount,
          totalAffiliateCommission,
          totalOrderPrice,
          status: 'Pending',
          paymentMethod: 'Card',
          paymentStatus: 'Pending',
          // FIX: previously used ONLY for Paymob's billing_data, never
          // actually persisted onto the Order document.
          shippingDetails: {
            name: shippingDetails?.name || null,
            phone: shippingDetails?.phone || null,
            address: shippingDetails?.address || null,
            city: shippingDetails?.city || null,
          },
        },
      ],
      { session }
    );

    if (affiliateProfile && totalAffiliateCommission > 0) {
      affiliateProfile.pendingBalance += totalAffiliateCommission;
      await affiliateProfile.save({ session });
    }

    await session.commitTransaction();

    const createdOrder = order[0];

    try {
      const authToken = await getPaymobAuthToken();

      const paymobOrderId = await registerPaymobOrder(authToken, {
        amountCents,
        merchantOrderId: createdOrder._id.toString(),
        items: paymobItems,
      });

      createdOrder.paymobOrderId = paymobOrderId;
      await createdOrder.save();

      const nameParts = (shippingDetails?.name || '').trim().split(' ');

      const billingData = {
        apartment: 'NA',
        email: req.user.email || 'na@example.com',
        floor: 'NA',
        first_name: nameParts[0] || 'NA',
        street: shippingDetails?.address || 'NA',
        building: 'NA',
        phone_number: shippingDetails?.phone || 'NA',
        shipping_method: 'NA',
        postal_code: 'NA',
        city: shippingDetails?.city || 'Cairo',
        country: 'EG',
        last_name: nameParts.slice(1).join(' ') || 'NA',
        state: shippingDetails?.city || 'Cairo',
      };

      const paymentToken = await getPaymobPaymentKey(authToken, { amountCents, paymobOrderId, billingData });

      const iframeUrl = `${PAYMOB_BASE_URL.replace(/\/api$/, '')}/api/acceptance/iframes/${PAYMOB_IFRAME_ID}?payment_token=${paymentToken}`;

      return res.status(201).json({
        success: true,
        message: 'Payment initiated. Redirect the customer to the iframe URL.',
        orderId: createdOrder._id,
        iframeUrl,
      });
    } catch (paymobError) {
      console.error(`[Paymob] initiation failed for order ${createdOrder._id}:`, paymobError.message);
      return res.status(502).json({
        success: false,
        message: 'Order was created but Paymob payment initiation failed. Please retry payment.',
        orderId: createdOrder._id,
        error: paymobError.message,
      });
    }
  } catch (error) {
    await session.abortTransaction();
    console.error('[initiatePaymobPayment] failed before/around order creation:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while initiating Paymob payment.',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

const PAYMOB_TRANSACTION_HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
  'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
  'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];

const getNestedValue = (obj, path) =>
  path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : ''), obj);

const verifyPaymobHmac = (transactionObj, receivedHmac) => {
  const concatenated = PAYMOB_TRANSACTION_HMAC_FIELDS.map((field) => {
    const value = getNestedValue(transactionObj, field);
    return value === null || value === undefined ? '' : String(value);
  }).join('');
  const computedHmac = crypto.createHmac('sha512', PAYMOB_HMAC_SECRET).update(concatenated).digest('hex');
  return computedHmac === receivedHmac;
};

const paymobWebhook = async (req, res) => {
  try {
    const receivedHmac = req.query.hmac;
    const obj = req.body?.obj;

    if (!receivedHmac || !obj) {
      return res.status(400).json({ success: false, message: 'Missing hmac or transaction payload.' });
    }

    if (!verifyPaymobHmac(obj, receivedHmac)) {
      return res.status(401).json({ success: false, message: 'Invalid HMAC signature.' });
    }

    const merchantOrderId = obj.order?.merchant_order_id;

    if (!merchantOrderId || !mongoose.Types.ObjectId.isValid(merchantOrderId)) {
      return res.status(400).json({ success: false, message: 'Missing or invalid merchant_order_id.' });
    }

    const order = await Order.findById(merchantOrderId);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found for this transaction.' });
    }

    if (order.paymentStatus === 'Paid') {
      return res.status(200).json({ success: true, message: 'Order already marked as Paid.' });
    }

    const isSuccessful = obj.success === true && obj.pending === false && !obj.error_occured;

    order.paymentStatus = isSuccessful ? 'Paid' : 'Failed';
    order.paymobTransactionId = String(obj.id);
    await order.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error while processing Paymob webhook.',
      error: error.message,
    });
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrders,
  updateOrderStatus,
  initiatePaymobPayment,
  paymobWebhook,
};