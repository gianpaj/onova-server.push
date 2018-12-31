// @flow

import mongoose from 'mongoose';

const { Schema } = mongoose;

const NotificationSchema = new Schema({
  data: {
    type: Schema.Types.Mixed,
  },
  notifI18n: {
    type: Schema.Types.String,
    required: true,
  },
  targetUser: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  sourceUser: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  triggeredBy: {
    type: Schema.Types.ObjectId,
    refPath: 'triggeredType',
    required: true,
  },
  triggeredType: {
    type: Schema.Types.String,
    required: true,
    enum: ['User', 'Product', 'Order', 'Drop'],
  },
  dateCreated: {
    type: Date,
    default: Date.now,
    required: true,
  },
  dateRead: {
    type: Date,
  },
});

// if we don't use a function to return object literals for Mixed defaults,
// each document will receive a reference to the same object literal creating
// a "shared" object instance:
// NotificationSchema.path('data').default(function() {
//   return {};
// });

export class NotificationDoc /*:: extends Mongoose$Document */ {
  data: {
    commentId: ?string,
    productUuid: ?string,
    senderName: ?string,
    text: ?string,
  };
  notifI18n: string;
  targetUser: MongoId;
  sourceUser: MongoId;
  triggeredBy: MongoId;
  triggeredType: string;
  dateCreated: Date;
  dateRead: ?Date;
}

NotificationSchema.loadClass(NotificationDoc);

// Never return '__v' fields in the JSON representation
// Note that this doesn't effect `toObject`
NotificationSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

// NotificationSchema.index({ triggeredBy: 1, dateCreated: 1 });
// NotificationSchema.index({ targetUser: 1, dateCreated: 1 });
// for removeNotification()
// NotificationSchema.index({ 'data.commentId': 1 });

export default mongoose.model('Notification', NotificationSchema);
