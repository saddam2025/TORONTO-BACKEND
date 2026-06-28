const mongoose = require('mongoose');

/**
 * User Schema
 * Represents every actor in the system. The 'role' field drives the
 * hierarchical RBAC system: Manager > Admin > Affiliate > Customer.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false, // Never return password by default on queries
    },
    role: {
      type: String,
      enum: ['Manager', 'Admin', 'Affiliate', 'Customer'],
      default: 'Customer',
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

module.exports = mongoose.model('User', userSchema);
