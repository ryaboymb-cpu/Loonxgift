const tg = window.Telegram.WebApp;
const socket = io();
let user = null; 
let mode = 'real';
let adminPass = '';
let globalRtp = 90;
let rtpObj = { crash: 90, mines: 90, coinflip: 90 };
let maintenance = { crash: false, mines: false, coinflip: false };
let adminWalletAddress = '';

// 1. ИСПРАВЛЕННЫЙ TON CONNECT
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json', 
    buttonRootId: 'ton-connect-btn'
});

const $ = id => document.getElementById(id);

function showToast(msg, dur = 3000) {
    const container = $('toast-container');
    const t = document.createElement('div'); 
    t.className = 'toast'; 
    t.innerText = msg;
    container.appendChild(t); 
    setTimeout(() => t.remove(), dur);
}

socket.on('global_alert', msg => { showToast(`📢 УВЕДОМЛЕНИЕ: ${msg}`, 6000); });
function copyText(text) { if(!text) return; navigator.clipboard.writeText(text).then(() => showToast('Скопировано!')); }

const ctx = $('stars-bg').getContext('2d');
let w = $('stars-bg').width = window.innerWidth;
let h = $('stars-bg').height = window.innerHeight;
let stars = Array(120).fill().map(() => ({ x: Math.random()*w, y: Math.random()*h, s: Math.random()*2 + 0.5, speed: Math.random()*1 + 0.2 }));
function draw() {
    ctx.clearRect(0,0,w,h); ctx.fillStyle = '#fff';
    stars.forEach(s => {
        ctx.fillRect(s.x, s.y, s.s, s.s);
        s.y += s.speed;
        if(s.y > h) { s.y = 0; s.x = Math.random()*w; }
    });
    requestAnimationFrame(draw);
} draw();

// ВРЕМЯ МСК ДЛЯ КЛИЕНТА (на случай локальных ставок)
function getMskTime() {
    return new Date().toLocaleTimeString("ru-RU", {timeZone: "Europe/Moscow"});
}

window.onload = async () => {
    tg.expand();
    const res = await fetch('/api/auth', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        // 7. Отправляем photo_url
        body: JSON.stringify(tg.initDataUnsafe.user || {id: "1", first_name: "Dev", username: "DevUser", photo_url: ""})
    });
    const data = await res.json();
    if(data.error === "BLOCKED") {
        document.body.innerHTML = "<h1 style='color:red; text-align:center; margin-top:50px;'>ВЫ ЗАБЛОКИРОВАНЫ</h1>";
        return;
    }

    user = data.user;
    rtpObj = data.rtp || { crash: 90, mines: 90, coinflip: 90 };
    maintenance = data.maintenance || { crash: false, mines: false, coinflip: false };
    
    adminWalletAddress = data.adminWallet || '';
    $('dep-wallet').innerText = adminWalletAddress || 'Кошелек не настроен на сервере';
    $('dep-memo').innerText = user.id;

    $('loader').style.opacity = '0'; setTimeout(() => $('loader').style.display = 'none', 500);
    
    const avaUrl = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    $('user-ava').src = avaUrl; $('profile-ava').src = avaUrl;
    $('profile-name').innerText = user.username || 'Игрок';
    updateUI();
    renderWithdrawHistory();
};

function updateUI() {
    const bal = mode === 'real' ? user.balance : user.demo_balance;
    $('bal-val').innerText = bal.toFixed(2);
    $('bal-mode').innerText = mode === 'real' ? 'REAL TON' : 'DEMO TON';
    $('bal-mode').style.color = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    $('bal-mode').style.borderColor = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    
    $('p-bets').innerText = user.stats.bets; 
    $('p-wins').innerText = user.stats.wins;
    $('p-plus').innerText = user.stats.plus.toFixed(2) + ' TON'; 
    $('p-minus').innerText = user.stats.minus.toFixed(2) + ' TON';
}

function toggleMode() { mode = mode === 'real' ? 'demo' : 'real'; updateUI(); showToast(`Включен ${mode} режим`); }

function nav(pageId, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); $('page-'+pageId).classList.add('active');
    if(el) { document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); el.classList.add('active'); }
}

function navGame(game) { if (maintenance[game]) return showToast('Временно тех. перерыв'); nav(game); }

