const socket = io();
let tg = window.Telegram.WebApp;
tg.expand();
tg.ready();
tg.enableClosingConfirmation();

// --- ИНИЦИАЛИЗАЦИЯ ПОЛЬЗОВАТЕЛЯ ---
const tgUser = tg.initDataUnsafe?.user || { id: "test_123", first_name: "LoonxUser", username: "loonx" };
const avatarUrl = tgUser.photo_url || "https://via.placeholder.com/100";

let localUser = null;
let currentMode = 'demo'; // 'real' или 'demo'
let sysRTP = {}; // Настройки с сервера

socket.emit('init', { id: tgUser.id, username: tgUser.username, name: tgUser.first_name, photo: avatarUrl });

// --- TON CONNECT (ДЕПОЗИТЫ) ---
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-button'
});

async function depositTON() {
    const wallet = tonConnectUI.wallet;
    if (!wallet) return showToast('Сначала подключите кошелек в меню!', 'error');
    
    const amountStr = prompt('Введите сумму депозита в TON (Минимум 1):');
    const amount = parseFloat(amountStr);
    if (!amount || amount < 1) return showToast('Некорректная сумма', 'error');

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600, // 10 минут на оплату
        messages: [{
            address: "ТВОЙ_АДРЕС_КОШЕЛЬКА", // ЗАМЕНИ НА СВОЙ КОШЕЛЕК!
            amount: (amount * 1000000000).toString()
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        socket.emit('deposit_success', amount); // Зачисление на сервер
    } catch (e) {
        showToast('Оплата отменена или произошла ошибка', 'error');
    }
}

// --- ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ---
socket.on('user_update', (u) => {
    localUser = u;
    const balance = currentMode === 'real' ? u.realBal : u.demoBal;
    
    // Обновляем балансы везде (включая модалки игр)
    document.querySelectorAll('.bal-amount').forEach(el => el.innerText = balance.toFixed(2));
    document.querySelectorAll('.bal-cur').forEach(el => el.innerText = currentMode === 'real' ? 'TON' : 'D-TON');
    document.getElementById('mode-label').innerText = currentMode === 'real' ? 'REAL TON' : 'DEMO TON';
    
    // Профиль
    document.getElementById('profile-name').innerText = u.firstName;
    document.getElementById('prof-name-big').innerText = u.firstName;
    document.getElementById('u-avatar').src = u.photo || avatarUrl;
    document.getElementById('prof-avatar-big').src = u.photo || avatarUrl;
    
    // Статистика
    document.getElementById('st-games').innerText = u.stats?.games || 0;
    document.getElementById('st-wins').innerText = u.stats?.wins || 0;
});

// Переключение баланса
function switchMode() {
    currentMode = currentMode === 'real' ? 'demo' : 'real';
    tg.HapticFeedback.impactOccurred('medium');
    socket.emit('init', { id: tgUser.id }); // Запрашиваем актуальный баланс
    showToast(`Выбран счет: ${currentMode.toUpperCase()}`, 'success');
}

// Уведомления (Тосты)
socket.on('toast', (data) => showToast(data.msg, data.type));
function showToast(msg, type = 'success') {
    tg.HapticFeedback.notificationOccurred(type === 'success' ? 'success' : 'error');
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerText = msg;
    container.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

// Навигация
function switchTab(tabId, el) {
    document.querySelectorAll('.tab-pane').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    if(el) el.classList.add('active');
    tg.HapticFeedback.impactOccurred('light');
}

function openGame(g) { 
    document.getElementById(`modal-${g}`).classList.add('open'); 
    if(g === 'mines') renderMines([]); 
}
function closeModal() { 
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')); 
}

// --- ЕЖЕДНЕВНЫЙ БОНУС ---
function claimDaily() {
    socket.emit('claim_daily');
}

// --- ВЫВОД И ПРОМО ---
function requestWithdraw() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const wallet = document.getElementById('withdraw-wallet').value;
    if(amount < 5) return showToast('Мин. сумма вывода: 5 TON', 'error');
    if(!wallet) return showToast('Введите адрес', 'error');
    socket.emit('request_withdraw', { amount, wallet });
}

function activatePromo() {
    const code = document.getElementById('promo-input').value;
    if(code) socket.emit('use_promo', code);
}

// --- ЛИМИТЫ (0.5 - 20) ---
function validateBet(val) {
    if(val < 0.5 || val > 20) {
        showToast('Ставка должна быть от 0.5 до 20 TON', 'error');
        return false;
    }
    return true;
}

// --- ИГРА: COINFLIP ---
let coinFlipping = false;
function playCoin(side) {
    if(coinFlipping) return;
    const bet = parseFloat(document.getElementById('coin-bet-val').value);
    if(!validateBet(bet)) return;
    
    coinFlipping = true;
    document.getElementById('coin-object').classList.add('flipping');
    document.getElementById('coin-result-text').innerText = 'Монета в воздухе...';
    socket.emit('play_coin', { bet, side, mode: currentMode });
}

socket.on('coin_res', (data) => {
    setTimeout(() => {
        const coin = document.getElementById('coin-object');
        coin.classList.remove('flipping');
        coin.innerText = data.resultSide;
        
        // Цвет свечения
        coin.style.boxShadow = data.isWin ? '0 0 40px #00ff66, inset 0 0 20px #00ff66' : '0 0 40px #ff4444, inset 0 0 20px #ff4444';
        coin.style.borderColor = data.isWin ? '#00ff66' : '#ff4444';
        
        document.getElementById('coin-result-text').innerText = data.isWin ? 'ПОБЕДА!' : 'ПРОИГРЫШ';
        document.getElementById('coin-result-text').style.color = data.isWin ? '#00ff66' : '#ff4444';
        coinFlipping = false;
    }, 1200); // Время анимации
});

// --- ИГРА: MINES ---
function renderMines(field) {
    const grid = document.getElementById('mines-grid');
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        let div = document.createElement('div');
        div.className = 'mine-cell';
        if(field[i] === 'mine') { 
            div.innerHTML = '💣'; 
            div.classList.add('boom'); 
        } else if(field[i] === 'safe') { 
            div.innerHTML = '💎'; 
            div.classList.add('opened'); 
        }
        div.onclick = () => socket.emit('open_mine', i);
        grid.appendChild(div);
    }
}

