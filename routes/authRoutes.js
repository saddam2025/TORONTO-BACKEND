// authRoutes.js
const express = require('express');
const { register, login, getMe } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);

// @route   GET /api/auth/me
// @desc    Fetch the current user's up-to-date profile (fixes stale role
//          after a promotion like Customer -> Affiliate)
// @access  Private
router.get('/me', protect, getMe);

module.exports = router;