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

app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected'));

const UserSchema = new mongoose.Schema({
    id: String, username: String, photo: String,
    balance: { type: Number, default: 0 }, demo_balance: { type: Number, default: 5000 },
    stats: { bets: {type:Number, default:0}, wins: {type:Number, default:0}, plus: {type:Number, default:0}, minus: {type:Number, default:0} }
});
const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' } });
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number });
const SettingsSchema = new mongoose.Schema({ key: String, value: Number }); // Для RTP

const User = mongoose.model('User', UserSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

async function initSettings() {
    const rtp = await Settings.findOne({key: 'rtp'});
    if(!rtp) await Settings.create({key: 'rtp', value: 90});
}
initSettings();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.on('message', (msg) => {
    if (msg.text === '/start' || msg.text === '/help') {
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
    }
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
    const rtpSetting = await Settings.findOne({key: 'rtp'});
    const rtp = rtpSetting ? rtpSetting.value : 90; 
    const limit = Math.pow(100 / (100 - (Math.random() * rtp)), 0.9).toFixed(2);
    
    const r = setInterval(() => {
        crash.multiplier = (parseFloat(crash.multiplier) + 0.01).toFixed(2);
        io.emit('crashData', crash);
        if(parseFloat(crash.multiplier) >= limit) { 
            clearInterval(r); 
            crash.status = 'crashed'; 
            crashHistory.unshift(crash.multiplier);
            if(crashHistory.length > 10) crashHistory.pop();
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
    
    const rtpSetting = await Settings.findOne({key: 'rtp'});
    res.json({ user, adminWallet: process.env.ADMIN_WALLET, rtp: rtpSetting ? rtpSetting.value : 90 });
});

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, mode } = req.body;
    const user = await User.findOne({ id });
    const field = mode === 'demo' ? 'demo_balance' : 'balance';
    
    if (bet <= 0 || user[field] < bet) return res.status(400).json({error: 'No money'});
    
    user[field] = Number((user[field] - bet + win).toFixed(2));
    user.stats.bets++;
    if(win > 0) { user.stats.wins++; user.stats.plus += win; } else { user.stats.minus += bet; }
    await user.save();
    
    const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    io.emit('newLiveBet', { username: user.username, avatar: avatar, game, amount: win > 0 ? '+'+win : '-'+bet });
    
    if(game === 'Crash' && win === 0) {
        crashLiveBets.push({ id: user.id, username: user.username, avatar, bet: bet });
        io.emit('crashBetsUpdate', crashLiveBets);
    }
    
    res.json(user);
});

// НАСТОЯЩИЙ ДЕПОЗИТ ЧЕРЕЗ TON CENTER
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
    const rtp = await Settings.findOne({key: 'rtp'});
    const promos = await Promo.find().sort({_id: -1}).limit(10);
    res.json({ withdraws, users, rtp: rtp ? rtp.value : 90, promos });
});

app.post('/api/admin/promo_create', checkAdmin, async (req, res) => {
    const { code, amount, limit } = req.body;
    await Promo.create({ code, amount: Number(amount), limit: Number(limit) });
    res.json({success: true});
});

app.post('/api/admin/set_rtp', checkAdmin, async (req, res) => {
    const { value } = req.body;
    await Settings.updateOne({key: 'rtp'}, {value: Number(value)}, {upsert: true});
    io.emit('rtpUpdate', Number(value)); // Отправляем новый RTP всем клиентам
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
