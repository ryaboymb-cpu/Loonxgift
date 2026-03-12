/**
 * Loonx Gift - Full Backend Engine
 * Creator: @tonfrm
 * Environment: Node.js, Express, Socket.io, Mongoose
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const crypto = require('crypto');

// --- КОНФИГУРАЦИЯ ---
const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = "7788";

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- DATABASE MODELS ---
const userSchema = new mongoose.Schema({
    id: { type: String, unique: true, required: true },
    username: String,
    firstName: String,
    photo: String,
    realBal: { type: Number, default: 0 },
    demoBal: { type: Number, default: 1000 },
    refBy: { type: String, default: null },
    refCount: { type: Number, default: 0 },
    dailyBonus: { type: Date, default: 0 },
    banned: { type: Boolean, default: false },
    role: { type: String, default: 'user' }, // user, admin
    stats: {
        totalBets: { type: Number, default: 0 },
        totalWins: { type: Number, default: 0 },
        maxWin: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now }
});

const promoSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    reward: Number,
    uses: Number,
    active: { type: Boolean, default: true }
});

const User = mongoose.model('User', userSchema);
const Promo = mongoose.model('Promo', promoSchema);

// --- GLOBAL STATE & SETTINGS ---
let sysSettings = {
    crashRtp: 0.90,
    minesRtp: 0.88,
    coinWinChance: 0.35, // Твои 35%
    minWithdraw: 5,
    maintenance: false
};

let liveHistory = [];

// Подключение к MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected to Loonx Cloud'))
    .catch(err => console.error('❌ DB Error:', err));

// --- TELEGRAM BOT LOGIC ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const refOwner = msg.text.split(' ')[1]; // Если зашел по ссылке

    try {
        let user = await User.findOne({ id: userId });
        if (!user) {
            user = new User({
                id: userId,
                username: msg.from.username,
                firstName: msg.from.first_name,
                refBy: refOwner && refOwner !== userId ? refOwner : null
            });
            await user.save();
            
            if (user.refBy) {
                await User.findOneAndUpdate({ id: user.refBy }, { $inc: { refCount: 1, realBal: 0.5 } });
            }
        }

        const welcomeText = `🪙 <b>Добро пожаловать в Loonx Gift!</b>\nЛучшие игры уже ждут тебя.`;
        bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🫧 ЗАПУСТИТЬ ИГРЫ 🫧", web_app: { url: "https://loonxgift.onrender.com" } }],
                    [{ text: "📢 Новости", url: "https://t.me/Loonxnews" }]
                ]
            }
        });
    } catch (e) { console.error(e); }
});

bot.onText(/\/help/, (msg) => {
    const helpMsg = `🛡 <b>Связь с администрацией Loonx Gift:</b>\n\n` +
        `👤 <b>Creator:</b> @tonfrm\n` +
        `📢 <b>Channel:</b> @Loonxnews\n` +
        `🆘 <b>Support:</b> @LoonxGift_Support\n` +
        `🐛 <b>Bugs:</b> @msgp2p\n\n` +
        `<i>При обращении в поддержку указывайте ваш ID: ${msg.from.id}</i>`;
    bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: 'HTML' });
});

// --- CRASH ENGINE (SHARED LOOP) ---
let crash = {
    status: 'waiting', // waiting, flying, crashed
    timer: 10,
    mult: 1.00,
    crashAt: 0,
    bets: []
};

function runCrashTick() {
    if (crash.status === 'waiting') {
        if (crash.timer > 0) {
            crash.timer -= 0.1;
        } else {
            crash.status = 'flying';
            // House Edge logic: 10% моментальный краш на 1.00
            const rand = Math.random();
            crash.crashAt = rand < 0.1 ? 1.00 : (sysSettings.crashRtp / (1 - Math.random())).toFixed(2);
        }
    } else if (crash.status === 'flying') {
        let speed = crash.mult < 2 ? 0.01 : crash.mult < 5 ? 0.03 : 0.08;
        crash.mult = parseFloat((crash.mult + speed).toFixed(2));
        
        if (crash.mult >= crash.crashAt) {
            crash.status = 'crashed';
            io.emit('crash_boom', { mult: crash.mult });
            setTimeout(() => {
                crash.status = 'waiting';
                crash.timer = 10;
                crash.mult = 1.00;
                crash.bets = [];
            }, 4000);
        }
    }
    io.emit('crash_update', { status: crash.status, timer: Math.ceil(crash.timer), mult: crash.mult });
}
setInterval(runCrashTick, 100);

// --- SOCKET HANDLERS ---
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.on('auth', async (data) => {
        try {
            const user = await User.findOne({ id: data.id.toString() });
            if (!user || user.banned) return socket.emit('err', 'Access Denied');
            
            socket.userId = user.id;
            socket.join(`user_${user.id}`);
            socket.emit('init_data', { user, settings: sysSettings, history: liveHistory });
        } catch (e) { console.error(e); }
    });

    // COINFLIP L/X Logic (Strict 35%)
    socket.on('coin_bet', async (data) => {
        const user = await User.findOne({ id: socket.userId });
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (!user || user[balKey] < data.bet || data.bet <= 0) return;

        user[balKey] -= data.bet;
        user.stats.totalBets++;

        const isWin = Math.random() < sysSettings.coinWinChance;
        const resultSide = isWin ? data.side : (data.side === 'L' ? 'X' : 'L');
        let winSum = isWin ? data.bet * 1.9 : 0;

        if (isWin) {
            user[balKey] += winSum;
            user.stats.totalWins++;
            if (winSum > user.stats.maxWin) user.stats.maxWin = winSum;
        }

        await user.save();
        socket.emit('coin_result', { isWin, resultSide, winSum, balance: user[balKey] });
        addHistory('Coinflip', user.firstName, data.bet, winSum, isWin);
    });

    // MINES Logic (House Edge)
    socket.on('mines_start', async (data) => {
        const user = await User.findOne({ id: socket.userId });
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (!user || user[balKey] < data.bet || data.bet <= 0) return;

        user[balKey] -= data.bet;
        await user.save();

        let field = Array(25).fill('safe');
        let m = 0;
        while (m < data.mCount) {
            let r = Math.floor(Math.random() * 25);
            if (field[r] === 'safe') { field[r] = 'mine'; m++; }
        }

        socket.activeMines = { 
            field, bet: data.bet, balKey, opened: 0, 
            mult: 1.0, mCount: data.mCount, active: true 
        };
        
        socket.emit('mines_init', { balance: user[balKey] });
    });

    socket.on('mines_step', (idx) => {
        const g = socket.activeMines;
        if (!g || !g.active) return;

        if (g.field[idx] === 'mine') {
            g.active = false;
            socket.emit('mines_lose', { field: g.field });
            delete socket.activeMines;
        } else {
            g.opened++;
            // Усложненная формула (RTP)
            const n = 25;
            const m = g.mCount;
            const k = g.opened;
            // Теоретический икс занижается на коэффициент RTP
            let theoretical = 1;
            for(let i=0; i<k; i++) { theoretical *= (n-i)/(n-m-i); }
            g.mult = (theoretical * sysSettings.minesRtp).toFixed(2);

            socket.emit('mines_hit', { idx, mult: g.mult });
        }
    });

    socket.on('mines_cashout', async () => {
        const g = socket.activeMines;
        if (!g || !g.active || g.opened === 0) return;

        const user = await User.findOne({ id: socket.userId });
        const win = g.bet * g.mult;
        user[g.balKey] += win;
        user.stats.totalWins++;
        await user.save();

        socket.emit('mines_win', { win, balance: user[g.balKey] });
        addHistory('Mines', user.firstName, g.bet, win, true);
        delete socket.activeMines;
    });

    // CRASH BET Logic
    socket.on('crash_place_bet', async (data) => {
        if (crash.status !== 'waiting') return;
        const user = await User.findOne({ id: socket.userId });
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (!user || user[balKey] < data.bet) return;

        user[balKey] -= data.bet;
        await user.save();
        
        socket.currentCrash = { bet: data.bet, balKey, cashedOut: false };
        socket.emit('crash_bet_ok', { balance: user[balKey] });
    });

    socket.on('crash_cashout', async () => {
        if (crash.status !== 'flying' || !socket.currentCrash || socket.currentCrash.cashedOut) return;
        
        socket.currentCrash.cashedOut = true;
        const user = await User.findOne({ id: socket.userId });
        const win = socket.currentCrash.bet * crash.mult;
        user[socket.currentCrash.balKey] += win;
        await user.save();

        socket.emit('crash_win', { win, balance: user[socket.currentCrash.balKey] });
        addHistory('Crash', user.firstName, socket.currentCrash.bet, win, true);
    });

    // ADMIN LOGIC
    socket.on('admin_login', (pass) => {
        if (pass === ADMIN_PASS) {
            socket.isAdmin = true;
            socket.emit('admin_auth_success', { settings: sysSettings });
        }
    });

    socket.on('admin_update', (newSet) => {
        if (socket.isAdmin) {
            sysSettings = { ...sysSettings, ...newSet };
            io.emit('sys_msg', 'Settings updated by admin');
        }
    });

    // PROMO CODES
    socket.on('apply_promo', async (code) => {
        const promo = await Promo.findOne({ code: code.toUpperCase(), active: true });
        if (!promo || promo.uses <= 0) return socket.emit('promo_err', 'Invalid Code');

        const user = await User.findOne({ id: socket.userId });
        user.realBal += promo.reward;
        promo.uses -= 1;
        await user.save();
        await promo.save();

        socket.emit('promo_ok', { reward: promo.reward, balance: user.realBal });
    });
});

// Helper for live stats
function addHistory(game, name, bet, win, isWin) {
    const item = { game, name, bet, win, isWin, time: new Date() };
    liveHistory.unshift(item);
    if (liveHistory.length > 15) liveHistory.pop();
    io.emit('new_history', item);
}

server.listen(PORT, () => console.log(`🚀 Loonx Gift Engine v3.0 running on port ${PORT}`));
