const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// === НАСТРОЙКА БОТА ===
if (process.env.BOT_TOKEN) {
    const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    bot.onText(/\/start/, (msg) => {
        const opts = {
            reply_markup: {
                inline_keyboard: [[{ text: '🫧 Играть 🫧', web_app: { url: 'https://loonxgift.onrender.com' } }]]
            }
        };
        bot.sendMessage(msg.chat.id, 'Добро пожаловать в Loonx Gifts🍀\nИспытай свою удачу здесь👇', opts);
    });
    console.log("Telegram Bot запущен!");
} else {
    console.log("BOT_TOKEN не указан. Бот не работает.");
}

// === БАЗА ДАННЫХ MONGODB ===
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost/loonx', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('Mongo Error:', err));

const UserSchema = new mongoose.Schema({
    id: String, tgName: String, realBal: { type: Number, default: 0 }, demoBal: { type: Number, default: 0 },
    lastDemo: { type: Number, default: 0 }, games: { type: Number, default: 0 }, wins: { type: Number, default: 0 },
    usedPromos: [String], wallet: String
});
const User = mongoose.model('User', UserSchema);

const PromoSchema = new mongoose.Schema({ code: String, reward: Number, maxUses: Number, currentUses: { type: Number, default: 0 } });
const Promo = mongoose.model('Promo', PromoSchema);

const WithdrawSchema = new mongoose.Schema({ reqId: String, socketId: String, id: String, name: String, amount: Number, wallet: String });
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

// === EXPRESS & SOCKET.IO ===
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/tonconnect-manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tonconnect-manifest.json')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let activeMines = {};
let crashHistory = [];
let crash = { status: 'waiting', timer: 6, mult: 1.00, liveBets: [] };
let nextRoundBets = []; // Очередь ставок на некст раунд

function runCrash() {
    crash = { status: 'waiting', timer: 6, mult: 1.00, liveBets: [...nextRoundBets] };
    nextRoundBets = []; // Очищаем очередь
    io.emit('crash_update', { ...crash, history: crashHistory });
    let wait = setInterval(() => {
        crash.timer--; io.emit('crash_update', { ...crash, history: crashHistory });
        if (crash.timer <= 0) { clearInterval(wait); startFlight(); }
    }, 1000);
}

function startFlight() {
    crash.status = 'flying';
    let crashPoint = Math.random() < 0.15 ? (1.00 + Math.random()*0.1) : (100 * (2**52) - Math.floor(Math.random() * (2**52))) / ((2**52) - Math.floor(Math.random() * (2**52))) / 100;
    if(crashPoint < 1.01) crashPoint = 1.00;

    let flight = setInterval(async () => {
        if (crash.mult >= crashPoint) {
            clearInterval(flight);
            crash.status = 'crashed';
            crashHistory.unshift(crash.mult.toFixed(2));
            if(crashHistory.length > 10) crashHistory.pop();
            io.emit('crash_update', { ...crash, history: crashHistory });
            setTimeout(runCrash, 4000);
        } else {
            crash.mult += 0.01 * Math.pow(crash.mult, 0.6);
            for (let b of crash.liveBets) {
                if (!b.cashed && b.auto > 1.00 && crash.mult >= b.auto) {
                    b.cashed = true;
                    let win = b.bet * b.auto;
                    try {
                        let u = await User.findOne({ id: b.id });
                        if (u) {
                            b.mode === 'real' ? u.realBal += win : u.demoBal += win;
                            u.wins++;
                            await u.save();
                            io.to(b.socketId).emit('crash_win', { win: win, mult: b.auto });
                            io.to(b.socketId).emit('user_data', u);
                        }
                    } catch(e) { console.error(e); }
                }
            }
            io.emit('crash_update', { ...crash, history: crashHistory });
        }
    }, 100);
}
runCrash();

