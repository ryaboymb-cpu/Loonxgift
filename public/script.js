const socket = io();
let tg = window.Telegram.WebApp;
tg.expand();
tg.ready();
tg.enableClosingConfirmation();

// Надежно получаем имя (Фикс undefined)
const tgUser = tg.initDataUnsafe?.user || { id: "test_123", first_name: "Игрок", username: "loonx" };
const safeName = tgUser.first_name && tgUser.first_name !== 'undefined' ? tgUser.first_name : "Игрок";
const avatarUrl = tgUser.photo_url || "https://via.placeholder.com/100";

let localUser = null;
let currentMode = 'demo'; 
let sysRTP = {};

socket.emit('init', { id: tgUser.id, username: tgUser.username, name: safeName, photo: avatarUrl });

// TON CONNECT
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-button'
});

// ФИКС КНОПКИ ДЕПОЗИТА
async function depositTON() {
    if (!tonConnectUI.connected) {
        showToast('Сначала подключите кошелек кнопкой выше!', 'error');
        return;
    }
    
    const amountStr = prompt('Введите сумму депозита в TON (Минимум 1):');
    const amount = parseFloat(amountStr);
    if (!amount || amount < 1) return showToast('Некорректная сумма', 'error');

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
            address: "ТВОЙ_АДРЕС_КОШЕЛЬКА", // СЮДА ВПИШИ СВОЙ КОШЕЛЕК
            amount: (amount * 1000000000).toString()
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        socket.emit('deposit_success', amount);
    } catch (e) {
        showToast('Оплата отменена или ошибка', 'error');
    }
}

socket.on('user_update', (u) => {
    localUser = u;
    const balance = currentMode === 'real' ? u.realBal : u.demoBal;
    
    document.querySelectorAll('.bal-amount').forEach(el => el.innerText = balance.toFixed(2));
    document.querySelectorAll('.bal-cur').forEach(el => el.innerText = currentMode === 'real' ? 'TON' : 'D-TON');
    document.getElementById('mode-label').innerText = currentMode === 'real' ? 'REAL TON' : 'DEMO TON';
    
    // Фикс undefined для имени в интерфейсе
    const displayN = u.firstName && u.firstName !== 'undefined' ? u.firstName : safeName;
    document.getElementById('profile-name').innerText = displayN;
    document.getElementById('prof-name-big').innerText = displayN;
    
    document.getElementById('u-avatar').src = u.photo || avatarUrl;
    document.getElementById('prof-avatar-big').src = u.photo || avatarUrl;
    
    document.getElementById('st-games').innerText = u.stats?.games || 0;
    document.getElementById('st-wins').innerText = u.stats?.wins || 0;
});

function switchMode() {
    currentMode = currentMode === 'real' ? 'demo' : 'real';
    tg.HapticFeedback.impactOccurred('medium');
    socket.emit('init', { id: tgUser.id }); 
    showToast(`Режим: ${currentMode.toUpperCase()}`, 'success');
}

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

function switchTab(tabId, el) {
    document.querySelectorAll('.tab-pane').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    if(el) el.classList.add('active');
    tg.HapticFeedback.impactOccurred('light');
}

function openGame(g) { document.getElementById(`modal-${g}`).classList.add('open'); if(g === 'mines') renderMines([]); }
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')); }

function claimDaily() { socket.emit('claim_daily'); }

function requestWithdraw() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const wallet = document.getElementById('withdraw-wallet').value;
    if(amount < 5) return showToast('Мин. вывод: 5 TON', 'error');
    if(!wallet) return showToast('Введите адрес', 'error');
    socket.emit('request_withdraw', { amount, wallet });
}

function activatePromo() {
    const code = document.getElementById('promo-input').value;
    if(code) socket.emit('use_promo', code);
}

function validateBet(val) {
    if(val < 0.5 || val > 20) { showToast('Ставка от 0.5 до 20 TON', 'error'); return false; }
    return true;
}

let coinFlipping = false;
function playCoin(side) {
    if(coinFlipping) return;
    const bet = parseFloat(document.getElementById('coin-bet-val').value);
    if(!validateBet(bet)) return;
    
    coinFlipping = true;
    document.getElementById('coin-object').classList.add('flipping');
    document.getElementById('coin-result-text').innerText = 'Крутим...';
    socket.emit('play_coin', { bet, side, mode: currentMode });
}

socket.on('coin_res', (data) => {
    setTimeout(() => {
        const coin = document.getElementById('coin-object');
        coin.classList.remove('flipping');
        coin.innerText = data.resultSide;
        coin.style.color = data.isWin ? '#00ff66' : '#ff4444';
        document.getElementById('coin-result-text').innerText = data.isWin ? 'ПОБЕДА!' : 'ПРОИГРЫШ';
        document.getElementById('coin-result-text').style.color = data.isWin ? '#00ff66' : '#ff4444';
        coinFlipping = false;
    }, 1200); 
});

function renderMines(field) {
    const grid = document.getElementById('mines-grid');
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        let div = document.createElement('div');
        div.className = 'mine-cell';
        if(field[i] === 'mine') { div.innerHTML = '💣'; div.classList.add('boom'); } 
        else if(field[i] === 'safe') { div.innerHTML = '💎'; div.classList.add('opened'); }
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
    document.getElementById('mines-main-btn').classList.replace('btn-green-solid', 'btn-blue');
});

