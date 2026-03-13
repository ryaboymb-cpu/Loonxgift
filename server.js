require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- КОНФИГУРАЦИЯ ---
const TOKEN = process.env.BOT_TOKEN || "ТВОЙ_ТОКЕН_БОТА";
const MONGO_URI = process.env.MONGO_URI || "ТВОЯ_ССЫЛКА_MONGO";
const bot = new TelegramBot(TOKEN, { polling: true });

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ DB Error:", err));

// --- МОДЕЛИ ДАННЫХ ---
const UserSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    first_name: String,
    username: String,
    photo_url: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 500 },
    stats_games: { type: Number, default: 0 },
    stats_wins: { type: Number, default: 0 },
    total_dep: { type: Number, default: 0 },
    total_out: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    lastDaily: { type: Date, default: null }
});
const User = mongoose.model('User', UserSchema);

const WithdrawSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    tgId: Number,
    username: String,
    amount: Number,
    address: String,
    status: { type: String, default: 'pending' }, // pending, approved, rejected
    createdAt: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

const PromoSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    reward: Number,
    limit: Number,
    uses: { type: Number, default: 0 },
    usedBy: [Number] // Массив ID юзеров
});
const Promo = mongoose.model('Promo', PromoSchema);

const SettingsSchema = new mongoose.Schema({
    rtp_crash: { type: Number, default: 0.95 },
    rtp_mines: { type: Number, default: 0.95 },
    rtp_coin: { type: Number, default: 0.50 },
    crash_enabled: { type: Boolean, default: true },
    mines_enabled: { type: Boolean, default: true },
    coin_enabled: { type: Boolean, default: true }
});
const Settings = mongoose.model('Settings', SettingsSchema);

app.use(express.static('public'));

// --- СОСТОЯНИЕ ИГРЫ CRASH ---
let crashState = {
    status: 'waiting', // waiting, running, crashed
    multiplier: 1.0,
    history: [],
    bets: [] // { userId, socketId, amount, mode, username, photo, cashedOut: false }
};

// Инициализация настроек
async function getSettings() {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    return s;
}

// --- ЛОГИКА CRASH ---
async function runCrash() {
    const s = await getSettings();
    if (!s.crash_enabled) return setTimeout(runCrash, 5000);

    crashState.status = 'waiting';
    crashState.multiplier = 1.0;
    crashState.bets = [];
    io.emit('crash_new_round');

    // Ожидание ставок 5 сек
    let waitTime = 5;
    const waitInterval = setInterval(() => {
        waitTime--;
        if (waitTime <= 0) {
            clearInterval(waitInterval);
            startFlight();
        }
    }, 1000);
}

function startFlight() {
    crashState.status = 'running';
    // Генерация точки взрыва (на основе RTP)
    const rtp = 0.95; 
    const crashPoint = Math.max(1, (1 / (1 - Math.random() * rtp)).toFixed(2));
    
    const interval = setInterval(() => {
        crashState.multiplier += 0.01 + (crashState.multiplier * 0.005);
        io.emit('crash_tick', crashState.multiplier);

        if (crashState.multiplier >= crashPoint) {
            clearInterval(interval);
            crashState.status = 'crashed';
            crashState.history.unshift(parseFloat(crashPoint).toFixed(2));
            if (crashState.history.length > 10) crashState.history.pop();
            io.emit('crash_end', { multiplier: crashPoint, history: crashState.history });
            setTimeout(runCrash, 3000);
        }
    }, 100);
}

runCrash();

