const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
require('dotenv').config(); // Убедись, что dotenv установлен, если используешь .env файл

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Папка с index.html, style.css, script.js

// === НАСТРОЙКИ ===
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'ТВОЙ_MONGO_URI';
const BOT_TOKEN = process.env.BOT_TOKEN || 'ТВОЙ_BOT_TOKEN';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234'; // Твой пароль от админки
const ADMIN_WALLET = process.env.ADMIN_WALLET || 'ТВОЙ_TON_КОШЕЛЕК'; // Кошелек для депов

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// === БАЗА ДАННЫХ MONGODB ===
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB подключена'))
    .catch(err => console.error('❌ Ошибка MongoDB:', err));

// Модели
const userSchema = new mongoose.Schema({
    id: String,
    username: String,
    photo: String,
    balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 1000 },
    isBlocked: { type: Boolean, default: false },
    stats: { bets: {type:Number, default:0}, wins: {type:Number, default:0}, plus: {type:Number, default:0}, minus: {type:Number, default:0} },
    referrals: { type: Array, default: [] },
    refEarned: { type: Number, default: 0 },
    referredBy: { type: String, default: null },
    promoEarned: { type: Number, default: 0 },
    withdrawHistory: { type: Array, default: [] },
    depositHistory: { type: Array, default: [] }
});
const User = mongoose.model('User', userSchema);

const historySchema = new mongoose.Schema({
    userId: String,
    username: String,
    avatar: String,
    game: String,
    bet: Number,
    win: Number,
    mode: String,
    timeMsk: String,
    timestamp: { type: Date, default: Date.now }
});
const History = mongoose.model('History', historySchema);

const promoSchema = new mongoose.Schema({
    code: String, amount: Number, limit: Number, usedBy: { type: Array, default: [] }
});
const Promo = mongoose.model('Promo', promoSchema);

