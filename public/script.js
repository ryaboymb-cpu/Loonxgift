let tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Инициализация Canvas "Падающие Звезды"
const canvas = document.getElementById('stars-bg');
const ctx = canvas.getContext('2d');
let stars = [];
function initStars() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = [];
    for (let i = 0; i < 100; i++) {
        stars.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2,
            speedY: Math.random() * 0.5 + 0.1,
            alpha: Math.random()
        });
    }
}
function drawStars() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    for (let s of stars) {
        ctx.globalAlpha = s.alpha;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        s.y += s.speedY;
        if (s.y > canvas.height) { s.y = 0; s.x = Math.random() * canvas.width; }
    }
    requestAnimationFrame(drawStars);
}
initStars();
drawStars();
window.addEventListener('resize', initStars);


const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-button'
});

const API_URL = ''; 
const socket = io();

let USER_ID = tg.initDataUnsafe?.user?.id || Math.floor(Math.random() * 100000);
let USER_NAME = tg.initDataUnsafe?.user?.first_name || 'TestUser';
let USER_PHOTO = tg.initDataUnsafe?.user?.photo_url || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
let REF_ID = tg.initDataUnsafe?.start_param || null;

let IS_DEMO = false;
let BALANCE_REAL = 0;
let BALANCE_DEMO = 5000;
let ADMIN_WALLET = '';

function showToast(msg) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast'; t.innerText = msg;
    c.appendChild(t);
    tg.HapticFeedback.notificationOccurred('warning');
    setTimeout(() => { t.style.animation = 'slideDown 0.3s reverse forwards'; setTimeout(() => t.remove(), 300); }, 3000);
}

function updateBalanceUI() {
    const bal = IS_DEMO ? BALANCE_DEMO : BALANCE_REAL;
    document.getElementById('user-balance').innerText = bal.toFixed(2);
    document.getElementById('mode-badge').innerText = IS_DEMO ? 'DEMO' : 'REAL';
    document.getElementById('mode-badge').style.borderColor = IS_DEMO ? 'var(--neon)' : 'var(--neon-red)';
    document.getElementById('mode-badge').style.color = IS_DEMO ? 'var(--neon)' : 'var(--neon-red)';
}

function toggleMode(e) {
    e.stopPropagation();
    IS_DEMO = !IS_DEMO;
    updateBalanceUI();
    showToast(`Включен ${IS_DEMO ? 'DEMO' : 'REAL'} счет`);
}

async function auth() {
    try {
        const res = await fetch(`${API_URL}/api/auth`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: USER_ID, username: USER_NAME, photo_url: USER_PHOTO, refId: REF_ID })
        });
        const data = await res.json();
        if (data.error === "BLOCKED") return document.body.innerHTML = "<h1 style='color:red;text-align:center;margin-top:50px;'>АККАУНТ ЗАБЛОКИРОВАН</h1>";
        
        BALANCE_REAL = data.user.balance;
        BALANCE_DEMO = data.user.demo_balance;
        ADMIN_WALLET = data.adminWallet;

        document.getElementById('user-name').innerText = data.user.username;
        document.getElementById('user-avatar').src = data.user.photo || USER_PHOTO;
        document.getElementById('prof-name').innerText = data.user.username;
        document.getElementById('prof-avatar').src = data.user.photo || USER_PHOTO;
        document.getElementById('prof-id').innerText = data.user.id;
        document.getElementById('ref-link').innerText = `t.me/LoonxGift_bot?start=${data.user.id}`;
        
        document.getElementById('st-bets').innerText = data.user.stats.bets;
        document.getElementById('st-wins').innerText = data.user.stats.wins;
        document.getElementById('st-plus').innerText = data.user.stats.plus.toFixed(2);
        document.getElementById('st-minus').innerText = data.user.stats.minus.toFixed(2);
        document.getElementById('st-ref-earn').innerText = data.user.referralEarnings ? data.user.referralEarnings.toFixed(2) : "0.00";

        document.getElementById('dep-wallet').innerText = ADMIN_WALLET;
        document.getElementById('dep-memo').innerText = String(data.user.id);

        if (['881223945', '7729215091'].includes(String(USER_ID))) {
            document.getElementById('admin-btn').style.display = 'flex';
        }

        updateBalanceUI();
        document.getElementById('loader').style.opacity = '0';
        setTimeout(() => document.getElementById('loader').style.display = 'none', 500);
    } catch (e) { showToast("Ошибка авторизации"); }
}

auth();

