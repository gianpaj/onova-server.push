// @flow

const gcm = require('node-gcm');
const Agenda = require('agenda');
const Raven = require('raven');
const winston = require('winston');

const JOBNAMES = {
  PUSHCOMMENT: 'send-push-comment',
  PUSHFOLLOW: 'send-push-follow',
  PUSHORDER: 'send-push-order',
};

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

const Joi = require('joi');
require('dotenv').config();

// define validation for all the env vars
const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .allow(['development', 'production', 'test', 'stage'])
    .default('development'),
  PORT: Joi.number().default(3030),
  FCM_SERVER_KEY: Joi.string()
    .required()
    .description('Firebase Cloud Messaging (FCM) key'),
  SENTRY_KEY: Joi.string()
    .required()
    .description('Sentry API KEY'),
})
  .unknown()
  .required();

const { error, value: config } = Joi.validate(process.env, envVarsSchema);
if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const agenda = new Agenda({
  db: {
    address: config.MONGO_URI,
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
  agenda.start();
});

agenda.on('error', () => {
  agenda.start();
});

function sendPush(job, done, withSenderName = true) {
  const {
    message,
    platform,
    pushToken,
    triggeredBy,
    triggeredType,
    senderId, // TODO: check if user is not banned
    senderName,
    targetUser, // TODO: check push notification user preference, and it's not banned
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
      throw new Error(err);
    }
    if (response.failure) {
      logger.error(response);
    }
    done();
  });
}

agenda.define(JOBNAMES.PUSHCOMMENT, sendPush);
agenda.define(JOBNAMES.PUSHFOLLOW, sendPush);
agenda.define(JOBNAMES.PUSHORDER, (job, done) => {
  const withSenderName = false;
  sendPush(job, done, withSenderName);
});

function graceful() {
  agenda.stop(() => {
    logger.info('agenda stopped gracefully');
    process.exit(0);
  });
}

process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);