const withdrawSchema = new mongoose.Schema({
    userId: String, amount: Number, address: String, status: { type: String, default: 'Ожидает' }, reason: String, time: String
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

const battleSchema = new mongoose.Schema({
    creatorId: String, bet: Number, players: Array, status: { type: String, default: 'waiting' }, timerEndTime: Date, createdAt: { type: Date, default: Date.now }
});
const BattleLobby = mongoose.model('BattleLobby', battleSchema);

// НОВАЯ МОДЕЛЬ ДЛЯ ЛОГОВ АДМИНА
const logSchema = new mongoose.Schema({
    adminUser: { type: String, default: 'Админ' },
    action: String,
    date: String, // Формат: 06.08
    time: String, // Формат: 14:30:00
    timestamp: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', logSchema);

// Глобальные настройки
let globalRtp = { crash: 90, mines: 90, coinflip: 90 };
let maintenance = { crash: false, mines: false, coinflip: false, battle: false };
let appConfig = { showDemo: false };
let onlineCount = 0;

// === УТИЛИТЫ ===
function getMskTime() { return new Date().toLocaleTimeString("ru-RU", {timeZone: "Europe/Moscow"}); }
function getMskDate() { 
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
    let dd = String(d.getDate()).padStart(2, '0');
    let mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}`;
}

async function addLog(action) {
    try {
        await Log.create({
            adminUser: 'Лонникс (Админ)',
            action: action,
            date: getMskDate(),
            time: getMskTime()
        });
    } catch(e) { console.error('Ошибка записи лога', e); }
}

// === TELEGRAM BOT (РЕФЕРАЛЫ) ===
bot.onText(/\/start (.+)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const refId = match[1];

    let user = await User.findOne({ id: chatId.toString() });
    if (!user) {
        user = new User({
            id: chatId.toString(),
            username: msg.from.username || msg.from.first_name || 'Игрок',
            photo: '' // Тут можно подтянуть фото через getUserProfilePhotos
        });
        
        if (refId && refId !== chatId.toString()) {
            const referrer = await User.findOne({ id: refId });
            if (referrer) {
                user.referredBy = refId;
                referrer.referrals.push({ id: user.id, username: user.username, earnedForMe: 0 });
                await referrer.save();
                bot.sendMessage(refId, `🎉 По вашей ссылке зарегистрировался новый пользователь: @${user.username}!`);
            }
        }
        await user.save();
    }
    
    bot.sendMessage(chatId, `Привет, ${user.username}! Добро пожаловать в Loonx Gifts.\n\n🎮 Жми кнопку ниже, чтобы запустить приложение!`, {
        reply_markup: {
            inline_keyboard: [[{ text: '🚀 ИГРАТЬ', web_app: { url: 'https://loonxgift.onrender.com/' } }]] // ЗАМЕНИ НА СВОЙ URL
        }
    });
});

// === СОКЕТЫ (ОНЛАЙН) ===
io.on('connection', async (socket) => {
    onlineCount++; io.emit('online', onlineCount);
    socket.emit('rtpUpdate', globalRtp);
    socket.emit('maintenanceUpdate', maintenance);
    socket.emit('configUpdate', appConfig);
    
    const recentBets = await History.find().sort({_id:-1}).limit(15);
    socket.emit('init_history', recentBets.reverse());

    socket.on('disconnect', () => { onlineCount--; io.emit('online', onlineCount); });
});

// === ИГРА: CRASH ===
let curCrash = { status: 'waiting', multiplier: 1.0, timer: 5 };
let crashBets = []; let crashHistory = [];

async function runCrash() {
    curCrash.status = 'waiting'; curCrash.timer = 5; crashBets = []; io.emit('crashBetsUpdate', crashBets);
    
    let waitInterval = setInterval(() => {
        curCrash.timer--; io.emit('crashData', curCrash);
        if (curCrash.timer <= 0) {
            clearInterval(waitInterval); curCrash.status = 'running'; curCrash.multiplier = 1.0; startCrashFly();
        }
    }, 1000);
}

function startCrashFly() {
    const rtp = globalRtp.crash || 90;
    const crashPoint = rtp > 0 ? Math.max(1.0, 0.99 / (Math.random() + (100 - rtp) / 100)) : 1.0;
    
    let flyInterval = setInterval(() => {
        curCrash.multiplier += 0.01;
        io.emit('crashData', curCrash);
        
        if (curCrash.multiplier >= crashPoint) {
            clearInterval(flyInterval); curCrash.status = 'crashed'; 
            crashHistory.push(curCrash.multiplier.toFixed(2));
            if(crashHistory.length > 10) crashHistory.shift();
            io.emit('crashData', curCrash);
            io.emit('crashHistoryUpdate', crashHistory);
            io.emit('crashBetsUpdate', crashBets);
            setTimeout(runCrash, 3000);
        }
    }, 50);
}
runCrash();

// === ИГРА: BATTLE ROULETTE ===
async function checkBattleStart(lobby) {
    if (lobby.players.length >= 2 && !lobby.timerEndTime) {
        lobby.timerEndTime = new Date(Date.now() + 15000); // 15 секунд на старт
        await lobby.save();
        io.emit('battleUpdate');
        
        setTimeout(async () => {
            const activeLobby = await BattleLobby.findById(lobby._id);
            if (activeLobby && activeLobby.status === 'waiting' && activeLobby.players.length >= 2) {
                activeLobby.status = 'spinning';
                await activeLobby.save();
                
                // Выбор победителя
                let totalPool = activeLobby.players.reduce((s, p) => s + p.bet, 0);
                let r = Math.random() * totalPool;
                let sum = 0; let winnerId = null;
                for (let p of activeLobby.players) { sum += p.bet; if (r <= sum) { winnerId = p.id; break; } }
                
                io.emit('battleSpin', { lobbyId: activeLobby._id, winnerId });

                // Начисление выигрыша
                setTimeout(async () => {
                    const wUser = await User.findOne({id: winnerId});
                    if(wUser) {
                        wUser.balance += totalPool;
                        wUser.stats.plus += totalPool;
                        await wUser.save();
                    }
                    activeLobby.status = 'finished';
                    await activeLobby.save();
                    io.emit('battleUpdate');

                    // УДАЛЕНИЕ ЧЕРЕЗ 5 МИНУТ
                    setTimeout(async () => {
                        await BattleLobby.findByIdAndDelete(activeLobby._id);
                        io.emit('battleUpdate');
                    }, 5 * 60 * 1000);

                }, 5000);
            } else if (activeLobby && activeLobby.players.length < 2) {
                activeLobby.timerEndTime = null;
                await activeLobby.save();
                io.emit('battleUpdate');
            }
        }, 15000);
    }
}

// === API: АВТОРИЗАЦИЯ ===
app.post('/api/auth', async (req, res) => {
    const data = req.body;
    let user = await User.findOne({ id: data.id.toString() });
    if (!user) {
        user = new User({ id: data.id.toString(), username: data.username || data.first_name, photo: data.photo_url || '' });
        await user.save();
    }
    if (user.isBlocked) return res.json({ error: "BLOCKED" });
    
    // Обновляем ник/фото если изменились
    if(data.username && user.username !== data.username) user.username = data.username;
    if(data.photo_url && user.photo !== data.photo_url) user.photo = data.photo_url;
    await user.save();

    res.json({ user, rtp: globalRtp, maintenance, adminWallet: ADMIN_WALLET, config: appConfig });
});

// === API: СТАВКИ ===
app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, mode } = req.body;
    let user = await User.findOne({ id });
    if (!user || maintenance[game.toLowerCase()]) return res.status(400).json({ error: 'Ошибка или Тех.работы' });

    let isReal = mode === 'real';
    let currentBal = isReal ? user.balance : user.demo_balance;
    
    if (bet > 0 && currentBal < bet) return res.status(400).json({ error: 'Недостаточно средств' });

    if (bet > 0) {
        if(isReal) { user.balance -= bet; user.stats.bets++; user.stats.minus += bet; } 
        else { user.demo_balance -= bet; }
    }
    if (win > 0) {
        if(isReal) { user.balance += win; user.stats.wins++; user.stats.plus += win; } 
        else { user.demo_balance += win; }
    }

    await user.save();

    if (bet > 0 || win > 0) {
        const betDoc = await History.create({
            userId: user.id, username: user.username, avatar: user.photo,
            game, bet, win, mode: isReal ? 'Real' : 'Demo', timeMsk: getMskTime()
        });
        io.emit('newHistoryEntry', betDoc);

        if (game === 'Crash') {
            if (bet > 0) crashBets.push({ id: user.id, username: user.username, avatar: user.photo, bet, mode: mode.toLowerCase(), cashedOut: false });
            if (win > 0) {
                let cb = crashBets.find(b => b.id === user.id && !b.cashedOut);
                if (cb) { cb.cashedOut = true; cb.win = win; }
            }
            io.emit('crashBetsUpdate', crashBets);
        }
    }
    res.json(user);
});

// === API: BATTLE ROULETTE ROUTES ===
const colors = ['#00ff88', '#ff0055', '#00d2ff', '#ffcc00'];
app.post('/api/battle/create', async (req, res) => {
    const { id, bet } = req.body;
    let user = await User.findOne({ id });
    if (!user || user.balance < bet || bet < 0.5 || bet > 150) return res.status(400).json({ error: 'Ошибка баланса' });
    
    user.balance -= bet; user.stats.bets++; user.stats.minus += bet; await user.save();
    
    const lobby = new BattleLobby({
        creatorId: id, bet,
        players: [{ id: user.id, username: user.username, avatar: user.photo, bet, color: colors[0] }]
    });
    await lobby.save();
    io.emit('battleUpdate');
    res.json(user);
});

app.post('/api/battle/join', async (req, res) => {
    const { id, lobbyId, bet } = req.body;
    let user = await User.findOne({ id });
    let lobby = await BattleLobby.findById(lobbyId);
    
    if (!user || !lobby || lobby.status !== 'waiting' || lobby.players.length >= 4) return res.status(400).json({ error: 'Лобби недоступно' });
    if (user.balance < bet || bet < 0.5 || bet > 150) return res.status(400).json({ error: 'Ошибка баланса' });
    if (lobby.players.some(p => p.id === user.id)) return res.status(400).json({ error: 'Вы уже в игре' });

    user.balance -= bet; user.stats.bets++; user.stats.minus += bet; await user.save();
    
    lobby.players.push({ id: user.id, username: user.username, avatar: user.photo, bet, color: colors[lobby.players.length] });
    await lobby.save();
    
    checkBattleStart(lobby);
    io.emit('battleUpdate');
    res.json({ user, lobby });
});

app.post('/api/battle/cancel', async (req, res) => {
    const { id, lobbyId } = req.body;
    let lobby = await BattleLobby.findById(lobbyId);
    if (!lobby || lobby.creatorId !== id || lobby.players.length > 1) return res.status(400).json({ error: 'Нельзя отменить' });
    
    let user = await User.findOne({ id });
    user.balance += lobby.bet; user.stats.plus += lobby.bet; await user.save();
    
    await BattleLobby.findByIdAndDelete(lobbyId);
    io.emit('battleUpdate');
    res.json(user);
});

app.get('/api/battle/list', async (req, res) => {
    const lobbies = await BattleLobby.find().sort({createdAt: -1});
    res.json(lobbies);
});

// === API: ФИНАНСЫ И ПРОМО ===
app.post('/api/check_deposit', async (req, res) => {
    // ЗАГЛУШКА: В реале тут запрос к TON API. Для примера - ничего не находит.
    res.status(400).json({ error: 'Транзакция не найдена. Подождите пару минут.' });
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    let user = await User.findOne({ id });
    if (!user || user.balance < amount || amount < 5) return res.status(400).json({ error: 'Ошибка' });

    user.balance -= amount;
    const time = getMskDate() + ' ' + getMskTime();
    user.withdrawHistory.push({ amount, address, status: 'Ожидает', time });
    await user.save();
    
    await Withdraw.create({ userId: id, amount, address, time });
    addLog(`Запрос на вывод от ID ${id}: ${amount} TON`);
    res.json(user);
});

app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    let user = await User.findOne({ id });
    let promo = await Promo.findOne({ code: code.toUpperCase() });

    if (!promo || promo.usedBy.includes(id) || promo.usedBy.length >= promo.limit) return res.status(400).json({ error: 'Недействителен' });

    user.balance += promo.amount; user.promoEarned += promo.amount;
    promo.usedBy.push(id);
    await user.save(); await promo.save();
    
    res.json(user);
});


// ============================================
// === АДМИН ПАНЕЛЬ (ПОЛНЫЙ ФУНКЦИОНАЛ) ===
// ============================================

function checkPass(req, res, next) {
    if (req.body.pass !== ADMIN_PASS) return res.status(403).json({ error: 'Неверный пароль' });
    next();
}

app.post('/api/admin/data', checkPass, async (req, res) => {
    const users = await User.find().sort({balance: -1}).limit(50);
    const totalUsers = await User.countDocuments();
    const withdraws = await Withdraw.find({ status: 'Ожидает' });
    const promos = await Promo.find();
    
    // Подсчет статы
    const allW = await Withdraw.find({status: 'Подтверждено'});
    const totalW = allW.reduce((sum, w) => sum + w.amount, 0);
    // Для депов заглушка
    const totalD = 0; 

    res.json({ 
        users, totalUsers, withdraws, promos, rtp: globalRtp, maintenance, 
        totalDeposited: totalD, totalWithdrawn: totalW, latestDeposits: [] 
    });
});

app.post('/api/admin/search_user', checkPass, async (req, res) => {
    const { query, filterType } = req.body;
    let filter = {};
    if (query) { filter = { $or: [{ id: new RegExp(query, 'i') }, { username: new RegExp(query, 'i') }] }; }
    
    let sort = {};
    if (filterType === 'balance') sort = { balance: -1 };
    else if (filterType === 'new') sort = { _id: -1 };
    else if (filterType === 'banned') filter.isBlocked = true;

    const users = await User.find(filter).sort(sort).limit(100);
    res.json({ users });
});

// ПОЛНАЯ СТАТИСТИКА ЮЗЕРА ДЛЯ АДМИНА
app.post('/api/admin/user_details', checkPass, async (req, res) => {
    const { userId, page = 1 } = req.body;
    const limit = 20;
    const skip = (page - 1) * limit;

    const user = await User.findOne({ id: userId });
    if (!user) return res.status(404).json({ error: 'Юзер не найден' });

    const history = await History.find({ userId: userId }).sort({ _id: -1 }).skip(skip).limit(limit);
    const totalCount = await History.countDocuments({ userId: userId });

    res.json({ 
        user, 
        history: history.map(h => ({ game: h.game, bet: h.bet, win: h.win, time: h.timeMsk, balanceAfter: 0 })), 
        totalPages: Math.ceil(totalCount / limit) 
    });
});

// ИЗМЕНЕНИЕ БАЛАНСА АДМИНОМ (С ЛОГИРОВАНИЕМ И РЕФЕРАЛКОЙ)
app.post('/api/admin/change_balance', checkPass, async (req, res) => {
    const { userId, amount, type } = req.body;
    let user = await User.findOne({ id: userId });
    if (!user) return res.status(404).json({ error: 'Юзер не найден' });

    let val = parseFloat(amount);
    if(type === 'sub') {
        if(user.balance < val) return res.status(400).json({ error: 'Недостаточно средств у юзера' });
        user.balance -= val;
        await addLog(`Списал ${val} TON у ID ${userId}`);
    } else {
        user.balance += val;
        // Эмуляция депа в историю для красивого вывода
        user.depositHistory.push({ amount: val, time: getMskDate() + ' ' + getMskTime() });
        await addLog(`Выдал ${val} TON юзеру ID ${userId}`);
        
        // РЕФЕРАЛЬНАЯ СИСТЕМА (10% от депа)
        if (user.referredBy) {
            let refUser = await User.findOne({ id: user.referredBy });
            if (refUser) {
                let bonus = val * 0.10;
                refUser.balance += bonus;
                refUser.refEarned += bonus;
                let refData = refUser.referrals.find(r => r.id === user.id);
                if (refData) refData.earnedForMe = (refData.earnedForMe || 0) + bonus;
                refUser.markModified('referrals');
                await refUser.save();
                try { bot.sendMessage(refUser.id, `🎉 Ваш реферал пополнил баланс! Вы получили ${bonus.toFixed(2)} TON.`); } catch(e){}
            }
        }
    }
    
    await user.save();
    res.json({ success: true, newBalance: user.balance });
});

// НОВЫЙ РОУТ: ЛОГИ АДМИНКИ С ПАГИНАЦИЕЙ И ФИЛЬТРОМ
app.post('/api/admin/logs', checkPass, async (req, res) => {
    const { page = 1, limit = 30, date } = req.body;
    const skip = (page - 1) * limit;
    
    let filter = {};
    if (date && date.trim() !== '') {
        filter.date = new RegExp(date, 'i'); // Поиск по дате, например "06.08"
    }

    const logs = await Log.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit);
    const totalLogs = await Log.countDocuments(filter);

    res.json({ logs, totalPages: Math.ceil(totalLogs / limit) });
});

// ОБРАБОТКА ВЫВОДОВ
app.post('/api/admin/withdraw_action', checkPass, async (req, res) => {
    const { wId, action, reason } = req.body;
    let w = await Withdraw.findById(wId);
    if (!w) return res.status(400).json({ error: 'Не найдено' });

    let user = await User.findOne({ id: w.userId });
    if (action === 'approve') {
        w.status = 'Подтверждено';
        if (user) {
            let userW = user.withdrawHistory.find(x => x.amount === w.amount && x.status === 'Ожидает');
            if(userW) userW.status = 'Подтверждено';
            user.markModified('withdrawHistory'); await user.save();
            try { bot.sendMessage(user.id, `✅ Ваш вывод ${w.amount} TON успешно обработан!`); } catch(e){}
        }
        await addLog(`Одобрил вывод ${w.amount} TON для ID ${w.userId}`);
    } else {
        w.status = 'Отклонено'; w.reason = reason;
        if (user) {
            user.balance += w.amount; // возврат
            let userW = user.withdrawHistory.find(x => x.amount === w.amount && x.status === 'Ожидает');
            if(userW) { userW.status = 'Отклонено'; userW.reason = reason; }
            user.markModified('withdrawHistory'); await user.save();
            try { bot.sendMessage(user.id, `❌ Ваш вывод ${w.amount} TON отклонен. Причина: ${reason}\nСредства возвращены на баланс.`); } catch(e){}
        }
        await addLog(`Отклонил вывод ${w.amount} TON для ID ${w.userId}. Причина: ${reason}`);
    }
    await w.save();
    res.json({ success: true });
});

// УПРАВЛЕНИЕ ЮЗЕРОМ (БАН / ЛС)
app.post('/api/admin/user_action', checkPass, async (req, res) => {
    const { userId, action, msg } = req.body;
    let user = await User.findOne({ id: userId });
    if (!user) return res.status(400).json({ error: 'Юзер не найден' });

    if (action === 'ban') { user.isBlocked = true; await addLog(`Забанил юзера ID ${userId}`); }
    if (action === 'unban') { user.isBlocked = false; await addLog(`Разбанил юзера ID ${userId}`); }
    if (action === 'message') { 
        try { await bot.sendMessage(userId, `📩 Сообщение от Администрации:\n\n${msg}`); await addLog(`Отправил ЛС юзеру ID ${userId}`); } 
        catch(e) { return res.status(400).json({error: 'Бот заблокирован юзером'}); }
    }
    
    await user.save(); res.json({ success: true });
});

app.post('/api/admin/bot_broadcast', checkPass, async (req, res) => {
    const users = await User.find({ isBlocked: false });
    let count = 0;
    for (let u of users) {
        try { await bot.sendMessage(u.id, req.body.text); count++; } catch(e) {}
    }
    await addLog(`Сделал рассылку. Доставлено: ${count} чел.`);
    res.json({ success: true });
});

app.post('/api/admin/reset_all_stats', checkPass, async (req, res) => {
    await History.deleteMany({});
    await BattleLobby.deleteMany({});
    await User.updateMany({}, { $set: { "stats.bets": 0, "stats.wins": 0, "stats.plus": 0, "stats.minus": 0 } });
    await addLog(`ОБНУЛИЛ ВСЮ ИСТОРИЮ СТАВОК И ИГР`);
    res.json({ success: true });
});

app.post('/api/admin/promo_create', checkPass, async (req, res) => {
    await Promo.create({ code: req.body.code.toUpperCase(), amount: req.body.amount, limit: req.body.limit });
    await addLog(`Создал промокод ${req.body.code.toUpperCase()} на ${req.body.amount} TON (Лимит: ${req.body.limit})`);
    res.json({ success: true });
});

app.post('/api/admin/promo_delete', checkPass, async (req, res) => {
    const p = await Promo.findByIdAndDelete(req.body.pId);
    if(p) await addLog(`Удалил промокод ${p.code}`);
    res.json({ success: true });
});

app.post('/api/admin/set_rtp', checkPass, async (req, res) => {
    globalRtp[req.body.game] = parseFloat(req.body.value);
    io.emit('rtpUpdate', globalRtp);
    await addLog(`Изменил RTP игры ${req.body.game} на ${req.body.value}%`);
    res.json({ success: true });
});

app.post('/api/admin/maintenance', checkPass, async (req, res) => {
    maintenance[req.body.game] = req.body.state;
    io.emit('maintenanceUpdate', maintenance);
    await addLog(`Тех. работы для ${req.body.game}: ${req.body.state ? 'ВКЛ' : 'ВЫКЛ'}`);
    res.json({ success: true });
});

app.post('/api/admin/config', checkPass, async (req, res) => {
    appConfig.showDemo = req.body.showDemo;
    io.emit('configUpdate', appConfig);
    await addLog(`Отображение DEMO ставок в ленте: ${req.body.showDemo ? 'ВКЛ' : 'ВЫКЛ'}`);
    res.json({ success: true });
});

// Запуск сервера
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
