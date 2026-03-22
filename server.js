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

// Защита от мультикликов
const actionLocks = new Set();

// АНТИ-СОН ДЛЯ RENDER
setInterval(() => {
    const url = process.env.WEB_APP_URL || "https://loonxgift.onrender.com";
    fetch(url).then(() => console.log('🔄 Анти-сон: Сервер пинганул сам себя')).catch(() => {});
}, 10 * 60 * 1000);

// Подключение к БД
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log('❌ DB Error:', err));

// --- TON CONNECT MANIFEST ---
app.get('/tonconnect-manifest.json', (req, res) => {
    res.json({
        url: process.env.WEB_APP_URL || "https://loonxgift.onrender.com",
        name: "LoonxGift", 
        iconUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    });
});

const getMskTime = () => new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour12: false });

// --- МОДЕЛИ ДАННЫХ ---
const UserSchema = new mongoose.Schema({
    id: String, 
    username: String, 
    photo: String, 
    isBlocked: { type: Boolean, default: false }, 
    balance: { type: Number, default: 0 }, 
    demo_balance: { type: Number, default: 5000 },
    referredBy: { type: String, default: null }, 
    referrals: [{ type: String }],               
    referralEarnings: { type: Number, default: 0 }, 
    stats: { 
        bets: {type:Number, default:0}, 
        wins: {type:Number, default:0}, 
        plus: {type:Number, default:0}, 
        minus: {type:Number, default:0},
        promo: {type:Number, default:0}
    },
    createdAt: { type: Date, default: Date.now },
    withdrawHistory: [{ 
        withdrawId: String, 
        amount: Number, 
        address: String, 
        status: String, 
        reason: String, 
        time: String 
    }],
    depositHistory: [{
        hash: String,
        amount: Number,
        status: String,
        time: String
    }],
    betHistory: { type: Array, default: [] }
});

const BetSchema = new mongoose.Schema({
    userId: String, username: String, avatar: String, game: String, amount: Number,
    multiplier: Number, result: Number, mode: String,
    balanceAfter: Number, 
    createdAt: { type: Date, default: Date.now }
});

const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' }, reason: String, time: String });
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number, time: String });
const SettingsSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });

