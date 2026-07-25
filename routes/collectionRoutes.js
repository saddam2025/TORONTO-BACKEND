// collectionRoutes.js
const express = require('express');
const collectionController = require('../controllers/collectionController');
const upload = require('../middlewares/upload');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/', collectionController.getCollections);

router.get('/:id', collectionController.getCollection);

router.post(
  '/',
  protect,
  restrictTo('Manager', 'Admin'),
  upload.single('image'),
  collectionController.createCollection
);

router.put(
  '/:id',
  protect,
  restrictTo('Manager', 'Admin'),
  upload.single('image'),
  collectionController.updateCollection
);

router.delete(
  '/:id',
  protect,
  restrictTo('Manager', 'Admin'),
  collectionController.deleteCollection
);

module.exports = router;