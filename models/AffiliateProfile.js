// backend/models/AffiliateProfile.js
const mongoose = require('mongoose');

const affiliateProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    customCode: {
      type: String,
      required: [true, 'Affiliate custom code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9]{3,20}$/, 'Custom code must be 3-20 alphanumeric characters'],
    },
    pendingBalance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    withdrawableBalance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
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
    // The actual wallet/InstaPay/bank number payouts get sent to. Copied
    // from AffiliateApplication.paymentAccountNumber on approval — without
    // this, there was no field anywhere to store where the money goes.
    paymentAccountNumber: {
      type: String,
      required: [true, 'A payment account number is required'],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('AffiliateProfile', affiliateProfileSchema);