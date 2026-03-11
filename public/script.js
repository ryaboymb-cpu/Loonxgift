const socket = io();
const tg = window.Telegram.WebApp;
tg.expand(); // Разворачиваем на весь экран

// --- ИНИЦИАЛИЗАЦИЯ TON CONNECT ---
try {
    const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json', // Нужно создать этот файл позже, пока просто ссылка
        buttonRootId: 'ton-connect-btn'
    });
} catch(e) { console.log('TonConnect init warning:', e); }

// --- АУДИО (ЗВУКИ) ---
const sfxClick = new Audio('https://actions.google.com/sounds/v1/ui/button_click.ogg');
const sfxMoney = new Audio('https://actions.google.com/sounds/v1/cartoon/clank.ogg');
const sfxBoom = new Audio('https://actions.google.com/sounds/v1/weapons/explosion_layer.ogg');
sfxBoom.volume = 0.2; // Тихий взрыв, как просил

function playSound(type) {
    try {
        if(type === 'click') { sfxClick.currentTime = 0; sfxClick.play().catch(()=>{}); }
        if(type === 'money') { sfxMoney.currentTime = 0; sfxMoney.play().catch(()=>{}); }
        if(type === 'boom') { 
            // Взрыв звучит ТОЛЬКО если открыта игра (Краш, Мины или Монетка)
            let isCrashOpen = document.getElementById('screen-crash').classList.contains('active');
            let isMinesOpen = document.getElementById('screen-mines').classList.contains('active');
            let isCoinflipOpen = document.getElementById('screen-coinflip').classList.contains('active');
            
            if(isCrashOpen || isMinesOpen || isCoinflipOpen) { 
                sfxBoom.currentTime = 0; 
                sfxBoom.play().catch(()=>{}); 
            }
        }
    } catch(e) {}
}

// Глобальный слушатель кликов для звука интерфейса
document.addEventListener('click', (e) => {
    let t = e.target;
    if(t.tagName === 'BUTTON' || t.classList.contains('game-card') || t.classList.contains('nav-item') || t.classList.contains('mine-btn')) {
        playSound('click');
    }
});

// --- ЭКРАН ЗАГРУЗКИ ---
window.onload = () => {
    // Ждем ровно 4 секунды
    setTimeout(() => {
        const loader = document.getElementById('loading-screen');
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 500);
    }, 4000);
};

// --- ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ИЗ TELEGRAM ---
const userData = {
    id: String(tg.initDataUnsafe?.user?.id || '123456789'),
    username: tg.initDataUnsafe?.user?.username || tg.initDataUnsafe?.user?.first_name || 'Игрок',
    photo: tg.initDataUnsafe?.user?.photo_url || ''
};

document.getElementById('tg-name').innerText = userData.username;
document.getElementById('tg-avatar').src = userData.photo;

let currentMode = 'demo';
let balance = { realBal: 0, demoBal: 0 };
let coinSide = 'L'; // По умолчанию для Coinflip

// Отправка данных на сервер
socket.emit('init_user', userData);

// Получение обновлений баланса
socket.on('user_data', (data) => { 
    balance = data; 
    updateUI(); 
});

// Универсальный алерт со звуком
socket.on('alert_sound', (data) => {
    playSound(data.type || 'click');
    tg.showAlert(data.msg);
});

// Обновление интерфейса
function updateUI() {
    let val = currentMode === 'real' ? balance.realBal : balance.demoBal;
    document.getElementById('bal-val').innerText = val.toFixed(2);
    document.getElementById('bal-mode').innerText = currentMode.toUpperCase();
    document.getElementById('stat-games').innerText = balance.games || 0;
    document.getElementById('stat-wins').innerText = balance.wins || 0;
}

// Переключение баланса Real/Demo
function toggleBalance() {
    playSound('click');
    currentMode = currentMode === 'demo' ? 'real' : 'demo';
    updateUI();
}

// --- НАВИГАЦИЯ ПО ВЛАДКАМ И ЭКРАНАМ ---
function switchTab(tabId, element) {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    element.classList.add('active');
}

function openScreen(screenId) { 
    document.getElementById('screen-' + screenId).classList.add('active'); 
}
function closeScreen() { 
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); 
}

