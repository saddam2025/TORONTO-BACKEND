const sendControllerError = require('../utils/controllerError');
// backend/controllers/affiliateController.js
const mongoose = require('mongoose');
const AffiliateApplication = require('../models/AffiliateApplication');
const AffiliateProfile = require('../models/AffiliateProfile');
const Order = require('../models/Order');
const User = require('../models/User');

const isCustomCodeTaken = async (code) => {
  const normalizedCode = code.trim().toUpperCase();
  const [existingProfile, existingApplication] = await Promise.all([
    AffiliateProfile.findOne({ customCode: normalizedCode }),
    AffiliateApplication.findOne({
      customCodeRequested: normalizedCode,
      status: { $in: ['Pending', 'Approved'] },
    }),
  ]);
  return Boolean(existingProfile || existingApplication);
};

const applyForAffiliate = async (req, res) => {
    console.log("### RUNNING LATEST applyForAffiliate — build check ###");
  try {
    const {
      customCodeRequested,
      phoneNumber,
      socialMediaLinks,
      preferredPaymentMethod,
      paymentAccountNumber,
    } = req.body;

    if (
      !customCodeRequested ||
      !phoneNumber ||
      !socialMediaLinks ||
      !preferredPaymentMethod ||
      !paymentAccountNumber
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Please provide customCodeRequested, phoneNumber, socialMediaLinks, preferredPaymentMethod, and paymentAccountNumber.',
      });
    }

    if (!Array.isArray(socialMediaLinks) || socialMediaLinks.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'socialMediaLinks must be a non-empty array of strings.',
      });
    }

    const existingPendingApplication = await AffiliateApplication.findOne({
      userId: req.user._id,
      status: 'Pending',
    });

    if (existingPendingApplication) {
      return res.status(409).json({
        success: false,
        message: 'You already have a pending affiliate application.',
      });
    }
  

    const taken = await isCustomCodeTaken(customCodeRequested);
    if (taken) {
      return res.status(400).json({
        success: false,
        message: 'This coupon code is already taken. Please choose another one.',
      });
    }

    const application = await AffiliateApplication.create({
      userId: req.user._id,
      customCodeRequested: customCodeRequested.trim().toUpperCase(),
      phoneNumber,
      socialMediaLinks,
      preferredPaymentMethod,
      paymentAccountNumber: String(paymentAccountNumber).trim(),
      status: 'Pending',
    });

    return res.status(201).json({
      success: true,
      message: 'Affiliate application submitted successfully. Awaiting review.',
      application,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This coupon code is already taken. Please choose another one.',
      });
    }
    return sendControllerError(res, error);
  }
};

const getAllApplications = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    const applications = await AffiliateApplication.find(filter)
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: applications.length,
      applications,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// affiliateController.js — only approveApplication changed, rest of file stays the same
const approveApplication = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const application = await AffiliateApplication.findById(req.params.id).session(session);

    if (!application) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Affiliate application not found.' });
    }

    if (application.status !== 'Pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `This application has already been ${application.status.toLowerCase()}.`,
      });
    }

    // FIX: applications submitted before paymentAccountNumber existed on
    // the form don't have it saved. Approving them used to crash with a
    // raw Mongoose validation error from AffiliateProfile.create() deep
    // inside the transaction. Catch it explicitly here instead, with a
    // message that tells the manager exactly what to do.
    if (!application.paymentAccountNumber) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          'This application was submitted before payment account details were required and is missing a payment account number. Please reject it and ask the applicant to submit a new application.',
      });
    }

    const stillTaken = await AffiliateProfile.findOne({
      customCode: application.customCodeRequested,
    }).session(session);

    if (stillTaken) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'This coupon code is already taken. Please choose another one.',
      });
    }

    application.status = 'Approved';
    await application.save({ session });

    const updatedUser = await User.findByIdAndUpdate(
      application.userId,
      { role: 'Affiliate' },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'The user tied to this application no longer exists.' });
    }

    const affiliateProfile = await AffiliateProfile.create(
      [
        {
          userId: application.userId,
          customCode: application.customCodeRequested,
          phoneNumber: application.phoneNumber,
          preferredPaymentMethod: application.preferredPaymentMethod,
          paymentAccountNumber: application.paymentAccountNumber,
          pendingBalance: 0,
          withdrawableBalance: 0,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'Application approved. User promoted to Affiliate.',
      application,
      affiliateProfile: affiliateProfile[0],
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This coupon code is already taken. Please choose another one.',
      });
    }
    return sendControllerError(res, error);
  } finally {
    session.endSession();
  }
};
const rejectApplication = async (req, res) => {
  try {
    const application = await AffiliateApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Affiliate application not found.' });
    }
    if (application.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `This application has already been ${application.status.toLowerCase()}.`,
      });
    }
    application.status = 'Rejected';
    await application.save();
    return res.status(200).json({ success: true, message: 'Application rejected.', application });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

