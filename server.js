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

// Защита от падения сервера
process.on('uncaughtException', (err) => console.error('Критическая ошибка:', err));
process.on('unhandledRejection', (reason, promise) => console.error('Необработанный промис:', reason));

// Защита от мультикликов (глобальная блокировка активных запросов юзера)
const actionLocks = new Set();

// Анти-сон (пинг себя, если задан WEB_APP_URL)
if (process.env.WEB_APP_URL) {
    setInterval(() => {
        fetch(process.env.WEB_APP_URL).then(() => console.log('🔄 Анти-сон: Сервер пинганул сам себя')).catch(() => {});
    }, 10 * 60 * 1000);
}

// Подключение к БД
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log('❌ DB Error:', err));

// --- 1. TON CONNECT MANIFEST ---
app.get('/tonconnect-manifest.json', (req, res) => {
    res.json({
        url: process.env.WEB_APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost'}`,
        name: "LoonxGift", 
        iconUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    });
});

// Статические файлы (после манифеста, чтобы роут имел приоритет)
app.use(express.static(path.join(__dirname, 'public')));

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
    balance: Number, // ДОБАВЛЕНО: для корректного отображения баланса в админке и меню
    createdAt: { type: Date, default: Date.now }
});

const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' }, reason: String, time: String });
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number, time: String });
const SettingsSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });
const AdminLogSchema = new mongoose.Schema({ action: String, createdAt: { type: Date, default: Date.now } });

