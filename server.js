const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 1. НАСТРОЙКИ ENV ---
const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://loonxgift.onrender.com';

// --- 2. БОТ TELEGRAM ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const CONTACTS = {
    creator: '@tonfrm',
    channel: '@Loonxnews',
    support: '@LoonxGift_Support',
    bugs: '@MsgP2P'
};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🪙 Добро пожаловать в Loonx Gift!\nЛучшие игры уже ждут тебя.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🫧играть🫧', web_app: { url: WEB_APP_URL } }],
                [{ text: '📢 Channel', url: `https://t.me/${CONTACTS.channel.replace('@', '')}` }]
            ]
        }
    });
});

bot.onText(/\/help/, (msg) => {
    const helpText = `💎 *Наши контакты:*\n\n` +
                     `• Creator = ${CONTACTS.creator}\n\n` +
                     `• Channel and promo = ${CONTACTS.channel}\n\n` +
                     `• Support = ${CONTACTS.support}\n\n` +
                     `• Bags = ${CONTACTS.bugs}`;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

// --- 3. БАЗА ДАННЫХ MONGODB ---
mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB подключена')).catch(err => console.log('❌ Ошибка БД:', err));

const User = mongoose.model('User', new mongoose.Schema({
    id: String, tgName: String, photoUrl: String,
    realBal: { type: Number, default: 0 }, demoBal: { type: Number, default: 200 },
    games: { type: Number, default: 0 }, wins: { type: Number, default: 0 },
    spent: { type: Number, default: 0 }, withdrawn: { type: Number, default: 0 },
    banned: { type: Boolean, default: false }, lastDemoClaim: { type: Date, default: null }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String, amount: Number, uses: Number, activatedBy: [String]
}));

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    userId: String, tgName: String, amount: Number, address: String, status: { type: String, default: 'pending' }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    id: { type: String, default: 'main' }, crashWinChance: { type: Number, default: 80 },
    minesWinChance: { type: Number, default: 85 }, coinflipWinChance: { type: Number, default: 50 }
}));

const MinesSession = mongoose.model('MinesSession', new mongoose.Schema({
    userId: String, bet: Number, mode: String, field: Array, steps: { type: Number, default: 0 }, minesCount: Number, mult: { type: Number, default: 1.0 }
}));

// Инициализация настроек
async function initSettings() {
    let s = await Settings.findOne({ id: 'main' });
    if (!s) await new Settings({ id: 'main' }).save();
}
initSettings();

// --- 4. ЛОГИКА CRASH ---
let crashState = { status: 'waiting', timer: 10, mult: 1.0 };
let activeBets = [];
let globalHistory = [];

function addGlobalHistory(user, game, bet, win, isWin, mode) {
    if (mode === 'real') {
        globalHistory.unshift({ tgName: user.tgName, photoUrl: user.photoUrl, game, bet, win, isWin });
        if (globalHistory.length > 10) globalHistory.pop();
        io.emit('global_history_update', globalHistory);
    }
}

async function startCrash() {
    crashState.status = 'waiting'; crashState.timer = 10; crashState.mult = 1.0; activeBets = [];
    io.emit('crash_update', crashState);
    io.emit('crash_live_bets', activeBets);

    let waitTimer = setInterval(async () => {
        crashState.timer--;
        io.emit('crash_update', crashState);
        if (crashState.timer <= 0) {
            clearInterval(waitTimer);
            let s = await Settings.findOne({ id: 'main' });
            let chance = s ? s.crashWinChance : 80;
            let hasReal = activeBets.some(b => b.mode === 'real');
            let targetMult = hasReal ? (Math.random() * 100 < chance ? (1.1 + Math.random() * 2) : 1.0) : (1.5 + Math.random() * 5);
            runRocket(parseFloat(targetMult.toFixed(2)));
        }
    }, 1000);
}

function runRocket(target) {
    crashState.status = 'flying';
    let flyInterval = setInterval(() => {
        crashState.mult += 0.01 + (crashState.mult * 0.005);
        if (crashState.mult >= target || target === 1.0) {
            clearInterval(flyInterval);
            crashState.status = 'crashed';
            activeBets.forEach(async b => {
                if (b.status === 'active') {
                    b.status = 'lost';
                    let u = await User.findOne({ id: b.id });
                    if(u) addGlobalHistory(u, 'Crash', b.bet, 0, false, b.mode);
                }
            });
            io.emit('crash_update', crashState);
            io.emit('crash_live_bets', activeBets);
            setTimeout(startCrash, 4000);
        } else {
            io.emit('crash_update', crashState);
        }
    }, 100);
}
startCrash();

