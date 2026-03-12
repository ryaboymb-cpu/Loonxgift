const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// --- ИНИЦИАЛИЗАЦИЯ БОТА ИЗ ENV ---
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("ОШИБКА: BOT_TOKEN не найден в переменых окружения (env)!");
}
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const PORT = process.env.PORT || 3000;

// Глобальные настройки шансов
let settings = {
    crash: 95,
    mines: 90,
    coin: 35 // Твой шанс 35%
};

let users = {}; 
let history = [];
let adminSocketId = null;

app.use(express.static(path.join(__dirname, 'public')));

// --- ТЕЛЕГРАМ БОТ ---
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `Привет, ${msg.from.first_name}! Это Loonx Gift 🎁`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "💎 Запустить Игры", web_app: { url: "https://loonxgift.onrender.com" } }],
                [{ text: "📢 Канал", url: "https://t.me/Loonxnews" }]
            ]
        }
    });
});

// --- ЛОГИКА CRASH (РАКЕТА) ---
let crashState = { status: 'waiting', mult: 1.00, timer: 10, crashAt: 0 };

function startCrashLoop() {
    if (crashState.status === 'waiting') {
        if (crashState.timer > 0) {
            crashState.timer--;
        } else {
            crashState.status = 'flying';
            crashState.mult = 1.00;
            // Учет RTP
            const rnd = Math.random();
            crashState.crashAt = rnd < 0.03 ? 1.00 : (0.96 / (1 - Math.random())).toFixed(2);
        }
    } else if (crashState.status === 'flying') {
        crashState.mult += 0.01 * (crashState.mult / 1.5);
        if (crashState.mult >= crashState.crashAt) {
            crashState.status = 'crashed';
            setTimeout(() => {
                crashState.status = 'waiting';
                crashState.timer = 10;
            }, 4000);
        }
    }
    io.emit('crash_update', crashState);
}
setInterval(startCrashLoop, 100);

// --- SOCKETS ---
io.on('connection', (socket) => {
    socket.on('init_user', (data) => {
        if (!users[data.id]) {
            users[data.id] = {
                id: data.id, tgName: data.username || 'User', photoUrl: data.photo || '',
                realBal: 0, demoBal: 500, games: 0, wins: 0
            };
        }
        socket.userId = data.id;
        socket.emit('user_data', users[data.id]);
        socket.emit('history_update', history);
    });

    // COINFLIP L/X (Шанс 35%)
    socket.on('coinflip_play', (data) => {
        const user = users[socket.userId];
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (user[balKey] < data.bet) return socket.emit('alert', {msg: 'Недостаточно средств'});

        user[balKey] -= data.bet;
        user.games++;
        
        const winChance = settings.coin / 100;
        const isWin = Math.random() < winChance;
        const resultSide = isWin ? data.side : (data.side === 'L' ? 'X' : 'L');
        let winAmount = isWin ? data.bet * 1.9 : 0;

        if (isWin) { user[balKey] += winAmount; user.wins++; }

        addHistory({ tgName: user.tgName, photoUrl: user.photoUrl, game: 'Coinflip', bet: data.bet, win: winAmount, isWin });
        socket.emit('user_data', user);
        socket.emit('coinflip_result', { win: isWin, resultSide, winAmount });
    });

    // MINES (Заниженные иксы)
    socket.on('mines_start', (data) => {
        const user = users[socket.userId];
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (user[balKey] < data.bet) return;

        user[balKey] -= data.bet;
        let field = Array(25).fill('safe');
        let mCount = 0;
        while(mCount < data.minesCount) {
            let r = Math.floor(Math.random() * 25);
            if(field[r] === 'safe') { field[r] = 'mine'; mCount++; }
        }

        socket.activeMine = { bet: data.bet, field, opened: 0, mCount: data.minesCount, balKey, mult: 1.00 };
        socket.emit('user_data', user);
        socket.emit('mines_started');
    });

    socket.on('mines_open', (idx) => {
        const g = socket.activeMine;
        if (!g || g.field[idx] === 'opened') return;

        if (g.field[idx] === 'mine') {
            socket.emit('mines_boom', g.field);
            delete socket.activeMine;
        } else {
            g.opened++;
            g.field[idx] = 'opened';
            // Заниженная прогрессия множителя
            g.mult = (g.mult * (1 + (g.mCount / 28))).toFixed(2);
            socket.emit('mines_safe', { idx, mult: g.mult });
        }
    });

    socket.on('mines_cashout', () => {
        const g = socket.activeMine;
        if(g && g.opened > 0) {
            const user = users[socket.userId];
            const win = g.bet * g.mult;
            user[g.balKey] += win;
            user.wins++;
            addHistory({ tgName: user.tgName, photoUrl: user.photoUrl, game: 'Mines', bet: g.bet, win, isWin: true });
            socket.emit('user_data', user);
            socket.emit('mines_win');
            delete socket.activeMine;
        }
    });

    // CRASH (Ставка/Вывод)
    socket.on('crash_bet', (data) => {
        const user = users[socket.userId];
        const balKey = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (user[balKey] >= data.bet && crashState.status === 'waiting') {
            user[balKey] -= data.bet;
            socket.crashBet = { bet: data.bet, balKey };
            socket.emit('user_data', user);
        }
    });

    socket.on('crash_cashout', () => {
        if (socket.crashBet && crashState.status === 'flying') {
            const user = users[socket.userId];
            const win = socket.crashBet.bet * crashState.mult;
            user[socket.crashBet.balKey] += win;
            user.wins++;
            addHistory({ tgName: user.tgName, photoUrl: user.photoUrl, game: 'Crash', bet: socket.crashBet.bet, win, isWin: true });
            socket.emit('user_data', user);
            delete socket.crashBet;
            socket.emit('alert', { msg: `Выплата: ${win.toFixed(2)} TON` });
        }
    });

    // АДМИНКА
    socket.on('admin_login', (p) => {
        if (p === '7788') {
            adminSocketId = socket.id;
            socket.emit('admin_data', { settings });
        }
    });

    socket.on('admin_action', (d) => {
        if (socket.id !== adminSocketId) return;
        if (d.action === 'save_rtp') {
            settings.coin = parseFloat(d.coin);
            settings.crash = parseFloat(d.crash);
            settings.mines = parseFloat(d.mines);
        }
    });

    socket.on('get_demo', () => {
        if (users[socket.userId]) {
            users[socket.userId].demoBal += 500;
            socket.emit('user_data', users[socket.userId]);
        }
    });
});

function addHistory(d) {
    history.unshift(d);
    if (history.length > 20) history.pop();
    io.emit('history_update', history);
}

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
