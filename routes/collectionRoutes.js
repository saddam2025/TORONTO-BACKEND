// collectionRoutes.js
const express = require('express');
const collectionController = require('../controllers/collectionController');
const upload = require('../middleware/upload');
const { protect, restrictTo } = require('../middlewares/authMiddleware'); // اعدل اسم الميدل وير حسب مشروعك

const router = express.Router();

// أي حد يقدر يشوف المجموعات
router.get('/', collectionController.getCollections);

// إنشاء مجموعة جديدة — متاح للـ Manager والـ Admin (الاتنين)
router.post(
  '/',
  protect,
  restrictTo('Manager', 'Admin'),
  upload.single('image'),
  collectionController.createCollection
);

// حذف مجموعة — متاح للـ Manager والـ Admin (الاتنين)
router.delete(
  '/:id',
  protect,
  restrictTo('Manager', 'Admin'),
  collectionController.deleteCollection
);

module.exports = router;