function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${pageId}`).classList.add('active');
    
    if (pageId === 'games' || pageId === 'wallet' || pageId === 'profile') {
        document.getElementById(`nav-${pageId}`).classList.add('active');
    }
    window.scrollTo(0,0);
}

function switchWalletTab(tabId) {
    document.querySelectorAll('.w-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('tab-deposit').style.display = tabId === 'deposit' ? 'block' : 'none';
    document.getElementById('tab-withdraw').style.display = tabId === 'withdraw' ? 'block' : 'none';
}

function copyText(id) {
    const text = document.getElementById(id).innerText;
    navigator.clipboard.writeText(text);
    showToast("Скопировано!");
}

function setBet(inputId, amount) { document.getElementById(inputId).value = amount; }
function multiplyBet(inputId, mult) {
    const val = parseFloat(document.getElementById(inputId).value) || 0;
    document.getElementById(inputId).value = (val * mult).toFixed(2);
}

function checkBalance(bet) {
    const bal = IS_DEMO ? BALANCE_DEMO : BALANCE_REAL;
    if (isNaN(bet) || bet <= 0) { showToast("Неверная сумма"); return false; }
    if (bet > bal) { showToast("Недостаточно средств"); return false; }
    return true;
}

function showFloatingWin(amount) {
    const el = document.createElement('div');
    el.className = 'floating-win';
    el.innerHTML = `+${amount.toFixed(2)} <i class="ton-icon"></i>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// --- ИГРА: CRASH ---
let crashActive = false;
let myCrashBet = 0;

function openCrash() { switchPage('crash'); }

socket.on('crashData', (data) => {
    const el = document.getElementById('cr-x');
    const st = document.getElementById('cr-status');
    const btn = document.getElementById('btn-cr-action');

    if (data.status === 'waiting') {
        st.innerText = `СЛЕДУЮЩИЙ РАУНД ЧЕРЕЗ ${data.timer}С`;
        st.style.color = 'var(--sub)';
        el.innerText = '1.00x'; el.style.color = '#fff'; el.style.textShadow = 'none';
        if(!crashActive) { btn.innerText = 'ПОСТАВИТЬ'; btn.className = 'btn'; }
    } else if (data.status === 'running') {
        st.innerText = 'В ПОЛЕТЕ'; st.style.color = 'var(--neon)';
        el.innerText = `${data.multiplier}x`; el.style.color = '#fff';
        if(crashActive) { btn.innerText = `ЗАБРАТЬ ${(myCrashBet * parseFloat(data.multiplier)).toFixed(2)}`; btn.className = 'btn btn-connect'; }
    } else if (data.status === 'crashed') {
        st.innerText = 'КРАШ!'; st.style.color = 'var(--neon-red)';
        el.innerText = `${data.multiplier}x`; el.style.color = 'var(--neon-red)';
        el.style.textShadow = '0 0 20px rgba(255,0,85,0.8)';
        crashActive = false; btn.innerText = 'ПОСТАВИТЬ'; btn.className = 'btn';
    }
});

socket.on('crashHistoryUpdate', (hist) => {
    const c = document.getElementById('cr-history');
    c.innerHTML = '';
    hist.forEach(m => {
        const val = parseFloat(m);
        const col = val < 1.5 ? 'var(--neon-red)' : (val < 3 ? 'var(--neon-blue)' : 'var(--neon)');
        c.innerHTML += `<div class="cr-badge" style="color:${col}; border: 1px solid ${col};">${val}x</div>`;
    });
});

socket.on('crashBetsUpdate', (bets) => {
    const c = document.getElementById('cr-live-bets');
    c.innerHTML = bets.map(b => `
        <div class="live-bet-item">
            <div class="live-user"><img src="${b.avatar}" class="live-ava"> ${b.username} ${b.mode==='demo'?'<span style="font-size:8px;color:#888;">(DEMO)</span>':''}</div>
            <div style="font-weight:bold;">
                ${b.cashedOut ? `<span style="color:var(--neon);">+${b.win.toFixed(2)} <i class="ton-icon"></i></span>` : `<span>${b.bet} <i class="ton-icon"></i></span>`}
            </div>
        </div>
    `).join('');
});

