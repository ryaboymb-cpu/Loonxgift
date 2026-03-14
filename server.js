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

// DB
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected'));

const UserSchema = new mongoose.Schema({
    id: String, username: String, photo: String,
    balance: { type: Number, default: 0 }, demo_balance: { type: Number, default: 5000 },
    stats: { bets: {type:Number, default:0}, wins: {type:Number, default:0}, plus: {type:Number, default:0}, minus: {type:Number, default:0} }
});
const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' } });

const User = mongoose.model('User', UserSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

// BOT
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.onText(/\/(start|help)/, (msg) => {
    bot.sendMessage(msg.chat.id, `🚀 Добро пожаловать в Loonx Casino!`, {
        reply_markup: { inline_keyboard: [[{ text: "🎮 ИГРАТЬ", web_app: { url: process.env.WEB_APP_URL } }]] }
    });
});

// CRASH ENGINE
let crash = { status: 'waiting', timer: 10, multiplier: 1.0 };
function startCrash() {
    crash.status = 'waiting'; crash.timer = 10;
    const t = setInterval(() => {
        crash.timer--; io.emit('crashData', crash);
        if(crash.timer <= 0) { clearInterval(t); runCrash(); }
    }, 1000);
}
function runCrash() {
    crash.status = 'running'; crash.multiplier = 1.0;
    const limit = Math.pow(100 / (100 - Math.random() * 99), 0.9).toFixed(2);
    const r = setInterval(() => {
        crash.multiplier = (parseFloat(crash.multiplier) + 0.01).toFixed(2);
        io.emit('crashData', crash);
        if(parseFloat(crash.multiplier) >= limit) { clearInterval(r); crash.status = 'crashed'; io.emit('crashData', crash); setTimeout(startCrash, 4000); }
    }, 100);
}
startCrash();

// SOCKETS (Online & Bets)
let online = 0;
io.on('connection', (socket) => {
    online++; io.emit('online', online);
    socket.on('disconnect', () => { online--; io.emit('online', online); });
});

// API ROUTES
app.post('/api/auth', async (req, res) => {
    const { id, username, first_name, photo_url } = req.body;
    let user = await User.findOne({ id });
    if (!user) user = await User.create({ id, username: username || first_name, photo: photo_url });
    res.json(user);
});

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, mode } = req.body;
    const user = await User.findOne({ id });
    const field = mode === 'demo' ? 'demo_balance' : 'balance';
    
    if (user[field] < bet) return res.status(400).json({error: 'No money'});
    
    user[field] = Number((user[field] - bet + win).toFixed(2));
    user.stats.bets++;
    if(win > 0) { user.stats.wins++; user.stats.plus += win; } else { user.stats.minus += bet; }
    await user.save();
    
    io.emit('newLiveBet', { username: user.username, game, amount: win > 0 ? '+'+win : '-'+bet });
    res.json(user);
});

app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    const promo = await Promo.findOne({ code });
    if(!promo || promo.usedBy.length >= promo.limit || promo.usedBy.includes(id)) return res.status(400).json({error: 'Invalid promo'});
    
    const user = await User.findOne({ id });
    user.balance += promo.amount; promo.usedBy.push(id);
    await user.save(); await promo.save();
    res.json(user);
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    const user = await User.findOne({ id });
    if (user.balance < amount || amount < 5) return res.status(400).json({error: 'Min 5 TON or low balance'});
    user.balance -= amount; await user.save();
    await Withdraw.create({ userId: id, address, amount });
    res.json(user);
});

// ADMIN API
app.post('/api/admin', async (req, res) => {
    if(req.body.pass !== process.env.ADMIN_PASS) return res.status(403).send();
    if(req.body.action === 'get') {
        const w = await Withdraw.find({status: 'pending'});
        const p = await Promo.find();
        res.json({ withdraws: w, promos: p });
    }
});

server.listen(process.env.PORT || 3000, () => console.log('Server running'));
