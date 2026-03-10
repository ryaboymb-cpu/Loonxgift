// ЗАГРУЗКА
window.onload = () => {
    setTimeout(() => {
        document.getElementById('loading-screen').style.opacity = '0';
        setTimeout(() => document.getElementById('loading-screen').style.display = 'none', 500);
    }, 1000);
};

// ЗВУКИ (Web Audio API)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    if(type === 'click') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    } else if(type === 'boom') {
        osc.type = 'square'; osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(); osc.stop(audioCtx.currentTime + 0.5);
    } else if(type === 'win') {
        osc.type = 'triangle'; osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
        osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    }
}
document.body.addEventListener('click', () => { if(audioCtx.state === 'suspended') audioCtx.resume(); });

// ИНИЦИАЛИЗАЦИЯ TG И TON
const tg = window.Telegram.WebApp;
const socket = io();
tg.expand();

const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-btn-container'
});
tonConnectUI.onStatusChange(w => { if(w) socket.emit('set_wallet', w.account.address); });

let tgUser = tg.initDataUnsafe?.user;
let username = tgUser?.first_name || "Player";
let userId = tgUser?.id || "Unknown";
let avatarUrl = tgUser?.photo_url || "../assets/images/duck_logo.png";

document.getElementById('prof-user').innerText = username;
document.getElementById('tg-avatar').src = avatarUrl;
document.getElementById('prof-avatar').src = avatarUrl;
socket.emit('init_user', { username: username, id: userId });

let currentMode = 'demo'; 
let inCrash = false; let inMines = false; let lastAdminData = null;

for(let i=0; i<50; i++) {
    let s = document.createElement('div'); s.className = 'star';
    s.style.width = s.style.height = Math.random()*2.5+'px';
    s.style.left = Math.random()*100+'%'; s.style.top = Math.random()*100+'%';
    s.style.animationDuration = (Math.random()*3+1.5)+'s';
    document.getElementById('stars-container').appendChild(s);
}

function switchTab(id, el) {
    playSound('click');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active'); tg.HapticFeedback.selectionChanged();
}

function openGame(id) { playSound('click'); document.getElementById('screen-' + id).style.display = 'block'; if(id === 'mines') drawMines(false); }
function closeGame() { playSound('click'); document.querySelectorAll('.game-fullscreen').forEach(el => el.style.display = 'none'); }

function toggleMode() {
    playSound('click');
    currentMode = currentMode === 'demo' ? 'real' : 'demo';
    let text = currentMode === 'demo' ? 'DEMO' : 'REAL';
    let color = currentMode === 'demo' ? 'var(--blue)' : 'var(--green)';
    
    document.getElementById('header-mode').innerText = text; document.getElementById('header-mode').style.color = color;
    document.querySelectorAll('.in-game-mode').forEach(el => { el.innerText = text; el.style.color = color; });
    document.getElementById('wallet-cur').innerText = text + ' TON';
    
    updateBalanceUI(); tg.HapticFeedback.impactOccurred('light');
}

let localUser = { realBal: 0, demoBal: 0, games: 0, wins: 0 };
socket.on('user_data', (data) => { localUser = data; updateBalanceUI(); });
socket.on('alert', (msg) => { tg.showAlert(msg); });

function updateBalanceUI() {
    let bal = currentMode === 'demo' ? localUser.demoBal : localUser.realBal;
    document.getElementById('header-bal').innerText = bal.toFixed(2);
    document.querySelectorAll('.in-game-bal').forEach(el => el.innerText = bal.toFixed(2));
    document.getElementById('wallet-bal').innerText = bal.toFixed(2);
    document.getElementById('stat-games').innerText = localUser.games;
    document.getElementById('stat-wins').innerText = localUser.wins;
}

function sendPromo() { playSound('click'); socket.emit('activate_promo', document.getElementById('promo-input').value); }

function requestWithdraw() {
    playSound('click');
    let wallet = document.getElementById('withdraw-wallet').value;
    let amount = document.getElementById('withdraw-amount').value;
    if(!wallet || wallet.length < 10) return tg.showAlert("Введите корректный TON кошелек!");
    if(amount && !isNaN(amount)) socket.emit('request_withdraw', { amount: amount, wallet: wallet });
}

socket.on('bet_error', (msg) => { tg.showAlert(msg); tg.HapticFeedback.notificationOccurred('error'); inCrash = false; inMines = false; playSound('boom'); });
socket.on('bet_success', () => { playSound('click'); });

