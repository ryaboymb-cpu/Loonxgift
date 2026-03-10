const socket = io();
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// ИНИЦИАЛИЗАЦИЯ TON CONNECT
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-btn'
});

// ДАННЫЕ ЮЗЕРА
let userData = {
    id: tg.initDataUnsafe?.user?.id || Math.floor(Math.random() * 100000).toString(),
    username: tg.initDataUnsafe?.user?.username || "Guest",
    photo: tg.initDataUnsafe?.user?.photo_url || "https://via.placeholder.com/150"
};

let currentMode = 'demo';
let localData = { realBal: 0, demoBal: 0, games: 0, wins: 0 };

// Флаги игр
let inGameCrash = false;
let inGameMines = false;
let isMineProcessing = false; // Блокировка от спама кликами

// Подключение к серверу
socket.emit('init_user', userData);

// ОБНОВЛЕНИЕ ДАННЫХ
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
});

// ОПОВЕЩЕНИЯ
socket.on('alert', (msg) => tg.showAlert(msg));

// БАЛАНС И РЕЖИМЫ
function updateBalanceDisplay() {
    let bal = currentMode === 'real' ? localData.realBal : localData.demoBal;
    document.getElementById('h-bal').innerText = bal.toFixed(2);
    document.getElementById('w-bal').innerText = bal.toFixed(2);
    document.getElementById('h-mode').innerText = currentMode.toUpperCase();
}

function toggleMode() {
    currentMode = currentMode === 'demo' ? 'real' : 'demo';
    updateBalanceDisplay();
    tg.HapticFeedback.impactOccurred('light');
}

// НАВИГАЦИЯ
function switchTab(tabId, element) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    element.classList.add('active');
    tg.HapticFeedback.impactOccurred('light');
}

function openGame(game) {
    document.getElementById('screen-' + game).style.display = 'flex';
    if(game === 'mines' && !inGameMines) drawMinesGrid();
}
function closeGame() {
    document.querySelectorAll('.game-fullscreen').forEach(el => el.style.display = 'none');
}

function changeBet(game, val) {
    let input = document.getElementById(game === 'crash' ? 'c-bet' : 'm-bet');
    let newVal = parseFloat(input.value) + val;
    if(newVal >= 0.5) input.value = newVal.toFixed(1);
}

// ЛАЙВ СТАВКИ
socket.on('live_bet', (betData) => {
    const list = document.getElementById('global-live-bets');
    let winHtml = betData.win > 0 
        ? `<span class="live-bet-win">+${betData.win.toFixed(2)} TON</span>` 
        : `<span class="live-bet-lose">-${betData.amount.toFixed(2)}</span>`;
        
    let item = document.createElement('div');
    item.className = 'live-bet-item';
    item.innerHTML = `
        <span class="live-bet-user">${betData.game} | ${betData.user}</span>
        ${winHtml}
    `;
    list.prepend(item);
    if(list.children.length > 10) list.removeChild(list.lastChild);
});

// ===== CRASH =====
socket.on('crash_update', (d) => {
    let multEl = document.getElementById('c-mult');
    let btn = document.getElementById('c-btn');
    let rocket = document.getElementById('rocket-container');
    
    // История
    let histHtml = '';
    d.history.forEach(h => {
        let color = h >= 2.0 ? 'var(--success-color)' : 'var(--text-main)';
        histHtml += `<span style="color:${color}; font-weight:bold; margin-right:8px;">${parseFloat(h).toFixed(2)}x</span>`;
    });
    document.getElementById('crash-history').innerHTML = histHtml;

    if (d.status === 'waiting') {
        multEl.innerText = 'ВЗЛЕТ: ' + d.timer + 'с';
        multEl.style.color = '#fff';
        rocket.className = 'rocket-wrapper waiting';
        if(!inGameCrash) { btn.innerText = "СТАВКА"; btn.className = "btn-primary bet-btn"; btn.disabled = false; }
    } else if (d.status === 'flying') {
        multEl.innerText = d.mult.toFixed(2) + 'x';
        rocket.className = 'rocket-wrapper flying';
        if(inGameCrash) { btn.innerText = "ЗАБРАТЬ"; btn.className = "btn-primary btn-green bet-btn"; btn.disabled = false; }
        else { btn.disabled = true; }
    } else if (d.status === 'crashed') {
        multEl.innerText = d.mult.toFixed(2) + 'x';
        multEl.style.color = 'var(--danger-color)';
        rocket.className = 'rocket-wrapper crashed';
        if(inGameCrash) inGameCrash = false;
        btn.innerText = "СТАВКА"; btn.className = "btn-primary bet-btn"; btn.disabled = false;
        if(d.history[0] == d.mult.toFixed(2)) tg.HapticFeedback.notificationOccurred('error'); // Только вибрация, без звука
    }
});

