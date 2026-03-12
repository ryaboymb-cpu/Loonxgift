try { require('dotenv').config(); } catch (e) { console.log("Dotenv не найден, используем переменные среды"); }
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

// Подключение к БД
mongoose.connect(MONGO_URI).then(() => console.log('✅ База данных подключена')).catch(err => console.error('❌ Ошибка БД:', err));

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

// Инициализация настроек
async function initSettings() {
    let s = await Settings.findOne({ id: 'main' });
    if (!s) await new Settings({ id: 'main' }).save();
}
initSettings();

// --- БОТ TELEGRAM ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🪙 Добро пожаловать в Loonx Gift!\nЛучшие игры уже ждут тебя.`, {
        reply_markup: { inline_keyboard: [[{ text: '🫧играть🫧', web_app: { url: WEB_APP_URL } }]] }
    });
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `💎 *Наши контакты:*\n\n• Creator = @tonfrm\n• Channel = @Loonxnews\n• Support = @LoonxGift_Support\n• Bags = @MsgP2P`, { parse_mode: 'Markdown' });
});

// --- ГЛОБАЛЬНЫЕ ДАННЫЕ ИГР ---
let crashState = { status: 'waiting', timer: 10, mult: 1.0 };
let crashActiveBets = []; // Лайв ставки
let globalHistory = []; // История последних игр

function addHistory(user, game, bet, win, isWin, mode) {
    if (mode === 'real') {
        globalHistory.unshift({ tgName: user.tgName, photoUrl: user.photoUrl, game, bet, win, isWin });
        if (globalHistory.length > 15) globalHistory.pop();
        io.emit('history_update', globalHistory);
    }
}

// --- ЛОГИКА CRASH ---
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
            let targetMult = isWin ? (1.5 + Math.random() * 8.5) : (1.0 + Math.random() * 0.2); // Подкрут
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
            
            // Проигрыш тех, кто не забрал
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

// --- СЕССИИ МИНОК ---
const activeMines = new Map();

