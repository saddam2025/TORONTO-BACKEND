const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AffiliateProfile = require('../models/AffiliateProfile');
const User = require('../models/User');
const SystemSettings = require('../models/SystemSettings');

/**
 * @desc    Create a new order (Affiliate Engine checkout)
 * @route   POST /api/orders
 * @access  Private (Customer only)
 *
 * Expected request body:
 * {
 *   "items": [ { "productId": "...", "quantity": 2 }, ... ],
 *   "affiliateCode": "NADA10"   // optional
 * }
 *
 * Pricing logic (per spec):
 *   appliedDiscountAmount      = subtotal * globalCustomerDiscountRate
 *   finalTotal                 = subtotal - appliedDiscountAmount
 *   calculatedCommissionAmount = finalTotal * globalAffiliateCommissionRate
 *
 * If no valid affiliateCode is supplied, discount and commission are both 0
 * and finalTotal === subtotal.
 *
 * Wrapped in a transaction: stock decrements, order creation, and the
 * affiliate's pendingBalance increment must all succeed together or not
 * at all — otherwise you could end up overselling stock or crediting a
 * commission for an order that never actually got created.
 */
const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { items, affiliateCode } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Order must include at least one item.',
      });
    }

    // ---------------------------------------------------------------
    // 1. Resolve products, validate stock, and build a price snapshot.
    //    We NEVER trust client-submitted prices — always re-fetch from
    //    the Product collection so a tampered request can't undercharge.
    // ---------------------------------------------------------------
    let subtotal = 0;
    const orderItems = [];

    for (const requestedItem of items) {
      const { productId, quantity } = requestedItem;

      if (!productId || !quantity || quantity < 1) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Each item requires a valid productId and a quantity of at least 1.',
        });
      }

      const product = await Product.findById(productId).session(session);

      if (!product) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: `Product not found: ${productId}`,
        });
      }

      if (product.stock < quantity) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${quantity}.`,
        });
      }

      // Decrement stock now, inside the transaction.
      product.stock -= quantity;
      await product.save({ session });

      const lineTotal = product.price * quantity;
      subtotal += lineTotal;

      orderItems.push({
        productId: product._id,
        name: product.name,
        quantity,
        price: product.price,
      });
    }

    // ---------------------------------------------------------------
    // 2. Resolve the affiliate (if a code was provided) and confirm
    //    they are a valid, ACTIVE affiliate — meaning their profile
    //    exists AND their linked User still holds the 'Affiliate' role
    //    (in case they were ever demoted after the profile was created).
    // ---------------------------------------------------------------
    let affiliateProfile = null;

    if (affiliateCode && affiliateCode.trim().length > 0) {
      const normalizedCode = affiliateCode.trim().toUpperCase();

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

      const affiliateUser = await User.findById(affiliateProfile.userId).session(session);

      if (!affiliateUser || affiliateUser.role !== 'Affiliate') {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'This affiliate code is no longer active.',
        });
      }
    }

    // ---------------------------------------------------------------
    // 3. Pull global rates and compute the financial breakdown.
    //    Only apply discount/commission if a valid affiliate was resolved.
    // ---------------------------------------------------------------
    const settings = await SystemSettings.findOne().session(session);

    // If no SystemSettings document exists yet, fall back to 0 for both
    // rates rather than crashing the checkout flow.
    const globalCustomerDiscountRate = settings?.globalCustomerDiscountRate || 0;
    const globalAffiliateCommissionRate = settings?.globalAffiliateCommissionRate || 0;

    let appliedDiscountAmount = 0;
    let calculatedCommissionAmount = 0;

    if (affiliateProfile) {
      appliedDiscountAmount = subtotal * globalCustomerDiscountRate;
    }

    const finalTotal = subtotal - appliedDiscountAmount;

    if (affiliateProfile) {
      calculatedCommissionAmount = finalTotal * globalAffiliateCommissionRate;
    }

    // ---------------------------------------------------------------
    // 4. Create the order.
    // ---------------------------------------------------------------
    const order = await Order.create(
      [
        {
          customerId: req.user._id,
          items: orderItems,
          subtotal,
          affiliateCodeUsed: affiliateProfile ? affiliateProfile.customCode : null,
          appliedDiscountAmount,
          calculatedCommissionAmount,
          finalTotal,
          status: 'Pending',
        },
      ],
      { session }
    );

    // ---------------------------------------------------------------
    // 5. Credit the affiliate's pendingBalance, if applicable.
    //    Commission stays "pending" until the order is later marked
    //    Delivered (handled by a separate order-status-update flow).
    // ---------------------------------------------------------------
    if (affiliateProfile && calculatedCommissionAmount > 0) {
      affiliateProfile.pendingBalance += calculatedCommissionAmount;
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

/**
 * @desc    Update an order's status (Pending -> Shipped -> Delivered)
 * @route   PUT /api/orders/:id/status
 * @access  Private (Admin/Manager only)
 *
 * CRITICAL FINANCIAL & WALLET LOGIC:
 * When (and only when) the status transitions from something other than
 * 'Delivered' INTO 'Delivered':
 *   1. Locate the order and read its calculatedCommissionAmount.
 *   2. Locate the AffiliateProfile tied to order.affiliateCodeUsed.
 *   3. Move the commission: pendingBalance -= amount, withdrawableBalance += amount.
 *
 * Idempotency guard: the wallet transfer only fires if order.status was NOT
 * already 'Delivered' at the time of this call. This means calling this
 * endpoint again with status='Delivered' on an already-Delivered order is a
 * harmless no-op for the wallet (status set to the same value, no double
 * payout) — protecting against double-crediting from retries, double-clicks,
 * or duplicate webhook calls.
 *
 * Wrapped in a transaction so the order's status change and the affiliate's
 * balance transfer either both happen or neither does.
 */
const updateOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { status } = req.body;
    const allowedStatuses = ['Pending', 'Shipped', 'Delivered'];

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
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    const isNewlyDelivered = order.status !== 'Delivered' && status === 'Delivered';
    const previousStatus = order.status;

    order.status = status;
    await order.save({ session });

    let walletTransfer = null;

    if (isNewlyDelivered && order.affiliateCodeUsed && order.calculatedCommissionAmount > 0) {
      const affiliateProfile = await AffiliateProfile.findOne({
        customCode: order.affiliateCodeUsed,
      }).session(session);

      // If the affiliate profile is somehow gone (edge case — e.g. manually
      // removed from the DB), we don't want to crash the whole status
      // update. The order still transitions to Delivered; we just skip
      // the wallet movement and surface that in the response.
      if (affiliateProfile) {
        const commission = order.calculatedCommissionAmount;

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
      walletTransfer, // null unless this call just triggered a Delivered payout
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

module.exports = { createOrder, updateOrderStatus };
