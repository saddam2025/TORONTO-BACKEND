const express = require('express');
const { register, login } = require('../controllers/authController');

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user (auto-promoted to Manager if email matches MANAGER_EMAIL)
// @access  Public
router.post('/register', register);

// @route   POST /api/auth/login
// @desc    Authenticate user and return JWT
// @access  Public
router.post('/login', login);

module.exports = router;
