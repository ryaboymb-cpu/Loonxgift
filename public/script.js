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
let rtpObj = { crash: 90, mines: 90, coinflip: 90 };
let maintenance = { crash: false, mines: false, coinflip: false, battle: false };
let adminWalletAddress = '';

// TON CONNECT
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json', 
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
    ['cr', 'mi', 'co'].forEach(prefix => {
        const el = $(`qb-${prefix === 'cr' ? 'crash' : prefix === 'mi' ? 'mines' : 'coinflip'}`);
        if(el) {
            el.innerHTML = vals.map(v => `<button type="button" onclick="setQuickBet('${prefix}-bet', ${v})" style="padding: 6px 12px; background: #222; border: 1px solid var(--neon); color: var(--neon); border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px;">${v}</button>`).join('');
        }
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
    rtpObj = data.rtp || { crash: 90, mines: 90, coinflip: 90 };
    maintenance = data.maintenance || { crash: false, mines: false, coinflip: false, battle: false };
    
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

    // ФИКС ИКОНКИ ПРОМО
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

// БЕЗОПАСНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ ИНТЕРФЕЙСА
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
}

function setQuickBet(inputId, amount) { if($(inputId)) $(inputId).value = amount; }

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
    const d = document.createElement('div'); d.className = 'live-bet-item';
    const isWin = b.result > 0;
    const modeTag = b.mode === 'Demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[DEMO]</span>' : '<span style="color:var(--neon); font-size:9px;">[REAL]</span>';
    const timeHtml = b.timeMsk ? `<span style="font-size:9px; color:#555; margin-left:5px;">${b.timeMsk}</span>` : '';
    const nameStr = b.username.includes('VS') ? `<span style="font-size:9px;">${b.username}</span>` : b.username;

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
let curCrash = {}; let myCrashBets = []; let isCashingOut = false; let isCrashBetting = false;

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
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:crBet, win:0, mode}) });
        isCrashBetting = false; btn.disabled = false;
        
        if(r.ok) { user = await r.json(); updateUI(); myCrashBets.push(crBet); btn.innerText = myCrashBets.length === 1 ? 'ПОСТАВИТЬ 2-Ю СТАВКУ' : 'МАКС. СТАВОК (2)'; if(myCrashBets.length===2) btn.disabled=true; showToast('Принято!'); } 
        else { showToast('Ошибка ставки!'); }
    } else if(curCrash.status === 'running' && myCrashBets.length > 0) {
        isCashingOut = true; const win = myCrashBets[0] * curCrash.multiplier; 
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win:win, mode}) });
        if(r.ok) { user = await r.json(); updateUI(); myCrashBets.shift(); showToast(`+ ${win.toFixed(2)} TON!`); if (myCrashBets.length > 0) btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * curCrash.multiplier).toFixed(2)} TON`; else { btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true; } } 
        else { showToast('Не успел!'); } isCashingOut = false;
    }
}

// MINES
let miActive = false; let bombs = []; let miBet = 0; let openedCells = 0; let currentMinesWin = 0; 
let isMinesProcessing = false; 

function playMines() {
    if(isMinesProcessing) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(miActive) { 
        isMinesProcessing = true;
        $('mi-btn').disabled = true;
        reqBet('Mines', 0, currentMinesWin).then(ok => { 
            isMinesProcessing = false;
            $('mi-btn').disabled = false;
            if(ok) { miActive = false; $('mi-btn').innerText='ИГРАТЬ'; showToast(`Забрал ${currentMinesWin.toFixed(2)} TON!`); renderMines(true); }
        }); 
        return; 
    }
    miBet = parseFloat($('mi-bet').value); 
    if(isNaN(miBet) || miBet < 0.1 || miBet > 25) return showToast('Мин 0.1, Макс 25 TON');
    if(miBet > curBal) return showToast('Нет средств!');
    
    isMinesProcessing = true; $('mi-btn').disabled = true;
    reqBet('Mines', miBet, 0).then(success => {
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
    
    // Подсветка
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
        await reqBet('Coinflip', bet, win);
        
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
        
        $('battle-timer').innerText = 'РУЛЕТКА КРУТИТСЯ!';
        
        setTimeout(() => {
            const winner = currentBattle.players.find(p => p.id === winnerId);
            $('battle-timer').innerText = `ПОБЕДИЛ: ${winner.username}!`;
            $('battle-timer').style.color = winner.color;
            showToast(`${winner.username} забирает куш!`);
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
        if(isMine && l.players.length === 1) actionBtn = `<button class="btn" style="background:var(--neon-red); padding:5px; font-size:12px;" onclick="cancelBattle('${l._id}')">ОТМЕНА</button>`;
        else actionBtn = `<button class="btn" style="background:var(--neon); color:#000; padding:5px 10px; font-size:12px; font-weight:bold;" onclick="openBattleGame('${l._id}')">${imIn ? 'СМОТРЕТЬ' : 'ВОЙТИ / СМОТРЕТЬ'}</button>`;

        const timeStr = new Date(l.createdAt).toLocaleTimeString("ru-RU", {timeZone:"Europe/Moscow", hour:"2-digit", minute:"2-digit"});
        
        return `
        <div style="background:#1a1a1a; border:1px solid ${isMine?'var(--neon)':'#333'}; padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${creator.avatar}" style="width:30px; border-radius:50%;">
                <div>
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
        if(!currentBattle || currentBattle.status !== 'waiting') return;
        
        if(currentBattle.players.length < 2) {
            $('battle-timer').innerText = 'ОЖИДАНИЕ ИГРОКОВ...';
            $('battle-timer').style.color = 'var(--sub)';
            setTimeout(updateTimer, 1000);
            return;
        }

        const endTime = currentBattle.timerEndTime ? new Date(currentBattle.timerEndTime).getTime() : (new Date(currentBattle.createdAt).getTime() + 120000);
        const left = Math.floor((endTime - Date.now()) / 1000);
        
        if(left > 0) {
            let m = Math.floor(left / 60); let s = left % 60;
            $('battle-timer').innerText = `СТАРТ ЧЕРЕЗ: 0${m}:${s<10?'0'+s:s}`;
            $('battle-timer').style.color = 'var(--neon)';
            setTimeout(updateTimer, 1000);
        } else $('battle-timer').innerText = 'ЗАПУСК...';
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
    const cw = canvas.width / 2;
    const ch = canvas.height / 2;
    
    ctx.clearRect(0,0, canvas.width, canvas.height);
    
    const totalPool = lobby.players.reduce((sum, p) => sum + p.bet, 0);
    let startAngle = 0;
    
    for (let p of lobby.players) {
        let sliceAngle = (p.bet / totalPool) * 2 * Math.PI;
        
        ctx.beginPath();
        ctx.moveTo(cw, ch);
        ctx.arc(cw, ch, cw - 5, startAngle, startAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#111';
        ctx.stroke();

        ctx.save();
        ctx.translate(cw, ch);
        ctx.rotate(startAngle + sliceAngle / 2);
        ctx.textAlign = "right";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px sans-serif";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        ctx.fillText(p.username, cw - 15, 4);
        ctx.restore();
        
        startAngle += sliceAngle;
    }
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

// БЕЗОПАСНАЯ ОТПРАВКА СТАВКИ
async function reqBet(game, bet, win) {
    try {
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode}) });
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
function switchAdminTab(tab) { document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active')); event.target.classList.add('active'); renderAdminContent(tab); }

let adData = {};
async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) { adData = await r.json(); $('admin-modal').style.display = 'flex'; renderAdminContent('withdraws'); } else showToast('Неверный пароль');
}

