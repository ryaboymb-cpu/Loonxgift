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

mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected'));

const UserSchema = new mongoose.Schema({
    id: String, username: String, photo: String,
    balance: { type: Number, default: 0 }, demo_balance: { type: Number, default: 5000 },
    stats: { bets: {type:Number, default:0}, wins: {type:Number, default:0}, plus: {type:Number, default:0}, minus: {type:Number, default:0} }
});
const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' } });
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number });
const SettingsSchema = new mongoose.Schema({ key: String, value: Number }); // Для раздельных RTP

const User = mongoose.model('User', UserSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

// ИСПРАВЛЕНО: Раздельные RTP для игр (Баг 4)
async function initSettings() {
    const defaultSettings = [
        { key: 'rtp_crash', value: 90 },
        { key: 'rtp_mines', value: 90 },
        { key: 'rtp_coinflip', value: 90 }
    ];
    for (let setting of defaultSettings) {
        const exists = await Settings.findOne({ key: setting.key });
        if (!exists) await Settings.create(setting);
    }
}
initSettings();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ИСПРАВЛЕНО: Бот теперь надежно реагирует на команды (Баг 1)
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

bot.on('polling_error', (err) => console.log('Bot Error:', err));

// CRASH Движок с историей и live ставками
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
    
    // Берем RTP именно для Краша
    const rtpSetting = await Settings.findOne({key: 'rtp_crash'});
    const rtp = rtpSetting ? rtpSetting.value : 90; 
    const limit = Math.pow(100 / (100 - (Math.random() * rtp)), 0.9).toFixed(2);
    
    const r = setInterval(() => {
        crash.multiplier = (parseFloat(crash.multiplier) + 0.01).toFixed(2);
        io.emit('crashData', crash);
        if(parseFloat(crash.multiplier) >= limit) { 
            clearInterval(r); 
            crash.status = 'crashed'; 
            crashHistory.unshift(crash.multiplier);
            
            // ИСПРАВЛЕНО: Ограничение истории до 5 ставок (Баг 6)
            if(crashHistory.length > 5) crashHistory.pop();
            
            io.emit('crashData', crash); 
            io.emit('crashHistoryUpdate', crashHistory);
            setTimeout(startCrash, 4000); 
        }
    }, 100);
}
startCrash();

let online = 0;
io.on('connection', async (socket) => {
    online++; io.emit('online', online);
    socket.emit('crashHistoryUpdate', crashHistory);
    socket.emit('crashBetsUpdate', crashLiveBets);
    socket.on('disconnect', () => { online--; io.emit('online', online); });
});

// API
app.post('/api/auth', async (req, res) => {
    const { id, username, first_name, photo_url } = req.body;
    let user = await User.findOne({ id });
    if (!user) user = await User.create({ id, username: username || first_name, photo: photo_url });
    else { user.username = username || first_name; user.photo = photo_url; await user.save(); }
    
    // Отправляем все RTP при авторизации
    const rtps = await Settings.find({key: /rtp_/});
    const rtpData = {};
    rtps.forEach(r => rtpData[r.key.replace('rtp_', '')] = r.value);
    
    res.json({ user, adminWallet: process.env.ADMIN_WALLET, rtp: rtpData });
});

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, mode } = req.body;
    const user = await User.findOne({ id });
    const field = mode === 'demo' ? 'demo_balance' : 'balance';
    
    if (bet < 0 || win < 0 || user[field] < bet) return res.status(400).json({error: 'No money'});
    
    const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

    // ИСПРАВЛЕНО: Ограничение на 2 ставки в краше и логика забора по очереди (Баг 7)
    if (game === 'Crash') {
        if (win === 0 && bet > 0) {
            // Проверяем сколько уже активных ставок у юзера
            const activeUserBets = crashLiveBets.filter(b => b.id === user.id && !b.cashedOut);
            if (activeUserBets.length >= 2) {
                return res.status(400).json({error: 'Максимум 2 ставки за раунд'});
            }
            // Добавляем ставку
            crashLiveBets.push({ id: user.id, username: user.username, avatar, bet: bet, cashedOut: false, win: 0 });
            io.emit('crashBetsUpdate', crashLiveBets);
        } 
        else if (win > 0) {
            // Ищем ПЕРВУЮ не забранную ставку этого юзера
            const activeBet = crashLiveBets.find(b => b.id === user.id && !b.cashedOut);
            if (activeBet) {
                activeBet.cashedOut = true;
                activeBet.win = win;
                io.emit('crashBetsUpdate', crashLiveBets);
            }
        }
    }

    user[field] = Number((user[field] - bet + win).toFixed(2));
    
    if (bet > 0) user.stats.bets++; 
    if(win > 0) { user.stats.wins++; user.stats.plus += win; } else if (bet > 0) { user.stats.minus += bet; }
    await user.save();
    
    if (bet > 0 || win > 0) {
        io.emit('newLiveBet', { username: user.username, avatar: avatar, game, amount: win > 0 ? '+'+win : '-'+bet });
    }
    
    res.json(user);
});

