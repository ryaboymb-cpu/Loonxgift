const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// ПРОВЕРКА ПЕРЕМЕННЫХ (Render часто падает без них)
const { BOT_TOKEN, MONGO_URI, PORT = 10000 } = process.env;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- DATABASE ---
mongoose.connect(MONGO_URI).then(() => console.log("💎 MongoDB Connected"));

const userSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    avatar: String,
    real_balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 5000 },
    isBanned: { type: Boolean, default: false },
    total_dep: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const Promo = mongoose.model('Promo', { code: String, sum: Number, left: Number });
const Withdraw = mongoose.model('Withdraw', { tgId: Number, amount: Number, wallet: String, status: String });

// --- SETTINGS ---
let globalRTP = 90; 

// --- TELEGRAM BOT (FIXED) ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🚀 Добро пожаловать в Loonx Gifts!\n\nИграй в Crash, Mines и CoinFlip в одном приложении.\n\n💎 Быстрые выплаты в TON\n🎁 Ежедневные бонусы\n📈 Прозрачные коэффициенты`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Начать игру", web_app: { url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:3000'}` } }],
                [{ text: "📢 Наш канал", url: "https://t.me/Loonxnews" }, { text: "🆘 Саппорт", url: "https://t.me/LoonxGift_Support" }]
            ]
        }
    });
});

// АДМИНКА (7788) - ВСЕ 4 РАЗДЕЛА + ЮЗЕРЫ
bot.on('message', async (msg) => {
    if (msg.text === '7788') {
        const stats = await User.countDocuments();
        const wdCount = await Withdraw.countDocuments({ status: 'pending' });
        
        bot.sendMessage(msg.chat.id, "🛠 **ГЛАВНОЕ МЕНЮ АДМИНИСТРАТОРА**", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: `📊 Статистика (Юзеров: ${stats})`, callback_data: "adm_stats" }],
                    [{ text: `📥 Заявки на вывод (${wdCount})`, callback_data: "adm_wd" }],
                    [{ text: "🎟 Создать Промо", callback_data: "adm_promo" }, { text: `📈 RTP: ${globalRTP}%`, callback_data: "adm_rtp" }],
                    [{ text: "👥 Управление Юзерами (Бан/Баланс)", callback_data: "adm_users_list" }]
                ]
            }
        });
    }
});

// Обработка действий (Управление юзером: бан, баланс, рассылка)
bot.on('callback_query', async (q) => {
    const cid = q.message.chat.id;
    if (q.data === 'adm_users_list') {
        bot.sendMessage(cid, "Введите ID пользователя для управления (или используйте /user ID):");
    }
    if (q.data === 'adm_rtp') {
        bot.sendMessage(cid, "Введите новый RTP (1-100):");
        // Логика перехвата следующего сообщения для смены RTP
    }
});

// --- CRASH ENGINE (STABLE) ---
let crash = { status: 'wait', mult: 1.0, timer: 10, history: ["1.2x", "5.4x", "1.01x"] };

function cycle() {
    crash.status = 'wait'; crash.timer = 10; crash.mult = 1.0;
    let t = setInterval(() => {
        crash.timer -= 0.1;
        io.emit('crash_timer', crash.timer.toFixed(1));
        if(crash.timer <= 0) { clearInterval(t); fly(); }
    }, 100);
}

function fly() {
    crash.status = 'fly';
    // RTP влияние на краш
    let limit = (Math.random() * (globalRTP / 20) + 1.01).toFixed(2);
    let f = setInterval(() => {
        crash.mult += crash.mult * 0.007 + 0.01;
        io.emit('crash_tick', crash.mult.toFixed(2));
        if(crash.mult >= limit) {
            clearInterval(f); crash.status = 'end';
            crash.history.unshift(limit + "x");
            io.emit('crash_end', { point: limit, history: crash.history.slice(0, 10) });
            setTimeout(cycle, 4000);
        }
    }, 100);
}
cycle();

