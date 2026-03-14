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
// Раздаем статику из папки public (там лежат index.html и script.js)
app.use(express.static(path.join(__dirname, 'public')));

// --- БАЗА ДАННЫХ (Простая JSON-БД) ---
const DB_FILE = path.join(__dirname, 'db.json');
let db = { users: {}, stats: { totalGames: 0, globalRTP: 85 } };

if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// --- ТЕЛЕГРАМ БОТ ---
// Берем токен из .env. drop_pending_updates спасает от ошибки 409
const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: { autoStart: true, params: { drop_pending_updates: true } }
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🚀 *Добро пожаловать в Loonx Gifts!*\n\nТвоя лучшая платформа для игр и заработка TON. Нажимай кнопку ниже, чтобы войти в приложение!`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 ИГРАТЬ", web_app: { url: process.env.WEB_APP_URL || 'https://loonxgift.onrender.com' } }],
                [{ text: "📣 Канал", url: "https://t.me/Loonxnews" }, { text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }]
            ]
        }
    });
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `❓ *Нужна помощь?*\n\nЕсли у тебя баг или не пришел депозит, пиши в поддержку.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "🆘 Написать саппорту", url: "https://t.me/LoonxGift_Support" }]] }
    });
});

// --- API ДЛЯ WEB APP ---
// Авторизация
app.post('/api/auth', (req, res) => {
    const user = req.body;
    if (!user || !user.id) return res.status(400).json({ error: "Bad request" });

    if (!db.users[user.id]) {
        db.users[user.id] = {
            id: user.id,
            name: user.first_name || "Player",
            username: user.username || "User_" + user.id,
            balance: 100.00, // Стартовый баланс для тестов
            history: []
        };
        saveDB();
    }
    res.json(db.users[user.id]);
});

// Обработка ставок
app.post('/api/bet', (req, res) => {
    const { id, game, bet, winAmount } = req.body;
    const user = db.users[id];
    
    if (!user || user.balance < bet) return res.status(400).json({ error: "Insufficient funds" });

    // Снимаем ставку, начисляем выигрыш
    user.balance = user.balance - bet + winAmount;
    
    const isWin = winAmount > bet;
    user.history.unshift({
        game, bet, winAmount, isWin, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    });
    
    if (user.history.length > 25) user.history.pop();
    saveDB();

    io.emit('liveFeed', { username: user.username, game, amount: winAmount });
    res.json({ balance: user.balance, history: user.history });
});

// --- SOCKET.IO ---
let onlineUsers = 0;
io.on('connection', (socket) => {
    onlineUsers++;
    io.emit('onlineUpdate', onlineUsers);
    
    socket.on('disconnect', () => {
        onlineUsers--;
        io.emit('onlineUpdate', onlineUsers);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер Loonx запущен на порту ${PORT}`));
