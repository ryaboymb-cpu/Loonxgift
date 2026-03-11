const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGO_URI).then(() => console.log('✅ DB Connected'));

// --- СХЕМЫ ---
const UserSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    tgName: String,
    photoUrl: String,
    realBal: { type: Number, default: 0 },
    demoBal: { type: Number, default: 200 }, // Сразу 200 демо новым
    games: { type: Number, default: 0 },     // Только реал
    wins: { type: Number, default: 0 },      // Только реал
    spent: { type: Number, default: 0 },
    withdrawn: { type: Number, default: 0 },
    lastDemo: { type: Date, default: null },
    wallet: { type: String, default: 'Не привязан' },
    banned: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const WithdrawSchema = new mongoose.Schema({
    userId: String,
    tgName: String,
    amount: Number,
    address: String,
    status: { type: String, default: 'pending' }, // pending, approved, rejected
    date: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

const PromoSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    reward: Number,
    uses: Number,
    usedBy: [String] // ID пользователей, которые уже ввели
});
const Promo = mongoose.model('Promo', PromoSchema);

// Настройки шансов (RTP)
const SettingsSchema = new mongoose.Schema({
    id: { type: String, default: 'main' },
    crashWinChance: { type: Number, default: 40 }, 
    minesWinChance: { type: Number, default: 45 },
    coinflipWinChance: { type: Number, default: 40 }
});
const Settings = mongoose.model('Settings', SettingsSchema);

async function initSettings() {
    let s = await Settings.findOne({ id: 'main' });
    if (!s) await new Settings({ id: 'main' }).save();
}
initSettings();

const MinesSessionSchema = new mongoose.Schema({
    userId: String, bet: Number, mode: String, field: Array, steps: { type: Number, default: 0 }, minesCount: Number, mult: { type: Number, default: 1.0 }
});
const MinesSession = mongoose.model('MinesSession', MinesSessionSchema);

app.use(express.static('public'));

// --- ИСТОРИЯ И CRASH ---
let globalHistory = [];
function addGlobalHistory(user, game, bet, winAmount, isWin, mode) {
    if (mode === 'real') { // В историю профиля и глобал только РЕАЛ
        globalHistory.unshift({ tgName: user.tgName, photoUrl: user.photoUrl, game, bet, win: winAmount, isWin });
        if (globalHistory.length > 5) globalHistory.pop();
        io.emit('global_history_update', globalHistory);
    }
}

let crashState = { status: 'waiting', mult: 1.0, timer: 5, history: [] };
let crashBets = {}; 

async function runCrash() {
    crashState.status = 'waiting'; crashState.timer = 5; crashState.mult = 1.0; crashBets = {};
    io.emit('crash_update', crashState);
    io.emit('crash_live_bets', Object.values(crashBets));

    let waitTimer = setInterval(async () => {
        crashState.timer--;
        io.emit('crash_update', crashState);
        if (crashState.timer <= 0) {
            clearInterval(waitTimer);
            
            // ДИНАМИЧЕСКИЙ ШАНС
            let s = await Settings.findOne({ id: 'main' });
            let chance = s ? s.crashWinChance : 40;
            let hasRealBets = Object.values(crashBets).some(b => b.mode === 'real');
            
            let crashPoint = 1.0;
            if (hasRealBets) {
                // Если есть ставки, шанс слива выше (режем кэфы)
                crashPoint = (Math.random() * 100 < chance) ? (1 + Math.random() * 1.5) : 1.0;
            } else {
                // Никто не ставит - показываем красивые иксы для байта
                crashPoint = (Math.random() * 100 < 70) ? (1.5 + Math.random() * 5) : 1.0;
            }

            startFlight(parseFloat(crashPoint.toFixed(2)));
        }
    }, 1000);
}

