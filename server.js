const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

// --- НАСТРОЙКИ ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = "7788";

// Подключение к MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Подключена"))
    .catch(err => console.log("❌ Ошибка MongoDB:", err));

// --- СХЕМЫ БАЗЫ ДАННЫХ ---
const userSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    username: String,
    firstName: String,
    photo: String,
    realBal: { type: Number, default: 0 },
    demoBal: { type: Number, default: 200 },
    dailyBonus: { type: Number, default: 0 }, // Timestamp последнего бонуса
    stats: { games: { type: Number, default: 0 }, wins: { type: Number, default: 0 } },
    spent: { type: Number, default: 0 }, // Потрачено
    withdrawn: { type: Number, default: 0 } // Выведено
});
const User = mongoose.model('User', userSchema);

const withdrawSchema = new mongoose.Schema({
    userId: String,
    firstName: String,
    wallet: String,
    amount: Number,
    status: { type: String, default: 'pending' }, // pending, approved, rejected
    date: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

const promoSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    amount: Number,
    uses: Number,
    activatedBy: [String] // Массив ID юзеров
});
const Promo = mongoose.model('Promo', promoSchema);

// Глобальные настройки системы (RTP и Техработы)
let sysSettings = {
    crashRtp: 0.90, minesRtp: 0.88, coinWinChance: 0.35,
    crashActive: true, minesActive: true, coinActive: true
};

// --- ТЕЛЕГРАМ БОТ ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
    const welcome = `🪙 Добро пожаловать в Loonx Gift!\nЛучшие игры уже ждут тебя.`;
    bot.sendMessage(msg.chat.id, welcome, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🫧 ЗАПУСТИТЬ ИГРЫ 🫧", web_app: { url: "https://loonxgift.onrender.com" } }],
                [{ text: "📢 Новости", url: "https://t.me/Loonxnews" }]
            ]
        }
    });
});

bot.onText(/\/help/, (msg) => {
    const helpMsg = `<b>Связь с администрацией Loonx Gift:</b>\n\n` +
        `Creator: @tonfrm\n` +
        `Channel: @Loonxnews\n` +
        `Support: @LoonxGift_Support\n` +
        `Bugs: @msgp2p`;
    bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: 'HTML' });
});

app.use(express.static(path.join(__dirname, 'public')));

// --- ЛОГИКА CRASH ---
let crash = { status: 'waiting', timer: 10, mult: 1.00, crashAt: 0, history: [] };

function runCrashTick() {
    if (crash.status === 'waiting') {
        if (crash.timer > 0) crash.timer -= 0.1;
        else {
            crash.status = 'flying';
            crash.mult = 1.00;
            crash.crashAt = Math.random() < 0.1 ? 1.00 : (sysSettings.crashRtp / (1 - Math.random())).toFixed(2);
        }
    } else if (crash.status === 'flying') {
        let speed = crash.mult < 2 ? 0.01 : crash.mult < 5 ? 0.03 : 0.08;
        crash.mult = parseFloat((crash.mult + speed).toFixed(2));
        if (crash.mult >= crash.crashAt) {
            crash.status = 'crashed';
            crash.history.unshift(crash.mult.toFixed(2));
            if(crash.history.length > 10) crash.history.pop();
            io.emit('crash_boom', { mult: crash.mult, history: crash.history });
            setTimeout(() => { crash.status = 'waiting'; crash.timer = 10; crash.mult = 1.00; }, 4000);
        }
    }
    io.emit('crash_tick', { status: crash.status, timer: Math.ceil(crash.timer), mult: crash.mult });
}
setInterval(runCrashTick, 100);

let liveHistory = [];
function addLiveHistory(name, photo, game, bet, win, isWin) {
    liveHistory.unshift({ name, photo, game, bet, win, isWin });
    if(liveHistory.length > 15) liveHistory.pop();
    io.emit('history_update', liveHistory);
}