function startMines() {
    const bet = parseFloat(document.getElementById('mines-bet-val').value);
    const mCount = parseInt(document.getElementById('mines-count').value);
    if(!validateBet(bet)) return;
    socket.emit('start_mines', { bet, mCount, mode: currentMode });
}

socket.on('mines_ready', () => {
    renderMines([]);
    document.getElementById('mines-main-btn').innerText = 'ЗАБРАТЬ';
    document.getElementById('mines-main-btn').onclick = () => socket.emit('mines_cashout');
    document.getElementById('mines-main-btn').classList.replace('btn-success', 'btn-primary');
});

socket.on('mine_hit', (data) => {
    document.querySelectorAll('.mine-cell')[data.idx].innerHTML = '💎';
    document.querySelectorAll('.mine-cell')[data.idx].classList.add('opened');
    document.getElementById('mines-main-btn').innerText = `ЗАБРАТЬ (x${data.mult})`;
    tg.HapticFeedback.impactOccurred('light');
});

socket.on('mines_fail', (field) => {
    renderMines(field);
    resetMinesUI();
    tg.HapticFeedback.notificationOccurred('error');
});

socket.on('mines_win', () => {
    resetMinesUI();
});

function resetMinesUI() {
    const btn = document.getElementById('mines-main-btn');
    btn.innerText = 'ИГРАТЬ';
    btn.onclick = startMines;
    btn.classList.replace('btn-primary', 'btn-success');
}

// --- ИГРА: CRASH ---
socket.on('crash_tick', (data) => {
    const rocket = document.getElementById('rocket');
    const mult = document.getElementById('crash-multiplier');
    const btn = document.getElementById('crash-main-btn');

    if(data.status === 'waiting') {
        mult.innerText = `00:${data.timer < 10 ? '0':''}${data.timer}`;
        mult.style.color = '#fff';
        rocket.style.transform = 'translate(0, 0)';
        
        btn.innerText = 'ПОСТАВИТЬ';
        btn.onclick = crashAction;
    } else if (data.status === 'flying') {
        mult.innerText = data.mult.toFixed(2) + 'x';
        mult.style.color = '#00ff66';
        
        let moveX = Math.min(data.mult * 15, 120);
        let moveY = Math.min(data.mult * 15, 120);
        rocket.style.transform = `translate(${moveX}px, -${moveY}px)`;
    }
});

socket.on('crash_boom', (data) => {
    document.getElementById('crash-multiplier').innerText = 'ВЗРЫВ!';
    document.getElementById('crash-multiplier').style.color = '#ff4444';
    tg.HapticFeedback.notificationOccurred('error');
    
    // История
    const hist = document.getElementById('crash-history');
    hist.innerHTML = data.history.map(x => `<span class="hist-badge" style="color:${x>2?'#00ff66':'#ff4444'}">${x}x</span>`).join('');
});

function crashAction() {
    const btn = document.getElementById('crash-main-btn');
    if(btn.innerText === 'ПОСТАВИТЬ') {
        const bet = parseFloat(document.getElementById('crash-bet-val').value);
        if(!validateBet(bet)) return;
        socket.emit('crash_place_bet', { bet, mode: currentMode });
    } else {
        socket.emit('crash_cashout');
    }
}

socket.on('crash_bet_ok', () => {
    const btn = document.getElementById('crash-main-btn');
    btn.innerText = 'ЗАБРАТЬ СТАВКУ';
    btn.onclick = crashAction; // Теперь кнопка работает на вывод
});

