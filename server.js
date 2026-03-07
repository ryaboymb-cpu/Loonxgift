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

// Подключение к Mongo (Render возьмет из Environment Variables)
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ База на связи'))
    .catch(err => console.error('❌ Ошибка БД:', err));

// Модели данных
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    realBalance: { type: Number, default: 0 },
    demoBalance: { type: Number, default: 100 },
    games: { type: Number, default: 0 },
    wins: { type: Number, default: 0 }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String, amount: Number, activations: Number, usedBy: [String]
}));

// ЛОГИКА CRASH (Общая для всех)
let crashState = { status: 'betting', multiplier: 1.00, timer: 10 };
let currentBets = []; 

function runCrashSystem() {
    // Фаза ставок
    crashState.status = 'betting';
    crashState.timer = 10;
    crashState.multiplier = 1.00;
    currentBets = [];
    io.emit('crash_state', crashState);

    let countdown = setInterval(() => {
        crashState.timer--;
        io.emit('crash_timer', crashState.timer);
        if (crashState.timer <= 0) {
            clearInterval(countdown);
            startFlight();
        }
    }, 1000);
}

function startFlight() {
    crashState.status = 'flying';
    io.emit('crash_state', crashState);

    // Математика: шанс моментального краша (RTP)
    const crashAt = Math.random() < 0.08 ? 1.00 : Math.min(20, (1 / (Math.random() * 0.96 + 0.04)).toFixed(2));

    let flight = setInterval(() => {
        crashState.multiplier += 0.01 + (crashState.multiplier * 0.005);
        
        if (crashState.multiplier >= crashAt) {
            clearInterval(flight);
            crashState.status = 'crashed';
            crashState.multiplier = crashAt;
            io.emit('crash_state', crashState);
            setTimeout(runCrashSystem, 4000); // Пауза перед новым раундом
        } else {
            io.emit('crash_tick', crashState.multiplier.toFixed(2));
        }
    }, 70);
}

runCrashSystem();

// Сокеты (Онлайн и ставки)
io.on('connection', (socket) => {
    io.emit('online', io.engine.clientsCount);
    socket.emit('crash_state', crashState);

    socket.on('place_bet', async (data) => {
        if (crashState.status !== 'betting') return;
        const user = await User.findOne({ userId: data.userId });
        const bal = data.mode === 'real' ? user.realBalance : user.demoBalance;
        
        if (bal >= data.amount && data.amount >= 0.5 && data.amount <= 20) {
            if (data.mode === 'real') user.realBalance -= data.amount;
            else user.demoBalance -= data.amount;
            user.games++;
            await user.save();
            currentBets.push({ id: socket.id, ...data });
            socket.emit('update_bal', { real: user.realBalance, demo: user.demoBalance });
        }
    });

    socket.on('cashout', async (data) => {
        const bet = currentBets.find(b => b.id === socket.id);
        if (!bet || crashState.status !== 'flying') return;
        
        const win = bet.amount * crashState.multiplier;
        const user = await User.findOne({ userId: bet.userId });
        if (bet.mode === 'real') user.realBalance += win;
        else user.demoBalance += win;
        user.wins++;
        await user.save();
        
        currentBets = currentBets.filter(b => b.id !== socket.id);
        socket.emit('win', { amount: win, real: user.realBalance, demo: user.demoBalance });
    });

    socket.on('disconnect', () => io.emit('online', io.engine.clientsCount));
});

// API
app.post('/api/init', async (req, res) => {
    let u = await User.findOne({ userId: req.body.userId });
    if (!u) { u = new User({ userId: req.body.userId }); await u.save(); }
    res.json(u);
});

server.listen(10000, () => console.log('Server started'));
