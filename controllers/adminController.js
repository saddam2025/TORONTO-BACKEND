const sendControllerError = require('../utils/controllerError');
// adminController.js — full file, includes the getAllUsers fix + new getUserById + the getAnalytics fix above
const bcrypt = require('bcryptjs');
const SystemSettings = require('../models/SystemSettings');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AffiliateProfile = require('../models/AffiliateProfile');

const updateSystemSettings = async (req, res) => {
  try {
    const { globalCustomerDiscountRate, globalAffiliateCommissionRate } = req.body;

    if (globalCustomerDiscountRate === undefined && globalAffiliateCommissionRate === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one of globalCustomerDiscountRate or globalAffiliateCommissionRate.',
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
    return sendControllerError(res, error);
  }
};

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
      role: 'Admin',
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
    return sendControllerError(res, error);
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const allowedRoles = ['Manager', 'Admin', 'Affiliate', 'Customer'];

    const filter = {};
    if (role !== undefined) {
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: `role must be one of: ${allowedRoles.join(', ')}.`,
        });
      }
      filter.role = role;
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).lean();

    const affiliateIds = users.filter((u) => u.role === 'Affiliate').map((u) => u._id);

    let profileMap = new Map();
    let salesMap = new Map();

    if (affiliateIds.length > 0) {
      // BUG FIX: AffiliateProfile's field is `userId`, not `user` — the
      // old query here (`{ user: { $in: affiliateIds } }`) never matched
      // anything, so profileMap was always empty and every affiliate's
      // code/sales showed as null/0 regardless of their real data.
      const profiles = await AffiliateProfile.find({ userId: { $in: affiliateIds } });
      profileMap = new Map(profiles.map((p) => [String(p.userId), p]));

      // AffiliateProfile has no totalSales/totalOrders field — that was
      // also never going to work. Real sales come from aggregating Order
      // documents referred by each affiliate.
      const salesAgg = await Order.aggregate([
        { $match: { affiliateId: { $in: affiliateIds } } },
        { $group: { _id: '$affiliateId', totalSales: { $sum: '$totalOrderPrice' }, totalOrders: { $sum: 1 } } },
      ]);
      salesMap = new Map(salesAgg.map((s) => [String(s._id), s]));
    }

    const enrichedUsers = users.map((u) => {
      if (u.role !== 'Affiliate') return u;
      const profile = profileMap.get(String(u._id));
      const sales = salesMap.get(String(u._id));
      return {
        ...u,
        code: profile?.customCode || null,
        totalSales: sales?.totalSales || 0,
        totalOrders: sales?.totalOrders || 0,
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Users fetched successfully.',
      count: enrichedUsers.length,
      users: enrichedUsers,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

/**
 * @desc    Get full profile detail for a single user — used by the
 *          Manager Dashboard's "click a name to view all data" feature.
 *          For Affiliates, also returns their AffiliateProfile (code,
 *          balances, payment method/account) and their referred orders.
 *          For Customers, returns their own order history.
 * @route   GET /api/admin/users/:id
 * @access  Private (Manager/Admin only)
 */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let affiliateProfile = null;
    let orders = [];

    if (user.role === 'Affiliate') {
      affiliateProfile = await AffiliateProfile.findOne({ userId: user._id }).lean();
      orders = await Order.find({ affiliateId: user._id })
        .sort({ createdAt: -1 })
        .select('totalOrderPrice totalAffiliateCommission status createdAt')
        .lean();
    } else if (user.role === 'Customer') {
      orders = await Order.find({ customerId: user._id })
        .sort({ createdAt: -1 })
        .select('totalOrderPrice status createdAt')
        .lean();
    }

    return res.status(200).json({
      success: true,
      user,
      affiliateProfile,
      orders,
      orderCount: orders.length,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be either 'active' or 'suspended'.",
      });
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    if (targetUser.role === 'Manager') {
      return res.status(403).json({
        success: false,
        message: 'Manager accounts cannot be suspended.',
      });
    }

    targetUser.status = status;
    await targetUser.save();

    return res.status(200).json({
      success: true,
      message: `User ${status === 'suspended' ? 'suspended' : 'activated'} successfully.`,
      user: {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
        status: targetUser.status,
      },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

const getAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both startDate and endDate.',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate must be valid dates.',
      });
    }

    const orders = await Order.find({
      createdAt: { $gte: start, $lte: end },
      status: 'Delivered',
    })
      .populate('customerId', 'name email')
      .populate('affiliateId', 'name email')
      .populate('items.productId')
      .sort({ createdAt: -1 });

    const productIds = orders
      .flatMap((order) => order.items.map((item) => item.productId))
      .filter(Boolean)
      .map((p) => (p._id ? p._id : p));

    const products = await Product.find({ _id: { $in: productIds } }).select(
      'baseProfitPerPiece affiliateCommission productDiscount'
    );

    const productMap = new Map(products.map((p) => [String(p._id), p]));

    let totalAffiliateSales = 0;
    let totalNormalSales = 0;
    let affiliateNetProfit = 0;
    let normalNetProfit = 0;

    for (const order of orders) {
      const isAffiliateOrder = !!order.affiliateId;

      if (isAffiliateOrder) {
        totalAffiliateSales += order.totalOrderPrice;
      } else {
        totalNormalSales += order.totalOrderPrice;
      }

      for (const item of order.items) {
        const productRef = item.productId && item.productId._id ? item.productId._id : item.productId;
        const product = productRef ? productMap.get(String(productRef)) : null;

        if (!product) continue;

        const baseProfitPerPiece = product.baseProfitPerPiece || 0;
        const affiliateCommission = product.affiliateCommission || 0;
        const productDiscount = product.productDiscount || 0;

        if (isAffiliateOrder) {
          affiliateNetProfit += (baseProfitPerPiece - affiliateCommission - productDiscount) * item.quantity;
        } else {
          normalNetProfit += baseProfitPerPiece * item.quantity;
        }
      }
    }

    const combinedNetProfit = affiliateNetProfit + normalNetProfit;
    const promotionOrders = orders.filter((order) => order.appliedPromotions?.length).length;
    const totalPromotionDiscount = orders.reduce((sum, order) => sum + Number(order.promotionDiscount || 0), 0);
    const promotionTotals = new Map();
    for (const order of orders) {
      for (const applied of order.appliedPromotions || []) {
        const current = promotionTotals.get(applied.name) || { name: applied.name, uses: 0, discount: 0 };
        current.uses += 1;
        current.discount += Number(applied.discountAmount || 0);
        promotionTotals.set(applied.name, current);
      }
    }
    const topPromotions = [...promotionTotals.values()].sort((a, b) => b.uses - a.uses || b.discount - a.discount).slice(0, 5);

    return res.status(200).json({
      success: true,
      message: 'Analytics fetched successfully.',
      analytics: {
        totalAffiliateSales,
        totalNormalSales,
        affiliateNetProfit,
        normalNetProfit,
        combinedNetProfit,
        promotionOrders,
        totalPromotionDiscount,
        topPromotions,
      },
      orders,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

module.exports = {
  updateSystemSettings,
  createAdmin,
  getAllUsers,
  getUserById,
  updateUserStatus,
  getAnalytics,
};
