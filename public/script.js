const socket = io();
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// ИНИЦИАЛИЗАЦИЯ TON CONNECT (ТВОЙ КОШЕЛЕК И МАНИФЕСТ)
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-btn'
});

// ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ИЗ ТЕЛЕГРАМА
let userData = {
    id: tg.initDataUnsafe?.user?.id || "123456",
    username: tg.initDataUnsafe?.user?.username || "Guest",
    photo: tg.initDataUnsafe?.user?.photo_url || "https://via.placeholder.com/150"
};

let currentMode = 'demo';
let localData = { realBal: 0, demoBal: 0, games: 0, wins: 0 };
let inGameCrash = false;
let inGameMines = false;

// Генерация звезд на фоне (с разной скоростью и размерами)
function createStars() {
    const container = document.getElementById('stars-container');
    if (!container) return;
    for (let i = 0; i < 40; i++) {
        let star = document.createElement('div');
        star.className = 'star';
        let size = Math.random() * 3 + 1; // от 1 до 4px
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        star.style.left = Math.random() * 100 + 'vw';
        // Медленное падение от 15 до 25 секунд
        star.style.animationDuration = (Math.random() * 10 + 15) + 's';
        star.style.animationDelay = (Math.random() * 15) + 's';
        container.appendChild(star);
    }
}
createStars();

// Подключение к серверу
socket.emit('init_user', userData);

// Обновление интерфейса
socket.on('user_data', (d) => {
    localData = d;
    document.getElementById('tg-avatar').src = d.photoUrl || userData.photo;
    document.getElementById('profile-avatar').src = d.photoUrl || userData.photo;
    document.getElementById('header-name').innerText = d.tgName;
    document.getElementById('p-name').innerText = d.tgName;
    document.getElementById('s-games').innerText = d.games;
    document.getElementById('s-wins').innerText = d.wins;
    updateBalanceDisplay();
});

socket.on('online_update', (count) => {
    document.getElementById('online-val').innerText = count;
    document.getElementById('admin-users-count').innerText = count;
});

function updateBalanceDisplay() {
    let bal = currentMode === 'real' ? localData.realBal : localData.demoBal;
    document.getElementById('h-bal').innerText = bal.toFixed(2);
    document.getElementById('w-bal').innerText = bal.toFixed(2);
    document.getElementById('h-mode').innerText = currentMode.toUpperCase();
}

function toggleMode() {
    currentMode = currentMode === 'demo' ? 'real' : 'demo';
    updateBalanceDisplay();
}

// НАВИГАЦИЯ
function switchTab(tabId, element) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    element.classList.add('active');
}

function openGame(game) {
    document.getElementById('screen-' + game).style.display = 'flex';
    if(game === 'mines') drawMinesGrid();
}
function closeGame() {
    document.querySelectorAll('.game-fullscreen').forEach(el => el.style.display = 'none');
}

// РЕДАКТИРОВАНИЕ СТАВКИ
function changeBet(game, val) {
    let input = document.getElementById(game === 'crash' ? 'c-bet' : 'm-bet');
    let newVal = parseFloat(input.value) + val;
    if(newVal >= 0.5) input.value = newVal.toFixed(1);
}

// ЗВУКОВОЙ ДВИЖОК (БЕЗ ФАЙЛОВ)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);

    if(type === 'boom') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(); osc.stop(audioCtx.currentTime + 0.5);
        tg.HapticFeedback.impactOccurred('heavy');
    } else if(type === 'ding') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
        tg.HapticFeedback.impactOccurred('light');
    }
}

// ===== ЛОГИКА CRASH =====
socket.on('crash_update', (d) => {
    let multEl = document.getElementById('c-mult');
    let timerEl = document.getElementById('c-timer');
    let btn = document.getElementById('c-btn');
    
    // Обновление истории
    let histHtml = '';
    d.history.forEach(h => {
        let color = h >= 2.0 ? 'rgba(0,255,136,0.2)' : 'rgba(255,255,255,0.1)';
        let textColor = h >= 2.0 ? 'var(--neon-green)' : '#fff';
        histHtml += `<div class="history-item" style="background:${color}; color:${textColor}">${parseFloat(h).toFixed(2)}x</div>`;
    });
    document.getElementById('crash-history').innerHTML = histHtml;

    if (d.status === 'waiting') {
        multEl.innerText = '1.00x';
        multEl.style.color = '#fff';
        multEl.style.textShadow = '0 0 20px var(--neon-blue)';
        timerEl.innerText = `ВЗЛЕТ ЧЕРЕЗ: ${d.timer}с`;
        if(!inGameCrash) { btn.innerText = "СТАВКА"; btn.className = "btn-primary bet-btn"; btn.disabled = false; }
    } else if (d.status === 'flying') {
        multEl.innerText = d.mult.toFixed(2) + 'x';
        timerEl.innerText = "ПОЛЕТ...";
        if(inGameCrash) { btn.innerText = "ЗАБРАТЬ"; btn.className = "btn-primary btn-green bet-btn"; btn.disabled = false; }
        else { btn.disabled = true; }
    } else if (d.status === 'crashed') {
        multEl.innerText = d.mult.toFixed(2) + 'x';
        multEl.style.color = 'var(--neon-red)';
        multEl.style.textShadow = '0 0 20px var(--neon-red)';
        timerEl.innerText = "ВЗРЫВ!";
        if(inGameCrash) { inGameCrash = false; }
        btn.innerText = "СТАВКА"; btn.className = "btn-primary bet-btn"; btn.disabled = false;
        if(d.history[0] == d.mult.toFixed(2)) playSound('boom');
    }
});

