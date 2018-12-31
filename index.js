// @flow

import gcm from 'node-gcm';
import Raven from 'raven';
import Agenda from 'agenda';
import winston from 'winston';
import mongoose from 'mongoose';
import Joi from 'joi';

import User, { UserDoc } from './user.model';
import Drop from './drop.model';
import Notification from './notification.model';
import Product from './product.model';
import type { NotifPayload } from './types';
// import fbgraph from 'fbgraph';

const ONOVA_BOT_ID = '5bd1f7af46c62e6cdee546d0';

const isTestEnv = process.env.NODE_ENV === 'test';

// require and configure dotenv, will load vars in .env file in process.env
if (isTestEnv) {
  console.warn('running on `test` environment');
  require('dotenv').config({ path: '.env.test' });
} else {
  require('dotenv').config();
}

// define validation for all the env vars
const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .allow(['development', 'production', 'test', 'stage'])
    .default('development'),
  MONGOOSE_DEBUG: Joi.boolean().when('NODE_ENV', {
    is: Joi.string().equal('development'),
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),
  FCM_SERVER_KEY: Joi.string()
    .required()
    .description('Firebase Cloud Messaging (FCM) key'),
  SENTRY_KEY: Joi.string()
    .required()
    .description('Sentry API KEY'),
  MONGO_URI_AGENDA: Joi.string()
    .required()
    .description('MongoDB URI for Agenda jobs'),
  MONGO_URI_DATA: Joi.string()
    .required()
    .description('MongoDB URI'),
  // FACEBOOK_APP_ID: Joi.string()
  //   .required()
  //   .description(
  //     'Facebook APP ID for Login? and Posting item on sellers` walls'
  //   ),
  // FACEBOOK_APP_SECRET: Joi.string()
  //   .required()
  //   .description('Facebook APP Secret'),
})
  .unknown()
  .required();

const { error, value: config } = Joi.validate(process.env, envVarsSchema);
if (error) {
  const err = new Error(`Config validation error: ${error.message}`);
  console.error(err);
  throw err;
}

const JOBNAMES = {
  DROP_SUBSCRIPTION: 'drop-subscription',
  DROP_SUBSCRIPTION_PUSH: 'drop-subscription-push',
  PUSH_COMMENT: 'send-push-comment',
  PUSH_DROP_LISTED: 'send-push-drop-listed',
  PUSH_FOLLOW: 'send-push-follow',
  PUSH_MSG: 'send-push-msg', // person to person
  PUSH_ORDER: 'send-push-order',
  SCHEDULE: 'listing-schedule',
  // SYSTEM_MSG: 'send-system-message',
};

const i18n = {
  // listedDrop: 'Your drop has been listed',
  listedDrop: 'Ваш Дроп виставлено на продаж',
  sellerDropIsAboutToDrop: 'дроп скоро в продажу!',
};

mongoose
  .connect(
    config.MONGO_URI_DATA,
    { keepAlive: 1, useNewUrlParser: true }
  )
  .then(
    () => {
      console.log(`connected to ${config.MONGO_URI_DATA}`);
    },
    err => {
      throw new Error(
        `unable to connect to: ${config.MONGO_URI_DATA} - ${err}`
      );
    }
  );

// print mongoose logs in dev env
if (config.MONGOOSE_DEBUG) {
  mongoose.set('debug', (collectionName, method, query, doc) => {
    console.log(`${collectionName}.${method}`, query, doc);
  });
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    //
    // - Write to all logs with level `info` and below to `combined.log`
    // - Write all logs error (and below) to `error.log`.
    //
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: 'exceptions.log' }),
  ],
});

const agenda = new Agenda({
  db: {
    address: config.MONGO_URI_AGENDA,
    maxConcurrency: 2,
    defaultLockLifetime: 5000, // seconds
  },
});
console.log(`agenda connected to ${config.MONGO_URI_AGENDA}`);
const sender = new gcm.Sender(config.FCM_SERVER_KEY);

if (config.NODE_ENV == 'production') {
  // Raven.config(config.SENTRY_KEY, {
  //   captureUnhandledRejections: true,
  // }).install();
  Raven.on('logged', () => {
    logger.info('raven event sent');
  });
} else {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
      handleExceptions: true,
    })
  );
}

agenda.on('complete', job => {
  logger.info(job.attrs.data);
  logger.info(`Job ${job.attrs.name} finished`);
});

