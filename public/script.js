// ФИКС ДЛЯ TON CONNECT
const tonwebScript = document.createElement('script');
tonwebScript.src = 'https://unpkg.com/tonweb@0.0.60/dist/tonweb.js';
document.head.appendChild(tonwebScript);

const tg = window.Telegram.WebApp;
const socket = io();
let user = null; 
let mode = 'real';
let adminPass = '';
let globalRtp = 90;
let rtpObj = { crash: 90, mines: 90, coinflip: 90, spin: 94, mine: 40 };
let maintenance = { crash: false, mines: false, coinflip: false, battle: false, spin: false, mine: false };
let adminWalletAddress = '';
let isShowDemo = false;

// TON CONNECT
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: window.location.origin + '/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-btn'
});

const $ = id => document.getElementById(id);

function showToast(msg, dur = 3000) {
    if(!msg) return;
    const container = $('toast-container');
    const t = document.createElement('div'); 
    t.className = 'toast'; 
    t.innerText = msg;
    container.appendChild(t); 
    setTimeout(() => t.remove(), dur);
}

// Анимация улетающего баланса
function flyToBalance(amount) {
    if(amount <= 0) return;
    const el = document.createElement('div');
    el.innerText = `+${amount.toFixed(2)}`;
    el.style.position = 'fixed';
    el.style.left = '50%';
    el.style.top = '50%';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
    el.style.color = 'var(--neon)';
    el.style.fontWeight = 'bold';
    el.style.fontSize = '26px';
    el.style.textShadow = '0 0 15px var(--neon)';
    el.style.zIndex = '9999';
    el.style.transition = 'all 0.8s cubic-bezier(0.25, 1, 0.5, 1)';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);

    setTimeout(() => {
        const target = $('bal-val') ? $('bal-val').getBoundingClientRect() : {left: 20, top: 20};
        el.style.left = `${target.left + 20}px`;
        el.style.top = `${target.top}px`;
        el.style.transform = 'translate(0, 0) scale(0.3)';
        el.style.opacity = '0';
    }, 50);

    setTimeout(() => el.remove(), 850);
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

function getMskTime() {
    return new Date().toLocaleTimeString("ru-RU", {timeZone: "Europe/Moscow"});
}

function renderQuickBets() {
    const vals = [0.1, 0.5, 1, 5, 10, 25];
    function makeButtons(targetId) {
        return vals.map(v =>
            `<button type="button" class="qb-btn" onclick="setQuickBet('${targetId}',${v},this)">${v}</button>`
        ).join('');
    }
    const targets = {
        'qb-crash':    'cr-bet',
        'qb-mines':    'mi-bet',
        'qb-coinflip': 'co-bet',
        'qb-spin':     'sp-bet',
        'qb-mine':     'mn-bet',
    };
    Object.entries(targets).forEach(([elId, betId]) => {
        const el = $(elId);
        if (el) el.innerHTML = makeButtons(betId);
    });
}

window.onload = async () => {
    tg.expand();
    renderQuickBets(); 
    
    const res = await fetch('/api/auth', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(tg.initDataUnsafe.user || {id: "1", first_name: "Dev", username: "DevUser", photo_url: ""})
    });
    const data = await res.json();
    if(data.error === "BLOCKED") {
        document.body.innerHTML = "<h1 style='color:red; text-align:center; margin-top:50px;'>ВЫ ЗАБЛОКИРОВАНЫ</h1>";
        return;
    }

    user = data.user;
    rtpObj = data.rtp || { crash: 90, mines: 90, coinflip: 90, spin: 94 };
    maintenance = data.maintenance || { crash: false, mines: false, coinflip: false, battle: false, spin: false };
    isShowDemo = data.config ? data.config.showDemo : false;
    
    adminWalletAddress = data.adminWallet || '';
    if($('dep-wallet')) $('dep-wallet').innerText = adminWalletAddress || 'Кошелек не настроен на сервере';
    if($('dep-memo')) $('dep-memo').innerText = user.id;

    if($('loader')) { $('loader').style.opacity = '0'; setTimeout(() => $('loader').style.display = 'none', 500); }
    
    const avaUrl = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    if($('user-ava')) $('user-ava').src = avaUrl; 
    if($('profile-ava')) $('profile-ava').src = avaUrl;
    if($('profile-name')) $('profile-name').innerText = user.username || 'Игрок';
    if($('profile-id')) $('profile-id').innerText = user.id; 
    
    updateUI();
    renderWithdrawHistory();
    renderBattleLobbies();

    setTimeout(() => {
        document.querySelectorAll('.nav-item').forEach(nav => {
            const attr = nav.getAttribute('onclick');
            if (attr && (attr.includes("'promo'") || attr.includes('"promo"'))) {
                nav.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;margin-bottom:3px;opacity:0.8;display:block;margin:0 auto;">
                    <path d="M15 5v2"/><path d="M15 11v2"/><path d="M15 17v2"/><path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z"/>
                </svg>
                <span style="font-size:10px;">Промо</span>`;
            }
        });
    }, 500);
};

function updateUI() {
    if(!user) return;
    const bal = mode === 'real' ? (user.balance || 0) : (user.demo_balance || 0);
    if($('bal-val')) $('bal-val').innerText = bal.toFixed(2);
    if($('bal-mode')) {
        $('bal-mode').innerText = mode === 'real' ? 'REAL TON' : 'DEMO TON';
        $('bal-mode').style.color = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
        $('bal-mode').style.borderColor = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    }
    
    if(user.stats) {
        if($('p-bets')) $('p-bets').innerText = user.stats.bets || 0; 
        if($('p-wins')) $('p-wins').innerText = user.stats.wins || 0;
        if($('p-plus')) $('p-plus').innerText = (user.stats.plus || 0).toFixed(2) + ' TON'; 
        if($('p-minus')) $('p-minus').innerText = (user.stats.minus || 0).toFixed(2) + ' TON';
    }

    if($('ref-link')) $('ref-link').innerText = `https://t.me/LoonxGift_Bot?start=${user.id}`;
    if($('ref-count')) $('ref-count').innerText = user.referrals ? user.referrals.length : 0;
    if($('ref-earned')) $('ref-earned').innerText = (user.refEarned || 0).toFixed(2) + ' TON';
    
    if($('ref-list')) {
        if(!user.referrals || user.referrals.length === 0) {
            $('ref-list').innerHTML = '<div style="color:#555; text-align:center;">У вас пока нет рефералов</div>';
        } else {
            $('ref-list').innerHTML = user.referrals.map(r => `
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #222; padding:5px 0;">
                    <span><span style="color:var(--neon);">ID:</span> ${r.id}</span>
                    <span style="color:var(--neon-blue);">+${(r.earnedForMe || 0).toFixed(2)} TON</span>
                </div>
            `).join('');
        }
    }
}

function toggleMode() {
    if (isCrashBetting || isCashingOut || myCrashBets.length > 0 || miActive || isFlipping || currentBattle) {
        return showToast('Сначала завершите активные ставки и игры!');
    }
    mode = mode === 'real' ? 'demo' : 'real'; 
    updateUI(); 
    showToast(`Включен ${mode} режим`); 
}

function nav(pageId, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); 
    if($('page-'+pageId)) $('page-'+pageId).classList.add('active');
    if(el) { document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); el.classList.add('active'); }
}

function navGame(game) { 
    let mKey = game;
    if(game === 'coin') mKey = 'coinflip'; 
    if (maintenance[mKey]) return showToast('Временно тех. перерыв'); 
    nav(game); 
    if(game === 'battle') renderBattleLobbies();
    if(game === 'spin') initSpinPage();
    if(game === 'mine') initMineGrid();
}

function setQuickBet(inputId, amount, btn) {
    if ($(inputId)) $(inputId).value = amount;
    if (btn) {
        const parent = btn.closest('.quick-bets');
        if (parent) parent.querySelectorAll('.qb-btn').forEach(b => b.classList.remove('qb-sel'));
        btn.classList.add('qb-sel');
    }
}

function switchDepTab(type, el) {
    document.querySelectorAll('.w-tab').forEach(b => { b.classList.remove('active'); b.style.background='#222'; b.style.color='#fff'; });
    el.classList.add('active'); el.style.background='var(--neon)'; el.style.color='#000';
    if($('dep-manual')) $('dep-manual').style.display = type === 'manual' ? 'block' : 'none';
    if($('dep-connect')) $('dep-connect').style.display = type === 'connect' ? 'block' : 'none';
}

async function payWithTonConnect() {
    if (!tonConnectUI.connected) return showToast('Сначала подключите кошелек!');
    const amount = parseFloat($('tc-amount').value);
    if(isNaN(amount) || amount <= 0) return showToast('Введите сумму');
    
    let payloadBase64 = "";
    try {
        if (window.TonWeb) {
            const tonweb = new TonWeb();
            const cell = new tonweb.boc.Cell();
            cell.bits.writeUint(0, 32); 
            cell.bits.writeString(user.id);
            const bocBytes = await cell.toBoc();
            payloadBase64 = TonWeb.utils.bytesToBase64(bocBytes);
        }
    } catch(e) { console.error('Ошибка создания комментария:', e); }

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
            address: adminWalletAddress,
            amount: (amount * 1000000000).toString(),
            ...(payloadBase64 && { payload: payloadBase64 }) 
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        showToast('Транзакция отправлена! Ожидайте зачисления и нажмите "ПРОВЕРИТЬ ОПЛАТУ" через 10 сек.');
    } catch (e) { showToast('Транзакция отменена'); }
}

function renderWithdrawHistory() {
    const list = $('w-history-list');
    if(!list) return;
    
    let wHtml = '';
    if(!user.withdrawHistory || user.withdrawHistory.length === 0) wHtml = '<div style="color:#555; text-align:center;">Нет выводов</div>';
    else {
        wHtml = user.withdrawHistory.map(w => {
            let cls = w.status === 'Подтверждено' ? 'approved' : (w.status === 'Отклонено' ? 'rejected' : 'pending');
            let rsn = w.reason ? `<br><span style="color:var(--neon-red); font-size:10px;">Причина: ${w.reason}</span>` : '';
            return `
                <div class="w-history-item ${cls}">
                    <div><b>ВЫВОД:</b> ${w.amount} TON<br><span style="color:#888; font-size:10px;">${w.time || ''}</span></div>
                    <div style="text-align:right;">${w.status} ${rsn}</div>
                </div>`;
        }).join('');
    }

    let dHtml = '<h4 style="color:var(--neon); margin-top:20px; text-align:center;">ИСТОРИЯ ДЕПОЗИТОВ</h4>';
    if(!user.depositHistory || user.depositHistory.length === 0) dHtml += '<div style="color:#555; text-align:center;">Нет депозитов</div>';
    else {
        dHtml += user.depositHistory.map(d => `
            <div class="w-history-item approved" style="border-left: 3px solid var(--neon);">
                <div><b>ДЕПОЗИТ:</b> ${d.amount} TON<br><span style="color:#888; font-size:10px;">${d.time || ''}</span></div>
                <div style="text-align:right; color:var(--neon);">Успешно</div>
            </div>`).join('');
    }

    list.innerHTML = wHtml + dHtml;
}

if($('online-c')) socket.on('online', c => $('online-c').innerText = c);
socket.on('rtpUpdate', r => rtpObj = r); 
socket.on('maintenanceUpdate', m => maintenance = m); 
socket.on('configUpdate', c => isShowDemo = c.showDemo);

socket.on('init_history', bets => { 
    if($('feed-list')) { 
        $('feed-list').innerHTML = ''; 
        bets.forEach(b => addLiveBetToDOM(b, true)); 
    }
});
socket.on('newHistoryEntry', b => addLiveBetToDOM(b, false));

function addLiveBetToDOM(b, isInit) {
    const list = $('feed-list');
    if(!list) return;
    if(b.mode === 'Demo' && !isShowDemo) return; 

    const d = document.createElement('div'); d.className = 'live-bet-item';
    const isWin = b.result > 0;
    const modeTag = b.mode === 'Demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[DEMO]</span>' : '<span style="color:var(--neon); font-size:9px;">[REAL]</span>';
    const timeHtml = b.timeMsk ? `<span style="font-size:9px; color:#555; margin-left:5px;">${b.timeMsk}</span>` : '';
    const nameStr = b.username.includes('VS') ? `<span style="font-size:9px;">${b.username}</span>` : `${b.username} <span style="color:var(--neon); font-size:9px;">(${(b.balance||0).toFixed(2)} T)</span>`;

    d.innerHTML = `
        <div class="live-user">
            <img src="${b.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="live-ava">
            <span>${nameStr} ${timeHtml}<br><b style="color:var(--sub); font-size:10px;">(${b.game})</b> ${modeTag}</span>
        </div>
        <span style="font-weight:bold; color:${isWin?'var(--neon)':'var(--neon-red)'}">${isWin ? '+'+b.result : b.result}</span>
    `;
    
    if (isInit) {
        list.appendChild(d);
    } else {
        list.prepend(d);
        if(list.children.length > 10) list.lastChild.remove();
    }
}

// CRASH
let curCrash = {}; let myCrashBets = []; let isCashingOut = false; let isCrashBetting = false; let crMode = mode; 

function getCrashColor(x) {
    const val = parseFloat(x);
    if(val < 1.3) return '#ff0055'; 
    if(val < 1.6) return '#ffcc00'; 
    if(val < 2.0) return '#aaff00'; 
    return '#00ff88'; 
}

socket.on('crashHistoryUpdate', hist => {
    if($('cr-history')) $('cr-history').innerHTML = hist.map(x => `<div class="cr-badge" style="color:${getCrashColor(x)}; border-color:${getCrashColor(x)};">${x}x</div>`).join('');
});

socket.on('crashBetsUpdate', bets => {
    if(!$('cr-live-bets')) return;
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
    if(!btn) return;
    if(d.status === 'waiting') { 
        if($('cr-x')) { $('cr-x').innerText = 'ЖДЕМ'; $('cr-x').style.color = '#fff'; $('cr-x').style.textShadow = 'none'; }
        if($('cr-timer')) $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; 
        if(myCrashBets.length === 0) { btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false; } 
        else if (myCrashBets.length === 1) { btn.innerText = 'ПОСТАВИТЬ 2-Ю СТАВКУ'; btn.style.background = 'var(--neon)'; btn.disabled = false; } 
        else { btn.innerText = 'МАКС. СТАВОК (2)'; btn.style.background = '#555'; btn.disabled = true; }
    }
    if(d.status === 'running') { 
        const col = getCrashColor(d.multiplier);
        if($('cr-x')) { $('cr-x').innerText = d.multiplier + 'x'; $('cr-x').style.color = col; $('cr-x').style.textShadow = `0 0 20px ${col}40`; }
        if($('cr-timer')) $('cr-timer').innerText = '🚀 В ПОЛЕТЕ'; 
        if (myCrashBets.length > 0) { btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * d.multiplier).toFixed(2)} TON`; btn.style.background = 'var(--neon-red)'; btn.disabled = false; } 
        else { btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true; }
    }
    if(d.status === 'crashed') { 
        if($('cr-x')) { $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = 'var(--neon-red)'; $('cr-x').style.textShadow = `0 0 20px rgba(255,0,85,0.4)`; }
        if(myCrashBets.length > 0) myCrashBets = []; 
        btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false; isCashingOut = false;
    }
});

async function playCrash() {
    if(isCashingOut || isCrashBetting) return; 
    const btn = $('cr-btn'); const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(curCrash.status === 'waiting') {
        if (myCrashBets.length >= 2) return showToast('Максимум 2 ставки!');
        let crBet = parseFloat($('cr-bet').value); 
        if(isNaN(crBet) || crBet < 0.1 || crBet > 25) return showToast('Мин 0.1, Макс 25 TON');
        if(crBet > curBal) return showToast('Недостаточно средств!');
        
        isCrashBetting = true; btn.disabled = true;
        crMode = mode;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:crBet, win:0, mode: crMode}) });
        isCrashBetting = false; btn.disabled = false;
        
        if(r.ok) { user = await r.json(); updateUI(); myCrashBets.push(crBet); btn.innerText = myCrashBets.length === 1 ? 'ПОСТАВИТЬ 2-Ю СТАВКУ' : 'МАКС. СТАВОК (2)'; if(myCrashBets.length===2) btn.disabled=true; showToast('Принято!'); } 
        else { showToast('Ошибка ставки!'); }
    } else if(curCrash.status === 'running' && myCrashBets.length > 0) {
        isCashingOut = true; const win = myCrashBets[0] * curCrash.multiplier; 
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win:win, mode: crMode}) });
        if(r.ok) { user = await r.json(); updateUI(); myCrashBets.shift(); showToast(`+ ${win.toFixed(2)} TON!`); flyToBalance(win); if (myCrashBets.length > 0) btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * curCrash.multiplier).toFixed(2)} TON`; else { btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true; } } 
        else { showToast('Не успел!'); } isCashingOut = false;
    }
}

