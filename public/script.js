const socket = io();
const tg = window.Telegram.WebApp;
tg.expand();

let user = null;
let currentBalMode = 'demo'; 
let selectedMines = 6;
let selectedCoin = 'L';
let adminClicks = 0;
let crashGameStatus = 'waiting';

const sounds = {
    click: new Audio('https://cdn.pixabay.com/audio/2022/03/15/audio_7833316c05.mp3'),
    win: new Audio('https://cdn.pixabay.com/audio/2021/08/04/audio_bb4062e12e.mp3'),
    boom: new Audio('https://cdn.pixabay.com/audio/2022/03/10/audio_c350596323.mp3'),
    money: new Audio('https://cdn.pixabay.com/audio/2021/08/04/audio_8242a98661.mp3')
};

function playSnd(type) {
    if (sounds[type]) {
        sounds[type].currentTime = 0;
        sounds[type].play().catch(() => {});
    }
}

const userData = tg.initDataUnsafe?.user || { id: '12345', first_name: 'Dev', photo_url: '' };
socket.emit('init_user', {
    id: userData.id,
    username: userData.first_name,
    photo: userData.photo_url
});

socket.on('user_data', (data) => {
    user = data;
    updateUI();
});

socket.on('alert_sound', (data) => {
    tg.showAlert(data.msg);
    if(data.type) playSnd(data.type);
});

function updateUI() {
    if(!user) return;
    const bal = currentBalMode === 'real' ? user.realBal : user.demoBal;
    document.getElementById('bal-val').innerText = bal.toFixed(2);
    document.getElementById('bal-mode').innerText = currentBalMode.toUpperCase();
    document.getElementById('bal-mode').style.color = currentBalMode === 'real' ? '#00cc66' : '#8b949e';
    
    document.getElementById('tg-avatar').src = user.photoUrl || '';
    document.getElementById('prof-ava').src = user.photoUrl || '';
    document.getElementById('prof-name').innerText = user.tgName;
    document.getElementById('prof-id').innerText = `ID: ${user.id}`;
    document.getElementById('s-games').innerText = user.games;
    document.getElementById('s-wins').innerText = user.wins;
    document.getElementById('s-spent').innerText = user.spent.toFixed(2);
    document.getElementById('s-withdrawn').innerText = user.withdrawn.toFixed(2);
}

function toggleBalance() {
    currentBalMode = currentBalMode === 'demo' ? 'real' : 'demo';
    playSnd('click');
    updateUI();
}

function nav(tabId, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    el.classList.add('active');
    playSnd('click');
}

function openScreen(id) {
    document.getElementById(`screen-${id}`).classList.add('active');
    playSnd('click');
    if(id === 'mines') renderMinesGrid();
}

function closeScreen() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
}

// --- CRASH ---
socket.on('crash_update', (state) => {
    crashGameStatus = state.status;
    const rocket = document.getElementById('rocket');
    const multText = document.getElementById('c-mult');
    const btn = document.getElementById('c-btn');
    
    if (state.status === 'waiting') {
        rocket.classList.remove('flying');
        rocket.style.transform = `translate(0, 0)`;
        multText.innerText = `Начало через ${state.timer}с`;
        multText.style.color = '#fff';
        btn.innerText = 'СТАВКА';
        btn.onclick = () => {
            const bet = parseFloat(document.getElementById('c-bet').value);
            socket.emit('crash_bet', { bet, mode: currentBalMode });
            playSnd('click');
            btn.innerText = 'ОЖИДАНИЕ...';
            btn.onclick = null;
        };
    } else if (state.status === 'flying') {
        rocket.classList.add('flying');
        multText.innerText = state.mult.toFixed(2) + 'x';
        rocket.style.transform = `translate(${Math.min(state.mult * 5, 50)}px, -${Math.min(state.mult * 5, 50)}px)`;
        
        // Если юзер в игре, меняем кнопку на ВЫВОД
        if(btn.innerText === 'ОЖИДАНИЕ...') {
            btn.innerText = 'ЗАБРАТЬ';
            btn.onclick = () => {
                socket.emit('crash_cashout');
                btn.innerText = 'ВЫВЕЛИ';
                btn.onclick = null;
            };
        }
    } else {
        rocket.classList.remove('flying');
        multText.innerText = 'BOOM!';
        multText.style.color = '#ff4444';
        btn.innerText = 'СТАВКА';
        btn.onclick = null;
        playSnd('boom');
    }
});

