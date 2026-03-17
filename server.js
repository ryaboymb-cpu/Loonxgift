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

// Подключение к БД
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log('❌ DB Error:', err));

// --- МОДЕЛИ ДАННЫХ ---
const UserSchema = new mongoose.Schema({
    id: String, username: String, photo: String,
    balance: { type: Number, default: 0 }, demo_balance: { type: Number, default: 5000 },
    stats: { 
        bets: {type:Number, default:0}, 
        wins: {type:Number, default:0}, 
        plus: {type:Number, default:0}, 
        minus: {type:Number, default:0},
        promo: {type:Number, default:0}
    }
});

const BetSchema = new mongoose.Schema({
    userId: String, username: String, avatar: String, game: String, amount: Number,
    multiplier: Number, result: Number, mode: String,
    createdAt: { type: Date, default: Date.now }
});

const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' } });
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number });
const SettingsSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });

const User = mongoose.model('User', UserSchema);
const Bet = mongoose.model('Bet', BetSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

// Глобальная переменная для истории ставок в памяти
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
    
    // Загрузка последних ставок в память
    const lastBets = await Bet.find().sort({createdAt: -1}).limit(10);
    globalBetHistory = lastBets.reverse();
}
initSettings();

// --- ТЕЛЕГРАМ БОТ ---
if (process.env.BOT_TOKEN) {
    const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    bot.deleteWebHook().catch(() => {});
    bot.on('polling_error', (err) => console.log('❌ Ошибка поллинга бота:', err.message));
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
        crash.multiplier = (parseFloat(crash.multiplier) + 0.01).toFixed(2);
        io.emit('crashData', crash);
        
        if(parseFloat(crash.multiplier) >= limit) { 
            clearInterval(r); 
            crash.status = 'crashed'; 
            crashHistory.unshift(crash.multiplier);
            if(crashHistory.length > 5) crashHistory.pop();
            io.emit('crashData', crash); 
            io.emit('crashHistoryUpdate', crashHistory);
            
            // Записываем проигрыши в историю
            for (let b of crashLiveBets) {
                if (!b.cashedOut) {
                    const u = await User.findOne({id: b.id});
                    if (u) {
                        const newBet = new Bet({ userId: u.id, username: u.username, avatar: b.avatar, game: 'Crash', amount: b.bet, result: -b.bet, mode: b.mode });
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
    globalBetHistory.push(betObj);
    if(globalBetHistory.length > 10) globalBetHistory.shift();
    io.emit('newHistoryEntry', betObj);
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
    
    const allSettings = await Settings.find();
    const rtpData = {};
    const maintenanceData = {};
    allSettings.forEach(s => {
        if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
        if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
    });
    
    res.json({ user, adminWallet: process.env.ADMIN_WALLET, rtp: rtpData, maintenance: maintenanceData });
});

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, multiplier, mode } = req.body;
    const user = await User.findOne({ id });
    const field = mode === 'demo' ? 'demo_balance' : 'balance';
    
    if (bet < 0 || win < 0 || user[field] < bet) return res.status(400).json({error: 'No money'});
    
    const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

    // Логика Краша
    if (game === 'Crash') {
        if (win === 0 && bet > 0) {
            // Ставка
            const activeUserBets = crashLiveBets.filter(b => b.id === user.id && !b.cashedOut);
            if (activeUserBets.length >= 2) return res.status(400).json({error: 'Max 2 bets'});
            crashLiveBets.push({ id: user.id, username: user.username, avatar, bet, cashedOut: false, win: 0, mode: mode });
            io.emit('crashBetsUpdate', crashLiveBets);
            
            // Баланс снимаем сразу, но в историю пока не пишем!
            user[field] = Number((user[field] - bet).toFixed(2));
            if (mode === 'real') { user.stats.bets++; user.stats.minus += bet; }
            await user.save();
            return res.json(user);
            
        } else if (win > 0) {
            // Вывод из краша
            const activeBet = crashLiveBets.find(b => b.id === user.id && !b.cashedOut);
            if (!activeBet) return res.status(400).json({error: 'Already cashed out or not found'});
            
            // ЗАЩИТА ОТ БАГА x4: Сразу меняем статус в памяти
            activeBet.cashedOut = true;
            activeBet.win = win;
            io.emit('crashBetsUpdate', crashLiveBets);
            
            user[field] = Number((user[field] + win).toFixed(2));
            if (mode === 'real') { user.stats.wins++; user.stats.plus += win; }
            await user.save();
            
            // Запись в историю вывода
            const profit = win - activeBet.bet;
            const newBetEntry = new Bet({ userId: user.id, username: user.username, avatar, game: 'Crash', amount: activeBet.bet, result: profit, mode: mode });
            await newBetEntry.save();
            pushToGlobalHistory(newBetEntry);
            
            return res.json(user);
        }
    }

    // Для остальных игр (Mines, Coinflip)
    const profit = win > 0 ? (win - bet) : -bet;
    const newBetEntry = new Bet({
        userId: user.id, username: user.username, avatar, game: game,
        amount: bet, multiplier: multiplier || (bet > 0 ? (win / bet).toFixed(2) : 0),
        result: Number(profit.toFixed(2)), mode: mode === 'demo' ? 'Demo' : 'Real'
    });
    await newBetEntry.save();
    pushToGlobalHistory(newBetEntry);

    user[field] = Number((user[field] - bet + win).toFixed(2));
    
    // Обновляем стату только если REAL
    if (mode === 'real') {
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
    user.stats.promo += promo.amount; // Записываем получено с промо
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
    const users = await User.find().sort({balance: -1}).limit(20);
    const promos = await Promo.find().sort({_id: -1}).limit(10);
    
    const allSettings = await Settings.find();
    const rtpData = {};
    const maintenanceData = {};
    allSettings.forEach(s => {
        if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
        if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
    });
    
    res.json({ withdraws, users, promos, rtp: rtpData, maintenance: maintenanceData });
});

// Глобальное уведомление
app.post('/api/admin/broadcast', checkAdmin, (req, res) => {
    const { text } = req.body;
    if(text) io.emit('global_alert', text);
    res.json({success: true});
});

// Выключение игр
app.post('/api/admin/maintenance', checkAdmin, async (req, res) => {
    const { game, state } = req.body;
    const key = `maintenance_${game}`;
    await Settings.updateOne({key}, {value: state}, {upsert: true});
    
    // Обновляем локально и отправляем всем
    const allSettings = await Settings.find({key: /maintenance_/});
    const mData = {};
    allSettings.forEach(s => mData[s.key.replace('maintenance_', '')] = s.value);
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
    if (action === 'add') {
        user.balance = Number((user.balance + val).toFixed(2));
    } else if (action === 'sub') {
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
    } else {
        w.status = 'approved';
    }
    await w.save();
    res.json({success: true});
});

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server Running on port 3000'));