function crashAction() {
    tg.HapticFeedback.impactOccurred('medium');
    if (!inGameCrash) {
        let betAmt = parseFloat(document.getElementById('c-bet').value);
        socket.emit('crash_bet', { bet: betAmt, mode: currentMode });
        inGameCrash = true;
        document.getElementById('c-btn').innerText = "ОЖИДАНИЕ...";
        document.getElementById('c-btn').disabled = true;
    } else {
        socket.emit('crash_cashout');
        inGameCrash = false;
    }
}
socket.on('crash_win', (d) => { tg.showAlert(`Вы забрали: ${d.win} TON (x${d.mult})`); });

// ===== MINES =====
function drawMinesGrid() {
    const grid = document.getElementById('m-grid');
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        let btn = document.createElement('button');
        btn.className = 'mine-btn';
        btn.onclick = () => openMineCell(i, btn);
        grid.appendChild(btn);
    }
}

function minesAction() {
    tg.HapticFeedback.impactOccurred('medium');
    if (!inGameMines) {
        let betAmt = parseFloat(document.getElementById('m-bet').value);
        socket.emit('mines_start', { bet: betAmt, mode: currentMode });
    } else {
        socket.emit('mines_cashout');
    }
}

socket.on('mines_ready', () => {
    inGameMines = true;
    isMineProcessing = false;
    document.getElementById('m-btn').innerText = "ЗАБРАТЬ";
    document.getElementById('m-btn').className = "btn-primary btn-green bet-btn";
    document.getElementById('m-mult-display').innerText = "1.00x";
    drawMinesGrid();
});

function openMineCell(idx, el) {
    if(!inGameMines || el.classList.contains('revealed') || isMineProcessing) return;
    isMineProcessing = true; // Блокируем клики до ответа сервера
    socket.emit('mines_open', idx);
}

socket.on('mines_safe', (d) => {
    tg.HapticFeedback.impactOccurred('light');
    let cell = document.getElementById('m-grid').children[d.idx];
    cell.classList.add('revealed', 'gem');
    cell.innerText = "💎";
    document.getElementById('m-mult-display').innerText = d.mult + "x";
    isMineProcessing = false; // Разблокируем клики
});

socket.on('mines_boom', (field) => {
    tg.HapticFeedback.notificationOccurred('error'); // Только вибрация
    inGameMines = false;
    isMineProcessing = false;
    document.getElementById('m-btn').innerText = "ИГРАТЬ";
    document.getElementById('m-btn').className = "btn-primary bet-btn";
    
    let cells = document.getElementById('m-grid').children;
    for(let i=0; i<25; i++) {
        cells[i].classList.add('revealed');
        if(field[i] === 'mine') {
            cells[i].classList.add('bomb');
            cells[i].innerText = "💣";
        } else {
            cells[i].innerText = "💎";
            cells[i].style.opacity = "0.5";
        }
    }
});

socket.on('mines_win', (d) => {
    inGameMines = false;
    isMineProcessing = false;
    document.getElementById('m-btn').innerText = "ИГРАТЬ";
    document.getElementById('m-btn').className = "btn-primary bet-btn";
    tg.showAlert(`Вы забрали: ${d.win} TON`);
    drawMinesGrid();
});

// ===== КОШЕЛЕК: ДЕПОЗИТ И ВЫВОД =====
async function makeDeposit() {
    const amount = parseFloat(document.getElementById('dep-amt').value);
    if(!amount || amount < 0.1) return tg.showAlert("Минимальная сумма 0.1 TON");
    if(!tonConnectUI.connected) return tg.showAlert("Сначала подключите кошелек!");

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{
            address: "UQCTqV9scQaZR0DHzOnMrOCCY7z3MIT0QfoNrtUDZiXHY1-K", // Твой кошелек
            amount: (amount * 1000000000).toString() 
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        tg.showAlert("Транзакция отправлена! Ожидайте зачисления.");
    } catch(e) {
        tg.showAlert("Транзакция отменена.");
    }
}

function requestWithdraw() {
    let addr = document.getElementById('withdraw-address').value;
    let amt = parseFloat(document.getElementById('withdraw-amt').value);
    
    if(!addr || addr.length < 20) return tg.showAlert("Введите корректный адрес TON");
    if(!amt || amt <= 0) return tg.showAlert("Введите сумму");
    if(currentMode !== 'real') return tg.showAlert("Вывод доступен только с реального счета!");
    if(amt > localData.realBal) return tg.showAlert("Недостаточно средств на балансе");

    socket.emit('withdraw_request', { address: addr, amount: amt });
    document.getElementById('withdraw-address').value = '';
    document.getElementById('withdraw-amt').value = '';
}

