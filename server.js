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

// Защита от падения сервера
process.on('uncaughtException', (err) => console.error('Критическая ошибка:', err));
process.on('unhandledRejection', (reason, promise) => console.error('Необработанный промис:', reason));

// --- АНТИ-СОН СЕРВЕРА (Пункт 5 и 8) ---
setInterval(() => {
    http.get(`http://localhost:${process.env.PORT || 3000}/tonconnect-manifest.json`).on("error", (err) => {
        console.log("Anti-sleep ping error:", err.message);
    });
}, 5 * 60 * 1000); // Каждые 5 минут

// Подключение к БД
mongoose.connect(process.env.MONGO_URI).then(() => console.log('DB Connected')).catch(err => console.log('DB Error:', err));

// --- 1. TON CONNECT MANIFEST ---
app.get('/tonconnect-manifest.json', (req, res) => {
    res.json({
        url: process.env.WEB_APP_URL || "https://loonxgift.onrender.com",
        name: "Loonx Gifts",
        iconUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    });
});

// --- ВРЕМЯ МСК ---
const getMskTime = () => new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour12: false });

// --- МОДЕЛИ ДАННЫХ ---
const UserSchema = new mongoose.Schema({
    id: String, 
    username: String, 
    photo: String, 
    isBlocked: { type: Boolean, default: false },
    balance: { type: Number, default: 0 }, 
    demo_balance: { type: Number, default: 5000 },
    stats: { 
        bets: {type:Number, default:0}, 
        wins: {type:Number, default:0}, 
        plus: {type:Number, default:0}, 
        minus: {type:Number, default:0},
        promo: {type:Number, default:0}
    },
    depositHistory: [{ // Добавлено для Пункта 3
        amount: Number,
        hash: String,
        status: { type: String, default: 'Успешно' },
        time: String
    }],
    withdrawHistory: [{ 
        withdrawId: String,
        amount: Number, 
        address: String, 
        status: String, 
        reason: String, 
        time: String 
    }],
    createdAt: { type: Date, default: Date.now } // Для фильтра новых
});

const BetSchema = new mongoose.Schema({
    userId: String, username: String, avatar: String, game: String, amount: Number,
    multiplier: Number, result: Number, mode: String,
    createdAt: { type: Date, default: Date.now }
});

const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' }, reason: String, time: String });
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number, time: String });
const SettingsSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });

// Модель для Battle Roulette (Пункт 4)
const BattleSchema = new mongoose.Schema({
    creatorId: String, creatorName: String, creatorAvatar: String,
    amount: Number, minBet: Number, maxLimit: Number,
    players: [{ userId: String, username: String, avatar: String, bet: Number, color: String }],
    status: { type: String, default: 'waiting' }, // waiting, spinning, finished
    startTime: Date,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Bet = mongoose.model('Bet', BetSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);
const Battle = mongoose.model('Battle', BattleSchema);

let globalBetHistory = [];
const BATTLE_COLORS = ['#ffcc00', '#ffffff', '#ff0055', '#00ff88'];

// --- ИНИЦИАЛИЗАЦИЯ НАСТРОЕК ---
async function initSettings() {
    const defaultSettings = [
        { key: 'rtp_crash', value: 90 },
        { key: 'rtp_mines', value: 90 },
        { key: 'rtp_coinflip', value: 90 }, 
        { key: 'maintenance_crash', value: false },
        { key: 'maintenance_mines', value: false },
        { key: 'maintenance_coinflip', value: false },
        { key: 'maintenance_battle', value: false } // Добавлено для Батл рулетки
    ];
    for (let setting of defaultSettings) {
        const exists = await Settings.findOne({ key: setting.key });
        if (!exists) await Settings.create(setting);
    }
    
    const lastBets = await Bet.find().sort({createdAt: -1}).limit(10);
    globalBetHistory = lastBets.reverse().map(b => {
        const obj = b.toObject();
        obj.timeMsk = new Date(b.createdAt).toLocaleTimeString("ru-RU", {timeZone: "Europe/Moscow"});
        return obj;
    });
}
initSettings();

// --- ТЕЛЕГРАМ БОТ ---
let bot;
if (process.env.BOT_TOKEN) {
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    bot.deleteWebHook().catch(() => {});
    
    bot.on('polling_error', (err) => {
        if (err.message.includes('409 Conflict')) {
            console.log('Конфликт: Бот уже запущен в другом месте. Останови его там.');
        } else {
            console.log('Ошибка поллинга бота:', err.message);
        }
    });

    bot.onText(/\/(start|help)/, (msg) => {
        const text = `Привет, ${msg.from.first_name}!\nДобро пожаловать в Loonx Gifts.\n\nТут ты можешь играть и выигрывать TON! Твой баланс и все игры находятся внутри Mini App.\n\nВыбирай действие в меню ниже:`;
        const appUrl = process.env.WEB_APP_URL || "https://loonxgift.onrender.com/";

        bot.sendMessage(msg.chat.id, text, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "ИГРАТЬ (MINI APP)", web_app: { url: appUrl } }],
                    [{ text: "Канал", url: "https://t.me/Loonxnews" }, { text: "Саппорт", url: "https://t.me/LoonxGift_Support" }],
                    [{ text: "Баги", url: "https://t.me/msgp2p" }]
                ]
            }
        });
    });
    console.log('Бот успешно запущен (Polling)');
} else {
    console.log('BOT_TOKEN не найден в .env');
}