// MINES
let miActive = false; let bombs = []; let miBet = 0; let openedCells = 0; let currentMinesWin = 0; 
let isMinesProcessing = false; let miMode = mode;

function playMines() {
    if(isMinesProcessing) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(miActive) { 
        isMinesProcessing = true;
        $('mi-btn').disabled = true;
        reqBet('Mines', 0, currentMinesWin, miMode).then(ok => { 
            isMinesProcessing = false;
            $('mi-btn').disabled = false;
            if(ok) { miActive = false; $('mi-btn').innerText='ИГРАТЬ'; showToast(`Забрал ${currentMinesWin.toFixed(2)} TON!`); flyToBalance(currentMinesWin); renderMines(true); }
        }); 
        return; 
    }
    miBet = parseFloat($('mi-bet').value); 
    if(isNaN(miBet) || miBet < 0.1 || miBet > 25) return showToast('Мин 0.1, Макс 25 TON');
    if(miBet > curBal) return showToast('Нет средств!');
    
    isMinesProcessing = true; $('mi-btn').disabled = true; miMode = mode;
    reqBet('Mines', miBet, 0, miMode).then(success => {
        isMinesProcessing = false; $('mi-btn').disabled = false;
        if(success) {
            bombs = []; while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
            miActive = true; openedCells = 0; currentMinesWin = miBet; $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`; renderMines(); showToast('Ищи кристаллы!');
        }
    });
}

function renderMines(isEnd = false) {
    if(!$('mine-grid')) return;
    $('mine-grid').innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'm-cell';
        if(isEnd && miActive===false) {
             c.innerText = bombs.includes(i) ? '💣' : '💎';
             c.style.opacity = '0.5';
             $('mine-grid').appendChild(c);
             continue;
        }
        c.onclick = () => {
            if(!miActive || c.classList.contains('open') || isMinesProcessing) return;
            let hitBomb = bombs.includes(i);
            if (!hitBomb) { if (Math.random() > ((rtpObj.mines||90) / 100)) { hitBomb = true; bombs[0] = i; } }

            if(hitBomb) { 
                miActive=false; $('mi-btn').innerText='ИГРАТЬ'; showToast('БУМ!'); 
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

// COINFLIP
let cSide = 'L'; let isFlipping = false;
function setSide(s) { 
    if(isFlipping) return; 
    cSide = s; 
    $('side-l').classList.toggle('active', s==='L'); 
    $('side-x').classList.toggle('active', s==='X'); 
    
    $('side-l').style.boxShadow = s === 'L' ? '0 0 15px var(--neon)' : 'none';
    $('side-l').style.borderColor = s === 'L' ? 'var(--neon)' : '#333';
    
    $('side-x').style.boxShadow = s === 'X' ? '0 0 15px var(--neon-red)' : 'none';
    $('side-x').style.borderColor = s === 'X' ? 'var(--neon-red)' : '#333';
}

setTimeout(() => setSide('L'), 500);

async function playCoin() {
    if(isFlipping) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    const bet = parseFloat($('co-bet').value); 
    if(isNaN(bet) || bet < 0.1 || bet > 25) return showToast('Мин 0.1, Макс 25 TON');
    if(bet > curBal) return showToast('Недостаточно средств!');

    isFlipping = true; $('co-btn').innerText = 'КРУТИМ...'; $('co-btn').disabled = true;
    let coMode = mode; 
    
    const winChance = ((rtpObj.coinflip || 90) / 100) * 0.5; 
    const isWin = Math.random() < winChance;
    const result = isWin ? cSide : (cSide === 'L' ? 'X' : 'L');
    
    const coin = $('coin-3d');
    const rotation = result === 'L' ? 1800 : 1980;
    coin.style.transition = 'transform 2s cubic-bezier(0.2, 0.8, 0.2, 1)';
    coin.style.transform = `rotateY(${rotation}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? bet*2 : 0;
        showToast(win > 0 ? `Победа! +${win.toFixed(2)}` : `Проигрыш: ${result}`); 
        await reqBet('Coinflip', bet, win, coMode);
        if(win > 0) flyToBalance(win); 
        
        setTimeout(() => {
            coin.style.transition = 'none'; 
            coin.style.transform = `rotateY(${result === 'L' ? 0 : 180}deg)`; 
            isFlipping = false; $('co-btn').innerText = 'КРУТИТЬ'; $('co-btn').disabled = false;
        }, 500);
    }, 2000);
}


// --- BATTLE ROULETTE КЛИЕНТ ---
let battleLobbies = [];
let currentBattle = null;

socket.on('battleUpdate', () => { renderBattleLobbies(); });

socket.on('battleSpin', ({lobbyId, winnerId}) => {
    if(currentBattle && currentBattle._id === lobbyId) {
        currentBattle.status = 'spinning';
        $('battle-join-area').style.display = 'none'; 
        
        const wheel = $('battle-wheel');
        const timerObj = $('battle-timer');
        
        timerObj.className = 'timer-pulse';
        timerObj.innerText = 'РУЛЕТКА КРУТИТСЯ!';
        
        wheel.style.transition = 'transform 5s cubic-bezier(0.2, 0.8, 0.2, 1)';
        
        let totalPool = currentBattle.players.reduce((s, p) => s + p.bet, 0);
        let startAngle = 0;
        let winAngle = 0;
        
        for(let p of currentBattle.players) {
            let slice = (p.bet / totalPool) * 360;
            if(p.id === winnerId) { winAngle = startAngle + (slice / 2); break; }
            startAngle += slice;
        }
        
        const rotations = 3600; 
        const finalTransform = rotations + (270 - winAngle);
        wheel.style.transform = `rotate(${finalTransform}deg)`;
        
        setTimeout(() => {
            const winner = currentBattle.players.find(p => p.id === winnerId);
            const pureWin = totalPool - winner.bet; 
            
            timerObj.className = 'timer-pulse';
            timerObj.innerText = `ПОБЕДИЛ: ${winner.username}!`;
            timerObj.style.color = winner.color;
            timerObj.style.textShadow = `0 0 15px ${winner.color}`;
            currentBattle.status = 'finished'; // Устанавливаем статус завершено локально
            
            showToast(`${winner.username} забирает чистыми +${pureWin.toFixed(2)} TON!`);
            if (winner.id === user.id) flyToBalance(totalPool); 
        }, 5000);
    }
});

function openBattleModal() {
    if(mode === 'demo') return showToast('Battle Roulette доступна только на REAL TON!');
    $('battle-modal').style.display = 'flex';
}

async function createBattleLobby() {
    const bet = parseFloat($('b-bet').value);
    
    if(isNaN(bet) || bet < 0.5 || bet > 150) return showToast('Ваша ставка от 0.5 до 150 TON'); 
    
    const r = await fetch('/api/battle/create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, bet}) });
    if(r.ok) { user = await r.json(); updateUI(); $('battle-modal').style.display='none'; showToast('Лобби создано!'); }
    else { const e = await r.json(); showToast(e.error || 'Ошибка'); }
}

async function submitBattleJoin() {
    if(!currentBattle) return;
    const betStr = $('battle-join-bet').value;
    const bet = parseFloat(betStr);
    
    if(isNaN(bet) || bet < 0.5 || bet > 150) {
        return showToast(`Сумма от 0.5 до 150 TON`);
    }
    
    const r = await fetch('/api/battle/join', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, lobbyId: currentBattle._id, bet}) });
    if(r.ok) { 
        const d = await r.json(); user = d.user; updateUI(); showToast('Вы вошли в лобби!'); 
        $('battle-join-area').style.display = 'none'; 
        openBattleGame(d.lobby); 
    } else { const e = await r.json(); showToast(e.error || 'Ошибка'); }
}


async function cancelBattle(lobbyId) {
    if(!confirm('Отменить лобби и вернуть TON?')) return;
    const r = await fetch('/api/battle/cancel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, lobbyId}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Лобби отменено!'); }
    else showToast('Ошибка отмены');
}