// --- 5. СОКЕТЫ (ИГРЫ И АДМИНКА) ---
io.on('connection', (socket) => {
    socket.on('init_user', async (data) => {
        let user = await User.findOne({ id: data.id });
        if (!user) {
            user = new User({ id: data.id, tgName: data.username, photoUrl: data.photo });
            await user.save();
        } else if (data.photo && user.photoUrl !== data.photo) {
            user.photoUrl = data.photo; await user.save();
        }
        if (user.banned) return socket.emit('alert_sound', { msg: '❌ Вы заблокированы', type: 'error' });
        socket.userId = user.id;
        socket.emit('user_data', user);
        socket.emit('crash_update', crashState);
        socket.emit('global_history_update', globalHistory);
    });

    socket.on('claim_demo', async () => {
        let u = await User.findOne({ id: socket.userId });
        let now = new Date();
        if (!u.lastDemoClaim || (now - u.lastDemoClaim) > 86400000) {
            u.demoBal += 200; u.lastDemoClaim = now; await u.save();
            socket.emit('user_data', u); socket.emit('alert_sound', { msg: '✅ +200 DEMO TON!', type: 'money' });
        } else {
            socket.emit('alert_sound', { msg: '❌ Только раз в 24 часа!', type: 'error' });
        }
    });

    socket.on('crash_bet', async (d) => {
        if (crashState.status !== 'waiting') return;
        let u = await User.findOne({ id: socket.userId });
        if (!u || u.banned) return;
        let key = d.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[key] >= d.bet && d.bet >= 0.1) {
            u[key] -= d.bet;
            if(d.mode === 'real') { u.games++; u.spent += d.bet; }
            await u.save();
            activeBets.push({ id: u.id, tgName: u.tgName, photoUrl: u.photoUrl, bet: d.bet, mode: d.mode, status: 'active', win: 0 });
            socket.emit('user_data', u);
            io.emit('crash_live_bets', activeBets);
        }
    });

    socket.on('crash_cashout', async () => {
        let b = activeBets.find(x => x.id === socket.userId && x.status === 'active');
        if (b && crashState.status === 'flying') {
            b.status = 'cashed'; b.win = b.bet * crashState.mult;
            let u = await User.findOne({ id: b.id });
            let key = b.mode === 'real' ? 'realBal' : 'demoBal';
            u[key] += b.win;
            if(b.mode === 'real') u.wins++;
            await u.save();
            socket.emit('user_data', u);
            socket.emit('alert_sound', { msg: `✅ Вывели +${b.win.toFixed(2)}`, type: 'money' });
            io.emit('crash_live_bets', activeBets);
            addGlobalHistory(u, 'Crash', b.bet, b.win, true, b.mode);
        }
    });

    socket.on('mines_start', async (d) => {
        let u = await User.findOne({ id: socket.userId });
        if (!u || u.banned) return;
        let key = d.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[key] >= d.bet && d.bet >= 0.1) {
            u[key] -= d.bet;
            if(d.mode === 'real') { u.games++; u.spent += d.bet; }
            await u.save();
            let field = Array(25).fill('safe');
            let bCount = 0;
            while(bCount < d.minesCount) { let r = Math.floor(Math.random() * 25); if(field[r] === 'safe') { field[r] = 'mine'; bCount++; } }
            await MinesSession.findOneAndDelete({ userId: u.id });
            await new MinesSession({ userId: u.id, bet: d.bet, mode: d.mode, field, minesCount: d.minesCount }).save();
            socket.emit('user_data', u); socket.emit('mines_started');
        }
    });

    socket.on('mines_open', async (idx) => {
        let s = await MinesSession.findOne({ userId: socket.userId });
        if (!s) return;
        let set = await Settings.findOne({ id: 'main' });
        if (s.mode === 'real' && Math.random() * 100 > set.minesWinChance && s.steps > 1) s.field[idx] = 'mine';
        if (s.field[idx] === 'mine') {
            socket.emit('mines_boom', s.field);
            let u = await User.findOne({ id: socket.userId });
            addGlobalHistory(u, 'Mines', s.bet, 0, false, s.mode);
            await MinesSession.findOneAndDelete({ userId: socket.userId });
        } else {
            s.steps++;
            let base = s.minesCount === 3 ? 1.08 : (s.minesCount === 6 ? 1.25 : 1.7);
            s.mult = parseFloat((s.mult * base).toFixed(2));
            await s.save();
            socket.emit('mines_safe', { idx, mult: s.mult });
        }
    });

    socket.on('mines_cashout', async () => {
        let s = await MinesSession.findOne({ userId: socket.userId });
        if (s && s.steps > 0) {
            let u = await User.findOne({ id: socket.userId });
            let win = s.bet * s.mult;
            let key = s.mode === 'real' ? 'realBal' : 'demoBal';
            u[key] += win; if(s.mode === 'real') u.wins++;
            await u.save();
            socket.emit('user_data', u); socket.emit('mines_win');
            socket.emit('alert_sound', { msg: `✅ +${win.toFixed(2)}`, type: 'money' });
            addGlobalHistory(u, 'Mines', s.bet, win, true, s.mode);
            await MinesSession.findOneAndDelete({ userId: socket.userId });
        }
    });

    socket.on('coinflip_play', async (d) => {
        let u = await User.findOne({ id: socket.userId });
        if (!u || u.banned) return;
        let key = d.mode === 'real' ? 'realBal' : 'demoBal';
        if (u[key] >= d.bet && d.bet >= 0.1) {
            u[key] -= d.bet; if(d.mode === 'real') { u.games++; u.spent += d.bet; }
            let set = await Settings.findOne({ id: 'main' });
            let isWin = (Math.random() * 100) < set.coinflipWinChance;
            let winAmount = isWin ? d.bet * 1.9 : 0;
            if(isWin) { u[key] += winAmount; if(d.mode === 'real') u.wins++; }
            await u.save();
            socket.emit('user_data', u);
            socket.emit('coinflip_result', { win: isWin, resultSide: isWin ? d.side : (d.side === 'L' ? 'X' : 'L') });
            addGlobalHistory(u, 'Coinflip', d.bet, winAmount, isWin, d.mode);
        }
    });

    // ПРОМО И ВЫВОДЫ
    socket.on('activate_promo', async (code) => {
        let p = await Promo.findOne({ code: code.toUpperCase() });
        let u = await User.findOne({ id: socket.userId });
        if (!p || p.uses <= 0) return socket.emit('alert_sound', { msg: '❌ Код не найден', type: 'error' });
        if (p.activatedBy.includes(u.id)) return socket.emit('alert_sound', { msg: '❌ Уже активирован', type: 'error' });
        u.realBal += p.amount; p.uses--; p.activatedBy.push(u.id);
        await u.save(); await p.save();
        socket.emit('user_data', u); socket.emit('alert_sound', { msg: `✅ +${p.amount} TON (Реал)`, type: 'money' });
    });

    socket.on('withdraw_request', async (d) => {
        let u = await User.findOne({ id: socket.userId });
        if (u && u.realBal >= d.amount && d.amount >= 1) {
            u.realBal -= d.amount; await u.save();
            await new Withdraw({ userId: u.id, tgName: u.tgName, amount: d.amount, address: d.address }).save();
            socket.emit('user_data', u); socket.emit('alert_sound', { msg: '🚀 Заявка отправлена!', type: 'click' });
        }
    });

    // АДМИНКА
    socket.on('admin_req_data', async () => {
        const users = await User.find({});
        const withdraws = await Withdraw.find({ status: 'pending' });
        const settings = await Settings.findOne({ id: 'main' });
        socket.emit('admin_res_data', { users, withdraws, settings });
    });

    socket.on('admin_action', async (d) => {
        if(d.action === 'edit_bal') { let u = await User.findOne({ id: d.userId }); if(u) { u.realBal += parseFloat(d.amount); await u.save(); io.to(u.id).emit('user_data', u); } }
        if(d.action === 'ban') { let u = await User.findOne({ id: d.userId }); if(u) { u.banned = !u.banned; await u.save(); } }
        if(d.action === 'withdraw_approve') { let w = await Withdraw.findById(d.wId); if(w) { w.status = 'approved'; await w.save(); let u = await User.findOne({ id: w.userId }); if(u) { u.withdrawn += w.amount; await u.save(); } } }
        if(d.action === 'withdraw_reject') { let w = await Withdraw.findById(d.wId); if(w) { w.status = 'rejected'; await w.save(); let u = await User.findOne({ id: w.userId }); if(u) { u.realBal += w.amount; await u.save(); } } }
        if(d.action === 'create_promo') { await new Promo({ code: d.code.toUpperCase(), amount: parseFloat(d.amount), uses: parseInt(d.uses) }).save(); }
        if(d.action === 'save_settings') { let s = await Settings.findOne({ id: 'main' }); s.crashWinChance = d.crash; s.minesWinChance = d.mines; s.coinflipWinChance = d.coinflip; await s.save(); }
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
