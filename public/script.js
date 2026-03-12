const socket = io();
const tg = window.Telegram.WebApp;
tg.expand();

let userData = { realBal: 0, demoBal: 200, games: 0, wins: 0, spent: 0, withdrawn: 0 };
let currentMode = 'real'; // Переключатель REAL/DEMO
let crashActive = false;

// 1. ИНИЦИАЛИЗАЦИЯ ЮЗЕРА
const initData = tg.initDataUnsafe?.user || { id: '777777', first_name: 'Loonx Guest', photo_url: '' };
socket.emit('init_user', { 
    id: initData.id, 
    username: initData.first_name, 
    photo: initData.photo_url 
});

// Обновление данных юзера
socket.on('user_data', (u) => {
    userData = u;
    updateUI();
});

// Обновление онлайна
socket.on('online_count', (count) => {
    const el = document.getElementById('online-count');
    if(el) el.innerText = count;
});

// Живая история ставок
socket.on('history_update', (history) => {
    const list = document.getElementById('live-history-list');
    if(!list) return;
    list.innerHTML = history.map(h => `
        <div class="bet-item">
            <div style="display:flex; align-items:center; gap:8px;">
                <img src="${h.photoUrl}" onerror="this.src='img/avatar.png'" style="width:20px; height:20px; border-radius:50%">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:60px;">${h.tgName}</span>
            </div>
            <span style="color:#888">${h.game}</span>
            <span class="${h.isWin ? 'bet-win' : ''}">${h.win > 0 ? '+' + h.win.toFixed(2) : h.bet.toFixed(2)}</span>
        </div>
    `).join('');
});

// 2. ИНТЕРФЕЙС И ТАБЫ
function updateUI() {
    document.getElementById('user-name').innerText = userData.tgName;
    document.getElementById('profile-name').innerText = userData.tgName;
    document.getElementById('profile-id').innerText = userData.id;
    document.getElementById('stat-games').innerText = userData.games;
    document.getElementById('stat-wins').innerText = userData.wins;
    
    // Аватарки
    if(userData.photoUrl) {
        document.getElementById('tg-avatar').src = userData.photoUrl;
        document.getElementById('profile-avatar').src = userData.photoUrl;
    }

    const bal = currentMode === 'real' ? userData.realBal : userData.demoBal;
    const suffix = currentMode === 'real' ? ' TON' : ' D-TON';
    document.getElementById('bal-amount').innerText = bal.toFixed(2) + suffix;
    
    const label = document.getElementById('bal-label');
    label.innerText = currentMode.toUpperCase() + ' BALANCE 🔄';
    label.style.color = currentMode === 'real' ? 'var(--ssg-green)' : '#ffaa00';
}

function toggleBalanceMode() {
    currentMode = currentMode === 'real' ? 'demo' : 'real';
    updateUI();
    tg.HapticFeedback.impactOccurred('medium');
}

function switchTab(tabId, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    tg.HapticFeedback.selectionChanged();
}

// 3. ЛОГИКА ИГР
function openGame(game) {
    document.getElementById('game-' + game).style.display = 'flex';
    tg.HapticFeedback.impactOccurred('light');
    if(game === 'mines') initMinesBoard();
}

function closeAllGames() {
    document.querySelectorAll('.game-modal').forEach(m => m.style.display = 'none');
}

// --- MINES ---
function initMinesBoard() {
    const board = document.getElementById('mines-board');
    board.innerHTML = '';
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.id = `mine-${i}`;
        cell.onclick = () => { socket.emit('mines_open', i); tg.HapticFeedback.impactOccurred('light'); };
        board.appendChild(cell);
    }
}

function startMines() {
    const bet = parseFloat(document.getElementById('mines-bet-input').value);
    const minesCount = parseInt(document.getElementById('mines-count').value);
    if(!bet || bet <= 0) return alert('Введите ставку');
    
    socket.emit('mines_start', { bet, minesCount, mode: currentMode });
}

socket.on('mines_started', () => {
    const btn = document.getElementById('mines-main-btn');
    btn.innerText = 'ВЫВЕСТИ (1.00x)';
    btn.onclick = () => socket.emit('mines_cashout');
});

socket.on('mines_safe', (data) => {
    const cell = document.getElementById(`mine-${data.idx}`);
    cell.classList.add('safe');
    cell.innerText = '💎';
    document.getElementById('mines-main-btn').innerText = `ВЫВЕСТИ (${data.mult}x)`;
});

socket.on('mines_boom', (field) => {
    field.forEach((type, i) => {
        const cell = document.getElementById(`mine-${i}`);
        cell.classList.add(type);
        cell.innerText = type === 'mine' ? '💣' : '💎';
    });
    tg.HapticFeedback.notificationOccurred('error');
    setTimeout(resetMines, 2000);
});

socket.on('mines_win', () => {
    tg.HapticFeedback.notificationOccurred('success');
    resetMines();
});

function resetMines() {
    const btn = document.getElementById('mines-main-btn');
    btn.innerText = 'ИГРАТЬ';
    btn.onclick = startMines;
    initMinesBoard();
}

// --- CRASH ---
socket.on('crash_update', (state) => {
    const multText = document.getElementById('crash-multiplier');
    const btn = document.getElementById('crash-btn');
    
    if(state.status === 'waiting') {
        multText.innerText = `00:${state.timer < 10 ? '0' : ''}${state.timer}`;
        multText.style.color = 'white';
        btn.innerText = 'СТАВКА';
        btn.style.background = 'var(--ssg-green)';
    } else if(state.status === 'flying') {
        multText.innerText = state.mult.toFixed(2) + 'x';
        multText.style.color = 'var(--ssg-green)';
    } else {
        multText.innerText = 'BOOM!';
        multText.style.color = '#ff4444';
        btn.innerText = 'СТАВКА';
    }
});

function placeCrashBet() {
    const btn = document.getElementById('crash-btn');
    const bet = parseFloat(document.getElementById('crash-bet-input').value);
    
    if(btn.innerText === 'СТАВКА') {
        if(!bet || bet <= 0) return alert('Введите ставку');
        socket.emit('crash_bet', { bet, mode: currentMode });
        btn.innerText = 'ВЫВОД';
        btn.style.background = '#3b82f6';
    } else {
        socket.emit('crash_cashout');
    }
}

// 4. КОШЕЛЕК И ВЫВОДЫ
function requestWithdraw() {
    const wallet = document.getElementById('draw-wallet').value;
    const amount = parseFloat(document.getElementById('draw-amount').value);
    if(!wallet || !amount) return alert('Заполните все поля');
    socket.emit('request_withdraw', { wallet, amount });
}

function claimPromo() {
    const code = document.getElementById('promo-input').value;
    socket.emit('activate_promo', code);
}

// 5. АДМИНКА
function openAdmin() {
    const pass = prompt('Admin Password:');
    if(pass) socket.emit('admin_login', pass);
}

socket.on('alert', (data) => alert(data.msg));

// Звезды
setInterval(() => {
    const container = document.getElementById('stars-container');
    if(!container) return;
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + 'vw';
    star.style.animationDuration = (Math.random() * 3 + 2) + 's';
    container.appendChild(star);
    setTimeout(() => star.remove(), 5000);
}, 400);
