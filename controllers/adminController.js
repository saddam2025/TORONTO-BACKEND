const bcrypt = require('bcryptjs');
const SystemSettings = require('../models/SystemSettings');
const User = require('../models/User');

/**
 * @desc    Update global platform rates (customer discount % / affiliate commission %)
 * @route   PUT /api/admin/settings
 * @access  Private (Manager ONLY — not Admin)
 *
 * These two rates drive every future checkout calculation in
 * orderController.createOrder, so only the Manager (the highest tier)
 * is allowed to touch them — an Admin should be able to manage day-to-day
 * operations (orders, applications) but not the platform's core economics.
 *
 * Uses findOneAndUpdate with upsert so this also works correctly the very
 * first time it's called (no SystemSettings document exists yet).
 */
const updateSystemSettings = async (req, res) => {
  try {
    const { globalCustomerDiscountRate, globalAffiliateCommissionRate } = req.body;

    if (globalCustomerDiscountRate === undefined && globalAffiliateCommissionRate === undefined) {
      return res.status(400).json({
        success: false,
        message:
          'Provide at least one of globalCustomerDiscountRate or globalAffiliateCommissionRate.',
      });
    }

    const updates = {};

    if (globalCustomerDiscountRate !== undefined) {
      if (
        typeof globalCustomerDiscountRate !== 'number' ||
        globalCustomerDiscountRate < 0 ||
        globalCustomerDiscountRate > 1
      ) {
        return res.status(400).json({
          success: false,
          message: 'globalCustomerDiscountRate must be a number between 0 and 1.',
        });
      }
      updates.globalCustomerDiscountRate = globalCustomerDiscountRate;
    }

    if (globalAffiliateCommissionRate !== undefined) {
      if (
        typeof globalAffiliateCommissionRate !== 'number' ||
        globalAffiliateCommissionRate < 0 ||
        globalAffiliateCommissionRate > 1
      ) {
        return res.status(400).json({
          success: false,
          message: 'globalAffiliateCommissionRate must be a number between 0 and 1.',
        });
      }
      updates.globalAffiliateCommissionRate = globalAffiliateCommissionRate;
    }

    // upsert: true ensures this works even on a brand-new database where
    // no SystemSettings document has been created yet.
    const settings = await SystemSettings.findOneAndUpdate(
      {},
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'System settings updated successfully.',
      settings,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error while updating system settings.',
      error: error.message,
    });
  }
};

/**
 * @desc    Manually create a new user with the 'Admin' role
 * @route   POST /api/admin/create-admin
 * @access  Private (Manager ONLY)
 *
 * This is the only path by which an Admin account can come into existence —
 * there is no public self-registration into 'Admin' (see authController.register,
 * which only ever yields 'Customer' or, for the MANAGER_EMAIL match, 'Manager').
 * The role is hardcoded to 'Admin' here regardless of anything in the request
 * body, so this endpoint can never be tricked into creating a different role.
 */
const createAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const adminUser = await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: 'Admin', // hardcoded — never taken from req.body
    });

    return res.status(201).json({
      success: true,
      message: 'Admin account created successfully.',
      user: {
        id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error while creating admin account.',
      error: error.message,
    });
  }
};

module.exports = { updateSystemSettings, createAdmin };