const BattleSchema = new mongoose.Schema({
    creatorId: String,
    players: Array, 
    status: { type: String, default: 'waiting' },
    winnerId: String,
    timerStartedAt: Date,
    timerEndTime: Date,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Bet = mongoose.model('Bet', BetSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);
const Battle = mongoose.model('Battle', BattleSchema);
const AdminLog = mongoose.model('AdminLog', AdminLogSchema);

async function logAdmin(action) {
    try { await AdminLog.create({ action }); } catch(e) {}
}

let globalBetHistory = [];

// --- ИНИЦИАЛИЗАЦИЯ НАСТРОЕК ---
async function initSettings() {
    const defaultSettings = [
        { key: 'rtp_crash', value: 90 },
        { key: 'rtp_mines', value: 90 },
        { key: 'rtp_coinflip', value: 90 }, 
        { key: 'maintenance_crash', value: false },
        { key: 'maintenance_mines', value: false },
        { key: 'maintenance_coinflip', value: false },
        { key: 'maintenance_battle', value: false },
        { key: 'rtp_spin', value: 40 },
        { key: 'rtp_mine', value: 40 },
        { key: 'maintenance_mine', value: false }
    ];
    for (let setting of defaultSettings) {
        const exists = await Settings.findOne({ key: setting.key });
        if (!exists) await Settings.create(setting);
    }
    
    // Принудительное снижение RTP spin если стоит старое значение 94
    const oldSpinRtp = await Settings.findOne({key: 'rtp_spin'});
    if (oldSpinRtp && oldSpinRtp.value >= 94) {
        await Settings.updateOne({key: 'rtp_spin'}, {$set: {value: 40}});
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
    
    bot.on('polling_error', (err) => {
        if (err.message.includes('409 Conflict')) {
            console.log('⚠️ Конфликт: Бот уже запущен в другом месте. Останови его там.');
        } else {
            console.log('❌ Ошибка поллинга бота:', err.message);
        }
    });

    bot.onText(/\/(start|help)(?: (.+))?/, (msg, match) => {
        const refParam = match[2] || '';
        const text = `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в LoonxGift.\n\nТут ты можешь играть и выигрывать TON! Твой баланс и все игры находятся внутри Mini App.\n\nВыбирай действие в меню ниже:`;
        
        const baseUrl = process.env.WEB_APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
        const appUrl = `${baseUrl}?start_param=${refParam}`;

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
    console.log('🤖 Бот успешно запущен (Polling)');
} else {
    console.log('❌ BOT_TOKEN не найден в .env');
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
                            balanceAfter: u[balField],
                            balance: u[balField] // ДОБАВЛЕНО
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
    const betWithTime = {
        ...(betObj.toObject ? betObj.toObject() : betObj),
        timeMsk: getMskTime()
    };
    
    globalBetHistory.unshift(betWithTime);
    if(globalBetHistory.length > 10) globalBetHistory.pop();
    io.emit('newHistoryEntry', betWithTime);
}

// --- BATTLE ROULETTE ENGINE ---
const BATTLE_COLORS = ['#ffcc00', '#ff0055', '#007bff', '#ffffff'];
setInterval(async () => {
    const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expiredLobbies = await Battle.find({ status: 'waiting', createdAt: { $lt: expiredTime } });
    
    for (let lobby of expiredLobbies) {
        for (let p of lobby.players) {
            const u = await User.findOne({id: p.id});
            if (u) { u.balance = Number((u.balance + p.bet).toFixed(2)); await u.save(); }
        }
        await Battle.findByIdAndDelete(lobby._id);
    }

    const waitingLobbies = await Battle.find({ status: 'waiting' });

    for (let lobby of waitingLobbies) {
        let shouldStart = false;
        
        if (lobby.players.length >= 4) {
            shouldStart = true;
        } else if (lobby.players.length > 1 && lobby.timerStartedAt) {
            const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
            if (lobby.timerStartedAt < twoMinsAgo) shouldStart = true;
        }

        if (shouldStart) {
            lobby.status = 'spinning';
            await lobby.save();
            io.emit('battleUpdate');
            
            const totalPool = lobby.players.reduce((sum, p) => sum + p.bet, 0);
            let rand = Math.random() * totalPool;
            let currentWeight = 0;
            let winner = lobby.players[0];

            for (let p of lobby.players) {
                currentWeight += p.bet;
                if (rand <= currentWeight) { winner = p; break; }
            }

            lobby.status = 'finished';
            lobby.winnerId = winner.id;
            await lobby.save();

            const othersPool = totalPool - winner.bet;
            const winAmount = winner.bet + (othersPool * 0.70);

            const wUser = await User.findOne({id: winner.id});
            if (wUser) {
                wUser.balance = Number((wUser.balance + winAmount).toFixed(2));
                wUser.stats.wins++; wUser.stats.plus += (winAmount - winner.bet);
                await wUser.save();
            }

            io.emit('battleSpin', { lobbyId: lobby._id, winnerId: winner.id });

            const opponentStr = lobby.players.filter(p => p.id !== lobby.creatorId).map(p => p.username).join(', ');
            const creator = lobby.players.find(p => p.id === lobby.creatorId);
            
            const betEntry = new Bet({
                userId: winner.id, username: winner.username, avatar: winner.avatar,
                game: 'Battle Roulette', amount: winner.bet, result: winAmount - winner.bet, mode: 'Real',
                balanceAfter: wUser ? wUser.balance : 0,
                balance: wUser ? wUser.balance : 0 // ДОБАВЛЕНО
            });
            betEntry.username = `${creator.username} VS ${opponentStr} 🏆 Победитель: ${winner.username}`;
            await betEntry.save();
            pushToGlobalHistory(betEntry);

            if (bot) {
                for (let p of lobby.players) {
                    if (p.id === winner.id) {
                        bot.sendMessage(p.id, `🏆 Поздравляем! Вы выиграли в Battle Roulette!\nВаш выигрыш составил: **${winAmount.toFixed(2)} TON**`, {parse_mode: 'Markdown'}).catch(()=>{});
                    } else {
                        bot.sendMessage(p.id, `😢 Вы проиграли в Battle Roulette.\nВаша ставка **${p.bet} TON** сгорела. Повезет в следующий раз!`, {parse_mode: 'Markdown'}).catch(()=>{});
                    }
                }
            }

            setTimeout(async () => { await Battle.findByIdAndDelete(lobby._id); io.emit('battleUpdate'); }, 120000);
        }
    }
}, 5000);

// --- СОКЕТЫ ---
let online = 0;
io.on('connection', async (socket) => {
    online++; io.emit('online', online);
    socket.emit('crashHistoryUpdate', crashHistory);
    socket.emit('crashBetsUpdate', crashLiveBets);
    socket.emit('init_history', globalBetHistory);
    socket.on('disconnect', () => { online--; io.emit('online', online); });
});

// --- API ЭНДПОИНТЫ ---
app.post('/api/auth', async (req, res) => {
    const { id, username, first_name, photo_url, refId } = req.body;
    let user = await User.findOne({ id });
    
    if (!user) { 
        user = await User.create({ id, username: username || first_name, photo: photo_url }); 
        
        if (refId && refId !== String(id)) {
            const referrer = await User.findOne({ id: String(refId) });
            if (referrer) {
                user.referredBy = String(refId);
                referrer.referrals.push(String(id));
                await referrer.save();
                await user.save();
            }
        }
    } else { 
        user.username = username || first_name; 
        user.photo = photo_url; 
        await user.save(); 
    }
    
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
    
    const userBets = await Bet.find({ userId: String(id) }).sort({ createdAt: -1 }).limit(50);
    const userObj = user.toObject();
    userObj.betHistory = userBets.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));

    res.json({ user: userObj, adminWallet: process.env.ADMIN_WALLET, rtp: rtpData, maintenance: maintenanceData });
});

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, multiplier, mode } = req.body;
    
    if (actionLocks.has(id)) return res.status(429).json({error: 'Слишком частые клики'});
    actionLocks.add(id);

    try {
        const user = await User.findOne({ id });
        if(!user || user.isBlocked) return res.status(403).send();
        
        const actualMode = mode === 'demo' ? 'demo' : 'real';
        const field = actualMode === 'demo' ? 'demo_balance' : 'balance';
        
        if (isNaN(bet) || isNaN(win) || bet < 0 || win < 0 || user[field] < bet) return res.status(400).json({error: 'No money or invalid amount'});
        
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
                
                const betMode = activeBet.mode === 'demo' ? 'demo' : 'real';
                const correctField = betMode === 'demo' ? 'demo_balance' : 'balance';
                
                activeBet.cashedOut = true;
                activeBet.win = win;
                io.emit('crashBetsUpdate', crashLiveBets);
                
                user[correctField] = Number((user[correctField] + win).toFixed(2));
                if (betMode === 'real') { user.stats.wins++; user.stats.plus += win; }
                await user.save();
                
                const profit = win - activeBet.bet;
                const newBetEntry = new Bet({ 
                    userId: user.id, username: user.username, avatar, game: 'Crash', 
                    amount: activeBet.bet, result: profit, mode: betMode === 'demo' ? 'Demo' : 'Real',
                    balanceAfter: user[correctField],
                    balance: user[correctField] // ДОБАВЛЕНО
                });
                await newBetEntry.save();
                pushToGlobalHistory(newBetEntry);
                
                return res.json(user);
            }
        }

        const profit = win > 0 ? (win - bet) : -bet;
        user[field] = Number((user[field] - bet + win).toFixed(2));
        
        const newBetEntry = new Bet({
            userId: user.id, username: user.username, avatar, game: game,
            amount: bet, multiplier: multiplier || (bet > 0 ? (win / bet).toFixed(2) : 0),
            result: Number(profit.toFixed(2)), mode: actualMode === 'demo' ? 'Demo' : 'Real',
            balanceAfter: user[field],
            balance: user[field] // ДОБАВЛЕНО
        });
        await newBetEntry.save();
        pushToGlobalHistory(newBetEntry);

        if (actualMode === 'real') {
            if (bet > 0) user.stats.bets++; 
            if (win > 0) { user.stats.wins++; user.stats.plus += win; } 
            else if (bet > 0) { user.stats.minus += bet; }
        }
        await user.save();
        
        res.json(user);
    } finally {
        actionLocks.delete(id);
    }
});

