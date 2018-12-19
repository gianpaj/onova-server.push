// @flow

import Promise from 'bluebird';
import mongoose from 'mongoose';
import shortid from 'shortid';

import { userPopulateFields } from './user.model';
import { ProductDoc } from '.';

const { Schema } = mongoose;

const DropSchema = new Schema(
  {
    description: {
      type: String,
    },
    // subscribers: {
    //   type: [UserSchema],
    // },
    posted: {
      type: Boolean,
      required: true,
      default: false,
    },
    products: {
      type: [Schema.Types.ObjectId],
      ref: 'Product',
      required: true,
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    seller: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    uuid: {
      type: String,
      unique: true, // Unique index
    },
  },
  {
    // assigns 'createdAt' and 'updatedAt' fields
    timestamps: true,
  }
);

export class DropDoc /*:: extends Mongoose$Document */ {
  _id: MongoId;
  createdAt: Date;
  description: ?string;
  posted: Boolean;
  products: Array<ProductDoc>;
  scheduledAt: Date;
  seller: MongoId;
  updatedAt: Date;
  uuid: string;
}

DropSchema.loadClass(DropDoc);

/**
 * Statics
 *
 * @memberof DropSchema
 */
DropSchema.statics = {
  /**
   * List drops, by default in descending order of 'createdAt' timestamp.
   *
   * @param {Object} query Query params
   * @param {Object} query.sort
   * @param {number} query.limit Limit number of drops to be returned.
   */
  list({
    query = {},
    sort = { createdAt: -1 },
    limit = 50,
  }): Promise<DropDoc[]> {
    // TODO: populate products
    return this.find(query)
      .populate({
        path: 'seller',
        select: userPopulateFields,
      })
      .sort(sort)
      .limit(+limit)
      .then((drops: DropDoc[]) => drops)
      .catch(() => {
        const err = new Error('Invalid drops');
        return Promise.reject(err);
      });
  },
};

DropSchema.pre('save', function(next) {
  const doc = this;
  if (!doc.uuid) return generateUnique(doc, next);
  next();
});

// Never return '__v' fields in the JSON representation
// Note that this doesn't effect `toObject`
DropSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

DropSchema.index({ scheduledAt: 1, createdAt: 1 });
DropSchema.index({ scheduledAt: 1, seller: 1 });

const UNIQUE_RETRIES = 9999;

function generateUnique(doc, next) {
  let retries = 0;
  let sid;

  // Try to generate a unique ID,
  // i.e. one that hasn't been used previously
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

export default mongoose.model('Drop', DropSchema);
