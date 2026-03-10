const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/tonconnect-manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'tonconnect-manifest.json')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let users = {}; 
let activeMines = {};
let crashHistory = [];
let crash = { status: 'waiting', timer: 6, mult: 1.00, liveBets: [] };
let withdrawRequests = []; 
let PROMOS = { 'LOONX-REAL': { reward: 10 } };

function runCrash() {
    crash = { status: 'waiting', timer: 6, mult: 1.00, liveBets: [] };
    io.emit('crash_update', { ...crash, history: crashHistory });
    let wait = setInterval(() => {
        crash.timer--; io.emit('crash_update', { ...crash, history: crashHistory });
        if (crash.timer <= 0) { clearInterval(wait); startFlight(); }
    }, 1000);
}

function startFlight() {
    crash.status = 'flying';
    let crashPoint = Math.random() < 0.15 ? (1.00 + Math.random()*0.1) : 
                     (100 * (2**52) - Math.floor(Math.random() * (2**52))) / ((2**52) - Math.floor(Math.random() * (2**52))) / 100;
    if(crashPoint < 1.01) crashPoint = 1.00;

    let flight = setInterval(() => {
        if (crash.mult >= crashPoint) {
            clearInterval(flight);
            crash.status = 'crashed';
            crashHistory.unshift(crash.mult.toFixed(2));
            if(crashHistory.length > 10) crashHistory.pop();
            io.emit('crash_update', { ...crash, history: crashHistory });
            setTimeout(runCrash, 4000);
        } else {
            crash.mult += 0.01 * Math.pow(crash.mult, 0.6);
            crash.liveBets.forEach(b => {
                if (!b.cashed && b.auto > 1.00 && crash.mult >= b.auto) {
                    b.cashed = true;
                    let win = b.bet * b.auto;
                    let u = users[b.socketId];
                    if (u) {
                        let balType = b.mode === 'real' ? 'realBal' : 'demoBal';
                        u[balType] += win; u.wins++;
                        io.to(b.socketId).emit('crash_win', { win: win, mult: b.auto });
                        io.to(b.socketId).emit('user_data', u);
                    }
                }
            });
            io.emit('crash_update', { ...crash, history: crashHistory });
        }
    }, 100);
}
runCrash();

