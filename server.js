require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const TON_API_KEY = process.env.TON_API_KEY;
const ADMIN_WALLET = process.env.ADMIN_WALLET;

const bot = new TelegramBot(TOKEN, { polling: true });

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- МОДЕЛИ ---
const UserSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    photo_url: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats_games: { type: Number, default: 0 },
    stats_wins: { type: Number, default: 0 },
    total_dep: { type: Number, default: 0 },
    total_out: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    regDate: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

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

app.use(express.static('public'));

// --- СОСТОЯНИЕ ИГР ---
let liveBets = [];
let onlineCount = 0;
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
    liveBets.unshift({ username, game, profit: parseFloat(profit).toFixed(2) });
    if (liveBets.length > 15) liveBets.pop();
    io.emit('live_bets_update', liveBets);
}

// --- КРАШ ЛОГИКА ---
async function startCrashCycle() {
    crashState.status = 'waiting';
    crashState.multiplier = 1.0;
    
    // Перенос отложенных ставок
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
    
    const crashPoint = Math.max(1.01, (1 / (1 - Math.random() * 0.97)).toFixed(2));
    
    const flight = setInterval(() => {
        crashState.multiplier += (crashState.multiplier * 0.005) + 0.01;
        io.emit('crash_tick', crashState.multiplier.toFixed(2));

        if (crashState.multiplier >= crashPoint) {
            clearInterval(flight);
            doCrash(crashPoint);
        }
    }, 100);
}

function doCrash(point) {
    crashState.status = 'crashed';
    crashState.history.unshift(parseFloat(point).toFixed(2));
    if (crashState.history.length > 15) crashState.history.pop();
    
    io.emit('crash_end', { point, history: crashState.history });
    
    crashState.currentBets.forEach(bet => {
        if (!bet.cashedOut) addLiveBet(bet.username, 'Crash', -bet.amount);
    });
    
    setTimeout(startCrashCycle, 4000);
}

startCrashCycle();

