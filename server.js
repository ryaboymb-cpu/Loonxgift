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

// Юзеры
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

// Промокоды
const PromoSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    reward: Number,
    uses: Number
});
const Promo = mongoose.model('Promo', PromoSchema);

// Заявки на вывод
const WithdrawSchema = new mongoose.Schema({
    userId: String,
    tgName: String,
    address: String,
    amount: Number,
    status: { type: String, default: 'pending' }, // pending, approve, reject
    date: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

// Активные сессии Минера (чтобы не абузили рестартами)
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

// === ГЛОБАЛЬНЫЕ ИГРОВЫЕ ПЕРЕМЕННЫЕ (RAM) ===
let crashState = { status: 'waiting', mult: 1.0, timer: 5, history: [] };
let crashBets = {}; // socketId: { userId, amount, mode, name }
let onlineCount = 0;

// === ЛОГИКА CRASH (Реалтайм цикл) ===
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
    // Алгоритм честного рандома
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
            
            // Рассылаем инфу о проигрыше тех, кто не забрал
            Object.values(crashBets).forEach(bet => {
                io.emit('live_bet', { game: '🚀 Crash', user: bet.name, amount: bet.amount, win: 0 });
            });

            io.emit('crash_update', crashState);
            setTimeout(runCrash, 3000);
        } else {
            io.emit('crash_update', crashState);
        }
    }, 100);
}
runCrash();

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
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

// === SOCKET.IO ОБРАБОТКА ===
io.on('connection', (socket) => {
    onlineCount++;
    io.emit('online_update', onlineCount);

    // Вход / Регистрация
    socket.on('init_user', async (data) => {
        try {
            let user = await User.findOne({ id: data.id });
            if (!user) {
                user = new User({
                    id: data.id,
                    tgName: data.username,
                    photoUrl: data.photo
                });
                await user.save();
            }
            socket.userId = data.id; // Привязываем ID к сокету
            socket.emit('user_data', user);
            socket.emit('crash_update', crashState);
        } catch (e) { console.error(e); }
    });

    // --- CRASH СТАВКА ---
    socket.on('crash_bet', async (d) => {
        if (crashState.status !== 'waiting') return;
        try {
            let user = await User.findOne({ id: socket.userId });
            let balKey = d.mode === 'real' ? 'realBal' : 'demoBal';
            
            if (user && user[balKey] >= d.bet && d.bet >= 0.1) {
                user[balKey] -= d.bet;
                user.games++;
                await user.save();
                
                crashBets[socket.id] = { 
                    userId: user.id, 
                    amount: d.bet, 
                    mode: d.mode, 
                    name: user.tgName 
                };
                
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
                io.emit('live_bet', { game: '🚀 Crash', user: user.tgName, amount: bet.amount, win: win });
            } catch (e) { console.error(e); }
        }
    });

    // --- MINES СТАВКА ---
    socket.on('mines_start', async (d) => {
        try {
            let user = await User.findOne({ id: socket.userId });
            let balKey = d.mode === 'real' ? 'realBal' : 'demoBal';
            
            if (user && user[balKey] >= d.bet && d.bet >= 0.1) {
                // Проверяем, нет ли уже активной игры
                await MinesSession.deleteOne({ userId: user.id });
                
                user[balKey] -= d.bet;
                user.games++;
                await user.save();
                
                const session = new MinesSession({
                    userId: user.id,
                    bet: d.bet,
                    mode: d.mode,
                    field: generateMinesField()
                });
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
                // Взрыв
                socket.emit('mines_boom', session.field);
                io.emit('live_bet', { game: '💣 Mines', user: (await User.findOne({id: socket.userId})).tgName, amount: session.bet, win: 0 });
                await MinesSession.deleteOne({ userId: socket.userId });
            } else {
                // Безопасно
                session.steps++;
                session.mult = mineMultipliers[session.steps - 1];
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
                io.emit('live_bet', { game: '💣 Mines', user: user.tgName, amount: session.bet, win: win });
                
                await MinesSession.deleteOne({ userId: socket.userId });
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
                socket.emit('alert', `✅ Промокод на ${promo.reward} TON активирован!`);
            } else {
                socket.emit('alert', '❌ Код недействителен или закончился');
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
                socket.emit('alert', '🚀 Заявка отправлена! Ожидайте проверки админом.');
            } else {
                socket.emit('alert', '❌ Недостаточно средств');
            }
        } catch (e) { console.error(e); }
    });

    // --- АДМИН ПАНЕЛЬ ---
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
                const newP = new Promo({ 
                    code: data.code.toUpperCase(), 
                    reward: data.reward, 
                    uses: data.uses 
                });
                await newP.save();
            }
            
            if (data.action === 'edit_balance') {
                let u = await User.findOne({ id: data.userId });
                if (u) {
                    if (data.type === 'add') u.realBal += data.amount;
                    else u.realBal -= data.amount;
                    await u.save();
                    // Если юзер онлайн, обновляем ему баланс мгновенно
                    io.emit('update_force', { id: u.id, bal: u.realBal }); 
                }
            }
            
            if (data.action === 'process_withdraw') {
                let req = await Withdraw.findById(data.reqId);
                if (req) {
                    req.status = data.status;
                    await req.save();
                    if (data.status === 'reject') {
                        let u = await User.findOne({ id: req.userId });
                        u.realBal += req.amount;
                        await u.save();
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