// ДЕПОЗИТ ЧЕРЕЗ TON CENTER
app.post('/api/check_deposit', async (req, res) => {
    const { id } = req.body;
    const adminWallet = process.env.ADMIN_WALLET;
    const apiKey = process.env.TON_API_KEY;
    if(!adminWallet || !apiKey) return res.status(500).json({error: 'Server wallet not configured'});

    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${adminWallet}&limit=10&api_key=${apiKey}`);
        const data = await response.json();
        
        if(!data.ok) return res.status(400).json({error: 'TonCenter error'});
        
        let foundNew = false;
        let totalAdded = 0;

        for (let tx of data.result) {
            if (tx.in_msg && tx.in_msg.message === String(id) && tx.in_msg.value > 0) {
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
        
        if(foundNew) {
            const user = await User.findOne({ id });
            res.json({ success: true, user, added: totalAdded });
        } else {
            res.status(400).json({ error: 'Новых оплат не найдено' });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({error: 'Network error'});
    }
});

app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    const promo = await Promo.findOne({ code });
    if(!promo || promo.usedBy.length >= promo.limit || promo.usedBy.includes(id)) return res.status(400).json({error: 'Invalid promo'});
    const user = await User.findOne({ id });
    user.balance = Number((user.balance + promo.amount).toFixed(2)); 
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

// ADMIN API
const checkAdmin = (req, res, next) => {
    if(req.body.pass !== (process.env.ADMIN_PASS || '1234')) return res.status(403).json({error: 'Wrong pass'});
    next();
};

app.post('/api/admin/data', checkAdmin, async (req, res) => {
    const withdraws = await Withdraw.find({status: 'pending'});
    const users = await User.find().sort({balance: -1}).limit(20);
    const promos = await Promo.find().sort({_id: -1}).limit(10);
    
    // ИСПРАВЛЕНО: Выдаем все RTP в админку
    const rtps = await Settings.find({key: /rtp_/});
    const rtpData = {};
    rtps.forEach(r => rtpData[r.key.replace('rtp_', '')] = r.value);

    res.json({ withdraws, users, rtp: rtpData, promos });
});

app.post('/api/admin/promo_create', checkAdmin, async (req, res) => {
    const { code, amount, limit } = req.body;
    await Promo.create({ code, amount: Number(amount), limit: Number(limit) });
    res.json({success: true});
});

// ИСПРАВЛЕНО: Установка RTP для конкретной игры
app.post('/api/admin/set_rtp', checkAdmin, async (req, res) => {
    const { game, value } = req.body; // game должен приходить как 'crash', 'mines', или 'coinflip'
    if (!['crash', 'mines', 'coinflip'].includes(game)) return res.status(400).json({error: 'Неверная игра'});
    
    const key = `rtp_${game}`;
    await Settings.updateOne({key}, {value: Number(value)}, {upsert: true});
    io.emit('rtpUpdate', { game, value: Number(value) });
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

server.listen(process.env.PORT || 3000, () => console.log('Server running'));
