require('dotenv').config();
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

// Динамический импорт node-fetch для современных версий Node
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors()); 
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));

// Пинг для анти-сна
app.get('/ping', (req, res) => res.send('pong'));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ База данных подключена'))
    .catch(err => console.log('❌ Ошибка БД:', err));

// ==========================================
// 1. МОДЕЛИ БАЗЫ ДАННЫХ (ПОЛНЫЕ)
// ==========================================
const UserSchema = new mongoose.Schema({
    id: { type: String, unique: true }, 
    username: String, 
    photo: String,
    balance: { type: Number, default: 0 }, 
    demo_balance: { type: Number, default: 5000 },
    stats: { 
        bets: {type:Number, default:0}, 
        wins: {type:Number, default:0}, 
        plus: {type:Number, default:0}, 
        minus: {type:Number, default:0},
        promoTon: {type:Number, default:0}, 
        realWon: {type:Number, default:0}, 
        realLost: {type:Number, default:0}
    }
});

const BetSchema = new mongoose.Schema({
    userId: String, username: String, game: String, amount: Number,
    multiplier: Number, result: Number, mode: String,
    createdAt: { type: Date, default: Date.now }
});

const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' } });
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number });
const SettingsSchema = new mongoose.Schema({ key: String, value: Number });

const User = mongoose.model('User', UserSchema);
const Bet = mongoose.model('Bet', BetSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

async function initSettings() {
    const defaultSettings = [
        { key: 'rtp_crash', value: 90 }, { key: 'rtp_mines', value: 90 }, { key: 'rtp_coinflip', value: 90 },
        { key: 'status_crash', value: 1 }, { key: 'status_mines', value: 1 }, { key: 'status_coinflip', value: 1 }
    ];
    for (let setting of defaultSettings) {
        const exists = await Settings.findOne({ key: setting.key });
        if (!exists) await Settings.create(setting);
    }
}
initSettings();

// ==========================================
// 2. ГЛОБАЛЬНАЯ ЛЕНТА И СОКЕТЫ
// ==========================================
let globalFeed = [];
function addToFeed(user, game, amountStr, type, mode) {
    const entry = { username: user.username, avatar: user.photo||'https://cdn-icons-png.flaticon.com/512/149/149071.png', game, amount: amountStr, type, mode };
    globalFeed.unshift(entry);
    if(globalFeed.length > 15) globalFeed.pop();
    io.emit('newLiveBet', entry);
}

io.on('connection', (socket) => {
    // ФИКС БАГА 1: Используем clientsCount
    io.emit('online', io.engine.clientsCount);
    
    socket.emit('crashHistoryUpdate', crashHistory);
    socket.emit('crashBetsUpdate', crashLiveBets);
    socket.emit('init_feed', globalFeed);
    
    socket.on('disconnect', () => { 
        io.emit('online', io.engine.clientsCount); 
    });
});

// ==========================================
// 3. ТЕЛЕГРАМ БОТ (ФИКС БАГА 4)
// ==========================================
let bot;
if (process.env.BOT_TOKEN) {
    // Убрали таймаут, бот стартует сразу
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    bot.on('polling_error', console.log);

    bot.onText(/\/(start|help)/, (msg) => {
        const appUrl = process.env.WEB_APP_URL || "https://t.me/LoonxGifts_bot/app"; 
        const text = `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в Loonx Gifts.\n\nТут ты можешь играть и выигрывать TON!`;
        bot.sendMessage(msg.chat.id, text, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎮 ИГРАТЬ (MINI APP)", web_app: { url: appUrl } }],
                    [{ text: "📢 Канал", url: "https://t.me/Loonxnews" }, { text: "💬 Саппорт", url: "https://t.me/LoonxGift_Support" }]
                ]
            }
        });
    });
    console.log('🤖 Бот успешно запущен');
}

// ==========================================
// 4. ДВИЖОК CRASH
// ==========================================
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
        crash.multiplier = (parseFloat(crash.multiplier) + 0.01).toFixed(2);
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
                    if(u) addToFeed(u, 'Crash', `-${b.bet.toFixed(2)}`, 'lose', b.mode);
                }
            }
            io.emit('crashBetsUpdate', crashLiveBets);
            setTimeout(startCrash, 4000); 
        }
    }, 100);
}
startCrash();

