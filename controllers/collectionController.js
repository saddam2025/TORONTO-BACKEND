// collectionController.js
const fs = require('fs');
const path = require('path');
const Collection = require('../models/Collection');

// Parses a field that the frontend sent as a JSON string inside multipart
// form-data. Falls back to the given default if the field is missing or isn't valid.
function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return value;
  } catch {
    return fallback;
  }
}

// 1. جلب جميع المجموعات
exports.getCollections = async (req, res) => {
  try {
    const collections = await Collection.find()
      .populate('products')
      .sort({ createdAt: -1 });
      
    res.status(200).json({
      status: 'success',
      results: collections.length,
      data: { collections },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// 2. إنشاء مجموعة جديدة (Owner/Manager AND Admin)
// Expects multipart/form-data: nameEn, nameAr, description, products
// as text fields, plus a single `image` file field for the banner image.
exports.createCollection = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'Collection image is required.',
      });
    }

    const { nameEn, nameAr, description } = req.body;
    
    // Parse the products array from form-data
    let products = parseJsonField(req.body.products, []);
    if (!Array.isArray(products)) {
      products = typeof products === 'string' ? [products] : [];
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    const newCollection = await Collection.create({
      nameEn,
      nameAr,
      description,
      imageUrl,
      products,
    });

    res.status(201).json({
      status: 'success',
      data: { collection: newCollection },
    });
  } catch (error) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    res.status(400).json({
      status: 'error',
      message: error.message,
    });
  }
};

// 3. حذف مجموعة (Owner/Manager AND Admin)
exports.deleteCollection = async (req, res) => {
  try {
    const collection = await Collection.findByIdAndDelete(req.params.id);

    if (!collection) {
      return res.status(404).json({
        status: 'error',
        message: 'Collection not found.',
      });
    }

    if (collection.imageUrl && collection.imageUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', collection.imageUrl);
      fs.unlink(filePath, () => {});
    }

    res.status(200).json({
      status: 'success',
      message: 'Collection deleted.',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};