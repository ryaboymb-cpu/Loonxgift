/**
 * CORE CLIENT SCRIPT - LOONX GIFTS
 * HANDLING REAL-TIME UPDATES & ANIMATIONS
 */

const tg = window.Telegram.WebApp;
const socket = io();

let currentUser = null;
let currentBalanceMode = 'demo';
let tonConnectUI = null;

// Инициализация при загрузке
window.addEventListener('load', () => {
    tg.expand();
    tg.enableClosingConfirmation();
    initStars();
    initTonConnect();
    
    // Авторизация
    const initData = tg.initDataUnsafe?.user || { id: 12345, username: "Local_Dev" };
    socket.emit('auth', initData);
});

// --- TON CONNECT CONFIG ---
function initTonConnect() {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: 'https://loonx-gifts.render.com/tonconnect-manifest.json',
        buttonRootId: 'ton-connect-root'
    });
}

// --- ANIMATION: STAR FIELD ---
function initStars() {
    const canvas = document.getElementById('star-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const stars = Array.from({ length: 150 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.5,
        speed: Math.random() * 0.5 + 0.1
    }));

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        stars.forEach(s => {
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
            s.y += s.speed;
            if (s.y > canvas.height) s.y = 0;
        });
        requestAnimationFrame(animate);
    }
    animate();
}

// --- SOCKET EVENTS ---
socket.on('init_data', (data) => {
    currentUser = data.user;
    updateUI();
    renderCrashHistory(data.crashRoom.history);
    document.getElementById('preloader').style.opacity = '0';
    setTimeout(() => document.getElementById('preloader').style.display = 'none', 500);
});

socket.on('update_balance', (data) => {
    if (data.real !== undefined) currentUser.real_balance = data.real;
    if (data.demo !== undefined) currentUser.demo_balance = data.demo;
    updateUI();
    if (data.msg) showNotify(data.msg, 'success');
});

socket.on('crash_timer', (time) => {
    const timerDisplay = document.getElementById('crash-wait-time');
    const multDisplay = document.getElementById('crash-multiplier');
    timerDisplay.innerText = `До взлета: ${time}s`;
    multDisplay.style.color = 'var(--accent-color)';
});

socket.on('crash_tick', (mult) => {
    document.getElementById('crash-wait-time').innerText = "В ПОЛЕТЕ";
    const multDisplay = document.getElementById('crash-multiplier');
    multDisplay.innerText = mult + 'x';
    multDisplay.style.color = 'var(--success-color)';
});

socket.on('crash_end', (data) => {
    const multDisplay = document.getElementById('crash-multiplier');
    multDisplay.innerText = data.point + 'x';
    multDisplay.style.color = 'var(--error-color)';
    renderCrashHistory(data.history);
    tg.HapticFeedback.notificationOccurred('error');
});

// --- UI FUNCTIONS ---
function updateUI() {
    document.getElementById('header-username').innerText = currentUser.username;
    document.getElementById('header-avatar').src = currentUser.avatar || 'https://via.placeholder.com/42';
    document.getElementById('wallet-tg-id').innerText = currentUser.tgId;
    
    const bal = currentBalanceMode === 'demo' ? currentUser.demo_balance : currentUser.real_balance;
    const suffix = currentBalanceMode === 'demo' ? ' D' : ' TON';
    document.getElementById('balance-main').innerText = bal.toFixed(2) + suffix;
}

function toggleBalance(mode) {
    currentBalanceMode = mode;
    document.getElementById('sw-demo').classList.toggle('active', mode === 'demo');
    document.getElementById('sw-real').classList.toggle('active', mode === 'real');
    updateUI();
    tg.HapticFeedback.impactOccurred('light');
}

function switchNav(tab, el) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.view-tab').forEach(v => v.style.display = 'none');
    
    el.classList.add('active');
    document.getElementById('view-' + tab).style.display = 'block';
    tg.HapticFeedback.impactOccurred('medium');
}

function showNotify(text, type) {
    const n = document.getElementById('notification-center');
    n.innerText = text;
    n.style.borderColor = type === 'success' ? 'var(--success-color)' : 'var(--error-color)';
    n.style.top = '20px';
    setTimeout(() => n.style.top = '-100px', 3500);
}

// --- GAMES: MINES ---
let isMinesActive = true;
function startMines() {
    const box = document.getElementById('mines-grid-box');
    box.innerHTML = '';
    isMinesActive = true;
    
    // Генерация бомб (сервер должен это валидировать, тут для примера)
    const bombs = [];
    while(bombs.length < 3) {
        let r = Math.floor(Math.random() * 25);
        if(!bombs.includes(r)) bombs.push(r);
    }

    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.onclick = () => {
            if(!isMinesActive) return;
            if(bombs.includes(i)) {
                cell.innerText = '💣';
                cell.classList.add('open-bomb');
                isMinesActive = false;
                tg.HapticFeedback.notificationOccurred('error');
                showNotify('BOMBED! Попробуй снова.', 'error');
            } else {
                cell.innerText = '💎';
                cell.classList.add('open-gem');
                tg.HapticFeedback.impactOccurred('light');
            }
        };
        box.appendChild(cell);
    }
}
startMines();

// --- GAMES: CRASH ---
function placeCrashBet() {
    const amt = parseFloat(document.getElementById('crash-bet-input').value);
    if(isNaN(amt) || amt <= 0) return showNotify('Введите сумму', 'error');
    
    socket.emit('place_bet', {
        game: 'crash',
        amount: amt,
        isDemo: currentBalanceMode === 'demo'
    });
}

function renderCrashHistory(history) {
    const container = document.getElementById('crash-history-list');
    container.innerHTML = history.map(h => `<div class="history-tag" style="color: ${h > 2 ? 'var(--success-color)' : '#fff'}">${h}x</div>`).join('');
}

// --- ADMIN ACCESS ---
let clicks = 0;
document.getElementById('header-tap-zone').onclick = () => {
    clicks++;
    if(clicks >= 10) {
        clicks = 0;
        const pass = prompt('Admin Password:');
        socket.emit('admin_login', pass);
    }
};

socket.on('admin_auth_success', () => {
    showNotify('🛠 ADMIN ACCESS GRANTED', 'success');
    // Тут можно открыть скрытую секцию управления
});
