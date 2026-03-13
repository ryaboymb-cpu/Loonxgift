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

mongoose.connect(MONGO_URI).then(() => console.log("DB OK")).catch(err => console.error(err));

const User = mongoose.model('User', new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    photo_url: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats_games: { type: Number, default: 0 },
    stats_wins: { type: Number, default: 0 },
    total_dep: { type: Number, default: 0 },
    processed_txs: { type: [String], default: [] },
    isAdmin: { type: Boolean, default: false }
}));

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    tgId: Number, username: String, amount: Number, address: String, status: { type: String, default: 'pending' }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: { type: String, unique: true }, reward: Number, limit: Number, uses: { type: Number, default: 0 }, claimedBy: [Number]
}));

app.use(express.static('public'));

let liveBets = [];
let onlineCount = 0;
let crashState = { status: 'waiting', multiplier: 1.0, history: [], currentBets: [], nextBets: [], timer: 8 };
let activeMines = {}; 

function addLiveBet(username, game, profit) {
    liveBets.unshift({ username, game, profit: parseFloat(profit).toFixed(2) });
    if (liveBets.length > 15) liveBets.pop();
    io.emit('live_bets_update', liveBets);
}

async function startCrashCycle() {
    crashState.status = 'waiting';
    crashState.multiplier = 1.0;
    crashState.currentBets = [...crashState.nextBets];
    crashState.nextBets = [];
    io.emit('crash_update_bets', crashState.currentBets);
    crashState.timer = 8;
    const countdown = setInterval(() => {
        crashState.timer -= 0.1;
        io.emit('crash_timer', crashState.timer.toFixed(1));
        if (crashState.timer <= 0) { clearInterval(countdown); runFlight(); }
    }, 100);
}

function runFlight() {
    crashState.status = 'flying';
    io.emit('crash_start');
    const crashPoint = Math.max(1.01, (1 / (1 - Math.random() * 0.96)).toFixed(2));
    const flight = setInterval(() => {
        crashState.multiplier += (crashState.multiplier * 0.005) + 0.01;
        io.emit('crash_tick', crashState.multiplier.toFixed(2));
        if (crashState.multiplier >= crashPoint) { clearInterval(flight); doCrash(crashPoint); }
    }, 100);
}

function doCrash(point) {
    crashState.status = 'crashed';
    crashState.history.unshift(parseFloat(point).toFixed(2));
    if (crashState.history.length > 12) crashState.history.pop();
    io.emit('crash_end', { point, history: crashState.history });
    crashState.currentBets.forEach(bet => { if (!bet.cashedOut) addLiveBet(bet.username, 'Crash', -bet.amount); });
    setTimeout(startCrashCycle, 4000);
}
startCrashCycle();

