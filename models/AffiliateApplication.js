const mongoose = require('mongoose');

/**
 * AffiliateApplication Schema
 * Captures a Customer's request to become an Affiliate. A Manager/Admin
 * reviews these and either Approves (which spins up an official
 * AffiliateProfile + promotes the User's role) or Rejects them.
 */
const affiliateApplicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
      required: true,
    },
    paymentAccountNumber: {
      type: String,
      required: [true, 'A payment account number is required'],
      trim: true,
    },
    customCodeRequested: {
      type: String,
      required: [true, 'A requested custom code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      // Mirrors the format constraint on AffiliateProfile.customCode so that
      // whatever gets requested here is guaranteed valid once copied over.
      match: [/^[A-Z0-9]{3,20}$/, 'Custom code must be 3-20 alphanumeric characters'],
    },
    phoneNumber: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    socialMediaLinks: {
      type: [String],
      required: [true, 'At least one social media link is required'],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one social media link is required',
      },
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

module.exports = mongoose.model('AffiliateApplication', affiliateApplicationSchema);
