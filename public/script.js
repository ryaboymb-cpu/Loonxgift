const socket = io();
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

function createStars() {
    const container = document.getElementById('stars-container');
    for (let i = 0; i < 50; i++) {
        let star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + 'vw';
        star.style.width = Math.random() * 3 + 'px';
        star.style.height = star.style.width;
        star.style.animationDuration = (Math.random() * 3 + 2) + 's';
        star.style.animationDelay = Math.random() * 5 + 's';
        container.appendChild(star);
    }
}
createStars();

// Инициализация TON Connect
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-btn'
});

let userData = {
    id: tg.initDataUnsafe?.user?.id || Math.floor(Math.random() * 100000).toString(),
    username: tg.initDataUnsafe?.user?.username || "",
    photo: tg.initDataUnsafe?.user?.photo_url || "https://cdn-icons-png.flaticon.com/512/149/149071.png"
};

let currentMode = 'demo';
let localData = { realBal: 0, demoBal: 0, games: 0, wins: 0 };
let inGameCrash = false;
let inGameMines = false;
let isMineProcessing = false;
let inGameCoinflip = false;
let selectedCoinSide = null;

socket.emit('init_user', userData);

socket.on('user_data', (d) => {
    localData = d;
    document.getElementById('tg-avatar').src = d.photoUrl || userData.photo;
    document.getElementById('profile-avatar').src = d.photoUrl || userData.photo;
    document.getElementById('p-name').innerText = d.tgName || "Player";
    document.getElementById('p-id').innerText = d.id;
    document.getElementById('s-games').innerText = d.games;
    document.getElementById('s-wins').innerText = d.wins;
    updateBalanceDisplay();
});

socket.on('online_update', (count) => { document.getElementById('online-val').innerText = count; });
socket.on('alert', (msg) => tg.showAlert(msg));

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

function switchTab(tabId, element) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    element.classList.add('active');
    tg.HapticFeedback.impactOccurred('light');
}

function openGame(game) {
    document.getElementById('screen-' + game).style.display = 'flex';
    if(game === 'crash') {
        tg.HapticFeedback.impactOccurred('heavy'); // Звук/вибро при ВХОДЕ в краш
    }
    if(game === 'mines' && !inGameMines) drawMinesGrid();
}

function closeGame() {
    document.querySelectorAll('.game-fullscreen').forEach(el => el.style.display = 'none');
}

// ЛИМИТЫ СТАВОК (от 0.1 до 20)
function changeBet(game, val) {
    let inputIds = { 'crash': 'c-bet', 'mines': 'm-bet', 'coinflip': 'cf-bet' };
    let input = document.getElementById(inputIds[game]);
    let newVal = parseFloat(input.value) + val;
    if (newVal < 0.1) newVal = 0.1;
    if (newVal > 20.0) newVal = 20.0;
    input.value = newVal.toFixed(1);
}

// === CRASH ===
socket.on('crash_update', (d) => {
    let multEl = document.getElementById('c-mult');
    let btn = document.getElementById('c-btn');
    let rocket = document.getElementById('rocket-container');
    
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
        // Жужжание (tg.HapticFeedback.notificationOccurred('error')) УБРАНО!
    }
});