async function actionCrash() {
    const btn = document.getElementById('btn-cr-action');
    if (!crashActive && btn.innerText === 'ПОСТАВИТЬ') {
        const bet = parseFloat(document.getElementById('cr-bet').value);
        if(!checkBalance(bet)) return;
        
        tg.HapticFeedback.impactOccurred('medium');
        const res = await fetch(`${API_URL}/api/bet`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: USER_ID, game: 'Crash', bet, win: 0, mode: IS_DEMO ? 'demo' : 'real'}) });
        if(res.ok) {
            const data = await res.json();
            if(IS_DEMO) BALANCE_DEMO = data.demo_balance; else BALANCE_REAL = data.balance;
            updateBalanceUI();
            myCrashBet = bet; crashActive = true;
            btn.innerText = 'В ИГРЕ...'; btn.className = 'btn';
        } else { showToast("Ошибка ставки (Ожидайте или Макс 2 ставки)"); }

    } else if (crashActive && btn.innerText.includes('ЗАБРАТЬ')) {
        const currentX = parseFloat(document.getElementById('cr-x').innerText);
        const win = Number((myCrashBet * currentX).toFixed(2));
        tg.HapticFeedback.notificationOccurred('success');
        
        const res = await fetch(`${API_URL}/api/bet`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: USER_ID, game: 'Crash', bet: myCrashBet, win, mode: IS_DEMO ? 'demo' : 'real'}) });
        if(res.ok) {
            const data = await res.json();
            if(IS_DEMO) BALANCE_DEMO = data.demo_balance; else BALANCE_REAL = data.balance;
            updateBalanceUI();
            crashActive = false; btn.innerText = 'ПОСТАВИТЬ'; btn.className = 'btn';
            showFloatingWin(win);
        }
    }
}

// --- ИГРА: MINES ---
let miActive = false;
let miGrid = [];
let miBet = 0;
let miCount = 3;
let miClicks = 0;

function openMines() { switchPage('mines'); renderMinesGrid(); }

function getMinesMultiplier(mines, clicks) {
    const kx = {
        3: [1.1, 1.25, 1.45, 1.7, 2.0, 2.4, 2.9, 3.5, 4.3, 5.3, 6.7, 8.6, 11.5, 15.8, 22.9],
        5: [1.2, 1.5, 1.9, 2.4, 3.2, 4.3, 5.9, 8.4, 12.3, 18.9, 30.8, 54.0, 102.5, 222.1, 592.4],
        10: [1.6, 2.8, 5.4, 11.2, 25.1, 62.9, 179.6, 598.8, 2395.0, 11976.0, 83835.0, 922187.0],
        24: [24.0]
    };
    return kx[mines][clicks - 1] || 1.0;
}

function renderMinesGrid() {
    const g = document.getElementById('mi-grid');
    g.innerHTML = '';
    for(let i=0; i<25; i++) {
        const c = document.createElement('div');
        c.className = 'm-cell'; c.dataset.id = i;
        c.onclick = () => clickMine(i, c);
        g.appendChild(c);
    }
}

async function actionMines() {
    const btn = document.getElementById('btn-mi-action');
    if (!miActive) {
        const bet = parseFloat(document.getElementById('mi-bet').value);
        if(!checkBalance(bet)) return;
        
        miBet = bet; miCount = parseInt(document.getElementById('mi-count').value); miClicks = 0;
        
        const res = await fetch(`${API_URL}/api/bet`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: USER_ID, game: 'Mines', bet, win: 0, mode: IS_DEMO ? 'demo' : 'real'}) });
        if(!res.ok) return showToast("Ошибка");
        const data = await res.json();
        if(IS_DEMO) BALANCE_DEMO = data.demo_balance; else BALANCE_REAL = data.balance;
        updateBalanceUI();

        miGrid = Array(25).fill('safe');
        let m = 0;
        while(m < miCount) { const r = Math.floor(Math.random()*25); if(miGrid[r]!=='mine') { miGrid[r]='mine'; m++; } }
        
        miActive = true; renderMinesGrid();
        document.getElementById('mi-kx').innerText = '1.00x';
        document.getElementById('mi-count').disabled = true;
        btn.innerText = 'ЗАБРАТЬ'; btn.className = 'btn btn-connect';
        tg.HapticFeedback.impactOccurred('medium');
    } else {
        const win = miClicks > 0 ? Number((miBet * getMinesMultiplier(miCount, miClicks)).toFixed(2)) : 0;
        const res = await fetch(`${API_URL}/api/bet`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: USER_ID, game: 'Mines', bet: 0, win, mode: IS_DEMO ? 'demo' : 'real'}) });
        if(res.ok) {
            const data = await res.json();
            if(IS_DEMO) BALANCE_DEMO = data.demo_balance; else BALANCE_REAL = data.balance;
            updateBalanceUI();
            if(win>0) showFloatingWin(win);
        }
        endMines();
    }
}

function clickMine(id, el) {
    if(!miActive || el.classList.contains('open')) return;
    el.classList.add('open');
    tg.HapticFeedback.impactOccurred('light');

    if(miGrid[id] === 'mine') {
        el.innerHTML = '💣'; el.style.background = 'rgba(255,0,85,0.2)'; el.style.borderColor = 'var(--neon-red)';
        tg.HapticFeedback.notificationOccurred('error');
        endMines(false);
    } else {
        el.innerHTML = '💎'; miClicks++;
        document.getElementById('mi-kx').innerText = `${getMinesMultiplier(miCount, miClicks).toFixed(2)}x`;
        if (miClicks === (25 - miCount)) {
            actionMines(); // Автовывод если все открыто
        }
    }
}

