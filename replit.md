# LoonxGift
<!-- Last updated: Mine game fixes - sprites, positioning, TNT, books, free spins, TON Connect -->

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
  sprites/         # Minecraft-style pickaxe PNGs (64x64, transparent bg)
    pick_wooden.png
    pick_stone.png
    pick_iron.png
    pick_golden.png
    pick_diamond.png
package.json
```

## Configuration

Required environment secrets/variables:
- `MONGO_URI` - MongoDB connection string
- `BOT_TOKEN` - Telegram bot token
- `ADMIN_ID` - Telegram admin user ID (for admin panel access)
- `ADMIN_PASS` - Admin panel password
- `ADMIN_WALLET` - TON wallet for deposits
- `TON_API_KEY` - TonCenter API key
- `WEB_APP_URL` - Public URL of the app (for TON Connect manifest, bot /start link)
- `PORT` - Ignored; server hardcoded to port 5000 for Replit

## Running

```bash
npm install
node server.js
```

Server runs on port 5000, binding to `0.0.0.0`.

## Games

- **Crash**: Multiplier game, cash out before it crashes. RTP controlled via `rtp_crash` setting.
- **Mines**: Grid game finding crystals, avoiding mines. RTP via `rtp_mines`.
- **Coinflip**: 50/50 chance game. RTP via `rtp_coinflip`.
- **Battle Roulette**: Multiplayer lobby, one winner takes the pool. Timer starts only when 2nd player joins.
- **Spin**: 5x3 slot with 15 paylines, symbols L/X/G, free spins, hidden G mechanic, progress bar bonus. RTP via `rtp_spin` (default 94%).

## SPIN Game Details

- Grid: 5 columns × 3 rows = 15 cells, 15 paylines
- Symbols: L (62%), X (28%), G (7%) - scatter, triggers free spins
- Paytable: L(3×0.5, 4×1, 5×2), X(3×2, 4×5, 5×10)
- Free Spins: 3G=5FS, 4G=6FS, 5G=8FS. During FS: X=+1 mult (max ×7), G=+1 spin
- Hidden G: after spin 0-2 cells reveal as G (1 cell: 16%, 2 cells: 5%) with glitch animation
- Progress Bar: G=+20%, HiddenG=+10%, at 100%: bonus +1 spin + ×2 multiplier start
- Adaptive RTP: loss streak → more X, win streak → fewer X. Effect ±15%
- Server-side RTP control: roll vs rtpTarget to suppress wins
- Animations: G=gift reveal, X=impact, HiddenG=glitch, freespins=badge

## Mine Game Details

- Grid: 5 columns × 5 rows = 25 blocks, Minecraft pixel-art aesthetic
- Block types: stone, redstone, gold, diamond, obsidian, book, tnt
- Block durability by rarity: stone:2, redstone:3, gold:4, diamond:5, obsidian:6 hits
- Blocks always visible from start with ore textures (never hidden)
- N pickaxes (1-5), each randomly assigned a type: wooden, stone, iron, golden, diamond
- Durability per pickaxe: wooden:2, stone:3, iron:4, golden:2, diamond:6
- Pickaxe sprites: PNG files at /sprites/pick_*.png (64x64, transparent bg, Minecraft pixel-art)
- Column-order mining: each pickaxe mines its assigned columns top-to-bottom
- Pickaxe breaks visually (shake, redden, shatter) when durability runs out
- Broken blocks stay in DOM (visibility:hidden) to prevent grid shift
- Per-column chests open only when all 5 rows in that column are broken
- Chest multiplier applied to column wins
- Inventory: 3×5 grid (separate from shaft grid)
- Books and TNT fly from grid to hotbar with smooth animation (flyItemToHotbar)
- Collecting 3 books grants 3 FREE auto-spins (server-tracked via `user.mineFreeSpins`, client syncs from `freeSpinsLeft`)
- TNT blocks: when mined, explode and deal 3 hits of damage to all 8 adjacent blocks (visual flash + particles)
- Free auto-spins: server validates `mineFreeSpins > 0` before allowing; uses effectiveBet=0.5 for win calc
- TNT generation: 4% chance per non-center block in server-side grid generation
- Menu card border: brown/orange (#c87020) to match Minecraft theme, distinct from Mines green
- Win scaled proportionally to blocks actually broken by pickaxes
- Minimum 8% guaranteed win per round (server-side)
- Block hit modifiers: wooden +1 extra hit, golden/diamond -1 hit
- Cracking animations: 3 stages with chaotic shaking, 3D box-shadow effect

## Sound System

- Web Audio API synthesized sounds (no external audio files)
- Sound effects: hit (square wave), break (noise burst), chest (ascending sine), win (arpeggio), click (short ping), spin (triangle sweep)
- Ambient background music: slow bass notes with harmonic overtones, auto-starts on first user interaction
- All sounds use gain envelopes for natural decay

## UI Polish

- All play/spin buttons use green gradient styling (rgba(0,255,136))
- Bet limits enforced: 0.1-25 TON (client-side + server-side validation)
- Mine button: "⛏ Крутить" with green Minecraft-style border

## Admin Panel

Access: tap profile avatar 5 times, enter `ADMIN_PASS`.

Tabs:
- **Выводы/Депы**: approve/reject withdrawals, view deposits
- **Юзеры**: search users, view stats, add/subtract balance, ban/unban
- **Промо**: create/delete promo codes
- **Настройки**: RTP controls (Crash, Mines, Coinflip, Spin), maintenance toggles, bot broadcast
- **Логи**: admin action log with date search

## Admin Balance Fix

- Route `/api/admin/change_balance`: supports `type: 'add'` (adds) or `type: 'sub'` (subtracts)
- Sends Telegram notification to user on balance change
- Logs action to admin log

## Deployment

Running on Replit (port 5000, 0.0.0.0). WEB_APP_URL env var must match the Replit dev domain for TON Connect to work.
TON Connect manifest URL in script.js uses `window.location.origin` dynamically.
