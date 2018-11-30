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

// from mobileapp (AddProduct.js)
// categoryIds
//   { label: 'Clothes', value: 0 },
//   { label: 'Shoes', value: 1 },
//   { label: 'Other', value: 2 },

// typeIds
//   { label: 'Men', value: 0 },
//   { label: 'Women', value: 1 },
//   { label: 'Other', value: 2 },

/** @namespace */
var ProductSchema = new Schema(
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
    // not being used
    likes: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
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
      enum: ['forsale', 'reserved', 'sold', 'banned', 'deleted'],
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
    weight: {
      type: Number,
      default: 5000, // 5kg
      required: true,
    },
    uuid: {
      type: String,
      unique: true, // Unique index
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
  comments: Array<MongoId>; // optional
  createdAt: Date;
  currency: string;
  description: string;
  dropId: MongoId;
  likes: Array<MongoId>;
  photoURIs: Array<string>;
  location: {
    type: string,
    coordinates: {
      latitude: ?number,
      longitude: ?number,
    },
  };
  locality: string;
  price: number;
  reservedDate: Date;
  seller: string;
  status: string;
  tags: Array<string>; // optional
  typeIds: Array<Number>;
  weight: Number;
  uuid: string;
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
        select: 'username accountStatus profilePic',
      })
      .select('-comments')
      .then((product: ProductDoc) => {
        if (!product) {
          return Promise.reject();
        }
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
   * @param {Object} query Query params
   * @param {number} query.skip Number of products to be skipped.
   * @param {number} query.limit Limit number of products to be returned.
   */
  list({
    query = {},
    projection = {},
    skip = 0,
    limit = 50,
  }): Promise<ProductDoc[] | APIError> {
    return this.find(query, projection)
      .sort({ createdAt: -1 })
      .skip(+skip)
      .limit(+limit)
      .then((products: ProductDoc[]) => {
        if (!products) {
          return Promise.reject();
        }
        return products;
      })
      .catch(() => {
        const err = new Error('Invalid products');
        return Promise.reject(err);
      });
  },
};

ProductSchema.pre('save', function(next) {
  let doc = this;
  if (!this.uuid) return generateUnique(doc, next);
  next();
});

// Never return '__v' fields in the JSON representation
// Note that this doesn't effect `toObject`
ProductSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.price = ret.price.toString();
    delete ret.__v;
    return ret;
  },
});

ProductSchema.index({ status: 1, createdAt: 1 });
// ProductSchema.index({ status: 1, categoryIds: 1 });
ProductSchema.index({ status: 1, tags: 1 });
ProductSchema.index({ status: 1, photoURIs: 1 });
ProductSchema.index({ status: 1, seller: 1 });
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
      err => {
        next(err);
      }
    );
  }

  return sid;
}

export default mongoose.model('Product', ProductSchema);
