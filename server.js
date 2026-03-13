require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// --- ПОДКЛЮЧЕНИЕ КОНФИГУРАЦИИ ---
const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const bot = new TelegramBot(TOKEN, { polling: true });

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB успешно подключена"))
    .catch(err => console.error("❌ Ошибка MongoDB:", err));

// --- МОДЕЛИ ДАННЫХ ---
const UserSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    first_name: String,
    username: String,
    photo_url: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats_games: { type: Number, default: 0 },
    stats_wins: { type: Number, default: 0 },
    total_dep: { type: Number, default: 0 },
    total_out: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    banned: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const WithdrawSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    tgId: Number,
    username: String,
    amount: Number,
    address: String,
    status: { type: String, default: 'pending' }, // pending, success, rejected
    date: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

const PromoSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    reward: Number,
    limit: Number,
    uses: { type: Number, default: 0 },
    claimedBy: [Number] 
});
const Promo = mongoose.model('Promo', PromoSchema);

const SettingsSchema = new mongoose.Schema({
    rtp_crash: { type: Number, default: 0.95 },
    rtp_mines: { type: Number, default: 0.95 },
    rtp_coin: { type: Number, default: 0.5 },
    maintenance: { type: Boolean, default: false }
});
const Settings = mongoose.model('Settings', SettingsSchema);

app.use(express.static('public'));

// --- СОСТОЯНИЕ ИГРЫ CRASH ---
let crashState = {
    status: 'waiting', // waiting, flying, crashed
    multiplier: 1.0,
    history: [],
    currentBets: [],
    timer: 10
};

// Функция инициализации настроек
async function initSettings() {
    let s = await Settings.findOne();
    if (!s) await Settings.create({});
}
initSettings();

// --- ЦИКЛ ИГРЫ CRASH ---
async function startCrashCycle() {
    const config = await Settings.findOne();
    
    // 1. Ожидание ставок
    crashState.status = 'waiting';
    crashState.multiplier = 1.0;
    crashState.currentBets = [];
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

    // Генерация точки взрыва на основе RTP
    const rtp = 0.95; 
    const crashPoint = Math.max(1, (1 / (1 - Math.random() * rtp)).toFixed(2));
    
    const flight = setInterval(() => {
        crashState.multiplier += (crashState.multiplier * 0.005) + 0.01;
        io.emit('crash_tick', crashState.multiplier);

        if (crashState.multiplier >= crashPoint) {
            clearInterval(flight);
            doCrash(crashPoint);
        }
    }, 100);
}

function doCrash(point) {
    crashState.status = 'crashed';
    crashState.history.unshift(point);
    if (crashState.history.length > 15) crashState.history.pop();
    
    io.emit('crash_end', { point, history: crashState.history });
    setTimeout(startCrashCycle, 4000); // Пауза перед новым раундом
}

startCrashCycle();

