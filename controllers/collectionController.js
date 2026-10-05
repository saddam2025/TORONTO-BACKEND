const sendControllerError = require('../utils/controllerError');
// collectionController.js
const fs = require('fs');
const path = require('path');
const Collection = require('../models/Collection');
const Product = require('../models/Product');

const normalizeProducts = async (products) => {
  const ids = [...new Set(products.map((id) => String(id)))];
  const validIds = await Product.find({ _id: { $in: ids } }).distinct('_id');
  if (validIds.length !== ids.length) {
    const error = new Error('One or more selected products no longer exist.');
    error.name = 'ValidationError';
    error.publicMessage = error.message;
    throw error;
  }
  return validIds;
};

const removeMissingPopulatedProducts = (collection) => {
  collection.products = collection.products.filter(Boolean);
  return collection;
};

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
    collections.forEach(removeMissingPopulatedProducts);

    res.status(200).json({
      status: 'success',
      results: collections.length,
      data: { collections },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// 2. جلب مجموعة واحدة بالـ id
exports.getCollection = async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id).populate('products');

    if (!collection) {
      return res.status(404).json({
        status: 'error',
        message: 'Collection not found.',
      });
    }

    removeMissingPopulatedProducts(collection);

    res.status(200).json({
      status: 'success',
      data: { collection },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// 3. إنشاء مجموعة جديدة (Owner/Manager AND Admin)
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
    products = await normalizeProducts(products);

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
    return sendControllerError(res, error);
  }
};

// 4. تعديل مجموعة (Owner/Manager AND Admin)
// Expects multipart/form-data: nameEn, nameAr, description, products
// as text fields, plus an optional `image` file field to replace the banner.
exports.updateCollection = async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id);

    if (!collection) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({
        status: 'error',
        message: 'Collection not found.',
      });
    }

    const { nameEn, nameAr, description } = req.body;

    if (nameEn !== undefined) collection.nameEn = nameEn;
    if (nameAr !== undefined) collection.nameAr = nameAr;
    if (description !== undefined) collection.description = description;

    if (req.body.products !== undefined) {
      let products = parseJsonField(req.body.products, collection.products);
      if (!Array.isArray(products)) {
        products = typeof products === 'string' ? [products] : collection.products;
      }
      collection.products = await normalizeProducts(products);
    }

    if (req.file) {
      const oldImageUrl = collection.imageUrl;
      collection.imageUrl = `/uploads/${req.file.filename}`;
      if (oldImageUrl && oldImageUrl.startsWith('/uploads/')) {
        const oldFilePath = path.join(__dirname, '..', oldImageUrl);
        fs.unlink(oldFilePath, () => {});
      }
    }

    await collection.save();

    res.status(200).json({
      status: 'success',
      data: { collection },
    });
  } catch (error) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    return sendControllerError(res, error);
  }
};

// 5. حذف مجموعة (Owner/Manager AND Admin)
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
    return sendControllerError(res, error);
  }
};
