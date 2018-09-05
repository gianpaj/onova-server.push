// @flow

const gcm = require('node-gcm');
const Raven = require('raven');
import Agenda from 'agenda';
import winston from 'winston';
import mongoose from 'mongoose';
import User, { UserDoc } from './user.model';
import Product from './product.model';
// import fbgraph from 'fbgraph';

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
  PUSH_COMMENT: 'send-push-comment',
  PUSH_FOLLOW: 'send-push-follow',
  PUSHORDER: 'send-push-order',
  PUSH_MSG: 'send-push-msg', // person to person
  SCHEDULE: 'listing-schedule',
};

mongoose
  .connect(
    config.MONGO_URI_DATA,
    { keepAlive: 1 }
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

      const senderUser = await User.findById(senderId);

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
agenda.define(JOBNAMES.PUSH_COMMENT, sendPush);
agenda.define(JOBNAMES.PUSH_FOLLOW, sendPush);
agenda.define(JOBNAMES.PUSHORDER, (job, done) => {
  const withSenderName = false;
  sendPush(job, done, withSenderName);
});

agenda.define(JOBNAMES.SCHEDULE, async (job: Agenda.Job<any>, done) => {
  const { data } = job.attrs;

  // remove thumb
  data.product.photoURIs = data.product.photoURIs.filter(
    i => !i.includes('thumb.jpg')
  );

  // const user = await User.findById(data.product.seller);

  // TODO: check if user status is active

  /*
  if (data.socials.includes('fb')) {
    console.log(user.tokens);
    const accessToken = user.tokens.find(t => t.kind === 'fb').accessToken;
    fbgraph.setVersion('2.11');
    fbgraph.setAccessToken(accessToken);
    // fbgraph.extendAccessToken(
    //   {
    //     access_token: accessToken,
    //     client_id: config.FACEBOOK_APP_ID,
    //     client_secret: config.FACEBOOK_APP_SECRET,
    //   },
    //   (err, facebookRes) => {
    //     if (err) {
    //       console.error(err);
    //       return done(err);
    //     }
    //     console.log(facebookRes);
    //   }
    // );

    // remove thumb
    const images = data.product.photoURIs.filter(i => !i.includes('thumb.jpg'));

    let imageIds = [];
    let todo = images.length;
    if (!todo) return done(new Error('no images'));

    images.forEach(image => {
      fbgraph.post(
        '/me/photos',
        { published: false, url: image },
        (err, res) => {
          if (err) {
            console.error(err);
            return done(err);
          }
          imageIds.push(res.id);
          if (--todo === 0) {
            let wallPost = {
              message: data.product.description,
              attached_media: imageIds.map(id => ({
                media_fbid: id,
              })),
            };
            console.log(wallPost);
            fbgraph.post('/feed', wallPost, (err, res) => {
              if (err) {
                console.error(err);
                return done(err);
              }
              // returns the post id
              console.log(res); // { id: xxxxx}
            });
          }
        }
      );
    });
  }*/

  try {
    const p = new Product(data.product);
    await p.save();
    done();
  } catch (err) {
    console.error(err);
    done(err);
  }
});

function graceful() {
  agenda.stop(() => {
    logger.info('agenda stopped gracefully');
    process.exit(0);
  });
}

process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);
