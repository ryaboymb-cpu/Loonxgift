const tg = window.Telegram.WebApp;
const socket = io();
let currentUser = { id: 0, balance: 0, history: [] };

// --- 1. СТАРТ ПРИЛОЖЕНИЯ ---
window.addEventListener('DOMContentLoaded', () => {
    tg.expand();
    tg.ready();
    
    initStars(); // Запускаем звезды на фоне
    drawEmptyMines(); // Отрисовываем пустое поле мин
    
    // Имитация загрузки для красивого появления (2.5 сек)
    setTimeout(async () => {
        await authorize();
        const loader = document.getElementById('loader');
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 400);
    }, 2500);
});

// --- 2. СЕТЬ И СОКЕТЫ ---
async function authorize() {
    const tgData = tg.initDataUnsafe.user || { id: 123456, first_name: "Dev", username: "LocalDev" };
    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(tgData)
        });
        currentUser = await res.json();
        updateUI();
    } catch(e) {
        showToast("Ошибка подключения к серверу", true);
    }
}

function updateUI() {
    document.getElementById('ui-username').innerText = currentUser.username;
    document.getElementById('ui-balance').innerText = currentUser.balance.toFixed(2);
    updateHistory();
}

socket.on('onlineUpdate', (count) => {
    document.getElementById('ui-online').innerText = count;
});

// --- 3. НАВИГАЦИЯ ---
function openPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pageId).classList.add('active');
    tg.HapticFeedback.impactOccurred('light');
}

function navTo(pageId, element) {
    openPage(pageId);
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    element.classList.add('active');
}

// Утилита для уведомлений
function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.className = isError ? 'show error' : 'show';
    tg.HapticFeedback.notificationOccurred(isError ? 'error' : 'success');
    setTimeout(() => t.className = '', 3000);
}

// --- 4. ИГРА: CRASH ---
let crashInt;
let crashMult = 1.0;
let isCrashActive = false;
let crashBet = 0;

function playCrash() {
    const btn = document.getElementById('crash-btn');
    const display = document.getElementById('crash-multiplier');
    
    if (isCrashActive) {
        // Забираем деньги
        clearInterval(crashInt);
        isCrashActive = false;
        btn.innerText = "ПОСТАВИТЬ";
        const win = crashBet * crashMult;
        sendBet('Crash', crashBet, win);
        showToast(`Успешно вывели на ${crashMult.toFixed(2)}x!`);
    } else {
        // Ставим ставку
        crashBet = parseFloat(document.getElementById('crash-bet').value);
        if (!crashBet || crashBet > currentUser.balance || crashBet <= 0) return showToast("Некорректная ставка", true);
        
        isCrashActive = true;
        crashMult = 1.0;
        btn.innerText = "ЗАБРАТЬ ВЫИГРЫШ";
        display.style.color = "#fff";
        
        crashInt = setInterval(() => {
            crashMult += 0.01;
            display.innerText = crashMult.toFixed(2) + "x";
            
            // Логика взрыва
            if (Math.random() < 0.012) {
                clearInterval(crashInt);
                isCrashActive = false;
                btn.innerText = "ПОСТАВИТЬ";
                display.style.color = "var(--red)";
                sendBet('Crash', crashBet, 0);
                showToast("График обвалился!", true);
                tg.HapticFeedback.impactOccurred('heavy');
            }
        }, 100);
    }
}

// --- 5. ИГРА: MINES ---
let minesActive = false;
let bombIndexes = [];
let mBet = 0;
let mMult = 1.0;

function drawEmptyMines() {
    const grid = document.getElementById('mines-grid');
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.onclick = () => tapMine(i, cell);
        grid.appendChild(cell);
    }
}

