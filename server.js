require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const { BOT_TOKEN, MONGO_URI, WEBAPP_URL, PORT = 3000 } = process.env;

// --- ФИКС ОШИБКИ 409 ---
const bot = new TelegramBot(BOT_TOKEN, { polling: { autoStart: true, params: { timeout: 10 } } });
bot.on('polling_error', (err) => { if (!err.message.includes('409')) console.log("Bot Error:", err.message); });

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🚀 *Добро пожаловать в Loonx Gifts!*\n\nИграй в Crash, Mines и CoinFlip в одном приложении.\n\n💎 Быстрые выплаты в TON\n🎁 Ежедневные бонусы\n📈 Прозрачные коэффициенты`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Начать игру", web_app: { url: WEBAPP_URL } }],
                [{ text: "📢 Наш канал", url: "https://t.me/Loonxnews" }, { text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }]
            ]
        }
    });
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `🛡 *Связь с администрацией Loonx Gift:*\n\n👤 Creator: @tonfrm\n📢 Channel: @Loonxnews\n🆘 Support: @LoonxGift_Support\n🐛 Bugs: @LoonxGift_Support\n\nПри обращении указывайте ваш ID: \`${msg.from.id}\``, { parse_mode: 'Markdown' });
});

// --- БАЗА ДАННЫХ ---
mongoose.connect(MONGO_URI).then(() => console.log("✅ База MongoDB подключена"));

const UserSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    avatar: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats: { games: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, dep: { type: Number, default: 0 }, with: { type: Number, default: 0 } },
    usedPromos: [String]
});
const User = mongoose.model('User', UserSchema);

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    tgId: Number, username: String, amount: Number, address: String, status: { type: String, default: 'pending' }, date: { type: Date, default: Date.now }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: { type: String, unique: true }, amount: Number, limits: Number, uses: { type: Number, default: 0 }
}));

// Системные настройки (РТП и отключение игр)
let sysConfig = {
    crashRTP: 85, minesRTP: 85, flipRTP: 50,
    crashActive: true, minesActive: true, flipActive: true
};

app.use(express.static('public'));

// --- ЛОГИКА ИГРЫ: CRASH ---
let crash = { status: 'waiting', mult: 1.0, timer: 8, history: [], liveBets: [] };

function runCrash() {
    crash.status = 'flying';
    io.emit('crash_state', { status: crash.status });
    
    // Подкрутка через RTP
    let max = sysConfig.crashRTP > 80 ? 0.98 : (sysConfig.crashRTP / 100);
    let point = Math.max(1.00, (1 / (1 - Math.random() * max)).toFixed(2));
    if (point > 100) point = 50 + Math.random() * 50; // Ограничение

    let timer = setInterval(() => {
        crash.mult += (crash.mult * 0.007) + 0.01;
        io.emit('crash_tick', crash.mult.toFixed(2));
        if (crash.mult >= point) {
            clearInterval(timer);
            crash.status = 'crashed';
            crash.history.unshift(point);
            io.emit('crash_end', { point: point, history: crash.history.slice(0, 10) });
            setTimeout(startCrashWait, 4000);
        }
    }, 100);
}

function startCrashWait() {
    crash.status = 'waiting';
    crash.mult = 1.0;
    crash.timer = 8.0;
    crash.liveBets = [];
    let cd = setInterval(() => {
        crash.timer -= 0.1;
        io.emit('crash_timer', crash.timer.toFixed(1));
        if (crash.timer <= 0) { clearInterval(cd); runCrash(); }
    }, 100);
}
startCrashWait();

// --- SOCKET.IO ---
let onlineUsers = 0;