// --- CRASH ENGINE ---
let crash = { status: 'waiting', timer: 10, multiplier: 1.0 };
let crashHistory = [];
let crashLiveBets = [];

async function startCrash() {
    crash.status = 'waiting'; crash.timer = 10; crashLiveBets = [];
    io.emit('crashBetsUpdate', crashLiveBets);
    const t = setInterval(() => {
        crash.timer--; io.emit('crashData', crash);
        if(crash.timer <= 0) { clearInterval(t); runCrash(); }
    }, 1000);
}

async function runCrash() {
    crash.status = 'running'; crash.multiplier = 1.0;
    const rtpSetting = await Settings.findOne({key: 'rtp_crash'});
    const rtp = rtpSetting ? rtpSetting.value : 90; 
    const limit = Math.pow(100 / (100 - (Math.random() * rtp)), 0.9).toFixed(2);
    
    const r = setInterval(async () => {
        crash.multiplier = (parseFloat(crash.multiplier) + 0.015).toFixed(2);
        io.emit('crashData', crash);
        
        if(parseFloat(crash.multiplier) >= limit) { 
            clearInterval(r); 
            crash.status = 'crashed'; 
            crashHistory.unshift(crash.multiplier);
            if(crashHistory.length > 5) crashHistory.pop();
            io.emit('crashData', crash); 
            io.emit('crashHistoryUpdate', crashHistory);
            
            for (let b of crashLiveBets) {
                if (!b.cashedOut) {
                    const u = await User.findOne({id: b.id});
                    if (u) {
                        const actualMode = b.mode === 'demo' ? 'Demo' : 'Real';
                        const newBet = new Bet({ userId: u.id, username: u.username, avatar: b.avatar, game: 'Crash', amount: b.bet, result: -b.bet, mode: actualMode });
                        await newBet.save();
                        pushToGlobalHistory(newBet);
                    }
                }
            }
            
            setTimeout(startCrash, 4000); 
        }
    }, 100);
}
startCrash();

function pushToGlobalHistory(betObj) {
    const betWithTime = {
        ...(betObj.toObject ? betObj.toObject() : betObj),
        timeMsk: getMskTime()
    };
    
    globalBetHistory.unshift(betWithTime); // Пункт 1: добавляем наверх
    if(globalBetHistory.length > 10) globalBetHistory.pop();
    io.emit('newHistoryEntry', betWithTime);
}