const getAffiliateDashboard = async (req, res) => {
  try {
    const affiliateProfile = await AffiliateProfile.findOne({ userId: req.user._id });
    if (!affiliateProfile) {
      return res.status(404).json({ success: false, message: 'No affiliate profile found for this account.' });
    }

    const affiliateObjectId = new mongoose.Types.ObjectId(req.user._id);
    const orders = await Order.find({ affiliateId: affiliateObjectId }).sort({ createdAt: -1 });

    const totalSales = orders.reduce((sum, order) => sum + order.totalOrderPrice, 0);
    const totalOrders = orders.length;

    const recentOrders = orders.slice(0, 10).map((order) => ({
      orderId: order._id,
      date: order.createdAt,
      orderValue: order.totalOrderPrice,
      commission: order.totalAffiliateCommission,
      status: order.status,
    }));

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyAgg = await Order.aggregate([
      { $match: { affiliateId: affiliateObjectId, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          sales: { $sum: '$totalOrderPrice' },
          commission: { $sum: '$totalAffiliateCommission' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthLabels = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      monthLabels.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const monthlySales = monthLabels.map(({ year, month }) => {
      const found = monthlyAgg.find((m) => m._id.year === year && m._id.month === month);
      return { year, month, sales: found ? found.sales : 0, commission: found ? found.commission : 0 };
    });

    return res.status(200).json({
      success: true,
      profile: {
        code: affiliateProfile.customCode,
        phoneNumber: affiliateProfile.phoneNumber,
        preferredPaymentMethod: affiliateProfile.preferredPaymentMethod,
        paymentAccountNumber: affiliateProfile.paymentAccountNumber,
      },
      totalSales,
      totalOrders,
      pendingEarnings: affiliateProfile.pendingBalance,
      withdrawableBalance: affiliateProfile.withdrawableBalance,
      recentOrders,
      monthlySales,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

/**
 * @desc    Get a ledger row per affiliate: name, code, order count, top
 *          product, current withdrawable (payable) commission, and
 *          whether a payout is owed.
 * @route   GET /api/affiliates/ledger
 * @access  Private (Manager/Admin only)
 *
 * Replaces the hardcoded mock array previously used in
 * AffiliateLedgerTab.jsx.
 */
const getAffiliateLedger = async (req, res) => {
  try {
    const profiles = await AffiliateProfile.find({}).populate('userId', 'name email');

    const ledger = await Promise.all(
      profiles.map(async (profile) => {
        const orders = await Order.find({ affiliateId: profile.userId._id }).select('items totalOrderPrice');

        const productCounts = {};
        orders.forEach((order) => {
          (order.items || []).forEach((item) => {
            productCounts[item.name] = (productCounts[item.name] || 0) + item.quantity;
          });
        });

        let topProduct = null;
        let topCount = 0;
        Object.entries(productCounts).forEach(([name, qty]) => {
          if (qty > topCount) {
            topProduct = name;
            topCount = qty;
          }
        });

        return {
          id: profile._id,
          userId: profile.userId._id,
          name: profile.userId.name,
          email: profile.userId.email,
          code: profile.customCode,
          totalOrders: orders.length,
          topProduct: topProduct || null,
          // pendingCommission here means "payable now" — withdrawableBalance
          // is commission that already cleared (order Delivered), as
          // distinct from pendingBalance which is still awaiting delivery.
          pendingCommission: profile.withdrawableBalance,
          status: profile.withdrawableBalance > 0 ? 'pending' : 'paid',
        };
      })
    );

    return res.status(200).json({ success: true, ledger });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

/**
 * @desc    Mark an affiliate's current withdrawable balance as paid out
 *          (manager has sent the money manually via wallet/bank transfer).
 * @route   PUT /api/affiliates/:profileId/confirm-payout
 * @access  Private (Manager/Admin only)
 */
const confirmAffiliatePayout = async (req, res) => {
  try {
    const profile = await AffiliateProfile.findById(req.params.profileId);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Affiliate profile not found.' });
    }

    const paidAmount = profile.withdrawableBalance;
    profile.withdrawableBalance = 0;
    await profile.save();

    return res.status(200).json({
      success: true,
      message: 'Payout confirmed.',
      paidAmount,
      profile,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

module.exports = {
  applyForAffiliate,
  getAllApplications,
  approveApplication,
  rejectApplication,
  getAffiliateDashboard,
  getAffiliateLedger,
  confirmAffiliatePayout,
};