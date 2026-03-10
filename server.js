const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// Настройки окружения
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// Инициализация Telegram Бота
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, 'Добро пожаловать в Loonx Gift🍀\nИспытай свою удачу здесь👇', {
            reply_markup: {
                inline_keyboard: [[{ text: '🫧 Играть 🫧', web_app: { url: 'https://loonxgift.onrender.com' } }]]
            }
        });
    });
}

// Подключение к MongoDB
mongoose.connect(MONGO_URI || 'mongodb://localhost/loonx', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ MongoDB успешно подключена');
}).catch(err => {
    console.error('❌ Ошибка подключения к MongoDB:', err);
});

// Схемы Базы Данных
const UserSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    tgName: { type: String, default: 'Player' },
    photoUrl: { type: String, default: '' },
    realBal: { type: Number, default: 0 },
    demoBal: { type: Number, default: 100 },
    lastDemoReplenish: { type: Number, default: 0 },
    games: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    usedPromos: { type: [String], default: [] }
});
const User = mongoose.model('User', UserSchema);

const PromoSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    reward: { type: Number, required: true },
    maxUses: { type: Number, required: true },
    currentUses: { type: Number, default: 0 }
});
const Promo = mongoose.model('Promo', PromoSchema);

// Инициализация Express и Socket.IO
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// Игровые переменные
let crashHistory = [];
let crash = { status: 'waiting', timer: 8, mult: 1.00, liveBets: [] };
let nextRoundBets = [];
let onlineUsers = new Set();

// Логика игры CRASH
function runCrash() {
    crash = { status: 'waiting', timer: 8, mult: 1.00, liveBets: [...nextRoundBets] };
    nextRoundBets = [];
    io.emit('crash_update', { ...crash, history: crashHistory });
    
    let waitInterval = setInterval(() => {
        crash.timer--;
        io.emit('crash_update', { ...crash, history: crashHistory });
        if (crash.timer <= 0) {
            clearInterval(waitInterval);
            startCrashFlight();
        }
    }, 1000);
}

function startCrashFlight() {
    crash.status = 'flying';
    
    // Заниженные шансы (хардкорный рандом)
    let crashPoint;
    const rand = Math.random();
    if (rand < 0.30) { 
        crashPoint = 1.00; // 30% шанс на моментальный взрыв
    } else if (rand < 0.85) {
        crashPoint = 1.00 + (Math.random() * 1.5); // 55% шанс на взрыв от 1.00 до 2.50
    } else {
        crashPoint = (100 / (Math.floor(Math.random() * 100) + 1)) + 0.5; // 15% шанс на более высокие иксы
    }

    let flightInterval = setInterval(async () => {
        if (crash.mult >= crashPoint) {
            clearInterval(flightInterval);
            crash.status = 'crashed';
            crashHistory.unshift(crash.mult.toFixed(2));
            if (crashHistory.length > 10) crashHistory.pop();
            
            // Завершаем несыгравшие ставки
            for (let bet of crash.liveBets) {
                if (!bet.cashed) {
                    let u = await User.findOne({ id: bet.id });
                    if(u) {
                        u.games++;
                        await u.save();
                    }
                }
            }
            
            io.emit('crash_update', { ...crash, history: crashHistory });
            setTimeout(runCrash, 4000);
        } else {
            crash.mult += 0.01 * Math.pow(crash.mult, 0.4);
            io.emit('crash_update', { ...crash, history: crashHistory });
        }
    }, 100);
}
runCrash();

