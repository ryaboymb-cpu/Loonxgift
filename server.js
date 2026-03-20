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
    createdAt: { type: Date, default: Date.now },
    withdrawHistory: [{ 
        withdrawId: String, 
        amount: Number, 
        address: String, 
        status: String, 
        reason: String, 
        time: String 
    }],
    depositHistory: [{ // ИСТОРИЯ ДЕПОЗИТОВ ДОБАВЛЕНА
        hash: String,
        amount: Number,
        status: String,
        time: String
    }]
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

// BATTLE ROULETTE SCHEMA
const BattleSchema = new mongoose.Schema({
    creatorId: String,
    players: Array, // [{id, username, avatar, bet, color}]
    minBet: Number,
    maxBet: Number,
    status: { type: String, default: 'waiting' }, // waiting, spinning, finished
    winnerId: String,
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
        { key: 'maintenance_battle', value: false } // ДОБАВЛЕНА БАТЛ РУЛЕТКА
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

    bot.onText(/\/(start|help)/, (msg) => {
        const text = `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в Loonx Gifts.\n\nТут ты можешь играть и выигрывать TON! Твой баланс и все игры находятся внутри Mini App.\n\nВыбирай действие в меню ниже:`;
        const appUrl = process.env.WEB_APP_URL || "https://loonxgift.onrender.com/";

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

// ФИКС ИСТОРИИ СТАВОК (Всегда новые сверху)
function pushToGlobalHistory(betObj) {
    const betWithTime = {
        ...(betObj.toObject ? betObj.toObject() : betObj),
        timeMsk: getMskTime()
    };
    
    globalBetHistory.unshift(betWithTime); // Добавляем в начало
    if(globalBetHistory.length > 10) globalBetHistory.pop(); // Удаляем с конца
    io.emit('newHistoryEntry', betWithTime);
}

// --- BATTLE ROULETTE ENGINE ---
const BATTLE_COLORS = ['#ffcc00', '#ff0055', '#007bff', '#ffffff']; // 🟡🔴🔵⚪
setInterval(async () => {
    // Чистка старых лобби (24 часа)
    const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expiredLobbies = await Battle.find({ status: 'waiting', createdAt: { $lt: expiredTime } });
    
    for (let lobby of expiredLobbies) {
        for (let p of lobby.players) {
            const u = await User.findOne({id: p.id});
            if (u) { u.balance = Number((u.balance + p.bet).toFixed(2)); await u.save(); }
        }
        await Battle.findByIdAndDelete(lobby._id);
    }

    // Запуск игр по таймеру (2 минуты с создания)
    const startTime = new Date(Date.now() - 2 * 60 * 1000);
    const readyLobbies = await Battle.find({ status: 'waiting', createdAt: { $lt: startTime } });

    for (let lobby of readyLobbies) {
        if (lobby.players.length > 1) {
            lobby.status = 'spinning';
            await lobby.save();
            io.emit('battleUpdate');
            
            // Логика рулетки (выбор победителя)
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

            // Выплата 70% от чужих ставок
            const othersPool = totalPool - winner.bet;
            const winAmount = winner.bet + (othersPool * 0.70);

            const wUser = await User.findOne({id: winner.id});
            if (wUser) {
                wUser.balance = Number((wUser.balance + winAmount).toFixed(2));
                wUser.stats.wins++; wUser.stats.plus += (winAmount - winner.bet);
                await wUser.save();
            }

            // Уведомляем клиентов о вращении (передаем победителя)
            io.emit('battleSpin', { lobbyId: lobby._id, winnerId: winner.id });

            // Запись в глобальную историю
            const opponentStr = lobby.players.filter(p => p.id !== lobby.creatorId).map(p => p.username).join(', ');
            const creator = lobby.players.find(p => p.id === lobby.creatorId);
            
            const betEntry = new Bet({
                userId: winner.id, username: winner.username, avatar: winner.avatar,
                game: 'Battle Roulette', amount: winner.bet, result: winAmount - winner.bet, mode: 'Real'
            });
            // Кастомное отображение имени для рулетки в истории
            betEntry.username = `${creator.username} VS ${opponentStr} 🏆 Победитель: ${winner.username}`;
            await betEntry.save();
            pushToGlobalHistory(betEntry);

            // Удаляем комнату через 2 минуты после конца
            setTimeout(async () => { await Battle.findByIdAndDelete(lobby._id); io.emit('battleUpdate'); }, 120000);

        } else {
            // Если никто не зашел, возврат
            const creator = lobby.players[0];
            const u = await User.findOne({id: creator.id});
            if(u) { u.balance = Number((u.balance + creator.bet).toFixed(2)); await u.save(); }
            await Battle.findByIdAndDelete(lobby._id);
            io.emit('battleUpdate');
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

// API BATTLE ROULETTE
app.get('/api/battle/list', async (req, res) => {
    const lobbies = await Battle.find({status: 'waiting'}).sort({createdAt: -1});
    res.json(lobbies);
});

app.post('/api/battle/create', async (req, res) => {
    const { id, bet, minBet, maxBet } = req.body;
    const user = await User.findOne({id});
    if(!user || user.isBlocked) return res.status(403).send();
    if(bet < 1 || bet > 100) return res.status(400).json({error: 'Ставка от 1 до 100 TON'});
    if(user.balance < bet) return res.status(400).json({error: 'Недостаточно средств'});
    
    user.balance = Number((user.balance - bet).toFixed(2));
    user.stats.bets++; user.stats.minus += bet;
    await user.save();

    const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    const newLobby = await Battle.create({
        creatorId: user.id,
        minBet: minBet, maxBet: maxBet,
        players: [{ id: user.id, username: user.username, avatar, bet, color: BATTLE_COLORS[0] }]
    });

    io.emit('battleUpdate');
    res.json(user);
});

app.post('/api/battle/join', async (req, res) => {
    const { id, lobbyId, bet } = req.body;
    const user = await User.findOne({id});
    const lobby = await Battle.findById(lobbyId);

    if(!user || !lobby || lobby.status !== 'waiting' || lobby.players.length >= 4) return res.status(400).json({error: 'Ошибка входа'});
    if(lobby.players.find(p => p.id === id)) return res.status(400).json({error: 'Уже в лобби'});
    if(bet < lobby.minBet || bet > lobby.maxBet || bet < 1 || bet > 150) return res.status(400).json({error: 'Лимиты ставки не соблюдены'});
    if(user.balance < bet) return res.status(400).json({error: 'Недостаточно средств'});

    user.balance = Number((user.balance - bet).toFixed(2));
    user.stats.bets++; user.stats.minus += bet;
    await user.save();

    const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    const pColor = BATTLE_COLORS[lobby.players.length];
    lobby.players.push({ id: user.id, username: user.username, avatar, bet, color: pColor });
    await lobby.save();

    io.emit('battleUpdate');

    // Уведомление создателю лобби
    if(bot) {
        bot.sendMessage(lobby.creatorId, `⚔️ Игрок **${user.username}** присоединился к вашей Battle Roulette! Ставка: ${bet} TON`, {parse_mode: 'Markdown'}).catch(()=>{});
    }

    res.json({user, lobby});
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
                    // Добавляем в историю депозитов
                    user.depositHistory.unshift({ hash: txHash, amount: amountTON, status: 'Успешно', time: getMskTime() });
                    await user.save();
                    foundNew = true;
                    totalAdded += amountTON;
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
    if(!promo || promo.usedBy.length >= promo.limit || promo.usedBy.includes(id)) return res.status(400).json({error: 'Invalid promo'});
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
    
    // СЧЕТЧИКИ ВЫВОДОВ И ДЕПОЗИТОВ
    const allDeps = await Deposit.aggregate([{$group: {_id: null, total: {$sum: "$amount"}}}]);
    const allWiths = await Withdraw.aggregate([{$match: {status: 'approved'}}, {$group: {_id: null, total: {$sum: "$amount"}}}]);
    const totalDeposited = allDeps[0] ? allDeps[0].total : 0;
    const totalWithdrawn = allWiths[0] ? allWiths[0].total : 0;
    
    // ПОСЛЕДНИЕ ДЕПОЗИТЫ С ЮЗЕРАМИ
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
    
    res.json({ 
        withdraws, promos, users, totalUsers, 
        totalDeposited, totalWithdrawn, latestDeposits,
        rtp: rtpData, maintenance: maintenanceData 
    });
});

// ПОИСК И ФИЛЬТРАЦИЯ ЮЗЕРОВ
app.post('/api/admin/search_user', checkAdmin, async (req, res) => {
    const { query, filterType } = req.body; // filterType: 'balance', 'new', 'banned'
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

// Бан / Сообщения
app.post('/api/admin/user_action', checkAdmin, async (req, res) => {
    const { userId, action, msg } = req.body;
    const user = await User.findOne({ id: String(userId) });
    if(!user) return res.status(400).send();

    if(action === 'ban') user.isBlocked = true;
    if(action === 'unban') user.isBlocked = false;
    await user.save();

    if(action === 'message' && bot) {
        bot.sendMessage(userId, `📩 Сообщение от Администрации:\n\n${msg}`).catch(()=>{});
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

app.post('/api/admin/edit_balance', checkAdmin, async (req, res) => {
    const { userId, action, amount } = req.body;
    const user = await User.findOne({id: userId});
    if (!user) return res.status(404).json({error: 'User not found'});
    
    const val = Number(amount);
    if (action === 'add') user.balance = Number((user.balance + val).toFixed(2));
    else if (action === 'sub') { user.balance = Number((user.balance - val).toFixed(2)); if(user.balance < 0) user.balance = 0; }
    
    await user.save();
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

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server Running on port 3000'));
