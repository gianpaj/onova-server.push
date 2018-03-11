// @flow

const gcm = require('node-gcm');
const Agenda = require('agenda');
const util = require('util');
const Boom = require('boom');
const Raven = require('raven');
const shortid = require('shortid');
const winston = require('winston');

const JOBNAMES = {
  PUSHCOMMENTS: 'send-push-comments',
};

const winstonInstance = new winston.Logger({
  transports: [
    new winston.transports.Console({
      json: true,
      colorize: true,
    }),
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

if (config.NODE_ENV === 'production') {
  // Raven.config(config.SENTRY_KEY, {
  //   captureUnhandledRejections: true,
  // }).install();
  Raven.on('logged', () => {
    console.log('raven event sent');
  });
}

if (config.NODE_ENV === 'production') {
  app.use(Raven.errorHandler());
}

agenda.on(`start:${JOBNAMES.PUSHCOMMENTS}`, job => {
  console.log('Job %s starting', job.attrs.name);
});

agenda.on('complete', job => {
  console.log('Job %s finished', job.attrs.name);
});

agenda.on('fail', (err, job) => {
  console.log('Job failed with error: %s', err.message);
  console.log(job);
});

agenda.on('ready', () => {
  agenda.every('3 seconds', JOBNAMES.PUSHCOMMENTS);

  agenda.start();
});

agenda.on('error', () => {
  agenda.start();
});

agenda.define(JOBNAMES.PUSHCOMMENTS, (job, done) => {
  const { message, productUuid, pushToken, senderName } = job.attrs.data;

  if (!pushToken || !message || !productUuid || !senderName) {
    console.error('incorrect data');
    console.error(job.attrs.data);
    throw new Error(`incorrect data: ${JSON.stringify(job.attrs.data)}`);
  }

  // req.checkBody('productUuid', 'Invalid productUuid').isValidId();
  // req
  //   .checkBody('targetId', 'Invalid targetId')
  //   .notEmpty()
  //   .isInt();
  // req.checkBody('senderName', 'Invalid senderName').notEmpty();
  // req.checkBody('message', 'Invalid message').notEmpty();
  // req.checkBody('pushToken', 'Invalid pushToken').notEmpty();

  // console.log(req.body);

  let notification = {};
  // if (platform == 'ios') {
  //   notification = {
  //     title: senderName,
  //     body: message,
  //   };
  // }

  // Prepare a message to be sent
  let push = new gcm.Message({
    data: {
      productUuid: productUuid,
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
  });

  // Specify which registration IDs to deliver the message to
  const regTokens = [pushToken];

  sender.send(push, { registrationTokens: regTokens }, (err, response) => {
    if (err) {
      console.error(err);
      throw new Error(err);
    }
    if (response.failure) {
      console.error(response);
    }
    done();
  });
});

function graceful() {
  agenda.stop(() => {
    console.log('agenda stopped gracefully');
    process.exit(0);
  });
}

process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);