// --- SOCKET.IO ЛОГИКА ---
io.on('connection', async (socket) => {
    // Реальный онлайн
    io.emit('online_count', io.engine.clientsCount);

    socket.on('auth', async (data) => {
        if (!data || !data.id) return;
        let user = await User.findOne({ tgId: data.id });
        if (!user) {
            user = await User.create({
                tgId: data.id,
                first_name: data.first_name,
                username: data.username || 'User',
                photo_url: data.photo_url || ''
            });
        }
        socket.userId = user._id;
        socket.emit('user_data', user);
        socket.emit('crash_init', { history: crashState.history });
    });

    // Ставка в Краше
    socket.on('crash_bet', async (data) => {
        if (crashState.status !== 'waiting') return socket.emit('toast', {text: 'Раунд уже начался', type: 'error'});
        
        const user = await User.findById(socket.userId);
        const amount = parseFloat(data.amount);
        const mode = data.mode; // 'real' / 'demo'

        if (mode === 'real') {
            if (user.real_balance < amount) return socket.emit('toast', {text: 'Недостаточно TON', type: 'error'});
            user.real_balance -= amount;
        } else {
            if (user.demo_balance < amount) return socket.emit('toast', {text: 'Недостаточно D-TON', type: 'error'});
            user.demo_balance -= amount;
        }

        user.stats_games += 1;
        await user.save();

        const betEntry = {
            id: socket.id,
            username: user.username,
            photo: user.photo_url,
            amount: amount,
            mode: mode,
            cashedOut: false,
            win: 0
        };

        crashState.currentBets.push(betEntry);
        io.emit('crash_update_bets', crashState.currentBets);
        socket.emit('user_data', user);
        socket.emit('toast', {text: 'Ставка поставлена', type: 'info'});
    });

    // Забрать в Краше
    socket.on('crash_cashout', async () => {
        if (crashState.status !== 'flying') return;
        const bet = crashState.currentBets.find(b => b.id === socket.id && !b.cashedOut);
        if (!bet) return;

        bet.cashedOut = true;
        bet.win = (bet.amount * crashState.multiplier).toFixed(2);
        
        const user = await User.findById(socket.userId);
        if (bet.mode === 'real') user.real_balance += parseFloat(bet.win);
        else user.demo_balance += parseFloat(bet.win);
        
        user.stats_wins += 1;
        await user.save();

        socket.emit('user_data', user);
        socket.emit('toast', {text: `Выигрыш +${bet.win}`, type: 'success'});
        io.emit('crash_update_bets', crashState.currentBets);
    });

    // CoinFlip Логика
    socket.on('coin_play', async (data) => {
        const user = await User.findById(socket.userId);
        const amount = parseFloat(data.amount);
        const mode = data.mode;
        
        if (mode === 'real' && user.real_balance < amount) return socket.emit('toast', {text: 'Мало TON', type: 'error'});
        if (mode === 'demo' && user.demo_balance < amount) return socket.emit('toast', {text: 'Мало D-TON', type: 'error'});

        if (mode === 'real') user.real_balance -= amount;
        else user.demo_balance -= amount;

        const set = await Settings.findOne();
        const isWin = Math.random() < set.rtp_coin;
        const winSide = isWin ? data.side : (data.side === 'L' ? 'X' : 'L');
        
        user.stats_games += 1;
        if (isWin) {
            const prize = amount * 1.95;
            if (mode === 'real') user.real_balance += prize;
            else user.demo_balance += prize;
            user.stats_wins += 1;
            setTimeout(() => {
                socket.emit('coin_result', { win: true, winSide, prize: prize.toFixed(2), cur: mode === 'real' ? 'TON' : 'D-TON' });
                socket.emit('user_data', user);
            }, 1500);
        } else {
            setTimeout(() => {
                socket.emit('coin_result', { win: false, winSide });
                socket.emit('user_data', user);
                socket.emit('toast', {text: 'Ставка проиграла', type: 'error'});
            }, 1500);
        }
        await user.save();
    });

    // Заявка на вывод
    socket.on('request_withdraw', async (data) => {
        const user = await User.findById(socket.userId);
        const amount = parseFloat(data.amount);
        if (amount < 5) return socket.emit('toast', {text: 'Мин. вывод 5 TON', type: 'error'});
        if (user.real_balance < amount) return socket.emit('toast', {text: 'Недостаточно средств', type: 'error'});

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
        socket.emit('toast', {text: 'Заявка на вывод создана', type: 'success'});
    });

    // АДМИНКА
    socket.on('admin_load_data', async () => {
        const user = await User.findById(socket.userId);
        if (!user || !user.isAdmin) return;

        const users = await User.find().sort({_id: -1}).limit(100);
        const withdraws = await Withdraw.find({status: 'pending'});
        const promos = await Promo.find();
        const config = await Settings.findOne();

        socket.emit('admin_data_res', { users, withdraws, promos, config });
    });

    socket.on('admin_update_rtp', async (data) => {
        const user = await User.findById(socket.userId);
        if (!user.isAdmin) return;
        await Settings.updateOne({}, data);
        socket.emit('toast', {text: 'Настройки обновлены', type: 'success'});
    });

    socket.on('admin_withdraw_action', async (data) => {
        const user = await User.findById(socket.userId);
        if (!user.isAdmin) return;
        
        const req = await Withdraw.findById(data.id);
        if (data.action === 'approve') {
            req.status = 'success';
        } else {
            req.status = 'rejected';
            // Возврат средств пользователю
            await User.updateOne({tgId: req.tgId}, {$inc: {real_balance: req.amount}});
        }
        await req.save();
        socket.emit('toast', {text: 'Статус вывода изменен', type: 'info'});
    });

    socket.on('disconnect', () => {
        io.emit('online_count', io.engine.clientsCount);
    });
});

// --- ТЕЛЕГРАМ БОТ ---
bot.onText(/\/start/, async (msg) => {
    const welcomeText = `🚀 *Добро пожаловать в Loonx Gifts!* \n\nИграй в Crash, Mines и CoinFlip в одном приложении. \n\n💎 Быстрые выплаты в TON \n🎁 Ежедневные бонусы \n📈 Прозрачные коэффициенты`;
    
    bot.sendMessage(msg.chat.id, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Начать игру", web_app: { url: process.env.WEBAPP_URL } }],
                [{ text: "📢 Наш канал", url: "https://t.me/Loonxnews" }, { text: "💬 Саппорт", url: "https://t.me/LoonxGift_Support" }]
            ]
        }
    });
});

// Админ команда для себя
bot.onText(/\/setadmin/, async (msg) => {
    // В реальном проекте тут нужна проверка на твой ID
    await User.updateOne({ tgId: msg.from.id }, { isAdmin: true });
    bot.sendMessage(msg.chat.id, "✅ Вы назначены администратором Loonx Gifts.");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