// --- BATTLE ROULETTE ENGINE (Пункт 4) ---
setInterval(async () => {
    // 1. Возврат лобби через 24 часа
    const expired = await Battle.find({ status: 'waiting', createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
    for (let b of expired) {
        for (let p of b.players) {
            await User.updateOne({ id: p.userId }, { $inc: { balance: p.bet } });
        }
        await Battle.findByIdAndDelete(b._id);
        io.emit('battleUpdate');
    }

    // 2. Запуск рулетки (2 минуты с момента подключения второго игрока)
    const readyToSpin = await Battle.find({ status: 'waiting', startTime: { $lte: new Date() } });
    for (let b of readyToSpin) {
        b.status = 'spinning'; await b.save();
        io.emit('battleSpinStart', b);
        
        let totalPool = b.players.reduce((sum, p) => sum + p.bet, 0);
        let winFee = totalPool * 0.3; // 30% сгорает
        let winPool = totalPool - winFee;
        
        let rand = Math.random() * totalPool;
        let current = 0; let winner = b.players[0];
        for (let p of b.players) {
            current += p.bet;
            if (rand <= current) { winner = p; break; }
        }

        setTimeout(async () => {
            b.status = 'finished'; await b.save();
            await User.updateOne({ id: winner.userId }, { $inc: { balance: winPool, 'stats.plus': winPool, 'stats.wins': 1 } });
            io.emit('battleFinished', { lobbyId: b._id, winner, winPool, players: b.players });
            
            // История
            const h = { userId: winner.userId, username: winner.username, avatar: winner.avatar, game: 'Battle', amount: totalPool, result: winPool, mode: 'Real', timeMsk: getMskTime() };
            globalBetHistory.unshift(h);
            if(globalBetHistory.length>10) globalBetHistory.pop();
            io.emit('newHistoryEntry', h);
            
            setTimeout(() => { Battle.findByIdAndDelete(b._id).then(()=>io.emit('battleUpdate')); }, 10000);
        }, 5000); // Время анимации
    }
}, 2000);

// --- СОКЕТЫ ---
let online = 0;
io.on('connection', async (socket) => {
    online++; io.emit('online', online);
    socket.emit('crashHistoryUpdate', crashHistory);
    socket.emit('crashBetsUpdate', crashLiveBets);
    socket.emit('init_history', globalBetHistory);
    
    // Отправка активных лобби
    const lobbies = await Battle.find({ status: 'waiting' });
    socket.emit('init_battles', lobbies);

    socket.on('disconnect', () => { online--; io.emit('online', online); });
});

// --- API ЭНДПОИНТЫ ---
app.post('/api/auth', async (req, res) => {
    const { id, username, first_name, photo_url } = req.body;
    let user = await User.findOne({ id });
    if (!user) user = await User.create({ id, username: username || first_name, photo: photo_url });
    else { user.username = username || first_name; user.photo = photo_url; await user.save(); }
    
    if(user.isBlocked) return res.status(403).json({ error: "BLOCKED" });

    const allSettings = await Settings.find();
    const rtpData = {};
    const maintenanceData = {};
    allSettings.forEach(s => {
        if (s && s.key) {
            if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
            if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
        }
    });
    
    res.json({ user, adminWallet: process.env.ADMIN_WALLET, rtp: rtpData, maintenance: maintenanceData });
});

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, multiplier, mode } = req.body;
    const user = await User.findOne({ id });
    if(!user || user.isBlocked) return res.status(403).send();
    
    const actualMode = mode === 'demo' ? 'demo' : 'real';
    const field = actualMode === 'demo' ? 'demo_balance' : 'balance';
    
    if (bet < 0 || win < 0 || user[field] < bet) return res.status(400).json({error: 'No money'});
    const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

    if (game === 'Crash') {
        if (win === 0 && bet > 0) {
            const activeUserBets = crashLiveBets.filter(b => b.id === user.id && !b.cashedOut);
            if (activeUserBets.length >= 2) return res.status(400).json({error: 'Max 2 bets'});
            crashLiveBets.push({ id: user.id, username: user.username, avatar, bet, cashedOut: false, win: 0, mode: actualMode });
            io.emit('crashBetsUpdate', crashLiveBets);
            
            user[field] = Number((user[field] - bet).toFixed(2));
            if (actualMode === 'real') { user.stats.bets++; user.stats.minus += bet; }
            await user.save();
            return res.json(user);
            
        } else if (win > 0) {
            const activeBet = crashLiveBets.find(b => b.id === user.id && !b.cashedOut);
            if (!activeBet) return res.status(400).json({error: 'Already cashed out or not found'});
            
            activeBet.cashedOut = true;
            activeBet.win = win;
            io.emit('crashBetsUpdate', crashLiveBets);
            
            user[field] = Number((user[field] + win).toFixed(2));
            if (actualMode === 'real') { user.stats.wins++; user.stats.plus += win; }
            await user.save();
            
            const profit = win - activeBet.bet;
            const newBetEntry = new Bet({ userId: user.id, username: user.username, avatar, game: 'Crash', amount: activeBet.bet, result: profit, mode: actualMode === 'demo' ? 'Demo' : 'Real' });
            await newBetEntry.save();
            pushToGlobalHistory(newBetEntry);
            
            return res.json(user);
        }
    }

    const profit = win > 0 ? (win - bet) : -bet;
    const newBetEntry = new Bet({
        userId: user.id, username: user.username, avatar, game: game,
        amount: bet, multiplier: multiplier || (bet > 0 ? (win / bet).toFixed(2) : 0),
        result: Number(profit.toFixed(2)), mode: actualMode === 'demo' ? 'Demo' : 'Real'
    });
    await newBetEntry.save();
    pushToGlobalHistory(newBetEntry);

    user[field] = Number((user[field] - bet + win).toFixed(2));
    
    if (actualMode === 'real') {
        if (bet > 0) user.stats.bets++; 
        if (win > 0) { user.stats.wins++; user.stats.plus += win; } 
        else if (bet > 0) { user.stats.minus += bet; }
    }
    await user.save();
    
    res.json(user);
});

