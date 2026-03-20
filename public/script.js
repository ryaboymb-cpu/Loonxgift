const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const socket = io();
let user = null;
let currentMode = 'real';
let tonConnectUI = null;
let isPlaying = false; // Защита от даблкликов

// --- ИНИЦИАЛИЗАЦИЯ И ФИКС БЕСКОНЕЧНОЙ ЗАГРУЗКИ ---
socket.on('connect', () => {
    socket.emit('init', { initData: tg.initData, start_param: tg.initDataUnsafe.start_param });
});

socket.on('init_data', (data) => {
    user = data.user;
    updateBalanceDisplay();
    document.getElementById('user-ava').src = user.avatar || 'https://t.me/i/userpic/320/default.jpg';
    
    // Прячем лоадер, всё загрузилось
    const loader = document.getElementById('loader');
    if(loader) loader.style.opacity = '0';
    setTimeout(() => { if(loader) loader.style.display = 'none'; }, 500);

    renderQuickBets();
    checkAdmin();
});

// Запасной фикс: если сервер тупит больше 5 сек, пускаем в оффлайн режим просмотра
setTimeout(() => {
    const loader = document.getElementById('loader');
    if(loader && loader.style.display !== 'none') {
        loader.style.display = 'none';
        showToast('Проблема с подключением к серверу');
    }
}, 5000);

// --- НАВИГАЦИЯ ---
function nav(page, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    el.classList.add('active');
    
    if (page === 'profile') loadProfile();
}

function navGame(game) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + game).classList.add('active');
    if(game === 'battle') socket.emit('get_battle_lobbies');
}

// --- БАЛАНС И АНИМАЦИЯ ---
function updateBalanceDisplay() {
    const bal = currentMode === 'real' ? user.balance : user.demo_balance;
    document.getElementById('bal-val').innerText = bal.toFixed(2);
}

function toggleMode() {
    currentMode = currentMode === 'real' ? 'demo' : 'real';
    document.getElementById('bal-mode').innerText = currentMode === 'real' ? 'REAL TON' : 'DEMO TON';
    document.getElementById('bal-mode').style.borderColor = currentMode === 'real' ? 'var(--neon)' : '#ff9900';
    document.getElementById('bal-mode').style.color = currentMode === 'real' ? 'var(--neon)' : '#ff9900';
    updateBalanceDisplay();
}