// ===== ПРОМОКОДЫ =====
function activatePromo() {
    let code = document.getElementById('promo-in').value;
    if(!code) return tg.showAlert("Введите код");
    socket.emit('activate_promo', code);
    document.getElementById('promo-in').value = '';
}

// ===== АДМИНКА (10 ТАПОВ ПО ЛОГОТИПУ) =====
let tapCount = 0;
let tapTimer;

function handleHeaderClick() {
    tapCount++;
    clearTimeout(tapTimer);
    
    if(tapCount >= 10) {
        tapCount = 0;
        openAdminPanel();
    } else {
        tapTimer = setTimeout(() => { tapCount = 0; }, 1000); // Сброс, если тапать медленно
    }
}

function openAdminPanel() {
    document.getElementById('admin-modal').style.display = 'flex';
    socket.emit('admin_get_data');
}

function closeAdminMenu() { 
    document.getElementById('admin-modal').style.display = 'none'; 
}

function switchAdminTab(tab) {
    document.querySelectorAll('.adm-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.adm-content').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('adm-tab-' + tab).classList.add('active');
}

// Получение данных в админку
socket.on('admin_data_response', (data) => {
    // Рендер Юзеров
    let uHtml = '';
    Object.values(data.users).forEach(u => {
        uHtml += `
            <div class="adm-list-item" onclick="openUserManage('${u.id}', '${u.tgName}', ${u.realBal})">
                <span><b>${u.tgName}</b> (ID: ${u.id})</span>
                <span style="color:var(--success-color)">${u.realBal.toFixed(2)} T</span>
            </div>
        `;
    });
    document.getElementById('admin-users-list').innerHTML = uHtml;

    // Рендер Выводов
    let wHtml = '';
    data.withdraws.forEach(w => {
        wHtml += `
            <div class="adm-list-item" style="flex-direction:column; align-items:flex-start;">
                <div style="width:100%; display:flex; justify-content:space-between;">
                    <b>${w.tgName}</b> <span>${w.amount} TON</span>
                </div>
                <div style="font-size:10px; color:gray; word-break:break-all; margin:5px 0;">${w.address}</div>
                <div class="adm-actions" style="width:100%; display:flex; justify-content:flex-end;">
                    <button class="btn-green" onclick="processWithdraw('${w.id}', 'approve')">✔ Оплачено</button>
                    <button class="btn-red" onclick="processWithdraw('${w.id}', 'reject')">✖ Отклонить</button>
                </div>
            </div>
        `;
    });
    if(data.withdraws.length === 0) wHtml = "<p style='text-align:center; color:gray;'>Нет заявок</p>";
    document.getElementById('admin-withdraw-list').innerHTML = wHtml;
});

// Управление балансом юзера
let currentManageUserId = null;
function openUserManage(id, name, bal) {
    currentManageUserId = id;
    document.getElementById('manage-u-name').innerText = name;
    document.getElementById('manage-u-id').innerText = id;
    document.getElementById('manage-u-real').innerText = bal.toFixed(2);
    document.getElementById('user-manage-modal').style.display = 'flex';
}
function closeUserManage() { document.getElementById('user-manage-modal').style.display = 'none'; }

function editUserBalance(action) {
    let amt = parseFloat(document.getElementById('manage-u-amount').value);
    if(!amt || amt <= 0) return tg.showAlert("Введите сумму");
    socket.emit('admin_action', { 
        action: 'edit_balance', 
        userId: currentManageUserId, 
        type: action, 
        amount: amt 
    });
    document.getElementById('manage-u-amount').value = '';
    closeUserManage();
    socket.emit('admin_get_data'); // Обновить списки
}

function processWithdraw(reqId, action) {
    socket.emit('admin_action', { action: 'process_withdraw', reqId: reqId, status: action });
    socket.emit('admin_get_data');
}

function createAdminPromo() {
    let code = document.getElementById('adm-promo-code').value;
    let sum = document.getElementById('adm-promo-sum').value;
    let uses = document.getElementById('adm-promo-uses').value;
    if(code && sum && uses) {
        socket.emit('admin_action', { action: 'create_promo', code: code, reward: parseFloat(sum), uses: parseInt(uses) });
        tg.showAlert("Промокод создан!");
    } else {
        tg.showAlert("Заполните все поля");
    }
}