async function renderBattleLobbies() {
    const r = await fetch('/api/battle/list');
    if(!r.ok) return;
    battleLobbies = await r.json();
    
    const list = $('battle-lobbies');
    if(!list) return;

    if($('my-lobbies-chk') && $('my-lobbies-chk').checked) {
        battleLobbies.sort((a,b) => {
            let aMine = a.players.some(p => p.id === user.id) ? -1 : 1;
            let bMine = b.players.some(p => p.id === user.id) ? -1 : 1;
            return aMine - bMine;
        });
    }

    list.innerHTML = battleLobbies.map(l => {
        const creator = l.players[0];
        const isMine = l.creatorId === user.id;
        const imIn = l.players.some(p => p.id === user.id);
        
        let actionBtn = '';
        if(l.status === 'finished') {
            actionBtn = `<button class="btn" style="background:#444; color:#aaa; padding:5px 10px; font-size:12px;" disabled>ЗАВЕРШЕНО</button>`;
        } else if(isMine && l.players.length === 1) {
            actionBtn = `<button class="btn" style="background:var(--neon-red); padding:5px; font-size:12px;" onclick="cancelBattle('${l._id}')">ОТМЕНА</button>`;
        } else {
            actionBtn = `<button class="btn" style="background:var(--neon); color:#000; padding:5px 10px; font-size:12px; font-weight:bold;" onclick="openBattleGame('${l._id}')">${imIn ? 'СМОТРЕТЬ' : 'ВОЙТИ / СМОТРЕТЬ'}</button>`;
        }

        const timeStr = new Date(l.createdAt).toLocaleTimeString("ru-RU", {timeZone:"Europe/Moscow", hour:"2-digit", minute:"2-digit"});
        
        return `
        <div style="background:#1a1a1a; border:1px solid ${isMine?'var(--neon)':'#333'}; padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${creator.avatar}" style="width:30px; border-radius:50%; opacity: ${l.status==='finished'?'0.5':'1'};">
                <div style="opacity: ${l.status==='finished'?'0.5':'1'};">
                    <b style="color:var(--text);">${creator.username}</b> <span style="font-size:10px; color:#555;">[${timeStr}]</span><br>
                    <span style="font-size:10px; color:var(--neon-blue);">Игроков: ${l.players.length}/4</span>
                </div>
            </div>
            <div>${actionBtn}</div>
        </div>`;
    }).join('') || '<div style="text-align:center; color:#555;">Нет открытых лобби</div>';
}

function openBattleGame(lobbyId) {
    if(mode === 'demo') { showToast('Только REAL TON!'); return; }
    let lobby = typeof lobbyId === 'string' ? battleLobbies.find(l => l._id === lobbyId) : lobbyId;
    if(!lobby) return;
    currentBattle = lobby;
    
    $('battle-game-modal').style.display = 'flex';
    $('battle-wheel').style.transition = 'none';
    $('battle-wheel').style.transform = 'rotate(0deg)';
    
    $('battle-timer').className = 'timer-wait';
    $('battle-timer').style.color = '#fff';
    $('battle-timer').style.textShadow = 'none';
    
    drawBattleWheel(lobby);
    renderBattlePlayers(lobby);
    
    const imIn = lobby.players.some(p => p.id === user.id);
    if (!imIn && lobby.status === 'waiting' && lobby.players.length < 4) {
        $('battle-join-area').style.display = 'block';
        $('battle-join-bet').placeholder = `Сумма (0.5 - 150 TON)`;
    } else {
        $('battle-join-area').style.display = 'none';
    }

    const updateTimer = () => {
        if(!currentBattle) return;
        if(currentBattle.status === 'finished') {
            $('battle-timer').innerText = 'БИТВА ОКОНЧЕНА';
            return;
        }
        if(currentBattle.status !== 'waiting') return;
        
        const timerObj = $('battle-timer');
        
        if(currentBattle.players.length < 2) {
            timerObj.className = 'timer-wait';
            timerObj.innerText = 'ОЖИДАНИЕ ИГРОКОВ...';
            setTimeout(updateTimer, 1000);
            return;
        }

        if (!currentBattle.timerEndTime) {
            timerObj.innerText = 'ПОДГОТОВКА...';
            setTimeout(updateTimer, 1000);
            return;
        }

        const endTime = new Date(currentBattle.timerEndTime).getTime();
        const left = Math.floor((endTime - Date.now()) / 1000);
        
        if(left > 0) {
            let m = Math.floor(left / 60); let s = left % 60;
            timerObj.className = 'timer-pulse';
            timerObj.innerText = `СТАРТ ЧЕРЕЗ: 0${m}:${s<10?'0'+s:s}`;
            timerObj.style.color = '#fff';
            timerObj.style.textShadow = 'none'; 
            setTimeout(updateTimer, 1000);
        } else {
            timerObj.className = 'timer-pulse';
            timerObj.innerText = 'ЗАПУСК...';
        }
    };
    updateTimer();
}

function closeBattleGame() {
    $('battle-game-modal').style.display = 'none';
    currentBattle = null;
}

function drawBattleWheel(lobby) {
    const canvas = $('battle-wheel');
    const ctx = canvas.getContext('2d');
    
    const dpr = window.devicePixelRatio || 1;
    const baseSize = 280; 
    canvas.style.width = baseSize + 'px';
    canvas.style.height = baseSize + 'px';
    canvas.width = baseSize * dpr;
    canvas.height = baseSize * dpr;
    
    ctx.scale(dpr, dpr);
    
    const cw = baseSize / 2;
    const ch = baseSize / 2;
    
    ctx.clearRect(0, 0, baseSize, baseSize);
    
    const totalPool = lobby.players.reduce((sum, p) => sum + p.bet, 0);
    let startAngle = 0;
    
    for (let p of lobby.players) {
        let sliceAngle = (p.bet / totalPool) * 2 * Math.PI;
        
        ctx.beginPath();
        ctx.moveTo(cw, ch);
        ctx.arc(cw, ch, cw - 4, startAngle, startAngle + sliceAngle); 
        ctx.closePath();
        
        let gradient = ctx.createLinearGradient(cw - baseSize/2, ch - baseSize/2, cw + baseSize/2, ch + baseSize/2);
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, '#1a1a1a');
        
        ctx.fillStyle = gradient;
        ctx.fill();
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#0a0a0a';
        ctx.stroke();

        ctx.save();
        ctx.translate(cw, ch);
        ctx.rotate(startAngle + sliceAngle / 2);
        ctx.textAlign = "right";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px sans-serif";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        ctx.fillText(p.username, cw - 20, 4);
        ctx.restore();
        
        startAngle += sliceAngle;
    }
    
    ctx.beginPath();
    ctx.arc(cw, ch, 25, 0, 2 * Math.PI);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#222';
    ctx.stroke();
    
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#555";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText("TON", cw, ch);
}

function renderBattlePlayers(lobby) {
    const totalPool = lobby.players.reduce((sum, p) => sum + p.bet, 0);
    $('battle-players').innerHTML = lobby.players.map(p => {
        const perc = ((p.bet / totalPool) * 100).toFixed(1);
        return `
        <div style="background:#111; border-left:4px solid ${p.color}; padding:8px; border-radius:6px; flex: 1 1 45%; max-width:48%; text-align:left;">
            <img src="${p.avatar}" style="width:20px; border-radius:50%; vertical-align:middle;"> 
            <span style="font-size:12px; font-weight:bold;">${p.username}</span><br>
            <span style="font-size:12px; color:var(--neon);">${p.bet} TON</span> <span style="font-size:10px; color:#888;">(${perc}%)</span>
        </div>`;
    }).join('');
}

// ФИНАНСЫ И ПРОМО
async function checkRealDeposit(btn) {
    btn.innerText = "ПРОВЕРЯЕМ..."; btn.disabled = true;
    const r = await fetch('/api/check_deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id}) });
    if(r.ok) { const d = await r.json(); user = d.user; updateUI(); renderWithdrawHistory(); showToast(`+${d.added} TON`); } 
    else { const e = await r.json(); showToast(e.error || 'Не найдено'); } 
    btn.innerText = "ПРОВЕРИТЬ ОПЛАТУ"; btn.disabled = false;
}

async function withdraw() {
    const a = parseFloat($('with-amount').value); 
    const ad = $('with-addr').value;
    
    if(!ad || !ad.trim()) return showToast('Введите адрес кошелька!');
    if(a > user.balance || a < 5) return showToast('Ошибка (Мин 5 TON)');
    
    const btn = document.querySelector('.btn-withdraw'); btn.disabled = true; btn.innerText = "СОЗДАНИЕ...";
    const r = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, address:ad, amount:a}) });
    btn.disabled = false; btn.innerText = "СОЗДАТЬ ЗАЯВКУ";
    
    if(r.ok) { user = await r.json(); updateUI(); renderWithdrawHistory(); showToast('Заявка создана!'); $('with-amount').value=''; $('with-addr').value=''; } 
    else showToast('Ошибка вывода');
}

async function activatePromo() {
    const code = $('promo-code').value;
    const r = await fetch('/api/promo', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, code}) });
    if(r.ok) { 
        user = await r.json(); 
        updateUI(); 
        showToast('Активирован!'); 
        $('promo-code').value=''; 
    } else { 
        const e = await r.json(); 
        showToast(e.error || 'Ошибка промо');
    }
}

async function reqBet(game, bet, win, reqMode = mode) {
    try {
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode: reqMode}) });
        if(r.ok) { 
            user = await r.json(); 
            updateUI(); 
            return true; 
        } else { 
            const err = await r.json();
            showToast(err.error || 'Ошибка баланса'); 
            return false; 
        }
    } catch(e) {
        showToast('Сбой сети');
        return false;
    }
}

// АДМИН ПАНЕЛЬ
let aTaps = 0; let adminSearchQuery = ''; let currentAdminFilter = 'balance';
async function checkAdmin() { aTaps++; if(aTaps >= 5) { aTaps = 0; let p = prompt('Пароль:'); if(p) { adminPass = p; loadAdminData(); } } }

function switchAdminTab(tab) { 
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active')); 
    if (typeof event !== 'undefined' && event && event.target) event.target.classList.add('active');
    
    if (tab === 'logs') {
        const c = $('admin-content');
        c.innerHTML = '<div style="text-align:center; padding:20px; color:var(--neon);">Загрузка логов...</div>';
        loadAdminLogs(1, '');
    } else {
        renderAdminContent(tab); 
    }
}

let adData = {};
async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) { adData = await r.json(); $('admin-modal').style.display = 'flex'; switchAdminTab('withdraws'); } else showToast('Неверный пароль');
}

async function searchAdminUsers(query, filterType = currentAdminFilter) {
    adminSearchQuery = query;
    currentAdminFilter = filterType;
    const r = await fetch('/api/admin/search_user', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, query, filterType}) });
    if(r.ok) { const d = await r.json(); adData.users = d.users; renderAdminContent('users'); }
}

async function adminViewUser(userId, page = 1) {
    const r = await fetch('/api/admin/user_details', { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({pass: adminPass, userId, page}) 
    });
    
    if(!r.ok) return showToast('Ошибка загрузки юзера');
    const data = await r.json();
    const u = data.user;
    const hist = data.history || [];
    const totalPages = data.totalPages || 1;
    
    const c = $('admin-content');
    c.innerHTML = `
        <button onclick="renderAdminContent('users')" class="btn" style="margin-bottom:15px; background:#333; font-size:12px;">← НАЗАД К СПИСКУ</button>
        
        <div style="background:#1a1a1a; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid var(--neon);">
            <h3 style="color:var(--neon); margin-bottom:5px;">${u.username || 'Игрок'} (ID: ${u.id})</h3>
            <p style="font-size:14px; margin-bottom:5px;"><b>Текущий баланс:</b> <span style="color:var(--neon); font-weight:bold;">${u.balance.toFixed(2)} TON</span></p>
            <p style="font-size:14px; margin-bottom:15px; color:#888;">Заработано на реф: ${(u.refEarned || 0).toFixed(2)} TON | С промокодов: ${(u.promoEarned || 0).toFixed(2)} TON</p>
            
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <input type="number" id="ad-bal-val" class="input-box" placeholder="Сумма TON" style="margin-bottom:0;">
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn" style="background:var(--neon); color:#000; font-size:12px;" onclick="adminChangeBal('${u.id}', 'add')">ВЫДАТЬ</button>
                <button class="btn" style="background:var(--neon-red); font-size:12px;" onclick="adminChangeBal('${u.id}', 'sub')">ЗАБРАТЬ</button>
            </div>
        </div>

        <h4 style="color:var(--neon-blue); margin-top:20px; margin-bottom:10px;">История ставок (Стр. ${page} / ${totalPages})</h4>
        <div style="overflow-x:auto;">
            <table style="width:100%; font-size:11px; text-align:left; border-collapse: collapse; background:#111; border-radius:8px;">
                <tr style="background:#222; border-bottom:1px solid #444;">
                    <th style="padding:10px;">Время</th>
                    <th>Игра</th>
                    <th>Ставка -> Выигрыш</th>
                    <th>Баланс ПОСЛЕ</th>
                </tr>
                ${hist.length > 0 ? hist.map(h => `
                <tr style="border-bottom:1px solid #222;">
                    <td style="padding:8px; color:#666;">${h.time || '---'}</td>
                    <td style="font-weight:bold;">${h.game}</td>
                    <td style="color:${parseFloat(h.win) > 0 ? 'var(--neon)' : '#ff4d4d'}">
                        ${h.bet} -> ${h.win}
                    </td>
                    <td style="color:#aaa;">${(h.balanceAfter || 0).toFixed(2)}</td>
                </tr>
                `).join('') : '<tr><td colspan="4" style="padding:20px; text-align:center; color:#555;">История пуста</td></tr>'}
            </table>
        </div>
        
        <div style="display:flex; justify-content:space-between; margin-top:15px; margin-bottom:30px;">
            <button class="btn" style="width:48%; background:#222; font-size:12px;" onclick="adminViewUser('${u.id}', ${page > 1 ? page - 1 : 1})" ${page === 1 ? 'disabled' : ''}>← Назад</button>
            <button class="btn" style="width:48%; background:#222; font-size:12px;" onclick="adminViewUser('${u.id}', ${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Вперед →</button>
        </div>
    `;
}