// API BATTLE ROULETTE
app.get('/api/battle/list', async (req, res) => {
    const lobbies = await Battle.find({status: 'waiting'}).sort({createdAt: -1});
    res.json(lobbies);
});

app.post('/api/battle/create', async (req, res) => {
    const { id, bet } = req.body;
    
    if (actionLocks.has(id)) return res.status(429).json({error: 'Подождите...'});
    actionLocks.add(id);

    try {
        const user = await User.findOne({id});
        if(!user || user.isBlocked) return res.status(403).send();
        
        if(isNaN(bet) || bet < 0.5 || bet > 150) return res.status(400).json({error: 'Ставка от 0.5 до 150 TON'});
        if(user.balance < bet) return res.status(400).json({error: 'Недостаточно средств'});
        
        user.balance = Number((user.balance - bet).toFixed(2));
        user.stats.bets++; user.stats.minus += bet;
        await user.save();

        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        const newLobby = await Battle.create({
            creatorId: user.id,
            players: [{ id: user.id, username: user.username, avatar, bet, color: BATTLE_COLORS[0] }]
        });

        io.emit('battleUpdate');
        res.json(user);
    } finally {
        actionLocks.delete(id);
    }
});

app.post('/api/battle/join', async (req, res) => {
    const { id, lobbyId, bet } = req.body;
    
    if (actionLocks.has(id)) return res.status(429).json({error: 'Подождите...'});
    actionLocks.add(id);

    try {
        const user = await User.findOne({id});
        const lobby = await Battle.findById(lobbyId);

        if(!user || !lobby || lobby.status !== 'waiting' || lobby.players.length >= 4) return res.status(400).json({error: 'Ошибка входа'});
        if(lobby.players.find(p => p.id === id)) return res.status(400).json({error: 'Уже в лобби'});
        
        if(isNaN(bet) || bet < 0.5 || bet > 150) return res.status(400).json({error: 'Ставка от 0.5 до 150 TON'});
        if(user.balance < bet) return res.status(400).json({error: 'Недостаточно средств'});

        user.balance = Number((user.balance - bet).toFixed(2));
        user.stats.bets++; user.stats.minus += bet;
        await user.save();

        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        const pColor = BATTLE_COLORS[lobby.players.length];
        lobby.players.push({ id: user.id, username: user.username, avatar, bet, color: pColor });
        
        if (lobby.players.length >= 2) {
            lobby.timerStartedAt = new Date();
            lobby.timerEndTime = new Date(Date.now() + 2 * 60 * 1000);
        }
        
        await lobby.save();
        io.emit('battleUpdate');

        if(bot) {
            bot.sendMessage(lobby.creatorId, `⚔️ Игрок **${user.username}** присоединился к вашей Battle Roulette! Ставка: ${bet} TON`, {parse_mode: 'Markdown'}).catch(()=>{});
        }

        res.json({user, lobby});
    } finally {
        actionLocks.delete(id);
    }
});

app.post('/api/battle/cancel', async (req, res) => {
    const { id, lobbyId } = req.body;
    const lobby = await Battle.findById(lobbyId);
    if(!lobby || lobby.creatorId !== id || lobby.players.length > 1) return res.status(400).json({error: 'Нельзя отменить'});

    const user = await User.findOne({id});
    user.balance = Number((user.balance + lobby.players[0].bet).toFixed(2));
    await user.save();
    
    await Battle.findByIdAndDelete(lobbyId);
    io.emit('battleUpdate');
    res.json(user);
});

// === SPIN GAME ===
const spinUserStreaks = {};

// 9 чистых пейлайнов: ряды + V-образные + ступеньки (только прямые и плавные линии)
const SPIN_PAYLINES = [
    [0,0,0,0,0],  // верхний ряд
    [1,1,1,1,1],  // средний ряд
    [2,2,2,2,2],  // нижний ряд
    [0,1,2,1,0],  // V-вниз
    [2,1,0,1,2],  // V-вверх
    [0,0,1,2,2],  // ступенька вниз
    [2,2,1,0,0],  // ступенька вверх
    [0,1,1,1,2],  // прогиб вниз
    [2,1,1,1,0],  // прогиб вверх
];

const SPIN_PAYTABLE = { 'L': { 3: 0.5, 4: 1, 5: 2 }, 'X': { 3: 2, 4: 5, 5: 10 } };

function generateSpinGrid(userId) {
    const streak = spinUserStreaks[userId] || { losses: 0, wins: 0, progress: 0 };
    // G очень редкий символ: 2.5% базово. При проигрышной серии чуть выше, при выигрышной — ниже
    let freqG = 0.025, freqX = 0.28;
    if (streak.losses >= 4) { freqX = Math.min(0.36, freqX + streak.losses * 0.015); freqG = Math.min(0.04, freqG + 0.005); }
    else if (streak.wins >= 4) { freqX = Math.max(0.18, freqX - streak.wins * 0.02); freqG = Math.max(0.015, freqG - 0.005); }
    const grid = [];
    for (let r = 0; r < 3; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
            const rand = Math.random();
            if (rand < freqG) row.push('G');
            else if (rand < freqG + freqX) row.push('X');
            else row.push('L');
        }
        grid.push(row);
    }
    return grid;
}

