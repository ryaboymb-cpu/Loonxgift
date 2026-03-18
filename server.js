require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const path = require('path');

// === КОНФИГУРАЦИЯ ИЗ ENV ===
const CONFIG = {
    PORT: process.env.PORT || 3000,
    MONGO_URI: process.env.MONGO_URI,
    BOT_TOKEN: process.env.BOT_TOKEN,
    ADMIN_PASS: process.env.ADMIN_PASS || "admin123",
    ADMIN_WALLET: process.env.ADMIN_WALLET || "UQ_YOUR_WALLET",
    WEB_APP_URL: process.env.WEB_APP_URL || "https://loonxgift.onrender.com",
    TON_API_KEY: process.env.TON_API_KEY
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Утилита времени МСК
const getMskTime = () => new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

// === МОДЕЛИ ДАННЫХ ===
const UserSchema = new mongoose.Schema({
    id: String,
    username: String,
    photo: String,
    isBlocked: { type: Boolean, default: false },
    balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats: { 
        bets: { type: Number, default: 0 }, 
        wins: { type: Number, default: 0 }, 
        plus: { type: Number, default: 0 }, 
        minus: { type: Number, default: 0 },
        promo: { type: Number, default: 0 }
    },
    // Краткая история в объекте юзера (из 2-й версии)
    betHistoryShort: [{ game: String, amount: Number, result: Number, mode: String, time: String }]
});

const BetSchema = new mongoose.Schema({
    userId: String, username: String, avatar: String, game: String, amount: Number,
    multiplier: Number, result: Number, mode: String,
    createdAt: { type: Date, default: Date.now }
});

const PromoSchema = new mongoose.Schema({ 
    code: String, amount: Number, limit: Number, 
    usedBy: [String], // список ID
    activations: { type: Number, default: 0 } 
});

const WithdrawSchema = new mongoose.Schema({ 
    userId: String, username: String, address: String, amount: Number, 
    status: { type: String, default: 'pending' }, 
    reason: String, time: String 
});

const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number });
const SettingsSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });

const User = mongoose.model('User', UserSchema);
const Bet = mongoose.model('Bet', BetSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let globalBetHistory = [];
let crashData = { status: 'waiting', multiplier: 1.0, timer: 5 }; // Ускоренный таймер 5с
let crashHistory = [];
let crashLiveBets = [];
let globalRtp = { crash: 90, mines: 90, coinflip: 90 };
let maintenance = { crash: false, mines: false, coinflip: false };

// === ИНИЦИАЛИЗАЦИЯ И СИСТЕМНЫЕ ФУНКЦИИ ===
async function initSystem() {
    const defaultSettings = [
        { key: 'rtp_crash', value: 90 }, { key: 'rtp_mines', value: 90 }, { key: 'rtp_coinflip', value: 90 },
        { key: 'maintenance_crash', value: false }, { key: 'maintenance_mines', value: false }, { key: 'maintenance_coinflip', value: false }
    ];
    for (let s of defaultSettings) {
        const exists = await Settings.findOne({ key: s.key });
        if (!exists) await Settings.create(s);
    }
    
    // Загрузка глобальной истории
    const lastBets = await Bet.find().sort({createdAt: -1}).limit(15);
    globalBetHistory = lastBets.reverse().map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleTimeString("ru-RU", {timeZone: "Europe/Moscow"})
    }));

    // Синхронизация локальных переменных RTP
    const allSettings = await Settings.find();
    allSettings.forEach(s => {
        if (s.key.startsWith('rtp_')) globalRtp[s.key.replace('rtp_', '')] = s.value;
        if (s.key.startsWith('maintenance_')) maintenance[s.key.replace('maintenance_', '')] = s.value;
    });
}
initSystem();