function crashAction() {
    tg.HapticFeedback.impactOccurred('medium');
    if (!inGameCrash) {
        let betAmt = parseFloat(document.getElementById('c-bet').value);
        if(betAmt < 0.1 || betAmt > 20) return tg.showAlert("Ставка должна быть от 0.1 до 20 TON");
        if(betAmt > (currentMode === 'real' ? localData.realBal : localData.demoBal)) return tg.showAlert("Недостаточно средств");
        
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

socket.on('live_bet', (betData) => {
    const list = document.getElementById('crash-live-bets');
    if(!list) return;
    let winHtml = betData.win > 0 
        ? `<span class="live-bet-win">+${betData.win.toFixed(2)} TON</span>` 
        : `<span class="live-bet-lose">-${betData.amount.toFixed(2)}</span>`;
    let item = document.createElement('div');
    item.className = 'live-bet-item';
    item.innerHTML = `<span class="live-bet-user">${betData.user}</span>${winHtml}`;
    list.prepend(item);
    if(list.children.length > 15) list.removeChild(list.lastChild);
});

// === MINES ===
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
        if(betAmt < 0.1 || betAmt > 20) return tg.showAlert("Ставка должна быть от 0.1 до 20 TON");
        if(betAmt > (currentMode === 'real' ? localData.realBal : localData.demoBal)) return tg.showAlert("Недостаточно средств");
        
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
    isMineProcessing = true; 
    socket.emit('mines_open', idx);
}

socket.on('mines_safe', (d) => {
    tg.HapticFeedback.impactOccurred('light');
    let cell = document.getElementById('m-grid').children[d.idx];
    cell.classList.add('revealed', 'gem');
    cell.innerText = "💎";
    document.getElementById('m-mult-display').innerText = d.mult + "x";
    isMineProcessing = false; 
});

socket.on('mines_boom', (field) => {
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

// === COINFLIP ===
function selectCoinSide(side) {
    if(inGameCoinflip) return;
    selectedCoinSide = side;
    document.getElementById('btn-choice-l').classList.remove('active');
    document.getElementById('btn-choice-x').classList.remove('active');
    document.getElementById(`btn-choice-${side.toLowerCase()}`).classList.add('active');
    
    let btn = document.getElementById('cf-btn');
    btn.disabled = false;
    btn.innerText = `ПОСТАВИТЬ НА ${side}`;
}

function coinflipAction() {
    if(inGameCoinflip || !selectedCoinSide) return;
    let betAmt = parseFloat(document.getElementById('cf-bet').value);
    if(betAmt < 0.1 || betAmt > 20) return tg.showAlert("Ставка должна быть от 0.1 до 20 TON");
    if(betAmt > (currentMode === 'real' ? localData.realBal : localData.demoBal)) return tg.showAlert("Недостаточно средств");
    
    tg.HapticFeedback.impactOccurred('medium');
    inGameCoinflip = true;
    document.getElementById('cf-btn').disabled = true;
    document.getElementById('cf-btn').innerText = "КРУТИМ...";
    document.getElementById('coin-result-text').innerText = "Монетка летит...";
    
    const coin = document.getElementById('coin');
    coin.classList.add('flipping');
    
    socket.emit('coinflip_play', { bet: betAmt, mode: currentMode, side: selectedCoinSide });
}

socket.on('coinflip_result', (d) => {
    const coin = document.getElementById('coin');
    setTimeout(() => {
        coin.classList.remove('flipping');
        if(d.resultSide === 'L') { coin.style.transform = 'rotateY(0deg)'; } 
        else { coin.style.transform = 'rotateY(180deg)'; }
        
        setTimeout(() => {
            if(d.win) {
                tg.HapticFeedback.notificationOccurred('success');
                document.getElementById('coin-result-text').innerText = `🎉 Выпало ${d.resultSide}! Вы выиграли ${d.winAmount} TON`;
            } else {
                document.getElementById('coin-result-text').innerText = `💀 Выпало ${d.resultSide}. Вы проиграли.`;
            }
            inGameCoinflip = false;
            document.getElementById('cf-btn').disabled = false;
            document.getElementById('cf-btn').innerText = `ПОСТАВИТЬ НА ${selectedCoinSide}`;
        }, 500);
    }, 2000); 
});

// === КОШЕЛЕК И ДЕМО ===
async function makeDeposit() {
    const amount = parseFloat(document.getElementById('dep-amt').value);
    if(!amount || amount < 0.1) return tg.showAlert("Минимальная сумма 0.1 TON");
    if(!tonConnectUI.connected) return tg.showAlert("Сначала подключите кошелек!");

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{
            address: "UQCTqV9scQaZR0DHzOnMrOCCY7z3MIT0QfoNrtUDZiXHY1-K", 
            amount: (amount * 1000000000).toString() 
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        socket.emit('deposit_success', { amount: amount });
        tg.showAlert(`✅ Успешно! ${amount} TON зачислены на ваш баланс.`);
        document.getElementById('dep-amt').value = '';
    } catch(e) {
        tg.showAlert("Транзакция отменена или произошла ошибка.");
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

function claimDemo() {
    socket.emit('claim_demo');
}

function activatePromo() {
    let code = document.getElementById('promo-in').value;
    if(!code) return tg.showAlert("Введите код");
    socket.emit('activate_promo', code);
    document.getElementById('promo-in').value = '';
}

// === АДМИНКА (10 КЛИКОВ) ===
let adminClicks = 0;
let adminTimer = null;

function handleHeaderClick() {
    adminClicks++;
    clearTimeout(adminTimer);
    
    // Если юзер не успел нажать 10 раз за 2 секунды, счетчик сбрасывается
    adminTimer = setTimeout(() => { adminClicks = 0; }, 2000); 

    if (adminClicks >= 10) {
        adminClicks = 0;
        let pwd = prompt("Введите пароль доступа:", "");
        if (pwd === "7788") {
            openAdminPanel();
        } else if (pwd !== null) {
            tg.showAlert("Неверный пароль!");
        }
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

socket.on('admin_data_response', (data) => {
    let uHtml = '';
    data.users.forEach(u => {
        let uName = u.tgName ? u.tgName : "Без имени";
        let uTgUsername = u.tgName ? u.tgName : ""; 
        uHtml += `
            <div class="adm-list-item" onclick="openUserManage('${u.id}', '${uName}', ${u.realBal}, '${uTgUsername}')">
                <span><b>${uName}</b> (ID: ${u.id})</span>
                <span style="color:var(--success-color)">${u.realBal.toFixed(2)} T</span>
            </div>
        `;
    });
    document.getElementById('admin-users-list').innerHTML = uHtml;

    let wHtml = '';
    data.withdraws.forEach(w => {
        wHtml += `
            <div class="adm-list-item" style="flex-direction:column; align-items:flex-start;">
                <div style="width:100%; display:flex; justify-content:space-between; margin-bottom:5px;">
                    <b>${w.tgName || 'Игрок'}</b> 
                    <span style="color:#007aff; font-weight:bold;">${w.amount} TON</span>
                </div>
                <div style="font-size:11px; color:gray; word-break:break-all; margin-bottom:10px;" 
                     onclick="copyText('${w.address}')">
                    Адрес (Нажми чтоб скопировать):<br> <span style="color:#fff;">${w.address}</span>
                </div>
                <div class="adm-actions" style="width:100%; display:flex; justify-content:space-between;">
                    <button class="btn-green" style="width:48%; padding:10px;" onclick="processWithdraw('${w._id}', 'approve')">✔ Одобрить</button>
                    <button class="btn-red" style="width:48%; padding:10px;" onclick="processWithdraw('${w._id}', 'reject')">✖ Отказать</button>
                </div>
            </div>
        `;
    });
    if(data.withdraws.length === 0) wHtml = "<p style='text-align:center; color:gray; margin-top:20px;'>Нет заявок на вывод</p>";
    document.getElementById('admin-withdraw-list').innerHTML = wHtml;
});

function copyText(text) {
    navigator.clipboard.writeText(text).then(() => { tg.showAlert("Адрес скопирован!"); });
}

let currentManageUserId = null;
let currentManageTgName = null;
function openUserManage(id, name, bal, tgUsername) {
    currentManageUserId = id;
    currentManageTgName = tgUsername;
    document.getElementById('manage-u-name').innerText = name;
    document.getElementById('manage-u-id').innerText = id;
    document.getElementById('manage-u-real').innerText = bal.toFixed(2);
    
    let linkBtn = document.getElementById('manage-u-tglink');
    if(tgUsername && tgUsername.length > 0) {
        linkBtn.style.display = 'block';
        linkBtn.onclick = () => tg.openTelegramLink(`https://t.me/${tgUsername}`);
    } else {
        linkBtn.style.display = 'none';
    }
    document.getElementById('user-manage-modal').style.display = 'flex';
}

function closeUserManage() { document.getElementById('user-manage-modal').style.display = 'none'; }

function editUserBalance(action) {
    let amt = parseFloat(document.getElementById('manage-u-amount').value);
    if(!amt || amt <= 0) return tg.showAlert("Введите сумму");
    socket.emit('admin_action', { action: 'edit_balance', userId: currentManageUserId, type: action, amount: amt });
    document.getElementById('manage-u-amount').value = '';
    closeUserManage();
    setTimeout(() => socket.emit('admin_get_data'), 500); 
}

function processWithdraw(reqId, action) {
    socket.emit('admin_action', { action: 'process_withdraw', reqId: reqId, status: action });
    setTimeout(() => socket.emit('admin_get_data'), 500);
}

function createAdminPromo() {
    let code = document.getElementById('adm-promo-code').value;
    let sum = document.getElementById('adm-promo-sum').value;
    let uses = document.getElementById('adm-promo-uses').value;
    if(code && sum && uses) {
        socket.emit('admin_action', { action: 'create_promo', code: code, reward: parseFloat(sum), uses: parseInt(uses) });
        tg.showAlert("Промокод создан!");
        document.getElementById('adm-promo-code').value = '';
        document.getElementById('adm-promo-sum').value = '';
        document.getElementById('adm-promo-uses').value = '';
    } else {
        tg.showAlert("Заполните все поля");
    }
}