function checkSpinWins(grid, bet) {
    let totalWin = 0; const winLines = [];
    for (let li = 0; li < SPIN_PAYLINES.length; li++) {
        const line = SPIN_PAYLINES[li];
        const first = grid[line[0]][0];
        if (first === 'G') continue;
        let count = 1;
        for (let i = 1; i < 5; i++) { if (grid[line[i]][i] === first) count++; else break; }
        if (count >= 3 && SPIN_PAYTABLE[first] && SPIN_PAYTABLE[first][count]) {
            const mult = SPIN_PAYTABLE[first][count];
            totalWin += bet * mult;
            winLines.push({ lineIndex: li, symbol: first, count, multiplier: mult });
        }
    }
    return { totalWin, winLines };
}

function countSymbols(grid, sym) {
    let n = 0;
    for (let row of grid) for (let s of row) if (s === sym) n++;
    return n;
}

function applyHiddenG(grid) {
    const rand = Math.random();
    // Скрытая G очень редко: 4% — одна штука, двух больше нет
    let hiddenCount = rand < 0.04 ? 1 : 0;
    const positions = [];
    if (hiddenCount > 0) {
        const nonG = [];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) if (grid[r][c] !== 'G') nonG.push([r, c]);
        for (let i = nonG.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [nonG[i],nonG[j]]=[nonG[j],nonG[i]]; }
        for (let i = 0; i < Math.min(hiddenCount, nonG.length); i++) {
            const [r, c] = nonG[i]; grid[r][c] = 'G'; positions.push({ row: r, col: c });
        }
    }
    return positions;
}

app.post('/api/spin', async (req, res) => {
    const { id, bet, mode, freeSpinsMode, currentMultiplier } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({ error: 'Подождите...' });
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const betAmount = parseFloat(bet) || 0;
        if (betAmount < 0.1 || betAmount > 25) return res.status(400).json({ error: 'Ставка от 0.1 до 25 TON' });
        if (!freeSpinsMode && user[field] < betAmount) return res.status(400).json({ error: 'Недостаточно средств' });

        const rtpSetting = await Settings.findOne({ key: 'rtp_spin' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 94;

        if (!spinUserStreaks[id]) spinUserStreaks[id] = { losses: 0, wins: 0, progress: 0 };
        const streak = spinUserStreaks[id];

        if (!freeSpinsMode) {
            user[field] = Number((user[field] - betAmount).toFixed(2));
            if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; }
        }

        const grid = generateSpinGrid(id);
        // Считаем G ДО hidden G — только настоящие скаттеры триггерят фриспины
        const gCountBase = countSymbols(grid, 'G');
        const hiddenGs = applyHiddenG(grid);
        const { totalWin, winLines } = checkSpinWins(grid, betAmount);
        const gCount = countSymbols(grid, 'G'); // после hidden G, для прогресс-бара
        const xCount = winLines.filter(wl => wl.symbol === 'X').length; // только X на выигрышных линиях

        // Фриспины только от настоящих G (без hidden), ре-триггер во фриспинах запрещён
        let freeSpinsWon = 0;
        if (!freeSpinsMode) {
            if (gCountBase === 3) freeSpinsWon = 3;
            else if (gCountBase === 4) freeSpinsWon = 5;
            else if (gCountBase >= 5) freeSpinsWon = 8;
        }

        const freeMult = freeSpinsMode ? (parseFloat(currentMultiplier) || 1) : 1;
        let actualWin = Number((totalWin * freeMult).toFixed(2));
        const maxWin = betAmount * 40;
        if (actualWin > maxWin) actualWin = maxWin;

        // RTP control: строгий контроль частоты выигрышей
        // rtpTarget (например 94) / 100 * 0.22 = ~20% шанс выигрыша при 94 RTP
        // При низком RTP (например 30) — шанс ~6%
        if (!freeSpinsMode && actualWin > 0) {
            const winChance = (rtpTarget / 100) * 0.22;
            if (Math.random() > winChance) {
                actualWin = 0;
            } else {
                // Урезаем размер выигрыша: максимум 3x от ставки за обычный спин
                actualWin = Math.min(actualWin, betAmount * 3);
            }
        }

        let progressGain = gCount * 20 + hiddenGs.length * 10;
        streak.progress = (streak.progress || 0) + progressGain;
        let bonusTriggered = false;
        let bonusSpins = 0;
        if (streak.progress >= 100) { streak.progress -= 100; bonusTriggered = true; bonusSpins = 1; }

        if (actualWin > 0) { streak.wins = Math.min(8, (streak.wins||0)+1); streak.losses = 0; }
        else { streak.losses = Math.min(8, (streak.losses||0)+1); streak.wins = 0; }

        if (actualWin > 0) {
            user[field] = Number((user[field] + actualWin).toFixed(2));
            if (!isDemo) { user.stats.wins++; user.stats.plus += actualWin; }
        }

        await user.save();

        if (!isDemo && (!freeSpinsMode || actualWin > 0)) {
            const betEntry = new Bet({
                userId: user.id, username: user.username,
                avatar: user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
                game: 'Spin', amount: freeSpinsMode ? 0 : betAmount,
                multiplier: betAmount > 0 ? (actualWin / betAmount) : 1,
                result: freeSpinsMode ? actualWin : (actualWin - betAmount),
                mode: 'Real', balanceAfter: user[field], balance: user[field]
            });
            await betEntry.save();
            pushToGlobalHistory(betEntry);
        }

        res.json({ grid, win: actualWin, winLines, freeSpinsWon, hiddenGs, progressGain, progressValue: streak.progress, bonusTriggered, bonusSpins, xCountInGrid: xCount, gForExtraSpins: 0, user });
    } catch (err) {
        console.error('Spin error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
        actionLocks.delete(id);
    }
});

// === MINE GAME (Minecraft-style) ===
const MINE_BLOCKS = ['stone', 'redstone', 'gold', 'diamond', 'obsidian'];
const MINE_BLOCK_MULTS = { stone: 0, redstone: 0.7, gold: 1.5, diamond: 3, obsidian: 6 };
const MINE_ROW_WEIGHTS = [
    [0.68, 0.25, 0.06, 0.01, 0.00], // row 0 — top (common)
    [0.42, 0.30, 0.18, 0.08, 0.02], // row 1 — middle
    [0.20, 0.25, 0.30, 0.18, 0.07]  // row 2 — bottom (rare)
];
const MINE_PICKAXES = ['wooden', 'stone', 'iron', 'golden', 'diamond'];
const MINE_PICKAXE_WEIGHTS = [0.46, 0.28, 0.14, 0.08, 0.04];
const MINE_PICKAXE_MULTS = { wooden: 1.2, stone: 1.5, iron: 2.0, golden: 3.0, diamond: 5.0 };

const CHEST_MULT_VALUES  = [2, 3, 4, 5, 6, 7, 8];
const CHEST_MULT_WEIGHTS = [0.36, 0.25, 0.18, 0.10, 0.06, 0.03, 0.02];
const CHEST_MULT_EXPECTED = 3.42; // weighted average, used to normalize base win

function pickChestMult() {
    const r = Math.random(); let cum = 0;
    for (let i = 0; i < CHEST_MULT_VALUES.length; i++) {
        cum += CHEST_MULT_WEIGHTS[i];
        if (r < cum) return CHEST_MULT_VALUES[i];
    }
    return 2;
}

function generateMineGrid() {
    const grid = [];
    const BOOK_CHANCE = 0.06; // ~6% chance per block to be a magic book
    for (let r = 0; r < 3; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
            const weights = MINE_ROW_WEIGHTS[r];
            const rand = Math.random(); let cum = 0; let block = 'stone';
            for (let b = 0; b < MINE_BLOCKS.length; b++) { cum += weights[b]; if (rand < cum) { block = MINE_BLOCKS[b]; break; } }
            // Book bonus (no TNT in blocks)
            if (!(r === 2 && c === 2)) {
                if (Math.random() < BOOK_CHANCE) block = 'book';
            }
            row.push(block);
        }
        grid.push(row);
    }
    return grid;
}

