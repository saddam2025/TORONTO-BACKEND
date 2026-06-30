// productRoutes.js
const express = require('express');
const productController = require('../controllers/productController');
const upload = require('../middlewares/upload');
const { protect, restrictTo } = require('../middlewares/authMiddleware'); // اعدل اسم الميدل وير حسب مشروعك

const router = express.Router();

// أي حد يقدر يشوف المنتجات
router.get('/', productController.getProducts);

// أي حد يقدر يشوف منتج واحد بالتفصيل
router.get('/:id', productController.getProduct);

// إضافة منتج جديد — متاح للـ Manager والـ Admin (الاتنين)
// يدعم رفع حتى 15 صورة في الحقل "images"
router.post(
  '/',
  protect,
  restrictTo('Manager', 'Admin'),
  upload.array('images', 15),
  productController.createProduct
);

// تعديل منتج — متاح للـ Manager والـ Admin (الاتنين)
// يدعم رفع صور جديدة (اختياري) في الحقل "images"
router.put(
  '/:id',
  protect,
  restrictTo('Manager', 'Admin'),
  upload.array('images', 15),
  productController.updateProduct
);

// حذف منتج — متاح للـ Manager والـ Admin (الاتنين)
router.delete(
  '/:id',
  protect,
  restrictTo('Manager', 'Admin'),
  productController.deleteProduct
);

module.exports = router;