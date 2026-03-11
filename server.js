const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- НАСТРОЙКИ ---
const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB успешно подключена'))
    .catch(err => console.error('❌ Ошибка подключения к БД:', err));

// --- СХЕМЫ БАЗЫ ДАННЫХ ---
const UserSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    tgName: String,
    photoUrl: String,
    realBal: { type: Number, default: 0 },
    demoBal: { type: Number, default: 1000 },
    games: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    lastDemo: { type: Date, default: null }
});
const User = mongoose.model('User', UserSchema);

const WithdrawSchema = new mongoose.Schema({
    userId: String,
    tgName: String,
    amount: Number,
    address: String,
    status: { type: String, default: 'pending' },
    date: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

const PromoSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    reward: Number,
    uses: Number
});
const Promo = mongoose.model('Promo', PromoSchema);

const MinesSessionSchema = new mongoose.Schema({
    userId: String,
    bet: Number,
    mode: String,
    field: Array,
    steps: { type: Number, default: 0 },
    mult: { type: Number, default: 1.0 }
});
const MinesSession = mongoose.model('MinesSession', MinesSessionSchema);

app.use(express.static('public'));

// --- ГЛОБАЛЬНАЯ ИСТОРИЯ СТАВОК ---
let globalHistory = [];
function addGlobalHistory(user, game, bet, winAmount, isWin) {
    globalHistory.unshift({ 
        tgName: user.tgName || "Игрок", 
        photoUrl: user.photoUrl, 
        game: game, 
        bet: bet, 
        win: winAmount, 
        isWin: isWin 
    });
    // Оставляем только 5 последних ставок
    if (globalHistory.length > 5) {
        globalHistory.pop();
    }
    io.emit('global_history_update', globalHistory);
}

// --- ЛОГИКА ИГРЫ CRASH ---
let crashState = { 
    status: 'waiting', 
    mult: 1.0, 
    timer: 5, 
    history: [] 
};
let crashBets = {}; // Храним ставки текущего раунда

function runCrash() {
    crashState.status = 'waiting';
    crashState.timer = 5;
    crashState.mult = 1.0;
    crashBets = {}; // Очищаем ставки перед новым раундом
    
    io.emit('crash_update', crashState);
    io.emit('crash_live_bets', Object.values(crashBets));

    let waitTimer = setInterval(() => {
        crashState.timer--;
        io.emit('crash_update', crashState);
        
        if (crashState.timer <= 0) {
            clearInterval(waitTimer);
            startFlight();
        }
    }, 1000);
}

function startFlight() {
    crashState.status = 'flying';
    // Шанс моментального взрыва 10%, иначе случайный икс
    let crashPoint = (Math.random() < 0.1) ? 1.0 : (1 + Math.random() * 4).toFixed(2); 
    
    let flyInterval = setInterval(() => {
        crashState.mult += 0.01 + (crashState.mult * 0.005); // Плавное ускорение
        
        if (crashState.mult >= crashPoint) {
            clearInterval(flyInterval);
            crashState.status = 'crashed';
            
            // Запись в историю множителей
            crashState.history.unshift(crashState.mult.toFixed(2));
            if(crashState.history.length > 6) {
                crashState.history.pop();
            }
            
            // Обработка тех, кто не успел забрать
            for (let socketId in crashBets) {
                if (crashBets[socketId].status === 'flying') {
                    crashBets[socketId].status = 'lost';
                    User.findOne({ id: crashBets[socketId].userId }).then(u => {
                        if(u) addGlobalHistory(u, 'CRASH', crashBets[socketId].bet, 0, false);
                    });
                }
            }
            
            io.emit('crash_update', crashState);
            io.emit('crash_live_bets', Object.values(crashBets));
            
            // Пауза перед следующим раундом
            setTimeout(runCrash, 3000);
        } else {
            io.emit('crash_update', crashState);
        }
    }, 100);
}
// Запускаем цикл игры при старте сервера
runCrash();