socket.on('crash_live_bets', (bets) => {
    const cont = document.getElementById('c-live');
    cont.innerHTML = bets.map(b => `
        <div class="list-item">
            <div style="display:flex; align-items:center;">
                <img src="${b.photoUrl}" onerror="this.src=''"> <span style="margin-left:5px;">${b.tgName}</span>
            </div>
            <span style="color:${b.status === 'cashed' ? '#00cc66' : '#aaa'}">
                ${b.bet} TON ${b.win > 0 ? '(+' + b.win.toFixed(2) + ')' : ''}
            </span>
        </div>
    `).join('');
});

// --- MINES ---
function setMines(count, btnId) {
    selectedMines = count;
    document.querySelectorAll('#screen-mines .btn-dark').forEach(b => b.classList.remove('active-btn'));
    document.getElementById(btnId).classList.add('active-btn');
    playSnd('click');
}

function renderMinesGrid() {
    const grid = document.getElementById('m-grid');
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.onclick = () => socket.emit('mines_open', i);
        grid.appendChild(cell);
    }
}

function minesPlay() {
    const bet = parseFloat(document.getElementById('m-bet').value);
    socket.emit('mines_start', { bet, mode: currentBalMode, minesCount: selectedMines });
    playSnd('click');
}

socket.on('mines_started', () => {
    renderMinesGrid();
    const btn = document.getElementById('m-btn');
    btn.innerText = 'ЗАБРАТЬ';
    btn.onclick = () => socket.emit('mines_cashout');
});

socket.on('mines_safe', (data) => {
    const cells = document.querySelectorAll('.mine-cell');
    cells[data.idx].classList.add('safe');
    cells[data.idx].innerText = '💎';
    document.getElementById('m-mult').innerText = data.mult + 'x';
    playSnd('click');
});

socket.on('mines_boom', (field) => {
    const cells = document.querySelectorAll('.mine-cell');
    field.forEach((val, i) => {
        if(val === 'mine') {
            cells[i].classList.add('boom');
            cells[i].innerText = '💣';
        }
    });
    playSnd('boom');
    resetMinesUI();
});

socket.on('mines_win', () => {
    playSnd('money');
    resetMinesUI();
});

function resetMinesUI() {
    const btn = document.getElementById('m-btn');
    btn.innerText = 'СТАВКА';
    btn.onclick = minesPlay;
    document.getElementById('m-mult').innerText = '1.00x';
}

// --- COINFLIP ---
function setCoin(side, btnId) {
    selectedCoin = side;
    document.getElementById('btn-cf-l').classList.replace('btn-blue', 'btn-dark');
    document.getElementById('btn-cf-x').classList.replace('btn-blue', 'btn-dark');
    document.getElementById('btn-cf-l').classList.remove('active-btn');
    document.getElementById('btn-cf-x').classList.remove('active-btn');
    
    document.getElementById(btnId).classList.replace('btn-dark', 'btn-blue');
    document.getElementById(btnId).classList.add('active-btn');
    playSnd('click');
}

function coinflipPlay() {
    const bet = parseFloat(document.getElementById('cf-bet').value);
    const coin = document.getElementById('coin');
    coin.classList.add('spinning');
    
    socket.emit('coinflip_play', { bet, mode: currentBalMode, side: selectedCoin });
    playSnd('click');
}

socket.on('coinflip_result', (data) => {
    const coin = document.getElementById('coin');
    setTimeout(() => {
        coin.classList.remove('spinning');
        const rotation = data.resultSide === 'L' ? 0 : 180;
        coin.style.transform = `rotateY(${rotation + 1800}deg)`; 
        
        setTimeout(() => {
            if(data.win) playSnd('money');
            else playSnd('boom');
        }, 500);
    }, 1500);
});

// --- ПРОМО И ВЫВОД ---
function activatePromo() {
    const code = document.getElementById('promo-code').value;
    socket.emit('activate_promo', code);
}