function showWinAnimation(amount) {
    const el = document.createElement('div');
    el.className = 'floating-win';
    el.innerText = '+' + amount.toFixed(2);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// --- БЫСТРЫЕ СТАВКИ (ФИКС) ---
const quickBetValues = [0.1, 0.5, 1, 5, 10, 25];
function renderQuickBets() {
    const containers = ['qb-crash', 'qb-mines', 'qb-coinflip'];
    const inputs = ['cr-bet', 'mi-bet', 'co-bet'];

    containers.forEach((cid, idx) => {
        const c = document.getElementById(cid);
        if(!c) return;
        c.innerHTML = '';
        quickBetValues.forEach(val => {
            const btn = document.createElement('div');
            btn.className = 'qb-btn';
            btn.innerText = val;
            btn.onclick = () => document.getElementById(inputs[idx]).value = val;
            c.appendChild(btn);
        });
    });
}

// --- CRASH ---
socket.on('crash_tick', (data) => {
    document.getElementById('cr-x').innerText = data.multiplier.toFixed(2) + 'x';
    document.getElementById('cr-x').style.color = data.crashed ? 'var(--neon-red)' : 'var(--neon)';
    if(data.crashed) {
        document.getElementById('cr-timer').innerText = `КРАШ! СЛЕД. РАУНД ЧЕРЕЗ ${data.timeToNext}С`;
        document.getElementById('cr-btn').innerText = 'ПОСТАВИТЬ';
        document.getElementById('cr-btn').disabled = false;
        isPlaying = false;
    } else {
        document.getElementById('cr-timer').innerText = 'В ПОЛЕТЕ...';
    }
});

function playCrash() {
    if(isPlaying) return;
    const bet = parseFloat(document.getElementById('cr-bet').value);
    if(isNaN(bet) || bet <= 0) return showToast('Введите сумму');
    
    isPlaying = true;
    document.getElementById('cr-btn').disabled = true;
    socket.emit('play_crash', { bet, mode: currentMode }, (res) => {
        if(res.error) {
            isPlaying = false;
            document.getElementById('cr-btn').disabled = false;
            return showToast(res.error);
        }
        if(res.action === 'bet') {
            document.getElementById('cr-btn').innerText = 'ЗАБРАТЬ';
            document.getElementById('cr-btn').disabled = false;
            user.balance = res.balance;
            updateBalanceDisplay();
        } else if (res.action === 'cashout') {
            showWinAnimation(res.win);
            user.balance = res.balance;
            updateBalanceDisplay();
            document.getElementById('cr-btn').innerText = 'ПОСТАВИТЬ';
            isPlaying = false;
        }
    });
}

// --- MINES ---
let minesActive = false;
function playMines() {
    if(isPlaying) return;
    const bet = parseFloat(document.getElementById('mi-bet').value);
    if(isNaN(bet) || bet <= 0) return showToast('Введите сумму');

    isPlaying = true;
    document.getElementById('mi-btn').disabled = true;
    socket.emit('start_mines', { bet, mode: currentMode }, (res) => {
        if(res.error) { isPlaying = false; document.getElementById('mi-btn').disabled = false; return showToast(res.error); }
        minesActive = true;
        user.balance = res.balance;
        updateBalanceDisplay();
        renderMinesField(true);
        document.getElementById('mi-btn').innerText = 'ЗАБРАТЬ';
        document.getElementById('mi-btn').disabled = false;
        document.getElementById('mi-btn').onclick = cashoutMines;
        isPlaying = false;
    });
}

function renderMinesField(active) {
    const grid = document.getElementById('mine-grid');
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'm-cell';
        if(active) {
            cell.onclick = () => openMine(i, cell);
        }
        grid.appendChild(cell);
    }
}
renderMinesField(false); // Сразу показываем поле при входе

function openMine(index, cell) {
    if(!minesActive || isPlaying || cell.classList.contains('open')) return;
    isPlaying = true;
    socket.emit('click_mine', { index }, (res) => {
        isPlaying = false;
        if(res.error) return showToast(res.error);
        cell.classList.add('open');
        if(res.type === 'gem') {
            cell.innerText = '💎';
        } else {
            cell.innerText = '💣';
            cell.style.background = 'var(--neon-red)';
            endMines(false);
        }
    });
}

function cashoutMines() {
    if(!minesActive || isPlaying) return;
    isPlaying = true;
    socket.emit('cashout_mines', {}, (res) => {
        isPlaying = false;
        if(res.error) return showToast(res.error);
        showWinAnimation(res.win);
        user.balance = res.balance;
        updateBalanceDisplay();
        endMines(true);
    });
}

function endMines(won) {
    minesActive = false;
    document.getElementById('mi-btn').innerText = 'ИГРАТЬ';
    document.getElementById('mi-btn').onclick = playMines;
}

// --- COINFLIP ---
let selectedSide = 'L';
function setSide(side) {
    selectedSide = side;
    document.querySelectorAll('.c-side').forEach(el => el.classList.remove('active'));
    document.querySelector(`.c-side[data-side="${side}"]`).classList.add('active');
}

function playCoin() {
    if(isPlaying) return;
    const bet = parseFloat(document.getElementById('co-bet').value);
    if(isNaN(bet) || bet <= 0) return showToast('Введите сумму');

    isPlaying = true;
    document.getElementById('co-btn').disabled = true;
    
    const coin = document.getElementById('coin-3d');
    coin.style.transition = 'none';
    coin.style.transform = 'rotateY(0deg)';
    
    socket.emit('play_coinflip', { bet, side: selectedSide, mode: currentMode }, (res) => {
        if(res.error) {
            isPlaying = false;
            document.getElementById('co-btn').disabled = false;
            return showToast(res.error);
        }

        user.balance = res.balance; // Сразу списываем
        updateBalanceDisplay();

        setTimeout(() => {
            coin.style.transition = 'transform 2s cubic-bezier(0.2, 0.8, 0.2, 1)';
            const spins = 5 * 360;
            const extra = res.result === 'X' ? 180 : 0;
            coin.style.transform = `rotateY(${spins + extra}deg)`;
            
            setTimeout(() => {
                if(res.win > 0) {
                    showWinAnimation(res.win);
                    user.balance = res.newBalance;
                    updateBalanceDisplay();
                    showToast('Победа!');
                } else {
                    showToast('Проигрыш');
                }
                isPlaying = false;
                document.getElementById('co-btn').disabled = false;
            }, 2100);
        }, 50);
    });
}

