/**
 * 👑 LOONX GIFTS - FINAL PROTECTED RELEASE V7.0
 * Монолитный код: Сервер + Бот + Идеальный UI
 * Добавлена защита админки паролем.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// --- НАСТРОЙКИ ENV ---
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "7788"; // Установи в настройках Render

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- БАЗА ДАННЫХ ---
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("💎 MongoDB Подключена"))
    .catch(err => console.error("❌ Ошибка MongoDB:", err.message));

const User = mongoose.model('User', new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    avatar: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    isBanned: { type: Boolean, default: false },
    step: { type: String, default: "" }, // Для ввода пароля/сумм
    targetId: Number // Для админ-действий
}));

const Promo = mongoose.model('Promo', { code: String, sum: Number, uses: Number });
const Withdraw = mongoose.model('Withdraw', { tgId: Number, amount: Number, wallet: String, status: String });

let globalRTP = 90;

// --- TELEGRAM BOT (Защита + Админка) ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ tgId: msg.from.id }, { username: msg.from.username }, { upsert: true });
    bot.sendMessage(msg.chat.id, `🚀 Добро пожаловать в Loonx Gifts!\n\nИграй и зарабатывай TON прямо в Telegram.`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Начать игру", web_app: { url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:10000'}` } }],
                [{ text: "📢 Канал", url: "https://t.me/Loonxnews" }, { text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }]
            ]
        }
    });
});

// Обработка ввода пароля и админ-команд
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const user = await User.findOne({ tgId: msg.from.id });
    if (!user) return;

    // Проверка пароля админа
    if (user.step === 'wait_admin_pass') {
        if (msg.text === ADMIN_PASS) {
            await User.updateOne({ tgId: msg.from.id }, { step: "" });
            sendAdminMenu(msg.chat.id);
        } else {
            bot.sendMessage(msg.chat.id, "❌ Неверный пароль. Доступ заблокирован.");
            await User.updateOne({ tgId: msg.from.id }, { step: "" });
        }
    }
});

const sendAdminMenu = async (chatId) => {
    const stats = await User.countDocuments();
    bot.sendMessage(chatId, "🛠 **ДОСТУП ПОДТВЕРЖДЕН: АДМИН-ПАНЕЛЬ**", {
        reply_markup: {
            inline_keyboard: [
                [{ text: `📊 Юзеров в базе: ${stats}`, callback_data: "adm_stats" }],
                [{ text: "🎟 Создать Промо", callback_data: "adm_promo" }, { text: `📈 RTP: ${globalRTP}%`, callback_data: "adm_rtp" }],
                [{ text: "👥 Выдать баланс юзеру", callback_data: "adm_give" }]
            ]
        }
    });
};

// --- ДВИЖОК CRASH ---
let crash = { status: 'wait', mult: 1.0, timer: 10, history: ["1.50x", "2.10x"], liveBets: [], nextRoundBets: [] };

function crashLoop() {
    crash.status = 'wait'; crash.timer = 10; crash.mult = 1.0;
    crash.liveBets = [...crash.nextRoundBets];
    crash.nextRoundBets = [];
    io.emit('update_bets', crash.liveBets);

    let t = setInterval(() => {
        crash.timer -= 0.1;
        io.emit('crash_timer', crash.timer.toFixed(1));
        if(crash.timer <= 0) { clearInterval(t); fly(); }
    }, 100);
}

function fly() {
    crash.status = 'fly';
    let limit = (Math.random() * (globalRTP / 15) + 1.01).toFixed(2);
    let f = setInterval(() => {
        crash.mult += crash.mult * 0.007 + 0.01;
        io.emit('crash_tick', crash.mult.toFixed(2));
        if(crash.mult >= limit) {
            clearInterval(f); crash.status = 'end';
            crash.history.unshift(limit + "x");
            io.emit('crash_end', { point: limit, history: crash.history.slice(0, 10) });
            setTimeout(crashLoop, 5000);
        }
    }, 100);
}
crashLoop();

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('auth', async (d) => {
        let u = await User.findOneAndUpdate({ tgId: d.id }, { username: d.username, avatar: d.photo_url }, { upsert: true, new: true });
        socket.userId = u.tgId;
        socket.emit('init', { user: u, crash });
    });

    socket.on('place_bet', (data) => {
        const bet = { user: data.username, amount: data.amount };
        if(crash.status === 'wait') {
            crash.liveBets.push(bet);
            io.emit('update_bets', crash.liveBets);
            socket.emit('bet_accepted', { msg: "Ставка принята!" });
        } else {
            crash.nextRoundBets.push(bet);
            socket.emit('bet_accepted', { msg: "Раунд идет! Поставили на следующий." });
        }
    });

    socket.on('trigger_admin', async (tgId) => {
        await User.updateOne({ tgId: tgId }, { step: "wait_admin_pass" });
        bot.sendMessage(tgId, "⚠️ ОБНАРУЖЕН ВХОД В АДМИНКУ. Введите пароль:");
    });
});

// --- UI (Embedded) ---
const UI = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <title>Loonx Gifts PRO</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js"></script>
    <style>
        :root { --accent: #007aff; --bg: #000; --card: #1c1c1e; --success: #34c759; --error: #ff3b30; --glow: 0 0 20px rgba(0, 122, 255, 0.4); }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; background: #000; color: #fff; font-family: -apple-system, sans-serif; overflow: hidden; height: 100vh; }
        #stars-canvas { position: fixed; top: 0; left: 0; z-index: -1; }
        header { padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(20, 20, 22, 0.85); backdrop-filter: blur(25px); border-bottom: 0.5px solid #333; }
        .u-avatar { width: 42px; height: 42px; border-radius: 50%; border: 2px solid var(--success); }
        .bal-ton { color: var(--success); font-weight: 900; font-size: 1.3rem; }
        .games-nav { display: flex; gap: 12px; padding: 20px; overflow-x: auto; }
        .g-btn { background: var(--card); min-width: 100px; padding: 15px; border-radius: 18px; border: 1px solid #333; text-align: center; }
        .g-btn.active { border-color: var(--accent); box-shadow: var(--glow); background: rgba(0, 122, 255, 0.1); }
        .view { padding: 0 20px; height: 48vh; display: none; }
        .view.active { display: block; }
        #crash-mult { font-size: 5rem; font-weight: 900; text-align: center; margin: 20px 0; }
        .bet-footer { position: fixed; bottom: 85px; width: 100%; padding: 20px; background: #000; }
        .btn-action { width: 100%; padding: 20px; border-radius: 20px; border: none; background: var(--accent); color: #fff; font-weight: 800; font-size: 1.2rem; }
        .hotbar { position: fixed; bottom: 0; width: 100%; height: 80px; background: #111; display: flex; justify-content: space-around; padding-top: 15px; border-top: 0.5px solid #333; }
        .nav-item { text-align: center; color: #8e8e93; font-size: 0.7rem; }
        .nav-item.active { color: var(--success); }
        .h-node { background: #2c2c2e; padding: 5px 12px; border-radius: 8px; font-size: 0.8rem; }
    </style>
</head>
<body>
    <canvas id="stars-canvas"></canvas>
    <header onclick="handleAdminTap()">
        <div style="display:flex; align-items:center; gap:10px;">
            <img src="" class="u-avatar" id="u-avatar">
            <div><b id="u-name">Player</b><br><span style="font-size:0.7rem;color:var(--success)">● Online</span></div>
        </div>
        <div style="text-align:right">
            <div class="bal-ton" id="bal-real">0.00 TON</div>
            <div style="color:#8e8e93; font-size:0.7rem;">5000 DEMO</div>
        </div>
    </header>

    <div class="games-nav">
        <div class="g-btn active" onclick="setTab('crash', this)">🚀 Crash</div>
        <div class="g-btn" onclick="setTab('mines', this)">💣 Mines</div>
        <div class="g-btn" onclick="setTab('wallet', this)">💼 Wallet</div>
    </div>

    <main>
        <div id="v-crash" class="view active">
            <div id="crash-history" style="display:flex; gap:8px; margin-bottom:20px;"></div>
            <div id="crash-label" style="text-align:center; color:var(--accent); font-weight:700;">ОЖИДАНИЕ</div>
            <h1 id="crash-mult">1.00x</h1>
            <div id="bets-list" style="background:var(--card); padding:15px; border-radius:15px; font-size:0.8rem;"></div>
        </div>
        <div id="v-mines" class="view"><div id="mine-grid" style="display:grid; grid-template-columns:repeat(5,1fr); gap:10px;"></div></div>
        <div id="v-wallet" class="view" style="text-align:center;"><div id="ton-connect-box"></div></div>
    </main>

    <div class="bet-footer">
        <input type="number" id="bet-amt" value="10" style="width:100%; background:#1c1c1e; border:1px solid #333; padding:15px; border-radius:15px; color:#fff; margin-bottom:10px;">
        <button class="btn-action" onclick="handlePlay()">ПОСТАВИТЬ</button>
    </div>

    <nav class="hotbar">
        <div class="nav-item active">🎮<span>Игры</span></div>
        <div class="nav-item">🎁<span>Промо</span></div>
        <div class="nav-item" onclick="setTab('wallet')">💼<span>Кошелек</span></div>
        <div class="nav-item">👤<span>Профиль</span></div>
    </nav>

    <script>
        const tg = window.Telegram.WebApp;
        const socket = io();
        let adminTaps = 0;

        function handleAdminTap() {
            adminTaps++;
            if(adminTaps >= 10) {
                socket.emit('trigger_admin', tg.initDataUnsafe.user?.id);
                tg.showAlert("Пароль админки запрошен в боте!");
                adminTaps = 0;
            }
        }

        // STARS
        const canvas = document.getElementById('stars-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth; canvas.height = window.innerHeight;
        let stars = Array.from({length: 100}, () => ({ x: Math.random()*canvas.width, y: Math.random()*canvas.height, size: Math.random()*2, speed: 0.4 }));
        function draw() {
            ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle="#fff";
            stars.forEach(s => { ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, 7); ctx.fill(); s.y+=s.speed; if(s.y>canvas.height) s.y=0; });
            requestAnimationFrame(draw);
        } draw();

        window.onload = () => socket.emit('auth', tg.initDataUnsafe.user || {id: 12345, username: "Player"});

        socket.on('init', d => {
            document.getElementById('u-name').innerText = d.user.username;
            document.getElementById('bal-real').innerText = d.user.real_balance.toFixed(2) + ' TON';
            document.getElementById('crash-history').innerHTML = d.crash.history.map(x => '<div class="h-node">'+x+'</div>').join('');
        });

        socket.on('crash_timer', t => { document.getElementById('crash-mult').innerText = t; document.getElementById('crash-label').innerText = "ВЗЛЕТ ЧЕРЕЗ"; });
        socket.on('crash_tick', m => { document.getElementById('crash-mult').innerText = m + 'x'; document.getElementById('crash-label').innerText = "ПОЛЕТ"; });
        socket.on('crash_end', d => {
            document.getElementById('crash-mult').innerText = d.point + 'x'; document.getElementById('crash-label').innerText = "CRASH!";
            document.getElementById('crash-history').innerHTML = d.history.map(x => '<div class="h-node">'+x+'</div>').join('');
        });

        socket.on('update_bets', b => {
            document.getElementById('bets-list').innerHTML = b.map(i => '<div style="display:flex; justify-content:space-between; margin-bottom:5px;"><span>👤 '+i.user+'</span><span>'+i.amount+' TON</span></div>').join('');
        });

        function setTab(n, el) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('v-'+n).classList.add('active');
            if(n === 'mines') {
                const g = document.getElementById('mine-grid'); g.innerHTML = '';
                for(let i=0; i<25; i++) {
                    let c = document.createElement('div'); c.style="background:#222; aspect-ratio:1; border-radius:10px;";
                    c.onclick = () => { c.innerHTML = '💎'; c.style.background = 'rgba(52,199,89,0.1)'; };
                    g.appendChild(c);
                }
            }
        }

        function handlePlay() {
            socket.emit('place_bet', { username: document.getElementById('u-name').innerText, amount: document.getElementById('bet-amt').value });
            tg.showAlert("Ставка отправлена!");
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(UI));

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`));
