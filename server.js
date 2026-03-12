try { require('dotenv').config(); } catch (e) {}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://loonxgift.onrender.com';

mongoose.connect(MONGO_URI).then(() => console.log('✅ БД Подключена')).catch(err => console.error('❌ Ошибка БД:', err));

// --- СХЕМЫ БАЗЫ ДАННЫХ ---
const User = mongoose.model('User', new mongoose.Schema({
    id: String, tgName: String, photoUrl: String,
    realBal: { type: Number, default: 0 }, demoBal: { type: Number, default: 200 },
    games: { type: Number, default: 0 }, wins: { type: Number, default: 0 },
    spent: { type: Number, default: 0 }, withdrawn: { type: Number, default: 0 },
    banned: { type: Boolean, default: false }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String, amount: Number, uses: Number, activatedBy: [String]
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    id: { type: String, default: 'main' },
    crashWinChance: { type: Number, default: 70 }, 
    minesWinChance: { type: Number, default: 80 },
    coinflipWinChance: { type: Number, default: 50 }
}));

// Схема заявок на вывод
const WithdrawRequest = mongoose.model('WithdrawRequest', new mongoose.Schema({
    userId: String, tgName: String, wallet: String, amount: Number, status: { type: String, default: 'pending' }, date: { type: Date, default: Date.now }
}));

async function initSettings() {
    let s = await Settings.findOne({ id: 'main' });
    if (!s) await new Settings({ id: 'main' }).save();
}
initSettings();

// --- БОТ TELEGRAM ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🪙 Добро пожаловать в Loonx Gift!\nЛучшие игры уже ждут тебя.`, {
        reply_markup: { inline_keyboard: [[{ text: '🫧ИГРАТЬ🫧', web_app: { url: WEB_APP_URL } }]] }
    });
});
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `💎 *Наши контакты:*\n• Creator = @tonfrm\n• Channel = @Loonxnews\n• Support = @LoonxGift_Support\n• Bugs = @MsgP2P`, { parse_mode: 'Markdown' });
});

// --- ГЛОБАЛЬНЫЕ ДАННЫЕ ИГР ---
let globalHistory = [];
function addHistory(user, game, bet, win, isWin, mode) {
    if (mode === 'real') {
        globalHistory.unshift({ tgName: user.tgName, photoUrl: user.photoUrl, game, bet, win, isWin });
        if (globalHistory.length > 20) globalHistory.pop();
        io.emit('history_update', globalHistory);
    }
}

// --- CRASH ---
let crashState = { status: 'waiting', timer: 10, mult: 1.0 };
let crashActiveBets = [];

async function startCrash() {
    crashState = { status: 'waiting', timer: 10, mult: 1.0 };
    crashActiveBets = [];
    io.emit('crash_update', crashState);
    io.emit('crash_bets_update', crashActiveBets);
    
    let waitTimer = setInterval(async () => {
        crashState.timer--;
        io.emit('crash_update', crashState);
        if(crashState.timer <= 0) {
            clearInterval(waitTimer);
            let s = await Settings.findOne({ id: 'main' });
            let chance = s ? s.crashWinChance : 70;
            let isWin = (Math.random() * 100) <= chance;
            let targetMult = isWin ? (1.5 + Math.random() * 8.5) : (1.0 + Math.random() * 0.2);
            runRocket(parseFloat(targetMult.toFixed(2)));
        }
    }, 1000);
}

function runRocket(target) {
    crashState.status = 'flying';
    let flyInterval = setInterval(() => {
        crashState.mult += 0.01 + (crashState.mult * 0.005);
        if(crashState.mult >= target || target === 1.0) {
            clearInterval(flyInterval);
            crashState.status = 'crashed';
            crashActiveBets.forEach(async b => {
                if (b.status === 'active') {
                    b.status = 'lost';
                    let u = await User.findOne({ id: b.userId });
                    if(u) addHistory(u, 'Crash', b.bet, 0, false, b.mode);
                }
            });
            io.emit('crash_update', crashState);
            io.emit('crash_bets_update', crashActiveBets);
            setTimeout(startCrash, 4000);
        } else {
            io.emit('crash_update', { status: 'flying', mult: parseFloat(crashState.mult.toFixed(2)) });
        }
    }, 100);
}
startCrash();