function endMines(won = true) {
    miActive = false;
    document.getElementById('btn-mi-action').innerText = 'ИГРАТЬ';
    document.getElementById('btn-mi-action').className = 'btn';
    document.getElementById('mi-count').disabled = false;
    
    document.querySelectorAll('.m-cell').forEach((c, i) => {
        if (!c.classList.contains('open')) {
            c.innerHTML = miGrid[i] === 'mine' ? '<span style="opacity:0.3">💣</span>' : '<span style="opacity:0.3">💎</span>';
        }
    });
}

// --- ИГРА: COINFLIP ---
let cfSide = 'O';
function openCoinflip() { switchPage('coinflip'); }
function selectCoinSide(side) {
    cfSide = side;
    document.getElementById('c-side-o').className = side === 'O' ? 'c-side active' : 'c-side inactive';
    document.getElementById('c-side-r').className = side === 'R' ? 'c-side active' : 'c-side inactive';
    tg.HapticFeedback.selectionChanged();
}

async function playCoinflip() {
    const bet = parseFloat(document.getElementById('cf-bet').value);
    if(!checkBalance(bet)) return;

    const btn = document.getElementById('btn-cf-action');
    btn.disabled = true; btn.innerText = 'БРОСОК...';
    tg.HapticFeedback.impactOccurred('medium');

    const coin = document.getElementById('cf-coin');
    coin.style.transition = 'none'; coin.style.transform = 'rotateY(0deg)';
    
    setTimeout(async () => {
        const isWin = Math.random() < 0.48; // ~96% RTP
        const resultSide = isWin ? cfSide : (cfSide === 'O' ? 'R' : 'O');
        const win = isWin ? Number((bet * 1.95).toFixed(2)) : 0;

        const res = await fetch(`${API_URL}/api/bet`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: USER_ID, game: 'Coinflip', bet, win, mode: IS_DEMO ? 'demo' : 'real'}) });
        
        if (res.ok) {
            const data = await res.json();
            if(IS_DEMO) BALANCE_DEMO = data.demo_balance; else BALANCE_REAL = data.balance;
            updateBalanceUI();

            coin.style.transition = 'transform 2s cubic-bezier(0.2, 0.8, 0.2, 1)';
            const spins = 5 * 360;
            const extra = resultSide === 'R' ? 180 : 0;
            coin.style.transform = `rotateY(${spins + extra}deg)`;

            setTimeout(() => {
                btn.disabled = false; btn.innerText = 'БРОСИТЬ МОНЕТУ';
                if(isWin) { tg.HapticFeedback.notificationOccurred('success'); showFloatingWin(win); } 
                else { tg.HapticFeedback.notificationOccurred('error'); }
            }, 2100);
        } else {
            btn.disabled = false; btn.innerText = 'БРОСИТЬ МОНЕТУ'; showToast('Ошибка');
        }
    }, 50);
}

// --- БАТЛ РУЛЕТКА ---
function openBattleLobby() { switchPage('battle'); loadBattleLobbies(); }

async function loadBattleLobbies() {
    const res = await fetch(`${API_URL}/api/battle/list`);
    const data = await res.json();
    const c = document.getElementById('battle-lobbies-container');
    c.innerHTML = data.length === 0 ? '<div style="text-align:center; color:var(--sub); padding: 20px;">Нет активных лобби</div>' : '';
    
    data.forEach(l => {
        const isMy = l.creatorId === String(USER_ID);
        const inLobby = l.players.some(p => p.id === String(USER_ID));
        const total = l.players.reduce((s,p)=>s+p.bet, 0);
        
        c.innerHTML += `
            <div class="card" style="margin-bottom: 10px; border-color: var(--neon-blue); padding: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <div><span style="font-weight: 900; font-size: 16px;">Создатель:</span> ${l.players[0].username}</div>
                    <div style="font-weight: 900; color: var(--neon);">${total} <i class="ton-icon"></i></div>
                </div>
                <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                    ${l.players.map(p => `<img src="${p.avatar}" style="width:30px; height:30px; border-radius:50%; border:2px solid ${p.color};">`).join('')}
                    ${Array(4 - l.players.length).fill('<div style="width:30px; height:30px; border-radius:50%; border:2px dashed #444;"></div>').join('')}
                </div>
                ${inLobby ? 
                    `<button class="btn" style="padding: 10px; background: #333; color: #fff;" onclick="openBattleGame('${l._id}')">ОТКРЫТЬ ЛОББИ</button>` :
                    `<div style="display:flex; gap:5px;">
                        <input type="number" id="btl-join-${l._id}" class="input-box" style="margin:0; padding:10px;" placeholder="Ставка">
                        <button class="btn btn-connect" style="margin:0; padding:10px;" onclick="joinBattleLobby('${l._id}')">ВОЙТИ</button>
                    </div>`
                }
            </div>
        `;
    });
}

