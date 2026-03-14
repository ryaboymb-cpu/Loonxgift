require('dotenv').config();
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ПОДКЛЮЧЕНИЕ К MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// Схемы данных
const UserSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    username: String,
    photo: String,
    balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    history: { type: Array, default: [] }
});

const PromoSchema = new mongoose.Schema({
    code: String,
    amount: Number,
    limit: Number,
    uses: { type: Number, default: 0 },
    usedBy: [String]
});

const WithdrawSchema = new mongoose.Schema({
    userId: String,
    address: String,
    amount: Number,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

const SettingsSchema = new mongoose.Schema({
    key: String,
    rtp: { crash: Number, mines: Number, coinflip: Number }
});

const User = mongoose.model('User', UserSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

// Инициализация RTP если нет в базе
async function initSettings() {
    const s = await Settings.findOne({ key: 'global' });
    if (!s) await Settings.create({ key: 'global', rtp: { crash: 85, mines: 85, coinflip: 85 } });
}
initSettings();

// --- ТЕЛЕГРАМ БОТ ---
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: { autoStart: true, params: { drop_pending_updates: true } } });

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🚀 *Loonx Gift* — Играй и выигрывай TON!`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "🎮 ИГРАТЬ", web_app: { url: process.env.WEB_APP_URL } }]] }
    });
});

// --- API ---

// Авторизация
app.post('/api/auth', async (req, res) => {
    const { id, first_name, username, photo_url } = req.body;
    let user = await User.findOne({ id });
    if (!user) {
        user = await User.create({ id, username: username || first_name, photo: photo_url, balance: 0, demo_balance: 5000 });
    }
    const settings = await Settings.findOne({ key: 'global' });
    res.json({ user, rtp: settings.rtp });
});

// Ставки
app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, mode } = req.body;
    const user = await User.findOne({ id });
    const balField = mode === 'demo' ? 'demo_balance' : 'balance';

    if (!user || user[balField] < bet) return res.status(400).json({ error: "No money" });

    user[balField] = Number((user[balField] - bet + win).toFixed(2));
    const betEntry = { game, bet, win, mode, time: new Date().toLocaleTimeString(), username: user.username, photo: user.photo };
    
    user.history.unshift(betEntry);
    if (user.history.length > 10) user.history.pop();
    
    await user.save();
    io.emit('newLiveBet', betEntry); // Для ленты на главной
    res.json({ user });
});

// Админка: Создать промо
app.post('/api/admin/promo', async (req, res) => {
    const { code, amount, limit } = req.body;
    await Promo.create({ code, amount, limit });
    res.json({ success: true });
});

// Вывод
app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    const user = await User.findOne({ id });
    if (user.balance >= amount && amount >= 5) {
        user.balance -= amount;
        await user.save();
        await Withdraw.create({ userId: id, address, amount });
        res.json({ success: true });
    } else res.status(400).json({ error: "Low balance or min 5" });
});

// --- CRASH ENGINE (Общий для всех) ---
let crashData = { multiplier: 1.0, status: 'waiting', timer: 10 };
async function startCrash() {
    crashData.status = 'waiting';
    crashData.timer = 10;
    const timerInt = setInterval(() => {
        crashData.timer--;
        io.emit('crashTick', crashData);
        if (crashData.timer <= 0) {
            clearInterval(timerInt);
            runCrash();
        }
    }, 1000);
}

async function runCrash() {
    crashData.status = 'running';
    crashData.multiplier = 1.0;
    const settings = await Settings.findOne({ key: 'global' });
    const rtp = settings.rtp.crash / 100;
    const crashAt = Math.pow(100 / (100 - Math.random() * 99), rtp).toFixed(2);

    const runInt = setInterval(() => {
        crashData.multiplier = (parseFloat(crashData.multiplier) + 0.01).toFixed(2);
        io.emit('crashTick', crashData);
        if (parseFloat(crashData.multiplier) >= crashAt) {
            clearInterval(runInt);
            crashData.status = 'crashed';
            io.emit('crashTick', crashData);
            setTimeout(startCrash, 4000);
        }
    }, 100);
}
startCrash();

// Счетчик онлайна
let online = 0;
io.on('connection', (socket) => {
    online++;
    io.emit('onlineCount', online);
    socket.on('disconnect', () => { online--; io.emit('onlineCount', online); });
});

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server started'));
