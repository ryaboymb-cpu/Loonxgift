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

// Подключение к БД
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/loonx')
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

// Схемы
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    realBalance: { type: Number, default: 0 },
    demoBalance: { type: Number, default: 50 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    games: { type: Number, default: 0 },
    wallet: { type: String, default: null, sparse: true }
}));

const Withdrawal = mongoose.model('Withdrawal', new mongoose.Schema({
    userId: String, wallet: String, amount: Number,
    status: { type: String, default: 'pending' },
    date: { type: Date, default: Date.now }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String, amount: Number, activations: Number, usedBy: [String]
}));

// --- CRASH ENGINE ---
let crashState = { status: 'betting', multiplier: 1.00, timer: 10 };
function runCrash() {
    crashState = { status: 'betting', multiplier: 1.00, timer: 10 };
    io.emit('crash_state', crashState);
    let timerId = setInterval(() => {
        crashState.timer--;
        io.emit('crash_timer', crashState.timer);
        if (crashState.timer <= 0) { clearInterval(timerId); startFlight(); }
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
app.post('/api/