agenda.on('fail', (err, job) => {
  logger.error(`Job failed with error: ${err.message}`);

  logger.error(job);
});

agenda.on('ready', () => {
  agenda._collection.createIndex(
    {
      notification_id: 1,
    },
    err => {
      if (err) {
        console.log('Failed to create Agenda index!');
        console.error(err);
        throw new Error(err);
      }
      agenda.start();
      console.log('Agenda index created.');
    }
  );
});

agenda.on('error', () => {
  agenda.start();
});

function sendPush(job, done, withSenderName = true) {
  const {
    data,
    message,
    platform,
    productUuid, // for comments
    pushToken,
    // senderId, // TODO: check if user is not banned
    senderName,
    // targetUser, // TODO: check push notification user preference, and it's not banned
    triggeredBy,
    triggeredType,
  } = job.attrs.data;

  if (withSenderName && !senderName) {
    logger.error('invalid data');
    logger.error(job.attrs.data);
    throw new Error(`invalid data: ${JSON.stringify(job.attrs.data)}`);
  }

  if (!message || !pushToken || !triggeredBy) {
    logger.error('invalid data');
    logger.error(job.attrs.data);
    throw new Error(`invalid data: ${JSON.stringify(job.attrs.data)}`);
  }

  let notification = {};
  if (platform == 'ios') {
    notification = {
      title: senderName,
      body: message,
    };
  }

  // Prepare a message to be sent
  let push = new gcm.Message({
    data: {
      triggeredBy,
      triggeredType,
      title: senderName,
      body: message,
      priority: 2,
      productUuid,
      extra: data, // for Order notifications
    },
    // priority: 'high',
    notification: notification,
  });

  push.addNotification({
    title: senderName,
    body: message,
    icon: 'notification_icon',
    sound: 'default', // vibrate
  });

  // Specify which registration IDs to deliver the message to
  const regTokens = [pushToken];

  if (config.NODE_ENV == 'test') {
    logger.info(push);
    return done();
  }

  sender.send(push, { registrationTokens: regTokens }, (err, response) => {
    if (err) {
      logger.error(err);
      return done(new Error(err));
    }
    if (response.failure) {
      logger.error(response);
      return done(response);
    }
    done();
  });
}

agenda.define(JOBNAMES.PUSH_MSG, (job, done) => {
  // const second_in_a_day = 86400;
  const {
    message,
    // title,
    targetUser, // TODO: check push notification user preference, and it's not banned
    triggeredType,
    triggeredBy,
    senderId, // TODO: check if user is not banned
  } = job.attrs.data;

  if (!targetUser || !message || !triggeredBy || !senderId) {
    logger.error('job has invalid data');
    logger.error(job.attrs.data);
    throw new Error(`invalid data: ${JSON.stringify(job.attrs.data)}`);
  }

  User.findById(targetUser)
    .then(async (u: UserDoc) => {
      if (!u) {
        throw new Error(`no user found for ${targetUser}`);
      }

      // for Push notifications for system messages from @onovabot
      let senderUser = { username: null };
      if (senderId !== ONOVA_BOT_ID) senderUser = await User.findById(senderId);

      if (!senderUser) {
        throw new Error(`no user found for ${senderId}`);
      }
      let notification = {};
      if (u.platform == 'ios') {
        notification = {
          title: senderUser.username,
          body: message,
        };
      }

      // Prepare a message to be sent
      let push = new gcm.Message({
        data: {
          triggeredType,
          triggeredBy,
          title: senderUser.username,
          body: message,
          priority: 2,
        },
        // priority: 'high',
        notification,
      });

      push.addNotification({
        title: senderUser.username,
        body: message,
        icon: 'notification_icon',
        sound: 'default', // vibrate
      });

      // Specify which registration IDs to deliver the message to
      const regTokens = [u.pushToken];

      if (config.NODE_ENV == 'test') {
        logger.info(push);
        return done();
      }

      sender.send(push, { registrationTokens: regTokens }, (err, response) => {
        if (err) {
          logger.error(err);
          return done(new Error(err));
        }
        if (response.failure) {
          logger.error(response);
          return done(response);
        }
        done();
      });
    })
    .catch(e => {
      done(new Error(e));
      console.error(e);
    });
});
agenda.define(JOBNAMES.DROP_SUBSCRIPTION_PUSH, sendPush);
agenda.define(JOBNAMES.PUSH_COMMENT, sendPush);
agenda.define(JOBNAMES.PUSH_DROP_LISTED, sendPush);
agenda.define(JOBNAMES.PUSH_FOLLOW, sendPush);
agenda.define(JOBNAMES.PUSH_ORDER, (job, done) => {
  const withSenderName = false;
  sendPush(job, done, withSenderName);
});

