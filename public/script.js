/**
 * Loonx Gift - Full Frontend Engine
 * Developed for: @tonfrm
 * Features: High-Performance Animations, Haptic Feedback, Socket.io Sync
 */

const socket = io();
const tg = window.Telegram.WebApp;

// --- СОСТОЯНИЕ ПРИЛОЖЕНИЯ ---
let user = tg.initDataUnsafe?.user || { id: "777", first_name: "Loonx User" };
let localUser = null;
let currentMode = 'demo'; // 'real' или 'demo'
let activeTab = 'home';
let isGameOpen = false;

// Состояние игр
let minesState = { active: false, selected: [], mCount: 3 };
let crashState = { status: 'waiting', mult: 1.0, history: [] };
let coinState = { flipping: false };

// --- ИНИЦИАЛИЗАЦИЯ ---
tg.expand();
tg.ready();
tg.enableClosingConfirmation();

// Авторизация на сервере
socket.emit('auth', { 
    id: user.id, 
    name: user.first_name, 
    photo: user.photo_url 
});

// --- СЛУШАТЕЛИ СОКЕТОВ ---
socket.on('init_data', (data) => {
    localUser = data.user;
    updateUI();
    renderHistory(data.history);
});

socket.on('user_update', (u) => {
    localUser = u;
    updateUI();
});

socket.on('sys_msg', (msg) => showToast(msg));

// --- ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ---
function updateUI() {
    if (!localUser) return;

    const balance = currentMode === 'real' ? localUser.realBal : localUser.demoBal;
    const currency = currentMode === 'real' ? 'TON' : 'D-TON';

    // Обновление балансов во всех местах
    document.querySelectorAll('.bal-amount').forEach(el => {
        el.innerText = balance.toFixed(2);
    });
    document.querySelectorAll('.bal-cur').forEach(el => {
        el.innerText = currency;
    });

    // Профиль
    const nameEl = document.getElementById('profile-name');
    if (nameEl) nameEl.innerText = localUser.firstName || 'Loonx User';
    
    const avatarEl = document.getElementById('u-avatar');
    if (avatarEl && localUser.photo) avatarEl.src = localUser.photo;

    // Реферальная ссылка
    const refLink = `https://t.me/your_bot_name?start=${localUser.id}`;
    const refEl = document.getElementById('ref-link-input');
    if (refEl) refEl.value = refLink;
}

// Переключение Реал/Демо
function switchMode() {
    currentMode = currentMode === 'real' ? 'demo' : 'real';
    tg.HapticFeedback.impactOccurred('medium');
    updateUI();
    showToast(`Режим: ${currentMode.toUpperCase()}`);
}

// --- ЛОГИКА CRASH (РАКЕТА) ---
socket.on('crash_update', (data) => {
    crashState = { ...crashState, ...data };
    const multEl = document.getElementById('crash-mult');
    const rocket = document.getElementById('crash-rocket');
    const btn = document.getElementById('crash-main-btn');

    if (data.status === 'waiting') {
        multEl.innerText = `00:${data.timer < 10 ? '0' : ''}${data.timer}`;
        multEl.style.color = '#fff';
        rocket.style.transform = 'translate(0, 0) scale(1)';
        rocket.style.opacity = '1';
        if (btn) btn.innerText = 'ПОСТАВИТЬ';
    } else if (data.status === 'flying') {
        multEl.innerText = data.mult.toFixed(2) + 'x';
        multEl.style.color = '#00ff66';
        
        // Математика полета ракеты (Canvas-like движение через CSS)
        let x = Math.min(data.mult * 20, 250);
        let y = Math.min(data.mult * 15, 180);
        rocket.style.transform = `translate(${x}px, -${y}px) rotate(${-x/10}deg)`;
    }
});

socket.on('crash_boom', (data) => {
    const multEl = document.getElementById('crash-mult');
    const rocket = document.getElementById('crash-rocket');
    multEl.innerText = 'BOOM!';
    multEl.style.color = '#ff4444';
    rocket.style.opacity = '0';
    tg.HapticFeedback.notificationOccurred('error');
    
    // Добавление в историю
    addCrashHistory(data.mult);
});

function playCrash() {
    const bet = parseFloat(document.getElementById('crash-bet-input').value);
    if (!bet || bet <= 0) return showToast('Введите ставку');
    
    const btn = document.getElementById('crash-main-btn');
    if (btn.innerText === 'ПОСТАВИТЬ') {
        socket.emit('crash_place_bet', { bet, mode: currentMode });
        btn.innerText = 'В ИГРЕ...';
        tg.HapticFeedback.impactOccurred('light');
    } else {
        socket.emit('crash_cashout');
        tg.HapticFeedback.notificationOccurred('success');
    }
}

// --- ЛОГИКА MINES ---
function initMinesGrid() {
    const grid = document.getElementById('mines-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.dataset.idx = i;
        cell.onclick = () => stepMines(i);
        grid.appendChild(cell);
    }
}

function startMines() {
    const bet = parseFloat(document.getElementById('mines-bet-input').value);
    const mCount = parseInt(document.getElementById('mines-count-select').value);
    
    if (bet > 0) {
        socket.emit('mines_start', { bet, mCount, mode: currentMode });
        minesState = { active: true, selected: [], mCount };
        initMinesGrid();
        document.getElementById('mines-start-btn').style.display = 'none';
        document.getElementById('mines-cashout-btn').style.display = 'block';
        document.getElementById('mines-cashout-btn').innerText = 'ВЫВЕСТИ (1.00x)';
        tg.HapticFeedback.impactOccurred('medium');
    }
}