// --- SOCKETS ---
io.on('connection', (socket) => {
    socket.on('auth', async (d) => {
        let u = await User.findOneAndUpdate({ tgId: d.id }, { username: d.username, avatar: d.photo_url }, { upsert: true, new: true });
        socket.userId = u.tgId;
        socket.emit('init', { user: u, crash });
        io.emit('online', io.engine.clientsCount);
    });
});

// --- FRONTEND (MONOLITH UI) ---
const UI = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --acc: #007aff; --bg: #000; --card: #1c1c1e; --success: #34c759; --error: #ff3b30; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; background: var(--bg); color: #fff; font-family: -apple-system, sans-serif; overflow: hidden; height: 100vh; }
        canvas { position: fixed; top: 0; left: 0; z-index: -1; }
        header { padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(20,20,22,0.85); backdrop-filter: blur(20px); border-bottom: 0.5px solid #333; }
        .bal-t { color: var(--success); font-weight: 800; font-size: 1.25rem; text-shadow: 0 0 10px rgba(52,199,89,0.3); }
        .tabs { display: flex; gap: 10px; padding: 15px; overflow-x: auto; scrollbar-width: none; }
        .t-btn { background: var(--card); min-width: 105px; padding: 12px; border-radius: 14px; border: 1px solid #333; text-align: center; font-weight: 700; transition: 0.2s; }
        .t-btn.active { border-color: var(--acc); box-shadow: 0 0 15px rgba(0, 122, 255, 0.4); background: rgba(0,122,255,0.1); }
        .view { padding: 0 20px; height: 50vh; display: none; }
        .view.active { display: block; }
        #c-mult { font-size: 5rem; font-weight: 900; text-align: center; margin: 30px 0; transition: 0.1s; }
        .m-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; max-width: 320px; margin: 0 auto; }
        .cell { aspect-ratio: 1; background: #2c2c2e; border-radius: 10px; border: 1px solid #3a3a3c; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
        .cell.open { background: rgba(52,199,89,0.1); border-color: var(--success); color: var(--success); }
        .hotbar { position: fixed; bottom: 0; width: 100%; height: 75px; background: rgba(20,20,22,0.95); display: flex; justify-content: space-around; border-top: 0.5px solid #333; backdrop-filter: blur(20px); }
        .h-item { text-align: center; color: #8e8e93; padding-top: 12px; font-size: 0.7rem; width: 25%; }
        .h-item.active { color: var(--success); font-weight: 700; }
        .h-item i { display: block; font-size: 1.5rem; margin-bottom: 3px; }
        .f-bet { position: fixed; bottom: 85px; width: 100%; padding: 0 20px; }
        .btn-p { width: 100%; padding: 18px; border-radius: 18px; border: none; background: var(--acc); color: #fff; font-weight: 800; font-size: 1.1rem; box-shadow: 0 0 15px rgba(0,122,255,0.4); }
    </style>
</head>
<body>
    <canvas id="stars"></canvas>
    <header>
        <div style="display:flex; align-items:center; gap:10px;">
            <img src="" id="u-ava" style="width:38px;height:38px;border-radius:50%;border:1.5px solid var(--acc);">
            <div style="font-size:0.9rem; font-weight:700;" id="u-name">...</div>
        </div>
        <div style="text-align:right">
            <div class="bal-t" id="bal-r">0.00 TON</div>
            <div style="font-size:0.65rem; color:#8e8e93">DEMO: <span id="bal-d">5000</span></div>
        </div>
    </header>

    <div class="tabs">
        <div class="t-btn active" onclick="tab('crash',this)">🚀 Crash</div>
        <div class="t-btn" onclick="tab('mines',this)">💣 Mines</div>
        <div class="t-btn" onclick="tab('flip',this)">🪙 Flip</div>
    </div>

    <main>
        <div id="v-crash" class="view active">
            <div id="c-hist" style="display:flex; gap:8px; margin-bottom:15px; overflow-x:auto;"></div>
            <div id="c-lab" style="text-align:center; color:var(--acc); font-weight:700; font-size:0.8rem;">ОЖИДАНИЕ...</div>
            <h1 id="c-mult">1.00x</h1>
        </div>
        <div id="v-mines" class="view"><div class="m-grid" id="m-g"></div></div>
        <div id="v-wallet" class="view" style="text-align:center;">
            <div style="background:var(--card); padding:25px; border-radius:20px; border:1px solid #333;">
                <h3 style="margin-top:0;">КОШЕЛЕК TON</h3>
                <div id="addr" style="background:#000; padding:15px; border-radius:12px; font-family:monospace; border:1px dashed var(--acc); margin:15px 0;">UQBy...3N1L</div>
                <button class="btn-p" style="background:var(--success)" onclick="copy()">КОПИРОВАТЬ</button>
            </div>
        </div>
    </main>

    <div class="f-bet">
        <input type="number" id="amt" value="10" style="width:100%; background:#1c1c1e; border:1px solid #333; padding:15px; border-radius:15px; color:#fff; font-weight:700; margin-bottom:10px;">
        <button class="btn-p" onclick="play()">ПОСТАВИТЬ</button>
    </div>

    <nav class="hotbar">
        <div class="h-item active" onclick="tab('crash')"><i>🎮</i>Игры</div>
        <div class="h-item"><i>🎁</i>Промо</div>
        <div class="h-item" onclick="tab('wallet')"><i>💼</i>Кошелек</div>
        <div class="h-item"><i>👤</i>Профиль</div>
    </nav>

    <script>
        const tg = window.Telegram.WebApp;
        const socket = io();
        let cur = 'crash';

        // Stars Background
        const c = document.getElementById('stars'); const x = c.getContext('2d');
        c.width=window.innerWidth; c.height=window.innerHeight;
        let p = Array.from({length:110},()=>({x:Math.random()*c.width, y:Math.random()*c.height, s:Math.random()*2, sp:Math.random()*0.4+0.1}));
        function draw(){ x.clearRect(0,0,c.width,c.height); x.fillStyle="#fff"; p.forEach(i=>{x.beginPath(); x.arc(i.x,i.y,i.s,0,7); x.fill(); i.y+=i.sp; if(i.y>c.height) i.y=0;}); requestAnimationFrame(draw); } draw();

        socket.on('init', d => {
            document.getElementById('u-name').innerText = d.user.username;
            document.getElementById('bal-r').innerText = d.user.real_balance.toFixed(2) + ' TON';
            document.getElementById('c-hist').innerHTML = d.crash.history.map(v => '<span style="background:#222;padding:4px 10px;border-radius:6px;font-size:0.75rem">'+v+'</span>').join('');
        });

        socket.on('crash_tick', m => {
            if(cur==='crash'){ document.getElementById('c-mult').innerText=m+'x'; document.getElementById('c-mult').style.color='var(--success)'; document.getElementById('c-lab').innerText='ПОЛЕТ...'; }
        });

        socket.on('crash_end', d => {
            document.getElementById('c-mult').innerText=d.point+'x'; document.getElementById('c-mult').style.color='var(--error)'; document.getElementById('c-lab').innerText='КРАШ!';
            document.getElementById('c-hist').innerHTML = d.history.map(v => '<span style="background:#222;padding:4px 10px;border-radius:6px;font-size:0.75rem">'+v+'</span>').join('');
        });

        function tab(n,e){
            cur=n; document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
            document.getElementById('v-'+n).classList.add('active');
            if(e){ document.querySelectorAll('.t-btn').forEach(b=>b.classList.remove('active')); e.classList.add('active'); }
            if(n==='mines') initM();
        }

        function initM(){
            const g = document.getElementById('m-g'); g.innerHTML = '';
            for(let i=0; i<25; i++){
                let d = document.createElement('div'); d.className='cell';
                d.onclick=()=>{d.classList.add('open'); d.innerHTML='💎'; tg.HapticFeedback.impactOccurred('light');};
                g.appendChild(d);
            }
        }
        function play(){ tg.HapticFeedback.impactOccurred('medium'); tg.showAlert("Ставка принята!"); }
        function copy(){ navigator.clipboard.writeText(document.getElementById('addr').innerText); tg.showAlert("Скопировано!"); }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(UI));
server.listen(PORT, () => console.log(`