app.post('/api/mine', async (req, res) => {
    const { id, bet, mode } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({ error: 'Подождите...' });
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const betAmount = parseFloat(bet) || 0;
        if (betAmount < 0.1 || betAmount > 25) return res.status(400).json({ error: 'Ставка от 0.1 до 25 TON' });
        if (user[field] < betAmount) return res.status(400).json({ error: 'Недостаточно средств' });

        const maintSetting = await Settings.findOne({ key: 'maintenance_mine' });
        if (maintSetting && maintSetting.value === true) return res.status(400).json({ error: 'Игра на техническом обслуживании' });

        const rtpSetting = await Settings.findOne({ key: 'rtp_mine' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 40;

        user[field] = Number((user[field] - betAmount).toFixed(2));
        if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; }

        const grid = generateMineGrid();
        const mainBlock = grid[2][2]; // row 2, col 2 = centre result block
        const baseMult  = MINE_BLOCK_MULTS[mainBlock] || 0;

        // Pickaxe — always pick one
        const pr = Math.random(); let cum2 = 0; let pickaxe = 'wooden';
        for (let i = 0; i < MINE_PICKAXES.length; i++) { cum2 += MINE_PICKAXE_WEIGHTS[i]; if (pr < cum2) { pickaxe = MINE_PICKAXES[i]; break; } }
        const pickaxeMult = MINE_PICKAXE_MULTS[pickaxe] || 1;

        // Chest multiplier — shown after all chests open
        const chestMult = pickChestMult();

        // Win decision — base win is pre-divided by expected chest mult so RTP stays correct
        let baseWin = 0;
        if (baseMult > 0) {
            baseWin = betAmount * baseMult * pickaxeMult / CHEST_MULT_EXPECTED;
            const winChance = (rtpTarget / 100) * 0.22;
            if (Math.random() > winChance) { baseWin = 0; }
            else { baseWin = Math.min(baseWin, betAmount * 6); }
        }
        const actualWin = baseWin > 0 ? Number((baseWin * chestMult).toFixed(2)) : 0;

        // Distribute baseWin across blocks proportionally by their base multiplier
        // book blocks get no direct win (they're bonuses)
        const BLOCK_PAY_MULTS = { stone:0, redstone:0.7, gold:1.5, diamond:3, obsidian:6, book:0 };
        let totalBlockMult = 0;
        for (let r = 0; r < 3; r++)
            for (let c = 0; c < 5; c++)
                totalBlockMult += (BLOCK_PAY_MULTS[grid[r][c]] || 0);

        const blockWins = [];
        for (let r = 0; r < 3; r++) {
            const row = [];
            for (let c = 0; c < 5; c++) {
                const bm = BLOCK_PAY_MULTS[grid[r][c]] || 0;
                row.push(totalBlockMult > 0 && baseWin > 0 ? parseFloat((baseWin * bm / totalBlockMult).toFixed(4)) : 0);
            }
            blockWins.push(row);
        }

        if (actualWin > 0) {
            user[field] = Number((user[field] + actualWin).toFixed(2));
            if (!isDemo) { user.stats.wins++; user.stats.plus += actualWin; }
        }
        await user.save();

        if (!isDemo) {
            const betEntry = new Bet({
                userId: user.id, username: user.username,
                avatar: user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
                game: 'Mine', amount: betAmount,
                multiplier: betAmount > 0 ? (actualWin / betAmount) : 0,
                result: actualWin - betAmount, mode: 'Real', balanceAfter: user[field], balance: user[field]
            });
            await betEntry.save();
            pushToGlobalHistory(betEntry);
        }

        res.json({ grid, blockWins, mainBlock, pickaxe, pickaxeMult, baseMult, chestMult, win: actualWin, user });
    } catch (err) {
        console.error('Mine error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
        actionLocks.delete(id);
    }
});

app.post('/api/check_deposit', async (req, res) => {
    const { id } = req.body;
    const adminWallet = process.env.ADMIN_WALLET;
    const apiKey = process.env.TON_API_KEY;
    
    if (!adminWallet) return res.status(500).json({error: 'Адрес кошелька не настроен'});
    if (!apiKey) return res.status(500).json({error: 'TON_API_KEY не установлен'});

    try {
        // TonCenter v2 с API ключом (прямое обращение)
        const tcUrl = `https://toncenter.com/api/v2/getTransactions?address=${adminWallet}&limit=50&api_key=${apiKey}`;
        const tcRes = await fetch(tcUrl);
        const data = await tcRes.json();
        if (!data.ok) {
            console.error('TonCenter error:', data.error);
            return res.status(400).json({ error: `Ошибка проверки: ${data.error || 'нет ответа от TonCenter'}` });
        }
        
        let foundNew = false;
        let totalAdded = 0;
        
        for (let tx of data.result) {
            if (tx.in_msg && tx.in_msg.message && String(tx.in_msg.message).trim() === String(id).trim() && tx.in_msg.value > 0) {
                const txHash = tx.transaction_id.hash;
                const amountTON = tx.in_msg.value / 1e9; 
                const exists = await Deposit.findOne({ hash: txHash });
                if(!exists) {
                    await Deposit.create({ hash: txHash, userId: id, amount: amountTON, time: getMskTime() });
                    const user = await User.findOne({ id });
                    user.balance = Number((user.balance + amountTON).toFixed(2));
                    user.depositHistory.unshift({ hash: txHash, amount: amountTON, status: 'Успешно', time: getMskTime() });
                    await user.save();
                    foundNew = true;
                    totalAdded += amountTON;

                    if(bot) {
                        bot.sendMessage(id, `📥 ✅ Ваш баланс успешно пополнен на **${amountTON} TON**!`, {parse_mode: 'Markdown'}).catch(()=>{});
                    }

                    if (user.referredBy) {
                        const referrer = await User.findOne({ id: user.referredBy });
                        if (referrer) {
                            const refBonus = Number((amountTON * 0.10).toFixed(2));
                            referrer.balance = Number((referrer.balance + refBonus).toFixed(2));
                            referrer.referralEarnings = Number((referrer.referralEarnings + refBonus).toFixed(2));
                            await referrer.save();
                            
                            if (bot) {
                                bot.sendMessage(referrer.id, `🎉 Ваш реферал пополнил баланс! Вам начислено **${refBonus} TON** (10%).`, {parse_mode: 'Markdown'}).catch(()=>{});
                            }
                        }
                    }
                }
            }
        }
        if(foundNew) {
            const updUser = await User.findOne({id});
            res.json({ success: true, added: totalAdded, user: updUser });
        } else res.status(400).json({ error: 'Новых оплат не найдено' });
    } catch (e) { 
        res.status(500).json({error: 'Network error'}); 
    }
});

app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    const promo = await Promo.findOne({ code });
    
    if(!promo) return res.status(400).json({error: 'Промокод не найден'});
    if(promo.usedBy.length >= promo.limit || promo.usedBy.includes(id)) return res.status(400).json({error: 'Промокод уже активирован'});
    
    const user = await User.findOne({ id });
    user.balance = Number((user.balance + promo.amount).toFixed(2)); 
    user.stats.promo += promo.amount; 
    promo.usedBy.push(id);
    
    await user.save(); await promo.save();

    if(bot) {
        bot.sendMessage(id, `🎁 Вы успешно активировали промокод и получили **${promo.amount} TON** на баланс!`, {parse_mode: 'Markdown'}).catch(()=>{});
    }

    res.json(user);
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    
    if (actionLocks.has(id)) return res.status(429).json({error: 'Подождите...'});
    actionLocks.add(id);

    try {
        const user = await User.findOne({ id });
        if (isNaN(amount) || user.balance < amount || amount < 5) return res.status(400).json({error: 'Min 5 TON'});
        user.balance = Number((user.balance - amount).toFixed(2)); 
        
        const newW = await Withdraw.create({ userId: id, address, amount, time: getMskTime() });
        
        user.withdrawHistory.unshift({ withdrawId: newW._id, amount, address, status: 'В обработке', reason: '', time: newW.time });
        await user.save();

        res.json(user);
    } finally {
        actionLocks.delete(id);
    }
});