// --- BATTLE ROULETTE ---
function openBattleModal() {
    document.getElementById('battle-modal').style.display = 'flex';
}

function createBattleLobby() {
    const bet = parseFloat(document.getElementById('b-bet').value);
    const min = parseFloat(document.getElementById('b-min').value);
    const max = parseFloat(document.getElementById('b-max').value);
    
    if(isNaN(bet) || bet <= 0) return showToast('Неверная ставка');
    
    socket.emit('create_battle', { bet, min, max, mode: currentMode }, (res) => {
        if(res.error) return showToast(res.error);
        document.getElementById('battle-modal').style.display = 'none';
        user.balance = res.balance; // Сразу снимаем ставку создателя
        updateBalanceDisplay();
        openBattleGame(res.lobbyId);
    });
}

function openBattleGame(id) {
    document.getElementById('battle-game-modal').style.display = 'flex';
    socket.emit('join_battle_view', { lobbyId: id });
}

function closeBattleGame() {
    document.getElementById('battle-game-modal').style.display = 'none';
    socket.emit('leave_battle_view');
}

socket.on('battle_update', (data) => {
    // Отрисовка колеса и таймера (запуск только от 2 игроков)
    const timerEl = document.getElementById('battle-timer');
    if(data.status === 'waiting') {
        if(data.players.length < 2) {
            timerEl.innerText = 'ОЖИДАНИЕ ИГРОКОВ...';
        } else {
            timerEl.innerText = `СТАРТ ЧЕРЕЗ ${Math.ceil(data.timeLeft)}С`;
        }
    } else if (data.status === 'spinning') {
        timerEl.innerText = 'КРУТИМ!';
        // Логика анимации канваса колеса... (для экономии места базовая отрисовка секторов)
    } else if (data.status === 'finished') {
        timerEl.innerText = 'ПОБЕДИТЕЛЬ: ' + data.winnerName;
        if(data.winnerId === user.tgId) {
            showWinAnimation(data.winAmount);
            socket.emit('request_balance_update'); // Запрашиваем новый баланс
        }
    }
});

socket.on('update_balance', (data) => {
    user.balance = data.balance;
    updateBalanceDisplay();
});

// --- АДМИН ПАНЕЛЬ (ФУЛЛСКРИН И ИЗМЕНЕНИЕ БАЛАНСА) ---
function checkAdmin() {
    if(user && user.isAdmin) {
        document.getElementById('admin-modal').style.display = 'flex';
        switchAdminTab('users');
    }
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    const content = document.getElementById('admin-content');
    
    if(tab === 'users') {
        socket.emit('admin_get_users', {}, (users) => {
            content.innerHTML = users.map(u => `
                <div style="background:#111; padding:10px; margin-bottom:10px; border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
                    <div><b>${u.firstName}</b> (ID: ${u.tgId})<br><span style="color:var(--neon)">${u.balance.toFixed(2)} TON</span></div>
                    <button class="btn" style="width:auto; padding:8px; margin:0;" onclick="editUserBalance(${u.tgId}, '${u.firstName}')">Изменить</button>
                </div>
            `).join('');
        });
    }
}

function editUserBalance(id, name) {
    const newBal = prompt(`Введите новый баланс для ${name} (ID: ${id}):`);
    if(newBal !== null && !isNaN(newBal)) {
        socket.emit('admin_set_balance', { tgId: id, amount: parseFloat(newBal) }, (res) => {
            if(res.success) {
                showToast('Баланс обновлен!');
                switchAdminTab('users'); // Обновляем список (работает и на iOS и на Android)
            } else {
                showToast(res.error);
            }
        });
    }
}

// Утилиты
function showToast(msg) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}
function copyText(txt) {
    navigator.clipboard.writeText(txt).then(() => showToast('Скопировано!'));
}
