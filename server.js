const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Подключение к MongoDB
mongoose.connect('mongodb+srv://твой_юзер:твой_пароль@твой_кластер.mongodb.net/loonx?retryWrites=true&w=majority')
    .then(() => console.log('MongoDB подключена'))
    .catch(err => console.error('Ошибка MongoDB:', err));

// Модели
const userSchema = new mongoose.Schema({
    tgId: { type: Number, required: true, unique: true },
    firstName: String,
    avatar: String,
    balance: { type: Number, default: 0 },
    demo_balance: { type: Number, default: 10000 },
    isAdmin: { type: Boolean, default: false },
    stats: { bets: Number, wins: Number, totalWon: Number, totalLost: Number }
});
const User = mongoose.model('User', userSchema);

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ИГР ---
let crashState = { multiplier: 1.00, crashed: false, players: [], timeToNext: 0, status: 'waiting' };
let battleLobbies = {}; 
// Структура лобби: { id, creator, min, max, pool, players: [], status, timer }

// --- CRASH ЛОГИКА ---
function runCrash() {
    if(crashState.status === 'waiting') {
        crashState.timeToNext--;
        if(crashState.timeToNext <= 0) {
            crashState.status = 'playing';
            crashState.multiplier = 1.00;
            crashState.crashed = false;
        }
        io.emit('crash_tick', crashState);
        setTimeout(runCrash, 1000);
    } else if (crashState.status === 'playing') {
        crashState.multiplier += 0.01; // Упрощенный рост
        // Упрощенный шанс краша
        if(Math.random() < 0.02 && crashState.multiplier > 1.1) {
            crashState.crashed = true;
            crashState.status = 'waiting';
            crashState.timeToNext = 5;
            // Все кто не забрал - проиграли (обрабатывается при cashout)
            crashState.players = [];
        }
        io.emit('crash_tick', crashState);
        setTimeout(runCrash, 100);
    }
}
crashState.timeToNext = 5;
runCrash();

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    
    // ИНИЦИАЛИЗАЦИЯ (ФИКС БЕСКОНЕЧНОЙ ЗАГРУЗКИ)
    socket.on('init', async (data) => {
        try {
            // В реале тут парсинг и валидация tg.initData через HMAC-SHA-256
            // Для примера берем мок-данные или извлекаем напрямую
            const params = new URLSearchParams(data.initData);
            const tgUser = JSON.parse(params.get('user') || '{"id":123,"first_name":"Test"}');
            
            let user = await User.findOne({ tgId: tgUser.id });
            if(!user) {
                user = new User({
                    tgId: tgUser.id,
                    firstName: tgUser.first_name,
                    avatar: tgUser.photo_url || ''
                });
                await user.save();
            }
            socket.user = user; // Сохраняем в сессии сокета
            socket.emit('init_data', { user });
        } catch(e) {
            console.error(e);
            socket.emit('error', 'Auth failed');
        }
    });

    // --- ИГРЫ ---
    // CRASH
    socket.on('play_crash', async (data, cb) => {
        if(!socket.user) return cb({error: 'Not auth'});
        const user = await User.findById(socket.user._id);
        
        // Проверка даблклика и баланса
        const inGame = crashState.players.find(p => p.id === user.tgId);
        
        if(inGame) {
            // Пытается забрать
            if(crashState.crashed || crashState.status !== 'playing') return cb({error: 'Поздно!'});
            const win = inGame.bet * crashState.multiplier;
            user.balance += win;
            await user.save();
            crashState.players = crashState.players.filter(p => p.id !== user.tgId);
            return cb({ action: 'cashout', win, balance: user.balance });
        } else {
            // Пытается поставить
            if(crashState.status !== 'waiting') return cb({error: 'Ждите след. раунда'});
            if(user.balance < data.bet) return cb({error: 'Недостаточно средств'});
            
            user.balance -= data.bet;
            await user.save();
            crashState.players.push({ id: user.tgId, bet: data.bet });
            return cb({ action: 'bet', balance: user.balance });
        }
    });

    // MINES (Упрощенно)
    socket.on('start_mines', async (data, cb) => {
        if(!socket.user) return cb({error: 'Not auth'});
        const user = await User.findById(socket.user._id);
        if(user.balance < data.bet) return cb({error: 'Недостаточно средств'});
        
        user.balance -= data.bet;
        await user.save();
        socket.mineGame = { bet: data.bet, mult: 1, active: true };
        cb({ balance: user.balance });
    });
    
    socket.on('click_mine', async (data, cb) => {
        if(!socket.mineGame || !socket.mineGame.active) return cb({error: 'Нет активной игры'});
        // Шанс мины 20%
        if(Math.random() < 0.2) {
            socket.mineGame.active = false;
            cb({ type: 'bomb' });
        } else {
            socket.mineGame.mult += 0.2; // Увеличиваем множитель
            cb({ type: 'gem', mult: socket.mineGame.mult });
        }
    });
    
    socket.on('cashout_mines', async (data, cb) => {
        if(!socket.mineGame || !socket.mineGame.active) return cb({error: 'Нет игры'});
        const user = await User.findById(socket.user._id);
        const win = socket.mineGame.bet * socket.mineGame.mult;
        user.balance += win;
        await user.save();
        socket.mineGame.active = false;
        cb({ win, balance: user.balance });
    });

    // COINFLIP
    socket.on('play_coinflip', async (data, cb) => {
        if(!socket.user) return cb({error: 'Not auth'});
        const user = await User.findById(socket.user._id);
        if(user.balance < data.bet) return cb({error: 'Недостаточно средств'});

        // Сразу снимаем
        user.balance -= data.bet;
        await user.save();
        const initialBalance = user.balance;

        // Логика RTP (50/50 для примера)
        const resultSide = Math.random() > 0.5 ? 'L' : 'X';
        let win = 0;
        
        if(data.side === resultSide) {
            win = data.bet * 1.95; // Комиссия системы 5%
            user.balance += win;
            await user.save();
        }

        cb({ result: resultSide, win, balance: initialBalance, newBalance: user.balance });
    });

    // BATTLE ROULETTE (Таймер от 2 игроков)
    socket.on('create_battle', async (data, cb) => {
        if(!socket.user) return cb({error: 'Not auth'});
        const user = await User.findById(socket.user._id);
        if(user.balance < data.bet) return cb({error: 'Нет средств'});

        user.balance -= data.bet;
        await user.save();

        const lobbyId = Date.now().toString();
        battleLobbies[lobbyId] = {
            id: lobbyId,
            creator: socket.user.firstName,
            min: data.min, max: data.max,
            pool: data.bet,
            players: [{ id: user.tgId, name: user.firstName, bet: data.bet, avatar: user.avatar }],
            status: 'waiting',
            timeLeft: 120 // 2 минуты
        };
        cb({ lobbyId, balance: user.balance });
        io.emit('battle_lobbies_update', Object.values(battleLobbies));
    });

    socket.on('join_battle', async (data, cb) => {
        // Логика присоединения (аналогично снятие баланса и пуш в массив players)
        // Если players.length === 2, запускаем интервал таймера для этого лобби
    });

    // --- АДМИНКА ---
    socket.on('admin_get_users', async (data, cb) => {
        if(!socket.user || !socket.user.isAdmin) return;
        const users = await User.find().limit(50);
        cb(users);
    });

    socket.on('admin_set_balance', async (data, cb) => {
        if(!socket.user || !socket.user.isAdmin) return cb({error: 'Denied'});
        const u = await User.findOne({tgId: data.tgId});
        if(!u) return cb({error: 'User not found'});
        u.balance = data.amount;
        await u.save();
        cb({success: true});
        // Если юзер онлайн, пушим ему апдейт
        io.emit('update_balance', { balance: u.balance, tgId: u.tgId }); 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер Loonx запущен на порту ${PORT}`);
});