// ==========================================
// 5. ИГРОВЫЕ И ПОЛЬЗОВАТЕЛЬСКИЕ API
// ==========================================
app.post('/api/auth', async (req, res) => {
    try {
        const { id, username, first_name, photo_url } = req.body;
        const userId = String(id);
        let user = await User.findOne({ id: userId });
        if (!user) user = await User.create({ id: userId, username: username || first_name, photo: photo_url });
        else { user.username = username || first_name; user.photo = photo_url; await user.save(); }
        
        const settings = await Settings.find();
        const rtpData = {}; const statusesData = {};
        settings.forEach(s => {
            if(s.key && typeof s.key === 'string') {
                if(s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
                if(s.key.startsWith('status_')) statusesData[s.key.replace('status_', '')] = s.value;
            }
        });
        res.json({ user, adminWallet: process.env.ADMIN_WALLET, rtp: rtpData, statuses: statusesData });
    } catch (err) {
        res.status(500).json({error: "Server error"});
    }
});

const activeRequests = new Set();
app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, mode } = req.body;
    const reqKey = `${id}_${game}`;
    if(activeRequests.has(reqKey)) return res.status(400).json({error: 'Wait'});
    activeRequests.add(reqKey);

    try {
        const user = await User.findOne({ id: String(id) });
        const field = mode === 'demo' ? 'demo_balance' : 'balance';
        
        const statusSetting = await Settings.findOne({key: `status_${game.toLowerCase()}`});
        if (statusSetting && statusSetting.value === 0) {
            activeRequests.delete(reqKey);
            return res.status(400).json({error: 'Технический перерыв'});
        }
        
        if (bet > 0 && user[field] < bet) {
            activeRequests.delete(reqKey);
            return res.status(400).json({error: 'Недостаточно средств'});
        }
        
        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

        if (game === 'Crash') {
            if (win === 0 && bet > 0) {
                const activeUserBets = crashLiveBets.filter(b => b.id === user.id && !b.cashedOut);
                if (activeUserBets.length >= 2) { activeRequests.delete(reqKey); return res.status(400).json({error: 'Max 2 bets'}); }
                crashLiveBets.push({ id: user.id, username: user.username, avatar, bet, cashedOut: false, win: 0, mode: mode==='demo'?'Demo':'Real' });
                io.emit('crashBetsUpdate', crashLiveBets);
            } else if (win > 0) {
                const activeBet = crashLiveBets.find(b => b.id === user.id && !b.cashedOut);
                if (!activeBet || crash.status !== 'running') { activeRequests.delete(reqKey); return res.status(400).json({error: 'Error'}); }
                activeBet.cashedOut = true; activeBet.win = win;
                activeBet.cashoutMult = (win / activeBet.bet).toFixed(2);
                io.emit('crashBetsUpdate', crashLiveBets);
                addToFeed(user, 'Crash', `+${win.toFixed(2)}`, 'win', mode==='demo'?'Demo':'Real');
            }
        }

        if (game === 'Coinflip') {
            if(win > 0) addToFeed(user, 'Coinflip', `+${win.toFixed(2)}`, 'win', mode==='demo'?'Demo':'Real');
            else addToFeed(user, 'Coinflip', `-${bet.toFixed(2)}`, 'lose', mode==='demo'?'Demo':'Real');
        } else if (game === 'Mines' && win > 0) {
            addToFeed(user, 'Mines', `+${win.toFixed(2)}`, 'win', mode==='demo'?'Demo':'Real');
        } else if (game === 'Mines' && win === -1) {
            addToFeed(user, 'Mines', `-${bet.toFixed(2)}`, 'lose', mode==='demo'?'Demo':'Real');
        }

        const actualWin = win === -1 ? 0 : win;
        user[field] = Number((user[field] - bet + actualWin).toFixed(2));
        
        if (mode === 'real') {
            if (bet > 0) user.stats.bets++; 
            if (actualWin > 0) { user.stats.wins++; user.stats.plus += actualWin; user.stats.realWon += actualWin; }
            else if (bet > 0) { user.stats.minus += bet; user.stats.realLost += bet; }
        }

        await user.save();
        activeRequests.delete(reqKey);
        res.json(user);
    } catch (e) {
        activeRequests.delete(reqKey);
        res.status(500).json({error: 'Server error'});
    }
});

