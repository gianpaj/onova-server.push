# Onova push notification server (`server.push`)

> Part of [Onova](https://www.onova.co/), a mobile marketplace for second-hand and sustainable clothing that [Gianfranco Palumbo](https://github.com/gianpaj) and Alex Kostinskyi built in Lviv, Ukraine. The company ran until September 2019. This repository is an archive and is not maintained.

An [Agenda](https://github.com/agenda/agenda) worker that sends push notifications to the Onova and Drop apps through Firebase Cloud Messaging. `server.data` queues a job in MongoDB, and this service picks it up and sends the notification. Notifications cover new orders and order updates, chat messages, comments, new followers, a drop going live and reminders for buyers subscribed to an upcoming drop.

| | |
|---|---|
| First commit | 2018-03-08 |
| Last commit | 2020-06-12 |
| Commits | 75 by Gianfranco |
| Code | about 1,300 lines of JavaScript |

### Onova repositories

- [onova-mobileapp](https://github.com/gianpaj/onova-mobileapp): the Onova and Drop iOS and Android apps
- [onova-server.data](https://github.com/gianpaj/onova-server.data): the REST API
- [onova-server.data.global](https://github.com/gianpaj/onova-server.data.global): the API fork for an international version
- [onova-server.push](https://github.com/gianpaj/onova-server.push): push notifications
- [onova-server.chat](https://github.com/gianpaj/onova-server.chat): order messages in buyer–seller chats
- [onova-webapp-drop](https://github.com/gianpaj/onova-webapp-drop): the Drop web app
- [onova-forest-admin](https://github.com/gianpaj/onova-forest-admin): the back office
- [onova-automl-server](https://github.com/gianpaj/onova-automl-server): an image classifier prototype

---

## Original README

To debug GCM push notifications:

    DEBUG=node-gcm node index.js

To debug the Agenda scheduled jobs:

    DEBUG="agenda:*" node index.js

## Getting Started

Install yarn:

    npm install -g yarn

Install dependencies:

    yarn

Set environment vars based on the example file:

    cp .env.example .env

Start development server:

    yarn dev:start

Start Chrome Debugger:

    yarn dev:start --inspect