function startMines() {
    const btn = document.getElementById('mines-btn');
    
    if (minesActive) {
        // Забрать деньги
        minesActive = false;
        sendBet('Mines', mBet, mBet * mMult);
        btn.innerText = "НАЧАТЬ (3 МИНЫ)";
        showToast(`Выиграли ${(mBet * mMult).toFixed(2)} TON!`);
        drawEmptyMines(); // Сброс поля
        return;
    }

    mBet = parseFloat(document.getElementById('mines-bet').value);
    if (!mBet || mBet > currentUser.balance || mBet <= 0) return showToast("Некорректная ставка", true);

    minesActive = true;
    mMult = 1.0;
    bombIndexes = [];
    
    // Генерируем 3 бомбы
    while(bombIndexes.length < 3) {
        let r = Math.floor(Math.random() * 25);
        if(!bombIndexes.includes(r)) bombIndexes.push(r);
    }
    
    drawEmptyMines();
    btn.innerText = "ЗАБРАТЬ " + mBet.toFixed(2);
}

function tapMine(index, cell) {
    if(!minesActive || cell.classList.contains('gem')) return;
    
    if(bombIndexes.includes(index)) {
        // Попал на бомбу
        cell.classList.add('bomb');
        cell.innerText = '💣';
        minesActive = false;
        sendBet('Mines', mBet, 0);
        document.getElementById('mines-btn').innerText = "НАЧАТЬ (3 МИНЫ)";
        showToast("Вы подорвались!", true);
        tg.HapticFeedback.impactOccurred('heavy');
        // Показать все бомбы
        const cells = document.querySelectorAll('.mine-cell');
        bombIndexes.forEach(b => { cells[b].classList.add('bomb'); cells[b].innerText = '💣'; });
    } else {
        // Нашел кристалл
        cell.classList.add('gem');
        cell.innerText = '💎';
        mMult += 0.15;
        document.getElementById('mines-btn').innerText = `ЗАБРАТЬ ${(mBet * mMult).toFixed(2)}`;
        tg.HapticFeedback.impactOccurred('light');
    }
}

// --- 6. ОБРАБОТКА СТАВОК И ИСТОРИЯ ---
async function sendBet(game, bet, win) {
    try {
        const res = await fetch('/api/bet', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: currentUser.id, game, bet, winAmount: win })
        });
        const data = await res.json();
        currentUser.balance = data.balance;
        currentUser.history = data.history;
        updateUI();
    } catch(e) { console.error(e); }
}

function updateHistory() {
    const box = document.getElementById('history-container');
    if (!currentUser.history.length) return;
    
    box.innerHTML = currentUser.history.map(h => `
        <div class="hist-item">
            <div><b style="color:#fff">${h.game}</b> <span style="font-size:11px;color:var(--sub)">${h.time}</span></div>
            <div style="color: ${h.isWin ? 'var(--green)' : 'var(--red)'}; font-weight: bold;">
                ${h.isWin ? '+' : '-'}${Math.abs(h.winAmount - h.bet).toFixed(2)} TON
            </div>
        </div>
    `).join('');
}

// --- 7. TON CONNECT ---
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-btn'
});

async function processDeposit() {
    const amt = document.getElementById('dep-amount').value;
    if(!amt || amt < 0.1) return showToast("Минимум 0.1 TON", true);
    
    try {
        await tonConnectUI.sendTransaction({
            validUntil: Math.floor(Date.now() / 1000) + 300,
            messages: [{ address: "UQ_ТВОЙ_АДРЕС", amount: (amt * 1000000000).toString() }]
        });
        showToast("Депозит в обработке!");
    } catch (e) { showToast("Отмена пользователем", true); }
}

// --- 8. АНИМАЦИЯ ЗВЕЗД ---
function initStars() {
    const canvas = document.getElementById('stars-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    let stars = Array.from({length: 100}, () => ({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        size: Math.random() * 1.5, speed: Math.random() * 0.5 + 0.1
    }));
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        stars.forEach(s => {
            ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
            s.y += s.speed; if(s.y > canvas.height) s.y = -5;
        });
        requestAnimationFrame(draw);
    }
    draw();
}

// --- 9. АДМИН ПАНЕЛЬ (10 кликов по шапке) ---
let taps = 0, tapTimer;
document.getElementById('main-header').addEventListener('click', () => {
    taps++; clearTimeout(tapTimer);
    if(taps >= 10) {
        if(prompt("Код доступа:") === "8877") document.getElementById('admin-panel').style.display = 'block';
        taps = 0;
    }
    tapTimer = setTimeout(() => taps = 0, 2000);
});
