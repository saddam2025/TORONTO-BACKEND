const mongoose = require('mongoose');

/**
 * Order Item Sub-Schema
 * Embedded document capturing a snapshot of each purchased product
 * at the time of order (price is captured here, not just referenced,
 * so historical orders remain accurate even if Product.price changes later).
 */
const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    name: {
      type: String,
      required: true, // snapshot of product name at purchase time
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true, // snapshot of unit price at purchase time
      min: 0,
    },
  },
  { _id: false }
);

/**
 * Order Schema
 * Represents a customer purchase, including the financial breakdown
 * produced by the Affiliate Engine (discount applied + commission generated).
 */
const orderSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Order must contain at least one item',
      },
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
      // Sum of (item.price * item.quantity) before any discount
    },
    affiliateCodeUsed: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      // The AffiliateProfile.customCode applied to this order, if any
    },
    appliedDiscountAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      // Amount deducted from subtotal due to globalCustomerDiscountRate
    },
    calculatedCommissionAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      // Commission owed to the affiliate, based on globalAffiliateCommissionRate
    },
    finalTotal: {
      type: Number,
      required: true,
      min: 0,
      // subtotal - appliedDiscountAmount (the actual amount charged to the customer)
    },
    status: {
      type: String,
      enum: ['Pending', 'Shipped', 'Delivered'],
      default: 'Pending',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Order', orderSchema);
