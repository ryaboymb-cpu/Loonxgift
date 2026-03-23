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

// Защита от мультикликов (глобальная блокировка активных запросов юзера)
const actionLocks = new Set();

// АНТИ-СОН ДЛЯ RENDER (Будит сервер каждые 10 минут)
setInterval(() => {
    const url = process.env.WEB_APP_URL || "https://loonxgift.onrender.com";
    fetch(url).then(() => console.log('🔄 Анти-сон: Сервер пинганул сам себя')).catch(() => {});
}, 10 * 60 * 1000);

// Подключение к БД
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log('❌ DB Error:', err));

// --- 1. TON CONNECT MANIFEST ---
app.get('/tonconnect-manifest.json', (req, res) => {
    res.json({
        url: process.env.WEB_APP_URL || "https://loonxgift.onrender.com",
        name: "LoonxGift", 
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
    betHistory: { type: Array, default: [] } // ДОБАВЛЕНО: поддержка старого массива истории для совместимости с фронтом
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

// BATTLE ROULETTE SCHEMA (Убрали minBet и maxBet по просьбе)
const BattleSchema = new mongoose.Schema({
    creatorId: String,
    players: Array, // [{id, username, avatar, bet, color}]
    status: { type: String, default: 'waiting' }, // waiting, spinning, finished
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

// --- ИНИЦИАЛИЗАЦИЯ НАСТРОЕК ---
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
    
    // ФИКС ИСТОРИИ: Берем 10 последних, сортируем от новых к старым
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

    // Обработка /start с учетом реферальной ссылки (например, /start ref_123456)
    bot.onText(/\/(start|help)(?: (.+))?/, (msg, match) => {
        const refParam = match[2] || '';
        const text = `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в LoonxGift.\n\nТут ты можешь играть и выигрывать TON! Твой баланс и все игры находятся внутри Mini App.\n\nВыбирай действие в меню ниже:`;
        
        // Передаем реф-код в start_param для Web App
        const appUrl = process.env.WEB_APP_URL 
            ? `${process.env.WEB_APP_URL}?start_param=${refParam}` 
            : `https://loonxgift.onrender.com/?start_param=${refParam}`;

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

// ФИКС ИСТОРИИ СТАВОК (Всегда новые сверху)
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
                balanceAfter: wUser ? wUser.balance : 0 
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
        
        // Логика привязки реферала
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
    
    // ДОБАВЛЕНО: Инжектим историю ставок напрямую в юзера, чтобы фронтенд сразу видел её на главной
    const userBets = await Bet.find({ userId: String(id) }).sort({ createdAt: -1 }).limit(50);
    const userObj = user.toObject();
    userObj.betHistory = userBets.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));

    // ИЗМЕНЕНО с user на userObj
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
        
        // УСИЛЕННАЯ ПРОВЕРКА НА БАЛАНС И NaN
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
                
                // ИСПРАВЛЕНИЕ БАГА: Строгая привязка баланса к режиму из активной ставки!
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
                    balanceAfter: user[correctField] 
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
            balanceAfter: user[field] 
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
        
        // Лимиты ставки изменены на 0.5 - 150 TON
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
        
        // Проверка фиксированных лимитов
        if(isNaN(bet) || bet < 0.5 || bet > 150) return res.status(400).json({error: 'Ставка от 0.5 до 150 TON'});
        if(user.balance < bet) return res.status(400).json({error: 'Недостаточно средств'});

        user.balance = Number((user.balance - bet).toFixed(2));
        user.stats.bets++; user.stats.minus += bet;
        await user.save();

        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        const pColor = BATTLE_COLORS[lobby.players.length];
        lobby.players.push({ id: user.id, username: user.username, avatar, bet, color: pColor });
        
        // Таймер начинается (или сбрасывается) при добавлении 2, 3 или 4 игрока
        if (lobby.players.length >= 2) {
            lobby.timerStartedAt = new Date();
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

                    // НАЧИСЛЕНИЕ 10% РЕФОВОДУ (баланс депера не трогаем, бонус идет "сверху")
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
    
    // ПРОВЕРКИ ПРОМОКОДА
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

    // ДОБАВЛЕНО: История ставок для дашборда админки (часто панель выводит их вместе с остальными данными)
    const latestBetsRaw = await Bet.find().sort({createdAt: -1}).limit(20);
    const latestBets = latestBetsRaw.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));
    
    res.json({ 
        withdraws, promos, users, totalUsers, 
        totalDeposited, totalWithdrawn, latestDeposits,
        latestBets, betHistory: latestBets, history: latestBets, // ДОБАВЛЕНО
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

// ДОБАВЛЕНА ПОДДЕРЖКА НЕСКОЛЬКИХ МАРШРУТОВ (Если фронт стучится на user_history)
// ДЕТАЛЬНАЯ СТАТИСТИКА И ИСТОРИЯ СТАВОК ЮЗЕРА ДЛЯ АДМИНКИ
app.post(['/api/admin/user_details', '/api/admin/user_history'], checkAdmin, async (req, res) => {
    // РАСШИРЕНО: Поддержка tgId и user_id
    const targetId = String(req.body.userId || req.body.id || req.body.tgId || req.body.user_id);
    const page = req.body.page || 1;
    const limit = req.body.limit || 50; // Увеличил со стоковых 10 до 50
    
    const user = await User.findOne({ id: targetId });
    if (!user) return res.status(404).json({error: 'User not found'});

    const totalBets = await Bet.countDocuments({ userId: targetId });
    const totalPages = Math.ceil(totalBets / limit);
    const bets = await Bet.find({ userId: targetId })
        .sort({ createdAt: -1 }) // Сортировка: новые сверху
        .skip((page - 1) * limit)
        .limit(limit);

    const formattedBets = bets.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));

    // ДОБАВЛЕНО: Формируем объект и прокидываем историю внутрь
    const userObj = user.toObject();
    userObj.betHistory = formattedBets;

    res.json({
        user: userObj, // ИЗМЕНЕНО на userObj
        bets: formattedBets,
        betHistory: formattedBets, // ДОБАВЛЕНО для совместимости ключей
        history: formattedBets,    // ДОБАВЛЕНО для совместимости ключей
        pagination: { 
            currentPage: Number(page), 
            totalPages, 
            totalBets 
        }
    });
});

app.post('/api/admin/user_action', checkAdmin, async (req, res) => {
    // РАСШИРЕНО
    const targetId = String(req.body.userId || req.body.id || req.body.tgId || req.body.user_id);
    const { action, msg } = req.body;
    
    const user = await User.findOne({ id: targetId });
    if(!user) return res.status(400).send();

    if(action === 'ban') user.isBlocked = true;
    if(action === 'unban') user.isBlocked = false;
    await user.save();

    if(action === 'message' && bot) {
        bot.sendMessage(targetId, `📩 Сообщение от Администрации:\n\n${msg}`).catch(()=>{});
    }
    res.json({ success: true });
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

// СНЯТИЕ И НАЧИСЛЕНИЕ TON ЮЗЕРУ ЧЕРЕЗ АДМИНКУ
app.post('/api/admin/edit_balance', checkAdmin, async (req, res) => {
    // РАСШИРЕНО: Поддержка любого формата ID
    const targetId = String(req.body.userId || req.body.id || req.body.tgId || req.body.user_id);
    // РАСШИРЕНО: Добавлена поддержка type и method
    const { action, amount, type, method } = req.body;
    
    const user = await User.findOne({id: targetId});
    if (!user) return res.status(404).json({error: 'User not found'});
    
    // Защита от запятых при вводе в поле (например, "10,5" превращаем в "10.5")
    const val = Number(String(amount).replace(',', '.'));
    if (isNaN(val) || val < 0) return res.status(400).json({error: 'Неверная сумма'});

    // ДОБАВЛЕНО: Универсальное определение действия (action, type или method)
    const act = String(action || type || method || '').toLowerCase();

    // Поддерживаем разные варианты кнопок (на всякий случай)
    // РАСШИРЕНО: добавлены give, increase, addbalance
    if (act === 'add' || act === 'plus' || act === 'give' || act === 'increase' || act === 'addbalance') { 
        user.balance = Number((user.balance + val).toFixed(2)); 
        if(bot) bot.sendMessage(user.id, `💰 Ваш баланс был пополнен администратором на **${val} TON**!`, {parse_mode: 'Markdown'}).catch(()=>{});
    }
    // РАСШИРЕНО: добавлены take, remove, decrease, subbalance
    else if (act === 'sub' || act === 'minus' || act === 'take' || act === 'remove' || act === 'decrease' || act === 'subbalance') { 
        user.balance = Number((user.balance - val).toFixed(2)); 
        if(user.balance < 0) user.balance = 0; 
        if(bot) bot.sendMessage(user.id, `📉 С вашего баланса было списано **${val} TON** администратором.`, {parse_mode: 'Markdown'}).catch(()=>{});
    }

    await user.save();
    // ДОБАВЛЕНО: `balance: user.balance` (некоторые фронты ищут не newBalance, а balance)
    res.json({success: true, newBalance: user.balance, balance: user.balance});
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
    
    if(action === 'reject') { w.status = 'rejected'; w.reason = reason; } 
    else { w.status = 'approved'; }
    await w.save();
    
    res.json({success: true});
});

// ДОБАВЛЕНО: Резервный эндпоинт для запроса истории ставок прямо из Mini App
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

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server Running on port 3000'));
