const tg = window.Telegram.WebApp;
const socket = io();

let user = null;
let currentTab = 'crash';
let isDemo = true;

// --- INITIALIZATION ---
window.onload = () => {
    tg.expand();
    initStars();
    
    const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: 'https://loonx-gifts.render.com/tonconnect-manifest.json',
        buttonRootId: 'ton-connect-btn'
    });

    const initData = tg.initDataUnsafe?.user || { id: 8423153067, username: "Player" };
    socket.emit('auth', initData);
};

// --- STARS ANIMATION ---
function initStars() {
    const canvas = document.getElementById('star-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const stars = Array.from({length: 100}, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        s: Math.random() * 2
    }));
    function draw() {
        ctx.clearRect(0,0,canvas.width, canvas.height);
        ctx.fillStyle = "#fff";
        stars.forEach(st => {
            ctx.beginPath(); ctx.arc(st.x, st.y, st.s, 0, Math.PI*2); ctx.fill();
            st.y += 0.2; if(st.y > canvas.height) st.y = 0;
        });
        requestAnimationFrame(draw);
    }
    draw();
}

// --- SOCKET EVENTS ---
socket.on('init_data', (data) => {
    user = data.user;
    updateUI();
});

socket.on('update_balance', (data) => {
    user.real_balance = data.real;
    user.demo_balance = data.demo;
    updateUI();
    if(data.msg) tg.showAlert(data.msg);
});

function updateUI() {
    document.getElementById('user-name').innerText = user.username;
    document.getElementById('user-pic').src = user.avatar || '';
    document.getElementById('bal-real').innerText = user.real_balance.toFixed(2) + ' TON';
    document.getElementById('bal-demo').innerText = 'Demo: ' + user.demo_balance.toFixed(0);
}

// --- CRASH LOGIC ---
let crashActive = false;
socket.on('crash_timer', (t) => {
    document.getElementById('crash-info').innerText = `Взлет через ${t}s`;
    document.getElementById('crash-num').style.color = '#fff';
    document.getElementById('crash-btn').innerText = 'СДЕЛАТЬ СТАВКУ';
    crashActive = false;
});

socket.on('crash_tick', (m) => {
    document.getElementById('crash-info').innerText = `ПОЛЕТ...`;
    document.getElementById('crash-num').innerText = m + 'x';
    document.getElementById('crash-num').style.color = 'var(--success)';
});

socket.on('crash_end', (data) => {
    document.getElementById('crash-info').innerText = `КРАШ!`;
    document.getElementById('crash-num').innerText = data.point + 'x';
    document.getElementById('crash-num').style.color = 'var(--error)';
    tg.HapticFeedback.notificationOccurred('error');
});

function handleCrashBet() {
    const amt = parseFloat(document.getElementById('crash-amt').value);
    socket.emit('place_bet', { game: 'crash', amount: amt, isDemo: true });
}

// --- MINES LOGIC ---
let mineBombs = [];
let mineActive = false;
let currentWin = 0;

function startMinesGame() {
    const amt = parseFloat(document.getElementById('mine-amt').value);
    const count = parseInt(document.getElementById('mine-count').value);
    if(count < 1 || count > 24) return;
    
    socket.emit('place_bet', { game: 'mines', amount: amt, bombCount: count, isDemo: true });
}

socket.on('mines_ready', (data) => {
    mineBombs = data.bombs;
    mineActive = true;
    currentWin = parseFloat(document.getElementById('mine-amt').value);
    renderMines();
});

function renderMines() {
    const grid = document.getElementById('mine-grid');
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell active';
        cell.onclick = () => clickMine(i, cell);
        grid.appendChild(cell);
    }
}

function clickMine(idx, el) {
    if(!mineActive || el.classList.contains('gem')) return;

    if(mineBombs.includes(idx)) {
        el.innerText = '💣'; el.classList.add('bomb');
        mineActive = false;
        tg.HapticFeedback.notificationOccurred('error');
        setTimeout(renderMines, 2000);
    } else {
        el.innerText = '💎'; el.classList.add('gem');
        currentWin *= 1.2; // Множитель для теста
        tg.HapticFeedback.impactOccurred('light');
    }
}

function switchTab(t, el) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('v-'+t).classList.add('active');
    if(el) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
    }
}
