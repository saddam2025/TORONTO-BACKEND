const mongoose = require('mongoose');

const tierSchema = new mongoose.Schema({
  minQty: { type: Number, required: true, min: 1, validate: Number.isInteger },
  getQty: { type: Number, min: 1, validate: Number.isInteger },
  percent: { type: Number, min: 1, max: 100 },
  fixedPrice: { type: Number, min: 0 },
}, { _id: false });

const promotionSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  type: { type: String, required: true, enum: ['BUY_X_GET_Y_FREE', 'QUANTITY_PERCENT_DISCOUNT', 'QUANTITY_FIXED_DISCOUNT'] },
  tiers: { type: [tierSchema], required: true, validate: (tiers) => tiers.length > 0 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  stackable: { type: Boolean, default: false },
  priority: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

promotionSchema.index({ product: 1, isActive: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('Promotion', promotionSchema);
