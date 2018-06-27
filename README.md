# Onova Push notification Server

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
