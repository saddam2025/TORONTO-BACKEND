// Collection.js
const mongoose = require('mongoose');

/**
 * Collection Schema
 * Represents a seasonal/thematic grouping of products (e.g. "Autumn 2026"),
 * managed by Owner/Manager and Admin roles from the dashboard.
 */
const collectionSchema = new mongoose.Schema(
  {
    nameEn: {
      type: String,
      required: [true, 'English name is required'],
      trim: true,
    },
    nameAr: {
      type: String,
      required: [true, 'Arabic name is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    imageUrl: {
      type: String,
      required: [true, 'Collection image is required'],
      trim: true,
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Collection', collectionSchema);