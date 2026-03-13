/**
 * PROJECT: LOONX GIFTS - ULTIMATE CORE
 * UI STYLE: APPLE PREMIUM (STARS & GLOW)
 * NO AXIOS | NO CONFLICTS | FULL MINES & CRASH
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const { BOT_TOKEN, MONGO_URI, TON_API_KEY, ADMIN_WALLET, PORT = 3000 } = process.env;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- DATABASE CONNECTION ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('💎 [DB] Connected to MongoDB'))
    .catch(err => console.error('❌ [DB] Error:', err));

const userSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    avatar: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats: { wins: { type: Number, default: 0 }, games: { type: Number, default: 0 } }
});
const User = mongoose.model('User', userSchema);

// --- FIX 409 CONFLICT (TELEGRAM) ---
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
bot.deleteWebHook().then(() => {
    bot.startPolling();
    console.log('🤖 [BOT] Polling active (409 Conflict Resolved)');
});

// --- TON CENTER HTTPS REQUESTS (NO AXIOS) ---
function tonFetch(method, params = '') {
    return new Promise((resolve, reject) => {
        const url = `https://toncenter.com/api/v2/${method}?${params}&api_key=${TON_API_KEY}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

// --- GAME LOGIC: CRASH (STABLE VERSION) ---
let crashState = { status: 'wait', mult: 1.0, timer: 10, history: [] };

function startCrashCycle() {
    crashState.status = 'wait';
    crashState.mult = 1.0;
    crashState.timer = 10;
    
    let timerInt = setInterval(() => {
        crashState.timer -= 0.1;
        io.emit('crash_timer', crashState.timer.toFixed(1));
        if (crashState.timer <= 0) {
            clearInterval(timerInt);
            launchRocket();
        }
    }, 100);
}

function launchRocket() {
    crashState.status = 'fly';
    let crashPoint = (Math.random() * 3 + 1.1).toFixed(2); 

    let flyInt = setInterval(() => {
        crashState.mult += (crashState.mult * 0.008) + 0.01;
        io.emit('crash_tick', crashState.mult.toFixed(2));

        if (crashState.mult >= crashPoint) {
            clearInterval(flyInt);
            crashState.status = 'end';
            crashState.history.unshift(crashPoint);
            io.emit('crash_end', { point: crashPoint, history: crashState.history.slice(0, 8) });
            setTimeout(startCrashCycle, 4000);
        }
    }, 100);
}
startCrashCycle();

// --- SOCKET CONNECTION & GAME ACTIONS ---
io.on('connection', (socket) => {
    socket.on('auth', async (data) => {
        if(!data.id) return;
        let user = await User.findOneAndUpdate({ tgId: data.id }, {
            username: data.username,
            avatar: data.photo_url
        }, { upsert: true, new: true });
        
        socket.userId = user.tgId;
        socket.join(user.tgId.toString());
        socket.emit('init_data', { user, crashState });
    });

    // Обработка ставок (Crash & Mines)
    socket.on('place_bet', async (bet) => {
        const user = await User.findOne({ tgId: socket.userId });
        const balance = bet.isDemo ? 'demo_balance' : 'real_balance';

        if (user && user[balance] >= bet.amount) {
            user[balance] -= bet.amount;
            user.stats.games++;
            await user.save();

            socket.emit('update_balance', { 
                demo: user.demo_balance, 
                real: user.real_balance, 
                msg: "🚀 Ставка принята!" 
            });

            if (bet.game === 'mines') {
                // Логика генерации бомб на сервере
                let bombs = [];
                while(bombs.length < bet.bombCount) {
                    let r = Math.floor(Math.random() * 25);
                    if(!bombs.includes(r)) bombs.push(r);
                }
                socket.emit('mines_ready', { bombs }); 
            }
        } else {
            socket.emit('error_msg', 'Недостаточно средств!');
        }
    });

    socket.on('win_game', async (data) => {
        const user = await User.findOne({ tgId: socket.userId });
        const balance = data.isDemo ? 'demo_balance' : 'real_balance';
        user[balance] += data.winAmount;
        user.stats.wins++;
        await user.save();
        socket.emit('update_balance', { demo: user.demo_balance, real: user.real_balance });
    });
});

app.use(express.static('public'));
server.listen(PORT, () => console.log(`🚀 [SERVER] Running on port ${PORT}`));
