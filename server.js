require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ПОДКЛЮЧЕНИЕ К MONGODB (Твой URI из Render .env)
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/loonx')
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

// Схема пользователя (С ОБНОВЛЕННЫМ БАЛАНСОМ 50 ДЕМО)
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    realBalance: { type: Number, default: 0 },
    demoBalance: { type: Number, default: 50 }, // Поставил 50
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    games: { type: Number, default: 0 },
    wallet: { type: String, default: null, sparse: true } // Убрали unique
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String, amount: Number, activations: Number, usedBy: [String]
}));

// ТВОЙ КОШЕЛЕК ИЗ RENDER .ENV
const PROJECT_WALLET = process.env.PROJECT_WALLET;

// --- CRASH ENGINE (Мультиплеер) ---
let crashState = { status: 'betting', multiplier: 1.00, timer: 10 };
let currentBets = []; 

function runCrash() {
    crashState = { status: 'betting', multiplier: 1.00, timer: 10 };
    currentBets = [];
    io.emit('crash_state', crashState);
    let timerId = setInterval(() => {
        crashState.timer--;
        io.emit('crash_timer', crashState.timer);
        if (crashState.timer <= 0) {
            clearInterval(timerId);
            startFlight();
        }
    }, 1000);
}

function startFlight() {
    crashState.status = 'flying';
    io.emit('crash_state', crashState);
    const crashAt = Math.random() < 0.08 ? 1.00 : Math.min(20, (1 / (Math.random() * 0.96 + 0.04)).toFixed(2));
    let flightId = setInterval(() => {
        crashState.multiplier += 0.01 + (crashState.multiplier * 0.006);
        if (crashState.multiplier >= crashAt) {
            clearInterval(flightId);
            crashState.status = 'crashed';
            crashState.multiplier = crashAt;
            io.emit('crash_state', crashState);
            setTimeout(runCrash, 4000);
        } else {
            io.emit('crash_tick', crashState.multiplier.toFixed(2));
        }
    }, 80);
}
runCrash();

// --- API ROUTES ---
app.post('/api/init', async (req, res) => {
    try {
        let u = await User.findOne({ userId: req.body.userId });
        // Если юзер новый, создаем с 50 Демо
        if (!u) { u = new User({ userId: req.body.userId, demoBalance: 50 }); await u.save(); }
        res.json(u);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/balance/update', async (req, res) => {
    const { userId, mode, amount, isWin, isLose } = req.body;
    const user = await User.findOne({ userId });
    if (mode === 'real') user.realBalance += amount;
    else user.demoBalance += amount;
    
    user.games++;
    if (isWin) user.wins++;
    if (isLose) user.losses++;
    
    await user.save();
    res.json({ real: user.realBalance, demo: user.demoBalance });
});

app.post('/api/promo/use', async (req, res) => {
    const { userId, code } = req.body;
    const p = await Promo.findOne({ code });
    if (p && p.activations > 0 && !p.usedBy.includes(userId)) {
        p.activations--; p.usedBy.push(userId); await p.save();
        const u = await User.findOne({ userId }); u.realBalance += p.amount; await u.save();
        return res.json({ success: true, amount: p.amount });
    }
    res.json({ success: false });
});

app.post('/api/admin/promo', async (req, res) => {
    await new Promo(req.body).save(); res.json({ ok: true });
});

// МАНИФЕСТ ДЛЯ TON CONNECT
app.get('/tonconnect-manifest.json', (req, res) => {
    res.json({
        "url": "https://loonxgift.render.com", // Сюда подставь свой домен Render
        "name": "Loonx Gifts",
        "iconUrl": "https://loonxgift.render.com/img/2657-Photoroom.png" // Ссылка на ракету для кошелька
    });
});

// --- SOCKETS ---
io.on('connection', (socket) => {
    io.emit('online', io.engine.clientsCount);
    socket.emit('crash_state', crashState);
    socket.on('disconnect', () => io.emit('online', io.engine.clientsCount));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
