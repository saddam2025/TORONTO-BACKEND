const mongoose = require('mongoose');
const AffiliateApplication = require('../models/AffiliateApplication');
const AffiliateProfile = require('../models/AffiliateProfile');
const User = require('../models/User');

/**
 * Helper: checks whether a given custom code is already taken.
 * "Taken" means it exists in EITHER:
 *   - the AffiliateProfile collection (already an official, active code), OR
 *   - the AffiliateApplication collection with status 'Pending' or 'Approved'
 *     (a Rejected application's code is considered free again).
 *
 * NOTE on race conditions: this check-then-insert pattern has a narrow race
 * window if two requests for the same code land at the same instant. The
 * unique index on AffiliateApplication.customCodeRequested is the real
 * safety net for that edge case — see the duplicate-key (11000) catch in
 * applyForAffiliate below.
 */
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

/**
 * @desc    Submit an application to become an Affiliate
 * @route   POST /api/affiliates/apply
 * @access  Private (Customer only)
 */
const applyForAffiliate = async (req, res) => {
  try {
    const { customCodeRequested, phoneNumber, socialMediaLinks, preferredPaymentMethod } = req.body;

    if (!customCodeRequested || !phoneNumber || !socialMediaLinks || !preferredPaymentMethod) {
      return res.status(400).json({
        success: false,
        message:
          'Please provide customCodeRequested, phoneNumber, socialMediaLinks, and preferredPaymentMethod.',
      });
    }

    if (!Array.isArray(socialMediaLinks) || socialMediaLinks.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'socialMediaLinks must be a non-empty array of strings.',
      });
    }

    // A Customer should only have one active (Pending) application at a time.
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

    // --- CRITICAL VALIDATION ---
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
      status: 'Pending',
    });

    return res.status(201).json({
      success: true,
      message: 'Affiliate application submitted successfully. Awaiting review.',
      application,
    });
  } catch (error) {
    // Fallback safety net for the narrow race-condition window described above:
    // if two requests for the same code somehow both pass the pre-check,
    // the unique index on customCodeRequested will reject the second insert.
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This coupon code is already taken. Please choose another one.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Server error while submitting affiliate application.',
      error: error.message,
    });
  }
};

/**
 * @desc    View all affiliate applications
 * @route   GET /api/admin/applications
 * @access  Private (Manager/Admin only)
 *
 * Supports an optional ?status= query filter (Pending | Approved | Rejected)
 * so the admin dashboard can pull just the review queue if desired.
 */
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
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching applications.',
      error: error.message,
    });
  }
};

/**
 * @desc    Approve an affiliate application
 * @route   PUT /api/admin/applications/:id/approve
 * @access  Private (Manager/Admin only)
 *
 * On approval:
 *   1. Application status -> 'Approved'
 *   2. The applicant's User.role -> 'Affiliate'
 *   3. An official AffiliateProfile is created, copying over
 *      customCode (from customCodeRequested), phoneNumber, and
 *      preferredPaymentMethod.
 *
 * Wrapped in a transaction so a partial failure (e.g. profile creation
 * fails after the role was already changed) can't leave the system in an
 * inconsistent state.
 */
const approveApplication = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const application = await AffiliateApplication.findById(req.params.id).session(session);

    if (!application) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Affiliate application not found.',
      });
    }

    if (application.status !== 'Pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `This application has already been ${application.status.toLowerCase()}.`,
      });
    }

    // Re-validate the code is still free at the moment of approval — it's
    // possible (though unlikely) that time has passed since application
    // and another profile now holds this code.
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
      return res.status(404).json({
        success: false,
        message: 'The user tied to this application no longer exists.',
      });
    }

    const affiliateProfile = await AffiliateProfile.create(
      [
        {
          userId: application.userId,
          customCode: application.customCodeRequested,
          phoneNumber: application.phoneNumber,
          preferredPaymentMethod: application.preferredPaymentMethod,
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

    return res.status(500).json({
      success: false,
      message: 'Server error while approving application.',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reject an affiliate application
 * @route   PUT /api/admin/applications/:id/reject
 * @access  Private (Manager/Admin only)
 *
 * Not explicitly requested in the spec, but included since 'Rejected' is a
 * defined enum state on the model and an approval flow needs its counterpart
 * to be usable end-to-end. Rejecting frees up the requested code for reuse,
 * since isCustomCodeTaken only blocks on Pending/Approved.
 */
const rejectApplication = async (req, res) => {
  try {
    const application = await AffiliateApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Affiliate application not found.',
      });
    }

    if (application.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `This application has already been ${application.status.toLowerCase()}.`,
      });
    }

    application.status = 'Rejected';
    await application.save();

    return res.status(200).json({
      success: true,
      message: 'Application rejected.',
      application,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error while rejecting application.',
      error: error.message,
    });
  }
};

module.exports = {
  applyForAffiliate,
  getAllApplications,
  approveApplication,
  rejectApplication,
};
