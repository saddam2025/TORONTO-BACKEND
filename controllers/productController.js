// productController.js — FIXED
// Fix: Bug 1 — return 200 with empty array instead of 404 when no products match filters.
const fs = require('fs');
const path = require('path');
const Product = require('../models/Product');

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

exports.getProducts = async (req, res) => {
  try {
    const { category, search, minPrice, maxPrice, collectionId, page, limit, sort } = req.query;

    const query = {};

    if (category) {
      const categories = category.split(',').map(c => c.toLowerCase());
      query.category = { $in: categories };
    }

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { nameEn: regex },
        { nameAr: regex },
        { descEn: regex },
        { descAr: regex }
      ];
    }

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    if (collectionId) {
      query.collections = collectionId;
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.max(Number(limit) || 12, 1);
    const skip = (pageNum - 1) * limitNum;

    let sortOptions = { createdAt: -1 };
    if (sort === 'priceLow') sortOptions = { price: 1 };
    if (sort === 'priceHigh') sortOptions = { price: -1 };

    const [products, total] = await Promise.all([
      Product.find(query).sort(sortOptions).skip(skip).limit(limitNum),
      Product.countDocuments(query),
    ]);

    // FIX Bug 1: was returning 404 for empty results. 404 means route not found,
    // not "no products match". Return 200 with an empty array so callers can
    // distinguish "no results" from "endpoint missing" and render empty states correctly.
    res.status(200).json({
      status: 'success',
      results: products.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      data: { products },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found.',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { product },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

exports.createProduct = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one product image is required.',
      });
    }

    const {
      nameEn, nameAr, descEn, descAr, price, compareAtPrice, category,
      baseProfitPerPiece, affiliateCommission, productDiscount, sizeGuideImageUrl,
      stock, isLatestArrival, collections
    } = req.body;

    const colors = parseJsonField(req.body.colors, []);
    const sizes = parseJsonField(req.body.sizes, []);
    const stockBySize = parseJsonField(req.body.stockBySize, {});
    const parsedCollections = parseJsonField(collections, []);

    const imageUrls = req.files.map((file) => `/uploads/${file.filename}`);

    const newProduct = await Product.create({
      nameEn, nameAr, descEn, descAr, category,
      price: Number(price) || 0,
      compareAtPrice: compareAtPrice ? Number(compareAtPrice) : null,
      imageUrls, colors, sizes, stockBySize,
      stock: Number(stock) || 0,
      baseProfitPerPiece: Number(baseProfitPerPiece) || 0,
      affiliateCommission: Number(affiliateCommission) || 0,
      productDiscount: Number(productDiscount) || 0,
      sizeGuideImageUrl: sizeGuideImageUrl || null,
      isLatestArrival: isLatestArrival === 'false' ? false : true,
      collections: parsedCollections
    });

    res.status(201).json({
      status: 'success',
      data: { product: newProduct },
    });
  } catch (error) {
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => fs.unlink(file.path, () => {}));
    }
    res.status(400).json({
      status: 'error',
      message: error.message,
    });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      if (req.files && req.files.length > 0) {
        req.files.forEach((file) => fs.unlink(file.path, () => {}));
      }
      return res.status(404).json({
        status: 'error',
        message: 'Product not found.',
      });
    }

    const {
      nameEn, nameAr, descEn, descAr, price, compareAtPrice, category,
      baseProfitPerPiece, affiliateCommission, productDiscount, sizeGuideImageUrl,
      stock, isLatestArrival, collections
    } = req.body;

    if (nameEn !== undefined) product.nameEn = nameEn;
    if (nameAr !== undefined) product.nameAr = nameAr;
    if (descEn !== undefined) product.descEn = descEn;
    if (descAr !== undefined) product.descAr = descAr;
    if (category !== undefined) product.category = category;
    if (price !== undefined) product.price = Number(price) || 0;
    if (compareAtPrice !== undefined) product.compareAtPrice = compareAtPrice ? Number(compareAtPrice) : null;
    if (stock !== undefined) product.stock = Number(stock) || 0;
    if (baseProfitPerPiece !== undefined) product.baseProfitPerPiece = Number(baseProfitPerPiece) || 0;
    if (affiliateCommission !== undefined) product.affiliateCommission = Number(affiliateCommission) || 0;
    if (productDiscount !== undefined) product.productDiscount = Number(productDiscount) || 0;
    if (sizeGuideImageUrl !== undefined) product.sizeGuideImageUrl = sizeGuideImageUrl || null;
    if (isLatestArrival !== undefined) product.isLatestArrival = isLatestArrival === 'false' ? false : true;

    if (req.body.colors !== undefined) product.colors = parseJsonField(req.body.colors, product.colors);
    if (req.body.sizes !== undefined) product.sizes = parseJsonField(req.body.sizes, product.sizes);
    if (req.body.stockBySize !== undefined) product.stockBySize = parseJsonField(req.body.stockBySize, product.stockBySize);
    if (collections !== undefined) product.collections = parseJsonField(collections, product.collections);

    if (req.files && req.files.length > 0) {
      const oldImageUrls = product.imageUrls;
      product.imageUrls = req.files.map((file) => `/uploads/${file.filename}`);

      oldImageUrls.forEach((url) => {
        if (url.startsWith('/uploads/')) {
          const filePath = path.join(__dirname, '..', url);
          fs.unlink(filePath, () => {});
        }
      });
    }

    const updatedProduct = await product.save();

    res.status(200).json({
      status: 'success',
      data: { product: updatedProduct },
    });
  } catch (error) {
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => fs.unlink(file.path, () => {}));
    }
    res.status(400).json({
      status: 'error',
      message: error.message,
    });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found.',
      });
    }

    if (product.imageUrls && product.imageUrls.length > 0) {
      product.imageUrls.forEach((url) => {
        if (url.startsWith('/uploads/')) {
          const filePath = path.join(__dirname, '..', url);
          fs.unlink(filePath, () => {});
        }
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Product deleted.',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};