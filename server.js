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

// Анти-сон (пинг себя)
const SELF_BASE_URL = process.env.WEB_APP_URL || process.env.RENDER_EXTERNAL_URL;
if (SELF_BASE_URL) {
    setInterval(() => {
        fetch(`${SELF_BASE_URL}/ping`).then(() => console.log('🔄 Анти-сон: Сервер пинганул сам себя')).catch(() => {});
    }, 10 * 60 * 1000);
}

// Подключение к БД
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log('❌ DB Error:', err));

// --- 1. TON CONNECT MANIFEST ---
app.get('/tonconnect-manifest.json', (req, res) => {
    const baseUrl = process.env.WEB_APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://localhost';
    res.json({
        url: baseUrl,
        name: "LoonxGift",
        iconUrl: baseUrl + "/toncoin-ton-logo.png",
        termsOfUseUrl: "",
        privacyPolicyUrl: ""
    });
});

// Синхронизация текстур: textures/ -> sprites/ (для удобной замены текстур)
const fs = require('fs');
function syncTextures() {
    const textureDir = path.join(__dirname, 'public', 'textures');
    const spriteDir = path.join(__dirname, 'public', 'sprites');
    const folders = ['blocks', 'pickaxes', 'chests', 'effects'];
    if (!fs.existsSync(spriteDir)) fs.mkdirSync(spriteDir, { recursive: true });
    for (const folder of folders) {
        const src = path.join(textureDir, folder);
        if (!fs.existsSync(src)) continue;
        for (const file of fs.readdirSync(src)) {
            if (!file.endsWith('.png')) continue;
            const srcFile = path.join(src, file);
            // Map texture filenames to sprite filenames (same name)
            const dstFile = path.join(spriteDir, file);
            try { fs.copyFileSync(srcFile, dstFile); } catch(e) {}
        }
    }
    console.log('Текстуры синхронизированы: textures/ -> sprites/');
}
syncTextures();

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
    betHistory: { type: Array, default: [] },
    mineFreeSpins: { type: Number, default: 0 },
    wagerRequired: { type: Number, default: 0 },
    wagerCompleted: { type: Number, default: 0 },
    totalDeposited: { type: Number, default: 0 },
    totalWagered: { type: Number, default: 0 }
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
        { key: 'rtp_spin', value: 90 },
        { key: 'rtp_mine', value: 90 },
        { key: 'maintenance_mine', value: false },
        { key: 'wager_multiplier', value: 2 }
    ];
    for (let setting of defaultSettings) {
        const exists = await Settings.findOne({ key: setting.key });
        if (!exists) await Settings.create(setting);
    }
    
    // Note: RTP values are now admin-configurable, no forced override
    
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

    bot.onText(/\/(start|help)(?: (.+))?/, async (msg, match) => {
        const refParam = match[2] || '';
        const text = `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в LoonxGift.\n\nТут ты можешь играть и выигрывать TON! Твой баланс и все игры находятся внутри Mini App.\n\nВыбирай действие в меню ниже:`;

        const baseUrl = process.env.WEB_APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://localhost';
        const appUrl = refParam ? `${baseUrl}?start_param=${refParam}` : baseUrl;

        // Auto-register user on /start so referral works even before opening mini app
        const tgUser = msg.from;
        let existingUser = await User.findOne({ id: String(tgUser.id) });
        if (!existingUser && refParam && refParam !== String(tgUser.id)) {
            existingUser = await User.create({
                id: String(tgUser.id),
                username: tgUser.username || tgUser.first_name,
                photo: ''
            });
            const referrer = await User.findOne({ id: String(refParam) });
            if (referrer) {
                existingUser.referredBy = String(refParam);
                referrer.referrals.push(String(tgUser.id));
                await referrer.save();
                await existingUser.save();
            }
        }

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

    const wagerSett = await Settings.findOne({ key: 'wager_multiplier' });
    const wagerMult = wagerSett ? wagerSett.value : 2;
    res.json({ user: userObj, adminWallet: process.env.ADMIN_WALLET, rtp: rtpData, maintenance: maintenanceData, wagerMultiplier: wagerMult });
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
        if (bet > 0 && (bet < 0.1 || bet > 25)) return res.status(400).json({error: 'Bet must be 0.1-25 TON'});
        
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
            if (bet > 0) { user.stats.bets++; user.totalWagered = Number(((user.totalWagered || 0) + bet).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + bet).toFixed(2)); }
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

// 15 пейлайнов: ряды + V-образные + ступеньки + зигзаги + диагонали (синхронизировано с фронтендом)
const SPIN_PAYLINES = [
    [1,1,1,1,1],  // 0: средний ряд
    [0,0,0,0,0],  // 1: верхний ряд
    [2,2,2,2,2],  // 2: нижний ряд
    [0,1,2,1,0],  // 3: V-вниз
    [2,1,0,1,2],  // 4: V-вверх
    [0,0,1,2,2],  // 5: ступенька вниз
    [2,2,1,0,0],  // 6: ступенька вверх
    [1,0,1,0,1],  // 7: зигзаг верх
    [0,1,0,1,0],  // 8: зигзаг низ
    [1,2,1,2,1],  // 9: зигзаг низ2
    [2,1,2,1,2],  // 10: зигзаг верх2
    [0,1,1,1,2],  // 11: прогиб вниз
    [2,1,1,1,0],  // 12: прогиб вверх
    [1,1,0,1,1],  // 13: впадина вверх
    [1,1,2,1,1],  // 14: впадина вниз
];

const SPIN_PAYTABLE = { 'L': { 3: 0.3, 4: 0.8, 5: 1.5 }, 'X': { 3: 1.5, 4: 4, 5: 8 } };

function generateSpinGrid(userId) {
    const streak = spinUserStreaks[userId] || { losses: 0, wins: 0, progress: 0 };
    // G очень редкий: 2%, X умеренно: 20%. При проигрышной серии чуть выше
    let freqG = 0.02, freqX = 0.20;
    if (streak.losses >= 4) { freqX = Math.min(0.28, freqX + streak.losses * 0.01); freqG = Math.min(0.035, freqG + 0.004); }
    else if (streak.wins >= 3) { freqX = Math.max(0.14, freqX - streak.wins * 0.02); freqG = Math.max(0.012, freqG - 0.003); }
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
            if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; user.totalWagered = Number(((user.totalWagered || 0) + betAmount).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + betAmount).toFixed(2)); }
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

        // RTP control: fair probability based on RTP percentage
        // rtpTarget 90 = 90% RTP -> winChance scales proportionally
        if (!freeSpinsMode && actualWin > 0) {
            const winChance = rtpTarget / 100;
            if (Math.random() > winChance) {
                actualWin = 0;
            } else {
                // Cap max win per regular spin at 5x bet
                actualWin = Math.min(actualWin, betAmount * 5);
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
const MINE_BLOCKS = ['dirt', 'stone', 'redstone', 'gold', 'diamond', 'obsidian'];
const MINE_BLOCK_MULTS = { grass: 0.05, dirt: 0.05, stone: 0.09, redstone: 0.1, gold: 0.15, diamond: 0.2, obsidian: 0.3 };
// 6 rows: row 0 = grass top layer (dirt + rare stone), rows 1-5 = underground
const MINE_ROW_WEIGHTS = [
    // grass/dirt top: dirt=85%, stone=15%  (no ores)
    [0.85, 0.15, 0.00, 0.00, 0.00, 0.00],
    // row 1 — mostly stone
    [0.10, 0.62, 0.20, 0.06, 0.015, 0.005],
    // row 2
    [0.05, 0.45, 0.28, 0.15, 0.05, 0.02],
    // row 3 — middle
    [0.00, 0.30, 0.30, 0.24, 0.11, 0.05],
    // row 4
    [0.00, 0.18, 0.26, 0.28, 0.18, 0.10],
    // row 5 — bottom (rare ores)
    [0.00, 0.10, 0.20, 0.30, 0.24, 0.16]
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
    for (let r = 0; r < 6; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
            if (r === 0) {
                // Top layer: grass blocks (visual), underlying type is dirt or rare stone
                row.push('grass');
            } else {
                const weights = MINE_ROW_WEIGHTS[r];
                const rand = Math.random(); let cum = 0; let block = 'stone';
                for (let b = 0; b < MINE_BLOCKS.length; b++) { cum += weights[b]; if (rand < cum) { block = MINE_BLOCKS[b]; break; } }
                row.push(block);
            }
        }
        grid.push(row);
    }
    return grid;
}

function generateMineHotbar(rtpTarget) {
    // 3 rows x 5 cols = 15 slots
    // TNT: 10%, Book: 5%, Pickaxes: RTP-dependent (lower RTP = fewer/worse pickaxes)
    // Remaining: empty slots
    const rtpFactor = Math.max(0.3, Math.min(1.0, (rtpTarget || 50) / 100));
    const pickChance = 0.25 * rtpFactor; // 7.5%-25% depending on RTP
    const tntChance = 0.10;
    const bookChance = 0.05;

    // Adjust pickaxe weights by RTP: lower RTP = more wooden, less diamond
    const rtpPickWeights = [
        0.46 + (1 - rtpFactor) * 0.3,  // wooden: more at low RTP
        0.28,                            // stone: stable
        0.14 * rtpFactor,               // iron: less at low RTP
        0.08 * rtpFactor,               // golden: less at low RTP
        0.04 * rtpFactor * rtpFactor    // diamond: much less at low RTP
    ];
    const wSum = rtpPickWeights.reduce((a, b) => a + b, 0);
    const normPickWeights = rtpPickWeights.map(w => w / wSum);

    const slots = [];
    let pickCount = 0;
    for (let i = 0; i < 15; i++) {
        const r = Math.random();
        if (r < tntChance) {
            slots.push({ type: 'tnt' });
        } else if (r < tntChance + bookChance) {
            slots.push({ type: 'book' });
        } else if (r < tntChance + bookChance + pickChance) {
            const pr = Math.random(); let cum = 0; let pType = 'wooden';
            for (let j = 0; j < MINE_PICKAXES.length; j++) {
                cum += normPickWeights[j];
                if (pr < cum) { pType = MINE_PICKAXES[j]; break; }
            }
            slots.push({ type: 'pickaxe', pickaxeType: pType });
            pickCount++;
        } else {
            slots.push({ type: 'empty' });
        }
    }
    if (pickCount === 0) {
        const idx = Math.floor(Math.random() * 15);
        slots[idx] = { type: 'pickaxe', pickaxeType: 'wooden' };
    }
    return slots;
}

app.post('/api/mine', async (req, res) => {
    const { id, bet, mode, autoSpin, persistGrid: clientGrid } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({ error: 'Подождите...' });
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const isFreeAutoSpin = autoSpin === true;
        if (isFreeAutoSpin) {
            const freeSpins = user.mineFreeSpins || 0;
            if (freeSpins <= 0) return res.status(400).json({ error: 'Нет бесплатных спинов' });
            user.mineFreeSpins = freeSpins - 1;
        }
        const betAmount = isFreeAutoSpin ? 0 : (parseFloat(bet) || 0);
        if (!isFreeAutoSpin && (betAmount < 0.1 || betAmount > 25)) return res.status(400).json({ error: 'Ставка от 0.1 до 25 TON' });
        if (!isFreeAutoSpin && user[field] < betAmount) return res.status(400).json({ error: 'Недостаточно средств' });

        const maintSetting = await Settings.findOne({ key: 'maintenance_mine' });
        if (maintSetting && maintSetting.value === true) return res.status(400).json({ error: 'Игра на техническом обслуживании' });

        const rtpSetting = await Settings.findOne({ key: 'rtp_mine' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 40;

        if (!isFreeAutoSpin) {
            user[field] = Number((user[field] - betAmount).toFixed(2));
            if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; user.totalWagered = Number(((user.totalWagered || 0) + betAmount).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + betAmount).toFixed(2)); }
        }

        // For auto-spin: reuse existing grid (broken blocks stay null), only re-roll hotbar
        const grid = (isFreeAutoSpin && clientGrid) ? clientGrid : generateMineGrid();
        const hotbar = generateMineHotbar(rtpTarget);
        // Per-column chest multipliers
        const chestMults = [];
        for (let c = 0; c < 5; c++) chestMults.push(pickChestMult());
        const effectiveBet = isFreeAutoSpin ? 0.5 : betAmount;

        // Each block has fixed mult: block win = bet * blockMult
        // null blocks (broken in auto-spin) give 0 win
        const blockWins = [];
        let rawSum = 0;
        for (let r = 0; r < 6; r++) {
            const row = [];
            for (let c = 0; c < 5; c++) {
                if (!grid[r][c]) { row.push(0); continue; }
                const bm = MINE_BLOCK_MULTS[grid[r][c]] || 0;
                const bw = parseFloat((effectiveBet * bm).toFixed(4));
                row.push(bw);
                rawSum += bw;
            }
            blockWins.push(row);
        }

        // RTP control: fair win chance based on RTP
        const winChance = rtpTarget / 100;
        let scaleFactor = 1;
        if (Math.random() >= winChance) {
            scaleFactor = 0.1; // Low win on losing rolls
        }
        let baseWin = Math.min(rawSum * scaleFactor, effectiveBet * 8);

        // Recalculate blockWins with scale factor
        const adjustedBlockWins = [];
        for (let r = 0; r < 6; r++) {
            const row = [];
            for (let c = 0; c < 5; c++) {
                row.push(rawSum > 0 ? parseFloat((blockWins[r][c] * scaleFactor * (baseWin / (rawSum * scaleFactor || 1))).toFixed(4)) : 0);
            }
            adjustedBlockWins.push(row);
        }

        // Total win = sum of (column_win * column_chest_mult) for each column
        let actualWin = 0;
        for (let c = 0; c < 5; c++) {
            let colWin = 0;
            for (let r = 0; r < 6; r++) colWin += adjustedBlockWins[r][c];
            actualWin += colWin * chestMults[c];
        }
        actualWin = Number(actualWin.toFixed(2));

        let bookCount = hotbar.filter(s => s.type === 'book').length;
        if (bookCount >= 3) {
            user.mineFreeSpins = (user.mineFreeSpins || 0) + 1;
        }

        user[field] = Number((user[field] + actualWin).toFixed(2));
        if (!isDemo && actualWin > 0) { user.stats.wins++; user.stats.plus += actualWin; }
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

        res.json({ grid, blockWins: adjustedBlockWins, hotbar, chestMults, win: actualWin, user, freeSpinsLeft: user.mineFreeSpins || 0 });
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

    if (!adminWallet) return res.status(500).json({error: 'Адрес кошелька не настроен. Установите ADMIN_WALLET в .env'});
    if (!apiKey) return res.status(500).json({error: 'TON_API_KEY не установлен в .env'});

    try {
        const tcUrl = `https://toncenter.com/api/v2/getTransactions?address=${adminWallet}&limit=50&api_key=${apiKey}`;
        const tcRes = await fetch(tcUrl);
        if (!tcRes.ok) {
            return res.status(400).json({ error: `TonCenter HTTP ${tcRes.status}` });
        }
        const data = await tcRes.json();
        if (!data.ok) {
            console.error('TonCenter error:', data.error);
            return res.status(400).json({ error: `Ошибка TonCenter: ${data.error || 'нет ответа'}` });
        }

        let foundNew = false;
        let totalAdded = 0;
        const userId = String(id).trim();

        for (const tx of (data.result || [])) {
            if (!tx.in_msg || !tx.in_msg.value || Number(tx.in_msg.value) <= 0) continue;

            // Check comment in multiple possible fields
            let comment = '';
            if (tx.in_msg.message) comment = String(tx.in_msg.message).trim();
            if (!comment && tx.in_msg.msg_data && tx.in_msg.msg_data.text) {
                try { comment = Buffer.from(tx.in_msg.msg_data.text, 'base64').toString('utf-8').trim(); } catch(e) {}
            }

            if (comment !== userId) continue;

            const txHash = tx.transaction_id ? tx.transaction_id.hash : tx.hash;
            if (!txHash) continue;
            const amountTON = Number(tx.in_msg.value) / 1e9;
            if (amountTON < 0.01) continue;

            const exists = await Deposit.findOne({ hash: txHash });
            if (exists) continue;

            await Deposit.create({ hash: txHash, userId: id, amount: amountTON, time: getMskTime() });
            const user = await User.findOne({ id });
            user.balance = Number((user.balance + amountTON).toFixed(2));
            user.depositHistory.unshift({ hash: txHash, amount: amountTON, status: 'Успешно', time: getMskTime() });
            // Wager requirement: add deposit * wager_multiplier to required wagering
            const wagerSetting = await Settings.findOne({ key: 'wager_multiplier' });
            const wagerMult = wagerSetting ? Number(wagerSetting.value) : 2;
            user.totalDeposited = Number(((user.totalDeposited || 0) + amountTON).toFixed(2));
            user.wagerRequired = Number(((user.wagerRequired || 0) + amountTON * wagerMult).toFixed(2));
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
        if(foundNew) {
            const updUser = await User.findOne({id});
            res.json({ success: true, added: totalAdded, user: updUser });
        } else res.status(400).json({ error: 'Новых оплат не найдено. Убедитесь что в комментарии указан ваш ID и прошло достаточно времени.' });
    } catch (e) {
        console.error('Deposit check error:', e);
        res.status(500).json({error: 'Ошибка сети при проверке. Попробуйте позже.'});
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
        // Check wager requirement
        const wagerLeft = (user.wagerRequired || 0) - (user.wagerCompleted || 0);
        if (wagerLeft > 0) return res.status(400).json({error: `Нужно отыграть ещё ${wagerLeft.toFixed(2)} TON перед выводом`});
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
    
    const wagerSetting = await Settings.findOne({ key: 'wager_multiplier' });
    const wagerMultiplier = wagerSetting ? wagerSetting.value : 2;

    res.json({
        withdraws, promos, users, totalUsers,
        totalDeposited, totalWithdrawn, latestDeposits,
        latestBets, betHistory: latestBets, history: latestBets,
        rtp: rtpData, maintenance: maintenanceData, wagerMultiplier
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

    // Get deposit/withdraw totals for this user
    const userDeposits = await Deposit.find({ userId: targetId }).sort({ _id: -1 }).limit(50);
    const userWithdraws = await Withdraw.find({ userId: targetId }).sort({ _id: -1 }).limit(50);
    const totalUserDeposited = userDeposits.reduce((s, d) => s + d.amount, 0);
    const totalUserWithdrawn = userWithdraws.filter(w => w.status === 'approved').reduce((s, w) => s + w.amount, 0);

    const userObj = user.toObject();
    userObj.betHistory = formattedBets;

    res.json({
        user: userObj,
        bets: formattedBets,
        betHistory: formattedBets,
        history: formattedBets,
        deposits: userDeposits.map(d => ({ amount: d.amount, time: d.time, hash: d.hash })),
        withdrawals: userWithdraws.map(w => ({ amount: w.amount, status: w.status, address: w.address, time: w.time, reason: w.reason })),
        totalUserDeposited: Number(totalUserDeposited.toFixed(2)),
        totalUserWithdrawn: Number(totalUserWithdrawn.toFixed(2)),
        wagerRequired: user.wagerRequired || 0,
        wagerCompleted: user.wagerCompleted || 0,
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

app.post('/api/admin/set_wager', checkAdmin, async (req, res) => {
    const { value } = req.body;
    await Settings.updateOne({key: 'wager_multiplier'}, {value: Number(value)}, {upsert: true});
    await logAdmin(`Изменил множитель отыгрыша на x${value}`);
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
    const { userId, action, msg } = req.body;
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
    } else if (action === 'message') {
        if (!msg) return res.status(400).json({ error: 'Пустое сообщение' });
        if (bot) {
            try {
                await bot.sendMessage(user.id, `📩 Сообщение от администрации:\n\n${msg}`);
                await logAdmin(`Отправил сообщение пользователю ${user.username || user.id}: ${msg.substring(0, 50)}...`);
            } catch(e) {
                return res.status(400).json({ error: 'Не удалось отправить сообщение. Возможно, пользователь не запускал бота.' });
            }
        } else {
            return res.status(400).json({ error: 'Бот не запущен' });
        }
        return res.json({ success: true });
    } else {
        return res.status(400).json({ error: 'Неизвестное действие' });
    }
    await user.save();
    res.json({ success: true });
});

app.post('/api/admin/game_stats', checkAdmin, async (req, res) => {
    try {
        const games = ['Crash', 'Mines', 'Coinflip', 'Battle', 'Spin', 'Mine'];
        const stats = {};
        for (const game of games) {
            const agg = await Bet.aggregate([
                { $match: { game, mode: 'Real' } },
                { $group: {
                    _id: null,
                    playCount: { $sum: 1 },
                    totalBet: { $sum: '$amount' },
                    totalPayout: { $sum: { $cond: [{ $gt: ['$result', 0] }, { $add: ['$amount', '$result'] }, 0] } }
                }}
            ]);
            const d = agg[0] || { playCount: 0, totalBet: 0, totalPayout: 0 };
            stats[game] = { playCount: d.playCount, totalBet: d.totalBet, totalPayout: d.totalPayout, profit: d.totalBet - d.totalPayout };
        }
        res.json({ stats });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/reset_game_stats', checkAdmin, async (req, res) => {
    try {
        const { game } = req.body;
        if (game) {
            await Bet.deleteMany({ game, mode: 'Real' });
        } else {
            await Bet.deleteMany({ mode: 'Real' });
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
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

// Keep-alive endpoint (for uptime monitors like UptimeRobot)
app.get('/ping', (req, res) => res.status(200).json({ ok: true, time: Date.now() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught:', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('Unhandled:', err);
});
