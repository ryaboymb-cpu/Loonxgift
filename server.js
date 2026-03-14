require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE ---
const DB_FILE = path.join(__dirname, 'db.json');
let db = { 
    users: {}, 
    promos: {}, 
    withdraws: [], 
    stats: { totalGames: 0 },
    rtp: { crash: 85, mines: 85, coinflip: 85 } 
};

if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// --- BOT ---
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: { autoStart: true, params: { drop_pending_updates: true } } });

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🚀 *Loonx Gifts* — Твой путь к TON!`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "🎮 Начать игру", web_app: { url: process.env.WEB_APP_URL } }]]
        }
    });
});

// --- API ENDPOINTS ---

// Авторизация и получение данных
app.post('/api/auth', (req, res) => {
    const u = req.body;
    if (!u.id) return res.status(400).send();
    if (!db.users[u.id]) {
        db.users[u.id] = {
            id: u.id, name: u.first_name, username: u.username,
            balance: 0.00, demo_balance: 5000.00, history: [], photo: u.photo_url || ''
        };
        saveDB();
    }
    res.json({ user: db.users[u.id], rtp: db.rtp });
});

// Ставки
app.post('/api/bet', (req, res) => {
    const { id, game, bet, win, mode } = req.body;
    const user = db.users[id];
    const balType = mode === 'demo' ? 'demo_balance' : 'balance';

    if (!user || user[balType] < bet) return res.status(400).json({ error: "No money" });

    user[balType] = user[balType] - bet + win;
    const betData = { 
        game, bet, win, mode, 
        id: user.id, username: user.username, photo: user.photo,
        time: new Date().toLocaleTimeString() 
    };
    
    user.history.unshift(betData);
    if (user.history.length > 20) user.history.pop();
    
    db.stats.totalGames++;
    saveDB();
    
    io.emit('newBet', betData); // Лайв-лента для всех
    res.json({ balance: user.balance, demo_balance: user.demo_balance, history: user.history });
});

// Админка: Промокоды
app.post('/api/admin/promo', (req, res) => {
    const { code, amount, limit } = req.body;
    db.promos[code] = { amount, limit, uses: 0, usedBy: [] };
    saveDB();
    res.json({ success: true });
});

// Активация промо
app.post('/api/promo/activate', (req, res) => {
    const { id, code } = req.body;
    const promo = db.promos[code];
    const user = db.users[id];
    if (promo && promo.uses < promo.limit && !promo.usedBy.includes(id)) {
        user.balance += parseFloat(promo.amount);
        promo.uses++;
        promo.usedBy.push(id);
        saveDB();
        res.json({ success: true, amount: promo.amount });
    } else {
        res.status(400).json({ error: "Invalid or used" });
    }
});

// Вывод средств
app.post('/api/withdraw', (req, res) => {
    const { id, address, amount } = req.body;
    const user = db.users[id];
    if (user.balance >= amount && amount >= 5) {
        user.balance -= amount;
        db.withdraws.push({ id, address, amount, status: 'pending', time: new Date().toLocaleString() });
        saveDB();
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "Min 5 TON or low balance" });
    }
});

// --- SOCKETS (CRASH LOGIC) ---
let crashState = { multiplier: 1.0, status: 'waiting', timer: 10 };
function startCrashCycle() {
    crashState.status = 'waiting';
    crashState.timer = 10;
    const countdown = setInterval(() => {
        crashState.timer--;
        io.emit('crashUpdate', crashState);
        if (crashState.timer <= 0) {
            clearInterval(countdown);
            runCrash();
        }
    }, 1000);
}

function runCrash() {
    crashState.status = 'running';
    crashState.multiplier = 1.0;
    const rtp = db.rtp.crash / 100;
    const crashAt = Math.pow(100 / (100 - Math.random() * 100), rtp).toFixed(2);
    
    const interval = setInterval(() => {
        crashState.multiplier = (parseFloat(crashState.multiplier) + 0.01).toFixed(2);
        io.emit('crashUpdate', crashState);
        if (parseFloat(crashState.multiplier) >= crashAt) {
            clearInterval(interval);
            crashState.status = 'crashed';
            io.emit('crashUpdate', crashState);
            setTimeout(startCrashCycle, 3000);
        }
    }, 100);
}
startCrashCycle();

server.listen(process.env.PORT || 3000, () => console.log('Server UP'));
