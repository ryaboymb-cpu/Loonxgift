require('dotenv').config();
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

// Исправленный импорт fetch для стабильной работы на Render
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors()); 
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к БД
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ DB Connected'))
    .catch(err => console.log('❌ DB Error:', err));

// --- МОДЕЛИ ДАННЫХ ---
const UserSchema = new mongoose.Schema({
    id: String, username: String, photo: String,
    balance: { type: Number, default: 0 }, demo_balance: { type: Number, default: 5000 },
    stats: { 
        bets: {type:Number, default:0}, wins: {type:Number, default:0}, 
        plus: {type:Number, default:0}, minus: {type:Number, default:0},
        promoTon: {type:Number, default:0}, realWon: {type:Number, default:0}, realLost: {type:Number, default:0}
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

// --- ИНИЦИАЛИЗАЦИЯ НАСТРОЕК ---
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

// --- ГЛОБАЛЬНАЯ ЛЕНТА СТАВОК ---
let globalFeed = [];
function addToFeed(user, game, amountStr, type, mode) {
    const entry = { username: user.username, avatar: user.photo||'https://cdn-icons-png.flaticon.com/512/149/149071.png', game, amount: amountStr, type, mode };
    globalFeed.unshift(entry);
    if(globalFeed.length > 15) globalFeed.pop();
    io.emit('newLiveBet', entry);
}

// --- ТЕЛЕГРАМ БОТ (с фиксом конфликта 409) ---
if (process.env.BOT_TOKEN) {
    console.log('⏳ Подготовка к запуску бота (пауза 10с для Render)...');
    
    setTimeout(() => {
        const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
        
        // Очищаем вебхуки перед стартом, чтобы не было конфликтов
        bot.deleteWebHook().catch(() => {});

        bot.on('polling_error', (err) => {
            if (err.message.includes('409 Conflict')) {
                console.log('⚠️ Конфликт токена: Старая копия сервера еще активна. Ждем завершения.');
            } else {
                console.log('❌ Ошибка бота:', err.message);
            }
        });

        bot.onText(/\/(start|help)/, (msg) => {
            const text = `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в Loonx Gifts.\n\nТут ты можешь играть и выигрывать TON! Твой баланс и все игры находятся внутри Mini App.\n\nВыбирай действие в меню ниже:`;
            bot.sendMessage(msg.chat.id, text, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🎮 ИГРАТЬ (MINI APP)", web_app: { url: process.env.WEB_APP_URL } }],
                        [{ text: "📢 Канал", url: "https://t.me/Loonxnews" }, { text: "💬 Саппорт", url: "https://t.me/LoonxGift_Support" }],
                        [{ text: "🐞 Баги", url: "https://t.me/msgp2p" }]
                    ]
                }
            });
        });
        console.log('🤖 Бот успешно запущен');
    }, 10000); // 10 секунд ожидания
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

// --- СОКЕТЫ ---
let online = 0;
io.on('connection', async (socket) => {
    online++; io.emit('online', online);
    socket.emit('crashHistoryUpdate', crashHistory);
    socket.emit('crashBetsUpdate', crashLiveBets);
    socket.emit('init_feed', globalFeed);

    socket.on('disconnect', () => { online--; io.emit('online', online); });
});

// --- API ЭНДПОИНТЫ ---
app.post('/api/auth', async (req, res) => {
    const { id, username, first_name, photo_url } = req.body;
    let user = await User.findOne({ id });
    if (!user) user = await User.create({ id, username: username || first_name, photo: photo_url });
    else { user.username = username || first_name; user.photo = photo_url; await user.save(); }
    
    const settings = await Settings.find();
    const rtpData = {}; const statusesData = {};
    settings.forEach(s => {
        if(s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
        if(s.key.startsWith('status_')) statusesData[s.key.replace('status_', '')] = s.value;
    });
    
    res.json({ user, adminWallet: process.env.ADMIN_WALLET, rtp: rtpData, statuses: statusesData });
});

const activeRequests = new Set();

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, multiplier, mode } = req.body;
    const reqKey = `${id}_${game}`;
    if(activeRequests.has(reqKey)) return res.status(400).json({error: 'Подождите...'});
    activeRequests.add(reqKey);

    try {
        const user = await User.findOne({ id });
        const field = mode === 'demo' ? 'demo_balance' : 'balance';
        
        const statusSetting = await Settings.findOne({key: `status_${game.toLowerCase()}`});
        if (statusSetting && statusSetting.value === 0) {
            activeRequests.delete(reqKey);
            return res.status(400).json({error: 'Игра временно отключена'});
        }
        
        if (bet < 0 || user[field] < bet) {
            activeRequests.delete(reqKey);
            return res.status(400).json({error: 'No money'});
        }
        
        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

        if (game === 'Crash') {
            if (win === 0 && bet > 0) {
                const activeUserBets = crashLiveBets.filter(b => b.id === user.id && !b.cashedOut);
                if (activeUserBets.length >= 2) { activeRequests.delete(reqKey); return res.status(400).json({error: 'Max 2 bets'}); }
                crashLiveBets.push({ id: user.id, username: user.username, avatar, bet, cashedOut: false, win: 0, mode: mode==='demo'?'Demo':'Real' });
                io.emit('crashBetsUpdate', crashLiveBets);
            } else if (win > 0) {
                // ИСПРАВЛЕНО: была ошибка curCrash, заменено на crash
                const activeBet = crashLiveBets.find(b => b.id === user.id && !b.cashedOut);
                if (!activeBet || crash.status !== 'running') {
                    activeRequests.delete(reqKey);
                    return res.status(400).json({error: 'Already cashed out or crashed'});
                }
                activeBet.cashedOut = true;
                activeBet.win = win;
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
            if (actualWin > 0) { 
                user.stats.wins++; 
                user.stats.plus += actualWin; 
                user.stats.realWon += actualWin;
            } else if (bet > 0) { 
                user.stats.minus += bet; 
                user.stats.realLost += bet;
            }
        }

        await user.save();
        activeRequests.delete(reqKey);
        res.json(user);
    } catch (e) {
        activeRequests.delete(reqKey);
        res.status(500).json({error: 'Server error'});
    }
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
        
        let foundNew = false; let totalAdded = 0;
        
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
                    foundNew = true; totalAdded += amountTON;
                }
            }
        }
        if(foundNew) res.json({ success: true, added: totalAdded, user: await User.findOne({id}) });
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
    user.stats.promoTon = (user.stats.promoTon || 0) + promo.amount;
    promo.usedBy.push(id);
    await user.save(); await promo.save();
    res.json(user);
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    const user = await User.findOne({ id });
    if (user.balance < amount || amount < 5) return res.status(400).json({error: 'Min 5 TON'});
    user.balance = Number((user.balance - amount).toFixed(2)); 
    await user.save();
    await Withdraw.create({ userId: id, address, amount });
    res.json(user);
});