// --- MINES СЕССИИ ---
const activeMines = new Map();

// --- СОКЕТЫ ---
io.on('connection', (socket) => {
    io.emit('online_count', io.engine.clientsCount);
    socket.on('disconnect', () => io.emit('online_count', io.engine.clientsCount));

    socket.on('init_user', async (data) => {
        let u = await User.findOneAndUpdate(
            { id: data.id }, 
            { tgName: data.username || 'User', photoUrl: data.photo || 'img/avatar.png' }, 
            { upsert: true, new: true }
        );
        if (u.banned) return socket.emit('alert', { msg: '❌ Ваш аккаунт заблокирован', type: 'error' });
        socket.userId = u.id;
        socket.emit('user_data', u);
        socket.emit('history_update', globalHistory);
        socket.emit('crash_update', crashState);
        socket.emit('crash_bets_update', crashActiveBets);
    });

    // --- ЗАПРОСЫ НА ВЫВОД (НОВОЕ) ---
    socket.on('request_withdraw', async (data) => {
        let u = await User.findOne({ id: socket.userId });
        if (u.realBal < data.amount || data.amount < 1) return socket.emit('alert', { msg: '❌ Недостаточно средств или сумма слишком мала', type: 'error' });
        
        u.realBal -= data.amount; // Списываем сразу
        await u.save();
        
        await new WithdrawRequest({ userId: u.id, tgName: u.tgName, wallet: data.wallet, amount: data.amount }).save();
        socket.emit('user_data', u);
        socket.emit('alert', { msg: '✅ Заявка на вывод создана!', type: 'success' });
    });

    // --- ИГРОВЫЕ СОБЫТИЯ ---
    // (CRASH)
    socket.on('crash_bet', async (data) => {
        if (crashState.status !== 'waiting') return;
        let u = await User.findOne({ id: socket.userId });
        let balType = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[balType] >= data.bet && data.bet > 0) {
            u[balType] -= data.bet;
            if (data.mode === 'real') { u.games++; u.spent += data.bet; }
            await u.save();
            crashActiveBets.push({ userId: u.id, tgName: u.tgName, bet: data.bet, mode: data.mode, status: 'active', win: 0 });
            socket.emit('user_data', u);
            io.emit('crash_bets_update', crashActiveBets);
        }
    });

    socket.on('crash_cashout', async () => {
        let bet = crashActiveBets.find(b => b.userId === socket.userId && b.status === 'active');
        if (bet && crashState.status === 'flying') {
            bet.status = 'cashed'; bet.win = bet.bet * crashState.mult;
            let u = await User.findOne({ id: socket.userId });
            let balType = bet.mode === 'real' ? 'realBal' : 'demoBal';
            u[balType] += bet.win;
            if (bet.mode === 'real') u.wins++;
            await u.save();
            socket.emit('user_data', u);
            socket.emit('alert', { msg: `✅ Вы забрали: ${bet.win.toFixed(2)}`, type: 'success' });
            io.emit('crash_bets_update', crashActiveBets);
            addHistory(u, 'Crash', bet.bet, bet.win, true, bet.mode);
        }
    });

    // (MINES)
    socket.on('mines_start', async (data) => {
        let u = await User.findOne({ id: socket.userId });
        let balType = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[balType] >= data.bet && data.bet > 0) {
            u[balType] -= data.bet;
            if (data.mode === 'real') { u.games++; u.spent += data.bet; }
            await u.save();
            let field = Array(25).fill('safe');
            let m = 0; while(m < data.minesCount) { let r = Math.floor(Math.random()*25); if(field[r] === 'safe'){ field[r] = 'mine'; m++; } }
            activeMines.set(socket.userId, { bet: data.bet, mode: data.mode, field, steps: 0, mult: 1.0 });
            socket.emit('user_data', u);
            socket.emit('mines_started');
        }
    });

    socket.on('mines_open', async (idx) => {
        let g = activeMines.get(socket.userId);
        if (!g) return;
        if (g.field[idx] === 'mine') {
            socket.emit('mines_boom', g.field);
            let u = await User.findOne({ id: socket.userId });
            addHistory(u, 'Mines', g.bet, 0, false, g.mode);
            activeMines.delete(socket.userId);
        } else {
            g.steps++; g.mult = parseFloat((g.mult * 1.2).toFixed(2));
            socket.emit('mines_safe', { idx, mult: g.mult });
        }
    });

    socket.on('mines_cashout', async () => {
        let g = activeMines.get(socket.userId);
        if (g && g.steps > 0) {
            let u = await User.findOne({ id: socket.userId });
            let win = g.bet * g.mult;
            let balType = g.mode === 'real' ? 'realBal' : 'demoBal';
            u[balType] += win; if (g.mode === 'real') u.wins++;
            await u.save();
            socket.emit('user_data', u); socket.emit('mines_win');
            socket.emit('alert', { msg: `✅ Вывел: ${win.toFixed(2)}`, type: 'success' });
            addHistory(u, 'Mines', g.bet, win, true, g.mode);
            activeMines.delete(socket.userId);
        }
    });

    // (COINFLIP)
    socket.on('coinflip_play', async (data) => {
        let u = await User.findOne({ id: socket.userId });
        let balType = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[balType] >= data.bet && data.bet > 0) {
            u[balType] -= data.bet;
            if (data.mode === 'real') { u.games++; u.spent += data.bet; }
            let s = await Settings.findOne({ id: 'main' });
            let isWin = (Math.random() * 100) <= s.coinflipWinChance;
            let winAmount = isWin ? data.bet * 1.9 : 0;
            if (isWin) { u[balType] += winAmount; if (data.mode === 'real') u.wins++; }
            await u.save();
            socket.emit('user_data', u);
            socket.emit('coinflip_result', { win: isWin, resultSide: isWin ? data.side : (data.side === 'L' ? 'X' : 'L') });
            addHistory(u, 'Coinflip', data.bet, winAmount, isWin, data.mode);
        }
    });

    // --- АДМИН ПАНЕЛЬ ---
    socket.on('admin_login', async (pass) => {
        if(pass === '7788') {
            const users = await User.find({});
            const settings = await Settings.findOne({ id: 'main' });
            const withdraws = await WithdrawRequest.find({ status: 'pending' });
            socket.emit('admin_data', { users, settings, withdraws });
        } else {
            socket.emit('alert', { msg: '❌ Неверный пароль', type: 'error' });
        }
    });

    socket.on('admin_action', async (data) => {
        if(data.action === 'save_rtp') {
            await Settings.findOneAndUpdate({ id: 'main' }, { crashWinChance: data.crash, minesWinChance: data.mines, coinflipWinChance: data.coin });
        }
        if(data.action === 'add_bal') {
            let u = await User.findOne({ id: data.userId });
            u.realBal += parseFloat(data.amount);
            await u.save();
            io.to(u.id).emit('user_data', u);
        }
        if(data.action === 'approve_withdraw') {
            let req = await WithdrawRequest.findById(data.reqId);
            req.status = 'approved';
            let u = await User.findOne({ id: req.userId });
            u.withdrawn += req.amount;
            await req.save(); await u.save();
            io.to(u.id).emit('user_data', u);
            socket.emit('alert', { msg: '✅ Вывод одобрен и учтен в статистике', type: 'success' });
        }
    });
});

app.use(express.static('public'));
server.listen(process.env.PORT || 3000, () => console.log('🚀 Server is running fully loaded'));
