require('dotenv').config();

const mongoose = require('mongoose');
const Collection = require('../models/Collection');
const Product = require('../models/Product');

async function run() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');
  await mongoose.connect(process.env.MONGO_URI, { dbName: 'toronto_db' });

  try {
    const validProductIds = new Set((await Product.distinct('_id')).map(String));
    const collections = await Collection.find({}, '_id products').lean();
    const repairs = collections.map((collection) => ({
      collectionId: String(collection._id),
      missingIds: (collection.products || []).filter((id) => !validProductIds.has(String(id))),
    })).filter((repair) => repair.missingIds.length > 0);
    const referenceCount = repairs.reduce((sum, repair) => sum + repair.missingIds.length, 0);

    console.log(`${repairs.length} collections contain ${referenceCount} dangling product references.`);
    if (!process.argv.includes('--apply')) {
      console.log('Dry run only. Re-run with --apply to remove those references.');
      return;
    }

    if (repairs.length) {
      await Collection.bulkWrite(repairs.map(({ collectionId, missingIds }) => ({
        updateOne: {
          filter: { _id: collectionId },
          update: { $pull: { products: { $in: missingIds } } },
        },
      })));
    }
    console.log(`Removed ${referenceCount} dangling references.`);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error('Collection cleanup failed:', error.message);
  process.exitCode = 1;
});