// --- SOCKET ИВЕНТЫ ---
io.on('connection', async (socket) => {
    // Счетчик онлайна
    io.emit('online_count', io.engine.clientsCount);

    socket.on('auth', async (tgData) => {
        if (!tgData || !tgData.id) return;
        let user = await User.findOne({ tgId: tgData.id });
        if (!user) {
            user = await User.create({
                tgId: tgData.id,
                first_name: tgData.first_name,
                username: tgData.username || 'User',
                photo_url: tgData.photo_url || ''
            });
        }
        socket.userId = user._id;
        socket.tgId = user.tgId;
        socket.emit('user_data', user);
        socket.emit('crash_init', { history: crashState.history });
    });

    // --- CRASH BETS ---
    socket.on('crash_bet', async (data) => {
        if (crashState.status !== 'waiting') return socket.emit('toast', {text: 'Раунд уже идет', type: 'error'});
        const user = await User.findById(socket.userId);
        const amount = parseFloat(data.amount);
        const mode = data.mode; // 'real' or 'demo'

        if (isNaN(amount) || amount < 0.1) return socket.emit('toast', {text: 'Мин. ставка 0.1', type: 'error'});

        if (mode === 'real') {
            if (user.real_balance < amount) return socket.emit('toast', {text: 'Недостаточно TON', type: 'error'});
            user.real_balance -= amount;
        } else {
            if (user.demo_balance < amount) return socket.emit('toast', {text: 'Недостаточно D-TON', type: 'error'});
            user.demo_balance -= amount;
        }
        
        user.stats_games += 1;
        await user.save();

        crashState.bets.push({
            userId: user._id,
            socketId: socket.id,
            amount,
            mode,
            username: user.username,
            photo: user.photo_url,
            cashedOut: false
        });

        io.emit('crash_update_bets', crashState.bets);
        socket.emit('user_data', user);
        socket.emit('toast', {text: 'Ставка принята', type: 'success'});
    });

    socket.on('crash_cashout', async () => {
        if (crashState.status !== 'running') return;
        const bet = crashState.bets.find(b => b.socketId === socket.id && !b.cashedOut);
        if (!bet) return;

        bet.cashedOut = true;
        const winAmount = bet.amount * crashState.multiplier;
        const user = await User.findById(socket.userId);

        if (bet.mode === 'real') user.real_balance += winAmount;
        else user.demo_balance += winAmount;

        user.stats_wins += 1;
        await user.save();

        socket.emit('user_data', user);
        socket.emit('toast', {text: `Выиграно: +${winAmount.toFixed(2)}`, type: 'success'});
        io.emit('crash_update_bets', crashState.bets);
    });

    // --- COINFLIP ---
    socket.on('coin_play', async (data) => {
        const s = await getSettings();
        if (!s.coin_enabled) return socket.emit('toast', {text: 'Игра отключена', type: 'info'});

        const user = await User.findById(socket.userId);
        const amount = parseFloat(data.amount);
        const mode = data.mode;

        if (mode === 'real' && user.real_balance < amount) return socket.emit('toast', {text: 'Мало TON', type: 'error'});
        if (mode === 'demo' && user.demo_balance < amount) return socket.emit('toast', {text: 'Мало D-TON', type: 'error'});

        // Снимаем деньги
        if (mode === 'real') user.real_balance -= amount;
        else user.demo_balance -= amount;
        user.stats_games += 1;

        // Определяем результат (RTP)
        const isWin = Math.random() < s.rtp_coin;
        const winSide = isWin ? data.side : (data.side === 'L' ? 'X' : 'L');
        const prize = amount * 1.95;

        if (isWin) {
            if (mode === 'real') user.real_balance += prize;
            else user.demo_balance += prize;
            user.stats_wins += 1;
        }

        await user.save();
        
        // Отправка результата с задержкой для анимации
        setTimeout(() => {
            socket.emit('coin_result', { win: isWin, winSide, prize: prize.toFixed(2), cur: mode === 'real' ? 'TON' : 'D-TON' });
            socket.emit('user_data', user);
        }, 1500);
    });

    // --- ПРОМОКОДЫ ---
    socket.on('activate_promo', async (code) => {
        const promo = await Promo.findOne({ code: code.toUpperCase() });
        if (!promo) return socket.emit('toast', {text: 'Код не найден', type: 'error'});
        if (promo.uses >= promo.limit) return socket.emit('toast', {text: 'Лимит исчерпан', type: 'error'});
        if (promo.usedBy.includes(socket.tgId)) return socket.emit('toast', {text: 'Уже активирован', type: 'error'});

        const user = await User.findById(socket.userId);
        user.real_balance += promo.reward;
        promo.uses += 1;
        promo.usedBy.push(socket.tgId);
        
        await user.save();
        await promo.save();

        socket.emit('user_data', user);
        socket.emit('toast', {text: `Бонус +${promo.reward} TON начислен!`, type: 'success'});
    });

    // --- ВЫВОДЫ ---
    socket.on('request_withdraw', async (data) => {
        const user = await User.findById(socket.userId);
        const amount = parseFloat(data.amount);
        if (amount < 5) return socket.emit('toast', {text: 'Мин. вывод 5 TON', type: 'error'});
        if (user.real_balance < amount) return socket.emit('toast', {text: 'Недостаточно баланса', type: 'error'});

        user.real_balance -= amount;
        user.total_out += amount;
        await user.save();

        await Withdraw.create({
            userId: user._id,
            tgId: user.tgId,
            username: user.username,
            amount: amount,
            address: data.address
        });

        socket.emit('user_data', user);
        socket.emit('toast', {text: 'Заявка отправлена в админ-панель', type: 'success'});
    });

    // --- АДМИН-ПАНЕЛЬ (УПРАВЛЕНИЕ) ---
    socket.on('admin_load_data', async () => {
        const user = await User.findById(socket.userId);
        if (!user.isAdmin) return;

        const users = await User.find().limit(50);
        const withdraws = await Withdraw.find({ status: 'pending' });
        const promos = await Promo.find();
        const settings = await getSettings();

        socket.emit('admin_data_res', { users, withdraws, promos, settings });
    });

    socket.on('admin_save_settings', async (data) => {
        const user = await User.findById(socket.userId);
        if (!user.isAdmin) return;

        await Settings.updateOne({}, data);
        socket.emit('toast', {text: 'Настройки сохранены', type: 'success'});
    });

    socket.on('admin_create_promo', async (data) => {
        try {
            await Promo.create({
                code: data.code.toUpperCase(),
                reward: data.reward,
                limit: data.limit
            });
            socket.emit('toast', {text: 'Промокод создан', type: 'success'});
        } catch (e) {
            socket.emit('toast', {text: 'Ошибка создания', type: 'error'});
        }
    });

    socket.on('disconnect', () => {
        io.emit('online_count', io.engine.clientsCount);
    });
});

// --- ТЕЛЕГРАМ БОТ ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🚀 *Добро пожаловать в Loonx Gifts!* \n\nИграй в Crash, Mines и CoinFlip на реальные TON! \n\n🎁 Используй бонус в профиле.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔥 ИГРАТЬ", web_app: { url: "https://твой-домен.render.com" } }],
                [{ text: "📢 Наш канал", url: "https://t.me/Loonxnews" }]
            ]
        }
    });
});

// Если хочешь сделать себя админом, напиши боту /makeadmin
bot.onText(/\/makeadmin/, async (msg) => {
    await User.updateOne({ tgId: msg.from.id }, { isAdmin: true });
    bot.sendMessage(msg.chat.id, "✅ Ты назначен администратором!");
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Loonx Gifts Server running on port ${PORT}`);
});
