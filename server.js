require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    pingTimeout: 30000 
});

const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const TON_API_KEY = process.env.TON_API_KEY;
const ADMIN_WALLET = process.env.ADMIN_WALLET;
const WEBAPP_URL = process.env.WEBAPP_URL;

// --- ИСПРАВЛЕНИЕ ОШИБКИ 409 ЗДЕСЬ ---
let bot;
if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, { polling: true });
        console.log("✅ Бот запущен");

        // Этот блок ловит ошибку 409 и не дает серверу упасть!
        bot.on('polling_error', (error) => {
            if (error.message && error.message.includes('409 Conflict')) {
                console.log("⚠️ Предупреждение 409: Бот уже опрашивает Telegram в другом процессе. Сервер продолжает работу.");
            } else {
                console.log("❌ Ошибка Telegram:", error.message);
            }
        });

    } catch (e) {
        console.log("❌ Ошибка запуска бота:", e.message);
    }
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ База подключена"))
    .catch(err => console.error("❌ Ошибка базы:", err));

// МОДЕЛИ
const User = mongoose.model('User', new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    photo_url: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats_games: { type: Number, default: 0 },
    stats_wins: { type: Number, default: 0 },
    processed_txs: { type: [String], default: [] },
    isAdmin: { type: Boolean, default: false }
}));

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    tgId: Number, username: String, amount: Number, address: String, status: { type: String, default: 'pending' }
}));

app.use(express.static('public'));

// СОСТОЯНИЕ
let liveBets = [];
let onlineCount = 0;
let crashState = { status: 'waiting', multiplier: 1.0, history: [], currentBets: [], nextBets: [], timer: 8 };
let activeMines = {}; 

function addLiveBet(username, game, profit) {
    liveBets.unshift({ username, game, profit: parseFloat(profit).toFixed(2) });
    if (liveBets.length > 15) liveBets.pop();
    io.emit('live_bets_update', liveBets);
}

// CRASH LOGIC
function startCrashCycle() {
    crashState.status = 'waiting';
    crashState.multiplier = 1.0;
    crashState.currentBets = [...crashState.nextBets];
    crashState.nextBets = [];
    io.emit('crash_update_bets', crashState.currentBets);
    crashState.timer = 8;
    const countdown = setInterval(() => {
        crashState.timer -= 0.1;
        io.emit('crash_timer', crashState.timer.toFixed(1));
        if (crashState.timer <= 0) { clearInterval(countdown); runFlight(); }
    }, 100);
}

function runFlight() {
    crashState.status = 'flying';
    io.emit('crash_start');
    const point = Math.max(1.01, (1 / (1 - Math.random() * 0.96)).toFixed(2));
    const flight = setInterval(() => {
        crashState.multiplier += (crashState.multiplier * 0.006) + 0.01;
        io.emit('crash_tick', crashState.multiplier.toFixed(2));
        if (crashState.multiplier >= point) { clearInterval(flight); doCrash(point); }
    }, 100);
}

function doCrash(p) {
    crashState.status = 'crashed';
    crashState.history.unshift(p);
    if (crashState.history.length > 10) crashState.history.pop();
    io.emit('crash_end', { point: p, history: crashState.history });
    crashState.currentBets.forEach(b => { if(!b.cashedOut) addLiveBet(b.username, 'Crash', -b.amount); });
    setTimeout(startCrashCycle, 4000);
}
startCrashCycle();

// ПРОВЕРКА ДЕПОЗИТОВ ЧЕРЕЗ HTTPS
setInterval(() => {
    if (!TON_API_KEY || !ADMIN_WALLET) return;
    const url = `https://toncenter.com/api/v2/getTransactions?address=${ADMIN_WALLET}&limit=10&api_key=${TON_API_KEY}`;
    
    https.get(url, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', async () => {
            try {
                const data = JSON.parse(rawData);
                if (data.ok) {
                    for (let tx of data.result) {
                        const comment = tx.in_msg.message;
                        const amount = tx.in_msg.value / 1e9;
                        const hash = tx.transaction_id.hash;
                        if (comment && !isNaN(comment)) {
                            const user = await User.findOne({ tgId: parseInt(comment) });
                            if (user && !user.processed_txs.includes(hash)) {
                                user.real_balance += amount;
                                user.processed_txs.push(hash);
                                await user.save();
                                io.emit('deposit_success', { tgId: user.tgId, amount });
                            }
                        }
                    }
                }
            } catch (e) {}
        });
    }).on('error', (e) => {});
}, 30000);

// СОКЕТЫ
io.on('connection', (socket) => {
    onlineCount++;
    io.emit('online_count', onlineCount);
    socket.emit('live_bets_update', liveBets);
    socket.emit('crash_init', { history: crashState.history });

    socket.on('auth', async (data) => {
        if (!data || !data.id) return;
        let user = await User.findOne({ tgId: data.id });
        if (!user) {
            user = await User.create({ tgId: data.id, username: data.username || `User${data.id}` });
        }
        socket.userId = user._id;
        socket.emit('user_data', user); 
    });

    socket.on('crash_bet', async (d) => {
        const user = await User.findById(socket.userId);
        if (!user) return;
        const amt = parseFloat(d.amount);
        if (d.mode === 'real') user.real_balance -= amt; else user.demo_balance -= amt;
        await user.save();
        socket.emit('user_data', user);
        const b = { id: socket.id, username: user.username, amount: amt, mode: d.mode, cashedOut: false };
        if (crashState.status !== 'waiting') crashState.nextBets.push(b);
        else { crashState.currentBets.push(b); io.emit('crash_update_bets', crashState.currentBets); }
    });

    socket.on('crash_cashout', async () => {
        if (crashState.status !== 'flying') return;
        const b = crashState.currentBets.find(x => x.id === socket.id && !x.cashedOut);
        if (!b) return;
        b.cashedOut = true;
        const win = b.amount * crashState.multiplier;
        const user = await User.findById(socket.userId);
        if (b.mode === 'real') user.real_balance += win; else user.demo_balance += win;
        await user.save();
        addLiveBet(user.username, 'Crash', win);
        socket.emit('user_data', user);
        io.emit('crash_update_bets', crashState.currentBets);
    });

    socket.on('admin_auth', async (code) => {
        if (code === '8877') {
            const users = await User.find().sort({_id:-1}).limit(50);
            socket.emit('admin_ok', { users });
        }
    });

    socket.on('disconnect', () => { onlineCount--; io.emit('online_count', onlineCount); });
});

// БОТ ТЕКСТЫ
if (bot) {
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, `🚀 Добро пожаловать в Loonx Gifts!`, {
            reply_markup: { inline_keyboard: [[{ text: "🎮 Играть", web_app: { url: WEBAPP_URL } }]] }
        });
    });
}

server.listen(process.env.PORT || 3000, () => console.log("🚀 Server Ready"));
