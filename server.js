require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- КОНФИГ ИЗ .ENV ---
const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const TON_API_KEY = process.env.TON_API_KEY;
const ADMIN_WALLET = process.env.ADMIN_WALLET;

const bot = new TelegramBot(TOKEN, { polling: true });

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ База данных подключена"))
    .catch(err => console.error("❌ Ошибка БД:", err));

// --- МОДЕЛИ ДАННЫХ ---
const User = mongoose.model('User', new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    photo_url: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats_games: { type: Number, default: 0 },
    stats_wins: { type: Number, default: 0 },
    total_dep: { type: Number, default: 0 },
    total_out: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false }
}));

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    tgId: Number,
    username: String,
    amount: Number,
    address: String,
    status: { type: String, default: 'pending' },
    date: { type: Date, default: Date.now }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: { type: String, unique: true },
    reward: Number,
    limit: Number,
    uses: { type: Number, default: 0 },
    claimedBy: [Number]
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    rtp_crash: { type: Number, default: 0.95 },
    rtp_mines: { type: Number, default: 0.95 },
    rtp_coin: { type: Number, default: 0.5 }
}));

app.use(express.static('public'));

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ИГР ---
let liveBets = [];
let crashState = { 
    status: 'waiting', 
    multiplier: 1.0, 
    history: [], 
    currentBets: [], 
    nextBets: [], 
    timer: 8 
};
let activeMines = {}; 

function addLiveBet(username, game, profit) {
    liveBets.unshift({ username, game, profit });
    if (liveBets.length > 20) liveBets.pop();
    io.emit('live_bets_update', liveBets);
}

// --- ЛОГИКА CRASH (С ОЧЕРЕДЬЮ СТАВОК) ---
async function startCrashCycle() {
    crashState.status = 'waiting';
    crashState.multiplier = 1.0;
    
    // Перенос ставок "на следующий раунд" в текущий
    crashState.currentBets = [...crashState.nextBets];
    crashState.nextBets = [];
    
    io.emit('crash_update_bets', crashState.currentBets);
    crashState.timer = 8;

    const countdown = setInterval(() => {
        crashState.timer -= 0.1;
        io.emit('crash_timer', crashState.timer.toFixed(1));
        if (crashState.timer <= 0) {
            clearInterval(countdown);
            runFlight();
        }
    }, 100);
}

function runFlight() {
    crashState.status = 'flying';
    io.emit('crash_start');
    
    // Генерация точки взрыва
    const crashPoint = Math.max(1, (1 / (1 - Math.random() * 0.96)).toFixed(2));
    
    const flight = setInterval(() => {
        crashState.multiplier += (crashState.multiplier * 0.005) + 0.01;
        io.emit('crash_tick', crashState.multiplier);

        if (crashState.multiplier >= crashPoint) {
            clearInterval(flight);
            doCrash(crashPoint);
        }
    }, 100);
}

function doCrash(point) {
    crashState.status = 'crashed';
    crashState.history.unshift(parseFloat(point).toFixed(2));
    if (crashState.history.length > 12) crashState.history.pop();
    
    io.emit('crash_end', { point, history: crashState.history });
    
    // Все, кто не забрал — в ленту проигрышей
    crashState.currentBets.forEach(bet => {
        if (!bet.cashedOut) addLiveBet(bet.username, 'Crash', -bet.amount);
    });
    
    setTimeout(startCrashCycle, 4000);
}

startCrashCycle();

