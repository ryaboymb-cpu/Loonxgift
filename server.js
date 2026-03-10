const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// BOT & DB ENV
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, 'Добро пожаловать в Loonx Gifts🍀\nИспытай свою удачу здесь👇', {
            reply_markup: { inline_keyboard: [[{ text: '🫧 Играть 🫧', web_app: { url: 'https://loonxgift.onrender.com' } }]] }
        });
    });
}

mongoose.connect(MONGO_URI || 'mongodb://localhost/loonx', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('Mongo Error:', err));

const UserSchema = new mongoose.Schema({
    id: String, tgName: String, realBal: { type: Number, default: 0 }, demoBal: { type: Number, default: 0 },
    lastDemo: { type: Number, default: 0 }, games: { type: Number, default: 0 }, wins: { type: Number, default: 0 },
    usedPromos: [String], wallet: String
});
const User = mongoose.model('User', UserSchema);

const PromoSchema = new mongoose.Schema({ code: String, reward: Number, maxUses: Number, currentUses: { type: Number, default: 0 } });
const Promo = mongoose.model('Promo', PromoSchema);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let crashHistory = [];
let crash = { status: 'waiting', timer: 6, mult: 1.00, liveBets: [] };
let nextRoundBets = [];

function runCrash() {
    crash = { status: 'waiting', timer: 6, mult: 1.00, liveBets: [...nextRoundBets] };
    nextRoundBets = [];
    io.emit('crash_update', { ...crash, history: crashHistory });
    let wait = setInterval(() => {
        crash.timer--; io.emit('crash_update', { ...crash, history: crashHistory });
        if (crash.timer <= 0) { clearInterval(wait); startFlight(); }
    }, 1000);
}

function startFlight() {
    crash.status = 'flying';
    // ПОНИЖЕННЫЕ ШАНСЫ: 25% шанс моментального взрыва (1.00x), в остальном - жесткий рандом
    let crashPoint;
    let rand = Math.random();
    if (rand < 0.25) { 
        crashPoint = 1.00; 
    } else if (rand < 0.80) {
        crashPoint = 1.00 + (Math.random() * 1.5); // Большинство игр до 2.5х
    } else {
        crashPoint = (100 / (Math.floor(Math.random() * 100) + 1)) + 0.5; // Редкие высокие иксы
    }

    let flight = setInterval(async () => {
        if (crash.mult >= crashPoint) {
            clearInterval(flight); crash.status = 'crashed';
            crashHistory.unshift(crash.mult.toFixed(2)); if(crashHistory.length > 10) crashHistory.pop();
            io.emit('crash_update', { ...crash, history: crashHistory });
            setTimeout(runCrash, 4000);
        } else {
            crash.mult += 0.01 * Math.pow(crash.mult, 0.5);
            io.emit('crash_update', { ...crash, history: crashHistory });
        }
    }, 100);
}
runCrash();

io.on('connection', (socket) => {
    let currId = null;

    socket.on('init_user', async (data) => {
        if(!data.id) return;
        currId = data.id.toString();
        let u = await User.findOne({ id: currId });
        if(!u) u = await User.create({ id: currId, tgName: data.username || 'Player' });
        socket.emit('user_data', u);
    });

    socket.on('crash_bet', async (data) => {
        if(!currId) return;
        let u = await User.findOne({ id: currId });
        let bet = parseFloat(data.bet);
        if(bet < 0.5 || (data.mode === 'real' ? u.realBal : u.demoBal) < bet) return socket.emit('alert', 'Ошибка ставки');

        data.mode === 'real' ? u.realBal -= bet : u.demoBal -= bet;
        await u.save();

        let bData = { socketId: socket.id, id: currId, name: u.tgName, bet: bet, cashed: false, mode: data.mode };
        if(crash.status !== 'waiting') {
            nextRoundBets.push(bData);
            socket.emit('alert', 'Записано на некст раунд');
        } else {
            crash.liveBets.push(bData);
        }
        socket.emit('user_data', u);
    });

    socket.on('crash_cashout', async () => {
        let b = crash.liveBets.find(x => x.socketId === socket.id && !x.cashed);
        if(b && crash.status === 'flying') {
            b.cashed = true;
            let win = b.bet * crash.mult;
            let u = await User.findOne({ id: currId });
            b.mode === 'real' ? u.realBal += win : u.demoBal += win;
            u.wins++; await u.save();
            socket.emit('user_data', u);
            socket.emit('crash_win', { win: win });
        }
    });

    socket.on('mines_start', async (data) => {
        let u = await User.findOne({ id: currId });
        let bet = parseFloat(data.bet);
        if(bet < 0.5 || (data.mode === 'real' ? u.realBal : u.demoBal) < bet) return socket.emit('alert', 'Ошибка баланса');
        
        data.mode === 'real' ? u.realBal -= bet : u.demoBal -= bet;
        await u.save();
        
        // Повышаем шанс бомб в реальном режиме
        let mineCount = data.mode === 'real' ? 6 : 4;
        let f = Array(25).fill('safe');
        let m=0; while(m < mineCount) { let r = Math.floor(Math.random()*25); if(f[r]!=='mine'){ f[r]='mine'; m++; }}
        
        socket.game = { bet, f, mult: 1.0, mode: data.mode };
        socket.emit('user_data', u);
        socket.emit('mines_ready');
    });

    socket.on('mines_open', (idx) => {
        if(!socket.game) return;
        if(socket.game.f[idx] === 'mine') {
            socket.emit('mines_boom', socket.game.f);
            socket.game = null;
        } else {
            socket.game.mult += 0.25;
            socket.emit('mines_safe', { idx, mult: socket.game.mult.toFixed(2) });
        }
    });

    socket.on('mines_cashout', async () => {
        if(!socket.game) return;
        let win = socket.game.bet * socket.game.mult;
        let u = await User.findOne({ id: currId });
        socket.game.mode === 'real' ? u.realBal += win : u.demoBal += win;
        await u.save();
        socket.emit('user_data', u);
        socket.emit('mines_win', { win });
        socket.game = null;
    });

    socket.on('activate_promo', async (code) => {
        let p = await Promo.findOne({ code: code.toUpperCase() });
        let u = await User.findOne({ id: currId });
        if(p && p.currentUses < p.maxUses && !u.usedPromos.includes(p.code)) {
            u.realBal += p.reward; u.usedPromos.push(p.code);
            p.currentUses++; await u.save(); await p.save();
            socket.emit('user_data', u); socket.emit('alert', '✅ Промокод активирован!');
        } else { socket.emit('alert', '❌ Ошибка промокода'); }
    });

    socket.on('admin_create_promo', async (d) => {
        if(d.pw === '7788') await Promo.create({ code: d.code.toUpperCase(), reward: d.amount, maxUses: d.uses });
    });
});

server.listen(process.env.PORT || 3000);
