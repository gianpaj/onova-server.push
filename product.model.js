// @flow

import mongoose from 'mongoose';
import shortid from 'shortid';

const Schema = mongoose.Schema;

const CommentSchema = new Schema({
  createdAt: {
    type: Date,
    default: Date.now,
    required: true,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
});

const GeoJSON = new Schema({
  type: { type: String, enum: ['Point'], required: true },
  coordinates: [Number],
});

// from mobileapp (ui.js)

// categoryIds
//   { label: 'Clothes-Men', value: 0 },
//   { label: 'Clothes-Women', value: 1 },
//   { label: 'Clothes-Shoes', value: 2 },
//   { label: 'Accessories-Jewelry', value: 10 },
//   { label: 'Accessories-Bags', value: 11 },
//   { label: 'Accessories-Accessories', value: 12 },
//   { label: 'For Home-Forniture', value: 20 },
//   { label: 'For Home-Art', value: 21 },
//   { label: 'For Home-Design', value: 22 },

/** @namespace */
const ProductSchema = new Schema(
  {
    categoryIds: {
      type: [Number],
      required: true,
    },
    comments: [CommentSchema],
    currency: {
      type: String,
      required: true,
      default: 'UAH',
    },
    description: {
      type: String,
      required: true,
    },
    dropId: {
      type: Schema.Types.ObjectId,
    },
    photoURIs: {
      type: [String],
      // required: true, // added async after the images are uploaded to GSC
    },
    location: { type: GeoJSON, required: false },
    locality: {
      type: String,
      // required: true,
    },
    price: {
      type: Schema.Types.Decimal,
      required: true,
    },
    quantity: {
      default: 1,
      min: 0,
      required: true,
      type: Schema.Types.Number,
    },
    reservedDate: Date,
    seller: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      required: true,
      default: 'forsale',
      enum: ['forsale', 'reserved', 'sold', 'banned', 'deleted', 'ready'],
    },
    tags: {
      type: [String],
      ref: 'Tag',
      // max number of 30 tags per product (see product.validation.js)
    },
    typeIds: {
      type: [Number],
      required: true,
    },
    uuid: {
      type: String,
      unique: true, // Unique index
    },
    weight: {
      type: Number,
      default: 5000, // 5kg
      required: true,
    },
  },
  {
    // assigns 'createdAt' and 'updatedAt' fields to your schema
    timestamps: true,
  }
);

export class ProductDoc /*:: extends Mongoose$Document */ {
  _id: MongoId;
  categoryIds: Array<Number>;
  comments: ?Array<MongoId>;
  createdAt: Date;
  currency: string;
  description: string;
  dropId: MongoId;
  location: {
    type: string,
    coordinates: {
      latitude: ?number,
      longitude: ?number,
    },
  };
  locality: string;
  photoURIs: Array<string>;
  price: number;
  quantity: number;
  reservedDate: Date;
  seller: string;
  status: string;
  tags: ?Array<string>;
  typeIds: ?Array<Number>;
  updatedAt: Date;
  uuid: string;
  weight: Number;
}

export class CommentDoc /*:: extends Mongoose$Document */ {
  _id: MongoId;
  createdAt: Date;
  user: string;
  text: string;
}

ProductSchema.loadClass(ProductDoc);

/**
 * Statics
 *
 * @memberof ProductSchema
 */
ProductSchema.statics = {
  /**
   * Get product
   *
   * @param uuid The unique id (shortid) of the product.
   */
  get(uuid: string): Promise<ProductDoc | APIError> {
    return this.findOne({ uuid })
      .populate({
        path: 'seller',
        select:
          'username accountStatus profilePic displayName shippingAddress types',
      })
      .select('-comments')
      .then((product: ProductDoc) => {
        if (!product) return Promise.reject();

        return product;
      })
      .catch(() => {
        const err = new Error('Invalid product');
        return Promise.reject(err);
      });
  },

  /**
   * List products in descending order of 'createdAt' timestamp.
   *
   * @param {Object} obj
   * @param {Object} obj.query DB query params
   * @param {Object} obj.projection Limit number of fields to be returned
   * @param {number} obj.limit Limit number of products to be returned
   * @param {Array<string>} obj.sellerTypes
   */
  list({
    query = {},
    projection = {},
    limit = 50,
    sellerTypes = ['designer'],
  }): Promise<ProductDoc[] | APIError> {
    return this.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'users',
          localField: 'seller',
          foreignField: '_id',
          as: 'references',
        },
      },
      { $match: { 'references.types': { $in: sellerTypes } } },
      {
        $project: { ...projection, __v: 0 },
      },
      {
        $project: {
          categoryIds: 1,
          createdAt: 1,
          currency: 1,
          description: 1,
          dropId: 1,
          locality: 1,
          photoURIs: 1,
          price: 1,
          quantity: 1,
          reservedDate: 1,
          seller: { $arrayElemAt: ['$references', 0] },
          status: 1,
          tags: 1,
          typeIds: 1,
          updatedAt: 1,
          uuid: 1,
          weight: 1,
        },
      },
      { $sort: { _id: -1 } },
      { $limit: +limit },
    ]).then((products: ProductDoc[]) =>
      products.map(p => ({
        ...p,
        seller: {
          _id: p.seller._id,
          accountStatus: p.seller.accountStatus,
          profilePic: p.seller.profilePic,
          shippingAddress: p.seller.shippingAddress,
          types: p.seller.types,
          username: p.seller.username,
        },
      }))
    );
  },
};

ProductSchema.pre('save', function(next) {
  const doc = this;
  if (!doc.uuid) return generateUnique(doc, next);
  next();
});

// Never return '__v' fields in the JSON representation
// Note that this doesn't effect `toObject`
ProductSchema.set('toJSON', {
  transform: (doc, ret) => {
    if (ret.price) ret.price = ret.price.toString();
    delete ret.__v;
    delete ret.location;
    return ret;
  },
});

// ProductSchema.index({ status: 1, createdAt: 1 });
// ProductSchema.index({ status: 1, categoryIds: 1 });
// ProductSchema.index({ status: 1, tags: 1 });
// ProductSchema.index({ status: 1, photoURIs: 1 });
// ProductSchema.index({ status: 1, seller: 1 });
// ProductSchema.index({ location: '2dsphere' });
// ProductSchema.index({ uuid: 1 }, { unique: true }); // created by `unique` schema setting above

const UNIQUE_RETRIES = 9999;

function generateUnique(doc, next) {
  let retries = 0;
  let sid;

  // Try to generate a unique ID,
  // i.e. one that isn't in the previous.
  while (!sid && retries < UNIQUE_RETRIES) {
    sid = shortid.generate();
    doc.constructor.findOne({ uuid: sid }).then(
      docRes => {
        if (docRes) {
          sid = null;
          return retries++;
        }
        doc.uuid = sid;
        next();
      },
      err => next(err)
    );
  }
}

export default mongoose.model('Product', ProductSchema);
