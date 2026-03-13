const tg = window.Telegram.WebApp;
const socket = io();
let user = null;
let mode = 'demo';
let tonConnectUI;

// --- INITIALIZE APP ---
tg.expand();
tg.enableClosingConfirmation();

// Звезды
const canvas = document.getElementById('stars_canvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth; canvas.height = window.innerHeight;
let stars = Array(120).fill().map(() => ({ x: Math.random()*canvas.width, y: Math.random()*canvas.height, s: Math.random()*0.6+0.1 }));
function drawStars() {
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle="#fff";
    stars.forEach(s => { ctx.beginPath(); ctx.arc(s.x,s.y,0.8,0,Math.PI*2); ctx.fill(); s.y+=s.s; if(s.y>canvas.height) s.y=0; });
    requestAnimationFrame(drawStars);
}
drawStars();

// TON Connect
tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonx-gifts.render.com/tonconnect-manifest.json', // Твой URL
    buttonRootId: 'ton-connect-button'
});

// --- SOCKET EVENTS ---
socket.on('connect', () => {
    socket.emit('auth', tg.initDataUnsafe.user || {id: 1, username: "Dev"});
});

socket.on('init_data', (data) => {
    user = data.user;
    document.getElementById('loader').style.display = 'none';
    updateUI();
    renderMines();
});

socket.on('crash_timer', (t) => {
    document.getElementById('crash_timer').innerText = `Запуск через: ${t}s`;
    document.getElementById('crash_num').style.color = 'var(--accent)';
});

socket.on('crash_tick', (m) => {
    document.getElementById('crash_timer').innerText = `В ПОЛЕТЕ`;
    document.getElementById('crash_num').innerText = m + 'x';
    document.getElementById('crash_num').style.color = 'var(--green)';
});

socket.on('crash_end', (d) => {
    document.getElementById('crash_num').innerText = d.limit + 'x';
    document.getElementById('crash_num').style.color = 'var(--red)';
    const hist = document.getElementById('crash_h');
    hist.innerHTML = d.history.map(h => `<div class="h-item">${h}x</div>`).join('');
});

// --- CORE FUNCTIONS ---
function updateUI() {
    document.getElementById('u_name').innerText = user.username;
    document.getElementById('u_id').innerText = `ID: ${user.tgId}`;
    document.getElementById('copy_id_val').innerText = user.tgId;
    document.getElementById('u_avatar').src = user.avatar || 'https://via.placeholder.com/40';
    
    const bal = mode === 'demo' ? user.demo_balance : user.real_balance;
    document.getElementById('display_balance').innerText = bal.toFixed(2) + (mode === 'demo' ? ' D' : ' TON');
    
    document.getElementById('st_games').innerText = user.stats.games;
    document.getElementById('st_wins').innerText = user.stats.wins;
    document.getElementById('prof_user').innerText = user.username;
}

function setMode(m) {
    mode = m;
    document.getElementById('sw_demo').classList.toggle('active', mode === 'demo');
    document.getElementById('sw_real').classList.toggle('active', mode === 'real');
    updateUI();
}

function switchNav(page, el) {
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page_' + page).classList.add('active');
    el.classList.add('active');
    tg.HapticFeedback.impactOccurred('light');
}

// --- MINES LOGIC ---
let minesActive = true;
function renderMines() {
    const grid = document.getElementById('m_grid');
    grid.innerHTML = '';
    const bombs = Array.from({length: 3}, () => Math.floor(Math.random()*25));
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.onclick = () => {
            if(!minesActive) return;
            if(bombs.includes(i)) {
                cell.innerText = '💣'; cell.classList.add('open-bomb');
                tg.HapticFeedback.notificationOccurred('error');
                minesActive = false; setTimeout(initMines, 1500);
            } else {
                cell.innerText = '💎'; cell.classList.add('open-gem');
                tg.HapticFeedback.impactOccurred('medium');
            }
        };
        grid.appendChild(cell);
    }
}
function initMines() { minesActive = true; renderMines(); }

// --- COINFLIP ---
function playFlip(choice) {
    const coin = document.getElementById('coin_obj');
    coin.style.transform = "rotateY(1080deg)";
    setTimeout(() => {
        const res = Math.random() > 0.5 ? 'L' : 'X';
        coin.style.transform = res === 'L' ? "rotateY(0deg)" : "rotateY(180deg)";
        if(res === choice) notify("Победа! +2x", "success");
        else notify("Попробуйте еще раз", "info");
    }, 1500);
}

// --- DEPOSITS ---
async function handleDeposit() {
    const amount = document.getElementById('dep_input').value;
    if(!amount || amount < 0.1) return notify("Мин. сумма 0.1 TON", "info");

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{
            address: "ТВОЙ_АДРЕС_КОШЕЛЬКА", // Твой кошелек из .env
            amount: (amount * 1000000000).toString(),
            payload: btoa(user.tgId.toString()) // Комментарий - ID юзера
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        notify("Транзакция отправлена! Ждите подтверждения.", "success");
    } catch(e) { notify("Ошибка оплаты", "info"); }
}

// --- NOTIFY ---
function notify(text, type) {
    const box = document.getElementById('notify_box');
    box.innerText = text; box.style.top = '20px';
    setTimeout(() => box.style.top = '-100px', 3000);
}

// --- ADMIN (10 TAPS) ---
let taps = 0;
document.getElementById('header_trigger').onclick = () => {
    taps++; if(taps >= 10) { taps=0; const p = prompt("PWD:"); socket.emit('admin_login', p); }
};
socket.on('adm_access', () => {
    document.getElementById('admin_modal').style.display = 'flex';
    socket.emit('get_all_users');
});
socket.on('adm_users_list', (data) => {
    const cont = document.getElementById('users_container');
    cont.innerHTML = data.map(u => `<div class="adm-u">${u.username} | ${u.real_balance.toFixed(2)} TON</div>`).join('');
});
function closeAdmin() { document.getElementById('admin_modal').style.display = 'none'; }