// --- АДМИН ПАНЕЛЬ ---
const checkAdmin = (req, res, next) => {
    if(req.body.pass !== (process.env.ADMIN_PASS || '1234')) return res.status(403).json({error: 'Wrong pass'});
    next();
};

app.post('/api/admin/data', checkAdmin, async (req, res) => {
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
    await Settings.updateOne({key: `rtp_${game}`}, {value: Number(value)}, {upsert: true});
    res.json({success: true});
});

app.post('/api/admin/set_status', checkAdmin, async (req, res) => {
    const { game, value } = req.body;
    await Settings.updateOne({key: `status_${game}`}, {value: Number(value)}, {upsert: true});
    const settings = await Settings.find({key: /status_/});
    const sData = {}; settings.forEach(s => sData[s.key.replace('status_', '')] = s.value);
    io.emit('statusUpdate', sData);
    res.json({success: true});
});

app.post('/api/admin/broadcast', checkAdmin, async (req, res) => {
    io.emit('notification', req.body.message);
    res.json({success: true});
});

app.post('/api/admin/edit_balance', checkAdmin, async (req, res) => {
    const { userId, action, amount } = req.body;
    const user = await User.findOne({id: userId});
    if (!user) return res.status(404).json({error: 'User not found'});
    const val = Number(amount);
    if (action === 'add') user.balance = Number((user.balance + val).toFixed(2));
    else if (action === 'sub') {
        user.balance = Number((user.balance - val).toFixed(2));
        if(user.balance < 0) user.balance = 0;
    }
    await user.save();
    res.json({success: true});
});

app.post('/api/admin/withdraw_action', checkAdmin, async (req, res) => {
    const { wId, action } = req.body;
    const w = await Withdraw.findById(wId);
    if(!w || w.status !== 'pending') return res.status(400).json({error: 'Error'});
    if(action === 'reject') {
        const u = await User.findOne({id: w.userId});
        if(u) { u.balance += w.amount; await u.save(); }
        w.status = 'rejected';
    } else { w.status = 'approved'; }
    await w.save();
    res.json({success: true});
});

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server Running on port 3000'));