async function createBattleLobby() {
    if(IS_DEMO) return showToast("Только на REAL счете");
    const bet = parseFloat(document.getElementById('btl-create-bet').value);
    
    const res = await fetch(`${API_URL}/api/battle/create`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: USER_ID, bet}) });
    const data = await res.json();
    if(data.error) return showToast(data.error);
    
    BALANCE_REAL = data.balance; updateBalanceUI(); loadBattleLobbies();
    showToast("Лобби создано!");
}

async function joinBattleLobby(lobbyId) {
    if(IS_DEMO) return showToast("Только на REAL счете");
    const bet = parseFloat(document.getElementById(`btl-join-${lobbyId}`).value);
    
    const res = await fetch(`${API_URL}/api/battle/join`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: USER_ID, lobbyId, bet}) });
    const data = await res.json();
    if(data.error) return showToast(data.error);
    
    BALANCE_REAL = data.user.balance; updateBalanceUI(); 
    openBattleGame(lobbyId);
}

let activeBattleLobbyId = null;

function openBattleGame(lobbyId) {
    activeBattleLobbyId = lobbyId;
    document.getElementById('battle-game-modal').style.display = 'flex';
    updateBattleModalData();
}

function closeBattleModal() {
    document.getElementById('battle-game-modal').style.display = 'none';
    activeBattleLobbyId = null;
    loadBattleLobbies();
}

async function updateBattleModalData() {
    if(!activeBattleLobbyId) return;
    const res = await fetch(`${API_URL}/api/battle/list`);
    const lobbies = await res.json();
    const lobby = lobbies.find(l => l._id === activeBattleLobbyId);
    
    if(!lobby) return closeBattleModal(); // Лобби завершилось или отменено

    const total = lobby.players.reduce((s,p)=>s+p.bet, 0);
    document.getElementById('btl-bank').innerText = total;
    
    const c = document.getElementById('btl-players-list');
    c.innerHTML = lobby.players.map(p => `
        <div style="display:flex; justify-content:space-between; background:#111; padding:10px; border-radius:10px; border-left:4px solid ${p.color};">
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${p.avatar}" style="width:24px; height:24px; border-radius:50%;">
                <span style="font-weight:bold;">${p.username}</span>
            </div>
            <div style="font-weight:900;">${p.bet} <i class="ton-icon"></i> <span style="font-size:10px; color:var(--sub);">(${Math.round(p.bet/total*100)}%)</span></div>
        </div>
    `).join('');

    // Отрисовка колеса (conic-gradient)
    const wheel = document.getElementById('btl-wheel');
    let gradientParts = [];
    let currentDeg = 0;
    lobby.players.forEach(p => {
        const percentage = (p.bet / total) * 100;
        gradientParts.push(`${p.color} ${currentDeg}% ${currentDeg + percentage}%`);
        currentDeg += percentage;
    });
    wheel.style.background = `conic-gradient(${gradientParts.join(', ')})`;

    const st = document.getElementById('btl-status-text');
    if (lobby.players.length === 1) {
        st.innerText = "ОЖИДАНИЕ ИГРОКОВ...";
        document.getElementById('btl-cancel-btn').style.display = (lobby.creatorId === String(USER_ID)) ? 'block' : 'none';
    } else {
        document.getElementById('btl-cancel-btn').style.display = 'none';
        if(lobby.timerStartedAt) {
            const passed = Math.floor((new Date() - new Date(lobby.timerStartedAt)) / 1000);
            const left = 120 - passed;
            if(left > 0) st.innerText = `СТАРТ ЧЕРЕЗ ${left} СЕК (Или при 4 игроках)`;
            else st.innerText = "ЗАПУСК...";
        }
    }
}

async function cancelBattle() {
    if(!activeBattleLobbyId) return;
    const res = await fetch(`${API_URL}/api/battle/cancel`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: USER_ID, lobbyId: activeBattleLobbyId}) });
    const data = await res.json();
    if(data.error) return showToast(data.error);
    BALANCE_REAL = data.balance; updateBalanceUI();
    closeBattleModal(); showToast("Лобби отменено");
}

socket.on('battleUpdate', () => {
    if(document.getElementById('page-battle').classList.contains('active')) loadBattleLobbies();
    if(activeBattleLobbyId) updateBattleModalData();
});