// CRASH
socket.on('crash_update', (d) => {
    let btn = document.getElementById('crash-btn');
    document.getElementById('crash-mult').innerText = d.mult.toFixed(2) + 'x';
    
    if(d.history) {
        document.getElementById('crash-history').innerHTML = d.history.map(m => `<div class="history-item" style="color:${m >= 2 ? 'var(--green)' : 'var(--red)'}">${m}x</div>`).join('');
    }

    let bHtml = '';
    d.liveBets.forEach(b => {
        let status = b.cashed ? `<b style="color:var(--green)">ВЫВЕЛ</b>` : `<b style="color:var(--blue)">В ИГРЕ</b>`;
        let modeIcon = b.mode === 'real' ? '💎' : '🪙';
        bHtml += `<div class="bet-row"><span>${modeIcon} ${b.name}</span><span>${b.bet.toFixed(2)} TON</span><span>${status}</span></div>`;
    });
    document.getElementById('bets-list').innerHTML = bHtml || '<div style="text-align:center; color:#555">Нет ставок</div>';

    if (d.status === 'waiting') {
        document.getElementById('rocket').style.bottom = '10px';
        document.getElementById('crash-timer').innerText = `Запуск через ${d.timer}...`;
        if(!inCrash) { btn.innerText = "СТАВКА"; btn.style.background = "linear-gradient(90deg, #00d2ff 0%, #3a7bd5 100%)"; }
    } else if (d.status === 'flying') {
        document.getElementById('crash-timer').innerText = '';
        document.getElementById('rocket').style.bottom = (10 + d.mult*3) + 'px';
        if(inCrash) { btn.innerText = "ЗАБРАТЬ"; btn.style.background = "var(--green)"; }
    } else {
        document.getElementById('crash-mult').style.color = "var(--red)";
        if(d.mult === d.history[0]) playSound('boom');
        setTimeout(() => document.getElementById('crash-mult').style.color = "white", 2000);
        inCrash = false; btn.innerText = "СТАВКА"; btn.style.background = "linear-gradient(90deg, #00d2ff 0%, #3a7bd5 100%)";
    }
});

function crashAction() {
    playSound('click');
    if(!inCrash) {
        let bet = document.getElementById('crash-bet').value; let auto = document.getElementById('crash-auto').value;
        if(bet >= 0.5 && bet <= 20) { inCrash = true; socket.emit('crash_bet', { bet: bet, auto: auto, mode: currentMode }); } 
        else { tg.showAlert("Ставка от 0.5 до 20!"); }
    } else { socket.emit('crash_cashout'); }
}
socket.on('crash_win', (d) => { inCrash = false; playSound('win'); tg.HapticFeedback.notificationOccurred('success'); });

// MINES
function drawMines(active) {
    let grid = document.getElementById('mines-grid');
    grid.innerHTML = ''; grid.className = active ? 'active' : '';
    for(let i=0; i<25; i++) {
        let cell = document.createElement('div'); cell.className = 'mine-cell';
        if(active) cell.onclick = () => { playSound('click'); socket.emit('mines_open', i); }
        grid.appendChild(cell);
    }
}
function minesAction() {
    playSound('click');
    if(!inMines) {
        let bet = document.getElementById('mines-bet').value;
        if(bet >= 0.5 && bet <= 20) { inMines = true; socket.emit('mines_start', { bet: bet, mode: currentMode }); }
        else { tg.showAlert("Ставка от 0.5 до 20!"); }
    } else { socket.emit('mines_cashout'); }
}
socket.on('mines_ready', () => { drawMines(true); document.getElementById('mines-status').innerText = "ИЩИ АЛМАЗЫ"; document.getElementById('mines-btn').innerText = "ЗАБРАТЬ"; document.getElementById('mines-status').style.color = "var(--blue)"; });
socket.on('mines_safe', (d) => {
    playSound('click'); let cell = document.getElementById('mines-grid').children[d.idx];
    cell.innerHTML = "💎"; cell.style.background = "rgba(0,255,136,0.2)"; cell.style.border = "1px solid var(--green)"; cell.style.boxShadow = "0 0 15px var(--green)"; cell.onclick = null;
    document.getElementById('mines-status').innerText = `X: ${d.mult}`; tg.HapticFeedback.impactOccurred('light');
});
socket.on('mines_boom', (f) => {
    playSound('boom'); inMines = false; let grid = document.getElementById('mines-grid'); grid.className = '';
    f.forEach((v, i) => { grid.children[i].innerHTML = v === 'mine' ? "💣" : "💎"; if(v==='mine') { grid.children[i].style.background = "rgba(255,51,102,0.3)"; grid.children[i].style.boxShadow = "0 0 15px var(--red)"; } });
    document.getElementById('mines-status').innerText = "ПОДРЫВ!"; document.getElementById('mines-status').style.color = "var(--red)"; document.getElementById('mines-btn').innerText = "СТАВКА"; tg.HapticFeedback.notificationOccurred('error');
});
socket.on('mines_win', (d) => {
    playSound('win'); inMines = false; document.getElementById('mines-status').innerText = `ВЫИГРАЛ ${d.win.toFixed(2)}`; document.getElementById('mines-status').style.color = "var(--green)";
    document.getElementById('mines-btn').innerText = "СТАВКА"; drawMines(false); tg.HapticFeedback.notificationOccurred('success');
});