// --- СОКЕТЫ (ИГРЫ И АДМИНКА) ---
io.on('connection', (socket) => {
    
    // Инициализация
    socket.on('init', async (data) => {
        let u = await User.findOne({ id: data.id });
        if (!u) u = await User.create({ id: data.id, username: data.username, firstName: data.name, photo: data.photo });
        socket.userId = u.id;
        socket.emit('user_update', u);
        socket.emit('history_update', liveHistory);
        socket.emit('sys_settings', sysSettings);
    });

    // --- ЛИМИТЫ СТАВОК ---
    function checkBet(bet) {
        return bet >= 0.5 && bet <= 20;
    }

    // --- ЕЖЕДНЕВНЫЙ БОНУС ---
    socket.on('claim_daily', async () => {
        const u = await User.findOne({ id: socket.userId });
        const now = Date.now();
        if (now - u.dailyBonus >= 24 * 60 * 60 * 1000) { // 24 часа
            u.demoBal += 200;
            u.dailyBonus = now;
            await u.save();
            socket.emit('user_update', u);
            socket.emit('toast', { msg: '✅ Получено 200 DEMO TON!', type: 'success' });
        } else {
            socket.emit('toast', { msg: '❌ Бонус можно брать раз в 24 часа', type: 'error' });
        }
    });

    // --- COINFLIP ---
    socket.on('play_coin', async (data) => {
        if (!sysSettings.coinActive) return socket.emit('toast', { msg: '🛠 Игра на тех. обслуживании', type: 'error' });
        if (!checkBet(data.bet)) return socket.emit('toast', { msg: '❌ Ставка от 0.5 до 20 TON', type: 'error' });

        const u = await User.findOne({ id: socket.userId });
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[balKey] < data.bet) return socket.emit('toast', { msg: '❌ Недостаточно средств', type: 'error' });

        u[balKey] -= data.bet;
        if(data.mode === 'real') u.spent += data.bet;
        u.stats.games++;

        const isWin = Math.random() < sysSettings.coinWinChance;
        const resultSide = isWin ? data.side : (data.side === 'L' ? 'X' : 'L');
        let winAmount = isWin ? data.bet * 1.9 : 0;

        if (isWin) { u[balKey] += winAmount; u.stats.wins++; }
        await u.save();

        addLiveHistory(u.firstName, u.photo, 'Coinflip', data.bet, winAmount, isWin);
        socket.emit('coin_res', { isWin, resultSide });
        socket.emit('user_update', u);
    });

    // --- MINES ---
    socket.on('start_mines', async (data) => {
        if (!sysSettings.minesActive) return socket.emit('toast', { msg: '🛠 Игра на тех. обслуживании', type: 'error' });
        if (!checkBet(data.bet)) return socket.emit('toast', { msg: '❌ Ставка от 0.5 до 20 TON', type: 'error' });

        const u = await User.findOne({ id: socket.userId });
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[balKey] < data.bet) return socket.emit('toast', { msg: '❌ Недостаточно средств', type: 'error' });

        u[balKey] -= data.bet;
        if(data.mode === 'real') u.spent += data.bet;
        await u.save();

        let field = Array(25).fill('safe');
        let m = 0; while(m < data.mCount) { let r = Math.floor(Math.random()*25); if(field[r] === 'safe') { field[r] = 'mine'; m++; } }
        
        socket.activeMines = { field, bet: data.bet, balKey, opened: 0, mult: 1.00, mCount: data.mCount };
        socket.emit('user_update', u);
        socket.emit('mines_ready');
        socket.emit('toast', { msg: '✅ Ставка принята', type: 'success' });
    });

    socket.on('open_mine', (idx) => {
        const g = socket.activeMines;
        if(!g) return;
        if(g.field[idx] === 'mine') {
            socket.emit('mines_fail', g.field);
            delete socket.activeMines;
        } else {
            g.opened++;
            g.mult = (g.mult * (1 + (g.mCount / 28))).toFixed(2);
            socket.emit('mine_hit', { idx, mult: g.mult });
        }
    });

    socket.on('mines_cashout', async () => {
        const g = socket.activeMines;
        if(g && g.opened > 0) {
            const u = await User.findOne({ id: socket.userId });
            const win = g.bet * g.mult;
            u[g.balKey] += win;
            u.stats.wins++;
            await u.save();
            addLiveHistory(u.firstName, u.photo, 'Mines', g.bet, win, true);
            socket.emit('user_update', u);
            socket.emit('mines_win');
            socket.emit('toast', { msg: `✅ Ставка забрана: +${win.toFixed(2)}`, type: 'success' });
            delete socket.activeMines;
        }
    });

    // --- CRASH ---
    socket.on('crash_place_bet', async (data) => {
        if (!sysSettings.crashActive) return socket.emit('toast', { msg: '🛠 Игра на тех. обслуживании', type: 'error' });
        if (crash.status !== 'waiting') return socket.emit('toast', { msg: '❌ Ждите след. раунда', type: 'error' });
        if (!checkBet(data.bet)) return socket.emit('toast', { msg: '❌ Ставка от 0.5 до 20 TON', type: 'error' });

        const u = await User.findOne({ id: socket.userId });
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[balKey] < data.bet) return socket.emit('toast', { msg: '❌ Недостаточно средств', type: 'error' });

        u[balKey] -= data.bet;
        if(data.mode === 'real') u.spent += data.bet;
        await u.save();

        socket.currentCrash = { bet: data.bet, balKey };
        socket.emit('user_update', u);
        socket.emit('crash_bet_ok');
        socket.emit('toast', { msg: '✅ Ставка принята', type: 'success' });
    });

    socket.on('crash_cashout', async () => {
        if (crash.status === 'flying' && socket.currentCrash) {
            const u = await User.findOne({ id: socket.userId });
            const win = socket.currentCrash.bet * crash.mult;
            u[socket.currentCrash.balKey] += win;
            u.stats.wins++;
            await u.save();

            addLiveHistory(u.firstName, u.photo, 'Crash', socket.currentCrash.bet, win, true);
            socket.emit('user_update', u);
            socket.emit('toast', { msg: `✅ Ставка забрана: +${win.toFixed(2)}`, type: 'success' });
            delete socket.currentCrash;
        }
    });

    // --- ДЕПОЗИТ (TON CONNECT) ---
    socket.on('deposit_success', async (amount) => {
        const u = await User.findOne({ id: socket.userId });
        u.realBal += parseFloat(amount);
        await u.save();
        socket.emit('user_update', u);
        socket.emit('toast', { msg: `✅ Депозит ${amount} TON зачислен!`, type: 'success' });
    });

    // --- ВЫВОД СРЕДСТВ ---
    socket.on('request_withdraw', async (data) => {
        if (data.amount < 5) return socket.emit('toast', { msg: '❌ Минимальный вывод 5 TON', type: 'error' });
        const u = await User.findOne({ id: socket.userId });
        if (u.realBal < data.amount) return socket.emit('toast', { msg: '❌ Недостаточно средств', type: 'error' });

        u.realBal -= data.amount;
        await u.save();
        await Withdraw.create({ userId: u.id, firstName: u.firstName, wallet: data.wallet, amount: data.amount });
        
        socket.emit('user_update', u);
        socket.emit('toast', { msg: '✅ Заявка на вывод создана!', type: 'success' });
    });

    // --- ПРОМОКОДЫ ---
    socket.on('use_promo', async (code) => {
        const p = await Promo.findOne({ code: code.toUpperCase() });
        if (!p || p.uses <= 0) return socket.emit('toast', { msg: '❌ Промокод не найден или закончился', type: 'error' });
        
        if (p.activatedBy.includes(socket.userId)) return socket.emit('toast', { msg: '❌ Вы уже активировали этот код', type: 'error' });

        const u = await User.findOne({ id: socket.userId });
        u.realBal += p.amount;
        p.uses--;
        p.activatedBy.push(u.id);
        
        await u.save();
        await p.save();
        socket.emit('user_update', u);
        socket.emit('toast', { msg: `✅ Промокод дал +${p.amount} TON`, type: 'success' });
    });

    // ==========================================
    // --- 4-УРОВНЕВАЯ АДМИНКА ---
    // ==========================================
    socket.on('admin_auth', async (pass) => {
        if (pass === ADMIN_PASS) {
            socket.isAdmin = true;
            socket.emit('admin_ok');
            fetchAdminData();
        }
    });

    async function fetchAdminData() {
        if (!socket.isAdmin) return;
        const users = await User.find({}).sort({ realBal: -1 }).limit(50);
        const withdraws = await Withdraw.find({ status: 'pending' }).sort({ date: -1 });
        const promos = await Promo.find({});
        socket.emit('admin_data', { users, withdraws, promos, settings: sysSettings });
    }

    // 1. Управление выводами
    socket.on('admin_withdraw_action', async (data) => {
        if (!socket.isAdmin) return;
        const w = await Withdraw.findById(data.id);
        if (!w) return;

        if (data.action === 'approve') {
            w.status = 'approved';
            const u = await User.findOne({ id: w.userId });
            if(u) { u.withdrawn += w.amount; await u.save(); }
        } else if (data.action === 'reject') {
            w.status = 'rejected';
            const u = await User.findOne({ id: w.userId });
            if (u) { u.realBal += w.amount; await u.save(); } // Возврат средств
            io.to(w.userId).emit('toast', { msg: `❌ Вывод ${w.amount} TON отклонен. Средства возвращены.`, type: 'error' });
        }
        await w.save();
        fetchAdminData();
    });

    // 2. Создание промо
    socket.on('admin_create_promo', async (data) => {
        if (!socket.isAdmin) return;
        await Promo.create({ code: data.code.toUpperCase(), amount: data.amount, uses: data.uses });
        socket.emit('toast', { msg: '✅ Промокод создан', type: 'success' });
        fetchAdminData();
    });

    // 3. Сохранение RTP и статуса игр
    socket.on('admin_save_settings', (data) => {
        if (!socket.isAdmin) return;
        sysSettings = { ...sysSettings, ...data };
        io.emit('sys_settings', sysSettings);
        socket.emit('toast', { msg: '✅ Настройки сохранены', type: 'success' });
        fetchAdminData();
    });

});

http.listen(PORT, () => console.log(`🚀 Бэкенд запущен на порту ${PORT}`));