// Обработка Socket-соединений
io.on('connection', (socket) => {
    let currentUser = null;
    onlineUsers.add(socket.id);
    io.emit('online_update', onlineUsers.size);

    socket.on('init_user', async (data) => {
        if (!data || !data.id) return;
        currentUser = data.id.toString();
        try {
            let u = await User.findOne({ id: currentUser });
            if (!u) {
                u = await User.create({
                    id: currentUser,
                    tgName: data.username || 'Player',
                    photoUrl: data.photo || ''
                });
            } else {
                if(data.photo) u.photoUrl = data.photo;
                if(data.username) u.tgName = data.username;
                await u.save();
            }
            socket.emit('user_data', u);
        } catch(e) { console.error("Init User Error:", e); }
    });

    // CRASH СОКЕТЫ
    socket.on('crash_bet', async (data) => {
        if (!currentUser) return;
        try {
            let u = await User.findOne({ id: currentUser });
            let betAmount = parseFloat(data.bet);
            if (isNaN(betAmount) || betAmount < 0.5) return socket.emit('alert', 'Минимальная ставка 0.5');

            let balanceField = data.mode === 'real' ? 'realBal' : 'demoBal';
            if (u[balanceField] < betAmount) return socket.emit('alert', 'Недостаточно средств');

            u[balanceField] -= betAmount;
            await u.save();

            let betData = { socketId: socket.id, id: currentUser, bet: betAmount, cashed: false, mode: data.mode };
            
            if (crash.status === 'waiting') {
                crash.liveBets.push(betData);
                socket.emit('alert', 'Ставка принята!');
            } else {
                nextRoundBets.push(betData);
                socket.emit('alert', 'Ставка принята на следующий раунд!');
            }
            socket.emit('user_data', u);
        } catch(e) { console.log(e); }
    });

    socket.on('crash_cashout', async () => {
        if (!currentUser || crash.status !== 'flying') return;
        try {
            let betIndex = crash.liveBets.findIndex(x => x.socketId === socket.id && !x.cashed);
            if (betIndex !== -1) {
                crash.liveBets[betIndex].cashed = true;
                let winAmount = crash.liveBets[betIndex].bet * crash.mult;
                let u = await User.findOne({ id: currentUser });
                
                let balanceField = crash.liveBets[betIndex].mode === 'real' ? 'realBal' : 'demoBal';
                u[balanceField] += winAmount;
                u.games++;
                u.wins++;
                await u.save();
                
                socket.emit('user_data', u);
                socket.emit('crash_win', { win: winAmount.toFixed(2), mult: crash.mult.toFixed(2) });
            }
        } catch(e) { console.log(e); }
    });

    // MINES СОКЕТЫ
    socket.on('mines_start', async (data) => {
        if (!currentUser) return;
        try {
            let u = await User.findOne({ id: currentUser });
            let betAmount = parseFloat(data.bet);
            if (isNaN(betAmount) || betAmount < 0.5) return socket.emit('alert', 'Минимальная ставка 0.5');

            let balanceField = data.mode === 'real' ? 'realBal' : 'demoBal';
            if (u[balanceField] < betAmount) return socket.emit('alert', 'Недостаточно средств');

            u[balanceField] -= betAmount;
            u.games++;
            await u.save();

            let mineCount = data.mode === 'real' ? 5 : 3; // В реальном режиме больше мин
            let field = Array(25).fill('safe');
            let placed = 0;
            while (placed < mineCount) {
                let r = Math.floor(Math.random() * 25);
                if (field[r] !== 'mine') {
                    field[r] = 'mine';
                    placed++;
                }
            }

            socket.minesGame = { bet: betAmount, field: field, mult: 1.0, mode: data.mode, opened: 0 };
            socket.emit('user_data', u);
            socket.emit('mines_ready');
        } catch(e) { console.log(e); }
    });

    socket.on('mines_open', (idx) => {
        if (!socket.minesGame) return;
        if (socket.minesGame.field[idx] === 'mine') {
            socket.emit('mines_boom', socket.minesGame.field);
            socket.minesGame = null;
        } else {
            socket.minesGame.opened++;
            socket.minesGame.mult += 0.20; // Увеличение икса
            socket.emit('mines_safe', { idx: idx, mult: socket.minesGame.mult.toFixed(2) });
        }
    });

    socket.on('mines_cashout', async () => {
        if (!socket.minesGame || !currentUser) return;
        if (socket.minesGame.opened === 0) return socket.emit('alert', 'Откройте хотя бы одну ячейку!');
        try {
            let winAmount = socket.minesGame.bet * socket.minesGame.mult;
            let u = await User.findOne({ id: currentUser });
            let balanceField = socket.minesGame.mode === 'real' ? 'realBal' : 'demoBal';
            
            u[balanceField] += winAmount;
            u.wins++;
            await u.save();
            
            socket.emit('user_data', u);
            socket.emit('mines_win', { win: winAmount.toFixed(2) });
            socket.minesGame = null;
        } catch(e) { console.log(e); }
    });

    // АДМИНКА И ПРОМОКОДЫ
    socket.on('activate_promo', async (code) => {
        if (!currentUser) return;
        try {
            let p = await Promo.findOne({ code: code.toUpperCase() });
            let u = await User.findOne({ id: currentUser });
            if (p && p.currentUses < p.maxUses && !u.usedPromos.includes(p.code)) {
                u.realBal += p.reward;
                u.usedPromos.push(p.code);
                p.currentUses++;
                await u.save();
                await p.save();
                socket.emit('user_data', u);
                socket.emit('alert', '✅ Промокод успешно активирован!');
            } else {
                socket.emit('alert', '❌ Промокод недействителен или уже использован');
            }
        } catch(e) { console.log(e); }
    });

    socket.on('admin_action', async (data) => {
        if (data.pw !== '7788') return socket.emit('alert', 'Неверный пароль админа');
        if (data.action === 'create_promo') {
            try {
                await Promo.create({ code: data.code.toUpperCase(), reward: data.reward, maxUses: data.uses });
                socket.emit('alert', 'Промокод создан!');
            } catch(e) { socket.emit('alert', 'Ошибка создания промокода'); }
        } else if (data.action === 'get_stats') {
            let totalUsers = await User.countDocuments();
            socket.emit('admin_stats', { users: totalUsers });
        }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('online_update', onlineUsers.size);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