async function adminChangeBal(userId, type) {
    const valInput = document.getElementById('ad-bal-val');
    const amountStr = valInput.value;
    const amount = parseFloat(amountStr);
    
    if(isNaN(amount) || amount <= 0) {
        return showToast('Введите корректную сумму больше 0');
    }
    
    try {
        const response = await fetch('/api/admin/change_balance', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ pass: adminPass, userId: userId, amount: amount, type: type }) 
        });

        const result = await response.json();

        if (response.ok) {
            showToast(type === 'add' ? `✅ Начислено ${amount} TON` : `📉 Списано ${amount} TON`);
            valInput.value = ''; 
            adminViewUser(userId, 1); 
            
            if (adData.users) {
                const userInList = adData.users.find(u => String(u.id) === String(userId));
                if (userInList) userInList.balance = result.newBalance; 
            }
            if (user && String(userId) === String(user.id)) {
                user.balance = result.newBalance;
                updateUI();
            }
        } else {
            showToast(`❌ Ошибка: ${result.error || 'Сервер отклонил запрос'}`);
        }
    } catch (e) {
        console.error('Ошибка баланса:', e);
        showToast('🆘 Сбой сети');
    }
}

function renderAdminContent(tab) {
    const c = $('admin-content');
    if(tab === 'withdraws') {
        c.innerHTML = `
            <div style="background:#222; padding:10px; border-radius:8px; margin-bottom:15px; text-align:center;">
                <div style="color:var(--neon); font-size:18px;"><b>ВСЕГО ДЕПОВ:</b> ${adData.totalDeposited.toFixed(2)} TON</div>
                <div style="color:var(--neon-red); font-size:18px;"><b>ВСЕГО ВЫВОДОВ:</b> ${adData.totalWithdrawn.toFixed(2)} TON</div>
            </div>
            <h4 style="color:var(--neon);">ОЖИДАЮТ ВЫПЛАТЫ</h4>
            ${adData.withdraws.map(w => `
                <div style="background:#1a1a1a; padding:10px; border-radius:8px; margin-bottom:10px;">
                    <b>ID:</b> ${w.userId} <br> <b>Сумма:</b> ${w.amount} TON <br> <code style="word-break: break-all; font-size:10px;">${w.address}</code><br>
                    <button class="btn" style="padding:8px; margin-top:5px;" onclick="adminW('${w._id}', 'approve')">ОДОБРИТЬ</button>
                    <button class="btn" style="padding:8px; margin-top:5px; background:var(--neon-red);" onclick="adminW('${w._id}', 'reject')">ОТКЛОНИТЬ (ВЕРНУТЬ)</button>
                </div>
            `).join('') || '<div style="color:#555;">Нет заявок</div>'}
            
            <hr>
            <h4 style="color:var(--neon);">ПОСЛЕДНИЕ ДЕПОЗИТЫ</h4>
            ${adData.latestDeposits.map(d => `
                <div style="padding:8px; border-bottom:1px solid #333;">
                    <a href="tg://user?id=${d.userId}" style="color:var(--neon); text-decoration:none;"><b>@${d.username}</b></a>
                    (ID: ${d.userId}) <br>
                    Пополнил: <b style="color:#fff;">${d.amount} TON</b> <span style="font-size:10px; color:#888;">[${d.time}]</span>
                </div>
            `).join('') || '<div style="color:#555;">Нет депозитов</div>'}
        `;
    }
    if(tab === 'promo') { 
        c.innerHTML = `
            <input type="text" id="ad-pr-code" class="input-box" style="padding:10px; font-size:14px;" placeholder="Код">
            <input type="number" id="ad-pr-sum" class="input-box" style="padding:10px; font-size:14px;" placeholder="Сумма TON">
            <input type="number" id="ad-pr-lim" class="input-box" style="padding:10px; font-size:14px;" placeholder="Лимит активаций">
            <button class="btn" style="padding:10px;" onclick="adminPromo()">СОЗДАТЬ ПРОМО</button><hr>
            ${adData.promos.map(p => {
                const usedListHtml = p.usedBy.map(uid => `<a href="tg://user?id=${uid}" style="color:var(--neon);">ID: ${uid}</a>`).join(', ');
                return `
                <div style="padding:8px; border-bottom:1px solid #222;">
                    <div><b>${p.code}</b> - ${p.amount} TON | Осталось: <span style="color:var(--neon)">${p.limit - p.usedBy.length}</span> из ${p.limit}</div>
                    <div style="font-size:10px; margin-top:5px; max-height:40px; overflow-y:auto; background:#111; padding:5px;">Использовали: ${usedListHtml || 'Никто'}</div>
                    <button style="background:var(--neon-red); color:#fff; border:none; padding:4px 8px; border-radius:4px; margin-top:5px;" onclick="adminDelPromo('${p._id}')">Удалить</button>
                </div>
            `}).join('')}
        `;
    }
    if(tab === 'rtp') {
        c.innerHTML = `
            <h4 style="color:var(--neon);">РАССЫЛКА В БОТА</h4>
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
            <div><b>🎰 Spin RTP (%):</b> <input type="number" id="rtp-spin" value="${adData.rtp.spin||40}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block; background:linear-gradient(90deg,#ff6b00,#ff0055);" onclick="adminRTP('spin')">OK</button></div>
            <div><b>⛏️ Mine RTP (%):</b> <input type="number" id="rtp-mine" value="${adData.rtp.mine||40}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block; background:linear-gradient(90deg,#7a4920,#c07030);" onclick="adminRTP('mine')">OK</button></div>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">ОТКЛЮЧЕНИЕ ИГР (ТЕХ. РАБОТЫ)</h4>
            <label><input type="checkbox" ${adData.maintenance.crash ? 'checked' : ''} onchange="adminMaint('crash', this.checked)"> Crash</label><br>
            <label><input type="checkbox" ${adData.maintenance.mines ? 'checked' : ''} onchange="adminMaint('mines', this.checked)"> Mines</label><br>
            <label><input type="checkbox" ${adData.maintenance.coinflip ? 'checked' : ''} onchange="adminMaint('coinflip', this.checked)"> Coinflip</label><br>
            <label><input type="checkbox" ${adData.maintenance.battle ? 'checked' : ''} onchange="adminMaint('battle', this.checked)"> Battle Roulette</label><br>
            <label><input type="checkbox" ${adData.maintenance.spin ? 'checked' : ''} onchange="adminMaint('spin', this.checked)"> 🎰 Spin</label><br>
            <label><input type="checkbox" ${adData.maintenance.mine ? 'checked' : ''} onchange="adminMaint('mine', this.checked)"> ⛏️ Mine</label><br>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">ОТОБРАЖЕНИЕ В ИСТОРИИ</h4>
            <label><input type="checkbox" ${isShowDemo ? 'checked' : ''} onchange="adminDemoToggle(this.checked)"> Показывать Demo ставки</label><br>
        `;
    }
    if(tab === 'users') { 
        let usersHtml = (adData.users || []).map(u => `
            <div style="padding:10px; border-bottom:1px solid #222; position:relative; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; align-items:center; gap:10px;" onclick="adminViewUser('${u.id}', 1)">
                    <img src="${u.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:30px; border-radius:50%;"> 
                    <div>
                        <b style="color:var(--text); text-decoration:underline;">${u.username}</b> 
                        (${u.balance.toFixed(2)} TON)
                        ${u.isBlocked ? '<span style="background:red; padding:2px 5px; border-radius:4px; font-size:10px;">ЗАБАНЕН</span>' : ''}
                    </div>
                </div>
                <div style="display:flex; gap:5px;">
                    <button style="background:var(--neon-blue); color:#000; border:none; padding:5px; border-radius:4px; flex:1;" onclick="adminMsgUser('${u.id}')">В ЛС БОТА</button>
                    <button style="background:${u.isBlocked?'#555':'red'}; color:#fff; border:none; padding:5px; border-radius:4px; flex:1;" onclick="adminBan('${u.id}', ${!u.isBlocked})">${u.isBlocked?'РАЗБАНИТЬ':'БАН'}</button>
                </div>
            </div>
            `).join('');

        c.innerHTML = `
            <div style="text-align:center; color:var(--neon-blue); font-weight:bold; margin-bottom:10px;">Всего юзеров: ${adData.totalUsers}</div>
            
            <div style="display:flex; justify-content:space-around; background:#111; padding:10px; border-radius:8px; margin-bottom:10px; font-size:12px;">
                <label><input type="radio" name="u_filt" ${currentAdminFilter==='balance'?'checked':''} onchange="searchAdminUsers(adminSearchQuery, 'balance')"> Топ Баланс</label>
                <label><input type="radio" name="u_filt" ${currentAdminFilter==='new'?'checked':''} onchange="searchAdminUsers(adminSearchQuery, 'new')"> Новые</label>
                <label><input type="radio" name="u_filt" ${currentAdminFilter==='banned'?'checked':''} onchange="searchAdminUsers(adminSearchQuery, 'banned')"> Забаненые</label>
            </div>
            
            <input type="text" class="input-box" placeholder="Поиск (ID / Юзер)" value="${adminSearchQuery}" oninput="searchAdminUsers(this.value)">
            <p style="font-size:10px; color:var(--sub); margin-top:5px; text-align:center;">*Нажми на логин юзера для полной статистики</p>
            <div style="margin-top:10px;">${usersHtml}</div>
        `;
    }
}

// НОВЫЙ ФУНКЦИОНАЛ ЛОГОВ АДМИНА
let currentLogsPage = 1;
let currentLogsDate = '';

async function loadAdminLogs(page = 1, dateQuery = '') {
    currentLogsPage = page;
    currentLogsDate = dateQuery;
    const c = $('admin-content');
    
    try {
        const r = await fetch('/api/admin/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass: adminPass, page: page, date: dateQuery, limit: 30 })
        });
        
        if(r.ok) {
            const data = await r.json();
            renderLogsUI(data.logs, data.totalPages, page);
        } else {
            c.innerHTML = '<div style="color:red; text-align:center;">Ошибка загрузки логов</div>';
        }
    } catch(e) {
        c.innerHTML = '<div style="color:red; text-align:center;">Сбой сети</div>';
    }
}

function renderLogsUI(logs, totalPages, page) {
    const c = $('admin-content');
    
    let logsHtml = logs.length > 0 ? logs.map(l => `
        <tr style="border-bottom:1px solid #222;">
            <td style="padding:6px; color:#888; white-space:nowrap;">${l.date} ${l.time}</td>
            <td style="padding:6px; color:var(--neon-blue); font-weight:bold;">${l.adminUser || 'Система'}</td>
            <td style="padding:6px; color:#fff;">${l.action}</td>
        </tr>
    `).join('') : '<tr><td colspan="3" style="text-align:center; padding:15px; color:#555;">Логи не найдены</td></tr>';

    c.innerHTML = `
        <h4 style="color:var(--neon); margin-bottom:10px;">Журнал действий</h4>
        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <input type="text" id="log-date-search" class="input-box" placeholder="Поиск по дате (напр. 06.08)" value="${currentLogsDate}" style="margin:0; flex:1;">
            <button class="btn" style="width:auto; padding:0 15px; background:var(--neon-blue);" onclick="loadAdminLogs(1, document.getElementById('log-date-search').value)">ПОИСК</button>
        </div>
        
        <div style="overflow-x:auto;">
            <table style="width:100%; font-size:11px; text-align:left; border-collapse: collapse; background:#111; border-radius:8px;">
                <tr style="background:#222;">
                    <th style="padding:8px;">Дата/Время</th>
                    <th style="padding:8px;">Инициатор</th>
                    <th style="padding:8px;">Действие</th>
                </tr>
                ${logsHtml}
            </table>
        </div>
        
        <div style="display:flex; justify-content:space-between; margin-top:15px; margin-bottom:20px;">
            <button class="btn" style="width:48%; background:#333;" onclick="loadAdminLogs(${page > 1 ? page - 1 : 1}, currentLogsDate)" ${page === 1 ? 'disabled' : ''}>← Назад</button>
            <div style="color:#555; font-size:12px; align-self:center;">Стр ${page} из ${totalPages || 1}</div>
            <button class="btn" style="width:48%; background:#333;" onclick="loadAdminLogs(${page + 1}, currentLogsDate)" ${page >= totalPages ? 'disabled' : ''}>Вперед →</button>
        </div>
    `;
}