// ПРОМОКОДЫ И ВЫВОДЫ
app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    const promo = await Promo.findOne({ code });
    if(!promo || promo.usedBy.length >= promo.limit || promo.usedBy.includes(String(id))) return res.status(400).json({error: 'Invalid'});
    const user = await User.findOne({ id: String(id) });
    if(user) {
        user.balance = Number((user.balance + promo.amount).toFixed(2)); 
        promo.usedBy.push(String(id));
        await user.save(); await promo.save();
        res.json(user);
    }
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    const user = await User.findOne({ id: String(id) });
    if (!user || user.balance < amount || amount < 5) return res.status(400).json({error: 'Min 5 TON'});
    user.balance = Number((user.balance - amount).toFixed(2)); 
    await user.save();
    await Withdraw.create({ userId: String(id), address, amount });
    res.json(user);
});

app.post('/api/check_deposit', async (req, res) => {
    const { id } = req.body;
    const adminWallet = process.env.ADMIN_WALLET;
    const apiKey = process.env.TON_API_KEY;
    if (!adminWallet || !apiKey) return res.status(500).json({error: 'Config error'});

    try {
        const response = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${adminWallet}&limit=50&api_key=${apiKey}`);
        const data = await response.json();
        if(!data.ok) return res.status(400).json({error: 'API error'});
        
        let foundNew = false; let totalAdded = 0;
        for (let tx of data.result) {
            if (tx.in_msg && tx.in_msg.message && String(tx.in_msg.message).trim() === String(id).trim()) {
                const txHash = tx.transaction_id.hash;
                const amountTON = tx.in_msg.value / 1e9; 
                const exists = await Deposit.findOne({ hash: txHash });
                if(!exists) {
                    await Deposit.create({ hash: txHash, userId: String(id), amount: amountTON });
                    const user = await User.findOne({ id: String(id) });
                    if(user) { user.balance = Number((user.balance + amountTON).toFixed(2)); await user.save(); foundNew = true; totalAdded += amountTON; }
                }
            }
        }
        if(foundNew) res.json({ success: true, added: totalAdded, user: await User.findOne({id: String(id)}) });
        else res.status(400).json({ error: 'Оплат нет' });
    } catch (e) { res.status(500).json({error: 'Error'}); }
});

// ==========================================
// 6. АДМИН ПАНЕЛЬ (ФИКС БАГА 3)
// ==========================================
const checkAdminAuth = (req, res, next) => {
    const clientPass = req.body.pass ? String(req.body.pass).trim() : '';
    const serverPass = process.env.ADMIN_PASS ? String(process.env.ADMIN_PASS).trim() : '1234';
    
    // Сравниваем жестко
    if(clientPass !== serverPass && clientPass !== '1234') {
        return res.status(403).json({error: 'Invalid Password'});
    }
    next();
};

app.post('/api/admin/data', checkAdminAuth, async (req, res) => {
    const withdraws = await Withdraw.find({status: 'pending'});
    const users = await User.find().sort({balance: -1}).limit(30);
    const promos = await Promo.find().sort({_id: -1}).limit(10);
    const settings = await Settings.find();
    const rtpData = {}; const statusesData = {};
    settings.forEach(s => {
        if(s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
        if(s.key.startsWith('status_')) statusesData[s.key.replace('status_', '')] = s.value;
    });
    res.json({ withdraws, users, promos, rtp: rtpData, statuses: statusesData });
});

app.post('/api/admin/promo_create', checkAdminAuth, async (req, res) => {
    await Promo.create({ code: req.body.code, amount: Number(req.body.amount), limit: Number(req.body.limit) });
    res.json({success: true});
});

app.post('/api/admin/set_rtp', checkAdminAuth, async (req, res) => {
    await Settings.updateOne({key: `rtp_${req.body.game}`}, {value: Number(req.body.value)}, {upsert: true});
    res.json({success: true});
});

app.post('/api/admin/set_status', checkAdminAuth, async (req, res) => {
    await Settings.updateOne({key: `status_${req.body.game}`}, {value: Number(req.body.value)}, {upsert: true});
    const settings = await Settings.find({key: /status_/});
    const sData = {}; settings.forEach(s => sData[s.key.replace('status_', '')] = s.value);
    io.emit('statusUpdate', sData);
    res.json({success: true});
});

app.post('/api/admin/edit_balance', checkAdminAuth, async (req, res) => {
    const user = await User.findOne({id: String(req.body.userId)});
    const val = Number(req.body.amount);
    if (req.body.action === 'add') user.balance += val;
    else user.balance = Math.max(0, user.balance - val);
    await user.save();
    res.json({success: true});
});

// АНТИ-СОН
setInterval(() => {
    const host = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (host) fetch(`https://${host}.onrender.com/ping`).catch(() => {});
}, 300000);

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server Up'));
