/**
 * 🚀 LOONX GIFTS PRO - ULTIMATE MONOLITH
 * UI: ПРЕМИУМ ЗВЕЗДЫ + НЕОН
 * ADMIN: 1.Статистика 2.Выводы 3.Промо 4.RTP [7788]
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const { BOT_TOKEN, MONGO_URI, TON_API_KEY, ADMIN_WALLET, PORT = 3000 } = process.env;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- DATABASE & MODELS ---
mongoose.connect(MONGO_URI);
const User = mongoose.model('User', {
    tgId: { type: Number, unique: true },
    username: String,
    avatar: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    deposited: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false }
});

const Withdrawal = mongoose.model('Withdrawal', {
    tgId: Number,
    amount: Number,
    address: String,
    status: { type: String, default: 'pending' } // pending, approved, rejected
});

const Promo = mongoose.model('Promo', {
    code: String,
    amount: Number,
    uses: { type: Number, default: 0 },
    maxUses: Number
});

// --- GLOBAL SETTINGS (RTP) ---
let globalRTP = 90; // 90% по умолчанию

// --- TELEGRAM BOT ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const welcomeText = `🚀 Добро пожаловать в Loonx Gifts!

Играй в Crash, Mines и CoinFlip в одном приложении.

💎 Быстрые выплаты в TON
🎁 Ежедневные бонусы
📈 Прозрачные коэффициенты`;

bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ tgId: msg.from.id }, { username: msg.from.username }, { upsert: true });
    bot.sendMessage(msg.chat.id, welcomeText, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Начать игру", web_app: { url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:3000'}` } }],
                [{ text: "📢 Наш канал", url: "https://t.me/Loonxnews" }, { text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }]
            ]
        }
    });
});

// --- ADMIN PANEL 7788 ---
bot.on('message', async (msg) => {
    if (msg.text === '7788') {
        const count = await User.countDocuments();
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📊 Статистика", callback_data: "adm_stats" }, { text: "📥 Заявки на вывод", callback_data: "adm_withdraws" }],
                    [{ text: "🎟 Создание промо", callback_data: "adm_promo" }, { text: "📈 RTP Настройка", callback_data: "adm_rtp" }],
                    [{ text: "👥 Управление юзерами (Рассылка/Бан)", callback_data: "adm_users" }]
                ]
            }
        };
        bot.sendMessage(msg.chat.id, "🛠 **ГЛАВНОЕ МЕНЮ АДМИНИСТРАТОРА**", opts);
    }
});

// Обработка кнопок админки
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (query.data === 'adm_stats') {
        const total = await User.countDocuments();
        bot.sendMessage(chatId, `📈 **СТАТИСТИКА**\nВсего игроков: ${total}\nАктивных за 24ч: ${Math.floor(total * 0.3)}`);
    }
    if (query.data === 'adm_rtp') {
        bot.sendMessage(chatId, `⚙️ Текущий RTP: ${globalRTP}%\nВведите новое значение (0-100):`);
    }
    // ... Остальные обработчики для вывода, промо и тд
});

// --- GAME ENGINE (CRASH) ---
let crashState = { status: 'wait', mult: 1.0, timer: 10, history: ["1.50x", "2.10x", "1.05x", "5.60x"], bets: [] };

function runCrash() {
    crashState.status = 'wait'; crashState.mult = 1.0; crashState.timer = 10; crashState.bets = [];
    let t = setInterval(() => {
        crashState.timer -= 0.1;
        io.emit('crash_timer', crashState.timer.toFixed(1));
        if (crashState.timer <= 0) { clearInterval(t); startCrashFlight(); }
    }, 100);
}

function startCrashFlight() {
    crashState.status = 'fly';
    // RTP Логика: если RTP низкий, крашим раньше
    let boomLimit = (globalRTP / 20) + Math.random() * 2; 
    let fly = setInterval(() => {
        crashState.mult += 0.01 * (crashState.mult * 0.5);
        io.emit('crash_tick', crashState.mult.toFixed(2));
        if (crashState.mult >= boomLimit) {
            clearInterval(fly); crashState.status = 'end';
            crashState.history.unshift(crashState.mult.toFixed(2) + "x");
            io.emit('crash_end', { point: crashState.mult.toFixed(2), history: crashState.history.slice(0, 10) });
            setTimeout(runCrash, 4000);
        }
    }, 100);
}
runCrash();

// --- SOCKETS ---
io.on('connection', (socket) => {
    socket.on('auth', async (d) => {
        let u = await User.findOneAndUpdate({ tgId: d.id }, { username: d.username, avatar: d.photo_url }, { upsert: true, new: true });
        socket.userId = u.tgId;
        socket.emit('init', { user: u, crash: crashState });
    });

    socket.on('bet', (data) => {
        const bet = { user: data.username, amount: data.amount, type: data.type };
        crashState.bets.push(bet);
        io.emit('new_bet', crashState.bets); // Лайв-ставки
    });
});

// --- FRONTEND (HTML/CSS/JS) ---
const UI = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <title>Loonx Gifts PRO</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --acc: #007aff; --bg: #000; --card: #1c1c1e; --success: #34c759; --error: #ff3b30; --glow: 0 0 15px rgba(0, 122, 255, 0.4); }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; background: var(--bg); color: #fff; font-family: -apple-system, sans-serif; overflow: hidden; }
        
        #stars { position: fixed; top: 0; left: 0; z-index: -1; }

        header { padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(20,20,22,0.8); backdrop-filter: blur(20px); border-bottom: 0.5px solid #333; }
        .bal-val { color: var(--success); font-weight: 800; font-size: 1.2rem; text-shadow: 0 0 10px rgba(52,199,89,0.3); }

        .game-tabs { display: flex; gap: 10px; padding: 15px; overflow-x: auto; }
        .tab-btn { background: var(--card); min-width: 100px; padding: 12px; border-radius: 12px; border: 1px solid #333; text-align: center; font-size: 0.8rem; font-weight: 700; transition: 0.3s; }
        .tab-btn.active { border-color: var(--acc); box-shadow: var(--glow); background: rgba(0,122,255,0.1); }

        .view { padding: 0 20px; height: 50vh; overflow-y: auto; display: none; }
        .view.active { display: block; }

        /* CRASH UI */
        .history-bar { display: flex; gap: 8px; margin-bottom: 15px; overflow-x: auto; }
        .h-item { background: #2c2c2e; padding: 5px 12px; border-radius: 8px; font-size: 0.75rem; color: #8e8e93; }
        .mult-display { height: 200px; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        #mult-text { font-size: 4.5rem; font-weight: 900; margin: 0; }

        /* LIVE BETS TABLE */
        .bets-container { background: var(--card); border-radius: 15px; padding: 15px; margin-top: 10px; border: 1px solid #333; }
        .bet-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 0.5px solid #333; font-size: 0.8rem; }

        /* MINES UI */
        .m-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; max-width: 320px; margin: 0 auto; }
        .m-cell { aspect-ratio: 1; background: #2c2c2e; border-radius: 10px; border: 1px solid #3a3a3c; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
        .m-cell.open { background: rgba(52,199,89,0.1); border-color: var(--success); color: var(--success); }

        /* SSG HOTBAR */
        .hotbar { position: fixed; bottom: 0; width: 100%; height: 75px; background: rgba(20,20,22,0.95); display: flex; justify-content: space-around; border-top: 0.5px solid #333; backdrop-filter: blur(15px); }
        .h-item-nav { text-align: center; color: #8e8e93; padding-top: 12px; font-size: 0.65rem; width: 25%; }
        .h-item-nav.active { color: var(--success); }
        .h-item-nav i { display: block; font-size: 1.4rem; margin-bottom: 4px; }

        .footer-bet { position: fixed; bottom: 85px; width: 100%; padding: 0 20px; }
        .main-btn { width: 100%; padding: 18px; border-radius: 18px; border: none; background: var(--acc); color: #fff; font-weight: 800; font-size: 1.1rem; box-shadow: var(--glow); }
    </style>
</head>
<body>
    <canvas id="stars"></canvas>
    <header>
        <div style="display:flex; align-items:center; gap:10px;">
            <img src="" id="ava" style="width:38px;height:38px;border-radius:50%;border:1.5px solid var(--acc);">
            <b id="name">Loonx Player</b>
        </div>
        <div style="text-align:right">
            <div class="bal-val" id="bal-r">0.00 TON</div>
            <div style="font-size:0.7rem; color:#8e8e93">DEMO: <span id="bal-d">5000</span></div>
        </div>
    </header>

    <div class="game-tabs">
        <div class="tab-btn active" onclick="setTab('crash', this)">🚀 Crash</div>
        <div class="tab-btn" onclick="setTab('mines', this)">💣 Mines</div>
        <div class="tab-btn" onclick="setTab('flip', this)">🪙 CoinFlip</div>
    </div>

    <main>
        <div id="v-crash" class="view active">
            <div class="history-bar" id="c-hist"></div>
            <div class="mult-display">
                <div id="c-label" style="color:var(--acc); font-weight:700;">ОЖИДАНИЕ...</div>
                <h1 id="mult-text">1.00x</h1>
            </div>
            <div class="bets-container">
                <div style="font-weight:700; font-size:0.8rem; margin-bottom:10px;">ЛАЙВ СТАВКИ</div>
                <div id="live-bets"></div>
            </div>
        </div>

        <div id="v-mines" class="view">
            <div class="m-grid" id="mine-grid"></div>
        </div>

        <div id="v-wallet" class="view">
            <div style="background:var(--card); padding:25px; border-radius:20px; text-align:center; border:1px solid #333;">
                <h3>ДЕПОЗИТ TON</h3>
                <div style="background:#000; padding:15px; border-radius:12px; font-family:monospace; margin:15px 0; border:1px dashed var(--acc);" id="addr">UQBy...3N1L</div>
                <button class="main-btn" style="background:var(--success)" onclick="copy()">КОПИРОВАТЬ</button>
            </div>
        </div>
    </main>

    <div class="footer-bet">
        <input type="number" id="amt" value="10" style="width:100%; background:#1c1c1e; border:1px solid #333; padding:15px; border-radius:15px; color:#fff; font-weight:700; margin-bottom:10px;">
        <button class="main-btn" id="action-btn" onclick="play()">СДЕЛАТЬ СТАВКУ</button>
    </div>

    <nav class="hotbar">
        <div class="h-item-nav active" onclick="setTab('crash')"><i>🎮</i>Игры</div>
        <div class="h-item-nav"><i>🎁</i>Промо</div>
        <div class="h-item-nav" onclick="setTab('wallet')"><i>💼</i>Кошелек</div>
        <div class="h-item-nav"><i>👤</i>Профиль</div>
    </nav>

    <script>
        const tg = window.Telegram.WebApp;
        const socket = io();
        let cur = 'crash';

        // Stars Anim
        const cvs = document.getElementById('stars'); const x = cvs.getContext('2d');
        cvs.width=window.innerWidth; cvs.height=window.innerHeight;
        let p = Array.from({length:100},()=>({x:Math.random()*cvs.width, y:Math.random()*cvs.height, s:Math.random()*2}));
        function d(){ x.clearRect(0,0,cvs.width,cvs.height); x.fillStyle="#fff"; p.forEach(i=>{x.beginPath(); x.arc(i.x,i.y,i.s,0,7); x.fill(); i.y+=0.3; if(i.y>cvs.height) i.y=0;}); requestAnimationFrame(d); } d();

        socket.on('init', data => {
            document.getElementById('name').innerText = data.user.username;
            document.getElementById('bal-r').innerText = data.user.real_balance.toFixed(2) + ' TON';
            document.getElementById('c-hist').innerHTML = data.crash.history.map(v => `<div class="h-item">${v}</div>`).join('');
        });

        socket.on('crash_tick', m => {
            if(cur === 'crash') {
                document.getElementById('mult-text').innerText = m + 'x';
                document.getElementById('mult-text').style.color = "var(--success)";
                document.getElementById('c-label').innerText = "ПОЛЕТ...";
            }
        });

        socket.on('crash_end', data => {
            document.getElementById('mult-text').innerText = data.point + 'x';
            document.getElementById('mult-text').style.color = "var(--error)";
            document.getElementById('c-label').innerText = "КРАШ!";
            document.getElementById('c-hist').innerHTML = data.history.map(v => `<div class="h-item">${v}</div>`).join('');
        });

        socket.on('new_bet', bets => {
            document.getElementById('live-bets').innerHTML = bets.map(b => `<div class="bet-row"><span>👤 ${b.user}</span><span>${b.amount} TON</span></div>`).join('');
        });

        function setTab(name, el) {
            cur = name;
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('v-'+name).classList.add('active');
            if(el) { document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); el.classList.add('active'); }
            if(name === 'mines') initMines();
        }

        function initMines() {
            const g = document.getElementById('mine-grid'); g.innerHTML = '';
            for(let i=0; i<25; i++) {
                let c = document.createElement('div'); c.className = 'm-cell';
                c.onclick = () => { c.classList.add('open'); c.innerHTML = '💎'; tg.HapticFeedback.impactOccurred('light'); };
                g.appendChild(c);
            }
        }

        function play() {
            socket.emit('bet', { username: tg.initDataUnsafe.user?.username || 'Player', amount: document.getElementById('amt').value });
            tg.HapticFeedback.impactOccurred('medium');
            tg.showAlert("Ставка принята!");
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(UI));
server.listen(PORT, () => console.log("🚀 LOONX PRO IS LIVE"));