async function adminW(wId, action) {
    let reason = ''; if(action === 'reject') reason = prompt('Причина отклонения (увидит юзер):') || 'Нарушение правил';
    await fetch('/api/admin/withdraw_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, wId, action, reason}) }); loadAdminData();
}

async function adminBan(userId, doBan) {
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: doBan?'ban':'unban'}) }); searchAdminUsers(adminSearchQuery);
}
async function adminMsgUser(userId) {
    let msg = prompt('Сообщение в ЛС от бота:'); if(!msg)return;
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: 'message', msg}) }); showToast('Отправлено');
}

async function adminBotBroadcast() {
    const text = $('ad-bot-msg').value; if(!text) return;
    await fetch('/api/admin/bot_broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, text}) });
    $('ad-bot-msg').value = ''; showToast('Разослано всем!');
}

async function adminReset() {
    if(!confirm('ТОЧНО ОБНУЛИТЬ ИСТОРИЮ?')) return;
    await fetch('/api/admin/reset_all_stats', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) }); showToast('История стерта');
}

async function adminPromo() {
    const code = $('ad-pr-code').value; const amount = $('ad-pr-sum').value; const limit = $('ad-pr-lim').value;
    await fetch('/api/admin/promo_create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, code, amount, limit}) }); loadAdminData();
}
async function adminDelPromo(pId) {
    if(!confirm('Удалить этот промокод?')) return;
    await fetch('/api/admin/promo_delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, pId}) }); loadAdminData();
}
async function adminRTP(game) {
    const value = $(`rtp-${game}`).value;
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value}) }); showToast('RTP сохранен!');
}
async function adminMaint(game, state) {
    await fetch('/api/admin/maintenance', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, state}) }); 
    adData.maintenance[game] = state; showToast(`Статус ${game} обновлен!`);
}
async function adminDemoToggle(state) {
    await fetch('/api/admin/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, showDemo: state}) }); 
    showToast('Отображение демо обновлено!'); isShowDemo = state;
}

// ===================== SPIN GAME =====================
let spinBet = 0.5;
let spinFreeSpins = 0;
let spinFreeSpinsMult = 1;
let spinProgressValue = 0;
let spinIsSpinning = false;
let spinAnimInterval = null;

const SPIN_SYMS_ANIM = ['L','L','X','L','G','L','X','L','L'];

const SPIN_PAYLINES_FE = [
    [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],
    [0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],
    [2,2,1,0,0],[1,0,1,0,1],[0,1,0,1,0],
    [1,2,1,2,1],[2,1,2,1,2],[0,1,1,1,2],
    [2,1,1,1,0],[1,1,0,1,1],[1,1,2,1,1]
];

function initSpinPage() {
    if (!$('spin-grid')) return;
    buildSpinGrid();
    updateSpinProgress(spinProgressValue);
    updateSpinUI();
    // Pre-fill idle grid with nice pattern
    const symbols = ['L','L','X','L','G','X','L','L','X','L','L','X','L','X','L'];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = $(`sc-${r}-${c}`);
            if (cell) {
                const sym = symbols[r * 5 + c];
                cell.className = `spin-cell sym-${sym}`;
                cell.innerText = sym === 'G' ? '🎁' : sym;
            }
        }
    }
}

function buildSpinGrid() {
    const grid = $('spin-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = document.createElement('div');
            cell.className = 'spin-cell sym-L';
            cell.id = `sc-${r}-${c}`;
            cell.innerText = 'L';
            grid.appendChild(cell);
        }
    }
}

function updateSpinProgress(val) {
    spinProgressValue = Math.max(0, Math.min(100, val));
    const fill = $('spin-progress-fill');
    if (fill) fill.style.width = spinProgressValue + '%';
    const label = $('spin-progress-label');
    if (label) label.innerText = `БОНУС ПРОГРЕСС: ${Math.round(spinProgressValue)}%`;
}

function updateSpinUI() {
    const btn = $('sp-btn');
    const badge = $('spin-free-badge');
    const betInput = $('sp-bet');
    const betLock = $('sp-bet-lock');
    if (!btn) return;
    if (spinFreeSpins > 0) {
        btn.innerText = `🎰 ФРИСПИН ×${spinFreeSpinsMult} (${spinFreeSpins} ост.)`;
        btn.style.background = 'linear-gradient(90deg,#ff0055,#ff6b00)';
        btn.style.boxShadow = '0 0 20px rgba(255,0,85,0.4)';
        if (badge) { badge.style.display = 'block'; badge.innerText = `🎰 ${spinFreeSpins} ост. | Множитель: ×${spinFreeSpinsMult}`; }
        if (betInput) { betInput.disabled = true; betInput.style.opacity = '0.4'; }
        if (betLock) betLock.style.display = 'block';
    } else {
        btn.innerText = 'КРУТИТЬ 🎰';
        btn.style.background = '';
        btn.style.boxShadow = '';
        if (badge) badge.style.display = 'none';
        if (betInput) { betInput.disabled = false; betInput.style.opacity = '1'; }
        if (betLock) betLock.style.display = 'none';
        spinFreeSpinsMult = 1;
    }
}

// ========= MINE GAME =========
const MINE_BLOCK_CLASS = {
    stone:'stone-blk', redstone:'redstone-blk', gold:'gold-blk',
    diamond:'diamond-blk', obsidian:'obsidian-blk',
    tnt:'tnt-blk', book:'book-blk', unknown:'unknown-blk'
};
const MC_ROWS = 3;
const MC_COLS = 5;
let mineIsSpinning    = false;
let mineBookCount     = 0;
let mineAutoRemaining = 0;
let minePersistGrid   = null;
let mineLastBet       = 1;
let mineRunningTotal  = 0;

// ── Инвентарь: 5×3 пустых ячеек (заполняются во время раскрытия) ──
// Draw a pixel-art pickaxe onto canvas — proper Minecraft style
function drawPickaxeCanvas(type) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const cols = {
        wooden:  { H:'#a09060', D:'#706040', W:'#b07830', V:'#7a5018' },
        stone:   { H:'#a0a0a0', D:'#606060', W:'#b07830', V:'#7a5018' },
        iron:    { H:'#d4dce0', D:'#8898a0', W:'#b07830', V:'#7a5018' },
        golden:  { H:'#ffe840', D:'#c09818', W:'#b07830', V:'#7a5018' },
        diamond: { H:'#30e8f8', D:'#08b0c8', W:'#b07830', V:'#7a5018' },
    };
    const { H, D, W, V } = cols[type] || cols.wooden;
    // Draw 1 logical pixel = 2×2 canvas pixels
    const px = (lx, ly, col) => { ctx.fillStyle = col; ctx.fillRect(lx*2, ly*2, 2, 2); };
    //
    // Minecraft pickaxe: head at top-LEFT, handle going diagonally to bottom-RIGHT
    // Head shape (top-left corner area):
    //  y=0: ..HHHH..  (upper horizontal bar of head, 4px wide)
    //  y=1: .HHHHHH.  (wider middle of head)
    //  y=2: HHHH.HHH  (prongs: left prong 2px + gap + right body 3px)
    //  y=3: .H......  (lower left prong tip only)
    //  y=4: ...W....  (handle starts)
    //  y=5: ....W...
    //  ...diagonally to y=14
    //
    // Upper teeth of head (pointing left = toward x=0):
    px(0,2,H); px(1,2,H);          // left prong top
    px(0,3,D);                       // left prong shadow
    // Main horizontal bar of head:
    px(1,1,H); px(2,1,H); px(3,1,H); px(4,1,H); px(5,1,H);
    px(1,0,H); px(2,0,H); px(3,0,H); px(4,0,H);
    px(2,2,H); px(3,2,H); px(4,2,H); px(5,2,H); px(6,2,H);
    // Head shading (darker bottom/right):
    px(1,2,D); px(5,0,D);
    px(2,3,D); px(3,3,D); px(4,3,D); px(5,3,D);
    px(5,1,D); px(6,2,D);
    // Handle (diagonal: from head connecting point → bottom-right):
    const handle = [
        [4,4,W],[5,4,W],  [5,5,W],[6,5,W],  [6,6,W],[7,6,W],
        [7,7,W],[8,7,W],  [8,8,V],[9,8,W],  [9,9,V],[10,9,W],
        [10,10,V],[11,10,W], [11,11,V],[12,11,W], [12,12,V],[13,12,W],
        [13,13,V],[14,13,W], [14,14,V],
    ];
    handle.forEach(([x,y,col]) => px(x,y,col));
    return c.toDataURL('image/png');
}

// Pixel art pickaxe URLs cached per type
const _pxImgs = {};
function getPickaxeImg(type) {
    if (!_pxImgs[type]) _pxImgs[type] = drawPickaxeCanvas(type);
    return _pxImgs[type];
}

// ── Прочность кирок (ударов до сломки одной кирки) ──
// wooden: хрупкая, stone: средняя, iron: хорошая, golden: быстрая но слабая, diamond: топ
const PICKAXE_DURABILITY = { wooden:8, stone:16, iron:28, golden:6, diamond:50 };

// ── Инициализация и обновление полосы прочности ──
let _durMax = 0;
let _durLeft = 0;
function initDurabilityBar(pickaxeType, pickaxeCount) {
    const dur = (PICKAXE_DURABILITY[pickaxeType] || 10) * (pickaxeCount || 1);
    _durMax  = dur;
    _durLeft = dur;
    const wrap  = $('mine-dur-wrap');
    const bar   = $('mine-dur-bar');
    const count = $('mine-dur-count');
    if (wrap)  wrap.style.display  = 'flex';
    if (bar)   { bar.style.width   = '100%'; bar.className = 'mine-dur-bar-inner'; }
    if (count) count.textContent   = `${dur} / ${dur}`;
}
function consumeDurability(hits) {
    if (_durMax <= 0) return;
    _durLeft = Math.max(0, _durLeft - hits);
    const pct    = _durLeft / _durMax;
    const bar    = $('mine-dur-bar');
    const count  = $('mine-dur-count');
    if (bar) {
        bar.style.width = (pct * 100).toFixed(1) + '%';
        bar.className = 'mine-dur-bar-inner' + (pct < 0.25 ? ' dur-crit' : pct < 0.55 ? ' dur-low' : '');
    }
    if (count) count.textContent = `${_durLeft} / ${_durMax}`;
}
function hideDurabilityBar() {
    const wrap = $('mine-dur-wrap');
    if (wrap) wrap.style.display = 'none';
}

let mineLastPickaxeCount = 3;
let mineLastPickaxeType  = 'wooden';

function initMineInventory(pickaxeCount, pickaxeType) {
    if (pickaxeCount) mineLastPickaxeCount = Math.max(1, Math.min(9, pickaxeCount));
    if (pickaxeType)  mineLastPickaxeType  = pickaxeType;
    // Show/reset durability bar
    initDurabilityBar(mineLastPickaxeType, mineLastPickaxeCount);
    const inv = $('mc-inventory');
    if (!inv) return;
    inv.innerHTML = '';
    // Create all 15 cells
    const cells = [];
    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const cell = document.createElement('div');
            cell.className = 'inv-cell';
            cell.id = `inv-${r}-${c}`;
            inv.appendChild(cell);
            cells.push(cell);
        }
    }
    // Place pickaxes in random cells
    const count = mineLastPickaxeCount;
    const pType = mineLastPickaxeType;
    const pUrl  = getPickaxeImg(pType);
    // Shuffle cell indices, pick first N
    const indices = cells.map((_,i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i+1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let k = 0; k < count && k < cells.length; k++) {
        const cell = cells[indices[k]];
        cell.dataset.hasPick = '1';
        const img = document.createElement('img');
        img.src = pUrl;
        img.style.cssText = 'width:80%;height:80%;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));';
        cell.appendChild(img);
    }
}

