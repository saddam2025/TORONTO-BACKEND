process.env.JWT_SECRET = 'toronto-smoke-test-secret';
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function loadTestMiddleware(request, parent, isMain) {
  if (request === 'helmet' || request === 'express-rate-limit') {
    try {
      return originalLoad.call(this, request, parent, isMain);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
      if (request === 'helmet') return () => (req, res, next) => next();
      return { rateLimit: () => (req, res, next) => next() };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AffiliateProfile = require('../models/AffiliateProfile');
const Promotion = require('../models/Promotion');
const { calculatePromotionPricing, freeUnitsForQuantity } = require('../utils/promotionPricing');

const ids = {
  buyer: '100000000000000000000001',
  affiliate: '100000000000000000000002',
  admin: '100000000000000000000003',
  manager: '100000000000000000000004',
  suspended: '100000000000000000000005',
  otherBuyer: '100000000000000000000006',
  product: '200000000000000000000001',
  order: '300000000000000000000001',
};
const users = new Map(Object.entries({
  buyer: { role: 'Customer', status: 'active' },
  affiliate: { role: 'Affiliate', status: 'active' },
  admin: { role: 'Admin', status: 'active' },
  manager: { role: 'Manager', status: 'active' },
  suspended: { role: 'Customer', status: 'suspended' },
  otherBuyer: { role: 'Customer', status: 'active' },
}).map(([key, info]) => [ids[key], { ...info, _id: new mongoose.Types.ObjectId(ids[key]), name: key, email: `${key}@example.test` }]));

const asQuery = (value) => ({
  session: () => Promise.resolve(value),
  populate() { return this; },
  sort() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

User.findById = (id) => asQuery(users.get(String(id)) || null);
Order.find = () => asQuery([]);
Order.findById = () => asQuery(activeOrder);
Order.create = async ([record]) => {
  activeOrder = { ...record, _id: new mongoose.Types.ObjectId(ids.order), save: async () => activeOrder };
  activeOrder.save = async () => activeOrder;
  return [activeOrder];
};
AffiliateProfile.findOne = () => asQuery(activeAffiliateProfile);

let product;
let activeOrder;
let activeAffiliateProfile;
let transactionStarted = false;
mongoose.startSession = async () => ({
  startTransaction() { transactionStarted = true; },
  async commitTransaction() {},
  async abortTransaction() {},
  endSession() {},
});

const app = require('../app');
const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '5m' });

async function main() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { role = 'buyer', method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenFor(ids[role])}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };

  try {
    assert.equal((await request('/api/orders')).status, 403, 'buyers cannot list all orders');
    assert.equal((await request('/api/orders', { role: 'affiliate' })).status, 403, 'affiliates cannot list all orders');
    assert.equal((await request('/api/orders', { role: 'admin' })).status, 200, 'admins can list all orders');
    assert.equal((await request('/api/orders', { role: 'manager' })).status, 200, 'managers can list all orders');
    assert.equal((await request('/api/admin/settings', { role: 'admin', method: 'PUT', body: {} })).status, 403, 'admins cannot change manager-only settings');
    assert.equal((await request('/api/admin/settings', { role: 'manager', method: 'PUT', body: {} })).status, 400, 'managers reach manager-only settings validation');
    assert.equal((await request('/api/promotions', { method: 'POST', body: {} })).status, 403, 'buyers cannot create promotions');
    assert.equal((await request('/api/promotions/300000000000000000000001', { role: 'affiliate', method: 'PUT', body: {} })).status, 403, 'affiliates cannot edit promotions');
    assert.equal((await request('/api/promotions', { role: 'admin', method: 'POST', body: {} })).status, 400, 'admins can reach promotion validation');
    assert.equal((await request('/api/promotions', { role: 'manager', method: 'POST', body: {} })).status, 400, 'managers can reach promotion validation');
    assert.equal((await request('/api/affiliates/dashboard')).status, 403, 'buyers cannot access affiliate dashboard');
    assert.equal((await request('/api/affiliates/dashboard', { role: 'affiliate' })).status, 404, 'affiliates may access only their own dashboard');
    assert.equal((await request('/api/orders/my-orders', { role: 'suspended' })).status, 403, 'suspended tokens are rejected');

    product = {
      _id: new mongoose.Types.ObjectId(ids.product),
      nameEn: 'Smoke shirt', price: 100, stock: 5,
      sizes: ['M', 'L'], colors: ['Black'],
      stockBySize: new Map([['M', 2], ['L', 3]]),
      save: async () => product,
    };
    Product.findById = () => asQuery(product);
    Product.find = () => asQuery([product]);
    Promotion.find = () => asQuery([]);
    const created = await request('/api/orders', {
      method: 'POST',
      body: { items: [{ productId: ids.product, quantity: 1, size: 'M', color: 'Black' }] },
    });
    assert.equal(created.status, 201, 'buyer can create an order');
    assert.equal(product.stockBySize.get('M'), 1, 'order reserves stock from the selected size');
    assert.equal(product.stock, 4, 'order decrements aggregate stock');

    const affiliate = users.get(ids.affiliate);
    activeAffiliateProfile = { userId: affiliate._id, customCode: 'OWNCODE', pendingBalance: 0, save: async () => activeAffiliateProfile };
    const selfReferral = await request('/api/orders', {
      role: 'affiliate',
      method: 'POST',
      body: { affiliateCode: 'OWNCODE', items: [{ productId: ids.product, quantity: 1, size: 'M', color: 'Black' }] },
    });
    assert.equal(selfReferral.status, 400, 'affiliate self-referrals are rejected');
    activeAffiliateProfile = null;

    activeOrder = { _id: new mongoose.Types.ObjectId(ids.order), customerId: users.get(ids.buyer)._id, items: [], status: 'Pending', save: async () => activeOrder };
    assert.equal((await request(`/api/admin/orders/${ids.order}/status`, { role: 'manager', method: 'PUT', body: { status: 'Shipped' } })).status, 200, 'pending orders can ship');
    assert.equal((await request(`/api/admin/orders/${ids.order}/status`, { role: 'manager', method: 'PUT', body: { status: 'Pending' } })).status, 400, 'order status cannot move backwards');

    activeAffiliateProfile = { userId: users.get(ids.affiliate)._id, pendingBalance: 20, save: async () => activeAffiliateProfile };
    activeOrder = { _id: new mongoose.Types.ObjectId(ids.order), customerId: users.get(ids.buyer)._id, items: [{ productId: product._id, quantity: 1, size: 'M' }], status: 'Pending', affiliateId: users.get(ids.affiliate)._id, totalAffiliateCommission: 20, save: async () => activeOrder };
    const beforeCancel = product.stock;
    assert.equal((await request(`/api/orders/${ids.order}/cancel`, { method: 'PUT' })).status, 200, 'buyer can cancel their own pending order');
    assert.equal(activeOrder.status, 'Cancelled');
    assert.equal(product.stock, beforeCancel + 1, 'buyer cancellation restores aggregate stock');
    assert.equal(product.stockBySize.get('M'), 2, 'buyer cancellation restores size stock');
    assert.equal(activeAffiliateProfile.pendingBalance, 0, 'buyer cancellation removes pending affiliate commission');
    activeAffiliateProfile = null;

    activeOrder = { _id: new mongoose.Types.ObjectId(ids.order), customerId: users.get(ids.otherBuyer)._id, items: [], status: 'Pending', save: async () => activeOrder };
    assert.equal((await request(`/api/orders/${ids.order}/cancel`, { method: 'PUT' })).status, 404, 'buyer cannot cancel another customer order');
    activeOrder = { ...activeOrder, customerId: users.get(ids.buyer)._id, status: 'Shipped' };
    assert.equal((await request(`/api/orders/${ids.order}/cancel`, { method: 'PUT' })).status, 400, 'buyer cannot cancel a shipped order');
    assert.equal(transactionStarted, true, 'order operations run inside a transaction session');

    const pricingProduct = { _id: new mongoose.Types.ObjectId(ids.product), nameEn: 'Pricing shirt', price: 99.99, sizes: [], colors: [], stock: 100, stockBySize: new Map() };
    const promotion = (type, tiers, extra = {}) => ({ _id: new mongoose.Types.ObjectId(), product: pricingProduct._id, name: type, type, tiers, isActive: true, startsAt: new Date(Date.now() - 1000), endsAt: null, ...extra });
    assert.equal(freeUnitsForQuantity([{ minQty: 3, getQty: 1 }, { minQty: 6, getQty: 4 }], 7), 4, 'highest qualifying tier is applied and the remainder is reevaluated');
    assert.equal(freeUnitsForQuantity([{ minQty: 3, getQty: 1 }, { minQty: 6, getQty: 4 }], 9), 5, 'remainder can qualify for a lower tier');
    const freePricing = calculatePromotionPricing({ items: [{ productId: pricingProduct._id, quantity: 7 }], products: [pricingProduct], promotions: [promotion('BUY_X_GET_Y_FREE', [{ minQty: 3, getQty: 1 }, { minQty: 6, getQty: 4 }])] });
    assert.equal(freePricing.productTotals[0].freeQty, 4, 'buy-X-get-Y returns computed free quantity');
    assert.equal(freePricing.totalDiscount, 399.96, 'free units are recorded as monetary savings');
    const percentPricing = calculatePromotionPricing({ items: [{ productId: pricingProduct._id, quantity: 3 }], products: [pricingProduct], promotions: [promotion('QUANTITY_PERCENT_DISCOUNT', [{ minQty: 3, percent: 10 }])] });
    assert.equal(percentPricing.totalDiscount, 30, 'percentage discounts round to two decimal places');
    const fixedPricing = calculatePromotionPricing({ items: [{ productId: pricingProduct._id, quantity: 7 }], products: [pricingProduct], promotions: [promotion('QUANTITY_FIXED_DISCOUNT', [{ minQty: 3, fixedPrice: 250 }])] });
    assert.equal(fixedPricing.totalDiscount, 99.94, 'fixed bundle price repeats and prices the remainder normally');
    const stackPricing = calculatePromotionPricing({ items: [{ productId: pricingProduct._id, quantity: 3 }], products: [pricingProduct], promotions: [promotion('QUANTITY_PERCENT_DISCOUNT', [{ minQty: 3, percent: 10 }], { stackable: true }), promotion('QUANTITY_PERCENT_DISCOUNT', [{ minQty: 3, percent: 20 }]), promotion('QUANTITY_PERCENT_DISCOUNT', [{ minQty: 3, percent: 15 }])] });
    assert.equal(stackPricing.totalDiscount, 89.99, 'all stackable offers plus the single best non-stackable offer apply, capped at the line subtotal');
    const inactivePricing = calculatePromotionPricing({ items: [{ productId: pricingProduct._id, quantity: 3 }], products: [pricingProduct], promotions: [promotion('QUANTITY_PERCENT_DISCOUNT', [{ minQty: 3, percent: 10 }], { isActive: false }), promotion('QUANTITY_PERCENT_DISCOUNT', [{ minQty: 3, percent: 20 }], { startsAt: new Date(Date.now() + 60_000) })] });
    assert.equal(inactivePricing.totalDiscount, 0, 'inactive and future promotions do not apply');
    const shortageProduct = { ...pricingProduct, sizes: ['M'], colors: ['black'], stock: 4, stockBySize: new Map([['M', 4]]), stockByVariant: new Map([['M::black', 3]]) };
    product = shortageProduct;
    Product.find = () => asQuery([shortageProduct]);
    Promotion.find = () => asQuery([promotion('BUY_X_GET_Y_FREE', [{ minQty: 3, getQty: 1 }])]);
    const originalConsoleError = console.error;
    console.error = () => {};
    const freeStockShortage = await request('/api/orders/preview', { method: 'POST', body: { items: [{ productId: ids.product, quantity: 3, size: 'M', color: 'Black', freeSelections: [{ size: 'M', color: 'Black', quantity: 1 }] }] } });
    console.error = originalConsoleError;
    assert.equal(freeStockShortage.status, 400, 'preview rejects a free unit when the selected size/color variant lacks stock');
    assert.equal(shortageProduct.stockByVariant.get('M::black'), 3, 'preview stock checks do not mutate inventory');

    const commissionProduct = { ...pricingProduct, price: 99.99, affiliateCommission: 10, productDiscount: 0, stock: 20, stockBySize: new Map(), stockByVariant: new Map(), save: async () => commissionProduct };
    Product.find = () => asQuery([commissionProduct]);
    activeAffiliateProfile = { userId: users.get(ids.affiliate)._id, customCode: 'PROMO10', pendingBalance: 0, save: async () => activeAffiliateProfile };
    Promotion.find = () => asQuery([
      promotion('BUY_X_GET_Y_FREE', [{ minQty: 3, getQty: 1 }], { stackable: true }),
      promotion('QUANTITY_PERCENT_DISCOUNT', [{ minQty: 3, percent: 10 }], { stackable: true }),
    ]);
    const promoAffiliateOrder = await request('/api/orders', { method: 'POST', body: { affiliateCode: 'PROMO10', items: [{ productId: ids.product, quantity: 3 }] } });
    assert.equal(promoAffiliateOrder.status, 201, 'orders apply stackable offers to the server-calculated total');
    assert.equal(promoAffiliateOrder.data.order.items[0].freeItems[0].quantity, 1, 'free units are snapshotted on the order');
    assert.equal(promoAffiliateOrder.data.order.totalAffiliateCommission, 27, 'affiliate commission is prorated to the 10% discounted paid units and excludes free units');
    assert.equal(commissionProduct.stock, 16, 'order reserves paid and complimentary units');
    console.log('Toronto smoke checks passed.');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