async function searchAdminUsers(query, filterType = currentAdminFilter) {
    adminSearchQuery = query;
    currentAdminFilter = filterType;
    const r = await fetch('/api/admin/search_user', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, query, filterType}) });
    if(r.ok) { const d = await r.json(); adData.users = d.users; renderAdminContent('users'); }
}

// ИСПРАВЛЕННЫЙ РЕНДЕР ИСТОРИИ И БАЛАНСА В АДМИНКЕ
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
    
    const c = $('admin-content');
    c.innerHTML = `
        <button onclick="renderAdminContent('users')" class="btn" style="margin-bottom:15px; background:#333; font-size:12px;">← НАЗАД К СПИСКУ</button>
        
        <div style="background:#1a1a1a; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid var(--neon);">
            <h3 style="color:var(--neon); margin-bottom:5px;">${u.username || 'Игрок'} (ID: ${u.id})</h3>
            <p style="font-size:14px; margin-bottom:5px;"><b>Текущий баланс:</b> <span style="color:var(--neon); font-weight:bold;">${u.balance.toFixed(2)} TON</span></p>
            <p style="font-size:14px; margin-bottom:15px; color:#888;">Заработано на реф: ${(u.refEarned || 0).toFixed(2)} TON</p>
            
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <input type="number" id="ad-bal-val" class="input-box" placeholder="Сумма TON" style="margin-bottom:0;">
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn" style="background:var(--neon); color:#000; font-size:12px;" onclick="adminChangeBal('${u.id}', 'add')">ВЫДАТЬ</button>
                <button class="btn" style="background:var(--neon-red); font-size:12px;" onclick="adminChangeBal('${u.id}', 'sub')">ЗАБРАТЬ</button>
            </div>
        </div>

        <h4 style="color:var(--neon-blue); margin-top:20px; margin-bottom:10px;">История ставок (Стр. ${page})</h4>
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
            <button class="btn" style="width:48%; background:#222; font-size:12px;" onclick="adminViewUser('${u.id}', ${page + 1})" ${hist.length < 10 ? 'disabled' : ''}>Вперед →</button>
        </div>
    `;
}

// ИСПРАВЛЕННЫЙ ОБРАБОТЧИК КНОПОК БАЛАНСА В АДМИНКЕ
async function adminChangeBal(userId, type) {
    const valInput = $('ad-bal-val');
    const amount = parseFloat(valInput.value);
    if(isNaN(amount) || amount <= 0) return showToast('Введите сумму');

    const r = await fetch('/api/admin/change_balance', { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({pass: adminPass, userId, amount, type}) 
    });

    if(r.ok) {
        showToast(type === 'add' ? 'Баланс пополнен' : 'Баланс списан');
        valInput.value = '';
        adminViewUser(userId, 1); 
    } else {
        const err = await r.json();
        showToast(err.error || 'Ошибка изменения');
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
            <h4 style="color:var(--neon);">РАССЫЛКА В БОТА (LoonxGift)</h4>
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
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">ОТКЛЮЧЕНИЕ ИГР (ТЕХ. РАБОТЫ)</h4>
            <label><input type="checkbox" ${adData.maintenance.crash ? 'checked' : ''} onchange="adminMaint('crash', this.checked)"> Crash</label><br>
            <label><input type="checkbox" ${adData.maintenance.mines ? 'checked' : ''} onchange="adminMaint('mines', this.checked)"> Mines</label><br>
            <label><input type="checkbox" ${adData.maintenance.coinflip ? 'checked' : ''} onchange="adminMaint('coinflip', this.checked)"> Coinflip</label><br>
            <label><input type="checkbox" ${adData.maintenance.battle ? 'checked' : ''} onchange="adminMaint('battle', this.checked)"> Battle Roulette</label><br>
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
