# Onova Push notifications Server

To debug GCM push notifications:

    DEBUG=node-gcm node index.js

To debug the scheduled jobs agenda:

    DEBUG="agenda:*" node index.js

## Getting Started

Install yarn:

```sh
npm install -g yarn
```

Install dependencies:

```sh
yarn
```

Set environment vars based on the example file:

```sh
cp .env.example .env
```

Start server:

```sh
# Start server
yarn dev:start
```
