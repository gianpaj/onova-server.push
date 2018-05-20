// @flow

const gcm = require('node-gcm');
const Agenda = require('agenda');
const Raven = require('raven');
const winston = require('winston');
import mongoose from 'mongoose';
import User, { UserDoc } from './user.model';

const Joi = require('joi');
require('dotenv').config();

// define validation for all the env vars
const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .allow(['development', 'production', 'test', 'stage'])
    .default('development'),
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
  PUSH_COMMENT: 'send-push-comment',
  PUSH_FOLLOW: 'send-push-follow',
  PUSHORDER: 'send-push-order',
  PUSH_MSG: 'send-push-msg', // person to person
};

mongoose.connect(config.MONGO_URI_DATA, { keepAlive: 1 }).then(
  () => {
    console.log(`connected to ${config.MONGO_URI_DATA}`);
  },
  err => {
    throw new Error(`unable to connect to: ${config.MONGO_URI_DATA} - ${err}`);
  }
);

// print mongoose logs in dev env
if (config.NODE_ENV !== 'production') {
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
    message,
    platform,
    productUuid, // for comments
    pushToken,
    senderId, // TODO: check if user is not banned
    senderName,
    targetUser, // TODO: check push notification user preference, and it's not banned
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

      const sender = await User.findById(senderId);

      if (!sender) {
        throw new Error(`no user found for ${senderId}`);
      }
      let notification = {};
      if (u.platform == 'ios') {
        notification = {
          title: sender.username,
          body: message,
        };
      }

      // Prepare a message to be sent
      let push = new gcm.Message({
        data: {
          triggeredType,
          triggeredBy,
          title: sender.username,
          body: message,
          priority: 2,
        },
        // priority: 'high',
        notification,
      });

      push.addNotification({
        title: sender.username,
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
    .catch(e => console.error(e));
});
agenda.define(JOBNAMES.PUSH_COMMENT, sendPush);
agenda.define(JOBNAMES.PUSH_FOLLOW, sendPush);
agenda.define(JOBNAMES.PUSHORDER, (job, done) => {
  sendPush(job, done, (withSenderName = false));
});

function graceful() {
  agenda.stop(() => {
    logger.info('agenda stopped gracefully');
    process.exit(0);
  });
}

process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);