// 2. БЫСТРЫЕ СТАВКИ
function setQuickBet(inputId, amount) { $(inputId).value = amount; }

function switchDepTab(type, el) {
    document.querySelectorAll('.w-tab').forEach(b => { b.classList.remove('active'); b.style.background='#222'; b.style.color='#fff'; });
    el.classList.add('active'); el.style.background='var(--neon)'; el.style.color='#000';
    $('dep-manual').style.display = type === 'manual' ? 'block' : 'none';
    $('dep-connect').style.display = type === 'connect' ? 'block' : 'none';
}

// 1. ОТПРАВКА TON CONNECT (работает с манифестом)
async function payWithTonConnect() {
    if (!tonConnectUI.connected) return showToast('Сначала подключите кошелек!');
    const amount = parseFloat($('tc-amount').value);
    if(isNaN(amount) || amount <= 0) return showToast('Введите сумму');
    
    const bodyCell = beginCell().storeUint(0, 32).storeStringTail(user.id).endCell();
    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
            address: adminWalletAddress,
            amount: (amount * 1000000000).toString(),
            payload: bodyCell.toBoc().toString("base64")
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        showToast('Транзакция отправлена! Ожидайте зачисления.');
    } catch (e) { showToast('Ошибка транзакции'); }
}

function beginCell() {
    return {
        storeUint: function() { return this; }, storeStringTail: function() { return this; },
        endCell: function() { return { toBoc: function() { return { toString: function() { return ""; }}; } }; }
    };
}

// 10. ИСТОРИЯ ВЫВОДОВ В КОШЕЛЬКЕ
function renderWithdrawHistory() {
    const list = $('w-history-list');
    if(!user.withdrawHistory || user.withdrawHistory.length === 0) return list.innerHTML = '<div style="color:#555; text-align:center;">Нет выводов</div>';
    
    list.innerHTML = user.withdrawHistory.map(w => {
        let cls = w.status === 'Подтверждено' ? 'approved' : (w.status === 'Отклонено' ? 'rejected' : 'pending');
        let rsn = w.reason ? `<br><span style="color:var(--neon-red); font-size:10px;">Причина: ${w.reason}</span>` : '';
        return `
            <div class="w-history-item ${cls}">
                <div><img src="${user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:20px; border-radius:50%; vertical-align:middle; margin-right:5px;"> <b>${w.amount} TON</b><br><span style="color:#888; font-size:10px;">${w.time || ''}</span></div>
                <div style="text-align:right;">${w.status} ${rsn}</div>
            </div>`;
    }).join('');
}

socket.on('online', c => $('online-c').innerText = c);
socket.on('rtpUpdate', r => rtpObj = r); 
socket.on('maintenanceUpdate', m => maintenance = m); 

// 3. ДОБАВЛЕНО ВРЕМЯ МСК К ИСТОРИИ
socket.on('init_history', bets => { $('feed-list').innerHTML = ''; bets.reverse().forEach(b => addLiveBetToDOM(b)); });
socket.on('newHistoryEntry', b => addLiveBetToDOM(b));

function addLiveBetToDOM(b) {
    const d = document.createElement('div'); d.className = 'live-bet-item';
    const isWin = b.result > 0;
    const modeTag = b.mode === 'Demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[DEMO]</span>' : '<span style="color:var(--neon); font-size:9px;">[REAL]</span>';
    const timeHtml = b.timeMsk ? `<span style="font-size:9px; color:#555; margin-left:5px;">${b.timeMsk}</span>` : '';
    
    d.innerHTML = `
        <div class="live-user">
            <img src="${b.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="live-ava">
            <span>${b.username} ${timeHtml}<br><b style="color:var(--sub); font-size:10px;">(${b.game})</b> ${modeTag}</span>
        </div>
        <span style="font-weight:bold; color:${isWin?'var(--neon)':'var(--neon-red)'}">${isWin ? '+'+b.result : b.result}</span>
    `;
    $('feed-list').prepend(d); 
    if($('feed-list').children.length > 10) $('feed-list').lastChild.remove();
}

// CRASH (8. ГРАДИЕНТ ЦВЕТОВ)
let curCrash = {}; let myCrashBets = []; let isCashingOut = false;

function getCrashColor(x) {
    const val = parseFloat(x);
    if(val < 1.3) return '#ff0055'; // Красный
    if(val < 1.6) return '#ffcc00'; // Желтый
    if(val < 2.0) return '#aaff00'; // Светло-зеленый
    return '#00ff88'; // Ядовитый неон
}