// --- LIVE ИСТОРИЯ ---
socket.on('history_update', (list) => {
    document.getElementById('live-list').innerHTML = list.map(h => 
        `<div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #333;">
            <span style="display:flex; gap:10px; align-items:center;">
                <img src="${h.photo}" width="20" height="20" style="border-radius:50%;"> 
                ${h.name} (${h.game})
            </span>
            <span style="color:${h.isWin?'#00ff66':'#ff4444'}">${h.isWin ? '+'+h.win.toFixed(2) : '-'+h.bet}</span>
        </div>`
    ).join('');
});

// --- АДМИН ПАНЕЛЬ (4 РАЗДЕЛА) ---
let adminClicks = 0;
function handleAdminTaps() {
    adminClicks++;
    if(adminClicks >= 7) {
        adminClicks = 0;
        const pass = prompt('Код доступа (Creator):');
        socket.emit('admin_auth', pass);
    }
    setTimeout(() => adminClicks = 0, 3000);
}

socket.on('admin_ok', () => {
    document.getElementById('modal-admin').classList.add('open');
    showToast('Панель администратора открыта', 'success');
});

function switchAdminTab(id) {
    document.querySelectorAll('.adm-pane').forEach(e => e.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

socket.on('admin_data', (data) => {
    sysRTP = data.settings;
    
    // 1. БД
    document.getElementById('adm-users').innerHTML = data.users.map(u => 
        `<div class="adm-item">
            <b>${u.firstName}</b> (${u.id})<br>
            <span style="color:#00ff66">Real: ${u.realBal.toFixed(2)} TON</span> | <span style="color:#aaa">Demo: ${u.demoBal.toFixed(2)}</span><br>
            Влил: ${u.spent} | Вывел: ${u.withdrawn}
        </div>`
    ).join('');

    // 2. Выводы (с возвратом средств)
    document.getElementById('adm-withdraw').innerHTML = data.withdraws.map(w => 
        `<div class="adm-item" style="border-color:#00aaff;">
            ${w.firstName} | <b>${w.amount} TON</b><br>
            <span style="color:#00aaff; cursor:pointer;" onclick="navigator.clipboard.writeText('${w.wallet}');showToast('Скопировано')">
                ${w.wallet} (Нажми для копирования)
            </span><br>
            <div style="display:flex; gap:5px; margin-top:10px;">
                <button class="btn btn-success" style="padding:8px; font-size:12px;" onclick="socket.emit('admin_withdraw_action', {id:'${w._id}', action:'approve'})">ПРИНЯТЬ</button>
                <button class="btn" style="background:#ff4444; padding:8px; font-size:12px;" onclick="socket.emit('admin_withdraw_action', {id:'${w._id}', action:'reject'})">ОТКЛОНИТЬ (ВОЗВРАТ)</button>
            </div>
        </div>`
    ).join('') || "Нет активных заявок";

    // 3. Промокоды
    document.getElementById('adm-p-list').innerHTML = data.promos.map(p => 
        `<div class="adm-item">
            Код: <b>${p.code}</b> | Сумма: ${p.amount} TON | Активаций: ${p.uses}
        </div>`
    ).join('');

    // 4. Настройки
    document.getElementById('rtp-crash').value = sysRTP.crashRtp;
    document.getElementById('rtp-mines').value = sysRTP.minesRtp;
    document.getElementById('rtp-coin').value = sysRTP.coinWinChance;
    
    document.getElementById('on-crash').checked = sysRTP.crashActive;
    document.getElementById('on-mines').checked = sysRTP.minesActive;
    document.getElementById('on-coin').checked = sysRTP.coinActive;
});

function createPromo() {
    socket.emit('admin_create_promo', {
        code: document.getElementById('adm-p-name').value,
        amount: parseFloat(document.getElementById('adm-p-sum').value),
        uses: parseInt(document.getElementById('adm-p-limit').value)
    });
}

function saveAdminSettings() {
    socket.emit('admin_save_settings', {
        crashRtp: parseFloat(document.getElementById('rtp-crash').value),
        minesRtp: parseFloat(document.getElementById('rtp-mines').value),
        coinWinChance: parseFloat(document.getElementById('rtp-coin').value),
        crashActive: document.getElementById('on-crash').checked,
        minesActive: document.getElementById('on-mines').checked,
        coinActive: document.getElementById('on-coin').checked
    });
}

// --- ГЕНЕРАТОР ЗВЕЗД ---
setInterval(() => {
    let s = document.createElement('div');
    s.className = 'star';
    let size = Math.random() * 3 + 1;
    s.style.width = size + 'px'; 
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (Math.random() * 3 + 2) + 's';
    document.getElementById('stars').appendChild(s);
    setTimeout(() => s.remove(), 5000);
}, 300);
