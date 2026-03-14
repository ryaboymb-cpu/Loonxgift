const tg = window.Telegram.WebApp;
const socket = io();
let user = null;
let mode = 'real'; // real or demo
let rtp = {};

// ИНИЦИАЛИЗАЦИЯ
window.onload = async () => {
    tg.expand();
    const res = await fetch('/api/auth', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(tg.initDataUnsafe.user || {id: 777, first_name: "Admin", username: "loonx_dev"})
    });
    const data = await res.json();
    user = data.user;
    rtp = data.rtp;
    
    document.getElementById('user-name').innerText = "@" + (user.username || "player");
    document.getElementById('my-ava').src = user.photo || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
    updateBal();
    renderMyHistory();
};

function toggleBalance() {
    mode = mode === 'real' ? 'demo' : 'real';
    document.getElementById('bal-type').innerText = mode.toUpperCase();
    document.getElementById('bal-type').style.color = mode === 'demo' ? '#55aaff' : '#00ff88';
    updateBal();
}

function updateBal() {
    const val = mode === 'real' ? user.balance : user.demo_balance;
    document.getElementById('bal-val').innerText = val.toFixed(2) + " TON";
    document.getElementById('bal-val').style.color = mode === 'demo' ? '#55aaff' : '#00ff88';
}

// НАВИГАЦИЯ
function nav(page, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
}

function openGame(g) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + g).classList.add('active');
}

// LIVE FEED
socket.on('newBet', (bet) => {
    const feed = document.getElementById('feed-items');
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.innerHTML = `
        <div class="feed-user">
            <img src="${bet.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="feed-img">
            <span>${bet.username || 'User'}</span>
        </div>
        <div>${bet.game} | <span style="color:${bet.win > 0 ? '#00ff88':'#ff4444'}">${bet.win > 0 ? '+'+bet.win : bet.bet}</span></div>
    `;
    feed.prepend(div);
    if(feed.children.length > 7) feed.lastChild.remove();
});

// CRASH LOGIC
let currentCrash = {};
socket.on('crashUpdate', (state) => {
    currentCrash = state;
    const x = document.getElementById('crash-x');
    const timer = document.getElementById('crash-timer');
    const btn = document.getElementById('crash-btn');

    if(state.status === 'waiting') {
        x.innerText = "ЖДЕМ...";
        timer.innerText = `СТАРТ ЧЕРЕЗ: ${state.timer}с`;
        x.style.color = "#fff";
    } else if(state.status === 'running') {
        x.innerText = state.multiplier + "x";
        timer.innerText = "ИГРА ИДЕТ";
    } else {
        x.innerText = "BOOM!";
        x.style.color = "#ff4444";
    }
});

async function crashAction() {
    const amt = parseFloat(document.getElementById('crash-input').value);
    if(amt < 0.5 || amt > 20) return alert("Ставка от 0.5 до 20");
    
    const btn = document.getElementById('crash-btn');
    if(btn.innerText === 'СТАВКА') {
        if(currentCrash.status !== 'waiting') return alert("Дождись следующего раунда");
        btn.innerText = 'В ИГРЕ...';
        btn.style.background = '#444';
    } else if(btn.innerText === 'ЗАБРАТЬ') {
        const win = amt * currentCrash.multiplier;
        await sendBet('Crash', amt, win);
        btn.innerText = 'ВЫИГРАЛ!';
        setTimeout(() => btn.innerText = 'СТАВКА', 2000);
    }
}

// MINES LOGIC
let mineActive = false;
let mines = [];
let mBet = 0;
async function mineStart() {
    if(mineActive) {
        // Забрать
        await sendBet('Mines', mBet, mBet * 1.5); // Упрощенный множитель
        mineActive = false;
        document.getElementById('mine-btn').innerText = "ИГРАТЬ";
        return;
    }
    mBet = parseFloat(document.getElementById('mine-input').value);
    mines = [];
    while(mines.length < 5) { // 5 МИН
        let r = Math.floor(Math.random()*25);
        if(!mines.includes(r)) mines.push(r);
    }
    mineActive = true;
    renderGrid();
    document.getElementById('mine-btn').innerText = "ЗАБРАТЬ";
}

function renderGrid() {
    const g = document.getElementById('mine-grid');
    g.innerHTML = '';
    for(let i=0; i<25; i++) {
        const c = document.createElement('div');
        c.className = 'cell';
        c.onclick = () => {
            if(!mineActive) return;
            if(mines.includes(i)) {
                c.innerText = '💣'; c.style.background = '#ff4444';
                mineActive = false;
                sendBet('Mines', mBet, 0);
                document.getElementById('mine-btn').innerText = "ИГРАТЬ";
            } else {
                c.innerText = '💎'; c.style.background = '#00ff88';
            }
        };
        g.appendChild(c);
    }
}

// СТАВКА НА СЕРВЕР
async function sendBet(game, bet, win) {
    const res = await fetch('/api/bet', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: user.id, game, bet, win, mode })
    });
    const data = await res.json();
    user.balance = data.balance;
    user.demo_balance = data.demo_balance;
    user.history = data.history;
    updateBal();
    renderMyHistory();
}

function renderMyHistory() {
    const cont = document.getElementById('my-history');
    cont.innerHTML = '<h3>История (10 последних)</h3>';
    user.history.slice(0,10).forEach(h => {
        cont.innerHTML += `<div class="feed-item">
            <span>${h.game} (${h.mode})</span>
            <span style="color:${h.win > 0 ? '#00ff88':'#ff4444'}">${h.win > 0 ? '+'+h.win : '-'+h.bet} TON</span>
        </div>`;
    });
}

// АДМИНКА
let taps = 0;
document.querySelector('header').onclick = () => {
    taps++;
    if(taps >= 10) {
        document.getElementById('admin-modal').style.display = 'block';
        taps = 0;
    }
};

function admShow(t) {
    const cont = document.getElementById('adm-content');
    if(t === 'rtp') {
        cont.innerHTML = `
            Crash RTP: <input type="number" value="${rtp.crash}" class="input-box">
            Mines RTP: <input type="number" value="${rtp.mines}" class="input-box">
            <button class="btn btn-main">ОБНОВИТЬ</button>
        `;
    }
    if(t === 'promo') {
        cont.innerHTML = `
            Код: <input type="text" id="adm-p-code" class="input-box">
            Сумма: <input type="number" id="adm-p-amt" class="input-box">
            Лимит: <input type="number" id="adm-p-lim" class="input-box">
            <button class="btn btn-main" onclick="createPromo()">СОЗДАТЬ</button>
        `;
    }
}

async function createPromo() {
    const code = document.getElementById('adm-p-code').value;
    const amount = document.getElementById('adm-p-amt').value;
    const limit = document.getElementById('adm-p-lim').value;
    await fetch('/api/admin/promo', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ code, amount, limit })
    });
    alert("Промо создан!");
}

async function activatePromo() {
    const code = document.getElementById('promo-input').value;
    const res = await fetch('/api/promo/activate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: user.id, code })
    });
    if(res.ok) {
        alert("Успешно!");
        location.reload();
    } else alert("Ошибка");
}