// BATTLE ROULETTE API (Пункт 4)
app.post('/api/battle/create', async (req, res) => {
    const { id, amount, minBet, maxLimit } = req.body;
    const user = await User.findOne({ id });
    if (!user || user.balance < amount) return res.status(400).json({ error: 'Недостаточно средств' });
    if (amount < 1 || amount > 150) return res.status(400).json({ error: 'Ставка от 1 до 150 TON' });

    user.balance = Number((user.balance - amount).toFixed(2));
    await user.save();

    const lobby = await Battle.create({
        creatorId: id, creatorName: user.username, creatorAvatar: user.photo,
        amount, minBet, maxLimit,
        players: [{ userId: id, username: user.username, avatar: user.photo, bet: amount, color: BATTLE_COLORS[0] }]
    });

    const lobbies = await Battle.find({ status: 'waiting' });
    io.emit('battleUpdate', lobbies);
    res.json(user);
});

app.post('/api/battle/join', async (req, res) => {
    const { id, lobbyId, amount } = req.body;
    const user = await User.findOne({ id });
    const lobby = await Battle.findById(lobbyId);

    if (!user || !lobby || lobby.status !== 'waiting') return res.status(400).json({ error: 'Лобби недоступно' });
    if (user.balance < amount) return res.status(400).json({ error: 'Недостаточно средств' });
    if (amount < lobby.minBet || amount > lobby.maxLimit) return res.status(400).json({ error: 'Неверная сумма ставки' });
    if (lobby.players.length >= 4) return res.status(400).json({ error: 'Лобби заполнено' });
    if (lobby.players.find(p => p.userId === id)) return res.status(400).json({ error: 'Вы уже в лобби' });

    user.balance = Number((user.balance - amount).toFixed(2));
    await user.save();

    lobby.players.push({ userId: id, username: user.username, avatar: user.photo, bet: amount, color: BATTLE_COLORS[lobby.players.length] });
    
    if (lobby.players.length === 2 && !lobby.startTime) {
        lobby.startTime = new Date(Date.now() + 2 * 60 * 1000); // 2 минуты таймер
    }
    await lobby.save();

    if (bot) {
        bot.sendMessage(lobby.creatorId, `Игрок ${user.username} присоединился к вашей ставке! Размер: ${amount} TON.`).catch(()=>{});
    }

    const lobbies = await Battle.find({ status: 'waiting' });
    io.emit('battleUpdate', lobbies);
    res.json(user);
});

app.post('/api/battle/delete', async (req, res) => {
    const { id, lobbyId } = req.body;
    const lobby = await Battle.findById(lobbyId);
    if (!lobby || lobby.creatorId !== id || lobby.players.length > 1) return res.status(400).json({ error: 'Нельзя удалить' });

    const user = await User.findOne({ id });
    user.balance = Number((user.balance + lobby.amount).toFixed(2));
    await user.save();
    await Battle.findByIdAndDelete(lobbyId);

    const lobbies = await Battle.find({ status: 'waiting' });
    io.emit('battleUpdate', lobbies);
    res.json(user);
});

