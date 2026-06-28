const mongoose = require('mongoose');

/**
 * SystemSettings Schema
 * A singleton-style collection holding global, platform-wide configuration
 * controlled by the Manager/Admin roles. In practice, only one document
 * should exist in this collection at any time.
 */
const systemSettingsSchema = new mongoose.Schema(
  {
    globalCustomerDiscountRate: {
      type: Number,
      required: true,
      default: 0, // e.g., 0.05 = 5% default discount for customers using an affiliate code
      min: 0,
      max: 1,
    },
    globalAffiliateCommissionRate: {
      type: Number,
      required: true,
      default: 0, // e.g., 0.10 = 10% default commission for affiliates
      min: 0,
      max: 1,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
