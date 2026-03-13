require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout: 5000 
});

const {
    BOT_TOKEN: TOKEN,
    MONGO_URI,
    TON_API_KEY,
    ADMIN_WALLET,
    WEBAPP_URL,
    PORT = 3000
} = process.env;

// ==========================================
// 1. TELEGRAM BOT (С фиксом 409 и командами)
// ==========================================
let bot;
if (TOKEN) {
    bot = new TelegramBot(TOKEN, { polling: true });
    
    // Щит от падения сервера
    bot.on('polling_error', (err) => {
        if (!err.message.includes('409')) console.log("Bot Polling Error:", err.message);
    });

    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, `🚀 *Добро пожаловать в Loonx Gifts!* \n\nСамый быстрый софт для игры на TON.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: "🎮 Играть сейчас", web_app: { url: WEBAPP_URL } }]] }
        });
    });

    bot.onText(/\/help/, (msg) => {
        bot.sendMessage(msg.chat.id, `🛡 *Поддержка и контакты:*\n\n👤 Creator: @tonfrm\n📢 Channel: @Loonxnews\n🆘 Support: @LoonxGift_Support`, { parse_mode: 'Markdown' });
    });
}

// ==========================================
// 2. DATABASE MODELS
// ==========================================
mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connected")).catch(e => console.log("❌ DB Error:", e));

const userSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    photo_url: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    stats_games: { type: Number, default: 0 },
    stats_wins: { type: Number, default: 0 },
    processed_txs: { type: [String], default: [] },
    isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    tgId: Number, username: String, amount: Number, address: String, status: { type: String, default: 'pending' }, date: { type: Date, default: Date.now }
}));

app.use(express.static('public'));

// ==========================================
// 3. GAME STATE & LOGIC
// ==========================================
let liveBets = [];
let onlineCount = 0;
let crashState = { status: 'waiting', multiplier: 1.0, history: [], currentBets: [], nextBets: [], timer: 8 };
let activeMines = new Map(); // Храним сессии Mines

function addLiveBet(username, game, profit) {
    liveBets.unshift({ username, game, profit: parseFloat(profit).toFixed(2), time: new Date().toLocaleTimeString() });
    if (liveBets.length > 20) liveBets.pop();
    io.emit('live_bets_update', liveBets);
}

// --- CRASH SYSTEM ---
function startCrashCycle() {
    crashState.status = 'waiting';
    crashState.multiplier = 1.0;
    crashState.currentBets = [...crashState.nextBets];
    crashState.nextBets = [];
    io.emit('crash_update_bets', crashState.currentBets);
    
    crashState.timer = 8.0;
    const interval = setInterval(() => {
        crashState.timer -= 0.1;
        io.emit('crash_timer', crashState.timer.toFixed(1));
        if (crashState.timer <= 0) { clearInterval(interval); runFlight(); }
    }, 100);
}

function runFlight() {
    crashState.status = 'flying';
    io.emit('crash_start');
    const point = Math.max(1.01, (1 / (1 - Math.random() * 0.96)).toFixed(2));
    
    const flight = setInterval(() => {
        // Формула роста: мн-ль увеличивается экспоненциально
        crashState.multiplier += (crashState.multiplier * 0.007) + 0.01;
        io.emit('crash_tick', crashState.multiplier.toFixed(2));
        
        if (crashState.multiplier >= point) {
            clearInterval(flight);
            doCrash(point);
        }
    }, 100);
}

function doCrash(p) {
    crashState.status = 'crashed';
    crashState.history.unshift(p);
    if (crashState.history.length > 15) crashState.history.pop();
    io.emit('crash_end', { point: p, history: crashState.history });
    
    crashState.currentBets.forEach(b => {
        if (!b.cashedOut) addLiveBet(b.username, 'Crash', -b.amount);
    });
    setTimeout(startCrashCycle, 4000);
}
startCrashCycle();

// ==========================================
// 4. TON DEPOSIT MONITOR (HTTPS)
// ==========================================
setInterval(() => {
    if (!TON_API_KEY || !ADMIN_WALLET) return;
    const url = `https://toncenter.com/api/v2/getTransactions?address=${ADMIN_WALLET}&limit=10&api_key=${TON_API_KEY}`;
    
    https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
            try {
                const json = JSON.parse(data);
                if (json.ok) {
                    for (let tx of json.result) {
                        const hash = tx.transaction_id.hash;
                        const msg = tx.in_msg.message;
                        const val = tx.in_msg.value / 1e9;
                        if (msg && !isNaN(msg)) {
                            const user = await User.findOne({ tgId: parseInt(msg) });
                            if (user && !user.processed_txs.includes(hash)) {
                                user.real_balance += val;
                                user.processed_txs.push(hash);
                                await user.save();
                                io.to(`user_${user.tgId}`).emit('user_data', user);
                                io.to(`user_${user.tgId}`).emit('notify', { text: `✅ Депозит ${val} TON зачислен!` });
                            }
                        }
                    }
                }
            } catch (e) {}
        });
    }).on('error', () => {});
}, 20000);