// --- ГЛОБАЛЬНАЯ ИСТОРИЯ ---
socket.on('global_history_update', (history) => {
    const list = document.getElementById('global-history-list');
    list.innerHTML = '';
    
    if(history.length === 0) {
        list.innerHTML = '<p style="color:#888; text-align:center;">Ставок пока нет</p>';
        return;
    }

    history.forEach(h => {
        let color = h.isWin ? '#00ff00' : '#ff4444';
        let resultText = h.isWin ? `+${h.win.toFixed(2)}` : `-${h.bet.toFixed(2)}`;
        let ava = h.photoUrl || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        
        list.innerHTML += `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #333;">
                <img src="${ava}" style="width:30px; height:30px; border-radius:50%; border:1px solid #00ffff;">
                <div style="flex-grow:1; margin-left:10px;">
                    <b style="color:#fff;">${h.tgName}</b> <small style="color:#888;">(${h.game})</small>
                </div>
                <div style="color:${color}; font-weight:bold;">${resultText} TON</div>
            </div>
        `;
    });
});

// --- ЛОГИКА ИГРЫ: CRASH ---
socket.on('crash_update', (data) => {
    const btn = document.getElementById('c-btn');
    const txt = document.getElementById('c-mult');
    
    if (data.status === 'waiting') {
        txt.style.color = "#00ffff";
        txt.innerText = "СТАРТ ЧЕРЕЗ: " + data.timer; 
        btn.innerText = "СДЕЛАТЬ СТАВКУ"; 
        btn.className = "btn-primary";
        btn.disabled = false;
    } else if (data.status === 'flying') {
        txt.style.color = "#fff";
        txt.innerText = data.mult.toFixed(2) + "x"; 
        btn.innerText = "ЗАБРАТЬ"; 
        btn.className = "btn-green";
    } else {
        txt.style.color = "#ff4444";
        txt.innerText = "ВЗРЫВ " + data.mult.toFixed(2) + "x"; 
        btn.innerText = "ОЖИДАНИЕ..."; 
        btn.className = "btn-blue";
        btn.disabled = true;
        playSound('boom'); // Вызов звука взрыва (сработает если открыт краш)
    }
});

socket.on('crash_live_bets', (bets) => {
    const list = document.getElementById('crash-live-list');
    list.innerHTML = '';
    
    if(bets.length === 0) {
        list.innerHTML = '<p style="color:#888;">В этом раунде ставок нет.</p>';
        return;
    }

    bets.forEach(b => {
        let statusHtml = '';
        if (b.status === 'cashed') statusHtml = `<span style="color:#00ff00; font-weight:bold;">Вывел: ${b.win.toFixed(2)}</span>`;
        else if (b.status === 'lost') statusHtml = `<span style="color:#ff4444; font-weight:bold;">Сгорело</span>`;
        else statusHtml = `<span style="color:#aaa;">В полете (${b.bet} TON)</span>`;
        
        let ava = b.photoUrl || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        
        list.innerHTML += `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid #333;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <img src="${ava}" style="width:25px; height:25px; border-radius:50%;">
                    <span style="color:#fff;">${b.tgName}</span>
                </div>
                <span>${statusHtml}</span>
            </div>
        `;
    });
});

function crashPlay() {
    const btn = document.getElementById('c-btn');
    if(btn.innerText === "СДЕЛАТЬ СТАВКУ") {
        const bet = parseFloat(document.getElementById('c-bet').value);
        socket.emit('crash_bet', { bet: bet, mode: currentMode });
    } else if(btn.innerText === "ЗАБРАТЬ") {
        socket.emit('crash_cashout');
    }
}

// --- ЛОГИКА ИГРЫ: MINES ---
function renderMinesGrid(field = Array(25).fill('?')) {
    const grid = document.getElementById('m-grid');
    grid.innerHTML = '';
    field.forEach((cell, i) => {
        let content = cell === '?' ? '' : (cell === 'safe' ? '💎' : '💣');
        let cssClass = cell === '?' ? '' : (cell === 'safe' ? 'safe-cell' : 'mine-cell');
        grid.innerHTML += `<div class="mine-btn ${cssClass}" onclick="minesOpen(${i})">${content}</div>`;
    });
}
// Первичная отрисовка пустой сетки
renderMinesGrid();

