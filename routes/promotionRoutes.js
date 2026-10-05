const express = require('express');
const controller = require('../controllers/promotionController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');
const router = express.Router();
const managers = [protect, restrictTo('Manager', 'Admin')];

router.get('/', controller.publicList);
router.get('/manage', ...managers, controller.listManaged);
router.post('/', ...managers, controller.create);
router.put('/:id', ...managers, controller.update);
router.patch('/:id/status', ...managers, controller.setPromotionStatus);
router.delete('/:id', ...managers, controller.deletePromotion);

module.exports = router;