app.post('/api/check_deposit', async (req, res) => {
    const { id } = req.body;
    const adminWallet = process.env.ADMIN_WALLET;
    const apiKey = process.env.TON_API_KEY;
    
    if (!adminWallet || !apiKey) return res.status(500).json({error: 'Wallet or API key missing'});

    try {
        const response = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${adminWallet}&limit=50&api_key=${apiKey}`);
        const data = await response.json();
        if(!data.ok) return res.status(400).json({error: 'TonCenter error'});
        
        let foundNew = false;
        let totalAdded = 0;
        
        for (let tx of data.result) {
            if (tx.in_msg && tx.in_msg.message && String(tx.in_msg.message).trim() === String(id).trim() && tx.in_msg.value > 0) {
                const txHash = tx.transaction_id.hash;
                const amountTON = tx.in_msg.value / 1e9; 
                const exists = await Deposit.findOne({ hash: txHash });
                if(!exists) {
                    const timeStr = getMskTime();
                    await Deposit.create({ hash: txHash, userId: id, amount: amountTON, time: timeStr });
                    const user = await User.findOne({ id });
                    user.balance = Number((user.balance + amountTON).toFixed(2));
                    user.depositHistory.unshift({ amount: amountTON, hash: txHash, status: 'Успешно', time: timeStr }); // Пункт 3
                    await user.save();
                    foundNew = true;
                    totalAdded += amountTON;
                }
            }
        }
        if(foundNew) {
            const updatedUser = await User.findOne({ id });
            res.json({ success: true, added: totalAdded, user: updatedUser });
        } else res.status(400).json({ error: 'Новых оплат не найдено' });
    } catch (e) { 
        res.status(500).json({error: 'Network error'}); 
    }
});

// ПРОМОКОДЫ (Пункт 7)
app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    const promo = await Promo.findOne({ code });
    if(!promo) return res.status(400).json({error: 'Неверный промокод'});
    if(promo.usedBy.length >= promo.limit || promo.usedBy.includes(id)) return res.status(400).json({error: 'Лимит активаций исчерпан'});
    
    const user = await User.findOne({ id });
    user.balance = Number((user.balance + promo.amount).toFixed(2)); 
    user.stats.promo += promo.amount; 
    promo.usedBy.push(id);
    
    await user.save(); await promo.save();
    res.json(user);
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    const user = await User.findOne({ id });
    if (user.balance < amount || amount < 5) return res.status(400).json({error: 'Min 5 TON'});
    user.balance = Number((user.balance - amount).toFixed(2)); 
    
    const newW = await Withdraw.create({ userId: id, address, amount, time: getMskTime() });
    user.withdrawHistory.unshift({ withdrawId: newW._id, amount, address, status: 'В обработке', reason: '', time: newW.time });
    await user.save();

    res.json(user);
});

// --- АДМИН ПАНЕЛЬ (Пункт 2) ---
const checkAdmin = (req, res, next) => {
    if(req.body.pass !== (process.env.ADMIN_PASS || '1234')) return res.status(403).json({error: 'Wrong pass'});
    next();
};

app.post('/api/admin/data', checkAdmin, async (req, res) => {
    const withdraws = await Withdraw.find({status: 'pending'});
    const promos = await Promo.find().sort({_id: -1}).limit(10);
    const users = await User.find().sort({balance: -1}).limit(100);
    
    // Агрегация депозитов и выводов (Пункт 2)
    const allDeps = await Deposit.find();
    const totalDeps = allDeps.reduce((acc, d) => acc + d.amount, 0);
    const allWiths = await Withdraw.find({status: 'approved'});
    const totalWiths = allWiths.reduce((acc, w) => acc + w.amount, 0);
    const usersCount = await User.countDocuments();

    // Добавляем юзернеймы к депозитам для админки
    const populatedWithdraws = await Promise.all(withdraws.map(async w => {
        const u = await User.findOne({id: w.userId});
        return { ...w.toObject(), username: u ? u.username : 'Неизвестно' };
    }));
    
    const allSettings = await Settings.find();
    const rtpData = {};
    const maintenanceData = {};
    allSettings.forEach(s => {
        if (s && s.key) {
            if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
            if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
        }
    });
    
    res.json({ withdraws: populatedWithdraws, promos, users, rtp: rtpData, maintenance: maintenanceData, totalDeps, totalWiths, usersCount });
});

app.post('/api/admin/search_user', checkAdmin, async (req, res) => {
    const { query, filterType } = req.body;
    let filter = {};
    if (query) {
        filter = { $or: [{ id: new RegExp(query, 'i') }, { username: new RegExp(query, 'i') }] };
    } else if (filterType === 'ban') {
        filter = { isBlocked: true };
    }
    
    let sort = {balance: -1};
    if (filterType === 'new') sort = {createdAt: -1};

    const users = await User.find(filter).sort(sort).limit(100);
    res.json({ users });
});

app.post('/api/admin/user_action', checkAdmin, async (req, res) => {
    const { userId, action, msg } = req.body;
    const user = await User.findOne({ id: String(userId) });
    if(!user) return res.status(400).send();

    if(action === 'ban') user.isBlocked = true;
    if(action === 'unban') user.isBlocked = false;
    await user.save();

    if(action === 'message' && bot) {
        bot.sendMessage(userId, `Сообщение от Администрации:\n\n${msg}`).catch(()=>{});
    }
    res.json({ success: true });
});

app.post('/api/admin/bot_broadcast', checkAdmin, async (req, res) => {
    const { text } = req.body;
    if(!text || !bot) return res.status(400).json({error: 'Текст пуст'});
    const users = await User.find({ isBlocked: false });
    for(let u of users) { bot.sendMessage(u.id, text).catch(()=>{}); }
    res.json({success: true});
});

app.post('/api/admin/maintenance', checkAdmin, async (req, res) => {
    const { game, state } = req.body;
    const key = `maintenance_${game}`;
    await Settings.updateOne({key}, {value: state}, {upsert: true});
    
    const allSettings = await Settings.find({key: /maintenance_/});
    const mData = {};
    allSettings.forEach(s => { if (s && s.key) mData[s.key.replace('maintenance_', '')] = s.value; });
    io.emit('maintenanceUpdate', mData);
    res.json({success: true});
});

app.post('/api/admin/promo_create', checkAdmin, async (req, res) => {
    const { code, amount, limit } = req.body;
    if(!code || !amount || !limit) return res.status(400).json({error: 'Заполните все поля'});
    await Promo.create({ code, amount: Number(amount), limit: Number(limit) });
    res.json({success: true});
});

app.post('/api/admin/promo_delete', checkAdmin, async (req, res) => {
    await Promo.findByIdAndDelete(req.body.pId);
    res.json({success: true});
});

app.post('/api/admin/set_rtp', checkAdmin, async (req, res) => {
    const { game, value } = req.body;
    const key = `rtp_${game}`;
    await Settings.updateOne({key}, {value: Number(value)}, {upsert: true});
    res.json({success: true});
});

app.post('/api/admin/withdraw_action', checkAdmin, async (req, res) => {
    const { wId, action, reason } = req.body;
    const w = await Withdraw.findById(wId);
    if(!w || w.status !== 'pending') return res.status(400).json({error: 'Error'});
    
    const u = await User.findOne({id: w.userId});
    if(u) {
        let uHist = u.withdrawHistory.find(h => h.withdrawId ? h.withdrawId.toString() === w._id.toString() : (h.time === w.time && h.amount === w.amount));
        if(action === 'reject') {
            u.balance = Number((u.balance + w.amount).toFixed(2)); 
            if(uHist) { uHist.status = 'Отклонено'; uHist.reason = reason; }
        } else {
            if(uHist) { uHist.status = 'Подтверждено'; }
        }
        await u.save();
    }
    
    if(action === 'reject') { w.status = 'rejected'; w.reason = reason; } 
    else { w.status = 'approved'; }
    await w.save();
    
    res.json({success: true});
});

server.listen(process.env.PORT || 3000, () => console.log('Server Running on port 3000'));