// --- АВТО-ДЕПОЗИТЫ (TON API) ---
setInterval(async () => {
    if (!TON_API_KEY || !ADMIN_WALLET) return;
    try {
        const response = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${ADMIN_WALLET}&limit=15&api_key=${TON_API_KEY}`);
        const txs = response.data.result;
        
        for (let tx of txs) {
            const comment = tx.in_msg.message; // Здесь должен быть tgId пользователя
            const amount = tx.in_msg.value / 1000000000;
            
            if (!isNaN(comment)) {
                const user = await User.findOne({ tgId: parseInt(comment) });
                if (user) {
                    // Здесь нужна проверка по hash транзакции в базе, чтобы не дублировать
                    // user.real_balance += amount; await user.save();
                }
            }
        }
    } catch (e) { /* ignore */ }
}, 40000);

// --- SOCKET.IO ЛОГИКА ---
io.on('connection', async (socket) => {
    io.emit('online_count', io.engine.clientsCount);
    socket.emit('live_bets_update', liveBets);
    socket.emit('crash_init', { history: crashState.history });

    socket.on('auth', async (data) => {
        if (!data || !data.id) return;
        let uname = data.username;
        if (!uname || uname === 'undefined') uname = data.first_name || `User_${data.id}`;
        
        let user = await User.findOne({ tgId: data.id });
        if (!user) {
            user = await User.create({ tgId: data.id, username: uname, photo_url: data.photo_url });
        } else {
            user.username = uname;
            await user.save();
        }
        socket.userId = user._id;
        socket.tgId = user.tgId;
        socket.emit('user_data', user);
    });

    // --- CRASH ---
    socket.on('crash_bet', async (data) => {
        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount < 0.5 || amount > 20) {
            return socket.emit('toast', {text: 'Лимиты: 0.5 - 20 TON', type: 'error'});
        }

        const user = await User.findById(socket.userId);
        if (data.mode === 'real') {
            if (user.real_balance < amount) return socket.emit('toast', {text: 'Мало TON', type: 'error'});
            user.real_balance -= amount;
        } else {
            if (user.demo_balance < amount) return socket.emit('toast', {text: 'Мало D-TON', type: 'error'});
            user.demo_balance -= amount;
        }
        await user.save();
        socket.emit('user_data', user);

        const betData = { id: socket.id, username: user.username, amount, mode: data.mode, cashedOut: false };
        
        if (crashState.status !== 'waiting') {
            crashState.nextBets.push(betData);
            socket.emit('toast', {text: 'Ставка на след. раунд', type: 'info'});
        } else {
            crashState.currentBets.push(betData);
            io.emit('crash_update_bets', crashState.currentBets);
        }
    });

    socket.on('crash_cashout', async () => {
        if (crashState.status !== 'flying') return;
        const bet = crashState.currentBets.find(b => b.id === socket.id && !b.cashedOut);
        if (!bet) return;

        bet.cashedOut = true;
        const win = bet.amount * crashState.multiplier;
        const user = await User.findById(socket.userId);
        
        if (bet.mode === 'real') user.real_balance += win;
        else user.demo_balance += win;
        
        user.stats_wins += 1;
        await user.save();
        
        addLiveBet(user.username, 'Crash', win);
        socket.emit('user_data', user);
        io.emit('crash_update_bets', crashState.currentBets);
        socket.emit('toast', {text: `Победа +${win.toFixed(2)}`, type: 'success'});
    });

    // --- COINFLIP ---
    socket.on('coin_play', async (data) => {
        const amount = parseFloat(data.amount);
        if (amount < 0.5 || amount > 20) return socket.emit('toast', {text: 'Лимиты 0.5 - 20', type: 'error'});
        
        const user = await User.findById(socket.userId);
        if (data.mode === 'real') user.real_balance -= amount;
        else user.demo_balance -= amount;

        const isWin = Math.random() < 0.48; // Небольшое преимущество дома
        const prize = amount * 1.95;
        
        setTimeout(async () => {
            if (isWin) {
                if (data.mode === 'real') user.real_balance += prize;
                else user.demo_balance += prize;
                addLiveBet(user.username, 'Coin', prize);
                socket.emit('coin_result', { win: true, prize });
            } else {
                addLiveBet(user.username, 'Coin', -amount);
                socket.emit('coin_result', { win: false });
            }
            await user.save();
            socket.emit('user_data', user);
        }, 1200);
    });

    // --- MINES ---
    socket.on('mines_start', async (data) => {
        const amount = parseFloat(data.amount);
        const bombsCount = parseInt(data.bombs);
        const user = await User.findById(socket.userId);
        
        if (data.mode === 'real') user.real_balance -= amount;
        else user.demo_balance -= amount;
        await user.save();

        let field = Array(25).fill('diamond');
        let bombs = 0;
        while(bombs < bombsCount) {
            let r = Math.floor(Math.random() * 25);
            if (field[r] !== 'bomb') { field[r] = 'bomb'; bombs++; }
        }

        activeMines[socket.id] = { field, amount, mode: data.mode, step: 0, bombsCount };
        socket.emit('mines_init_res');
        socket.emit('user_data', user);
    });

    socket.on('mines_step', async (index) => {
        const game = activeMines[socket.id];
        if (!game) return;

        if (game.field[index] === 'bomb') {
            addLiveBet((await User.findById(socket.userId)).username, 'Mines', -game.amount);
            socket.emit('mines_die', { field: game.field });
            delete activeMines[socket.id];
        } else {
            game.step++;
            let mult = 1.2 + (game.step * 0.3); // Примерный рост
            socket.emit('mines_continue', { index, mult: mult.toFixed(2) });
        }
    });

    // --- АДМИНКА (КОД 7788) ---
    socket.on('admin_auth', async (code) => {
        if (code === '7788') {
            const user = await User.findById(socket.userId);
            user.isAdmin = true;
            await user.save();
            
            const users = await User.find().limit(100);
            const withdraws = await Withdraw.find({status: 'pending'});
            const promos = await Promo.find();
            
            socket.emit('admin_ok', { users, withdraws, promos });
        } else {
            socket.emit('toast', {text: 'Неверный код!', type: 'error'});
        }
    });

    socket.on('admin_get_users', async () => {
        const users = await User.find().limit(100);
        socket.emit('admin_users_list', users);
    });

    socket.on('admin_promo_create', async (p) => {
        await Promo.create({ code: p.code, reward: p.reward, limit: p.limit });
        socket.emit('toast', {text: 'Промокод создан', type: 'success'});
    });

    socket.on('disconnect', () => {
        io.emit('online_count', io.engine.clientsCount);
    });
});

// --- БОТ ---
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🚀 *Loonx Gifts* — Твой шанс на TON!`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "Начать играть", web_app: { url: process.env.WEBAPP_URL } }]]
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
