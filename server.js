const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ---
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ База данных LoonxGift подключена'))
    .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

// --- СХЕМЫ ДАННЫХ (MODELS) ---
const UserSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    tgName: String,
    photoUrl: String,
    realBal: { type: Number, default: 0 },
    demoBal: { type: Number, default: 1000 },
    games: { type: Number, default: 0 },
    wins: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

const PromoSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    reward: Number,
    uses: Number
});
const Promo = mongoose.model('Promo', PromoSchema);

const WithdrawSchema = new mongoose.Schema({
    userId: String,
    tgName: String,
    address: String,
    amount: Number,
    status: { type: String, default: 'pending' }, 
    date: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

const MinesSessionSchema = new mongoose.Schema({
    userId: String,
    bet: Number,
    mode: String,
    field: Array,
    mult: { type: Number, default: 1.0 },
    steps: { type: Number, default: 0 }
});
const MinesSession = mongoose.model('MinesSession', MinesSessionSchema);

app.use(express.static('public'));

// === ГЛОБАЛЬНЫЕ ИГРОВЫЕ ПЕРЕМЕННЫЕ ===
let crashState = { status: 'waiting', mult: 1.0, timer: 5, history: [] };
let crashBets = {}; // socketId: { userId, amount, mode, name }
let onlineCount = 0;

// === ЛОГИКА CRASH ===
function runCrash() {
    crashState.status = 'waiting';
    crashState.timer = 5;
    crashState.mult = 1.0;
    crashBets = {};
    io.emit('crash_update', crashState);

    let t = setInterval(() => {
        crashState.timer--;
        io.emit('crash_update', crashState);
        if (crashState.timer <= 0) {
            clearInterval(t);
            startCrashFlight();
        }
    }, 1000);
}

function startCrashFlight() {
    crashState.status = 'flying';
    let target = 1.0;
    let r = Math.random();
    if (r < 0.03) target = 1.0; 
    else if (r < 0.5) target = 1.1 + Math.random() * 0.9;
    else if (r < 0.8) target = 2.0 + Math.random() * 3.0;
    else target = 5.0 + Math.random() * 10.0;

    let flyTime = setInterval(() => {
        crashState.mult += 0.01 + (crashState.mult * 0.006);
        
        if (crashState.mult >= target) {
            clearInterval(flyTime);
            crashState.status = 'crashed';
            crashState.history.unshift(crashState.mult.toFixed(2));
            if(crashState.history.length > 8) crashState.history.pop();
            
            io.emit('crash_update', crashState);
            setTimeout(runCrash, 3000);
        } else {
            io.emit('crash_update', crashState);
        }
    }, 100);
}
runCrash();

// === ФУНКЦИИ ===
const mineMultipliers = [1.09, 1.25, 1.45, 1.68, 1.95, 2.25, 2.65, 3.10, 3.65, 4.30, 5.10];
function generateMinesField() {
    let field = Array(25).fill('safe');
    let bombs = 0;
    while(bombs < 3) {
        let r = Math.floor(Math.random() * 25);
        if(field[r] === 'safe') { field[r] = 'mine'; bombs++; }
    }
    return field;
}

// === SOCKET.IO ===
io.on('connection', (socket) => {
    onlineCount++;
    io.emit('online_update', onlineCount);

    socket.on('init_user', async (data) => {
        try {
            let user = await User.findOne({ id: data.id });
            if (!user) {
                user = new User({ id: data.id, tgName: data.username, photoUrl: data.photo });
                await user.save();
            }
            socket.userId = data.id; 
            socket.emit('user_data', user);
            socket.emit('crash_update', crashState);
        } catch (e) { console.error(e); }
    });

    // --- ДЕПОЗИТ (АВТОЗАЧИСЛЕНИЕ) ---
    socket.on('deposit_success', async (data) => {
        try {
            let user = await User.findOne({ id: socket.userId });
            if(user) {
                user.realBal += data.amount;
                await user.save();
                socket.emit('user_data', user);
            }
        } catch (e) { console.error(e); }
    });

    // --- CRASH ---
    socket.on('crash_bet', async (d) => {
        if (crashState.status !== 'waiting') return;
        try {
            let user = await User.findOne({ id: socket.userId });
            let balKey = d.mode === 'real' ? 'realBal' : 'demoBal';
            
            if (user && user[balKey] >= d.bet && d.bet >= 0.1) {
                user[balKey] -= d.bet;
                user.games++;
                await user.save();
                
                crashBets[socket.id] = { userId: user.id, amount: d.bet, mode: d.mode, name: user.tgName || "Игрок" };
                socket.emit('user_data', user);
            }
        } catch (e) { console.error(e); }
    });

    socket.on('crash_cashout', async () => {
        let bet = crashBets[socket.id];
        if (bet && crashState.status === 'flying') {
            try {
                let user = await User.findOne({ id: bet.userId });
                let win = bet.amount * crashState.mult;
                let balKey = bet.mode === 'real' ? 'realBal' : 'demoBal';
                
                user[balKey] += win;
                user.wins++;
                await user.save();
                
                delete crashBets[socket.id];
                
                socket.emit('user_data', user);
                socket.emit('crash_win', { win: win.toFixed(2), mult: crashState.mult.toFixed(2) });
                io.emit('live_bet', { user: user.tgName || "Игрок", amount: bet.amount, win: win });
            } catch (e) { console.error(e); }
        }
    });

    // --- MINES ---
    socket.on('mines_start', async (d) => {
        try {
            let user = await User.findOne({ id: socket.userId });
            let balKey = d.mode === 'real' ? 'realBal' : 'demoBal';
            
            if (user && user[balKey] >= d.bet && d.bet >= 0.1) {
                await MinesSession.deleteOne({ userId: user.id });
                user[balKey] -= d.bet;
                user.games++;
                await user.save();
                
                const session = new MinesSession({ userId: user.id, bet: d.bet, mode: d.mode, field: generateMinesField() });
                await session.save();
                
                socket.emit('user_data', user);
                socket.emit('mines_ready');
            }
        } catch (e) { console.error(e); }
    });

    socket.on('mines_open', async (idx) => {
        try {
            let session = await MinesSession.findOne({ userId: socket.userId });
            if (!session) return;

            if (session.field[idx] === 'mine') {
                socket.emit('mines_boom', session.field);
                await MinesSession.deleteOne({ userId: socket.userId });
            } else {
                session.steps++;
                session.mult = mineMultipliers[session.steps - 1] || 5.10;
                await session.save();
                socket.emit('mines_safe', { idx: idx, mult: session.mult });
            }
        } catch (e) { console.error(e); }
    });

    socket.on('mines_cashout', async () => {
        try {
            let session = await MinesSession.findOne({ userId: socket.userId });
            if (session && session.steps > 0) {
                let user = await User.findOne({ id: socket.userId });
                let win = session.bet * session.mult;
                let balKey = session.mode === 'real' ? 'realBal' : 'demoBal';
                
                user[balKey] += win;
                user.wins++;
                await user.save();
                
                socket.emit('user_data', user);
                socket.emit('mines_win', { win: win.toFixed(2) });
                await MinesSession.deleteOne({ userId: socket.userId });
            }
        } catch (e) { console.error(e); }
    });

    // --- COINFLIP (35% ШАНС ПОБЕДЫ) ---
    socket.on('coinflip_play', async (d) => {
        try {
            let user = await User.findOne({ id: socket.userId });
            let balKey = d.mode === 'real' ? 'realBal' : 'demoBal';
            
            if (user && user[balKey] >= d.bet && d.bet >= 0.1) {
                user[balKey] -= d.bet; // Списываем ставку
                user.games++;
                
                // Логика 35% шанса на победу
                const isWin = Math.random() < 0.35; // 35% true, 65% false
                
                let resultSide;
                if(isWin) {
                    resultSide = d.side; // Юзер угадал
                    let winAmount = d.bet * 1.95; // Кэф х1.95 (чтобы казино тоже забирало процент)
                    user[balKey] += winAmount;
                    user.wins++;
                } else {
                    resultSide = d.side === 'L' ? 'X' : 'L'; // Юзер не угадал
                }
                
                await user.save();
                socket.emit('user_data', user);
                
                // Отправляем результат клиенту
                socket.emit('coinflip_result', {
                    win: isWin,
                    resultSide: resultSide,
                    winAmount: isWin ? (d.bet * 1.95).toFixed(2) : 0
                });
            }
        } catch (e) { console.error(e); }
    });

    // --- ПРОМОКОДЫ ---
    socket.on('activate_promo', async (code) => {
        try {
            let promo = await Promo.findOne({ code: code.toUpperCase() });
            let user = await User.findOne({ id: socket.userId });
            
            if (promo && promo.uses > 0 && user) {
                user.realBal += promo.reward;
                promo.uses--;
                await user.save();
                await promo.save();
                socket.emit('user_data', user);
                socket.emit('alert', `✅ Активировано! +${promo.reward} TON`);
            } else {
                socket.emit('alert', '❌ Код недействителен');
            }
        } catch (e) { console.error(e); }
    });

    // --- ВЫВОД СРЕДСТВ ---
    socket.on('withdraw_request', async (data) => {
        try {
            let user = await User.findOne({ id: socket.userId });
            if (user && user.realBal >= data.amount && data.amount > 0) {
                user.realBal -= data.amount;
                await user.save();
                
                const req = new Withdraw({
                    userId: user.id,
                    tgName: user.tgName,
                    address: data.address,
                    amount: data.amount
                });
                await req.save();
                
                socket.emit('user_data', user);
                socket.emit('alert', '🚀 Заявка создана! Ожидайте админа.');
            }
        } catch (e) { console.error(e); }
    });

    // --- АДМИНКА ---
    socket.on('admin_get_data', async () => {
        try {
            const allUsers = await User.find({});
            const pendingWithdraws = await Withdraw.find({ status: 'pending' });
            socket.emit('admin_data_response', { users: allUsers, withdraws: pendingWithdraws });
        } catch (e) { console.error(e); }
    });

    socket.on('admin_action', async (data) => {
        try {
            if (data.action === 'create_promo') {
                const newP = new Promo({ code: data.code.toUpperCase(), reward: data.reward, uses: data.uses });
                await newP.save();
            }
            if (data.action === 'edit_balance') {
                let u = await User.findOne({ id: data.userId });
                if (u) {
                    if (data.type === 'add') u.realBal += data.amount;
                    else u.realBal -= data.amount;
                    await u.save();
                    // Отправляем в сокет принудительное обновление если юзер онлайн
                    io.to(u.id).emit('user_data', u); 
                }
            }
            if (data.action === 'process_withdraw') {
                let req = await Withdraw.findById(data.reqId); // Ищем заявку по _id в монго
                if (req) {
                    req.status = data.status;
                    await req.save();
                    if (data.status === 'reject') {
                        let u = await User.findOne({ id: req.userId });
                        if(u) {
                            u.realBal += req.amount; // Возвращаем деньги
                            await u.save();
                            io.to(req.userId).emit('user_data', u); 
                        }
                    }
                }
            }
        } catch (e) { console.error(e); }
    });

    socket.on('disconnect', () => {
        onlineCount--;
        io.emit('online_update', onlineCount);
        delete crashBets[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