function minesPlay() {
    const bet = parseFloat(document.getElementById('m-bet').value);
    socket.emit('mines_start', { bet: bet, mode: currentMode });
}

socket.on('mines_started', () => {
    document.getElementById('m-btn-start').style.display = 'none';
    document.getElementById('m-btn-cashout').style.display = 'inline-block';
    document.getElementById('m-mult').innerText = '1.00x';
    document.getElementById('m-mult').style.color = '#00ffff';
    renderMinesGrid(); // Очищаем поле знаками вопроса
});

function minesOpen(index) { 
    socket.emit('mines_open', index); 
}

socket.on('mines_safe', (data) => {
    playSound('click');
    document.getElementById('m-mult').innerText = data.mult.toFixed(2) + 'x';
    let buttons = document.querySelectorAll('.mine-btn');
    buttons[data.idx].innerText = '💎'; 
    buttons[data.idx].classList.add('safe-cell');
});

socket.on('mines_boom', (field) => {
    playSound('boom');
    renderMinesGrid(field); // Показываем всё поле
    document.getElementById('m-mult').style.color = '#ff4444';
    document.getElementById('m-btn-start').style.display = 'inline-block';
    document.getElementById('m-btn-cashout').style.display = 'none';
});

function minesCashout() { 
    socket.emit('mines_cashout'); 
}

socket.on('mines_win', (data) => {
    document.getElementById('m-btn-start').style.display = 'inline-block';
    document.getElementById('m-btn-cashout').style.display = 'none';
    renderMinesGrid(); // Сбрасываем поле
});

// --- ЛОГИКА ИГРЫ: COINFLIP ---
function selectCoin(side) { 
    coinSide = side; 
    tg.showAlert('Выбрана сторона: ' + side); 
}

function coinflipPlay() {
    const bet = parseFloat(document.getElementById('cf-bet').value);
    const coinEl = document.getElementById('coin');
    
    coinEl.innerText = "Крутится...";
    coinEl.style.color = "#fff";
    coinEl.style.borderColor = "#fff";
    
    socket.emit('coinflip_play', { bet: bet, mode: currentMode, side: coinSide });
}

socket.on('coinflip_result', (data) => {
    const coinEl = document.getElementById('coin');
    coinEl.innerText = data.resultSide;
    
    if(data.win) {
        coinEl.style.color = "#00ff00";
        coinEl.style.borderColor = "#00ff00";
    } else {
        coinEl.style.color = "#ff4444";
        coinEl.style.borderColor = "#ff4444";
        playSound('boom'); // Звук при проигрыше монетки
    }
});

// --- ПРОМО И ВЫВОД ---
function activatePromo() { 
    socket.emit('activate_promo', document.getElementById('promo-in').value); 
}
function requestWithdraw() {
    socket.emit('withdraw_request', {
        address: document.getElementById('withdraw-address').value,
        amount: parseFloat(document.getElementById('withdraw-amt').value)
    });
}

// --- АДМИН-ПАНЕЛЬ (10 кликов по аватарке) ---
let adminClicksCounter = 0;
function adminClick() {
    adminClicksCounter++;
    if(adminClicksCounter >= 10) {
        let password = prompt("Введите пароль администратора:");
        if(password === "7788") { // Твой пароль
            document.getElementById('admin-panel').style.display = 'flex';
            socket.emit('admin_get_data');
        } else {
            alert("Неверный пароль!");
        }
        adminClicksCounter = 0;
    }
    // Сброс счетчика кликов через 3 секунды, если кликали медленно
    setTimeout(() => { adminClicksCounter = 0; }, 3000);
}

socket.on('admin_data_response', (data) => {
    let html = '';
    data.users.forEach(u => {
        let ava = u.photoUrl || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        html += `
        <div style="padding:15px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${ava}" style="width:30px; border-radius:50%;">
                <div>
                    <div style="color:#fff; font-weight:bold;">${u.tgName}</div>
                    <div style="color:#00ffff; font-size:12px;">Баланс: ${u.realBal.toFixed(2)} TON</div>
                </div>
            </div>
            <button class="btn-green" style="width:auto; padding:5px 10px;" onclick="socket.emit('admin_action', {action:'edit_balance', userId:'${u.id}', amount:1})">+1 TON</button>
        </div>`;
    });
    document.getElementById('user-list').innerHTML = html;
});
