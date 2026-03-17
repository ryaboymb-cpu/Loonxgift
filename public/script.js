const tg = window.Telegram.WebApp;
const socket = io();
let user = null; 
let mode = 'real';
let adminPass = '';
let globalRtp = 90;
let gameStatuses = { crash: 1, mines: 1, coinflip: 1 };
let isReqPending = false; 
let tonConnectUI = null;

const $ = id => document.getElementById(id);

function showToast(msg) {
    const container = $('toast-container');
    if(!container) return;
    container.innerHTML = ''; 
    const t = document.createElement('div'); 
    t.className = 'toast'; 
    t.innerText = msg;
    container.appendChild(t); 
    setTimeout(() => t.remove(), 3000);
}

function copyText(text) {
    if(!text) return;
    navigator.clipboard.writeText(text).then(() => showToast('Скопировано!'));
}

// ==========================================
// ИНИЦИАЛИЗАЦИЯ И TON CONNECT (ФИКС БАГА 2)
// ==========================================
window.onload = async () => {
    tg.expand();
    
    // Жестко привязываем TonConnect только когда DOM загружен
    try {
        if ($('ton-connect')) {
            tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
                // Если у тебя нет своего манифеста, используем этот стабильный тестовый
                manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
                buttonRootId: 'ton-connect'
            });
            console.log("TON Connect UI Initialized");
        }
    } catch(e) {
        console.error("TonConnect Error:", e);
    }

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(tg.initDataUnsafe.user || {id: "1", first_name: "Dev", username: "DevUser"})
        });
        const data = await res.json();
        user = data.user; 
        globalRtp = data.rtp || 90;
        if (data.statuses) gameStatuses = data.statuses;
        
        $('dep-wallet').innerText = data.adminWallet || 'Не настроен';
        $('dep-memo').innerText = user.id;
        const ava = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        if($('user-ava')) $('user-ava').src = ava; 
        if($('profile-ava')) $('profile-ava').src = ava;
        if($('profile-name')) $('profile-name').innerText = user.username || 'Игрок';
        
        updateUI();
    } catch (err) {
        showToast("Ошибка соединения с сервером");
        user = { id: "1", balance: 0, demo_balance: 0, stats: {bets:0, wins:0, plus:0, minus:0} };
        updateUI();
    } finally {
        if($('loader')) {
            $('loader').style.opacity = '0'; 
            setTimeout(() => $('loader').style.display = 'none', 500);
        }
    }
};

function updateUI() {
    if(!user) return;
    const bal = mode === 'real' ? user.balance : user.demo_balance;
    if($('bal-val')) $('bal-val').innerText = bal.toFixed(2);
    if($('bal-mode')) {
        $('bal-mode').innerText = mode === 'real' ? 'REAL TON' : 'DEMO TON';
        $('bal-mode').style.color = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    }
    if($('p-bets')) $('p-bets').innerText = user.stats.bets; 
    if($('p-wins')) $('p-wins').innerText = user.stats.wins;
    if($('p-plus')) $('p-plus').innerText = user.stats.plus.toFixed(2); 
    if($('p-minus')) $('p-minus').innerText = user.stats.minus.toFixed(2);
}

function toggleMode() { 
    mode = mode === 'real' ? 'demo' : 'real'; 
    updateUI(); 
    showToast(`Включен режим: ${mode}`); 
}

function nav(pageId, el) {
    if (['crash', 'mines', 'coinflip'].includes(pageId) && gameStatuses[pageId] === 0) {
        return showToast('Игра на техническом перерыве!');
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); 
    const targetPage = $('page-'+pageId);
    if(targetPage) targetPage.classList.add('active');
    
    if(el) { 
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); 
        el.classList.add('active'); 
    }
}

// ==========================================
// SOCKETS & FEED
// ==========================================
socket.on('online', c => { if($('online-c')) $('online-c').innerText = c; });
socket.on('notification', msg => { 
    if($('notification-text')) $('notification-text').innerText = msg; 
    if($('notification-modal')) $('notification-modal').style.display = 'flex'; 
});
socket.on('init_feed', feed => { 
    if($('feed-list')) { $('feed-list').innerHTML = ''; feed.forEach(f => renderFeedItem(f)); }
});
socket.on('newLiveBet', b => renderFeedItem(b, true));