// ==========================================
// 5. SOCKET CONNECTIONS (The Heart)
// ==========================================
io.on('connection', (socket) => {
    onlineCount++;
    io.emit('online_count', onlineCount);
    socket.emit('live_bets_update', liveBets);
    socket.emit('crash_init', { history: crashState.history });

    // Авторизация (Ключ к лоадеру)
    socket.on('auth', async (data) => {
        if (!data || !data.id) return;
        let user = await User.findOne({ tgId: data.id });
        if (!user) {
            user = await User.create({ 
                tgId: data.id, 
                username: data.username || `User_${data.id}`,
                photo_url: data.photo_url || ''
            });
        }
        socket.userId = user._id;
        socket.tgId = user.tgId;
        socket.join(`user_${user.tgId}`);
        socket.emit('user_data', user); // Это событие убирает лоадер на фронте
    });

    // --- CRASH ACTIONS ---
    socket.on('crash_bet', async (d) => {
        const user = await User.findById(socket.userId);
        if (!user) return;
        const amt = parseFloat(d.amount);
        const bal = d.mode === 'real' ? user.real_balance : user.demo_balance;
        
        if (bal < amt || amt <= 0) return socket.emit('notify', { text: 'Недостаточно средств!' });

        if (d.mode === 'real') user.real_balance -= amt; else user.demo_balance -= amt;
        user.stats_games += 1;
        await user.save();
        
        socket.emit('user_data', user);
        const bet = { id: socket.id, username: user.username, amount: amt, mode: d.mode, cashedOut: false };
        
        if (crashState.status !== 'waiting') {
            crashState.nextBets.push(bet);
        } else {
            crashState.currentBets.push(bet);
            io.emit('crash_update_bets', crashState.currentBets);
        }
    });

    socket.on('crash_cashout', async () => {
        if (crashState.status !== 'flying') return;
        const b = crashState.currentBets.find(x => x.id === socket.id && !x.cashedOut);
        if (!b) return;

        b.cashedOut = true;
        const win = b.amount * crashState.multiplier;
        const user = await User.findById(socket.userId);
        
        if (b.mode === 'real') user.real_balance += win; else user.demo_balance += win;
        user.stats_wins += 1;
        await user.save();
        
        addLiveBet(user.username, 'Crash', win);
        socket.emit('user_data', user);
        io.emit('crash_update_bets', crashState.currentBets);
        socket.emit('notify', { text: `Выигрыш: ${win.toFixed(2)}`, type: 'success' });
    });

    // --- MINES ACTIONS ---
    socket.on('mines_start', async (d) => {
        const user = await User.findById(socket.userId);
        if (!user || activeMines.has(socket.id)) return;
        
        const amt = parseFloat(d.amount);
        const minesCount = parseInt(d.mines);
        const bal = d.mode === 'real' ? user.real_balance : user.demo_balance;
        
        if (bal < amt || minesCount < 1 || minesCount > 24) return;

        if (d.mode === 'real') user.real_balance -= amt; else user.demo_balance -= amt;
        await user.save();

        // Генерируем поле
        let grid = Array(25).fill('diamond');
        let placed = 0;
        while(placed < minesCount) {
            let idx = Math.floor(Math.random() * 25);
            if(grid[idx] !== 'mine') { grid[idx] = 'mine'; placed++; }
        }

        activeMines.set(socket.id, { amt, minesCount, grid, opened: [], mode: d.mode });
        socket.emit('user_data', user);
        socket.emit('mines_started');
    });

    socket.on('mines_open', async (idx) => {
        const game = activeMines.get(socket.id);
        if (!game || game.opened.includes(idx)) return;

        if (game.grid[idx] === 'mine') {
            socket.emit('mines_lost', { grid: game.grid });
            addLiveBet((await User.findById(socket.userId)).username, 'Mines', -game.amt);
            activeMines.delete(socket.id);
        } else {
            game.opened.push(idx);
            socket.emit('mines_hit', { idx, openedCount: game.opened.length });
        }
    });

    socket.on('mines_cashout', async () => {
        const game = activeMines.get(socket.id);
        if (!game || game.opened.length === 0) return;

        // Расчет коэффициента (примерный)
        const coef = 1.2 * game.opened.length; // Тут должна быть твоя формула
        const win = game.amt * coef;
        
        const user = await User.findById(socket.userId);
        if (game.mode === 'real') user.real_balance += win; else user.demo_balance += win;
        await user.save();
        
        addLiveBet(user.username, 'Mines', win);
        socket.emit('user_data', user);
        socket.emit('mines_won', { win, grid: game.grid });
        activeMines.delete(socket.id);
    });

    // --- ADMIN ---
    socket.on('admin_auth', async (code) => {
        if (code === '7788') {
            const users = await User.find().sort({_id: -1}).limit(100);
            socket.emit('admin_ok', { users });
        }
    });

    socket.on('disconnect', () => {
        onlineCount--;
        activeMines.delete(socket.id);
        io.emit('online_count', onlineCount);
    });
});

server.listen(PORT, () => console.log(`🚀 Loonx Server started on port ${PORT}`));
