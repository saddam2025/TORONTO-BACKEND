const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * protect
 * ---------------------------------------------------------------------
 * Verifies the JWT sent in the Authorization header ("Bearer <token>"),
 * decodes it, and attaches the corresponding user document to req.user.
 * Rejects the request with 401 if the token is missing, malformed,
 * expired, or refers to a user that no longer exists.
 */
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. No token provided.',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch the user fresh from the DB (password excluded by schema default)
    // so we always act on current data (e.g. if role was changed after the
    // token was issued, or the account was deleted).
    const currentUser = await User.findById(decoded.id);

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. User belonging to this token no longer exists.',
      });
    }

    if (currentUser.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'This account is suspended. Contact support for assistance.',
      });
    }

    req.user = currentUser;
    next();
  } catch (error) {
    let message = 'Not authorized. Token verification failed.';
    if (error.name === 'TokenExpiredError') {
      message = 'Not authorized. Token has expired.';
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Not authorized. Invalid token.';
    }

    return res.status(401).json({ success: false, message });
  }
};

/**
 * restrictTo
 * ---------------------------------------------------------------------
 * Factory that returns a middleware enforcing hierarchical RBAC.
 * Usage: router.delete('/products/:id', protect, restrictTo('Manager', 'Admin'), ...)
 *
 * Must run AFTER `protect`, since it relies on req.user being populated.
 *
 * @param  {...string} roles - roles permitted to access the route
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. No authenticated user found on request.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' is not permitted to perform this action.`,
      });
    }

    next();
  };
};

module.exports = { protect, restrictTo };