io.on('connection', (socket) => {
    onlineUsers++;
    io.emit('online_count', onlineUsers);

    socket.on('disconnect', () => { onlineUsers--; io.emit('online_count', onlineUsers); });

    // АВТОРИЗАЦИЯ
    socket.on('auth', async (data) => {
        if (!data || !data.id) return;
        let user = await User.findOne({ tgId: data.id });
        if (!user) user = await User.create({ tgId: data.id, username: data.username || "Gamer", avatar: data.photo_url || "" });
        socket.userId = user._id;
        socket.emit('auth_ok', user);
        socket.emit('crash_history', crash.history.slice(0, 10));
    });

    // СТАВКИ
    socket.on('place_bet', async (data) => { // data = { game: 'crash', amount: 10, isDemo: true }
        if (!sysConfig[`${data.game}Active`]) return socket.emit('notify', { text: "Игра на тех. перерыве!", type: "error" });
        const user = await User.findById(socket.userId);
        let balType = data.isDemo ? 'demo_balance' : 'real_balance';
        if (user[balType] >= data.amount) {
            user[balType] -= data.amount;
            user.stats.games++;
            await user.save();
            socket.emit('auth_ok', user); // Обновляем баланс
            
            if(data.game === 'crash') {
                crash.liveBets.push({ user: user.username, amount: data.amount, mult: null });
                io.emit('live_bets', crash.liveBets);
                let msg = crash.status === 'flying' ? "Ставка принята на след. раунд" : "Ставка принята";
                socket.emit('notify', { text: msg, type: "success" });
            }
        } else {
            socket.emit('notify', { text: "Недостаточно средств!", type: "error" });
        }
    });

    socket.on('cashout', async (data) => { // data = { game: 'crash', mult: 2.5, isDemo: true, amount: 10 }
        if(data.game === 'crash' && crash.status === 'flying') {
            const user = await User.findById(socket.userId);
            let win = data.amount * crash.mult;
            let balType = data.isDemo ? 'demo_balance' : 'real_balance';
            user[balType] += win;
            user.stats.wins++;
            await user.save();
            socket.emit('auth_ok', user);
            socket.emit('notify', { text: `Выведено ${win.toFixed(2)}`, type: "success" });
        }
    });

    // ПРОМОКОДЫ
    socket.on('activate_promo', async (code) => {
        const user = await User.findById(socket.userId);
        if(user.usedPromos.includes(code)) return socket.emit('notify', {text: "Промокод уже использован!", type: "error"});
        const promo = await Promo.findOne({code: code});
        if(!promo) return socket.emit('notify', {text: "Промокод не найден!", type: "error"});
        if(promo.uses >= promo.limits) return socket.emit('notify', {text: "Лимит активаций исчерпан!", type: "error"});
        
        user.real_balance += promo.amount;
        user.usedPromos.push(code);
        promo.uses++;
        await user.save();
        await promo.save();
        socket.emit('auth_ok', user);
        socket.emit('notify', {text: `Промокод активирован! +${promo.amount} TON`, type: "success"});
    });

    // --- АДМИН ПАНЕЛЬ (Пароль 8877) ---
    socket.on('admin_login', (pass) => {
        if (pass === "8877") socket.emit('admin_auth_ok', sysConfig);
        else socket.emit('notify', { text: "Неверный пароль", type: "error" });
    });

    // Раздел 1: БД
    socket.on('admin_get_users', async () => {
        const users = await User.find().select('tgId username real_balance demo_balance avatar');
        socket.emit('admin_users_list', users);
    });

    // Раздел 2: Выводы
    socket.on('admin_get_withdraws', async () => {
        const w = await Withdraw.find({status: 'pending'});
        socket.emit('admin_withdraws_list', w);
    });
    socket.on('admin_action_withdraw', async (data) => { // data = { id: w_id, action: 'accept'/'reject' }
        const w = await Withdraw.findById(data.id);
        if(!w) return;
        w.status = data.action;
        await w.save();
        if(data.action === 'reject') {
             bot.sendMessage(w.tgId, `❌ Ваш вывод на сумму ${w.amount} TON отклонен. За подробностями обратитесь в саппорт.`, {
                 reply_markup: { inline_keyboard: [[{text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support"}]] }
             });
        } else {
             bot.sendMessage(w.tgId, `✅ Ваш вывод на сумму ${w.amount} TON успешно обработан!`);
        }
        socket.emit('admin_withdraws_list', await Withdraw.find({status: 'pending'}));
    });

    // Раздел 3: Промокоды
    socket.on('admin_create_promo', async (data) => {
        await Promo.create({ code: data.name, amount: data.amount, limits: data.limit });
        socket.emit('notify', {text: "Промокод создан", type: "success"});
    });

    // Раздел 4: RTP
    socket.on('admin_set_rtp', (data) => { sysConfig = { ...sysConfig, ...data }; });
});

server.listen(PORT, () => console.log(`🚀 Loonx Server started on ${PORT}`));
