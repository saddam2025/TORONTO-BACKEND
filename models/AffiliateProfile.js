const mongoose = require('mongoose');

/**
 * AffiliateProfile Schema
 * Extends a User of role 'Affiliate' with affiliate-engine-specific data:
 * their unique referral code and their two-stage balance (pending vs withdrawable).
 */
const affiliateProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // One affiliate profile per user
    },
    customCode: {
      type: String,
      required: [true, 'Affiliate custom code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      // User-chosen / admin-defined (e.g. "NADA10", "TOUR15") — never auto-generated.
      // Restricted to alphanumeric so it stays safe to use in URLs and checkout fields.
      match: [/^[A-Z0-9]{3,20}$/, 'Custom code must be 3-20 alphanumeric characters'],
    },
    pendingBalance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      // Commission sitting here until the related order is Delivered
      // (or otherwise qualifies per business rules) before being moved
      // to withdrawableBalance.
    },
    withdrawableBalance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      // Commission that has cleared and can be paid out to the affiliate.
    },
    // --- Fields below are not in the original UML; added in Phase 3 because
    // the Application & Approval flow copies them from AffiliateApplication
    // onto the official profile once approved, so payouts have somewhere to go.
    phoneNumber: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    preferredPaymentMethod: {
      type: String,
      enum: ['Vodafone Cash', 'InstaPay', 'Bank Transfer'],
      required: [true, 'Preferred payment method is required'],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('AffiliateProfile', affiliateProfileSchema);
