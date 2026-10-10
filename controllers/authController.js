const sendControllerError = require('../utils/controllerError');
// authController.js
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 *
 * Crucial Logic:
 * If the submitted email matches process.env.MANAGER_EMAIL, the account
 * is automatically created with the 'Manager' role. This is how the
 * platform's first/root admin account gets bootstrapped without needing
 * a manual DB write. Every other registration defaults to 'Customer' —
 * 'Admin' and 'Affiliate' accounts must be provisioned/promoted by a
 * Manager via separate, protected endpoints (Phase 3), not through
 * public self-registration.
 */
const register = async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide full name, email, and password.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists.",
      });
    }

    const isManagerEmail =
      process.env.MANAGER_EMAIL &&
      normalizedEmail === process.env.MANAGER_EMAIL.toLowerCase().trim();

    const role = isManagerEmail ? "Manager" : "Customer";

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name: fullName,
      email: normalizedEmail,
      password: hashedPassword,
      role,
    });

    const token = generateToken(user._id, user.role);

    // FIX: return `name` (matching the User schema field and what the
    // frontend's Navbar/UserProfile read via user?.name) instead of
    // `fullName`, and include `id` so the user object is consistent
    // with what login() returns.
    return res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};
/**
 * @desc    Authenticate a user and return a JWT
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // password has `select: false` in the schema, so it must be explicitly
    // requested here in order to compare it.
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'This account is suspended. Contact support for assistance.' });
    }

    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const token = generateToken(user._id, user.role);

    // FIX: return `id` and `name` (was missing `id`, and used `fullName`
    // instead of `name`) so the stored user object matches what register()
    // returns and what the Navbar/UserProfile components read.
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};
// authController.js — add this function, keep register/login as-is
/**
 * @desc    Get the currently authenticated user's fresh data (name, email,
 *          role, status) directly from the database.
 * @route   GET /api/auth/me
 * @access  Private
 *
 * Added so the frontend can re-sync a user's role after it changes
 * server-side (e.g. Customer -> Affiliate on approval) without requiring
 * them to log out and back in — the JWT itself only encodes userId, but
 * the locally cached `user` object in AuthContext was never refreshed
 * after login, so a promoted user's UI kept treating them as their old role.
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        shippingInfo: user.shippingInfo ? {
          name: user.shippingInfo.name,
          phone: user.shippingInfo.phone,
          address: user.shippingInfo.address,
          city: user.shippingInfo.city,
        } : null,
      },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

module.exports = { register, login, getMe };