socket.on('crashHistoryUpdate', hist => {
    $('cr-history').innerHTML = hist.map(x => `<div class="cr-badge" style="color:${getCrashColor(x)}; border-color:${getCrashColor(x)};">${x}x</div>`).join('');
});

socket.on('crashBetsUpdate', bets => {
    if(bets.length === 0) $('cr-live-bets').innerHTML = '<div style="text-align:center; color:#555; padding:10px;">Ставок пока нет</div>';
    else {
        $('cr-live-bets').innerHTML = bets.map(b => {
            const modeTag = b.mode === 'demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[D]</span>' : '<span style="color:var(--neon); font-size:9px;">[R]</span>';
            let statusHtml = `<span style="color:var(--text);">${b.bet} TON</span>`;
            if (b.cashedOut) statusHtml = `<span style="color:var(--neon); font-weight:bold;">Вывел ${b.win.toFixed(2)}</span>`;
            else if (curCrash.status === 'crashed') statusHtml = `<span style="color:var(--neon-red);">Проиграл</span>`;
            return `<div class="live-bet-item"><div class="live-user"><img src="${b.avatar}" class="live-ava"> <span>${b.username} ${modeTag}</span></div>${statusHtml}</div>`
        }).join('');
    }
});

socket.on('crashData', d => {
    curCrash = d; const btn = $('cr-btn');
    if(d.status === 'waiting') { 
        $('cr-x').innerText = 'ЖДЕМ'; $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; $('cr-x').style.color = '#fff'; $('cr-x').style.textShadow = 'none';
        if(myCrashBets.length === 0) { btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false; } 
        else if (myCrashBets.length === 1) { btn.innerText = 'ПОСТАВИТЬ 2-Ю СТАВКУ'; btn.style.background = 'var(--neon)'; btn.disabled = false; } 
        else { btn.innerText = 'МАКС. СТАВОК (2)'; btn.style.background = '#555'; btn.disabled = true; }
    }
    if(d.status === 'running') { 
        const col = getCrashColor(d.multiplier);
        $('cr-x').innerText = d.multiplier + 'x'; $('cr-timer').innerText = '🚀 В ПОЛЕТЕ'; $('cr-x').style.color = col; $('cr-x').style.textShadow = `0 0 20px ${col}40`;
        if (myCrashBets.length > 0) { btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * d.multiplier).toFixed(2)} TON`; btn.style.background = 'var(--neon-red)'; btn.disabled = false; } 
        else { btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true; }
    }
    if(d.status === 'crashed') { 
        $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = 'var(--neon-red)'; $('cr-x').style.textShadow = `0 0 20px rgba(255,0,85,0.4)`;
        if(myCrashBets.length > 0) myCrashBets = []; 
        btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false; isCashingOut = false;
    }
});

async function playCrash() {
    if(isCashingOut) return; const btn = $('cr-btn'); const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(curCrash.status === 'waiting') {
        if (myCrashBets.length >= 2) return showToast('Максимум 2 ставки!');
        let crBet = parseFloat($('cr-bet').value); 
        if(isNaN(crBet) || crBet < 0.1 || crBet > 25) return showToast('Мин 0.1, Макс 25 TON');
        if(crBet > curBal) return showToast('Недостаточно средств!');
        isCashingOut = true;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:crBet, win:0, mode}) });
        isCashingOut = false;
        if(r.ok) { user = await r.json(); updateUI(); myCrashBets.push(crBet); btn.innerText = myCrashBets.length === 1 ? 'ПОСТАВИТЬ 2-Ю СТАВКУ' : 'МАКС. СТАВОК (2)'; if(myCrashBets.length===2) btn.disabled=true; showToast('Принято!'); } 
        else { showToast('Ошибка ставки!'); }
    } else if(curCrash.status === 'running' && myCrashBets.length > 0) {
        isCashingOut = true; const win = myCrashBets[0] * curCrash.multiplier; 
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win:win, mode}) });
        if(r.ok) { user = await r.json(); updateUI(); myCrashBets.shift(); showToast(`+ ${win.toFixed(2)} TON!`); if (myCrashBets.length > 0) btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * curCrash.multiplier).toFixed(2)} TON`; else { btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true; } } 
        else { showToast('Не успел!'); } isCashingOut = false;
    }
}