// --- ПРОВЕРКА TON ТРАНЗАКЦИЙ ---
setInterval(async () => {
    if (!TON_API_KEY || !ADMIN_WALLET) return;
    try {
        const response = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${ADMIN_WALLET}&limit=10&api_key=${TON_API_KEY}`);
        const data = await response.json();
        if (data.ok) {
            for (let tx of data.result) {
                const comment = tx.in_msg.message;
                const amount = tx.in_msg.value / 1e9;
                if (comment && !isNaN(comment)) {
                    const user = await User.findOne({ tgId: parseInt(comment) });
                    if (user) {
                        // Здесь можно добавить проверку hash в БД, чтобы не начислять дважды
                    }
                }
            }
        }
    } catch (e) {}
}, 30000);

// --- SOCKETS ---
io.on('connection', async (socket) => {
    onlineCount++;
    io.emit('online_count', onlineCount);
    
    socket.emit('live_bets_update', liveBets);
    socket.emit('crash_init', { history: crashState.history });

    socket.on('auth', async (data) => {
        if (!data || !data.id) return;
        let uname = data.username || data.first_name || `User_${data.id}`;
        let user = await User.findOne({ tgId: data.id });
        if (!user) {
            user = await User.create({ tgId: data.id, username: uname, photo_url: data.photo_url });
        } else {
            user.username = uname;
            user.photo_url = data.photo_url;
            await user.save();
        }
        socket.userId = user._id;
        socket.tgId = user.tgId;
        socket.emit('user_data', user);
    });

    // CRASH СТАВКА
    socket.on('crash_bet', async (data) => {
        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount < 0.5 || amount > 20) {
            return socket.emit('toast', {text: 'Лимиты: 0.5 - 20 TON', type: 'error'});
        }
        const user = await User.findById(socket.userId);
        if (!user) return;

        if (data.mode === 'real') {
            if (user.real_balance < amount) return socket.emit('toast', {text: 'Недостаточно TON', type: 'error'});
            user.real_balance -= amount;
        } else {
            if (user.demo_balance < amount) return socket.emit('toast', {text: 'Недостаточно D-TON', type: 'error'});
            user.demo_balance -= amount;
        }
        
        user.stats_games += 1;
        await user.save();
        socket.emit('user_data', user);

        const betData = { id: socket.id, username: user.username, amount, mode: data.mode, cashedOut: false };
        
        if (crashState.status !== 'waiting') {
            crashState.nextBets.push(betData);
            socket.emit('toast', {text: 'Ставка на следующий раунд', type: 'info'});
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
        socket.emit('toast', {text: `Выиграно: ${win.toFixed(2)}`, type: 'success'});
    });

    // MINES
    socket.on('mines_start', async (data) => {
        const amount = parseFloat(data.amount);
        const bombsCount = parseInt(data.bombs);
        if (amount < 0.5 || amount > 20) return socket.emit('toast', {text: 'Лимиты: 0.5 - 20', type: 'error'});
        
        const user = await User.findById(socket.userId);
        if (data.mode === 'real') {
            if (user.real_balance < amount) return;
            user.real_balance -= amount;
        } else {
            if (user.demo_balance < amount) return;
            user.demo_balance -= amount;
        }
        await user.save();

        let field = Array(25).fill('diamond');
        let b = 0;
        while(b < bombsCount) {
            let r = Math.floor(Math.random() * 25);
            if (field[r] !== 'bomb') { field[r] = 'bomb'; b++; }
        }
        activeMines[socket.id] = { field, amount, mode: data.mode, steps: 0, bombsCount };
        socket.emit('mines_init_res');
        socket.emit('user_data', user);
    });

    socket.on('mines_step', async (idx) => {
        const game = activeMines[socket.id];
        if (!game) return;
        if (game.field[idx] === 'bomb') {
            addLiveBet((await User.findById(socket.userId)).username, 'Mines', -game.amount);
            socket.emit('mines_die', { field: game.field });
            delete activeMines[socket.id];
        } else {
            game.steps++;
            const mults = [1, 1.2, 1.5, 2, 2.8, 4, 6, 10, 18, 30]; // Пример
            socket.emit('mines_continue', { index: idx, mult: mults[game.steps] || 50 });
        }
    });

    // COINFLIP
    socket.on('coin_play', async (data) => {
        const amount = parseFloat(data.amount);
        if (amount < 0.5 || amount > 20) return;
        const user = await User.findById(socket.userId);
        if (data.mode === 'real') user.real_balance -= amount; else user.demo_balance -= amount;
        
        const win = Math.random() > 0.52;
        setTimeout(async () => {
            if (win) {
                const prize = amount * 1.95;
                if (data.mode === 'real') user.real_balance += prize; else user.demo_balance += prize;
                addLiveBet(user.username, 'Coin', prize);
                socket.emit('coin_result', { win: true, prize });
            } else {
                addLiveBet(user.username, 'Coin', -amount);
                socket.emit('coin_result', { win: false });
            }
            await user.save();
            socket.emit('user_data', user);
        }, 1500);
    });

    // АДМИНКА
    socket.on('admin_auth', async (code) => {
        if (code === '7788') {
            const user = await User.findById(socket.userId);
            user.isAdmin = true; await user.save();
            
            const users = await User.find().sort({regDate: -1}).limit(50);
            const withdraws = await Withdraw.find({status: 'pending'});
            const promos = await Promo.find();
            
            socket.emit('admin_ok', { users, withdraws, promos });
        } else {
            socket.emit('toast', {text: 'Пароль неверный', type: 'error'});
        }
    });

    socket.on('disconnect', () => {
        onlineCount--;
        io.emit('online_count', Math.max(0, onlineCount));
    });
});

// --- БОТ ---
bot.onText(/\/start/, (msg) => {
    const text = `🚀 Добро пожаловать в Loonx Gifts!\n\nИграй в Crash, Mines и CoinFlip в одном приложении.\n\n💎 Быстрые выплаты в TON\n🎁 Ежедневные бонусы\n📈 Прозрачные коэффициенты`;
    bot.sendMessage(msg.chat.id, text, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Начать игру", web_app: { url: process.env.WEBAPP_URL } }],
                [{ text: "📢 Наш канал", url: "https://t.me/Loonxnews" }, { text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }]
            ]
        }
    });
});

bot.onText(/\/help/, (msg) => {
    const text = `🛡 Связь с администрацией Loonx Gift:\n\n👤 Creator: @tonfrm\n📢 Channel: @Loonxnews\n🆘 Support: @LoonxGift_Support\n🐛 Bugs: @msgp2p\n\nПри обращении в поддержку указывайте ваш ID: ${msg.from.id}`;
    bot.sendMessage(msg.chat.id, text);
});

server.listen(process.env.PORT || 3000, () => console.log("Server Started"));