socket.on('mine_hit', (data) => {
    document.querySelectorAll('.mine-cell')[data.idx].innerHTML = '💎';
    document.querySelectorAll('.mine-cell')[data.idx].classList.add('opened');
    document.getElementById('mines-main-btn').innerText = `ЗАБРАТЬ (x${data.mult})`;
    tg.HapticFeedback.impactOccurred('light');
});

socket.on('mines_fail', (field) => { renderMines(field); resetMinesUI(); tg.HapticFeedback.notificationOccurred('error'); });
socket.on('mines_win', () => { resetMinesUI(); });

function resetMinesUI() {
    const btn = document.getElementById('mines-main-btn');
    btn.innerText = 'ИГРАТЬ';
    btn.onclick = startMines;
    btn.classList.replace('btn-blue', 'btn-green-solid');
}

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
        rocket.style.transform = `translate(${Math.min(data.mult * 15, 120)}px, -${Math.min(data.mult * 15, 120)}px)`;
    }
});

socket.on('crash_boom', (data) => {
    document.getElementById('crash-multiplier').innerText = 'ВЗРЫВ!';
    document.getElementById('crash-multiplier').style.color = '#ff4444';
    tg.HapticFeedback.notificationOccurred('error');
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
    btn.innerText = 'ЗАБРАТЬ';
    btn.onclick = crashAction;
});

// ФИКС ИМЕН В ИСТОРИИ СТАВОК
socket.on('history_update', (list) => {
    document.getElementById('live-list').innerHTML = list.map(h => {
        let n = h.name && h.name !== 'undefined' ? h.name : "Игрок";
        return `<div class="live-item">
            <span class="l-left"><img src="${h.photo}" class="l-avatar"> ${n} (${h.game})</span>
            <span class="l-right" style="color:${h.isWin?'#00ff66':'#ff4444'}">${h.isWin ? '+'+h.win.toFixed(2) : '-'+h.bet}</span>
        </div>`;
    }).join('');
});

// АДМИНКА
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

socket.on('admin_ok', () => { document.getElementById('modal-admin').classList.add('open'); showToast('Админка открыта', 'success'); });
function switchAdminTab(id) { document.querySelectorAll('.adm-pane').forEach(e => e.classList.remove('active')); document.getElementById(id).classList.add('active'); }

socket.on('admin_data', (data) => {
    sysRTP = data.settings;
    document.getElementById('adm-users').innerHTML = data.users.map(u => 
        `<div class="adm-item"><b>${u.firstName}</b><br><span style="color:#00ff66">Real: ${u.realBal.toFixed(2)} TON</span> | Demo: ${u.demoBal.toFixed(2)}<br>Влил: ${u.spent} | Вывел: ${u.withdrawn}</div>`
    ).join('');

    document.getElementById('adm-withdraw').innerHTML = data.withdraws.map(w => 
        `<div class="adm-item">${w.firstName} | <b>${w.amount} TON</b><br><span style="color:#00aaff; cursor:pointer;" onclick="navigator.clipboard.writeText('${w.wallet}');showToast('Скопировано')">${w.wallet}</span><br><button class="btn btn-green-solid" style="padding:5px; margin-top:5px;" onclick="socket.emit('admin_withdraw_action', {id:'${w._id}', action:'approve'})">ПРИНЯТЬ</button> <button class="btn" style="background:#ff4444; padding:5px;" onclick="socket.emit('admin_withdraw_action', {id:'${w._id}', action:'reject'})">ОТКЛОНИТЬ</button></div>`
    ).join('') || "Нет заявок";

    document.getElementById('adm-p-list').innerHTML = data.promos.map(p => `<div class="adm-item">${p.code} | ${p.amount} TON | Активаций: ${p.uses}</div>`).join('');

    document.getElementById('rtp-crash').value = sysRTP.crashRtp;
    document.getElementById('rtp-mines').value = sysRTP.minesRtp;
    document.getElementById('rtp-coin').value = sysRTP.coinWinChance;
    document.getElementById('on-crash').checked = sysRTP.crashActive;
    document.getElementById('on-mines').checked = sysRTP.minesActive;
    document.getElementById('on-coin').checked = sysRTP.coinActive;
});

function createPromo() { socket.emit('admin_create_promo', { code: document.getElementById('adm-p-name').value, amount: parseFloat(document.getElementById('adm-p-sum').value), uses: parseInt(document.getElementById('adm-p-limit').value) }); }
function saveAdminSettings() { socket.emit('admin_save_settings', { crashRtp: parseFloat(document.getElementById('rtp-crash').value), minesRtp: parseFloat(document.getElementById('rtp-mines').value), coinWinChance: parseFloat(document.getElementById('rtp-coin').value), crashActive: document.getElementById('on-crash').checked, minesActive: document.getElementById('on-mines').checked, coinActive: document.getElementById('on-coin').checked }); }

// МЕДЛЕННЫЕ ЗВЕЗДЫ (От 7 до 15 секунд падение)
setInterval(() => {
    let s = document.createElement('div');
    s.className = 'star';
    let size = Math.random() * 3 + 1;
    s.style.width = size + 'px'; 
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (Math.random() * 8 + 7) + 's'; // Замедлил в 3 раза
    document.getElementById('stars').appendChild(s);
    setTimeout(() => s.remove(), 15000);
}, 400);
