# LoonxGift

A Telegram Mini App (TMA) backend and frontend for a gambling platform integrated with the TON blockchain.

## Architecture

- **Single Node.js/Express server** (`server.js`) serving both API and static frontend files
- **Frontend**: Vanilla JS/HTML/CSS in the `public/` directory
- **Database**: MongoDB (via Mongoose)
- **Real-time**: Socket.io for live game updates
- **Telegram**: node-telegram-bot-api for bot component

## Tech Stack

- Node.js 18+
- Express 4
- MongoDB / Mongoose 8
- Socket.io 4
- node-telegram-bot-api
- TON Connect integration

## Project Structure

```
server.js          # Main server (Express + Socket.io + Telegram bot)
public/
  index.html       # Telegram Mini App entry point
  script.js        # Frontend logic
  style.css        # Neon dark theme styles
  toncoin-ton-logo.png
  tonconnect-manifest.json
package.json
```

## Configuration

Required environment secrets/variables:
- `MONGO_URI` - MongoDB connection string
- `BOT_TOKEN` - Telegram bot token
- `ADMIN_ID` - Telegram admin user ID (for admin panel access)
- `WEB_APP_URL` - Public URL of the app (for TON Connect manifest)
- `PORT` - Server port (set to 5000 for Replit, default 5000)

## Running

```bash
npm install
node server.js
```

Server runs on port 5000, binding to `0.0.0.0`.

## Games

- **Crash**: Multiplier game, cash out before it crashes
- **Mines**: Grid game finding crystals, avoiding mines
- **Coinflip**: 50/50 chance game
- **Battle Roulette**: Multiplayer lobby, one winner takes the pool

## Deployment

Configured for Replit VM deployment (always-running, required for WebSockets and Telegram bot).
