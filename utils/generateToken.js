const jwt = require('jsonwebtoken');

/**
 * Signs a JWT containing the user's ID and role.
 * The role is embedded directly in the token so downstream middleware
 * (restrictTo) can authorize requests without an extra DB lookup.
 *
 * @param {string} id - MongoDB ObjectId of the user (as string)
 * @param {string} role - One of 'Manager' | 'Admin' | 'Affiliate' | 'Customer'
 * @returns {string} signed JWT
 */
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

module.exports = generateToken;