socket.on('battleSpin', ({lobbyId, winnerId}) => {
    if(activeBattleLobbyId === lobbyId) {
        document.getElementById('btl-status-text').innerText = "ВРАЩЕНИЕ...";
        const wheel = document.getElementById('btl-wheel');
        // Случайное вращение от 5 до 10 полных оборотов + рандомный угол
        const spins = (Math.floor(Math.random() * 5) + 5) * 360;
        const extra = Math.floor(Math.random() * 360);
        wheel.style.transform = `rotate(${spins + extra}deg)`;
        
        setTimeout(async () => {
            document.getElementById('btl-status-text').innerText = "ПОБЕДИТЕЛЬ ОПРЕДЕЛЕН!";
            tg.HapticFeedback.notificationOccurred('success');
            // Обновляем баланс после игры
            await auth(); 
            setTimeout(() => closeBattleModal(), 3000);
        }, 5000);
    }
});


// --- КОШЕЛЕК И ФИНАНСЫ ---
async function depositViaTonConnect() {
    const amount = parseFloat(document.getElementById('tc-amount').value);
    if(isNaN(amount) || amount < 0.1) return showToast("Мин 0.1 TON");
    
    if (!tonConnectUI.connected) return showToast("Сначала подключи кошелек TON Connect выше!");

    try {
        const tx = {
            validUntil: Math.floor(Date.now() / 1000) + 360,
            messages: [{
                address: ADMIN_WALLET,
                amount: (amount * 1e9).toString(),
                payload: btoa(String(USER_ID)) // Base64 от ID юзера как MEMO
            }]
        };
        await tonConnectUI.sendTransaction(tx);
        showToast("Транзакция отправлена! Ожидайте зачисления.");
        setTimeout(checkDeposit, 15000); // Авто-проверка через 15 сек
    } catch (e) { showToast("Ошибка оплаты или отмена"); }
}

async function checkDeposit() {
    const btn = document.getElementById('btn-check-dep');
    btn.disabled = true; btn.innerText = 'ПРОВЕРКА...';
    
    const res = await fetch(`${API_URL}/api/check_deposit`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: USER_ID}) });
    const data = await res.json();
    
    btn.disabled = false; btn.innerText = 'Проверить оплату';
    if(data.success) {
        BALANCE_REAL = data.user.balance; updateBalanceUI();
        showToast(`Пополнено на ${data.added} TON!`);
        tg.HapticFeedback.notificationOccurred('success');
    } else {
        showToast(data.error);
    }
}

async function requestWithdraw() {
    const address = document.getElementById('w-address').value;
    const amount = parseFloat(document.getElementById('w-amount').value);
    
    if(!address || isNaN(amount) || amount < 5) return showToast("Мин 5 TON и укажите адрес");
    if(amount > BALANCE_REAL) return showToast("Недостаточно средств");

    const res = await fetch(`${API_URL}/api/withdraw`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: USER_ID, address, amount}) });
    const data = await res.json();
    if(data.error) return showToast(data.error);
    
    BALANCE_REAL = data.balance; updateBalanceUI();
    showToast("Заявка создана!");
    document.getElementById('w-address').value = '';
    document.getElementById('w-amount').value = '';
}

async function activatePromo() {
    const code = document.getElementById('promo-input').value;
    if(!code) return showToast("Введи код");
    const res = await fetch(`${API_URL}/api/promo`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: USER_ID, code}) });
    const data = await res.json();
    if(data.error) return showToast(data.error); // Точная ошибка с бэка
    
    BALANCE_REAL = data.balance; updateBalanceUI();
    showToast("Активировано!"); tg.HapticFeedback.notificationOccurred('success');
    document.getElementById('promo-input').value = '';
}


// --- АДМИН ПАНЕЛЬ ---
function openAdmin() { document.getElementById('admin-modal').style.display = 'flex'; loadAdminData(); }
function closeAdmin() { document.getElementById('admin-modal').style.display = 'none'; }
function switchAdminTab(t) {
    document.querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
    event.target.classList.add('active');
    ['stats', 'users', 'withdraws', 'promo', 'settings'].forEach(id => document.getElementById(`adm-tab-${id}`).style.display = 'none');
    document.getElementById(`adm-tab-${t}`).style.display = 'block';
}