// ── Шахта: 5×3 плоская сетка блоков ──
// keepPersist: сохранить minePersistGrid; idlePreview: показать случайные руды вместо скрытых
function initMineShaft(keepPersist, idlePreview) {
    const shaft = $('mc-shaft');
    if (!shaft) return;
    shaft.innerHTML = '';
    // Блоки для idle-превью (чаще всего камень, реже руды, ценные снизу)
    const IDLE_BY_ROW = [
        ['stone','stone','stone','stone','redstone','redstone'],
        ['stone','stone','redstone','redstone','gold','gold'],
        ['redstone','gold','gold','diamond','diamond','obsidian'],
    ];
    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const blk = document.createElement('div');
            blk.id = `mc-blk-${r}-${c}`;
            const persistType = keepPersist && minePersistGrid ? minePersistGrid[r][c] : null;
            if (persistType) {
                blk.className = `mc-blk ${MINE_BLOCK_CLASS[persistType] || 'stone-blk'}`;
                blk.dataset.revealed = '1';
            } else if (idlePreview) {
                const pool = IDLE_BY_ROW[r];
                const t = pool[Math.floor(Math.random() * pool.length)];
                blk.className = `mc-blk ${MINE_BLOCK_CLASS[t] || 'stone-blk'}`;
            } else {
                blk.className = 'mc-blk hidden-blk';
            }
            shaft.appendChild(blk);
        }
    }
    // Сбросить сундуки и счётчик
    for (let i = 0; i < MC_COLS; i++) {
        const ch = $(`mc-chest-${i}`);
        if (ch) ch.classList.remove('open', 'open-anim');
    }
    const rt = $('mine-running-total');
    if (rt) { rt.textContent = '0.00 TON'; rt.classList.remove('has-win'); }
    const wd = $('mine-win-display');
    if (wd) { wd.innerText = ''; wd.style.color = ''; wd.classList.remove('show'); }
    mineRunningTotal = 0;
    hideDurabilityBar();
}

// Плавная анимация числа (считает от start до end)
function animateCounter(el, start, end, durationMs, prefix, suffix) {
    if (!el) return;
    const startTime = performance.now();
    const diff = end - start;
    function step(now) {
        const p = Math.min((now - startTime) / durationMs, 1);
        const eased = 1 - Math.pow(1 - p, 3);  // ease-out cubic
        el.innerText = prefix + (start + diff * eased).toFixed(2) + suffix;
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ──── Снаряд-кирка: падает ВЕРТИКАЛЬНО сверху, отскакивает при ударах ────
// Кирка падает строго вниз над блоком, отскакивает вверх между ударами
function spawnPickaxeProj(fromEl, toEl, pickaxeType, totalHits, onEachHit, onAllDone) {
    if (!toEl) { if (onEachHit) onEachHit(0); if (onAllDone) onAllDone(); return; }
    totalHits = totalHits || 1;

    const pUrl = getPickaxeImg(pickaxeType || 'wooden');
    const dstRect = toEl.getBoundingClientRect();
    const bx = dstRect.left + dstRect.width / 2;   // block center X
    const by = dstRect.top;                          // block top Y (pickaxe lands here)

    // Pickaxe spawns directly above the block, falls straight down
    const startY = by - 90;  // start 90px above block top

    const el = document.createElement('img');
    el.src = pUrl;
    // Rotated to look like a pickaxe falling: head pointing down-left
    el.style.cssText = `position:fixed; width:28px; height:28px; z-index:9999; pointer-events:none; user-select:none; image-rendering:pixelated; left:${bx}px; top:${startY}px; transform:translate(-50%,-50%) rotate(135deg);`;
    document.body.appendChild(el);

    const DROP_MS   = 200;  // fall duration (ms) — faster = snappier
    const RECOIL_MS = 130;  // bounce-up duration
    const WAIT_MS   = 60;   // pause at top of bounce before next drop

    // Animate vertical drop from y0 to y1
    function drop(y0, y1, dur, callback) {
        let t0 = null;
        function frame(ts) {
            if (!t0) t0 = ts;
            const t = Math.min((ts - t0) / dur, 1);
            const ease = t * t;  // ease-in (accelerate downward = gravity)
            el.style.top = (y0 + (y1 - y0) * ease) + 'px';
            if (t < 1) requestAnimationFrame(frame);
            else callback();
        }
        requestAnimationFrame(frame);
    }

    // Animate vertical rise (recoil) from y0 to y1
    function rise(y0, y1, dur, callback) {
        let t0 = null;
        function frame(ts) {
            if (!t0) t0 = ts;
            const t = Math.min((ts - t0) / dur, 1);
            const ease = 1 - (1-t)*(1-t);  // ease-out (decelerate going up)
            el.style.top = (y0 + (y1 - y0) * ease) + 'px';
            if (t < 1) requestAnimationFrame(frame);
            else callback();
        }
        requestAnimationFrame(frame);
    }

    let curHit = 0;
    const bounceY = by - 50;  // how high the pickaxe bounces between hits

    function doStrike() {
        // Fall to block
        drop(bounceY, by, DROP_MS, () => {
            // IMPACT!
            if (onEachHit) onEachHit(curHit);
            curHit++;
            if (curHit >= totalHits) {
                // All hits done — fly up and fade out
                rise(by, by - 100, 200, () => {
                    el.style.transition = 'opacity 0.12s';
                    el.style.opacity = '0';
                    setTimeout(() => el.remove(), 130);
                    if (onAllDone) onAllDone();
                });
            } else {
                // Recoil upward, then strike again
                rise(by, bounceY, RECOIL_MS, () => {
                    setTimeout(doStrike, WAIT_MS);
                });
            }
        });
    }

    // First fall from high above
    drop(startY, bounceY, DROP_MS * 1.5, () => {
        setTimeout(doStrike, WAIT_MS);
    });
}

// ──── TNT взрыв: подсвечивает соседей ────
function triggerTNTEffect(row, col) {
    const neighbors = [
        [row-1,col-1],[row-1,col],[row-1,col+1],
        [row,col-1],             [row,col+1],
        [row+1,col-1],[row+1,col],[row+1,col+1]
    ];
    setTimeout(() => {
        neighbors.forEach(([br, bc]) => {
            if (br < 0 || br >= MC_ROWS || bc < 0 || bc >= MC_COLS) return;
            const el = $(`mc-blk-${br}-${bc}`);
            if (el && el.dataset.revealed !== '1') el.classList.add('blast-zone');
            setTimeout(() => { if (el) el.classList.remove('blast-zone'); }, 500);
        });
    }, 100);
}

// ──── Сбор книжки ────
function collectBook(blockEl) {
    mineBookCount++;
    if (blockEl) {
        blockEl.classList.add('book-collect');
        setTimeout(() => blockEl.classList.remove('book-collect'), 600);
    }
    const statusEl = $('mine-book-status');
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = `📚 Книжки: ${mineBookCount}/3${mineBookCount >= 3 ? ' — <b>АВТО-СПИНЫ!</b>' : ''}`;
    }
    if (mineBookCount >= 3) {
        mineBookCount = 0;
        mineAutoRemaining = 3;
        showToast('📚 3 КНИЖКИ! 3 АВТО-СПИНА!', 3000);
    }
}

// ──── Снимок текущей сетки ────
function buildCurrentGrid() {
    const g = [];
    for (let r = 0; r < MC_ROWS; r++) {
        const row = [];
        for (let c = 0; c < MC_COLS; c++) {
            const el = $(`mc-blk-${r}-${c}`);
            row.push(el && el.dataset.revealed === '1' ? (el.dataset.blockType || null) : null);
        }
        g.push(row);
    }
    return g;
}

// ─── Всплывающий попап с выигрышем у блока ───
function spawnBlockWinPopup(blockEl, amount) {
    if (!blockEl || amount <= 0) return;
    const rect = blockEl.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'block-win-popup';
    pop.textContent = `+${amount.toFixed(2)}`;
    pop.style.left = (rect.left + rect.width / 2) + 'px';
    pop.style.top  = (rect.top) + 'px';
    document.body.appendChild(pop);
    pop.addEventListener('animationend', () => pop.remove());
}

// ─── Заполнить ячейку инвентаря найденным блоком ───
function fillInvCell(row, col, blockType, pickaxeType) {
    const cell = $(`inv-${row}-${col}`);
    if (!cell) return;
    cell.innerHTML = '';
    delete cell.dataset.hasPick;
    if (blockType === 'book') {
        cell.textContent = '📗';
        cell.className = 'inv-cell filled inv-book';
    } else if (blockType === 'tnt') {
        cell.textContent = '💣';
        cell.className = 'inv-cell filled inv-tnt';
    } else {
        cell.className = 'inv-cell filled inv-block';
        // Mini block with correct texture
        const mini = document.createElement('div');
        const cls = MINE_BLOCK_CLASS[blockType] || 'stone-blk';
        mini.className = `mc-blk ${cls}`;
        mini.style.cssText = 'width:78%;height:78%;border-radius:2px;box-shadow:inset 1px 1px 0 rgba(255,255,255,0.4),inset -1px -1px 0 rgba(0,0,0,0.3);pointer-events:none;';
        cell.appendChild(mini);
    }
}

// ─── Частицы разбивки блока ───
function spawnBreakParticles(blockEl, blockType) {
    if (!blockEl) return;
    const rect = blockEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const clrs = {
        stone:    ['#888','#aaa','#777'],
        redstone: ['#880000','#cc2020','#ff4444'],
        gold:     ['#c8a000','#ffe060','#deb800'],
        diamond:  ['#006b9a','#00e4ff','#4acce0'],
        obsidian: ['#0e0420','#6030a0','#3010a0'],
        tnt:      ['#cc1010','#ff4040','#ff8888'],
        book:     ['#4c1090','#ffd700','#c080ff'],
    };
    const c = clrs[blockType] || clrs.stone;
    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 55;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 20;
        const size = 2 + Math.random() * 4;
        p.style.cssText = `position:fixed;width:${size}px;height:${size}px;background:${c[i % c.length]};left:${cx}px;top:${cy}px;border-radius:1px;z-index:9800;pointer-events:none;image-rendering:pixelated;`;
        document.body.appendChild(p);
        let elapsed = 0;
        const id = setInterval(() => {
            elapsed += 16;
            const t = elapsed / 1000;
            p.style.transform = `translate(${vx*t}px,${vy*t + 300*t*t}px) rotate(${elapsed*0.25}deg)`;
            p.style.opacity = String(Math.max(0, 1 - elapsed / 480));
            if (elapsed >= 480) { clearInterval(id); p.remove(); }
        }, 16);
    }
}