function crashAction() {
    if (!inGameCrash) {
        let betAmt = document.getElementById('c-bet').value;
        socket.emit('crash_bet', { bet: betAmt, mode: currentMode });
        inGameCrash = true;
        document.getElementById('c-btn').innerText = "ОЖИДАНИЕ...";
        document.getElementById('c-btn').disabled = true;
    } else {
        socket.emit('crash_cashout');
        inGameCrash = false;
    }
}
socket.on('crash_win', (d) => { tg.showAlert(`Вы выиграли: ${d.win} (x${d.mult})`); });

// ===== ЛОГИКА MINES =====
function drawMinesGrid() {
    const grid = document.getElementById('m-grid');
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        let cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.onclick = () => openMineCell(i, cell);
        grid.appendChild(cell);
    }
}

function minesAction() {
    if (!inGameMines) {
        let betAmt = document.getElementById('m-bet').value;
        socket.emit('mines_start', { bet: betAmt, mode: currentMode });
    } else {
        socket.emit('mines_cashout');
    }
}

socket.on('mines_ready', () => {
    inGameMines = true;
    document.getElementById('m-btn').innerText = "ЗАБРАТЬ";
    document.getElementById('m-btn').className = "btn-primary btn-green bet-btn";
    document.getElementById('m-mult-display').innerText = "1.00";
    drawMinesGrid();
});

function openMineCell(idx, el) {
    if(!inGameMines || el.classList.contains('open-safe')) return;
    socket.emit('mines_open', idx);
}

socket.on('mines_safe', (d) => {
    playSound('ding');
    let cell = document.getElementById('m-grid').children[d.idx];
    cell.classList.add('open-safe');
    cell.innerText = "💎";
    document.getElementById('m-mult-display').innerText = d.mult;
});

socket.on('mines_boom', (field) => {
    playSound('boom');
    inGameMines = false;
    document.getElementById('m-btn').innerText = "ИГРАТЬ";
    document.getElementById('m-btn').className = "btn-primary bet-btn";
    
    let cells = document.getElementById('m-grid').children;
    for(let i=0; i<25; i++) {
        if(field[i] === 'mine') {
            cells[i].classList.add('open-mine');
            cells[i].innerText = "💣";
        }
    }
    tg.showAlert("БОМБА! Вы проиграли ставку.");
});

socket.on('mines_win', (d) => {
    inGameMines = false;
    document.getElementById('m-btn').innerText = "ИГРАТЬ";
    document.getElementById('m-btn').className = "btn-primary bet-btn";
    tg.showAlert(`Победа! Вы забрали: ${d.win}`);
    drawMinesGrid();
});

// ===== TON DEPOSIT =====
async function makeDeposit() {
    const amount = document.getElementById('dep-amt').value;
    if(!amount || amount < 0.1) return tg.showAlert("Минимальная сумма 0.1 TON");
    if(!tonConnectUI.connected) return tg.showAlert("Сначала подключите кошелек!");

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{
            address: "UQCTqV9scQaZR0DHzOnMrOCCY7z3MIT0QfoNrtUDZiXHY1-K", // Твой кошелек
            amount: (amount * 1000000000).toString() // Перевод в nanoTON
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        tg.showAlert("Транзакция отправлена! Баланс скоро обновится.");
    } catch(e) {
        tg.showAlert("Ошибка или отмена транзакции.");
    }
}

// ===== ПРОМОКОДЫ =====
function activatePromo() {
    let code = document.getElementById('promo-in').value;
    if(!code) return tg.showAlert("Введите код");
    socket.emit('activate_promo', code);
}

// ===== АДМИНКА =====
function openAdminMenu() {
    let pw = prompt("Введите пароль доступа:");
    if(pw === "7788") {
        document.getElementById('admin-modal').style.display = 'flex';
    } else if(pw) {
        tg.showAlert("Неверный пароль!");
    }
}
function closeAdminMenu() { document.getElementById('admin-modal').style.display = 'none'; }
function createAdminPromo() {
    let code = document.getElementById('adm-promo-code').value;
    let sum = document.getElementById('adm-promo-sum').value;
    let uses = document.getElementById('adm-promo-uses').value;
    if(code && sum && uses) {
        socket.emit('admin_action', { pw: '7788', action: 'create_promo', code: code, reward: sum, uses: uses });
    } else {
        tg.showAlert("Заполните все поля");
    }
}

// Оповещения от сервера
socket.on('alert', (msg) => tg.showAlert(msg));
