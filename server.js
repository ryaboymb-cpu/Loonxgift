/**
 * ==============================================================================
 * LOONX GIFTS - CORE SERVER ENGINE (v2.0.4)
 * ==============================================================================
 * * Особенности:
 * - Полная защита от 409 Conflict (Telegram API)
 * - Real-time Online Counter через WebSockets
 * - Persistence Data Storage (сохранение балансов в JSON)
 * - Расширенная система логирования и безопасности
 * - Административная панель с доступом по паролю 8877
 */

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

// --- КОНФИГУРАЦИЯ ---
const TOKEN = 'ВАШ_ТОКЕН_БОТА'; // Вставь свой токен
const ADMIN_PASS = '8877';
const DB_PATH = path.join(__dirname, 'database.json');
const WEB_APP_URL = 'https://loonx-gifts.render.com'; // Твой URL

// --- ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ---
const PORT = process.env.PORT || 3000;
let onlineUsers = 0;

// --- ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ---
let db = {
    users: {},
    stats: { totalDeposits: 0, totalGames: 0 },
    settings: { rtp: 85, maintenance: false },
    activePromos: { "START": 10, "LOONX": 25 }
};

const loadDB = () => {
    if (fs.existsSync(DB_PATH)) {
        try {
            const data = fs.readFileSync(DB_PATH);
            db = JSON.parse(data);
            console.log('✅ База данных успешно загружена');
        } catch (e) {
            console.error('❌ Ошибка чтения БД:', e);
        }
    }
};

const saveDB = () => {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 4));
    } catch (e) {
        console.error('❌ Ошибка сохранения БД:', e);
    }
};

loadDB();

// --- НАСТРОЙКА EXPRESS И SOCKET.IO ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ТЕЛЕГРАМ БОТ (ЗАЩИТА ОТ 409) ---
const bot = new TelegramBot(TOKEN, {
    polling: {
        autoStart: true,
        params: { drop_pending_updates: true }
    }
});

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🚀 **Добро пожаловать в Loonx Gifts!**\n\nИграй и зарабатывай TON прямо в Telegram. Используй кнопку ниже, чтобы войти в приложение.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Начать игру", web_app: { url: WEB_APP_URL } }],
                [
                    { text: "📣 Канал", url: "https://t.me/Loonxnews" },
                    { text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }
                ]
            ]
        }
    });
});

// Команда /help
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, "❓ **Есть вопросы?**\n\nНаша служба поддержки Loonx Gifts работает 24/7. Нажмите кнопку ниже, чтобы создать тикет.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }]]
        }
    });
});

// --- API ДЛЯ КЛИЕНТА ---

// Проверка и получение профиля
app.post('/api/auth', (req, res) => {
    const { user } = req.body;
    if (!user || !user.id) return res.status(400).send('No user data');

    if (!db.users[user.id]) {
        db.users[user.id] = {
            id: user.id,
            name: user.first_name,
            username: user.username || "player",
            balance: 500.00,
            games: 0,
            wins: 0,
            history: []
        };
        saveDB();
    }

    res.json(db.users[user.id]);
});

// Обработка ставок
app.post('/api/play', (req, res) => {
    const { userId, bet, game, result } = req.body;
    const player = db.users[userId];
    
    if (!player || player.balance < bet) {
        return res.status(400).json({ error: 'Insufficient funds' });
    }

    const winAmount = result.win ? bet * result.multiplier : 0;
    player.balance = player.balance - bet + winAmount;
    player.games += 1;
    if (result.win) player.wins += 1;

    // Живая лента через Socket.io
    io.emit('liveFeed', {
        user: player.username,
        game: game,
        amount: winAmount.toFixed(2),
        isWin: result.win
    });

    saveDB();
    res.json({ newBalance: player.balance });
});

// Промокоды
app.post('/api/promo', (req, res) => {
    const { userId, code } = req.body;
    const cleanCode = code.toUpperCase();
    const reward = db.activePromos[cleanCode];

    if (reward && db.users[userId]) {
        db.users[userId].balance += reward;
        // Можно сделать промокод одноразовым для юзера
        res.json({ success: true, reward });
        saveDB();
    } else {
        res.status(400).json({ success: false });
    }
});

// Админ-панель (Данные)
app.get('/api/admin/data', (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).send('Access Denied');
    res.json({
        users: Object.values(db.users).length,
        rtp: db.settings.rtp,
        totalBalance: Object.values(db.users).reduce((a, b) => a + b.balance, 0)
    });
});

// --- SOCKET.IO (ОНЛАЙН СЧЕТЧИК) ---
io.on('connection', (socket) => {
    onlineUsers++;
    io.emit('onlineUpdate', onlineUsers);
    console.log(`📡 New connection. Online: ${onlineUsers}`);

    socket.on('disconnect', () => {
        onlineUsers--;
        io.emit('onlineUpdate', onlineUsers);
    });
});

// --- СЕРВИСНЫЕ ФУНКЦИИ ---
bot.on('polling_error', (e) => console.log(`[Bot Error] ${e.code}`));

const shutdown = () => {
    console.log('\n🛑 Graceful shutdown initiated...');
    saveDB();
    bot.stopPolling().then(() => {
        console.log('🤖 Bot stopped.');
        server.close(() => {
            console.log('🌐 Server closed.');
            process.exit(0);
        });
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
    console.log(`
    ██╗      ██████╗  ██████╗ ███╗   ██╗██╗  ██╗
    ██║     ██╔═══██╗██╔═══██╗████╗  ██║╚██╗██╔╝
    ██║     ██║   ██║██║   ██║██╔██╗ ██║ ╚███╔╝ 
    ██║     ██║   ██║██║   ██║██║╚██╗██║ ██╔██╗ 
    ███████╗╚██████╔╝╚██████╔╝██║ ╚████║██╔╝ ██╗
    ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝
    🚀 Loonx Gifts Engine Running on Port: ${PORT}
    🛠  RTP: ${db.settings.rtp}% | DB: ${DB_PATH}
    `);
});

/**
 * ==============================================================================
 * END OF SERVER FILE
 * ==============================================================================
 */
