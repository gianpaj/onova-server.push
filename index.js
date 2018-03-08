// @flow

const gcm = require('node-gcm');
const express = require('express');
const expressValidator = require('express-validator');
const util = require('util');
const Boom = require('boom');
const bodyParser = require('body-parser');
const Raven = require('raven');
const shortid = require('shortid');
const winston = require('winston');
const expressWinston = require('express-winston');
const morgan = require('morgan');

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

const sender = new gcm.Sender(config.FCM_SERVER_KEY);
const app = express();
const API = '/api/v1';

if (config.NODE_ENV === 'development') {
  app.use(morgan('dev'));

  // enable detailed API logging in dev env
  expressWinston.requestWhitelist.push('body');
  expressWinston.responseWhitelist.push('body');
  app.use(
    expressWinston.logger({
      winstonInstance,
      meta: true, // optional: log meta data about request (defaults to true)
      msg:
        'HTTP {{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms',
      colorize: true, // Color the status code (default green, 3XX cyan, 4XX yellow, 5XX red).
    })
  );
}

app.listen(config.PORT, () =>
  console.log(`Push server is listening on port ${config.PORT}`)
);

if (config.NODE_ENV === 'production') {
  // Raven.config(config.SENTRY_KEY, {
  //   captureUnhandledRejections: true,
  // }).install();
  app.use(Raven.requestHandler());
  Raven.on('logged', function() {
    console.log('raven event sent');
  });
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  expressValidator({
    customValidators: {
      isValidId: value => shortid.isValid(value),
    },
  })
);

app.post(`${API}/push`, push);

if (config.NODE_ENV === 'production') {
  app.use(Raven.errorHandler());
}

// log error in winston transports except when executing test suite
if (config.NODE_ENV !== 'test') {
  app.use(
    expressWinston.errorLogger({
      winstonInstance,
    })
  );
}

function push(req, res) {
  req.checkBody('productUuid', 'Invalid productUuid').isValidId();
  req
    .checkBody('targetId', 'Invalid targetId')
    .notEmpty()
    .isInt();
  req.checkBody('senderName', 'Invalid senderName').notEmpty();
  req.checkBody('message', 'Invalid message').notEmpty();
  req.checkBody('pushToken', 'Invalid pushToken').notEmpty();

  req.getValidationResult().then(result => {
    if (!result.isEmpty()) {
      const error = Boom.badRequest(
        util.inspect(result.array()),
        result.array()
      );
      console.log(error);
      return res.status(400).json(error);
    }

    const {
      message,
      platform,
      productUuid,
      pushToken,
      senderName,
      targetId,
    } = req.body;

    // console.log(req.body);

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
        productUuid: productUuid,
        targetId: targetId,
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
      if (err) console.error(err);
      else console.log(response);
    });

    res.status(200).end();
  });
}