// --- СОКЕТЫ (ОСНОВА + АДМИНКА) ---
io.on('connection', (socket) => {
    io.emit('online_count', io.engine.clientsCount);
    socket.on('disconnect', () => io.emit('online_count', io.engine.clientsCount));

    socket.on('init_user', async (data) => {
        let u = await User.findOneAndUpdate(
            { id: data.id }, 
            { tgName: data.username, photoUrl: data.photo }, 
            { upsert: true, new: true }
        );
        if (u.banned) return socket.emit('alert', { msg: '❌ Аккаунт заблокирован', type: 'error' });
        
        socket.userId = u.id;
        socket.emit('user_data', u);
        socket.emit('crash_update', crashState);
        socket.emit('crash_bets_update', crashActiveBets);
        socket.emit('history_update', globalHistory);
    });

    // === CRASH СТАВКИ ===
    socket.on('crash_bet', async (data) => {
        if (crashState.status !== 'waiting') return;
        let u = await User.findOne({ id: socket.userId });
        let balType = data.mode === 'real' ? 'realBal' : 'demoBal';
        
        if (u[balType] >= data.bet && data.bet > 0) {
            u[balType] -= data.bet;
            if (data.mode === 'real') { u.games++; u.spent += data.bet; }
            await u.save();
            
            crashActiveBets.push({
                userId: u.id, tgName: u.tgName, photoUrl: u.photoUrl,
                bet: data.bet, mode: data.mode, status: 'active', win: 0
            });
            
            socket.emit('user_data', u);
            io.emit('crash_bets_update', crashActiveBets);
        }
    });

    socket.on('crash_cashout', async () => {
        let bet = crashActiveBets.find(b => b.userId === socket.userId && b.status === 'active');
        if (bet && crashState.status === 'flying') {
            bet.status = 'cashed';
            bet.win = bet.bet * crashState.mult;
            
            let u = await User.findOne({ id: socket.userId });
            let balType = bet.mode === 'real' ? 'realBal' : 'demoBal';
            u[balType] += bet.win;
            if (bet.mode === 'real') u.wins++;
            await u.save();
            
            socket.emit('user_data', u);
            socket.emit('alert', { msg: `✅ Забрал: ${bet.win.toFixed(2)}`, type: 'success' });
            io.emit('crash_bets_update', crashActiveBets);
            addHistory(u, 'Crash', bet.bet, bet.win, true, bet.mode);
        }
    });

    // === MINES ===
    socket.on('mines_start', async (data) => {
        let u = await User.findOne({ id: socket.userId });
        let balType = data.mode === 'real' ? 'realBal' : 'demoBal';
        
        if (u[balType] >= data.bet && data.bet > 0) {
            u[balType] -= data.bet;
            if (data.mode === 'real') { u.games++; u.spent += data.bet; }
            await u.save();
            
            let field = Array(25).fill('safe');
            let minesPlaced = 0;
            while(minesPlaced < data.minesCount) {
                let r = Math.floor(Math.random() * 25);
                if(field[r] === 'safe') { field[r] = 'mine'; minesPlaced++; }
            }
            
            activeMines.set(socket.userId, { bet: data.bet, mode: data.mode, field, mines: data.minesCount, steps: 0, mult: 1.0 });
            socket.emit('user_data', u);
            socket.emit('mines_started');
        }
    });

    socket.on('mines_open', async (idx) => {
        let game = activeMines.get(socket.userId);
        if (!game) return;
        
        let s = await Settings.findOne({ id: 'main' });
        // Подкрут (RTP)
        if (game.mode === 'real' && Math.random() * 100 > s.minesWinChance && game.steps > 1) {
            game.field[idx] = 'mine';
        }

        if (game.field[idx] === 'mine') {
            socket.emit('mines_boom', game.field);
            let u = await User.findOne({ id: socket.userId });
            addHistory(u, 'Mines', game.bet, 0, false, game.mode);
            activeMines.delete(socket.userId);
        } else {
            game.steps++;
            let base = game.mines === 3 ? 1.08 : (game.mines === 6 ? 1.25 : 1.7);
            game.mult = parseFloat((game.mult * base).toFixed(2));
            socket.emit('mines_safe', { idx, mult: game.mult });
        }
    });

    socket.on('mines_cashout', async () => {
        let game = activeMines.get(socket.userId);
        if (game && game.steps > 0) {
            let u = await User.findOne({ id: socket.userId });
            let win = game.bet * game.mult;
            let balType = game.mode === 'real' ? 'realBal' : 'demoBal';
            
            u[balType] += win;
            if (game.mode === 'real') u.wins++;
            await u.save();
            
            socket.emit('user_data', u);
            socket.emit('mines_win');
            socket.emit('alert', { msg: `✅ Вывел: ${win.toFixed(2)}`, type: 'success' });
            addHistory(u, 'Mines', game.bet, win, true, game.mode);
            activeMines.delete(socket.userId);
        }
    });

    // === COINFLIP ===
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

    // === ПРОМОКОДЫ ===
    socket.on('activate_promo', async (code) => {
        let p = await Promo.findOne({ code: code.toUpperCase() });
        let u = await User.findOne({ id: socket.userId });
        if (!p || p.uses <= 0) return socket.emit('alert', { msg: '❌ Код не найден или исчерпан', type: 'error' });
        if (p.activatedBy.includes(u.id)) return socket.emit('alert', { msg: '❌ Вы уже вводили этот код', type: 'error' });

        u.realBal += p.amount;
        p.uses--;
        p.activatedBy.push(u.id);
        await u.save(); await p.save();
        socket.emit('user_data', u);
        socket.emit('alert', { msg: `✅ +${p.amount} REAL`, type: 'success' });
    });

    // === АДМИНКА ===
    socket.on('admin_login', async (pass) => {
        if(pass === 'loonx777') {
            const users = await User.find({});
            const settings = await Settings.findOne({ id: 'main' });
            socket.emit('admin_data', { users, settings });
        }
    });

    socket.on('admin_action', async (data) => {
        if(data.action === 'save_rtp') {
            await Settings.findOneAndUpdate({ id: 'main' }, { 
                crashWinChance: data.crash, minesWinChance: data.mines, coinflipWinChance: data.coin 
            });
            socket.emit('alert', { msg: '✅ RTP сохранен!', type: 'success' });
        }
        if(data.action === 'ban') {
            let u = await User.findOne({ id: data.userId });
            u.banned = !u.banned;
            await u.save();
            socket.emit('alert', { msg: '✅ Статус бана изменен', type: 'success' });
        }
        if(data.action === 'add_bal') {
            let u = await User.findOne({ id: data.userId });
            u.realBal += parseFloat(data.amount);
            await u.save();
            io.to(u.id).emit('user_data', u); // обновляем юзеру
            socket.emit('alert', { msg: '✅ Баланс выдан', type: 'success' });
        }
        if(data.action === 'create_promo') {
            await new Promo({ code: data.code, amount: data.amount, uses: data.uses }).save();
            socket.emit('alert', { msg: '✅ Промокод создан', type: 'success' });
        }
    });
});

app.use(express.static('public'));
server.listen(process.env.PORT || 3000, () => console.log('🚀 Server is running full size'));