const BattleSchema = new mongoose.Schema({
    creatorId: String,
    players: Array, 
    status: { type: String, default: 'waiting' }, 
    winnerId: String,
    timerStartedAt: Date, 
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

async function initSettings() {
    const defaultSettings = [
        { key: 'rtp_crash', value: 90 },
        { key: 'rtp_mines', value: 90 },
        { key: 'rtp_coinflip', value: 90 }, 
        { key: 'maintenance_crash', value: false },
        { key: 'maintenance_mines', value: false },
        { key: 'maintenance_coinflip', value: false },
        { key: 'maintenance_battle', value: false }
    ];
    for (let setting of defaultSettings) {
        const exists = await Settings.findOne({ key: setting.key });
        if (!exists) await Settings.create(setting);
    }
    const lastBets = await Bet.find().sort({createdAt: -1}).limit(10);
    globalBetHistory = lastBets.map(b => {
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
    
    bot.onText(/\/(start|help)(?: (.+))?/, (msg, match) => {
        const refParam = match[2] || '';
        const text = `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в LoonxGift.\n\nТут ты можешь играть и выигрывать TON! Выбирай действие в меню ниже:`;
        const appUrl = process.env.WEB_APP_URL ? `${process.env.WEB_APP_URL}?start_param=${refParam}` : `https://loonxgift.onrender.com/?start_param=${refParam}`;

        bot.sendMessage(msg.chat.id, text, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎮 ИГРАТЬ (MINI APP)", web_app: { url: appUrl } }],
                    [{ text: "📢 Канал", url: "https://t.me/Loonxnews" }, { text: "💬 Саппорт", url: "https://t.me/LoonxGift_Support" }],
                    [{ text: "🐞 Баги", url: "https://t.me/msgp2p" }]
                ]
            }
        });
    });
    console.log('🤖 Бот успешно запущен');
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
                        const balField = actualMode === 'Demo' ? 'demo_balance' : 'balance';
                        const newBet = new Bet({ 
                            userId: u.id, username: u.username, avatar: b.avatar, 
                            game: 'Crash', amount: b.bet, result: -b.bet, mode: actualMode,
                            balanceAfter: u[balField] 
                        });
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
    const betWithTime = { ...(betObj.toObject ? betObj.toObject() : betObj), timeMsk: getMskTime() };
    globalBetHistory.unshift(betWithTime);
    if(globalBetHistory.length > 10) globalBetHistory.pop();
    io.emit('newHistoryEntry', betWithTime);
}

// --- BATTLE ENGINE ---
const BATTLE_COLORS = ['#ffcc00', '#ff0055', '#007bff', '#ffffff'];
setInterval(async () => {
    const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await Battle.deleteMany({ status: 'waiting', createdAt: { $lt: expiredTime } });

    const waitingLobbies = await Battle.find({ status: 'waiting' });
    for (let lobby of waitingLobbies) {
        let shouldStart = false;
        if (lobby.players.length >= 4) shouldStart = true;
        else if (lobby.players.length > 1 && lobby.timerStartedAt) {
            const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
            if (lobby.timerStartedAt < twoMinsAgo) shouldStart = true;
        }

        if (shouldStart) {
            lobby.status = 'spinning'; await lobby.save(); io.emit('battleUpdate');
            const totalPool = lobby.players.reduce((sum, p) => sum + p.bet, 0);
            let rand = Math.random() * totalPool;
            let currentWeight = 0;
            let winner = lobby.players[0];
            for (let p of lobby.players) { currentWeight += p.bet; if (rand <= currentWeight) { winner = p; break; } }
            
            lobby.status = 'finished'; lobby.winnerId = winner.id; await lobby.save();
            const winAmount = winner.bet + ((totalPool - winner.bet) * 0.70);
            const wUser = await User.findOne({id: winner.id});
            if (wUser) {
                wUser.balance = Number((wUser.balance + winAmount).toFixed(2));
                wUser.stats.wins++; wUser.stats.plus += (winAmount - winner.bet);
                await wUser.save();
            }
            io.emit('battleSpin', { lobbyId: lobby._id, winnerId: winner.id });
            
            const betEntry = new Bet({
                userId: winner.id, username: `${lobby.players[0].username} VS Others Победитель: ${winner.username}`, avatar: winner.avatar,
                game: 'Battle Roulette', amount: winner.bet, result: winAmount - winner.bet, mode: 'Real', balanceAfter: wUser ? wUser.balance : 0 
            });
            await betEntry.save(); pushToGlobalHistory(betEntry);
            setTimeout(async () => { await Battle.findByIdAndDelete(lobby._id); io.emit('battleUpdate'); }, 120000);
        }
    }
}, 5000);

// --- API ---
app.post('/api/auth', async (req, res) => {
    const { id, username, first_name, photo_url, refId } = req.body;
    let user = await User.findOne({ id });
    if (!user) { 
        user = await User.create({ id, username: username || first_name, photo: photo_url }); 
        if (refId && refId !== String(id)) {
            const referrer = await User.findOne({ id: String(refId) });
            if (referrer) { user.referredBy = String(refId); referrer.referrals.push(String(id)); await referrer.save(); await user.save(); }
        }
    } else { user.username = username || first_name; user.photo = photo_url; await user.save(); }
    if(user.isBlocked) return res.status(403).json({ error: "BLOCKED" });
    
    const allSettings = await Settings.find();
    const rtpData = {}; const maintenanceData = {};
    allSettings.forEach(s => {
        if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
        if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
    });
    const userBets = await Bet.find({ userId: String(id) }).sort({ createdAt: -1 }).limit(50);
    const userObj = user.toObject(); userObj.betHistory = userBets;
    res.json({ user: userObj, adminWallet: process.env.ADMIN_WALLET, rtp: rtpData, maintenance: maintenanceData });
});

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, multiplier, mode } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({error: 'Wait'});
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        const field = mode === 'demo' ? 'demo_balance' : 'balance';
        if(!user || user[field] < bet) return res.status(400).send();
        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

        if (game === 'Crash') {
            if (win === 0 && bet > 0) {
                crashLiveBets.push({ id: user.id, username: user.username, avatar, bet, cashedOut: false, win: 0, mode: mode });
                io.emit('crashBetsUpdate', crashLiveBets);
                user[field] = Number((user[field] - bet).toFixed(2));
                await user.save(); return res.json(user);
            } else if (win > 0) {
                const activeBet = crashLiveBets.find(b => b.id === user.id && !b.cashedOut);
                if (!activeBet) return res.status(400).send();
                activeBet.cashedOut = true; io.emit('crashBetsUpdate', crashLiveBets);
                user[field] = Number((user[field] + win).toFixed(2)); await user.save();
                const bEntry = new Bet({ userId: user.id, username: user.username, avatar, game: 'Crash', amount: activeBet.bet, result: win - activeBet.bet, mode: mode === 'demo' ? 'Demo' : 'Real', balanceAfter: user[field] });
                await bEntry.save(); pushToGlobalHistory(bEntry); return res.json(user);
            }
        }
        user[field] = Number((user[field] - bet + win).toFixed(2));
        const newBet = new Bet({ userId: user.id, username: user.username, avatar, game, amount: bet, result: win - bet, mode: mode === 'demo' ? 'Demo' : 'Real', balanceAfter: user[field] });
        await newBet.save(); pushToGlobalHistory(newBet);
        if (mode !== 'demo') { user.stats.bets++; if (win > 0) user.stats.wins++; user.stats.plus += win; user.stats.minus += bet; }
        await user.save(); res.json(user);
    } finally { actionLocks.delete(id); }
});