function renderFeedItem(b, prepend = false) {
    const list = $('feed-list');
    if(!list) return;
    const d = document.createElement('div'); 
    d.className = 'live-bet-item';
    d.innerHTML = `
        <div class="live-user">
            <img src="${b.avatar}" class="live-ava">
            <span>${b.username} (${b.game})</span>
        </div>
        <span style="color:${b.type==='win'?'var(--neon)':'var(--neon-red)'}">${b.amount}</span>
    `;
    if (prepend) list.prepend(d); else list.appendChild(d);
}

// ==========================================
// ИГРА: CRASH
// ==========================================
let curCrash = {}; let myCrashBets = [];
socket.on('crashHistoryUpdate', h => {
    if($('cr-history')) $('cr-history').innerHTML = h.map(x => `<div class="cr-badge ${x >= 2 ? 'good' : 'bad'}">${x}x</div>`).join('');
});
socket.on('crashData', d => {
    curCrash = d; 
    const btn = $('cr-btn');
    if(!btn) return;
    if(d.status === 'waiting') { 
        if($('cr-x')) $('cr-x').innerText = 'ЖДЕМ'; 
        if($('cr-timer')) $('cr-timer').innerText = `СТАРТ: ${d.timer}с`;
        btn.innerText = myCrashBets.length < 2 ? 'ПОСТАВИТЬ' : 'МАКСИМУМ (2)';
    } else if(d.status === 'running') {
        if($('cr-x')) $('cr-x').innerText = d.multiplier + 'x';
        if(myCrashBets.length > 0) btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0]*d.multiplier).toFixed(2)}`;
    } else {
        if($('cr-x')) $('cr-x').innerText = 'BOOM!'; 
        myCrashBets = []; 
        btn.innerText = 'ПОСТАВИТЬ';
    }
});

async function playCrash() {
    if(isReqPending) return;
    if(curCrash.status === 'waiting' && myCrashBets.length < 2) {
        let b = parseFloat($('cr-bet').value);
        if(isNaN(b) || b < 0.1 || b > (mode==='real'?user.balance:user.demo_balance)) return showToast('Неверная сумма');
        isReqPending = true;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:b, win:0, mode}) });
        isReqPending = false;
        if(r.ok) { user = await r.json(); myCrashBets.push(b); updateUI(); } else showToast('Ошибка ставки');
    } else if(curCrash.status === 'running' && myCrashBets.length > 0) {
        isReqPending = true;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win:myCrashBets[0]*curCrash.multiplier, mode}) });
        isReqPending = false;
        if(r.ok) { user = await r.json(); myCrashBets.shift(); updateUI(); showToast('Успешно забрали!'); }
    }
}

// ==========================================
// ИГРА: MINES
// ==========================================
let miActive = false; let bombs = []; let miBet = 0; let openedCells = 0; let currentMinesWin = 0;
function playMines() {
    if(miActive) {
        reqBet('Mines', 0, currentMinesWin).then(ok => { 
            if(ok) { miActive=false; $('mi-btn').innerText='ИГРАТЬ'; showToast(`Выигрыш: ${currentMinesWin.toFixed(2)}`); } 
        });
        return;
    }
    miBet = parseFloat($('mi-bet').value);
    if(isNaN(miBet) || miBet <= 0) return showToast('Неверная ставка');
    
    reqBet('Mines', miBet, 0).then(ok => {
        if(ok) {
            bombs = []; 
            while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
            miActive = true; openedCells = 0; currentMinesWin = miBet; 
            renderMines();
        }
    });
}

function renderMines() {
    const grid = $('mine-grid');
    if(!grid) return;
    grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); 
        c.className = 'm-cell';
        c.onclick = () => {
            if(!miActive || c.classList.contains('open')) return;
            if(bombs.includes(i)) { 
                c.innerText='💣'; c.classList.add('exploded');
                miActive=false; $('mi-btn').innerText='ИГРАТЬ'; 
                reqBet('Mines', miBet, -1); 
                showToast('Бум! Проигрыш.');
            } else { 
                c.innerText='💎'; c.classList.add('open'); 
                openedCells++; 
                currentMinesWin = miBet * (1 + openedCells*0.2); 
                $('mi-btn').innerText=`ЗАБРАТЬ ${currentMinesWin.toFixed(2)}`; 
            }
        }; 
        grid.appendChild(c);
    }
}

// ==========================================
// ИГРА: COINFLIP
// ==========================================
let cSide = 'L';
function setSide(s) { 
    cSide = s; 
    if($('side-l')) $('side-l').classList.toggle('active', s==='L'); 
    if($('side-x')) $('side-x').classList.toggle('active', s==='X'); 
}
async function playCoin() {
    const bet = parseFloat($('co-bet').value);
    if(isNaN(bet) || bet <= 0) return showToast('Неверная ставка');
    
    const result = Math.random() < (globalRtp/200) ? cSide : (cSide==='L'?'X':'L');
    if($('coin-3d')) $('coin-3d').style.transform = `rotateY(${result==='L'?0:180}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? bet*2 : 0;
        await reqBet('Coinflip', bet, win);
        showToast(win > 0 ? 'Победа!' : 'Проигрыш');
    }, 1000);
}

