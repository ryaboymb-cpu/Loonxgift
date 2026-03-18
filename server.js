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
    isBlocked: { type: Boolean, default: false }, // Для бана
    balance: { type: Number, default: 0 }, 
    demo_balance: { type: Number, default: 5000 },
    stats: { 
        bets: {type:Number, default:0}, 
        wins: {type:Number, default:0}, 
        plus: {type:Number, default:0}, 
        minus: {type:Number, default:0},
        promo: {type:Number, default:0}
    },
    withdrawHistory: [{ // История выводов для профиля
        amount: Number, 
        address: String, 
        status: String, 
        reason: String, 
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
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number });
const SettingsSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });

const User = mongoose.model('User', UserSchema);
const Bet = mongoose.model('Bet', BetSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

let globalBetHistory = [];

// --- ИНИЦИАЛИЗАЦИЯ НАСТРОЕК ---
async function initSettings() {
    const defaultSettings = [
        { key: 'rtp_crash', value: 90 },
        { key: 'rtp_mines', value: 90 },
        { key: 'rtp_coinflip', value: 90 }, 
        { key: 'maintenance_crash', value: false },
        { key: 'maintenance_mines', value: false },
        { key: 'maintenance_coinflip', value: false }
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
        // Ускоряем краш (Пункт 8)
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
        timeMsk: getMskTime() // МСК время
    };
    
    globalBetHistory.push(betWithTime);
    if(globalBetHistory.length > 10) globalBetHistory.shift();
    io.emit('newHistoryEntry', betWithTime);
}

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
    
    if(user.isBlocked) return res.status(403).json({ error: "BLOCKED" }); // Блок

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
                    await Deposit.create({ hash: txHash, userId: id, amount: amountTON });
                    const user = await User.findOne({ id });
                    user.balance = Number((user.balance + amountTON).toFixed(2));
                    await user.save();
                    foundNew = true;
                    totalAdded += amountTON;
                }
            }
        }
        if(foundNew) res.json({ success: true, added: totalAdded });
        else res.status(400).json({ error: 'Новых оплат не найдено' });
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
    
    // Пишем в историю юзера
    user.withdrawHistory.unshift({ amount, address, status: 'В обработке', reason: '', time: getMskTime() });
    await user.save();

    await Withdraw.create({ userId: id, address, amount, time: getMskTime() });
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
    
    const allSettings = await Settings.find();
    const rtpData = {};
    const maintenanceData = {};
    allSettings.forEach(s => {
        if (s && s.key) {
            if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
            if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
        }
    });
    
    res.json({ withdraws, promos, rtp: rtpData, maintenance: maintenanceData });
});

// 5. Поиск пользователей (до 2000)
app.post('/api/admin/search_user', checkAdmin, async (req, res) => {
    const { query } = req.body;
    let filter = {};
    if (query) {
        filter = {
            $or: [
                { id: new RegExp(query, 'i') },
                { username: new RegExp(query, 'i') }
            ]
        };
    }
    const users = await User.find(filter).sort({balance: -1}).limit(2000);
    res.json({ users });
});

// 7. Бан / Сообщения
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

// 9. Рассылка в ТГ бота
app.post('/api/admin/bot_broadcast', checkAdmin, async (req, res) => {
    const { text } = req.body;
    if(!text || !bot) return res.status(400).json({error: 'Текст пуст'});
    const users = await User.find({ isBlocked: false });
    for(let u of users) { bot.sendMessage(u.id, text).catch(()=>{}); }
    res.json({success: true});
});

// 8. Сброс истории (баланс остается)
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

// Отклонение вывода с причиной
app.post('/api/admin/withdraw_action', checkAdmin, async (req, res) => {
    const { wId, action, reason } = req.body;
    const w = await Withdraw.findById(wId);
    if(!w || w.status !== 'pending') return res.status(400).json({error: 'Error'});
    
    const u = await User.findOne({id: w.userId});
    if(u) {
        // Обновляем статус в профиле пользователя
        let uHist = u.withdrawHistory.find(h => h.time === w.time && h.amount === w.amount);
        if(action === 'reject') {
            u.balance += w.amount; 
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
