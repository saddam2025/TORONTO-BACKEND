// productController.js — FIXED
// Fix: Bug 1 — return 200 with empty array instead of 404 when no products match filters.
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Collection = require('../models/Collection');
const Promotion = require('../models/Promotion');
const sendControllerError = require('../utils/controllerError');
const { isPromotionAvailable, promotionHint } = require('../utils/promotionPricing');

function productHasStock(product) {
  return Number(product.stock || 0) > 0
    || [...(product.stockBySize?.values?.() || [])].some((value) => Number(value) > 0)
    || [...(product.stockByVariant?.values?.() || [])].some((value) => Number(value) > 0);
}

async function addActivePromotionSummaries(products) {
  if (!products.length) return products;
  const ids = products.map((product) => product._id);
  const now = new Date();
  const promotions = await Promotion.find({ product: { $in: ids }, isActive: true, startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }).sort({ priority: -1, startsAt: -1 });
  const grouped = new Map();
  for (const promotion of promotions) {
    const id = String(promotion.product);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push({
      _id: promotion._id,
      name: promotion.name,
      description: promotion.description,
      type: promotion.type,
      tiers: promotion.tiers,
      stackable: promotion.stackable,
      priority: promotion.priority,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      hint: promotionHint(promotion.toObject()),
    });
  }
  return products.map((product) => {
    const availablePromotions = productHasStock(product) ? grouped.get(String(product._id)) || [] : [];
    const value = product.toObject ? product.toObject() : product;
    return { ...value, promotions: availablePromotions, hasActivePromotion: availablePromotions.length > 0, promotionHint: availablePromotions[0]?.hint || null };
  });
}

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

    const [allProducts, total] = await Promise.all([
      Product.find(query).sort(sortOptions),
      Product.countDocuments(query),
    ]);
    const prioritized = (await addActivePromotionSummaries(allProducts))
      .sort((a, b) => Number(b.hasActivePromotion) - Number(a.hasActivePromotion));
    const products = prioritized.slice(skip, skip + limitNum);

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
    return sendControllerError(res, error);
  }
};

exports.getProduct = async (req, res) => {
  try {
    let product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found.',
      });
    }

    [product] = await addActivePromotionSummaries([product]);

    res.status(200).json({
      status: 'success',
      data: { product },
    });
  } catch (error) {
    return sendControllerError(res, error);
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
    const stockByVariant = parseJsonField(req.body.stockByVariant, {});
    const parsedCollections = parseJsonField(collections, []);

    const imageUrls = req.files.map((file) => `/uploads/${file.filename}`);

    const newProduct = await Product.create({
      nameEn, nameAr, descEn, descAr, category,
      price: Number(price) || 0,
      compareAtPrice: compareAtPrice ? Number(compareAtPrice) : null,
      imageUrls, colors, sizes, stockBySize, stockByVariant,
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
    return sendControllerError(res, error);
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
    if (req.body.stockByVariant !== undefined) product.stockByVariant = parseJsonField(req.body.stockByVariant, product.stockByVariant);
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
    return sendControllerError(res, error);
  }
};

exports.deleteProduct = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const product = await Product.findById(req.params.id).session(session);

    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({
        status: 'error',
        message: 'Product not found.',
      });
    }

    await Collection.updateMany({ products: product._id }, { $pull: { products: product._id } }, { session });
    await Promotion.updateMany({ product: product._id }, { $set: { isActive: false } }, { session });
    await product.deleteOne({ session });
    await session.commitTransaction();

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
    await session.abortTransaction();
    return sendControllerError(res, error);
  } finally {
    session.endSession();
  }
};
