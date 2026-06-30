// productController.js
const fs = require('fs');
const path = require('path');
const Product = require('../models/Product');

// Parses a field that the frontend sent as a JSON string inside multipart
// form-data (FormData can't carry arrays/objects directly, so colors/sizes/
// stockBySize all arrive as stringified JSON text fields). Falls back to
// the given default if the field is missing or isn't valid JSON.
function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// 1. جلب جميع المنتجات مع إمكانية الفلترة (category, search, price range,
// collectionId) والترقيم (pagination). أحدث المنتجات أولاً.
exports.getProducts = async (req, res) => {
  try {
    const { category, search, minPrice, maxPrice, collectionId, page, limit } = req.query;

    const query = {};

    if (category) {
      query.category = category.toLowerCase();
    }

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ nameEn: regex }, { nameAr: regex }];
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
    const limitNum = Math.max(Number(limit) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Product.countDocuments(query),
    ]);

    res.status(200).json({
      status: 'success',
      results: products.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data: { products },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// 1b. جلب منتج واحد بالـ ID
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

// 2. إنشاء منتج جديد (Owner/Manager AND Admin — both roles are permitted
// by the route-level middleware; this controller has no extra role check).
// Expects multipart/form-data: text fields handled by multer, plus multiple
// `images` file fields. The uploaded files' paths are what get stored as
// imageUrls — never client-supplied URL strings for this endpoint.
exports.createProduct = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one product image is required.',
      });
    }

    const {
      nameEn,
      nameAr,
      descEn,
      descAr,
      price,
      compareAtPrice,
      category,
      baseProfitPerPiece,
      affiliateCommission,
      productDiscount,
      sizeGuideImageUrl,
      stock,
      isLatestArrival,
    } = req.body;

    const colors = parseJsonField(req.body.colors, []);
    const sizes = parseJsonField(req.body.sizes, []);
    const stockBySize = parseJsonField(req.body.stockBySize, {});

    // Construct an array of image paths
    const imageUrls = req.files.map((file) => `/uploads/${file.filename}`);

    const newProduct = await Product.create({
      nameEn,
      nameAr,
      descEn,
      descAr,
      price: Number(price) || 0,
      compareAtPrice: compareAtPrice ? Number(compareAtPrice) : null,
      imageUrls,
      category,
      colors,
      sizes,
      stockBySize,
      stock: Number(stock) || 0,
      baseProfitPerPiece: Number(baseProfitPerPiece) || 0,
      affiliateCommission: Number(affiliateCommission) || 0,
      productDiscount: Number(productDiscount) || 0,
      sizeGuideImageUrl: sizeGuideImageUrl || null,
      isLatestArrival: isLatestArrival === 'false' ? false : true,
    });

    res.status(201).json({
      status: 'success',
      data: { product: newProduct },
    });
  } catch (error) {
    // If the document failed validation after the files were already written
    // to disk, remove the now-orphaned uploads rather than leaving them behind.
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => fs.unlink(file.path, () => {}));
    }
    res.status(400).json({
      status: 'error',
      message: error.message,
    });
  }
};

// 3. تعديل منتج (Owner/Manager AND Admin) — partial update.
// إذا تم رفع صور جديدة، تستبدل القديمة (والقديمة تتمسح من القرص).
// إذا لم تُرفع صور، تبقى imageUrls الحالية كما هي.
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      // Clean up any newly-uploaded files since we won't be using them.
      if (req.files && req.files.length > 0) {
        req.files.forEach((file) => fs.unlink(file.path, () => {}));
      }
      return res.status(404).json({
        status: 'error',
        message: 'Product not found.',
      });
    }

    const {
      nameEn,
      nameAr,
      descEn,
      descAr,
      price,
      compareAtPrice,
      category,
      baseProfitPerPiece,
      affiliateCommission,
      productDiscount,
      sizeGuideImageUrl,
      stock,
      isLatestArrival,
    } = req.body;

    if (nameEn !== undefined) product.nameEn = nameEn;
    if (nameAr !== undefined) product.nameAr = nameAr;
    if (descEn !== undefined) product.descEn = descEn;
    if (descAr !== undefined) product.descAr = descAr;
    if (category !== undefined) product.category = category;
    if (price !== undefined) product.price = Number(price) || 0;
    if (compareAtPrice !== undefined) {
      product.compareAtPrice = compareAtPrice ? Number(compareAtPrice) : null;
    }
    if (stock !== undefined) product.stock = Number(stock) || 0;
    if (baseProfitPerPiece !== undefined) {
      product.baseProfitPerPiece = Number(baseProfitPerPiece) || 0;
    }
    if (affiliateCommission !== undefined) {
      product.affiliateCommission = Number(affiliateCommission) || 0;
    }
    if (productDiscount !== undefined) {
      product.productDiscount = Number(productDiscount) || 0;
    }
    if (sizeGuideImageUrl !== undefined) {
      product.sizeGuideImageUrl = sizeGuideImageUrl || null;
    }
    if (isLatestArrival !== undefined) {
      product.isLatestArrival = isLatestArrival === 'false' ? false : true;
    }

    if (req.body.colors !== undefined) {
      product.colors = parseJsonField(req.body.colors, product.colors);
    }
    if (req.body.sizes !== undefined) {
      product.sizes = parseJsonField(req.body.sizes, product.sizes);
    }
    if (req.body.stockBySize !== undefined) {
      product.stockBySize = parseJsonField(req.body.stockBySize, product.stockBySize);
    }

    // Replace images only if new ones were uploaded; otherwise keep existing.
    if (req.files && req.files.length > 0) {
      const oldImageUrls = product.imageUrls;
      product.imageUrls = req.files.map((file) => `/uploads/${file.filename}`);

      // Best-effort cleanup of the old files now that they're replaced.
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

// 4. حذف منتج (Owner/Manager AND Admin)
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found.',
      });
    }

    // Best-effort cleanup of the uploaded files on disk. Missing files (e.g.
    // already deleted) should not turn into a failed delete response.
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