// ─── Основное раскрытие: grid[r][c] из сервера, blockWins[r][c] ───
function revealMineShaft(grid, blockWins, pickaxe, win, balanceBefore, chestMult) {
    // ── Timing ──
    const HIT_MS    = 260;  // flight time per hit
    const BOUNCE_MS = 140;  // bounce between hits
    const SETTLE_MS = 100;  // settle between hits
    const BLK_GAP   = 320;  // gap between blocks starting

    // Прочность блоков (ударов кирки)
    const BLOCK_HITS_MAP = { stone:2, redstone:2, gold:3, diamond:3, obsidian:4, book:2 };
    // Бонус/штраф по типу кирки: diamond/golden быстрее, wooden медленнее
    const PICKAXE_MOD_MAP = { wooden:+1, stone:0, iron:0, golden:-1, diamond:-1 };
    const pMod = PICKAXE_MOD_MAP[pickaxe] || 0;

    // Ячейка инвентаря с киркой (старается взять ту, что с иконкой)
    function pickInvEl() {
        // Find a cell that has a pickaxe icon
        const inv = $('mc-inventory');
        if (!inv) return null;
        const cells = Array.from(inv.querySelectorAll('.inv-cell[data-has-pick="1"]'));
        if (cells.length === 0) {
            const all = Array.from(inv.querySelectorAll('.inv-cell'));
            return all[Math.floor(Math.random() * all.length)] || null;
        }
        return cells[Math.floor(Math.random() * cells.length)];
    }

    // ── Update all shaft blocks to real server types immediately ──
    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const blkEl = $(`mc-blk-${r}-${c}`);
            if (!blkEl) continue;
            const cls = MINE_BLOCK_CLASS[grid[r][c]] || 'stone-blk';
            blkEl.className = `mc-blk ${cls}`;
            blkEl.dataset.revealed = '0';
            blkEl.style.transition = '';
            blkEl.style.transform  = '';
            blkEl.style.opacity    = '';
        }
    }

    let blkStart = 0;
    let computedLastReveal = 0;

    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const blockType = grid[r][c];
            const blockWin  = blockWins[r][c] || 0;
            const blkHits   = Math.max(1, (BLOCK_HITS_MAP[blockType] || 2) + pMod);
            const captR = r, captC = c, captStart = blkStart, captHits = blkHits;

            // Time for this block to fully finish
            // totalHits * (HIT_MS + BOUNCE_MS + SETTLE_MS) + BREAK_MS
            const totalBlockTime = captStart + captHits * (HIT_MS + BOUNCE_MS + SETTLE_MS) + 300;
            if (totalBlockTime > computedLastReveal) computedLastReveal = totalBlockTime;

            setTimeout(() => {
                const blkEl = $(`mc-blk-${captR}-${captC}`);
                if (!blkEl) return;
                const invEl = pickInvEl();

                // Add initial crack stage
                blkEl.classList.add('cracking-1');

                // Use new physics-based pickaxe projectile
                spawnPickaxeProj(invEl, blkEl, pickaxe, captHits,
                    (hitIdx) => {
                        // Called on each impact
                        blkEl.classList.add('crack-hit');
                        setTimeout(() => blkEl.classList.remove('crack-hit'), 80);
                        // Consume durability
                        consumeDurability(1);
                        // Progress crack visuals
                        blkEl.classList.remove('cracking-1','cracking-2','cracking-3');
                        if (captHits === 1 || hitIdx === captHits - 1) {
                            blkEl.classList.add('cracking-3');
                        } else if (hitIdx === 0) {
                            blkEl.classList.add('cracking-1');
                        } else {
                            blkEl.classList.add('cracking-2');
                        }
                    },
                    () => {
                        // All hits done — block SHATTERS and DISAPPEARS
                        blkEl.classList.remove('cracking-1','cracking-2','cracking-3','crack-hit');

                        // Show money popup BEFORE block disappears
                        if (blockWin > 0) {
                            spawnBlockWinPopup(blkEl, blockWin);
                            mineRunningTotal += blockWin;
                            const rt = $('mine-running-total');
                            if (rt) {
                                rt.classList.add('has-win');
                                animateCounter(rt, mineRunningTotal - blockWin, mineRunningTotal, 380, '', ' TON');
                            }
                        }

                        // Particles
                        spawnBreakParticles(blkEl, blockType);

                        // BLOCK DISAPPEARS (scale to 0 + fade)
                        blkEl.style.transition = 'transform 0.22s cubic-bezier(0.5,0,1,1), opacity 0.18s';
                        blkEl.style.transform  = 'scale(0.05)';
                        blkEl.style.opacity    = '0';
                        blkEl.dataset.revealed = '1';

                        setTimeout(() => {
                            if (blkEl.parentNode) blkEl.parentNode.removeChild(blkEl);
                        }, 220);

                        // Fill inventory cell with what was found
                        fillInvCell(captR, captC, blockType, pickaxe);

                        if (blockType === 'book') collectBook(blkEl);
                    }
                );
            }, blkStart);

            blkStart += BLK_GAP;
        }
    }

    // Время после последнего блока
    const lastBlkReveal = computedLastReveal;
    const effectiveChestMult = chestMult || 2;

    // Сундуки открываются волной — и КАЖДЫЙ показывает ×N ВЫШЕ себя
    setTimeout(() => {
        for (let i = 0; i < MC_COLS; i++) {
            setTimeout(() => {
                const ch = $(`mc-chest-${i}`);
                if (!ch) return;
                ch.classList.add('open', 'open-anim');
                setTimeout(() => ch.classList.remove('open-anim'), 600);
                // Показать ×N над каждым сундуком
                const pop = document.createElement('div');
                pop.className = 'chest-mult-tag';
                pop.textContent = `×${effectiveChestMult}`;
                ch.appendChild(pop);
                setTimeout(() => { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 2800);
            }, i * 110);
        }
    }, lastBlkReveal + 150);

    // Итоговый результат и баланс
    const afterReveal = lastBlkReveal + 500;
    setTimeout(() => {
        const wd = $('mine-win-display');
        if (win > 0) {
            const newBal = user ? (user.balance || 0) : (balanceBefore + win);
            if (wd) {
                wd.style.color = 'var(--neon)';
                wd.classList.add('show');
                wd.innerHTML = '<span id="mine-win-num">+0.00 TON</span>';
                animateCounter(document.getElementById('mine-win-num'), 0, win, 900, '+', ' TON');
            }
            const balSpan = $('bal-val');
            if (balSpan) animateCounter(balSpan, balanceBefore, newBal, 1000, '', '');
            flyToBalance(win);
            showToast(`💰 +${win.toFixed(2)} TON!`);
        } else {
            if (wd) { wd.innerText = 'Не повезло...'; wd.style.color = '#ff4444'; wd.classList.add('show'); }
            showToast('⛏️ Не повезло!', 2000);
        }
        updateUI();

        if (mineAutoRemaining > 0) {
            mineAutoRemaining--;
            const statusEl = $('mine-book-status');
            if (statusEl) statusEl.innerHTML = `🎁 АВТО-СПИН: осталось ${mineAutoRemaining + 1}...`;
            setTimeout(() => autoSpinMine(), 1300);
        } else if (mineAutoRemaining === 0 && minePersistGrid) {
            minePersistGrid = null;
            const statusEl = $('mine-book-status');
            if (statusEl) { statusEl.innerHTML = '✅ Серия завершена!'; setTimeout(() => { statusEl.style.display='none'; }, 2000); }
        }
    }, afterReveal);

    return afterReveal + 400;
}

// ══════ Генерация Minecraft pixel-art текстур через Canvas ══════
function setupMineTextures() {
    if (document.getElementById('mine-tex-style')) return;
    const S = 16;
    function rnd(x, y, s) { return (((x*73 + y*151 + s*257) * 2654435761) >>> 0) % 256; }
    function makeTex(fn) {
        const c = document.createElement('canvas');
        c.width = c.height = S;
        fn(c.getContext('2d'));
        return c.toDataURL('image/png');
    }

    // ── Булыжник (cobblestone) — classic Minecraft crack pattern ──
    function cobblestone(ctx, seed) {
        // Crack pixel positions (dark grout between stones)
        const CRACKS = new Set([
            // Horizontal line y=5 (full width)
            '0,5','1,5','2,5','3,5','4,5','5,5','6,5','7,5','8,5','9,5','10,5','11,5','12,5','13,5','14,5','15,5',
            // Horizontal line y=11 (full width)
            '0,11','1,11','2,11','3,11','4,11','5,11','6,11','7,11','8,11','9,11','10,11','11,11','12,11','13,11','14,11','15,11',
            // Vertical x=8 (y=0..4 top, y=6..10 mid)
            '8,0','8,1','8,2','8,3','8,4',
            '8,6','8,7','8,8','8,9','8,10',
            // Vertical x=4 (y=0..4 top, y=12..15 bottom)
            '4,0','4,1','4,2','4,3','4,4',
            '4,12','4,13','4,14','4,15',
            // Vertical x=12 (y=0..4 top, y=12..15 bottom)
            '12,0','12,1','12,2','12,3','12,4',
            '12,12','12,13','12,14','12,15',
            // Small vertical x=3 (y=6..10)
            '3,6','3,7','3,8','3,9','3,10',
            // Small vertical x=11 (y=6..10)
            '11,6','11,7','11,8','11,9','11,10',
        ]);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            if (CRACKS.has(`${x},${y}`)) {
                // Dark grout with slight variation
                const n = rnd(x, y, seed+1) % 12;
                const v = 36 + n * 2;
                ctx.fillStyle = `rgb(${v},${v},${v})`;
            } else {
                // Stone sections — noise-based grey
                const n = rnd(x, y, seed) % 48;
                const v = n < 4 ? 88 : n < 10 ? 168 : n < 20 ? 148 : 130;
                ctx.fillStyle = `rgb(${v},${v},${v})`;
            }
            ctx.fillRect(x, y, 1, 1);
        }
    }

    // ── Скрытый блок (тёмный, не раскрытый) ──
    function hiddenBlock(ctx) {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const n = rnd(x, y, 42) % 20;
            const v = n < 3 ? 24 : n < 8 ? 48 : 36;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 1, 1);
        }
        // Dark border lines
        ctx.fillStyle = '#1a1a1a';
        for (let i = 0; i < S; i++) { ctx.fillRect(i, 0, 1, 1); ctx.fillRect(i, S-1, 1, 1); ctx.fillRect(0, i, 1, 1); ctx.fillRect(S-1, i, 1, 1); }
    }

    // ── Руда: кобблестоун-база + яркие пиксельные кластеры ──
    function addOrePx(ctx, x, y, bright, dark) {
        // 3×3 pixel ore cluster (cross pattern)
        const p = (dx, dy, c) => { if (x+dx < S && y+dy < S && x+dx >= 0 && y+dy >= 0) { ctx.fillStyle = c; ctx.fillRect(x+dx, y+dy, 1, 1); } };
        p(1,0,bright); p(0,1,bright); p(1,1,bright); p(2,1,bright); p(1,2,bright);
        p(0,0,dark);   p(2,0,dark);   p(0,2,dark);   p(2,2,dark);
    }
    function oreTex(seed, bright, mid, dark) {
        return makeTex(ctx => {
            cobblestone(ctx, seed);
            // 8 ore clusters scattered across the 16×16 texture
            [[1,1],[6,2],[11,1],[13,7],[2,8],[7,7],[10,9],[4,12],[13,13],[1,13]].forEach(([x,y]) => addOrePx(ctx,x,y,bright,dark));
        });
    }

    // ── Обсидиан — тёмно-фиолетовый с текстурой ──
    function obsidianTex(ctx) {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const n = rnd(x, y, 55) % 32;
            const r = n<3?44:n<9?20:12, g = n<3?8:4, b = n<3?88:n<9?52:32;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, y, 1, 1);
        }
        // Purple shimmer clusters
        [[3,2],[9,1],[13,5],[5,9],[11,12],[2,13],[7,6],[14,10]].forEach(([x,y]) => {
            ctx.fillStyle = 'rgba(120,40,200,0.7)'; ctx.fillRect(x, y, 2, 2);
            ctx.fillStyle = 'rgba(160,80,255,0.5)'; ctx.fillRect(x+1, y+1, 1, 1);
        });
    }

    // ── Книга — тёмно-фиолетовая обложка с золотой рамкой ──
    function bookTex(ctx) {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const n = rnd(x, y, 77) % 16;
            ctx.fillStyle = n<3 ? `#4a0b90` : `#35076a`;
            ctx.fillRect(x, y, 1, 1);
        }
        ctx.fillStyle = '#C89000';
        for (let i=0;i<S;i++) { ctx.fillRect(i,0,1,1); ctx.fillRect(i,S-1,1,1); ctx.fillRect(0,i,1,1); ctx.fillRect(S-1,i,1,1); }
        ctx.fillStyle = '#FFD700';
        [[7,5],[8,5],[6,6],[9,6],[5,7],[10,7],[6,8],[9,8],[7,9],[8,9],[7,7],[8,7],[7,8],[8,8]].forEach(([x,y])=>ctx.fillRect(x,y,1,1));
    }

    // ── Сундук — рисуем через canvas (Minecraft-стиль) ──
    function chestTex(ctx, open) {
        const W = '#7a4a1a', LW = '#9a6228', DW = '#3a2008', PL = '#c08040';
        const GT = '#c89000', GL = '#ffe060', GD = '#886000';
        // Body planks
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const n = rnd(x, y, 100) % 24;
            // Plank grain lines
            const grain = (y % 4 === 0 || y % 4 === 3) ? DW : (n < 3 ? DW : n < 8 ? LW : W);
            ctx.fillStyle = grain;
            ctx.fillRect(x, y, 1, 1);
        }
        if (open) {
            // Top part: dark interior opening
            for (let y = 0; y < 7; y++) for (let x = 1; x < S-1; x++) {
                ctx.fillStyle = y < 4 ? '#0e0704' : '#1c0e06';
                ctx.fillRect(x, y, 1, 1);
            }
            // Interior hint pixels (items inside)
            ctx.fillStyle = '#2a1a08'; ctx.fillRect(2, 5, 2, 1); ctx.fillRect(8, 4, 3, 1); ctx.fillRect(13, 5, 1, 1);
        } else {
            // Latch: gold square in center
            [[5,6,GT],[6,6,GL],[7,6,GL],[8,6,GL],[9,6,GL],[10,6,GT],
             [5,7,GT],[6,7,GT],[7,7,GT],[8,7,GT],[9,7,GT],[10,7,GT],
             [5,8,GD],[6,8,GD],[7,8,GD],[8,8,GD],[9,8,GD],[10,8,GD]].forEach(([x,y,c]) => {
                ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
            });
            // Center latch button
            ctx.fillStyle = '#ffe060'; ctx.fillRect(7, 6, 2, 1);
            ctx.fillStyle = '#c89000'; ctx.fillRect(7, 8, 2, 1);
        }
        // Lid-body separator line
        ctx.fillStyle = DW;
        for (let x = 0; x < S; x++) ctx.fillRect(x, open ? 6 : 5, 1, 1);
        // Corner highlights
        ctx.fillStyle = PL;
        ctx.fillRect(0, 0, 1, S); ctx.fillRect(S-1, 0, 1, S);
        ctx.fillStyle = DW;
        ctx.fillRect(1, 0, 1, S); ctx.fillRect(S-2, 0, 1, S);
    }

    const T = {
        'hidden-blk':   makeTex(hiddenBlock),
        'stone-blk':    makeTex(ctx => cobblestone(ctx, 13)),
        'redstone-blk': oreTex(7,  '#FF3030', '#BB0000', '#660000'),
        'gold-blk':     oreTex(23, '#FFD700', '#CC9900', '#886600'),
        'diamond-blk':  oreTex(31, '#00EEFF', '#00AABB', '#004466'),
        'obsidian-blk': makeTex(obsidianTex),
        'tnt-blk': makeTex(ctx => {
            for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
                const st = Math.floor(y/4) % 2;
                const n  = rnd(x, y, 88) % 8;
                ctx.fillStyle = st ? (n<2 ? '#DD0000' : '#CC1010') : (n<2 ? '#DDDDDD' : '#C8C8C8');
                ctx.fillRect(x, y, 1, 1);
            }
        }),
        'book-blk': makeTex(bookTex),
    };

    // ── Сундуки — генерируем canvas-текстуры и вставляем в img ──
    const chestClosed = makeTex(ctx => chestTex(ctx, false));
    const chestOpen   = makeTex(ctx => chestTex(ctx, true));

    const st = document.createElement('style');
    st.id = 'mine-tex-style';
    st.textContent = Object.entries(T).map(([cls, url]) =>
        `.mc-blk.${cls} { background-image: url("${url}") !important; background-size: 100% 100% !important; background-color: transparent !important; }`
    ).join('\n')
    + `\n.mc-chest { background-image: url("${chestClosed}") !important; }`
    + `\n.mc-chest.open { background-image: url("${chestOpen}") !important; }`;
    document.head.appendChild(st);

    // Store chest URLs for JS use
    window._chestClosedUrl = chestClosed;
    window._chestOpenUrl   = chestOpen;
}