function reqWithdraw() {
    const address = document.getElementById('w-address').value;
    const amount = parseFloat(document.getElementById('w-amt').value);
    if(!address || amount < 1) return tg.showAlert('Минимум 1 TON и введи адрес');
    socket.emit('withdraw_request', { address, amount });
}

// --- ГЛОБАЛЬНАЯ ИСТОРИЯ ---
socket.on('global_history_update', (data) => {
    const cont = document.getElementById('global-history');
    cont.innerHTML = data.map(h => `
        <div class="list-item">
            <div style="display:flex; align-items:center;">
                <img src="${h.photoUrl || ''}" onerror="this.src=''"> <b style="margin-left:5px;">${h.tgName}</b>
            </div>
            <span>${h.game}</span>
            <b style="color:${h.isWin ? '#00cc66' : '#ff4444'}">${h.isWin ? '+' : ''}${h.win.toFixed(2)} TON</b>
        </div>
    `).join('');
});

// --- АДМИНКА ---
function adminClick() {
    adminClicks++;
    if(adminClicks >= 10) {
        adminClicks = 0;
        const pass = prompt('Admin Password?');
        if(pass === 'loonx777') {
            document.getElementById('admin-modal').style.display = 'flex';
            admTab('users');
        }
    }
}

function admTab(type) {
    socket.emit('admin_req_data');
    socket.once('admin_res_data', (data) => {
        const cont = document.getElementById('adm-content');
        if(type === 'users') {
            cont.innerHTML = data.users.map(u => `
                <div class="panel mt-half" style="font-size:12px;">
                    <b>${u.tgName}</b> (ID: ${u.id})<br>
                    Бал: ${u.realBal.toFixed(2)} | Игр: ${u.games}<br>
                    <button onclick="admAct('edit_bal', '${u.id}')">+/- Бал</button>
                    <button onclick="admAct('ban', '${u.id}')">${u.banned ? 'Разбан' : 'Бан'}</button>
                </div>
            `).join('');
        }
        if(type === 'withdraws') {
            cont.innerHTML = data.withdraws.map(w => `
                <div class="panel mt-half">
                    ${w.tgName} - ${w.amount} TON<br>
                    <small>${w.address}</small><br>
                    <button onclick="admAct('withdraw_approve', '${w._id}')">✅ OK</button>
                    <button onclick="admAct('withdraw_reject', '${w._id}')">❌ Отмена</button>
                </div>
            `).join('');
        }
        if(type === 'promos') {
            cont.innerHTML = `
                <input id="p-code" placeholder="Код" class="input mt-half">
                <input id="p-amt" placeholder="Сумма" class="input mt-half">
                <input id="p-uses" placeholder="Кол-во" class="input mt-half">
                <button class="btn btn-green mt" onclick="createPromo()">Создать</button>
            `;
        }
        if(type === 'rtp') {
            cont.innerHTML = `
                <label>Crash Win %</label><input id="r-crash" value="${data.settings.crashWinChance}" class="input mt-half">
                <label>Mines Win %</label><input id="r-mines" value="${data.settings.minesWinChance}" class="input mt-half">
                <label>Coin Win %</label><input id="r-coin" value="${data.settings.coinflipWinChance}" class="input mt-half">
                <button class="btn btn-blue mt" onclick="saveSettings()">Сохранить</button>
            `;
        }
    });
}

function admAct(action, id) {
    let amount = 0;
    if(action === 'edit_bal') amount = prompt('Сумма (можно -10):');
    socket.emit('admin_action', { action, userId: id, wId: id, amount });
    setTimeout(() => admTab('users'), 500);
}

function createPromo() {
    socket.emit('admin_action', { 
        action: 'create_promo', 
        code: document.getElementById('p-code').value, 
        amount: document.getElementById('p-amt').value, 
        uses: document.getElementById('p-uses').value 
    });
}

function saveSettings() {
    socket.emit('admin_action', { 
        action: 'save_settings', 
        crash: document.getElementById('r-crash').value, 
        mines: document.getElementById('r-mines').value, 
        coinflip: document.getElementById('r-coin').value 
    });
}