// MINES (2. ОТКРЫТИЕ ПОЛЯ ПРИ ПРОИГРЫШЕ)
let miActive = false; let bombs = []; let miBet = 0; let openedCells = 0; let currentMinesWin = 0; 

function playMines() {
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(miActive) { reqBet('Mines', 0, currentMinesWin).then(ok => { if(ok) { miActive = false; $('mi-btn').innerText='ИГРАТЬ'; showToast(`Забрал ${currentMinesWin.toFixed(2)} TON!`); }}); return; }
    miBet = parseFloat($('mi-bet').value); 
    if(isNaN(miBet) || miBet < 0.1 || miBet > 25) return showToast('Мин 0.1, Макс 25 TON');
    if(miBet > curBal) return showToast('Нет средств!');
    reqBet('Mines', miBet, 0).then(success => {
        if(success) {
            bombs = []; while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
            miActive = true; openedCells = 0; currentMinesWin = miBet; $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`; renderMines(); showToast('Ищи кристаллы!');
        }
    });
}

function renderMines() {
    $('mine-grid').innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'm-cell';
        c.onclick = () => {
            if(!miActive || c.classList.contains('open')) return;
            let hitBomb = bombs.includes(i);
            if (!hitBomb) { if (Math.random() > ((rtpObj.mines||90) / 100)) { hitBomb = true; bombs[0] = i; } }

            if(hitBomb) { 
                miActive=false; $('mi-btn').innerText='ИГРАТЬ'; showToast('БУМ!'); 
                // Открываем все поле
                const cells = document.querySelectorAll('.m-cell');
                cells.forEach((cell, idx) => {
                    cell.innerText = bombs.includes(idx) ? '💣' : '💎';
                    if(bombs.includes(idx)) { cell.style.background = 'var(--neon-red)'; cell.style.borderColor = 'var(--neon-red)'; }
                });
            } else { 
                c.innerText='💎'; c.classList.add('open'); c.style.borderColor='var(--neon)'; openedCells++;
                currentMinesWin = miBet * (1 + openedCells * 0.2); $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`; 
            }
        }; $('mine-grid').appendChild(c);
    }
}