// ТЕЛЕГРАМ БОТ
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в Loonx Gifts.`, {
        reply_markup: {
            inline_keyboard: [[{ text: "🎮 ИГРАТЬ", web_app: { url: CONFIG.WEB_APP_URL } }]]
        }
    });
});

// === CRASH ENGINE (Ускоренный + RTP) ===
async function runCrashLogic() {
    setInterval(async () => {
        if (crashData.status === 'waiting') {
            crashData.timer -= 0.1;
            if (crashData.timer <= 0) {
                crashData.status = 'running';
                crashData.multiplier = 1.00;
                crashLiveBets = [];
                io.emit('crashBetsUpdate', []);
            }
        } else if (crashData.status === 'running') {
            // Ускоренный рост из твоей 2-й версии
            crashData.multiplier += (0.01 + (crashData.multiplier * 0.005));
            crashData.multiplier = parseFloat(crashData.multiplier.toFixed(2));

            let crashChance = Math.random() * 100;
            // Условие падения (зависит от RTP)
            if (crashChance > globalRtp.crash || crashData.multiplier > 100) {
                crashData.status = 'crashed';
                crashHistory.unshift(crashData.multiplier);
                if (crashHistory.length > 15) crashHistory.pop();
                
                // Обработка проигравших ставок
                for (let b of crashLiveBets) {
                    if (!b.cashedOut) {
                        const u = await User.findOne({ id: b.id });
                        if (u) {
                            const actualMode = b.mode === 'demo' ? 'Demo' : 'Real';
                            const newBet = new Bet({ userId: u.id, username: u.username, avatar: b.avatar, game: 'Crash', amount: b.bet, result: -b.bet, mode: actualMode });
                            await newBet.save();
                            pushToGlobalHistory(newBet);
                        }
                    }
                }

                io.emit('crashHistoryUpdate', crashHistory);
                setTimeout(() => { 
                    crashData = { status: 'waiting', multiplier: 1.0, timer: 5 }; 
                }, 4000);
            }
        }
        io.emit('crashData', crashData);
    }, 100);
}
runCrashLogic();

function pushToGlobalHistory(betObj) {
    const betWithTime = {
        ...(betObj.toObject ? betObj.toObject() : betObj),
        timeMsk: getMskTime()
    };
    globalBetHistory.push(betWithTime);
    if(globalBetHistory.length > 15) globalBetHistory.shift();
    io.emit('newHistoryEntry', betWithTime);
}

// === API ЭНДПОИНТЫ ===

// 1. TON CONNECT MANIFEST
app.get('/tonconnect-manifest.json', (req, res) => {
    res.json({
        url: CONFIG.WEB_APP_URL,
        name: "Loonx Gifts",
        iconUrl: `${CONFIG.WEB_APP_URL}/icon.png`
    });
});

// АУТЕНТИФИКАЦИЯ
app.post('/api/auth', async (req, res) => {
    const { id, username, first_name, photo_url } = req.body;
    let user = await User.findOne({ id: String(id) });
    
    if (!user) {
        user = await User.create({ id: String(id), username: username || first_name, photo: photo_url });
    } else {
        user.username = username || first_name;
        user.photo = photo_url;
        await user.save();
    }

    if(user.isBlocked) return res.status(403).json({ error: "BLOCKED" });
    res.json({ user, rtp: globalRtp, maintenance, adminWallet: CONFIG.ADMIN_WALLET });
});

// СТАВКИ
app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, multiplier, mode } = req.body;
    const user = await User.findOne({ id: String(id) });
    
    if (!user || user.isBlocked) return res.status(403).send();
    
    const actualMode = mode === 'demo' ? 'demo' : 'real';
    const field = actualMode === 'demo' ? 'demo_balance' : 'balance';
    
    if (user[field] < bet) return res.status(400).json({error: 'No money'});

    const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

    if (game === 'Crash') {
        if (win === 0 && bet > 0) { // Вход в игру
            crashLiveBets.push({ id: user.id, username: user.username, avatar, bet, cashedOut: false, win: 0, mode: actualMode });
            io.emit('crashBetsUpdate', crashLiveBets);
            user[field] -= bet;
            if (actualMode === 'real') { user.stats.bets++; user.stats.minus += bet; }
        } else if (win > 0) { // Кешаут
            const activeBet = crashLiveBets.find(b => b.id === user.id && !b.cashedOut);
            if (!activeBet) return res.status(400).json({error: 'Not found'});
            
            activeBet.cashedOut = true;
            activeBet.win = win;
            io.emit('crashBetsUpdate', crashLiveBets);
            
            user[field] += win;
            if (actualMode === 'real') { user.stats.wins++; user.stats.plus += (win - bet); }
            
            const profit = win - bet;
            const newBetEntry = new Bet({ userId: user.id, username: user.username, avatar, game: 'Crash', amount: bet, result: profit, mode: actualMode === 'demo' ? 'Demo' : 'Real' });
            await newBetEntry.save();
            pushToGlobalHistory(newBetEntry);
        }
    } else {
        // Логика для Mines / Coinflip
        const profit = win - bet;
        user[field] = Number((user[field] - bet + win).toFixed(2));
        
        if (actualMode === 'real') {
            user.stats.bets++;
            if (win > 0) { user.stats.wins++; user.stats.plus += profit; }
            else { user.stats.minus += bet; }
        }

        const newBetEntry = new Bet({
            userId: user.id, username: user.username, avatar, game, amount: bet,
            multiplier: multiplier || (bet > 0 ? (win / bet).toFixed(2) : 0),
            result: profit, mode: actualMode === 'demo' ? 'Demo' : 'Real'
        });
        await newBetEntry.save();
        pushToGlobalHistory(newBetEntry);
    }

    await user.save();
    res.json(user);
});

// ПРОМОКОДЫ
app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    const promo = await Promo.findOne({ code });
    const user = await User.findOne({ id: String(id) });
    
    if(!promo || promo.activations >= promo.limit || promo.usedBy.includes(id)) return res.status(400).send();
    
    user.balance += promo.amount;
    user.stats.promo += promo.amount;
    promo.activations += 1;
    promo.usedBy.push(id);
    
    await promo.save(); await user.save();
    res.json(user);
});

// ВЫВОД
app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    const user = await User.findOne({ id: String(id) });
    if (user.balance < amount || amount < 5) return res.status(400).send();
    
    user.balance -= amount;
    await user.save();
    
    await Withdraw.create({ 
        userId: id, username: user.username, address, amount, 
        status: 'pending', time: getMskTime() 
    });
    res.json(user);
});

// === АДМИН-ПАНЕЛЬ (ЗАЩИЩЕННАЯ) ===
const checkAdmin = (req, res, next) => {
    if (req.body.pass !== CONFIG.ADMIN_PASS) return res.status(403).json({ error: 'Wrong pass' });
    next();
};

app.post('/api/admin/data', checkAdmin, async (req, res) => {
    const withdraws = await Withdraw.find({ status: 'pending' });
    const users = await User.find().sort({ balance: -1 }).limit(100);
    const promos = await Promo.find();
    res.json({ withdraws, users, promos, rtp: globalRtp, maintenance });
});

app.post('/api/admin/user_action', checkAdmin, async (req, res) => {
    const { userId, action, msg } = req.body;
    const user = await User.findOne({ id: String(userId) });
    if (!user) return res.status(404).send();

    if (action === 'ban') user.isBlocked = true;
    if (action === 'unban') user.isBlocked = false;
    if (action === 'message' && msg) {
        bot.sendMessage(userId, `📩 Сообщение от Администрации:\n\n${msg}`).catch(() => {});
    }
    await user.save();
    res.json({ success: true });
});

app.post('/api/admin/broadcast_bot', checkAdmin, async (req, res) => {
    const users = await User.find({ isBlocked: false });
    let count = 0;
    for (const u of users) {
        try {
            await bot.sendMessage(u.id, `📢 Уведомление:\n\n${req.body.text}`);
            count++;
        } catch (e) {}
    }
    res.json({ success: true, count });
});

app.post('/api/admin/set_rtp', checkAdmin, async (req, res) => {
    const { game, value } = req.body;
    const key = `rtp_${game}`;
    await Settings.updateOne({ key }, { value: Number(value) }, { upsert: true });
    globalRtp[game] = Number(value);
    res.json({ success: true });
});

// === SOCKETS ===
io.on('connection', (socket) => {
    io.emit('online', io.engine.clientsCount);
    socket.emit('init_history', globalBetHistory);
    socket.emit('crashHistoryUpdate', crashHistory);
    
    socket.on('disconnect', () => {
        io.emit('online', io.engine.clientsCount);
    });
});

// ЗАПУСК
server.listen(CONFIG.PORT, () => {
    console.log(`
    🚀 Loonx Gifts Server Started
    ----------------------------
    Port: ${CONFIG.PORT}
    Admin Pass: ${CONFIG.ADMIN_PASS}
    Crash Timer: 5s (Fast)
    ----------------------------
    `);
});
