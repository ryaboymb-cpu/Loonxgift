require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https'); // Используем встроенный https вместо axios
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);

// Настройка сокетов: разрешаем всё, увеличиваем таймауты, чтобы лоадер не висел
const io = new Server(server, { 
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout: 5000 
});

const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const TON_API_KEY = process.env.TON_API_KEY;
const ADMIN_WALLET = process.env.ADMIN_WALLET;
const WEBAPP_URL = process.env.WEBAPP_URL;

// ==========================================
// 1. БОТ И ЗАЩИТА ОТ ОШИБКИ 409
// ==========================================
let bot;
if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, { polling: true });
        console.log("✅ Бот запущен");

        bot.on('polling_error', (error) => {
            if (error.message && error.message.includes('409 Conflict')) {
                console.log("⚠️ 409 Conflict: Бот запущен где-то еще. Сервер работает дальше, игнорируем.");
            } else {
                console.log("❌ Ошибка Telegram:", error.message);
            }
        });

        bot.onText(/\/start/, (msg) => {
            bot.sendMessage(msg.chat.id, `🚀 Добро пожаловать в Loonx Gifts!`, {
                reply_markup: { inline_keyboard: [[{ text: "🎮 Играть", web_app: { url: WEBAPP_URL } }]] }
            });
        });
    } catch (e) {
        console.log("❌ Ошибка инициализации бота:", e.message);
    }
}

// ==========================================
// 2. БАЗА ДАННЫХ
// ==========================================
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ База подключена"))
    .catch(err => console.error("❌ Ошибка базы:", err));

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

// Раздаем статику (твой фронтенд)
app.use(express.static('public'));

// ==========================================
// 3. ИГРОВАЯ ЛОГИКА (CRASH)
// ==========================================
let liveBets = [];
let onlineCount = 0;
let crashState = { status: 'waiting', multiplier: 1.0, history: [], currentBets: [], nextBets: [], timer: 8 };

function addLiveBet(username, game, profit) {
    liveBets.unshift({ username, game, profit: parseFloat(profit).toFixed(2) });
    if (liveBets.length > 15) liveBets.pop();
    io.emit('live_bets_update', liveBets);
}

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
        if (crashState.timer <= 0) { 
            clearInterval(countdown); 
            runFlight(); 
        }
    }, 100);
}

function runFlight() {
    crashState.status = 'flying';
    io.emit('crash_start');
    const point = Math.max(1.01, (1 / (1 - Math.random() * 0.96)).toFixed(2));
    
    const flight = setInterval(() => {
        crashState.multiplier += (crashState.multiplier * 0.006) + 0.01;
        io.emit('crash_tick', crashState.multiplier.toFixed(2));
        
        if (crashState.multiplier >= point) { 
            clearInterval(flight); 
            doCrash(point); 
        }
    }, 100);
}

function doCrash(p) {
    crashState.status = 'crashed';
    crashState.history.unshift(p);
    if (crashState.history.length > 10) crashState.history.pop();
    io.emit('crash_end', { point: p, history: crashState.history });
    
    crashState.currentBets.forEach(b => { 
        if(!b.cashedOut) addLiveBet(b.username, 'Crash', -b.amount); 
    });
    setTimeout(startCrashCycle, 4000);
}
startCrashCycle();

// ==========================================
// 4. ПРОВЕРКА ДЕПОЗИТОВ TON (БЕЗ AXIOS)
// ==========================================
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
            } catch (e) { /* Игнорируем ошибки парсинга */ }
        });
    }).on('error', (e) => { /* Игнорируем сетевые ошибки */ });
}, 30000);

// ==========================================
// 5. СОКЕТЫ (СВЯЗЬ С ФРОНТЕНДОМ)
// ==========================================
io.on('connection', (socket) => {
    onlineCount++;
    io.emit('online_count', onlineCount);
    socket.emit('live_bets_update', liveBets);
    socket.emit('crash_init', { history: crashState.history });

    // САМОЕ ВАЖНОЕ: АВТОРИЗАЦИЯ ДЛЯ ОТКЛЮЧЕНИЯ ЛОАДЕРА
    socket.on('auth', async (data) => {
        if (!data || !data.id) return;
        try {
            let user = await User.findOne({ tgId: data.id });
            if (!user) {
                user = await User.create({ tgId: data.id, username: data.username || `User${data.id}` });
            }
            socket.userId = user._id;
            // Отправляем данные обратно, чтобы клиент убрал лоадер!
            socket.emit('user_data', user); 
        } catch (err) {
            console.log("Ошибка авторизации:", err);
        }
    });

    socket.on('crash_bet', async (d) => {
        if (!socket.userId) return;
        const user = await User.findById(socket.userId);
        if (!user) return;
        
        const amt = parseFloat(d.amount);
        if (d.mode === 'real') user.real_balance -= amt; else user.demo_balance -= amt;
        await user.save();
        
        socket.emit('user_data', user);
        const b = { id: socket.id, username: user.username, amount: amt, mode: d.mode, cashedOut: false };
        
        if (crashState.status !== 'waiting') crashState.nextBets.push(b);
        else { 
            crashState.currentBets.push(b); 
            io.emit('crash_update_bets', crashState.currentBets); 
        }
    });

    socket.on('crash_cashout', async () => {
        if (!socket.userId || crashState.status !== 'flying') return;
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

    // АДМИН ПАНЕЛЬ
    socket.on('admin_auth', async (code) => {
        if (code === '8877') { // Твой пароль
            const users = await User.find().sort({_id:-1}).limit(50);
            socket.emit('admin_ok', { users });
        }
    });

    socket.on('disconnect', () => { 
        onlineCount--; 
        io.emit('online_count', onlineCount); 
    });
});

server.listen(process.env.PORT || 3000, () => console.log("🚀 Server Ready"));
