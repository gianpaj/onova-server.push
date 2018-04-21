// @flow
/** @namespace */

import mongoose from 'mongoose';

const Schema = mongoose.Schema;

/**
 * User Schema
 */
const UserSchema = new Schema(
  {
    accountStatus: {
      type: String,
      required: true,
      default: 'notverified',
      enum: ['verified', 'notverified', 'banned', 'deleted'],
    },
    billingAddress: {
      firstName: String,
      lastName: String,
      company: String,
      line1: String,
      line2: String,
      line3: String,
      city: String,
      state: String,
      country: String, // ISO 3166-1 alpha-2 format
      postcode: String,
      phone: String,
    },
    bio: String,
    displayName: {
      type: String,
      minlength: 3,
      maxlength: 30,
    },
    emailAddress: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      // validated at API level via 'Joi' and 'isEmail' npm packages
    },
    followersCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer value',
      },
    },
    followingCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer value',
      },
    },
    mobileNumber: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    platform: {
      type: String,
      enum: ['android', 'ios'],
    },
    paymentInfo: {
      paymentMethod: {
        type: String,
        enum: ['paypal', 'c2c'],
      },
      third_party_token: String,
      // temp
      last_four: String,
      exp_month: String,
      exp_year: String,
    },
    profilePic: String,
    pushToken: String,
    ratingsTotal: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    reviewsCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer value',
      },
    },
    shippingAddress: {
      firstName: String,
      lastName: String,
      company: String,
      line1: String,
      line2: String,
      line3: String,
      city: String,
      state: String,
      country: String, // ISO 3166-1 alpha-2 format
      postcode: String,
    },
    username: {
      type: String,
      unique: true,
      required: true,
      minlength: 3,
      maxlength: 30,
      trim: true,
      lowercase: true,
    },
    deletedAt: Date,
  },
  // assigns 'createdAt' and 'updatedAt' fields to your schema
  { timestamps: true }
);

export class UserDoc /*:: extends Mongoose$Document */ {
  _id: MongoId;
  accountStatus: string;
  billingAddress: ?any;
  bio: ?string;
  createdAt: Date;
  deletedAt: ?Date;
  displayName: ?string;
  emailAddress: string;
  followersCount: number;
  followingCount: number;
  mobileNumber: ?string;
  password: string;
  paymentInfo: ?any;
  platform: ?string;
  profilePic: ?string;
  pushToken: ?string;
  ratingsTotal: number;
  reviewsCount: number;
  shippingAddress: ?any;
  updatedAt: Date;
  username: string;
}

UserSchema.loadClass(UserDoc);

/**
 * Statics
 */
UserSchema.statics = {
  /**
   * Get user
   *
   * @param {MongoId} id - The ObjectId of user.
   */
  get(id: string): Promise<UserDoc | APIError> {
    return this.findById(id)
      .then((user: UserDoc) => {
        if (!user) {
          return Promise.reject();
        }
        return user;
      })
      .catch(() => {
        const err = new Error('Invalid user');
        return Promise.reject(err);
      });
  },

  /**
   * List of users in descending order of 'createdAt' timestamp.
   *
   * @param {Object} query Query parameters
   * @param {number} query.skip Number of users to be skipped
   * @param {number} query.limit Limit number of users to be returned
   */
  list({ skip = 0, limit = 50 }): Promise<UserDoc[] | APIError> {
    return this.find()
      .sort({ createdAt: -1 })
      .skip(+skip)
      .limit(+limit)
      .then((users: UserDoc[]) => {
        if (!users) {
          return Promise.reject();
        }
        return users;
      })
      .catch(() => {
        const err = new APIError('Invalid users');
        return Promise.reject(err);
      });
  },
};

// Never return these fields in the JSON representation
// This doesn't effect `toObject` method
UserSchema.set('toJSON', {
  getters: true,
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

UserSchema.index({ emailAddress: 1 }, { unique: true });
UserSchema.index({ username: 1 }, { unique: true });

/**
 * @memberof UserSchema
 */
export default mongoose.model('User', UserSchema);