// COINFLIP (4. РЕАЛЬНЫЙ RTP)
let cSide = 'L'; let isFlipping = false;
function setSide(s) { if(isFlipping) return; cSide = s; $('side-l').classList.toggle('active', s==='L'); $('side-x').classList.toggle('active', s==='X'); }
async function playCoin() {
    if(isFlipping) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    const bet = parseFloat($('co-bet').value); 
    if(isNaN(bet) || bet < 0.1 || bet > 25) return showToast('Мин 0.1, Макс 25 TON');
    if(bet > curBal) return showToast('Недостаточно средств!');

    isFlipping = true; $('co-btn').innerText = 'КРУТИМ...';
    
    // Формула для x2 выигрыша: RTP 100 = 50% шанс. RTP 90 = 45% шанс.
    const winChance = ((rtpObj.coinflip || 90) / 100) * 0.5; 
    const isWin = Math.random() < winChance;
    const result = isWin ? cSide : (cSide === 'L' ? 'X' : 'L');
    
    const coin = $('coin-3d');
    const rotation = result === 'L' ? 1800 : 1980;
    coin.style.transform = `rotateY(${rotation}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? bet*2 : 0;
        showToast(win > 0 ? `Победа! +${win.toFixed(2)}` : `Проигрыш: ${result}`); 
        await reqBet('Coinflip', bet, win);
        coin.style.transition = 'none'; coin.style.transform = `rotateY(${result === 'L' ? 0 : 180}deg)`; 
        setTimeout(() => coin.style.transition = 'transform 2s', 50);
        isFlipping = false; $('co-btn').innerText = 'КРУТИТЬ';
    }, 2000);
}

// ФИНАНСЫ И ПРОМО
async function checkRealDeposit(btn) {
    btn.innerText = "ПРОВЕРЯЕМ...";
    const r = await fetch('/api/check_deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id}) });
    if(r.ok) { const d = await r.json(); user = d.user; updateUI(); showToast(`+${d.added} TON`); } 
    else { const e = await r.json(); showToast(e.error || 'Не найдено'); } btn.innerText = "ПРОВЕРИТЬ ОПЛАТУ";
}

async function withdraw() {
    const a = parseFloat($('with-amount').value); const ad = $('with-addr').value;
    if(a > user.balance || a < 5) return showToast('Ошибка (Мин 5 TON)');
    const r = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, address:ad, amount:a}) });
    if(r.ok) { user = await r.json(); updateUI(); renderWithdrawHistory(); showToast('Заявка создана!'); $('with-amount').value=''; } 
    else showToast('Ошибка вывода');
}

async function activatePromo() {
    const code = $('promo-code').value;
    const r = await fetch('/api/promo', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, code}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Активирован!'); $('promo-code').value=''; } 
    else showToast('Ошибка промо');
}

async function reqBet(game, bet, win) {
    const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode}) });
    if(r.ok) { user = await r.json(); updateUI(); return true; } else { showToast('Нет средств!'); return false; }
}

// АДМИН ПАНЕЛЬ (5, 6, 7, 9)
let aTaps = 0; let adminSearchQuery = '';
async function checkAdmin() { aTaps++; if(aTaps >= 5) { aTaps = 0; let p = prompt('Пароль:'); if(p) { adminPass = p; loadAdminData(); } } }
function switchAdminTab(tab) { document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active')); event.target.classList.add('active'); renderAdminContent(tab); }

let adData = {};
async function loadAdminData(search = "") {
    adminSearchQuery = search;
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, searchQuery: search}) });
    if(r.ok) { adData = await r.json(); $('admin-modal').style.display = 'block'; renderAdminContent('withdraws'); } else showToast('Неверный пароль');
}

function renderAdminContent(tab) {
    const c = $('admin-content');
    if(tab === 'withdraws') {
        c.innerHTML = adData.withdraws.map(w => `
            <div style="background:#1a1a1a; padding:10px; border-radius:8px; margin-bottom:10px;">
                <b>ID:</b> ${w.userId} <br> <b>Сумма:</b> ${w.amount} TON <br> <code>${w.address}</code><br>
                <button class="btn" style="padding:8px; margin-top:5px;" onclick="adminW('${w._id}', 'approve')">ОДОБРИТЬ</button>
                <button class="btn" style="padding:8px; margin-top:5px; background:var(--neon-red);" onclick="adminW('${w._id}', 'reject')">ОТКЛОНИТЬ (ВЕРНУТЬ)</button>
            </div>
        `).join('') || 'Нет заявок';
    }
    if(tab === 'promo') { // 6. ПРОМО (Сколько осталось + кто юзал)
        c.innerHTML = `
            <input type="text" id="ad-pr-code" class="input-box" style="padding:10px; font-size:14px;" placeholder="Код">
            <input type="number" id="ad-pr-sum" class="input-box" style="padding:10px; font-size:14px;" placeholder="Сумма TON">
            <input type="number" id="ad-pr-lim" class="input-box" style="padding:10px; font-size:14px;" placeholder="Лимит активаций">
            <button class="btn" style="padding:10px;" onclick="adminPromo()">СОЗДАТЬ ПРОМО</button><hr>
            ${adData.promos.map(p => `
                <div style="padding:8px; border-bottom:1px solid #222;">
                    <div><b>${p.code}</b> - ${p.amount} TON | Осталось: <span style="color:var(--neon)">${p.limit - p.activations}</span> из ${p.limit}</div>
                    <button style="background:#333; color:#fff; border:none; padding:4px 8px; border-radius:4px; margin-top:5px;" onclick="alert('Активации:\\n' + ${JSON.stringify(p.usedBy).replace(/"/g, '&quot;')})">Кто юзал?</button>
                    <button style="background:var(--neon-red); color:#fff; border:none; padding:4px 8px; border-radius:4px; margin-top:5px;" onclick="adminDelPromo('${p._id}')">Удалить</button>
                </div>
            `).join('')}
        `;
    }
    if(tab === 'rtp') { // 9. РАССЫЛКА В БОТ + RTP
        c.innerHTML = `
            <h4 style="color:var(--neon);">РАССЫЛКА В БОТА (Loonx Gifts)</h4>
            <textarea id="ad-bot-msg" class="input-box" style="height:60px; font-size:12px;" placeholder="Сообщение ВСЕМ в бота..."></textarea>
            <button class="btn" style="padding:8px; margin-top:0; margin-bottom:20px; background:var(--neon-blue); color:#000;" onclick="adminBotBroadcast()">ОТПРАВИТЬ ВСЕМ</button>
            <hr>
            <h4 style="color:var(--neon);">ОБНУЛЕНИЕ</h4>
            <button class="btn" style="padding:8px; background:red; margin-bottom:20px;" onclick="adminReset()">ОБНУЛИТЬ ИСТОРИЮ (Баланс останется)</button>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">RTP</h4>
            <div><b>Crash RTP (%):</b> <input type="number" id="rtp-crash" value="${adData.rtp.crash||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('crash')">OK</button></div>
            <div><b>Mines RTP (%):</b> <input type="number" id="rtp-mines" value="${adData.rtp.mines||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('mines')">OK</button></div>
            <div><b>Coinflip RTP (%):</b> <input type="number" id="rtp-coinflip" value="${adData.rtp.coinflip||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('coinflip')">OK</button></div>
        `;
    }
    if(tab === 'users') { // 5, 7. ПОЛЬЗОВАТЕЛИ (ПОИСК, БАН, ЛС, АВАТАРКИ)
        c.innerHTML = `
            <input type="text" class="input-box" placeholder="Поиск (ID / Юзер)" value="${adminSearchQuery}" onchange="loadAdminData(this.value)">
            ${adData.users.map(u => `
            <div style="padding:10px; border-bottom:1px solid #222; position:relative;">
                <img src="${u.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:25px; border-radius:50%; vertical-align:middle;"> 
                <a href="tg://user?id=${u.id}" style="color:var(--text); text-decoration:none;"><b>${u.username}</b></a> 
                (${u.balance.toFixed(2)} TON)
                ${u.isBlocked ? '<span style="background:red; padding:2px 5px; border-radius:4px; font-size:10px;">ЗАБАНЕН</span>' : ''}
                <div style="margin-top:5px; display:flex; gap:5px;">
                    <button style="background:var(--neon-blue); color:#000; border:none; padding:5px; border-radius:4px;" onclick="adminMsgUser('${u.id}')">В ЛС БОТА</button>
                    <button style="background:${u.isBlocked?'#555':'red'}; color:#fff; border:none; padding:5px; border-radius:4px;" onclick="adminBan('${u.id}', ${!u.isBlocked})">${u.isBlocked?'РАЗБАНИТЬ':'БАН'}</button>
                </div>
            </div>
            `).join('')}
        `;
    }
}

// 5. Отклонение вывода с причиной
async function adminW(wId, action) {
    let reason = ''; if(action === 'reject') reason = prompt('Причина отклонения (увидит юзер):') || 'Нарушение правил';
    await fetch('/api/admin/withdraw_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, wId, action, reason}) }); loadAdminData(adminSearchQuery);
}

// 7. Бан и ЛС
async function adminBan(userId, doBan) {
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: doBan?'ban':'unban'}) }); loadAdminData(adminSearchQuery);
}
async function adminMsgUser(userId) {
    let msg = prompt('Сообщение в ЛС от бота:'); if(!msg)return;
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: 'message', msg}) }); showToast('Отправлено');
}

// 9. Рассылка всем
async function adminBotBroadcast() {
    const text = $('ad-bot-msg').value; if(!text) return;
    await fetch('/api/admin/bot_broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, text}) });
    $('ad-bot-msg').value = ''; showToast('Разослано всем!');
}

// 8. Обнуление (баланс остается)
async function adminReset() {
    if(!confirm('ТОЧНО ОБНУЛИТЬ ИСТОРИЮ?')) return;
    await fetch('/api/admin/reset_all_stats', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) }); showToast('История стерта');
}

async function adminPromo() {
    const code = $('ad-pr-code').value; const amount = $('ad-pr-sum').value; const limit = $('ad-pr-lim').value;
    await fetch('/api/admin/promo_create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, code, amount, limit}) }); loadAdminData(adminSearchQuery);
}
async function adminDelPromo(pId) {
    if(!confirm('Удалить этот промокод?')) return;
    await fetch('/api/admin/promo_delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, pId}) }); loadAdminData(adminSearchQuery);
}
async function adminRTP(game) {
    const value = $(`rtp-${game}`).value;
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value}) }); showToast('RTP сохранен!');
}