// ==========================================
// ФИНАНСЫ И ЗАПРОСЫ
// ==========================================
async function checkRealDeposit() {
    showToast('Проверка депозитов...');
    const r = await fetch('/api/check_deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id}) });
    if(r.ok) { 
        const d = await r.json(); user = d.user; updateUI(); showToast(`Зачислено: ${d.added} TON!`); 
    } else {
        showToast('Новых оплат пока нет. Подождите пару минут.');
    }
}

async function withdraw() {
    const a = parseFloat($('with-amount').value);
    const addr = $('with-addr').value;
    if(isNaN(a) || a < 5) return showToast('Минимальная сумма: 5 TON');
    if(!addr || addr.length < 10) return showToast('Неверный адрес');
    
    const r = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, address:addr, amount:a}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Заявка создана успешно'); }
    else showToast('Ошибка при создании заявки');
}

async function reqBet(game, bet, win) {
    isReqPending = true;
    const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode}) });
    isReqPending = false;
    if(r.ok) { user = await r.json(); updateUI(); return true; } 
    showToast('Недостаточно баланса или ошибка');
    return false;
}

// ==========================================
// АДМИН ПАНЕЛЬ
// ==========================================
let aTaps = 0; 
function checkAdmin() { 
    aTaps++; 
    if(aTaps >= 5) { 
        aTaps=0; 
        let p = prompt('Введите пароль администратора:'); 
        if(p) { adminPass = p; loadAdminData(); } 
    } 
}

let adData = null;
async function loadAdminData() {
    const r = await fetch('/api/admin/data', { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({ pass: adminPass }) 
    });
    
    if(r.ok) { 
        adData = await r.json(); 
        if($('admin-modal')) $('admin-modal').style.display='block'; 
        renderAdminContent('users'); 
    } else {
        showToast('Неверный пароль!');
    }
}

function renderAdminContent(tab) {
    const c = $('admin-content');
    if(!c) return;
    
    if(tab==='users') {
        c.innerHTML = `<h3>Пользователи</h3>` + adData.users.map(u => `
            <div class="admin-item" style="border-bottom:1px solid #333; padding:10px 0;">
                <b>${u.username}</b> (ID: ${u.id})<br>
                Баланс: ${u.balance} TON<br>
                <button onclick="editUserBalance('${u.id}', 'add', 10)">+10 TON</button>
                <button onclick="editUserBalance('${u.id}', 'sub', 10)">-10 TON</button>
            </div>`).join('');
    }
    if(tab==='withdraws') {
        c.innerHTML = `<h3>Заявки на вывод</h3>` + adData.withdraws.map(w => `
            <div class="admin-item" style="border-bottom:1px solid #333; padding:10px 0;">
                ID: ${w.userId} | Сумма: <b>${w.amount} TON</b><br>
                Кошелек: <i>${w.address}</i><br>
                <button onclick="alert('В разработке (выведи вручную)')">ОК</button>
            </div>`).join('');
    }
    if(tab==='rtp') {
        c.innerHTML = `
            <h3>Настройка RTP (Отдача)</h3>
            Crash: <input id="rtp-crash" value="${adData.rtp.crash}" style="width:50px; background:#222; color:#fff;">% 
            <button onclick="adminRTP('crash')">Save</button><br><br>
            Mines: <input id="rtp-mines" value="${adData.rtp.mines}" style="width:50px; background:#222; color:#fff;">% 
            <button onclick="adminRTP('mines')">Save</button>
        `;
    }
}

async function adminRTP(game) {
    const v = $(`rtp-${game}`).value;
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value:v}) });
    showToast(`RTP ${game} сохранен: ${v}%`);
}

async function editUserBalance(userId, action, amount) {
    await fetch('/api/admin/edit_balance', { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({pass: adminPass, userId, action, amount}) 
    });
    showToast('Баланс обновлен!');
    loadAdminData(); // Перезагружаем список
}