io.on('connection', (socket) => {
    let currentUserId = null;

    socket.on('init_user', async (tgData) => {
        if(!tgData || !tgData.id) return;
        currentUserId = tgData.id.toString();
        try {
            let u = await User.findOne({ id: currentUserId });
            if(!u) { u = await User.create({ id: currentUserId, tgName: tgData.username || 'Player' }); }
            socket.emit('user_data', u);
        } catch(e) { console.error(e); }
    });

    socket.emit('crash_update', { ...crash, history: crashHistory });
    
    socket.on('set_wallet', async (w) => {
        if(!currentUserId) return;
        let u = await User.findOne({ id: currentUserId });
        if(u) { u.wallet = w; await u.save(); }
    });

    socket.on('claim_demo', async () => {
        if(!currentUserId) return;
        let u = await User.findOne({ id: currentUserId });
        if(!u) return;
        let now = Date.now();
        if (now - u.lastDemo >= 86400000 || u.lastDemo === 0) { 
            u.demoBal += 100.0; u.lastDemo = now;
            await u.save();
            socket.emit('user_data', u); socket.emit('alert', '✅ Получено 100 DEMO TON!');
        } else {
            let left = Math.ceil((86400000 - (now - u.lastDemo)) / 3600000);
            socket.emit('alert', `⏳ Бонус через ${left} ч.`);
        }
    });

    socket.on('activate_promo', async (code) => {
        if(!currentUserId) return;
        let pName = code.toUpperCase();
        try {
            let u = await User.findOne({ id: currentUserId });
            let promo = await Promo.findOne({ code: pName });
            
            if (!promo) return socket.emit('alert', '❌ Промокод не существует!');
            if (u.usedPromos.includes(pName)) return socket.emit('alert', '❌ Вы уже использовали этот код!');
            if (promo.currentUses >= promo.maxUses) return socket.emit('alert', '❌ Лимит активаций исчерпан!');

            u.realBal += promo.reward;
            u.usedPromos.push(pName);
            await u.save();
            
            promo.currentUses++;
            await promo.save();
            
            socket.emit('user_data', u);
            socket.emit('alert', `✅ Успешно! +${promo.reward} REAL TON`);
        } catch(e) { console.error(e); socket.emit('alert', '❌ Ошибка активации'); }
    });

    socket.on('crash_bet', async (data) => {
        if(!currentUserId) return;
        let bet = parseFloat(data.bet); let auto = parseFloat(data.auto) || 0;
        let isReal = data.mode === 'real';
        
        if (bet < 0.5 || bet > 20) return socket.emit('bet_error', 'Ставка от 0.5 до 20 TON!');
        
        let u = await User.findOne({ id: currentUserId });
        if (!u) return;
        if ((isReal ? u.realBal : u.demoBal) < bet) return socket.emit('bet_error', 'Недостаточно средств!');

        isReal ? u.realBal -= bet : u.demoBal -= bet;
        u.games++; await u.save();

        let betData = { socketId: socket.id, id: u.id, name: u.tgName, bet: bet, auto: auto, cashed: false, mode: data.mode };
        
        if (crash.status !== 'waiting') {
            nextRoundBets.push(betData);
            socket.emit('alert', '⏳ Ракета летит! Ставка принята на следующий раунд!');
        } else {
            crash.liveBets.push(betData);
        }
        socket.emit('bet_success'); socket.emit('user_data', u); io.emit('crash_update', { ...crash, history: crashHistory });
    });

    socket.on('crash_cashout', async () => {
        if(!currentUserId) return;
        if (crash.status === 'flying') {
            let b = crash.liveBets.find(x => x.socketId === socket.id && !x.cashed);
            if (b) {
                b.cashed = true; let win = b.bet * crash.mult;
                let u = await User.findOne({ id: currentUserId });
                if(u) {
                    b.mode === 'real' ? u.realBal += win : u.demoBal += win;
                    u.wins++; await u.save();
                    socket.emit('crash_win', { win: win, mult: crash.mult });
                    socket.emit('user_data', u); io.emit('crash_update', { ...crash, history: crashHistory });
                }
            }
        }
    });

    socket.on('mines_start', async (data) => {
        if(!currentUserId) return;
        let bet = parseFloat(data.bet); let isReal = data.mode === 'real';
        if (bet < 0.5 || bet > 20) return socket.emit('bet_error', 'Ставка от 0.5 до 20 TON!');
        
        let u = await User.findOne({ id: currentUserId });
        if(!u) return;
        if ((isReal ? u.realBal : u.demoBal) < bet) return socket.emit('bet_error', 'Недостаточно средств!');

        isReal ? u.realBal -= bet : u.demoBal -= bet;
        u.games++; await u.save();

        let f = Array(25).fill('safe');
        let m=0; while(m < 5) { let r = Math.floor(Math.random()*25); if(f[r] !== 'mine'){ f[r] = 'mine'; m++; } }
        activeMines[socket.id] = { bet: bet, field: f, mult: 1.00, mode: data.mode };
        socket.emit('user_data', u); socket.emit('mines_ready');
    });

    socket.on('mines_open', (idx) => {
        let game = activeMines[socket.id]; if (!game) return;
        if (game.mode === 'real' && game.field[idx] !== 'mine' && Math.random() < 0.10) game.field[idx] = 'mine';
        if (game.field[idx] === 'mine') {
            socket.emit('mines_boom', game.field); delete activeMines[socket.id];
        } else {
            game.mult += 0.2; socket.emit('mines_safe', { idx, mult: game.mult.toFixed(2) });
        }
    });

    socket.on('mines_cashout', async () => {
        if(!currentUserId) return;
        let game = activeMines[socket.id]; 
        if (game) {
            let win = game.bet * game.mult;
            let u = await User.findOne({ id: currentUserId });
            if(u) {
                game.mode === 'real' ? u.realBal += win : u.demoBal += win;
                u.wins++; await u.save();
                socket.emit('mines_win', { win: win, mult: game.mult });
                socket.emit('user_data', u); delete activeMines[socket.id];
            }
        }
    });

    socket.on('request_withdraw', async (data) => {
        if(!currentUserId) return;
        let amt = parseFloat(data.amount);
        let u = await User.findOne({ id: currentUserId });
        if(u && u.realBal >= amt && amt >= 5 && data.wallet.length > 10) {
            u.realBal -= amt; await u.save();
            let reqId = Date.now().toString();
            await Withdraw.create({ reqId: reqId, socketId: socket.id, id: u.id, name: u.tgName, amount: amt, wallet: data.wallet });
            socket.emit('user_data', u); socket.emit('alert', '✅ Заявка на вывод отправлена!');
        } else { socket.emit('alert', '❌ Ошибка! Мин. 5 REAL TON или неверный кошелек.'); }
    });

    socket.on('admin_login', async (pw) => {
        if(pw === '7788') {
            let allUsers = await User.find({});
            let allWithdraws = await Withdraw.find({});
            socket.emit('admin_data', { users: allUsers, withdraws: allWithdraws });
        }
    });
    
    socket.on('admin_create_promo', async (data) => {
        if(data.pw === '7788') { 
            await Promo.create({ code: data.code.toUpperCase(), reward: parseFloat(data.amount), maxUses: parseInt(data.uses) });
            socket.emit('alert', '✅ Промокод создан!'); 
        }
    });

    socket.on('admin_action_withdraw', async (data) => {
        if(data.pw === '7788') {
            let req = await Withdraw.findOne({ reqId: data.reqId });
            if(req) {
                if(data.action === 'reject') {
                    let u = await User.findOne({ id: req.id });
                    if(u) { u.realBal += req.amount; await u.save(); io.to(req.socketId).emit('alert', '❌ Ваш вывод отклонен. Средства возвращены.'); io.to(req.socketId).emit('user_data', u); }
                } else {
                    io.to(req.socketId).emit('alert', '✅ Ваш вывод одобрен!');
                }
                await Withdraw.deleteOne({ reqId: data.reqId });
                let allUsers = await User.find({});
                let allWithdraws = await Withdraw.find({});
                socket.emit('admin_data', { users: allUsers, withdraws: allWithdraws });
            }
        }
    });

    socket.on('disconnect', () => { delete activeMines[socket.id]; });
});

server.listen(process.env.PORT || 3000, () => console.log('Server is running'));