// --- СИСТЕМА SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    // 1. Авторизация и инициализация
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
            } else {
                user.tgName = data.username; 
                user.photoUrl = data.photo; 
                await user.save();
            }
            
            socket.userId = user.id;
            socket.emit('user_data', user);
            socket.emit('crash_update', crashState);
            socket.emit('crash_live_bets', Object.values(crashBets));
            socket.emit('global_history_update', globalHistory);
        } catch(error) { 
            console.error('Ошибка инициализации:', error); 
        }
    });

    // 2. Получение DEMO баланса
    socket.on('claim_demo', async () => {
        let user = await User.findOne({ id: socket.userId });
        if (!user) return;
        
        let now = new Date();
        // Проверка: прошло ли 24 часа
        if(!user.lastDemo || (now - user.lastDemo) > 86400000) {
            user.demoBal += 200; 
            user.lastDemo = now; 
            await user.save();
            socket.emit('user_data', user);
            socket.emit('alert_sound', { msg: '✅ Начислено 200 DEMO!', type: 'money' });
        } else {
            socket.emit('alert_sound', { msg: '❌ Можно получить раз в 24 часа!', type: 'error' });
        }
    });

    // 3. Игра: CRASH - Ставка
    socket.on('crash_bet', async (data) => {
        if (crashState.status !== 'waiting') return;
        
        let user = await User.findOne({ id: socket.userId });
        if (!user) return;

        let key = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (user[key] >= data.bet && data.bet >= 0.1) {
            user[key] -= data.bet; 
            user.games++; 
            await user.save();
            
            crashBets[socket.id] = { 
                userId: user.id, 
                tgName: user.tgName, 
                photoUrl: user.photoUrl, 
                bet: data.bet, 
                mode: data.mode, 
                status: 'flying', 
                win: 0 
            };
            
            socket.emit('user_data', user);
            io.emit('crash_live_bets', Object.values(crashBets));
        }
    });

    // 4. Игра: CRASH - Вывод (Cashout)
    socket.on('crash_cashout', async () => {
        if (crashBets[socket.id] && crashState.status === 'flying' && crashBets[socket.id].status === 'flying') {
            let betInfo = crashBets[socket.id];
            betInfo.status = 'cashed';
            betInfo.win = betInfo.bet * crashState.mult;
            
            let user = await User.findOne({ id: betInfo.userId });
            if (!user) return;

            let key = betInfo.mode === 'real' ? 'realBal' : 'demoBal';
            user[key] += betInfo.win; 
            user.wins++; 
            await user.save();
            
            socket.emit('user_data', user);
            socket.emit('alert_sound', { msg: `✅ Вывели: +${betInfo.win.toFixed(2)}`, type: 'money' });
            io.emit('crash_live_bets', Object.values(crashBets));
            addGlobalHistory(user, 'CRASH', betInfo.bet, betInfo.win, true);
        }
    });

    // 5. Игра: MINES - Старт (6 мин)
    const mineMults = [1.13, 1.35, 1.63, 1.98, 2.45, 3.05, 3.85, 4.90, 6.30, 8.20]; 
    socket.on('mines_start', async (data) => {
        let user = await User.findOne({ id: socket.userId });
        if (!user) return;

        let key = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (user[key] >= data.bet && data.bet >= 0.1) {
            user[key] -= data.bet; 
            user.games++; 
            await user.save();
            
            let field = Array(25).fill('safe');
            let bombsPlaced = 0; 
            // Ровно 6 мин, как ты просил
            while(bombsPlaced < 6) { 
                let randIndex = Math.floor(Math.random() * 25); 
                if(field[randIndex] === 'safe'){ 
                    field[randIndex] = 'mine'; 
                    bombsPlaced++; 
                }
            }
            
            await MinesSession.findOneAndDelete({ userId: user.id });
            const session = new MinesSession({ 
                userId: user.id, 
                bet: data.bet, 
                mode: data.mode, 
                field: field 
            });
            await session.save();
            
            socket.emit('user_data', user);
            socket.emit('mines_started');
        }
    });

    // 6. Игра: MINES - Открытие ячейки
    socket.on('mines_open', async (index) => {
        let session = await MinesSession.findOne({ userId: socket.userId });
        if (!session) return;
        
        if (session.field[index] === 'mine') {
            socket.emit('mines_boom', session.field);
            let user = await User.findOne({ id: socket.userId });
            if(user) addGlobalHistory(user, 'MINES', session.bet, 0, false);
            await MinesSession.findOneAndDelete({ userId: socket.userId });
        } else {
            session.steps++;
            session.mult = mineMults[session.steps - 1] || session.mult + 1.5;
            await session.save();
            socket.emit('mines_safe', { idx: index, mult: session.mult });
        }
    });

    // 7. Игра: MINES - Забрать выигрыш
    socket.on('mines_cashout', async () => {
        let session = await MinesSession.findOne({ userId: socket.userId });
        if (session && session.steps > 0) {
            let user = await User.findOne({ id: socket.userId });
            if (!user) return;

            let winAmount = session.bet * session.mult;
            let key = session.mode === 'real' ? 'realBal' : 'demoBal';
            
            user[key] += winAmount; 
            user.wins++; 
            await user.save();
            
            socket.emit('user_data', user);
            socket.emit('mines_win', { win: winAmount.toFixed(2) });
            socket.emit('alert_sound', { msg: `✅ Победа: +${winAmount.toFixed(2)}`, type: 'money' });
            
            addGlobalHistory(user, 'MINES', session.bet, winAmount, true);
            await MinesSession.findOneAndDelete({ userId: socket.userId });
        }
    });

    // 8. Игра: COINFLIP
    socket.on('coinflip_play', async (data) => {
        let user = await User.findOne({ id: socket.userId });
        if (!user) return;

        let key = data.mode === 'real' ? 'realBal' : 'demoBal';
        if (user[key] >= data.bet && data.bet >= 0.1) {
            user[key] -= data.bet; 
            user.games++;
            
            const isWin = Math.random() < 0.45; // 45% шанс победы
            let winAmount = 0;
            
            if(isWin) {
                winAmount = data.bet * 1.95;
                user[key] += winAmount; 
                user.wins++;
            }
            await user.save();
            
            socket.emit('user_data', user);
            socket.emit('coinflip_result', { 
                win: isWin, 
                resultSide: isWin ? data.side : (data.side === 'L' ? 'X' : 'L'), 
                winAmount: winAmount 
            });
            
            if(isWin) {
                socket.emit('alert_sound', { msg: `✅ Победа: +${winAmount.toFixed(2)}`, type: 'money' });
            }
            addGlobalHistory(user, 'COINFLIP', data.bet, winAmount, isWin);
        }
    });

    // 9. Активация промокода
    socket.on('activate_promo', async (code) => {
        let promo = await Promo.findOne({ code: code.toUpperCase() });
        let user = await User.findOne({ id: socket.userId });
        
        if (promo && promo.uses > 0 && user) {
            user.realBal += promo.reward; 
            promo.uses--; 
            await user.save(); 
            await promo.save();
            
            socket.emit('user_data', user);
            socket.emit('alert_sound', { msg: `✅ Успешно! +${promo.reward} TON`, type: 'money' });
        } else {
            socket.emit('alert_sound', { msg: '❌ Код недействителен или исчерпан', type: 'error' });
        }
    });

    // 10. Запрос на вывод
    socket.on('withdraw_request', async (data) => {
        let user = await User.findOne({ id: socket.userId });
        if (user && user.realBal >= data.amount && data.amount > 0) {
            user.realBal -= data.amount; 
            await user.save();
            
            const request = new Withdraw({ 
                userId: user.id, 
                tgName: user.tgName, 
                address: data.address, 
                amount: data.amount 
            });
            await request.save();
            
            socket.emit('user_data', user);
            socket.emit('alert_sound', { msg: '🚀 Заявка на вывод создана!', type: 'click' });
        }
    });

    // 11. Админ-панель: получение данных
    socket.on('admin_get_data', async () => {
        const users = await User.find({});
        socket.emit('admin_data_response', { users: users });
    });

    // 12. Админ-панель: действия (добавление баланса)
    socket.on('admin_action', async (data) => {
        if(data.action === 'edit_balance') {
            let user = await User.findOne({ id: data.userId });
            if(user) { 
                user.realBal += data.amount; 
                await user.save(); 
                io.to(user.id).emit('user_data', user); 
            }
        }
    });
});

// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, "🪙 Добро пожаловать в Loonx Gift!\nЛучшие игры уже ждут тебя.", {
            reply_markup: { 
                inline_keyboard: [[{ 
                    text: "🫧 Играть 🫧", 
                    web_app: { url: "https://loonxgift.onrender.com" } 
                }]] 
            }
        });
    });
    
    bot.onText(/\/help/, (msg) => {
        bot.sendMessage(msg.chat.id, "• Creator = @tonfrm\n\n• Channel and promo = @Loonxnews\n\n• Support = @LoonxGift_Support\n\n• Bags = @MsgP2P");
    });
}

server.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