io.on('connection', (socket) => {
    users[socket.id] = { 
        socketId: socket.id, id: socket.id.substring(0,6), tgName: 'Player',
        realBal: 0.0, demoBal: 0.0, lastDemo: 0, games: 0, wins: 0, usedPromos: [], wallet: 'Не привязан'
    };

    socket.on('init_user', (tgData) => {
        if(tgData && tgData.username) users[socket.id].tgName = tgData.username;
        if(tgData && tgData.id) users[socket.id].id = tgData.id.toString(); 
        socket.emit('user_data', users[socket.id]);
        io.emit('online_count', Object.keys(users).length);
    });

    socket.emit('crash_update', { ...crash, history: crashHistory });
    socket.on('set_wallet', (w) => { if(users[socket.id]) users[socket.id].wallet = w; });

    socket.on('claim_demo', () => {
        let u = users[socket.id]; let now = Date.now();
        if (now - u.lastDemo >= 86400000 || u.lastDemo === 0) { 
            u.demoBal += 100.0; u.lastDemo = now;
            socket.emit('user_data', u); socket.emit('alert', '✅ Получено 100 DEMO TON!');
        } else {
            let left = Math.ceil((86400000 - (now - u.lastDemo)) / 3600000);
            socket.emit('alert', `⏳ Бонус через ${left} ч.`);
        }
    });

    socket.on('activate_promo', (code) => {
        let u = users[socket.id]; let p = code.toUpperCase();
        if (PROMOS[p] && !u.usedPromos.includes(p)) {
            u.realBal += PROMOS[p].reward; u.usedPromos.push(p);
            socket.emit('user_data', u); socket.emit('alert', `✅ +${PROMOS[p].reward} REAL TON`);
        } else { socket.emit('alert', '❌ Код неверный или использован'); }
    });

    // КРАШ СТАВКА (ЛИМИТЫ 0.5 - 20)
    socket.on('crash_bet', (data) => {
        let u = users[socket.id];
        let bet = parseFloat(data.bet); let auto = parseFloat(data.auto) || 0;
        let balType = data.mode === 'real' ? 'realBal' : 'demoBal';
        
        if (bet < 0.5 || bet > 20) return socket.emit('bet_error', 'Ставка от 0.5 до 20 TON!');
        if (crash.status !== 'waiting') return socket.emit('bet_error', 'Ракета уже летит!');
        if (u[balType] < bet) return socket.emit('bet_error', 'Недостаточно средств!');

        u[balType] -= bet; u.games++;
        crash.liveBets.push({ socketId: socket.id, id: u.id, name: u.tgName, bet: bet, auto: auto, cashed: false, mode: data.mode });
        socket.emit('bet_success'); socket.emit('user_data', u); io.emit('crash_update', { ...crash, history: crashHistory });
    });

    socket.on('crash_cashout', () => {
        let u = users[socket.id];
        if (crash.status === 'flying') {
            let b = crash.liveBets.find(x => x.socketId === socket.id && !x.cashed);
            if (b) {
                b.cashed = true; let win = b.bet * crash.mult;
                let balType = b.mode === 'real' ? 'realBal' : 'demoBal';
                u[balType] += win; u.wins++;
                socket.emit('crash_win', { win: win, mult: crash.mult });
                socket.emit('user_data', u); io.emit('crash_update', { ...crash, history: crashHistory });
            }
        }
    });

    // МИНЫ (ЛИМИТЫ 0.5 - 20)
    socket.on('mines_start', (data) => {
        let u = users[socket.id]; let bet = parseFloat(data.bet);
        let balType = data.mode === 'real' ? 'realBal' : 'demoBal';
        
        if (bet < 0.5 || bet > 20) return socket.emit('bet_error', 'Ставка от 0.5 до 20 TON!');
        if (u[balType] < bet) return socket.emit('bet_error', 'Недостаточно средств!');

        u[balType] -= bet; u.games++;
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

    socket.on('mines_cashout', () => {
        let game = activeMines[socket.id]; let u = users[socket.id];
        if (game) {
            let win = game.bet * game.mult;
            let balType = game.mode === 'real' ? 'realBal' : 'demoBal';
            u[balType] += win; u.wins++;
            socket.emit('mines_win', { win: win, mult: game.mult });
            socket.emit('user_data', u); delete activeMines[socket.id];
        }
    });

    // ВЫВОДЫ (С кошельком юзера)
    socket.on('request_withdraw', (data) => {
        let u = users[socket.id]; let amt = parseFloat(data.amount);
        if(u.realBal >= amt && amt >= 5 && data.wallet.length > 10) {
            u.realBal -= amt;
            let reqId = Date.now().toString();
            withdrawRequests.push({ reqId: reqId, socketId: socket.id, id: u.id, name: u.tgName, amount: amt, wallet: data.wallet });
            socket.emit('user_data', u); socket.emit('alert', '✅ Заявка на вывод отправлена!');
        } else { socket.emit('alert', '❌ Ошибка! Мин. 5 REAL TON или неверный кошелек.'); }
    });

    // АДМИНКА
    socket.on('admin_login', (pw) => {
        if(pw === '7788') socket.emit('admin_data', { users: Object.values(users), withdraws: withdrawRequests });
    });
    
    socket.on('admin_create_promo', (data) => {
        if(data.pw === '7788') { PROMOS[data.code.toUpperCase()] = { reward: parseFloat(data.amount) }; socket.emit('alert', '✅ Промокод создан!'); }
    });

    socket.on('admin_action_withdraw', (data) => {
        if(data.pw === '7788') {
            let idx = withdrawRequests.findIndex(w => w.reqId === data.reqId);
            if(idx !== -1) {
                let req = withdrawRequests[idx];
                if(data.action === 'reject') {
                    let u = users[req.socketId];
                    if(u) { u.realBal += req.amount; io.to(req.socketId).emit('alert', '❌ Ваш вывод отклонен. Средства возвращены.'); io.to(req.socketId).emit('user_data', u); }
                } else {
                    io.to(req.socketId).emit('alert', '✅ Ваш вывод одобрен!');
                }
                withdrawRequests.splice(idx, 1);
                socket.emit('admin_data', { users: Object.values(users), withdraws: withdrawRequests });
            }
        }
    });

    socket.on('disconnect', () => { delete users[socket.id]; delete activeMines[socket.id]; io.emit('online_count', Object.keys(users).length); });
});

server.listen(PORT, () => console.log('Server is running'));
