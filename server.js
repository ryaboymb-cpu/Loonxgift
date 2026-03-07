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

// Подключение к MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/loonx')
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    realBalance: { type: Number, default: 0 },
    demoBalance: { type: Number, default: 100 },
    walletConnected: { type: Boolean, default: false }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String, amount: Number, activations: Number, usedBy: [String]
}));

// --- СИСТЕМА CRASH ---
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
    const crashAt = Math.random() < 0.08 ? 1.00 : Math.min(30, (1 / (Math.random() * 0.96 + 0.04)).toFixed(2));
    
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

// --- SOCKETS ---
io.on('connection', (socket) => {
    io.emit('online', io.engine.clientsCount);
    socket.emit('crash_state', crashState);

    socket.on('place_bet', async (data) => {
        if (crashState.status !== 'betting') return;
        const user = await User.findOne({ userId: data.userId });
        const bal = data.mode === 'real' ? user.realBalance : user.demoBalance;
        if (bal >= data.amount && data.amount > 0) {
            if (data.mode === 'real') user.realBalance -= data.amount;
            else user.demoBalance -= data.amount;
            await user.save();
            currentBets.push({ id: socket.id, ...data });
            socket.emit('update_bal', { real: user.realBalance, demo: user.demoBalance });
        }
    });

    socket.on('cashout', async () => {
        const bet = currentBets.find(b => b.id === socket.id);
        if (!bet || crashState.status !== 'flying') return;
        const win = bet.amount * crashState.multiplier;
        const user = await User.findOne({ userId: bet.userId });
        if (bet.mode === 'real') user.realBalance += win;
        else user.demoBalance += win;
        await user.save();
        currentBets = currentBets.filter(b => b.id !== socket.id);
        socket.emit('win', { amount: win, real: user.realBalance, demo: user.demoBalance });
    });

    socket.on('disconnect', () => io.emit('online', io.engine.clientsCount));
});

// --- API ROUTES ---
app.post('/api/init', async (req, res) => {
    let u = await User.findOne({ userId: req.body.userId });
    if (!u) { u = new User({ userId: req.body.userId }); await u.save(); }
    res.json(u);
});

// Универсальный апдейт баланса (для Минера)
app.post('/api/balance/update', async (req, res) => {
    const { userId, mode, amount } = req.body;
    const user = await User.findOne({ userId });
    if (mode === 'real') user.realBalance += amount;
    else user.demoBalance += amount;
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

server.listen(10000, () => console.log('Server running!'));
// ... (твои конфиги сверху остаются)

// ИСПРАВЛЕННАЯ МОДЕЛЬ ПОЛЬЗОВАТЕЛЯ
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    realBalance: { type: Number, default: 0 },
    demoBalance: { type: Number, default: 100 },
    // Убрали unique: true, чтобы не было ошибки из логов!
    wallet: { type: String, default: null } 
}));

// ТВОЙ КОШЕЛЕК ДЛЯ ПРИЕМА (Константа)
const PROJECT_WALLET = "UQCTqV9scQaZR0DHzOnMrOCCY7z3MIT0QfoNrtUDZiXHY1-K"; 

// API для получения адреса кошелька проекта (чтобы юзеры знали куда платить)
app.get('/api/project-wallet', (req, res) => {
    res.json({ wallet: PROJECT_WALLET });
});

// ... (весь остальной код игр и сокетов идет дальше без изменений)