setInterval(async () => {
    if (!TON_API_KEY || !ADMIN_WALLET) return;
    try {
        const res = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${ADMIN_WALLET}&limit=10&api_key=${TON_API_KEY}`);
        const data = await res.json();
        if (data.ok) {
            for (let tx of data.result) {
                const comment = tx.in_msg.message;
                const amount = tx.in_msg.value / 1e9;
                const hash = tx.transaction_id.hash;
                if (comment && !isNaN(comment) && amount >= 0.1) {
                    const user = await User.findOne({ tgId: parseInt(comment) });
                    if (user && !user.processed_txs.includes(hash)) {
                        user.real_balance += amount;
                        user.total_dep += amount;
                        user.processed_txs.push(hash);
                        await user.save();
                        io.emit('deposit_success', { tgId: user.tgId, amount, newBalance: user.real_balance });
                    }
                }
            }
        }
    } catch (e) {}
}, 25000);

io.on('connection', async (socket) => {
    onlineCount++;
    io.emit('online_count', onlineCount);
    socket.emit('live_bets_update', liveBets);
    socket.emit('crash_init', { history: crashState.history });

    socket.on('auth', async (data) => {
        if (!data || !data.id) return;
        let uname = data.username || data.first_name || `User_${data.id}`;
        let user = await User.findOne({ tgId: data.id });
        if (!user) user = await User.create({ tgId: data.id, username: uname, photo_url: data.photo_url });
        else { user.username = uname; user.photo_url = data.photo_url; await user.save(); }
        socket.userId = user._id;
        socket.emit('user_data', user);
    });

    socket.on('crash_bet', async (data) => {
        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount < 0.1) return;
        const user = await User.findById(socket.userId);
        if (data.mode === 'real') {
            if (user.real_balance < amount) return socket.emit('toast', {text: 'Мало TON'});
            user.real_balance -= amount;
        } else {
            if (user.demo_balance < amount) return socket.emit('toast', {text: 'Мало D-TON'});
            user.demo_balance -= amount;
        }
        user.stats_games++; await user.save();
        socket.emit('user_data', user);
        const bet = { id: socket.id, username: user.username, amount, mode: data.mode, cashedOut: false };
        if (crashState.status !== 'waiting') crashState.nextBets.push(bet);
        else { crashState.currentBets.push(bet); io.emit('crash_update_bets', crashState.currentBets); }
    });

    socket.on('crash_cashout', async () => {
        if (crashState.status !== 'flying') return;
        const bet = crashState.currentBets.find(b => b.id === socket.id && !b.cashedOut);
        if (!bet) return;
        bet.cashedOut = true;
        const win = bet.amount * crashState.multiplier;
        const user = await User.findById(socket.userId);
        if (bet.mode === 'real') user.real_balance += win; else user.demo_balance += win;
        user.stats_wins++; await user.save();
        addLiveBet(user.username, 'Crash', win);
        socket.emit('user_data', user);
        io.emit('crash_update_bets', crashState.currentBets);
    });

    socket.on('mines_start', async (data) => {
        const amount = parseFloat(data.amount);
        const user = await User.findById(socket.userId);
        if (data.mode === 'real') { if(user.real_balance < amount) return; user.real_balance -= amount; }
        else { if(user.demo_balance < amount) return; user.demo_balance -= amount; }
        await user.save();
        let f = Array(25).fill('diamond');
        let b = 0;
        while(b < parseInt(data.bombs)) { let r = Math.floor(Math.random()*25); if(f[r]!=='bomb'){f[r]='bomb';b++;} }
        activeMines[socket.id] = { f, amount, mode: data.mode, s: 0 };
        socket.emit('mines_init_res');
        socket.emit('user_data', user);
    });

    socket.on('mines_step', async (i) => {
        const g = activeMines[socket.id]; if(!g) return;
        if (g.f[i] === 'bomb') {
            addLiveBet((await User.findById(socket.userId)).username, 'Mines', -g.amount);
            socket.emit('mines_die', { f: g.f }); delete activeMines[socket.id];
        } else {
            g.s++; socket.emit('mines_continue', { index: i, mult: (1.2 + g.s * 0.4).toFixed(2) });
        }
    });

    socket.on('coin_play', async (data) => {
        const amount = parseFloat(data.amount);
        const user = await User.findById(socket.userId);
        if (data.mode === 'real') user.real_balance -= amount; else user.demo_balance -= amount;
        const win = Math.random() > 0.52;
        setTimeout(async () => {
            if (win) {
                const p = amount * 1.95;
                if (data.mode === 'real') user.real_balance += p; else user.demo_balance += p;
                addLiveBet(user.username, 'Coin', p);
                socket.emit('coin_result', { win: true, prize: p });
            } else { addLiveBet(user.username, 'Coin', -amount); socket.emit('coin_result', { win: false }); }
            await user.save(); socket.emit('user_data', user);
        }, 1200);
    });

    socket.on('admin_auth', async (c) => {
        if (c === '7788') {
            const user = await User.findById(socket.userId);
            user.isAdmin = true; await user.save();
            const u = await User.find().sort({_id:-1}).limit(40);
            const w = await Withdraw.find({status:'pending'});
            const p = await Promo.find();
            socket.emit('admin_ok', { users: u, withdraws: w, promos: p });
        } else socket.emit('toast', {text: 'Wrong Code'});
    });

    socket.on('disconnect', () => { onlineCount--; io.emit('online_count', Math.max(0, onlineCount)); });
});

bot.onText(/\/start/, (m) => {
    bot.sendMessage(m.chat.id, `🚀 Добро пожаловать в Loonx Gifts!\n\nИграй в Crash, Mines и CoinFlip в одном приложении.\n\n💎 Быстрые выплаты в TON\n🎁 Ежедневные бонусы\n📈 Прозрачные коэффициенты`, {
        reply_markup: { inline_keyboard: [
            [{ text: "🎮 Начать игру", web_app: { url: process.env.WEBAPP_URL } }],
            [{ text: "📢 Наш канал", url: "https://t.me/Loonxnews" }, { text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }]
        ]}
    });
});

bot.onText(/\/help/, (m) => {
    bot.sendMessage(m.chat.id, `🛡 Связь с администрацией Loonx Gift:\n\n👤 Creator: @tonfrm\n📢 Channel: @Loonxnews\n🆘 Support: @LoonxGift_Support\n🐛 Bugs: @msgp2p\n\nПри обращении в поддержку указывайте ваш ID: ${m.from.id}`);
});

server.listen(process.env.PORT || 3000, () => console.log("Server Running"));