agenda.define(JOBNAMES.SCHEDULE, async (job: Agenda.Job<any>, done) => {
  const { _id: dropId, seller } = job.attrs.data;

  try {
    const res = await Promise.all([
      await Drop.updateOne({ _id: dropId }, { posted: true }),
      await Product.updateMany({ dropId }, { status: 'forsale' }),
    ]);

    if (res.reduce((acc, currVal) => acc.nModified + currVal.nModified) < 2) {
      console.log(job.attrs.data);
      console.log(res);
      throw new Error('error updating Drop and or Products');
    }

    await Notification.create({
      dropId,
      notifI18n: i18n.listedDrop,
      sourceUser: seller,
      targetUser: seller,
      triggeredBy: seller,
      triggeredType: 'User',
    });

    // Send push notification to the seller
    await schedulePush({
      // data,
      dropId,
      notifI18n: i18n.listedDrop,
      targetUser: seller,
      triggeredBy: seller,
      triggeredType: 'User',
    });

    done();
  } catch (err) {
    console.error(err);
    done(err);
  }
});

agenda.define(
  JOBNAMES.DROP_SUBSCRIPTION,
  async (job: Agenda.Job<any>, done) => {
    const { _id: dropId, seller: sellerId } = job.attrs.data.drop;
    const { sub } = job.attrs.data;

    try {
      if (!sellerId) {
        throw new Error(`No seller found - ${JOBNAMES.DROP_SUBSCRIPTION}`);
      }

      const [drop, seller] = await Promise.all([
        Drop.findById(dropId),
        User.findById(sellerId),
      ]);

      if (!drop) {
        throw new Error(`No drop found - ${JOBNAMES.DROP_SUBSCRIPTION}`);
      }

      const notifI18n = `@${seller.username} ${i18n.sellerDropIsAboutToDrop}`;

      await Notification.create({
        dropId,
        notifI18n,
        sourceUser: sub._id,
        targetUser: sub._id,
        triggeredBy: sellerId,
        triggeredType: 'DropSubscription',
      });

      // to get latest Push Token
      const target: UserDoc = await User.findById(sub._id);
      if (!target) throw new Error('Cannot find target');

      const pushData = {
        message: notifI18n,
        platform: target.platform,
        pushToken: target.pushToken,
        triggeredBy: seller._id,
        triggeredType: 'DropSubscription',
        senderName: seller.username,
        targetUser: target._id,
        data: seller,
      };

      const job = agenda.create(JOBNAMES.DROP_SUBSCRIPTION_PUSH, pushData);
      job.unique({ dropId });

      job.save(err => {
        if (err) throw new Error(`Job failed with error: ${err}`);
        logger.info(JOBNAMES.DROP_SUBSCRIPTION_PUSH + ' scheduled');
        done();
      });
    } catch (err) {
      console.error(err);
      done(err);
    }
  }
);

async function schedulePush({
  data,
  dropId,
  notifI18n,
  targetUser,
  triggeredBy,
  triggeredType,
}: NotifPayload): Promise<void> {
  try {
    const sender: UserDoc = await User.findById(triggeredBy);
    if (!sender) throw new Error('Cannot find sender');

    const target: UserDoc = await User.findById(targetUser);
    if (!target) throw new Error('Cannot find target');

    const pushData = {
      message: notifI18n,
      platform: target.platform,
      pushToken: target.pushToken,
      triggeredBy: sender._id,
      triggeredType,
      senderName: sender.username,
      targetUser: target._id,
      ...data,
    };

    const job = agenda.create(JOBNAMES.PUSH_DROP_LISTED, pushData);
    job.unique({ dropId });

    return job.save(err => {
      if (err) throw new Error(`Job failed with error: ${err}`);
      logger.info(JOBNAMES.PUSH_DROP_LISTED + ' scheduled');
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
}

function graceful() {
  agenda.stop(() => {
    logger.info('agenda stopped gracefully');
    process.exit(0);
  });
}

process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);