// --- АДМИН ПАНЕЛЬ ---
const checkAdmin = (req, res, next) => {
    if(req.body.pass !== (process.env.ADMIN_PASS || '1234')) return res.status(403).json({error: 'Wrong pass'});
    next();
};

app.post('/api/admin/data', checkAdmin, async (req, res) => {
    const withdraws = await Withdraw.find({status: 'pending'});
    const promos = await Promo.find().sort({_id: -1}).limit(10);
    const users = await User.find().sort({balance: -1}).limit(100);
    const totalUsers = await User.countDocuments();
    
    const allDeps = await Deposit.aggregate([{$group: {_id: null, total: {$sum: "$amount"}}}]);
    const allWiths = await Withdraw.aggregate([{$match: {status: 'approved'}}, {$group: {_id: null, total: {$sum: "$amount"}}}]);
    const totalDeposited = allDeps[0] ? allDeps[0].total : 0;
    const totalWithdrawn = allWiths[0] ? allWiths[0].total : 0;
    
    const latestDepositsRaw = await Deposit.find().sort({_id: -1}).limit(20);
    const latestDeposits = [];
    for(let d of latestDepositsRaw) {
        const u = await User.findOne({id: d.userId});
        latestDeposits.push({amount: d.amount, userId: d.userId, username: u ? u.username : 'Unknown', time: d.time});
    }

    const allSettings = await Settings.find();
    const rtpData = {};
    const maintenanceData = {};
    allSettings.forEach(s => {
        if (s && s.key) {
            if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
            if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
        }
    });

    const latestBetsRaw = await Bet.find().sort({createdAt: -1}).limit(20);
    const latestBets = latestBetsRaw.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));
    
    res.json({ 
        withdraws, promos, users, totalUsers, 
        totalDeposited, totalWithdrawn, latestDeposits,
        latestBets, betHistory: latestBets, history: latestBets, 
        rtp: rtpData, maintenance: maintenanceData 
    });
});