app.post('/api/battle/create', async (req, res) => {
    const { id, bet } = req.body;
    const user = await User.findOne({id});
    if(!user || user.balance < bet || bet < 0.5 || bet > 150) return res.status(400).send();
    user.balance = Number((user.balance - bet).toFixed(2)); await user.save();
    await Battle.create({ creatorId: user.id, players: [{ id: user.id, username: user.username, avatar: user.photo, bet, color: BATTLE_COLORS[0] }] });
    io.emit('battleUpdate'); res.json(user);
});

app.post('/api/battle/join', async (req, res) => {
    const { id, lobbyId, bet } = req.body;
    const user = await User.findOne({id});
    const lobby = await Battle.findById(lobbyId);
    if(!user || !lobby || lobby.status !== 'waiting' || user.balance < bet) return res.status(400).send();
    user.balance = Number((user.balance - bet).toFixed(2)); await user.save();
    lobby.players.push({ id: user.id, username: user.username, avatar: user.photo, bet, color: BATTLE_COLORS[lobby.players.length] });
    if (lobby.players.length >= 2) lobby.timerStartedAt = new Date();
    await lobby.save(); io.emit('battleUpdate'); res.json({user, lobby});
});

app.post('/api/check_deposit', async (req, res) => {
    const { id } = req.body;
    const adminWallet = process.env.ADMIN_WALLET;
    const apiKey = process.env.TON_API_KEY;
    try {
        const response = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${adminWallet}&limit=50&api_key=${apiKey}`);
        const data = await response.json();
        if(!data.ok) return res.status(400).send();
        let found = false;
        for (let tx of data.result) {
            if (tx.in_msg && tx.in_msg.message === String(id)) {
                const txHash = tx.transaction_id.hash;
                const exists = await Deposit.findOne({ hash: txHash });
                if(!exists) {
                    const amountTON = tx.in_msg.value / 1e9;
                    await Deposit.create({ hash: txHash, userId: id, amount: amountTON, time: getMskTime() });
                    const u = await User.findOne({ id });
                    u.balance = Number((u.balance + amountTON).toFixed(2));
                    u.depositHistory.unshift({ hash: txHash, amount: amountTON, status: 'Успешно', time: getMskTime() });
                    if (u.referredBy) {
                        const ref = await User.findOne({ id: u.referredBy });
                        if (ref) { ref.balance += amountTON * 0.1; ref.referralEarnings += amountTON * 0.1; await ref.save(); }
                    }
                    await u.save(); found = true;
                }
            }
        }
        res.json({ success: found, user: await User.findOne({id}) });
    } catch (e) { res.status(500).send(); }
});

app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    const promo = await Promo.findOne({ code });
    if(!promo || promo.usedBy.includes(id) || promo.usedBy.length >= promo.limit) return res.status(400).send();
    const user = await User.findOne({ id });
    user.balance += promo.amount; user.stats.promo += promo.amount; promo.usedBy.push(id);
    await user.save(); await promo.save(); res.json(user);
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    const user = await User.findOne({ id });
    if (user.balance < amount || amount < 5) return res.status(400).send();
    user.balance -= amount;
    const newW = await Withdraw.create({ userId: id, address, amount, time: getMskTime() });
    user.withdrawHistory.unshift({ withdrawId: newW._id, amount, address, status: 'В обработке', time: newW.time });
    await user.save(); res.json(user);
});

// --- ADMIN ---
const checkAdmin = (req, res, next) => {
    if(req.body.pass !== (process.env.ADMIN_PASS || '1234')) return res.status(403).send();
    next();
};

app.post('/api/admin/data', checkAdmin, async (req, res) => {
    const withdraws = await Withdraw.find({status: 'pending'});
    const promos = await Promo.find().sort({_id: -1}).limit(10);
    const users = await User.find().sort({balance: -1}).limit(100);
    const totalUsers = await User.countDocuments();
    const allSettings = await Settings.find();
    const rtpData = {}; const maintenanceData = {};
    allSettings.forEach(s => {
        if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
        if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
    });
    res.json({ withdraws, promos, users, totalUsers, rtp: rtpData, maintenance: maintenanceData });
});

app.post('/api/admin/edit_balance', checkAdmin, async (req, res) => {
    const targetId = String(req.body.userId || req.body.id);
    const { action, amount } = req.body;
    const user = await User.findOne({id: targetId});
    if (!user) return res.status(404).send();
    const val = Number(amount);
    if (action === 'add' || action === 'plus') user.balance += val;
    else user.balance = Math.max(0, user.balance - val);
    await user.save(); res.json({success: true, balance: user.balance});
});

app.post('/api/admin/withdraw_action', checkAdmin, async (req, res) => {
    const { wId, action } = req.body;
    const w = await Withdraw.findById(wId);
    if(!w) return res.status(400).send();
    const u = await User.findOne({id: w.userId});
    if(u) {
        let h = u.withdrawHistory.find(x => String(x.withdrawId) === String(w._id));
        if(action === 'reject') { u.balance += w.amount; if(h) h.status = 'Отклонено'; w.status = 'rejected'; }
        else { if(h) h.status = 'Подтверждено'; w.status = 'approved'; }
        await u.save(); await w.save();
    }
    res.json({success: true});
});

io.on('connection', (socket) => {
    online++; io.emit('online', online);
    socket.emit('crashHistoryUpdate', crashHistory);
    socket.emit('crashBetsUpdate', crashLiveBets);
    socket.emit('init_history', globalBetHistory);
    socket.on('disconnect', () => { online--; io.emit('online', online); });
});

let online = 0;
server.listen(process.env.PORT || 3000, () => console.log('🚀 Server Running'));