async function adminReq(endpoint, body = {}) {
    body.pass = document.getElementById('admin-pass').value;
    const res = await fetch(`${API_URL}/api/admin/${endpoint}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
    return await res.json();
}

async function loadAdminData() {
    const d = await adminReq('data');
    if(d.error) return showToast(d.error);

    document.getElementById('adm-tot-users').innerText = d.totalUsers;
    document.getElementById('adm-tot-reqs').innerText = d.withdraws.length;
    document.getElementById('adm-deps').innerText = d.totalDeposited.toFixed(2);
    document.getElementById('adm-withs').innerText = d.totalWithdrawn.toFixed(2);

    document.getElementById('adm-deps-list').innerHTML = d.latestDeposits.map(x => `<div><b>${x.amount} TON</b> от ${x.username} (${x.time})</div>`).join('');

    const wc = document.getElementById('adm-withdraws-list');
    wc.innerHTML = d.withdraws.map(w => `
        <div class="card" style="padding:10px;">
            <b>ID:</b> ${w.userId} <br>
            <b>Сумма:</b> ${w.amount} TON <br>
            <b>Адрес:</b> <span style="font-size:10px;word-break:break-all;">${w.address}</span><br>
            <div style="display:flex;gap:5px;margin-top:5px;">
                <button class="btn" style="padding:5px;background:var(--neon);" onclick="adminWithdrawAction('${w._id}','approve')">Одобрить</button>
                <button class="btn" style="padding:5px;background:var(--neon-red);" onclick="adminWithdrawAction('${w._id}','reject')">Отклонить</button>
            </div>
        </div>
    `).join('');

    document.getElementById('adm-promo-list').innerHTML = d.promos.map(p => `
        <div style="display:flex;justify-content:space-between;background:#111;padding:10px;border-radius:10px;">
            <div><b>${p.code}</b> (${p.amount} TON) [${p.usedBy.length}/${p.limit}]</div>
            <button style="background:var(--neon-red);color:#fff;border:none;padding:5px 10px;border-radius:5px;" onclick="adminDelPromo('${p._id}')">X</button>
        </div>
    `).join('');

    // Rtp & Maint
    if(d.rtp) {
        if(d.rtp.crash) document.getElementById('rtp-cr').value = d.rtp.crash;
        if(d.rtp.mines) document.getElementById('rtp-mi').value = d.rtp.mines;
        if(d.rtp.coinflip) document.getElementById('rtp-co').value = d.rtp.coinflip;
    }
    if(d.maintenance) {
        ['crash','mines','coinflip','battle'].forEach(g => {
            const el = document.getElementById(`maint-${g=== 'coinflip' ? 'co' : (g==='battle'?'btl':g.substring(0,2))}`);
            if(el) { el.style.color = d.maintenance[g] ? 'var(--neon-red)' : 'var(--neon)'; el.innerText = d.maintenance[g] ? 'OFF (Ремонт)' : 'ON'; }
        });
    }
}

// Поиск юзеров
async function adminSearchUsers() {
    const query = document.getElementById('adm-search-q').value;
    const filterType = document.getElementById('adm-search-f').value;
    const d = await adminReq('search_user', {query, filterType});
    if(d.error) return;
    
    document.getElementById('adm-users-list').innerHTML = d.users.map(u => `
        <div style="display:flex;justify-content:space-between;align-items:center;background:#1a1a1a;padding:8px;border-radius:8px;margin-bottom:5px;cursor:pointer;border:1px solid #333;" onclick="openAdminUserDetails('${u.id}', 1)">
            <div style="font-size:12px;"><b>${u.username}</b><br><span style="color:var(--sub)">ID: ${u.id}</span></div>
            <div style="font-weight:bold; color:var(--neon);">${u.balance.toFixed(2)} <i class="ton-icon"></i></div>
        </div>
    `).join('');
}

// Детали юзера
let currentAdminUserId = null;
let currentAdminUserPage = 1;

async function openAdminUserDetails(userId, page = 1) {
    currentAdminUserId = userId;
    currentAdminUserPage = page;
    const d = await adminReq('user_details', { userId, page, limit: 10 });
    if(d.error) return showToast("Ошибка загрузки юзера");

    const u = d.user;
    document.getElementById('adm-user-details-card').style.display = 'block';
    
    // Инфо
    document.getElementById('adm-ud-info').innerHTML = `
        <b>Имя:</b> ${u.username} ${u.isBlocked ? '<span style="color:red;">[BANNED]</span>' : ''}<br>
        <b>ID:</b> ${u.id}<br>
        <b>Баланс:</b> ${u.balance.toFixed(2)} TON | <b>DEMO:</b> ${u.demo_balance.toFixed(2)}<br>
        <b>Стата (REAL):</b> Ставок: ${u.stats.bets} | Вин: ${u.stats.wins} | Профит: ${u.stats.plus.toFixed(2)} | Убыток: ${u.stats.minus.toFixed(2)}<br>
        <b style="color:var(--neon-blue);">Заработано с промо:</b> ${u.stats.promo ? u.stats.promo.toFixed(2) : 0} TON<br>
        <b style="color:var(--neon-blue);">С рефералов:</b> ${u.referralEarnings ? u.referralEarnings.toFixed(2) : 0} TON<br>
        <div style="margin-top:10px; display:flex; gap:5px;">
            <button class="btn" style="padding:5px; margin:0;" onclick="adminUserAction('${u.id}', 'ban')">Бан</button>
            <button class="btn" style="padding:5px; margin:0; background:#333; color:#fff;" onclick="adminUserAction('${u.id}', 'unban')">Разбан</button>
        </div>
    `;

    // Таблица ставок
    document.getElementById('adm-ud-page').innerText = `Стр ${d.pagination.currentPage} / ${d.pagination.totalPages || 1}`;
    
    if(d.bets.length === 0) {
        document.getElementById('adm-ud-bets').innerHTML = '<div style="text-align:center; color:gray; padding:10px;">Нет ставок</div>';
    } else {
        document.getElementById('adm-ud-bets').innerHTML = `
            <table style="width:100%; text-align:left; border-collapse: collapse;">
                <tr style="border-bottom:1px solid #333; color:var(--sub);">
                    <th>Время</th><th>Игра</th><th>Ставка</th><th>Рез</th><th>TON</th>
                </tr>
                ${d.bets.map(b => `
                    <tr style="border-bottom:1px solid #222;">
                        <td>${b.timeMsk.split(' ')[1]}</td>
                        <td>${b.game}</td>
                        <td>${b.amount}</td>
                        <td style="color:${b.result > 0 ? 'var(--neon)' : 'var(--neon-red)'}">${b.result > 0 ? '+'+b.result : b.result}</td>
                        <td>${b.balanceAfter ? b.balanceAfter.toFixed(1) : '-'}</td>
                    </tr>
                `).join('')}
            </table>
        `;
    }
}

function closeAdminUserDetails() {
    document.getElementById('adm-user-details-card').style.display = 'none';
    currentAdminUserId = null;
}

function adminChangeUserPage(dir) {
    if(!currentAdminUserId) return;
    let newPage = currentAdminUserPage + dir;
    if(newPage < 1) newPage = 1;
    openAdminUserDetails(currentAdminUserId, newPage);
}

async function adminEditBalance(action) {
    if(!currentAdminUserId) return;
    const amount = parseFloat(document.getElementById('adm-ud-edit-sum').value);
    if(isNaN(amount) || amount <= 0) return showToast("Укажи сумму");
    
    const d = await adminReq('edit_balance', { userId: currentAdminUserId, action, amount });
    if(d.success) {
        showToast("Баланс обновлен");
        document.getElementById('adm-ud-edit-sum').value = '';
        openAdminUserDetails(currentAdminUserId, currentAdminUserPage); // релоад
    }
}

async function adminUserAction(uid, action) {
    await adminReq('user_action', {userId: uid, action});
    showToast("Выполнено");
    openAdminUserDetails(uid, currentAdminUserPage);
}

async function adminWithdrawAction(wId, action) {
    let reason = '';
    if(action === 'reject') reason = prompt("Причина отказа:");
    const d = await adminReq('withdraw_action', {wId, action, reason});
    if(d.success) { showToast("Обработано"); loadAdminData(); }
}

async function adminCreatePromo() {
    const code = document.getElementById('adm-pr-code').value;
    const amount = document.getElementById('adm-pr-amount').value;
    const limit = document.getElementById('adm-pr-limit').value;
    const d = await adminReq('promo_create', {code, amount, limit});
    if(d.success) { showToast("Создано"); loadAdminData(); }
}

async function adminDelPromo(pId) {
    await adminReq('promo_delete', {pId}); loadAdminData();
}

async function adminSetRtp(game, inputId) {
    const value = document.getElementById(inputId).value;
    const d = await adminReq('set_rtp', {game, value});
    if(d.success) showToast("RTP изменен");
}

async function adminToggleMaintenance(game) {
    const el = document.getElementById(`maint-${game=== 'coinflip' ? 'co' : (game==='battle'?'btl':game.substring(0,2))}`);
    const state = !el.innerText.includes('OFF');
    const d = await adminReq('maintenance', {game, state});
    if(d.success) loadAdminData();
}

async function adminResetStats() {
    const d = await adminReq('reset_all_stats');
    if(d.success) showToast("Сброшено");
}

async function adminBroadcast() {
    const text = document.getElementById('adm-bc-text').value;
    const d = await adminReq('broadcast', {text});
    if(d.success) { showToast("Отправлено"); document.getElementById('adm-bc-text').value=''; }
}

async function adminBotBroadcast() {
    const text = document.getElementById('adm-bot-text').value;
    const d = await adminReq('bot_broadcast', {text});
    if(d.success) { showToast("Рассылка начата"); document.getElementById('adm-bot-text').value=''; }
}

socket.on('global_alert', (text) => {
    alert("📢 Сообщение от Администрации:\n\n" + text);
});

// Слушатель тех. работ для закрытия игр
socket.on('maintenanceUpdate', (data) => {
    // В реальном времени может выкидывать из игры, если админ включил
    // Для простоты, здесь просто алерт, если юзер в игре
});
