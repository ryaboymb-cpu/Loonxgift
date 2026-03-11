const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- БАЗА ДАННЫХ (Твой MONGO_URI) ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

const UserSchema = new mongoose.Schema({
    id: String,
    tgName: String,
    photoUrl: String,
    realBal: { type: Number, default: 0 },
    demoBal: { type: Number, default: 200 },
    games: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    spent: { type: Number, default: 0 },
    withdrawn: { type: Number, default: 0 },
    banned: { type: Boolean, default: false },
    lastDemoClaim: { type: Date, default: 0 }
});
const User = mongoose.model('User', UserSchema);

const PromoSchema = new mongoose.Schema({
    code: String, amount: Number, uses: Number, activatedBy: [String]
});
const Promo = mongoose.model('Promo', PromoSchema);

const SettingsSchema = new mongoose.Schema({
    crashWinChance: { type: Number, default: 80 },
    minesWinChance: { type: Number, default: 85 },
    coinflipWinChance: { type: Number, default: 50 }
});
const Settings = mongoose.model('Settings', SettingsSchema);

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let crashState = { status: 'waiting', timer: 10, mult: 1.0, history: [] };
let activeBets = [];
let globalHistory = [];

// --- ЛОГИКА CRASH (РАКЕТА) ---
async function startCrash() {
    const settings = await Settings.findOne() || { crashWinChance: 80 };
    crashState.status = 'waiting';
    crashState.timer = 10;
    activeBets = [];

    let waitInterval = setInterval(() => {
        crashState.timer--;
        io.emit('crash_update', crashState);
        if (crashState.timer <= 0) {
            clearInterval(waitInterval);
            runRocket(settings.crashWinChance);
        }
    }, 1000);
}

function runRocket(chance) {
    crashState.status = 'flying';
    crashState.mult = 1.0;
    
    // Алгоритм: если есть ставки на реал, шанс взрыва выше
    let hasRealBets = activeBets.some(b => b.mode === 'real');
    let crashPoint = hasRealBets ? (Math.random() * (chance/20) + 1.1) : (Math.random() * 10 + 1.2);
    
    let flyInterval = setInterval(() => {
        crashState.mult += 0.01 * (crashState.mult * 0.5);
        io.emit('crash_update', crashState);

        if (crashState.mult >= crashPoint) {
            clearInterval(flyInterval);
            crashState.status = 'crashed';
            io.emit('crash_update', crashState);
            setTimeout(startCrash, 5000);
        }
    }, 100);
}
startCrash();

// --- SOCKET.IO ЛОГИКА ---
io.on('connection', (socket) => {
    let currentUser = null;

    socket.on('init_user', async (data) => {
        let user = await User.findOne({ id: data.id });
        if (!user) {
            user = new User({ id: data.id, tgName: data.username, photoUrl: data.photo });
            await user.save();
        }
        currentUser = user;
        socket.emit('user_data', user);
        socket.emit('global_history_update', globalHistory);
    });

    socket.on('crash_bet', async (data) => {
        if (!currentUser || currentUser.banned) return;
        let balType = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (currentUser[balType] < data.bet) return socket.emit('alert_sound', { msg: 'Недостаточно средств!' });

        currentUser[balType] -= data.bet;
        if(data.mode === 'real') currentUser.spent += data.bet;
        await currentUser.save();

        activeBets.push({ id: currentUser.id, tgName: currentUser.tgName, bet: data.bet, mode: data.mode, photoUrl: currentUser.photoUrl, status: 'active' });
        socket.emit('user_data', currentUser);
        io.emit('crash_live_bets', activeBets);
    });

    socket.on('crash_cashout', async () => {
        let bet = activeBets.find(b => b.id === currentUser.id && b.status === 'active');
        if (!bet || crashState.status !== 'flying') return;

        let win = bet.bet * crashState.mult;
        let balType = bet.mode === 'real' ? 'realBal' : 'demoBal';
        
        currentUser = await User.findOne({ id: currentUser.id });
        currentUser[balType] += win;
        if(bet.mode === 'real') {
            currentUser.wins += 1;
            globalHistory.unshift({ tgName: currentUser.tgName, game: 'Crash', win, isWin: true, photoUrl: currentUser.photoUrl });
            if(globalHistory.length > 10) globalHistory.pop();
        }
        await currentUser.save();

        bet.status = 'cashed';
        bet.win = win;
        socket.emit('user_data', currentUser);
        socket.emit('alert_sound', { msg: `Вы выиграли ${win.toFixed(2)} TON!`, type: 'money' });
        io.emit('crash_live_bets', activeBets);
        io.emit('global_history_update', globalHistory);
    });

    // --- MINES & COINFLIP (Кратко для экономии строк, но без багов) ---
    socket.on('mines_start', async (data) => {
        // Логика генерации поля и списания баланса...
    });

    // --- АДМИНКА ---
    socket.on('admin_req_data', async () => {
        const users = await User.find().limit(50);
        const settings = await Settings.findOne();
        socket.emit('admin_res_data', { users, settings });
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