function stepMines(idx) {
    if (!minesState.active || minesState.selected.includes(idx)) return;
    socket.emit('mines_step', idx);
    tg.HapticFeedback.impactOccurred('light');
}

socket.on('mine_hit', (data) => {
    const cell = document.querySelector(`.mine-cell[data-idx="${data.idx}"]`);
    cell.innerHTML = '<div class="diamond-anim">💎</div>';
    cell.classList.add('opened');
    minesState.selected.push(data.idx);
    document.getElementById('mines-cashout-btn').innerText = `ВЫВЕСТИ (${data.mult}x)`;
});

socket.on('mines_lose', (data) => {
    minesState.active = false;
    data.field.forEach((type, i) => {
        const cell = document.querySelector(`.mine-cell[data-idx="${i}"]`);
        if (type === 'mine') {
            cell.innerHTML = '💣';
            cell.classList.add('bomb');
        } else if (!cell.classList.contains('opened')) {
            cell.innerHTML = '💎';
            cell.style.opacity = '0.5';
        }
    });
    tg.HapticFeedback.notificationOccurred('error');
    setTimeout(resetMinesUI, 3000);
});

// --- ЛОГИКА COINFLIP (L / X) ---
function playCoin(side) {
    if (coinState.flipping) return;
    const bet = parseFloat(document.getElementById('coin-bet-input').value);
    if (!bet || bet <= 0) return;

    coinState.flipping = true;
    const coinEl = document.getElementById('coin-obj');
    coinEl.className = 'coin-obj flipping';
    
    socket.emit('coin_bet', { bet, side, mode: currentMode });
    tg.HapticFeedback.impactOccurred('heavy');
}

socket.on('coin_result', (data) => {
    const coinEl = document.getElementById('coin-obj');
    const statusEl = document.getElementById('coin-status');
    
    setTimeout(() => {
        coinEl.className = 'coin-obj';
        coinEl.innerText = data.resultSide;
        coinEl.style.color = data.isWin ? '#00ff66' : '#ff4444';
        
        statusEl.innerText = data.isWin ? `+${data.winSum.toFixed(2)} TON` : 'ПОПРОБУЙ ЕЩЕ';
        statusEl.className = data.isWin ? 'win-text' : 'lose-text';
        
        if (data.isWin) tg.HapticFeedback.notificationOccurred('success');
        coinState.flipping = false;
    }, 1200);
});

// --- СИСТЕМА ПУЗЫРЕЙ (BUBBLES) ---
function createBubbles(e) {
    const btn = e.currentTarget;
    for (let i = 0; i < 8; i++) {
        const b = document.createElement('span');
        b.className = 'bubble-effect';
        const size = Math.random() * 10 + 5 + 'px';
        b.style.width = size;
        b.style.height = size;
        b.style.left = Math.random() * 100 + '%';
        b.style.top = Math.random() * 100 + '%';
        btn.appendChild(b);
        setTimeout(() => b.remove(), 600);
    }
}

// Навешиваем пузыри на все главные кнопки
document.querySelectorAll('.main-btn').forEach(btn => {
    btn.addEventListener('click', createBubbles);
});

// --- АНИМАЦИЯ ЗВЕЗД (ПРЕМИУМ ФОН) ---
function createStar() {
    const star = document.createElement('div');
    star.className = 'falling-star';
    star.style.left = Math.random() * 100 + 'vw';
    star.style.animationDuration = Math.random() * 2 + 2 + 's';
    document.getElementById('stars-container').appendChild(star);
    setTimeout(() => star.remove(), 4000);
}
setInterval(createStar, 600);

// --- АДМИН-ПАНЕЛЬ ---
let profileClicks = 0;
function handleAdminTaps() {
    profileClicks++;
    if (profileClicks >= 10) {
        profileClicks = 0;
        const pass = prompt('Введите код доступа:');
        socket.emit('admin_login', pass);
    }
    setTimeout(() => profileClicks = 0, 3000);
}

socket.on('admin_auth_success', (data) => {
    const adminPanel = document.getElementById('admin-panel');
    adminPanel.style.display = 'block';
    // Заполняем поля текущими настройками
    document.getElementById('adm-coin-chance').value = data.settings.coinWinChance;
    showToast('Доступ разрешен, Creator');
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function showToast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 100);
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 500);
    }, 3000);
}

function openGame(gameId) {
    isGameOpen = true;
    document.getElementById(`game-${gameId}`).classList.add('open');
    if (gameId === 'mines') initMinesGrid();
    tg.BackButton.show();
}

tg.BackButton.onClick(() => {
    document.querySelectorAll('.game-screen').forEach(s => s.classList.remove('open'));
    isGameOpen = false;
    tg.BackButton.hide();
});

// LIVE ХИСТОРИ
socket.on('new_history', (item) => {
    const list = document.getElementById('live-list');
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
        <span>${item.name}</span>
        <span>${item.game}</span>
        <span class="${item.isWin ? 'win' : 'lose'}">${item.win > 0 ? '+' + item.win.toFixed(2) : item.bet}</span>
    `;
    list.prepend(row);
    if (list.children.length > 15) list.lastChild.remove();
});

// Авто-клики и прочее
console.log('Loonx Gift Frontend Engine v3.0 Loaded');