app.post('/api/admin/search_user', checkAdmin, async (req, res) => {
    const { query, filterType } = req.body;
    let filter = {};
    
    if (query) {
        filter = { $or: [{ id: new RegExp(query, 'i') }, { username: new RegExp(query, 'i') }] };
    }
    
    if (filterType === 'banned') filter.isBlocked = true;
    
    let sortConfig = { balance: -1 };
    if (filterType === 'new') sortConfig = { createdAt: -1 };

    const users = await User.find(filter).sort(sortConfig).limit(500);
    res.json({ users });
});

app.post(['/api/admin/user_details', '/api/admin/user_history'], checkAdmin, async (req, res) => {
    const targetId = String(req.body.userId || req.body.id || req.body.tgId || req.body.user_id);
    const page = req.body.page || 1;
    const limit = req.body.limit || 50; 
    
    const user = await User.findOne({ id: targetId });
    if (!user) return res.status(404).json({error: 'User not found'});

    const totalBets = await Bet.countDocuments({ userId: targetId });
    const totalPages = Math.ceil(totalBets / limit);
    const bets = await Bet.find({ userId: targetId })
        .sort({ createdAt: -1 }) 
        .skip((page - 1) * limit)
        .limit(limit);

    const formattedBets = bets.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));

    const userObj = user.toObject();
    userObj.betHistory = formattedBets;

    res.json({
        user: userObj,
        bets: formattedBets,
        betHistory: formattedBets, 
        history: formattedBets,    
        pagination: { 
            currentPage: Number(page), 
            totalPages, 
            totalBets 
        }
    });
});
// Усиленная обработка кнопок баланса (исправленная версия без краша Mongoose)
app.post('/api/admin/edit_balance', checkAdmin, async (req, res) => {
    try {
        const targetId = String(req.body.userId || req.body.id || req.body.tgId || req.body.user_id);
        if (!targetId) return res.status(400).json({ error: 'ID не передан' });

        // БЕЗОПАСНЫЙ ПОИСК: формируем условия динамически
        const searchConditions = [{ id: targetId }];
        if (mongoose.isValidObjectId(targetId)) {
            searchConditions.push({ _id: targetId });
        }

        let user = await User.findOne({ $or: searchConditions });

        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        const rawAmount = req.body.amount !== undefined ? req.body.amount : (req.body.balance !== undefined ? req.body.balance : req.body.value);
        let val = Number(String(rawAmount || 0).replace(',', '.'));
        
        if (isNaN(val)) return res.status(400).json({ error: 'Неверное число' });

        const action = String(req.body.action || req.body.type || req.body.method || '').toLowerCase();
        
        // Определяем, нужно ли вычесть деньги
        const isSubtraction = val < 0 || action.includes('sub') || action.includes('minus') || action.includes('remove') || action.includes('take') || action.includes('decrease');
        const absVal = Math.abs(val);

        if (isSubtraction) {
            user.balance = Number((user.balance - absVal).toFixed(2));
            if (user.balance < 0) user.balance = 0; // Защита от отрицательного баланса
            if (bot && absVal > 0) bot.sendMessage(user.id, `📉 С вашего баланса было списано **${absVal} TON** администратором.`, {parse_mode: 'Markdown'}).catch(() => {});
        } else {
            user.balance = Number((user.balance + absVal).toFixed(2));
            if (bot && absVal > 0) bot.sendMessage(user.id, `💰 Ваш баланс был пополнен администратором на **${absVal} TON**!`, {parse_mode: 'Markdown'}).catch(() => {});
        }

        await user.save();
        const logStr = isSubtraction
            ? `Списал ${absVal} TON у пользователя ${user.username || user.id} (новый баланс: ${user.balance} TON)`
            : `Выдал ${absVal} TON пользователю ${user.username || user.id} (новый баланс: ${user.balance} TON)`;
        await logAdmin(logStr);
        res.json({ success: true, newBalance: user.balance, balance: user.balance });

    } catch (err) {
        console.error('Ошибка в edit_balance:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Алиас для фронтенда (вызывает ту же логику)
app.post('/api/admin/change_balance', checkAdmin, async (req, res) => {
    const targetId = String(req.body.userId || req.body.id || '');
    if (!targetId) return res.status(400).json({ error: 'ID не передан' });
    const searchConditions = [{ id: targetId }];
    if (mongoose.isValidObjectId(targetId)) searchConditions.push({ _id: targetId });
    let user = await User.findOne({ $or: searchConditions });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const rawAmount = req.body.amount !== undefined ? req.body.amount : 0;
    const absVal = Math.abs(Number(String(rawAmount).replace(',', '.')));
    if (isNaN(absVal) || absVal <= 0) return res.status(400).json({ error: 'Неверная сумма' });
    const type = String(req.body.type || '').toLowerCase();
    const isSub = type === 'sub' || type === 'minus' || type === 'remove';
    if (isSub) {
        user.balance = Number(Math.max(0, user.balance - absVal).toFixed(2));
        if (bot) bot.sendMessage(user.id, `📉 С вашего баланса было списано **${absVal} TON** администратором.`, {parse_mode: 'Markdown'}).catch(() => {});
        await logAdmin(`Списал ${absVal} TON у пользователя ${user.username || user.id} (новый баланс: ${user.balance} TON)`);
    } else {
        user.balance = Number((user.balance + absVal).toFixed(2));
        if (bot) bot.sendMessage(user.id, `💰 Ваш баланс был пополнен администратором на **${absVal} TON**!`, {parse_mode: 'Markdown'}).catch(() => {});
        await logAdmin(`Выдал ${absVal} TON пользователю ${user.username || user.id} (новый баланс: ${user.balance} TON)`);
    }
    await user.save();
    res.json({ success: true, newBalance: user.balance, balance: user.balance });
});

app.post('/api/admin/broadcast', checkAdmin, (req, res) => {
    const { text } = req.body;
    if(text) io.emit('global_alert', text);
    res.json({success: true});
});

app.post('/api/admin/bot_broadcast', checkAdmin, async (req, res) => {
    const { text } = req.body;
    if(!text || !bot) return res.status(400).json({error: 'Текст пуст'});
    const users = await User.find({ isBlocked: false });
    for(let u of users) { bot.sendMessage(u.id, text).catch(()=>{}); }
    res.json({success: true});
});

app.post('/api/admin/reset_all_stats', checkAdmin, async (req, res) => {
    await User.updateMany({}, { $set: { betHistory: [], demo_balance: 5000, stats: { bets: 0, wins: 0, plus: 0, minus: 0, promo: 0 } } });
    await Bet.deleteMany({});
    globalBetHistory = [];
    io.emit('init_history', globalBetHistory);
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
            if(bot) {
                bot.sendMessage(w.userId, `✅ Ваш вывод на сумму **${w.amount} TON** успешно обработан и отправлен на ваш кошелек!`, {parse_mode: 'Markdown'}).catch(()=>{});
            }
        }
        await u.save();
    }
    
    if(action === 'reject') { 
        w.status = 'rejected'; w.reason = reason;
        await logAdmin(`Отклонил вывод ${w.amount} TON (ID юзера: ${w.userId}) — причина: ${reason}`);
    } else { 
        w.status = 'approved';
        await logAdmin(`Одобрил вывод ${w.amount} TON (ID юзера: ${w.userId}) на адрес ${w.address}`);
    }
    await w.save();
    
    res.json({success: true});
});

app.post('/api/admin/user_action', checkAdmin, async (req, res) => {
    const { userId, action } = req.body;
    if (!userId || !action) return res.status(400).json({ error: 'Не указаны параметры' });
    const user = await User.findOne({ id: String(userId) });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (action === 'ban') {
        user.isBlocked = true;
        await logAdmin(`Забанил пользователя ${user.username || user.id}`);
        if (bot) bot.sendMessage(user.id, '🚫 Ваш аккаунт заблокирован администратором.').catch(() => {});
    } else if (action === 'unban') {
        user.isBlocked = false;
        await logAdmin(`Разбанил пользователя ${user.username || user.id}`);
        if (bot) bot.sendMessage(user.id, '✅ Ваш аккаунт разблокирован.').catch(() => {});
    } else {
        return res.status(400).json({ error: 'Неизвестное действие' });
    }
    await user.save();
    res.json({ success: true });
});

app.post('/api/admin/logs', checkAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.body.page) || 1);
        const limit = Math.min(50, parseInt(req.body.limit) || 30);
        const dateQuery = req.body.date || '';
        const filter = dateQuery ? { action: { $regex: dateQuery, $options: 'i' } } : {};
        const total = await AdminLog.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const logs = await AdminLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
        const formatted = logs.map(l => {
            const d = new Date(l.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
            const parts = d.split(', ');
            return { date: parts[0] || '', time: parts[1] || '', adminUser: 'Админ', action: l.action };
        });
        res.json({ logs: formatted, totalPages, total });
    } catch(e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/user/history', async (req, res) => {
    const targetId = String(req.body.id || req.body.userId || req.body.tgId);
    if (!targetId) return res.status(400).json({error: 'No ID provided'});
    const bets = await Bet.find({ userId: targetId }).sort({ createdAt: -1 }).limit(50);
    const formattedBets = bets.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));
    res.json({ bets: formattedBets, betHistory: formattedBets, history: formattedBets });
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server Running on port ${PORT}`));