function initMineGrid() {
    setupMineTextures();
    initMineInventory();          // uses last known count (default 3)
    initMineShaft(false, true);   // idle preview: показать случайные руды
}

// Авто-спин
async function autoSpinMine() {
    if (mineIsSpinning) return;
    if (!user || user.balance < mineLastBet) {
        showToast('Недостаточно TON для авто-спина');
        mineAutoRemaining = 0; minePersistGrid = null;
        return;
    }
    const btn = $('mn-btn');
    initMineInventory();
    initMineShaft(false, true);   // keep blocks visible (colored) during API call
    mineIsSpinning = true;
    if (btn) btn.disabled = true;
    const balanceBefore = user ? (user.balance || 0) : 0;

    try {
        const resp = await fetch('/api/mine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, bet: mineLastBet, mode })
        });
        const data = await resp.json();
        if (!resp.ok) { mineIsSpinning = false; if (btn) btn.disabled = false; return; }
        user = data.user;
        // Update inventory with real pickaxe count from server
        initMineInventory(data.pickaxeCount, data.pickaxe);
        const totalTime = revealMineShaft(data.grid, data.blockWins, data.pickaxe, data.win, balanceBefore, data.chestMult);
        setTimeout(() => { mineIsSpinning = false; if (btn) btn.disabled = false; }, totalTime + 100);
    } catch(e) {
        mineIsSpinning = false; if (btn) btn.disabled = false;
    }
}

async function playMine() {
    if (!user) return showToast('Загрузка...');
    if (mineIsSpinning) return;
    if (maintenance.mine) return showToast('⚙️ Игра на техническом обслуживании');

    const betInput = $('mn-bet');
    const btn      = $('mn-btn');

    let betVal = parseFloat(betInput ? betInput.value : 0);
    if (!betVal || betVal < 0.1) { showToast('Мин. ставка 0.1 TON'); return; }
    if (betVal > 25) { betVal = 25; if (betInput) betInput.value = 25; }
    mineLastBet = betVal;

    mineBookCount  = 0;
    minePersistGrid = null;
    const statusEl = $('mine-book-status');
    if (statusEl) statusEl.style.display = 'none';

    mineIsSpinning = true;
    if (btn) btn.disabled = true;
    const balanceBefore = user ? (user.balance || 0) : 0;
    // Keep blocks visible (colored) during API loading — just reset chests/counter
    initMineInventory();
    initMineShaft(false, true);   // show colored ores while waiting for server

    try {
        const resp = await fetch('/api/mine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, bet: betVal, mode })
        });
        const data = await resp.json();
        if (!resp.ok) { showToast(data.error || 'Ошибка'); mineIsSpinning = false; if (btn) btn.disabled = false; return; }
        user = data.user;

        // Update inventory with real pickaxe count from server
        initMineInventory(data.pickaxeCount, data.pickaxe);
        const totalTime = revealMineShaft(data.grid, data.blockWins, data.pickaxe, data.win, balanceBefore, data.chestMult);
        setTimeout(() => { mineIsSpinning = false; if (btn) btn.disabled = false; }, totalTime + 100);

    } catch(e) {
        showToast('Ошибка соединения');
        mineIsSpinning = false;
        if (btn) btn.disabled = false;
    }
}

function showFreeSpinActivation(count) {
    const overlay = $('freespin-overlay');
    const countEl = $('freespin-overlay-count');
    if (!overlay) return;
    if (countEl) countEl.innerText = count;
    overlay.style.display = 'flex';
    // Закрыть через 2.5 секунды
    setTimeout(() => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.4s';
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.opacity = '1';
            overlay.style.transition = '';
        }, 400);
    }, 2100);
}

function startSpinAnim() {
    let frame = 0;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = $(`sc-${r}-${c}`);
            if (cell) { cell.className = 'spin-cell spinning'; cell.style.borderColor = '#333'; cell.style.boxShadow = ''; }
        }
    }
    spinAnimInterval = setInterval(() => {
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 5; c++) {
                const cell = $(`sc-${r}-${c}`);
                if (cell) {
                    const sym = SPIN_SYMS_ANIM[(frame + r + c * 3) % SPIN_SYMS_ANIM.length];
                    cell.innerText = sym === 'G' ? '🎁' : sym;
                }
            }
        }
        frame++;
    }, 100);
}

async function stopSpinAnim(grid, hiddenGs) {
    return new Promise(resolve => {
        setTimeout(() => {
            clearInterval(spinAnimInterval);
            spinAnimInterval = null;

            // Reveal result
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 5; c++) {
                    const cell = $(`sc-${r}-${c}`);
                    const sym = grid[r][c];
                    if (cell) {
                        cell.className = `spin-cell sym-${sym}`;
                        cell.style.borderColor = '';
                        cell.style.boxShadow = '';
                        cell.innerText = sym === 'G' ? '🎁' : sym;
                    }
                }
            }

            // Animate G symbols (gift reveal)
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 5; c++) {
                    if (grid[r][c] === 'G') {
                        const cell = $(`sc-${r}-${c}`);
                        if (cell) { cell.classList.add('gift-reveal'); setTimeout(() => cell.classList.remove('gift-reveal'), 600); }
                    }
                }
            }

            // Animate hidden G with glitch after 400ms
            if (hiddenGs && hiddenGs.length > 0) {
                setTimeout(() => {
                    hiddenGs.forEach(({ row, col }) => {
                        const cell = $(`sc-${row}-${col}`);
                        if (cell) {
                            cell.classList.add('hidden-g-anim');
                            cell.innerText = '🎁';
                            setTimeout(() => cell.classList.remove('hidden-g-anim'), 700);
                        }
                    });
                }, 350);
            }

            resolve();
        }, 1500);
    });
}

function highlightSpinWins(winLines, grid) {
    if (!winLines || !winLines.length) return;
    winLines.forEach(wl => {
        const line = SPIN_PAYLINES_FE[wl.lineIndex];
        if (!line) return;
        for (let col = 0; col < wl.count; col++) {
            const row = line[col];
            const cell = $(`sc-${row}-${col}`);
            if (cell) {
                cell.classList.add('win-cell');
                // X impact animation
                if (wl.symbol === 'X') {
                    cell.classList.add('x-impact');
                    setTimeout(() => cell.classList.remove('x-impact'), 450);
                }
                setTimeout(() => cell.classList.remove('win-cell'), 2000);
            }
        }
    });
}

async function playSpin() {
    if (spinIsSpinning) return;
    const isFreeSpins = spinFreeSpins > 0;

    if (!isFreeSpins) {
        const betVal = parseFloat($('sp-bet') ? $('sp-bet').value : 0);
        if (isNaN(betVal) || betVal <= 0) return showToast('Введите ставку');
        const bal = mode === 'demo' ? user.demo_balance : user.balance;
        if (betVal > bal) return showToast('Недостаточно средств');
        spinBet = betVal;
    }

    spinIsSpinning = true;
    const btn = $('sp-btn');
    if (btn) { btn.disabled = true; }

    const winDisp = $('spin-win-display');
    if (winDisp) winDisp.style.display = 'none';

    if (isFreeSpins) spinFreeSpins--;

    startSpinAnim();

    try {
        const r = await fetch('/api/spin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: user.id, bet: spinBet, mode,
                freeSpinsMode: isFreeSpins,
                currentMultiplier: spinFreeSpinsMult
            })
        });

        const data = await r.json();
        if (!r.ok) {
            clearInterval(spinAnimInterval);
            for (let ri = 0; ri < 3; ri++) for (let ci = 0; ci < 5; ci++) { const c = $(`sc-${ri}-${ci}`); if(c) { c.className='spin-cell sym-L'; c.innerText='L'; } }
            showToast(data.error || 'Ошибка');
            return;
        }

        user = data.user;

        await stopSpinAnim(data.grid, data.hiddenGs);

        // Show win
        if (data.win > 0) {
            if (winDisp) { winDisp.innerText = `+${data.win.toFixed(2)} TON`; winDisp.style.display = 'block'; }
            highlightSpinWins(data.winLines, data.grid);
            flyToBalance(data.win);
            showToast(`💰 +${data.win.toFixed(2)} TON!`);
        }

        // Progress bar
        updateSpinProgress(data.progressValue);

        // Bonus triggered
        if (data.bonusTriggered) {
            const bonusMult = Math.min(7, spinFreeSpinsMult * 2);
            spinFreeSpins += data.bonusSpins || 1;
            spinFreeSpinsMult = bonusMult;
            showToast(`🎁 БОНУС! +${data.bonusSpins || 1} фриспин! Множитель ×${spinFreeSpinsMult}!`, 4000);
        }

        // Free spins won from scatter G (max 8, нет ре-триггера во фриспинах)
        if (data.freeSpinsWon > 0 && !isFreeSpins) {
            spinFreeSpins = Math.min(8, spinFreeSpins + data.freeSpinsWon);
            spinFreeSpinsMult = 1;
            // Показываем оверлей активации по центру
            showFreeSpinActivation(spinFreeSpins);
        }

        // В режиме фриспинов: X на выигрышной линии = +1 к множителю (максимум +1 за спин)
        if (isFreeSpins) {
            const xBonus = data.xCountInGrid > 0 ? 1 : 0; // +1 только если есть X на линии, не на каждый X
            const newMult = Math.min(7, spinFreeSpinsMult + xBonus);
            if (xBonus > 0 && newMult > spinFreeSpinsMult) showToast(`⚡ Множитель ×${newMult}!`, 2000);
            spinFreeSpinsMult = newMult;
            if (data.gForExtraSpins > 0) { spinFreeSpins += data.gForExtraSpins; showToast(`🎁 +${data.gForExtraSpins} фриспин!`, 2000); }
        }

        updateSpinUI();
        updateUI();

    } catch(e) {
        clearInterval(spinAnimInterval);
        showToast('Ошибка соединения');
    } finally {
        spinIsSpinning = false;
        if (btn) {
            btn.disabled = false;
            updateSpinUI();
        }
    }
}