function startFlight(targetPoint) {
    crashState.status = 'flying';
    let flyInterval = setInterval(() => {
        crashState.mult += 0.01 + (crashState.mult * 0.003); 
        
        if (crashState.mult >= targetPoint || targetPoint === 1.0) {
            clearInterval(flyInterval);
            crashState.status = 'crashed';
            crashState.history.unshift(crashState.mult.toFixed(2));
            if(crashState.history.length > 6) crashState.history.pop();
            
            for (let id in crashBets) {
                if (crashBets[id].status === 'flying') {
                    crashBets[id].status = 'lost';
                    User.findOne({ id: crashBets[id].userId }).then(u => {
                        if(u) addGlobalHistory(u, 'CRASH', crashBets[id].bet, 0, false, crashBets[id].mode);
                    });
                }
            }
            io.emit('crash_update', crashState);
            io.emit('crash_live_bets', Object.values(crashBets));
            setTimeout(runCrash, 3000);
        } else {
            io.emit('crash_update', crashState);
        }
    }, 70); // Чуть быстрее для динамики
}
runCrash();

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('init_user', async (data) => {
        let user = await User.findOne({ id: data.id });
        if (!user) user = new User({ id: data.id, tgName: data.username, photoUrl: data.photo });
        else { user.tgName = data.username; user.photoUrl = data.photo; }
        await user.save();
        
        if (user.banned) return socket.emit('alert_sound', { msg: '❌ Вы заблокированы', type: 'error' });
        
        socket.userId = user.id;
        socket.emit('user_data', user);
        socket.emit('crash_update', crashState);
        socket.emit('global_history_update', globalHistory);
    });

    socket.on('claim_demo', async () => {
        let user = await User.findOne({ id: socket.userId });
        if (!user) return;
        let now = new Date();
        if(!user.lastDemo || (now - user.lastDemo) > 86400000) {
            user.demoBal += 200; user.lastDemo = now; await user.save();
            socket.emit('user_data', user);
            socket.emit('alert_sound', { msg: '✅ Начислено 200 DEMO!', type: 'money' });
        } else {
            socket.emit('alert_sound', { msg: '❌ Доступно раз в 24 часа!', type: 'error' });
        }
    });

    // --- ИГРЫ ---
    socket.on('crash_bet', async (data) => {
        if (crashState.status !== 'waiting') return;
        let user = await User.findOne({ id: socket.userId });
        if (!user || user.banned) return;
        let key = data.mode === 'real' ? 'realBal' : 'demoBal';

        if (user[key] >= data.bet && data.bet >= 0.1) {
            user[key] -= data.bet; 
            if(data.mode === 'real') { user.games++; user.spent += data.bet; }
            await user.save();
            
            crashBets[socket.id] = { userId: user.id, tgName: user.tgName, photoUrl: user.photoUrl, bet: data.bet, mode: data.mode, status: 'flying', win: 0 };
            socket.emit('user_data', user);
            io.emit('crash_live_bets', Object.values(crashBets));
        }
    });

    socket.on('crash_cashout', async () => {
        if (crashBets[socket.id] && crashState.status === 'flying' && crashBets[socket.id].status === 'flying') {
            let b = crashBets[socket.id];
            b.status = 'cashed'; b.win = b.bet * crashState.mult;
            let user = await User.findOne({ id: b.userId });
            
            let key = b.mode === 'real' ? 'realBal' : 'demoBal';
            user[key] += b.win; 
            if(b.mode === 'real') user.wins++; 
            await user.save();
            
            socket.emit('user_data', user);
            socket.emit('alert_sound', { msg: `✅ Вывели: +${b.win.toFixed(2)}`, type: 'money' });
            io.emit('crash_live_bets', Object.values(crashBets));
            addGlobalHistory(user, 'CRASH', b.bet, b.win, true, b.mode);
        }
    });

    socket.on('mines_start', async (data) => {
        let user = await User.findOne({ id: socket.userId });
        if (!user || user.banned) return;
        let key = data.mode === 'real' ? 'realBal' : 'demoBal';

        if (user[key] >= data.bet && data.bet >= 0.1) {
            user[key] -= data.bet; 
            if(data.mode === 'real') { user.games++; user.spent += data.bet; }
            await user.save();
            
            let field = Array(25).fill('safe');
            let bombs = 0; 
            while(bombs < data.minesCount) { 
                let r = Math.floor(Math.random() * 25); 
                if(field[r] === 'safe'){ field[r] = 'mine'; bombs++; }
            }
            
            await MinesSession.findOneAndDelete({ userId: user.id });
            await new MinesSession({ userId: user.id, bet: data.bet, mode: data.mode, field: field, minesCount: data.minesCount }).save();
            socket.emit('user_data', user);
            socket.emit('mines_started');
        }
    });

    socket.on('mines_open', async (index) => {
        let s = await MinesSession.findOne({ userId: socket.userId });
        if (!s) return;
        
        let settings = await Settings.findOne({ id: 'main' });
        // Коррекция на слив, если шанс не прошел (подменяем сейф на мину визуально для сервера)
        if (s.mode === 'real' && Math.random() * 100 > settings.minesWinChance && s.steps > 1) {
            s.field[index] = 'mine'; 
        }

        if (s.field[index] === 'mine') {
            socket.emit('mines_boom', s.field);
            let u = await User.findOne({ id: socket.userId });
            addGlobalHistory(u, 'MINES', s.bet, 0, false, s.mode);
            await MinesSession.findOneAndDelete({ userId: socket.userId });
        } else {
            s.steps++;
            // Коэффициенты зависят от кол-ва мин
            let base = s.minesCount === 3 ? 1.08 : (s.minesCount === 6 ? 1.25 : 1.7);
            s.mult = parseFloat((s.mult * base).toFixed(2));
            await s.save();
            socket.emit('mines_safe', { idx: index, mult: s.mult });
        }
    });

    socket.on('mines_cashout', async () => {
        let s = await MinesSession.findOne({ userId: socket.userId });
        if (s && s.steps > 0) {
            let u = await User.findOne({ id: socket.userId });
            let win = s.bet * s.mult;
            let key = s.mode === 'real' ? 'realBal' : 'demoBal';
            u[key] += win; 
            if(s.mode === 'real') u.wins++; 
            await u.save();
            
            socket.emit('user_data', u);
            socket.emit('mines_win', { win: win.toFixed(2) });
            socket.emit('alert_sound', { msg: `✅ +${win.toFixed(2)}`, type: 'money' });
            addGlobalHistory(u, 'MINES', s.bet, win, true, s.mode);
            await MinesSession.findOneAndDelete({ userId: socket.userId });
        }
    });

    socket.on('coinflip_play', async (data) => {
        let user = await User.findOne({ id: socket.userId });
        if (!user || user.banned) return;
        let key = data.mode === 'real' ? 'realBal' : 'demoBal';

        if (user[key] >= data.bet && data.bet >= 0.1) {
            user[key] -= data.bet; 
            if(data.mode === 'real') { user.games++; user.spent += data.bet; }
            
            let settings = await Settings.findOne({ id: 'main' });
            const isWin = (Math.random() * 100) < settings.coinflipWinChance; 
            
            let winAmount = 0;
            if(isWin) {
                winAmount = data.bet * 1.9;
                user[key] += winAmount; 
                if(data.mode === 'real') user.wins++;
            }
            await user.save();
            
            socket.emit('user_data', user);
            socket.emit('coinflip_result', { win: isWin, resultSide: isWin ? data.side : (data.side === 'L' ? 'X' : 'L'), winAmount });
            addGlobalHistory(user, 'COINFLIP', data.bet, winAmount, isWin, data.mode);
        }
    });

    // --- ПРОМО И ВЫВОД ---
    socket.on('activate_promo', async (code) => {
        let promo = await Promo.findOne({ code: code.toUpperCase() });
        let user = await User.findOne({ id: socket.userId });
        
        if (!promo || promo.uses <= 0) return socket.emit('alert_sound', { msg: '❌ Код не найден или исчерпан', type: 'error' });
        if (promo.usedBy.includes(user.id)) return socket.emit('alert_sound', { msg: '❌ Вы уже активировали этот код', type: 'error' });

        user.realBal += promo.reward; 
        promo.uses--; 
        promo.usedBy.push(user.id);
        await user.save(); await promo.save();
        socket.emit('user_data', user);
        socket.emit('alert_sound', { msg: `✅ Успешно! +${promo.reward} TON (Реал)`, type: 'money' });
    });

    socket.on('withdraw_request', async (data) => {
        let user = await User.findOne({ id: socket.userId });
        if (user && user.realBal >= data.amount && data.amount > 0) {
            user.realBal -= data.amount; await user.save();
            await new Withdraw({ userId: user.id, tgName: user.tgName, address: data.address, amount: data.amount }).save();
            socket.emit('user_data', user);
            socket.emit('alert_sound', { msg: '🚀 Заявка на вывод создана!', type: 'click' });
        }
    });

    // --- АДМИНКА ---
    socket.on('admin_req_data', async () => {
        let users = await User.find({});
        let withdraws = await Withdraw.find({ status: 'pending' });
        let settings = await Settings.findOne({ id: 'main' });
        socket.emit('admin_res_data', { users, withdraws, settings });
    });

    socket.on('admin_action', async (data) => {
        if(data.action === 'edit_bal') {
            let u = await User.findOne({ id: data.userId });
            if(u) { u.realBal += parseFloat(data.amount); await u.save(); io.to(u.id).emit('user_data', u); }
        }
        if(data.action === 'ban') {
            let u = await User.findOne({ id: data.userId });
            if(u) { u.banned = !u.banned; await u.save(); }
        }
        if(data.action === 'withdraw_approve') {
            let w = await Withdraw.findById(data.wId);
            if(w) { 
                w.status = 'approved'; await w.save(); 
                let u = await User.findOne({ id: w.userId });
                if(u) { u.withdrawn += w.amount; await u.save(); }
            }
        }
        if(data.action === 'withdraw_reject') {
            let w = await Withdraw.findById(data.wId);
            if(w) {
                w.status = 'rejected'; await w.save();
                let u = await User.findOne({ id: w.userId });
                if(u) { u.realBal += w.amount; await u.save(); } // Возврат
            }
        }
        if(data.action === 'create_promo') {
            await new Promo({ code: data.code.toUpperCase(), reward: data.amount, uses: data.uses }).save();
        }
        if(data.action === 'save_settings') {
            let s = await Settings.findOne({ id: 'main' });
            s.crashWinChance = data.crash; s.minesWinChance = data.mines; s.coinflipWinChance = data.coinflip;
            await s.save();
        }
        socket.emit('alert_sound', { msg: '✅ Выполнено', type: 'click' });
    });
});

server.listen(PORT, () => console.log(`✅ Порт ${PORT}`));
