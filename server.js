require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ТВОЙ КОШЕЛЕК
const PROJECT_WALLET = "UQAbc123...your_real_wallet"; 

// Подключение к MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

// Схема пользователя (БЕЗ UNIQUE ДЛЯ WALLET)
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    realBalance: { type: Number, default: 0 },
    demoBalance: { type: Number, default: 100 },
    wallet: { type: String, default: null } 
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String, amount: Number, activations: Number, usedBy: [String]
}));

// --- СИСТЕМА CRASH ---
let crashState = { status: 'betting', multiplier: 1.00, timer: 10 };
function runCrash() {
    crashState = { status: 'betting', multiplier: 1.00, timer: 10 };
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
    const crashAt = Math.random() < 0.08 ? 1.00 : Math.min(25, (1 / (Math.random() * 0.96 + 0.04)).toFixed(2));
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

// --- API ---
app.post('/api/init', async (req, res) => {
    try {
        let u = await User.findOne({ userId: req.body.userId });
        if (!u) { u = new User({ userId: req.body.userId }); await u.save(); }
        res.json(u);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/balance/update', async (req, res) => {
    const { userId, mode, amount } = req.body;
    const user = await User.findOne({ userId });
    if (mode === 'real') user.realBalance += amount;
    else user.demoBalance += amount;
    await user.save();
    res.json({ real: user.realBalance, demo: user.demoBalance });
});

app.get('/api/project-wallet', (req, res) => res.json({ wallet: PROJECT_WALLET }));

// Сокеты (online)
io.on('connection', (socket) => {
    io.emit('online', io.engine.clientsCount);
    socket.on('disconnect', () => io.emit('online', io.engine.clientsCount));
});

server.listen(process.env.PORT || 10000);