// ADMIN
let tapCount = 0; let tapTimer = null;
document.getElementById('admin-trigger').addEventListener('click', () => {
    tapCount++; clearTimeout(tapTimer); tapTimer = setTimeout(() => tapCount = 0, 2000);
    if(tapCount >= 10) { tapCount = 0; let pw = prompt("Admin Password:"); if(pw) socket.emit('admin_login', pw); }
});

window.closeAdmin = function() { document.getElementById('admin-modal').style.display = 'none'; };

socket.on('admin_data', (d) => {
    lastAdminData = d;
    document.getElementById('admin-modal').style.display = 'flex';
    
    let uHtml = d.users.map(u => 
        `<div class="admin-card" onclick="showAdminUser('${u.id}')">
            <b>ID:</b> ${u.id} | <b>TG:</b> ${u.tgName} <br>
            <b>Реал:</b> ${u.realBal.toFixed(2)} | <b>Демо:</b> ${u.demoBal.toFixed(2)}
        </div>`
    ).join('');
    document.getElementById('admin-users').innerHTML = uHtml || 'Пусто';

    let wHtml = d.withdraws.map(w => 
        `<div class="admin-card">
            <b>От:</b> ${w.name} (ID: ${w.id}) <br>
            <b>Сумма:</b> ${w.amount} TON <br>
            <b>Кош:</b> <input type="text" value="${w.wallet}" readonly style="width:100%; font-size:9px; background:#000; color:var(--blue); border:none; padding:5px; margin-top:5px;">
            <div style="display:flex; gap:5px; margin-top:5px;">
                <button class="btn-primary" style="background:var(--green); padding:5px; font-size:10px;" onclick="adminActionWithdraw('${w.reqId}', 'approve')">ОДОБРИТЬ</button>
                <button class="btn-primary" style="background:var(--red); padding:5px; font-size:10px;" onclick="adminActionWithdraw('${w.reqId}', 'reject')">ОТКЛОНИТЬ</button>
            </div>
        </div>`
    ).join('');
    document.getElementById('admin-withdraws').innerHTML = wHtml || '<div style="color:#aaa; font-size:12px;">Нет заявок</div>';
});

window.showAdminUser = function(id) {
    let u = lastAdminData.users.find(x => x.id === id);
    if(u) alert(`Игрок: ${u.tgName}\nID: ${u.id}\nРеал TON: ${u.realBal.toFixed(2)}\nДемо TON: ${u.demoBal.toFixed(2)}\nВсего игр: ${u.games}\nПобед: ${u.wins}`);
};

window.createPromo = function() {
    let code = document.getElementById('admin-promo-code').value; 
    let sum = document.getElementById('admin-promo-sum').value;
    let uses = document.getElementById('admin-promo-uses').value;
    if(code && sum && uses) socket.emit('admin_create_promo', { pw: '7788', code: code, amount: sum, uses: uses });
};
window.adminActionWithdraw = function(reqId, action) { socket.emit('admin_action_withdraw', { pw: '7788', reqId: reqId, action: action }); };

// ДЕПОЗИТ (TON CONNECT)
window.makeDeposit = async function() {
    playSound('click');
    let amount = document.getElementById('deposit-amount').value;
    if (!amount || amount < 0.5) return tg.showAlert("Минимальный депозит 0.5 TON");
    
    if (!tonConnectUI.connected) return tg.showAlert("Сначала подключите кошелек!");

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300, 
        messages: [
            {
                address: "UQCTqV9scQaZR0DHzOnMrOCCY7z3MIT0QfoNrtUDZiXHY1-K", // <--- БРО, ВСТАВЬ СЮДА СВОЙ TON КОШЕЛЕК!!!
                amount: (amount * 1000000000).toString(), 
            }
        ]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        tg.showAlert("✅ Транзакция отправлена! Ждем подтверждения сети.");
    } catch (e) {
        tg.showAlert("❌ Оплата отменена или произошла ошибка.");
    }
           }
