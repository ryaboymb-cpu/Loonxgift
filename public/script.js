// ФИКС ДЛЯ TON CONNECT (Подгружаем библиотеку TonWeb для отправки комментария)
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

window.onload = async () => {
    tg.expand();
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
    updateUI();
    renderWalletHistory();

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
    const bal = mode === 'real' ? user.balance : user.demo_balance;
    if($('bal-val')) $('bal-val').innerText = bal.toFixed(2);
    if($('bal-mode')) {
        $('bal-mode').innerText = mode === 'real' ? 'REAL TON' : 'DEMO TON';
        $('bal-mode').style.color = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
        $('bal-mode').style.borderColor = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    }
    
    if($('p-bets')) $('p-bets').innerText = user.stats.bets; 
    if($('p-wins')) $('p-wins').innerText = user.stats.wins;
    if($('p-plus')) $('p-plus').innerText = user.stats.plus.toFixed(2) + ' TON'; 
    if($('p-minus')) $('p-minus').innerText = user.stats.minus.toFixed(2) + ' TON';
}

function toggleMode() { mode = mode === 'real' ? 'demo' : 'real'; updateUI(); showToast(`Включен ${mode} режим`); }

function nav(pageId, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); 
    if($('page-'+pageId)) $('page-'+pageId).classList.add('active');
    if(el) { document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); el.classList.add('active'); }
}

function navGame(game) { 
    if (maintenance[game.toLowerCase()]) return showToast('Временно тех. перерыв'); 
    nav(game); 
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

// ПУНКТ 3: ИСТОРИЯ КОШЕЛЬКА (ДЕПЫ И ВЫВОДЫ)
function renderWalletHistory() {
    const wList = $('w-history-list');
    const dList = $('user-dep-history'); // Элемент должен быть в index.html
    
    if(wList) {
        if(!user.withdrawHistory || user.withdrawHistory.length === 0) wList.innerHTML = '<div style="color:#555; text-align:center;">Нет выводов</div>';
        else {
            wList.innerHTML = user.withdrawHistory.map(w => {
                let cls = w.status === 'Подтверждено' ? 'approved' : (w.status === 'Отклонено' ? 'rejected' : 'pending');
                let rsn = w.reason ? `<br><span style="color:var(--neon-red); font-size:10px;">Причина: ${w.reason}</span>` : '';
                return `
                    <div class="w-history-item ${cls}">
                        <div><img src="${user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:20px; border-radius:50%; vertical-align:middle; margin-right:5px;"> <b>${w.amount} TON</b><br><span style="color:#888; font-size:10px;">${w.time || ''}</span></div>
                        <div style="text-align:right;">${w.status} ${rsn}</div>
                    </div>`;
            }).join('');
        }
    }
    
    if(dList) {
        if(!user.depositHistory || user.depositHistory.length === 0) dList.innerHTML = '<div style="color:#555; text-align:center;">Нет депозитов</div>';
        else {
            dList.innerHTML = user.depositHistory.map(d => `
                <div class="w-history-item approved">
                    <div><b>+ ${d.amount} TON</b><br><span style="color:#888; font-size:10px;">${d.time || ''}</span></div>
                    <div style="text-align:right; color:var(--neon);">Успешно</div>
                </div>`).join('');
        }
    }
}

if($('online-c')) socket.on('online', c => $('online-c').innerText = c);
socket.on('rtpUpdate', r => rtpObj = r); 
socket.on('maintenanceUpdate', m => maintenance = m); 

// ПУНКТ 1: ИСТОРИЯ СТАВОК (Последние наверху)
socket.on('init_history', bets => { 
    if($('feed-list')) { $('feed-list').innerHTML = ''; bets.reverse().forEach(b => addLiveBetToDOM(b)); }
});
socket.on('newHistoryEntry', b => addLiveBetToDOM(b));

function addLiveBetToDOM(b) {
    const list = $('feed-list');
    if(!list) return;
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
    list.prepend(d); 
    if(list.children.length > 10) list.lastChild.remove();
}

// CRASH
let curCrash = {}; let myCrashBets = []; let isCashingOut = false;

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
    if(isCashingOut) return; const btn = $('cr-btn'); const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(curCrash.status === 'waiting') {
        if (myCrashBets.length >= 2) return showToast('Максимум 2 ставки!');
        let crBet = parseFloat($('cr-input').value); 
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

// MINES (Пункт 6: Фикс дабл-клика и подсветка)
let miActive = false; let bombs = []; let miBet = 0; let openedCells = 0; let currentMinesWin = 0; let isMinesCashingOut = false;

function playMines() {
    if(isMinesCashingOut) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    
    if(miActive) { 
        isMinesCashingOut = true;
        reqBet('Mines', 0, currentMinesWin).then(ok => { 
            isMinesCashingOut = false;
            if(ok) { 
                miActive = false; $('mi-btn').innerText='ИГРАТЬ'; showToast(`Забрал ${currentMinesWin.toFixed(2)} TON!`);
                revealMines(true); // Показываем поле, подсвечиваем собранное зеленым
            }
        }); 
        return; 
    }
    
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
    if(!$('mine-grid')) return;
    $('mine-grid').innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'm-cell'; c.dataset.idx = i;
        c.onclick = () => {
            if(!miActive || c.classList.contains('open') || isMinesCashingOut) return;
            let hitBomb = bombs.includes(i);
            if (!hitBomb) { if (Math.random() > ((rtpObj.mines||90) / 100)) { hitBomb = true; bombs[0] = i; } }

            if(hitBomb) { 
                miActive=false; $('mi-btn').innerText='ИГРАТЬ'; showToast('БУМ!'); 
                revealMines(false);
            } else { 
                c.innerText='💎'; c.classList.add('open'); c.style.borderColor='var(--neon)'; openedCells++;
                currentMinesWin = miBet * (1 + openedCells * 0.2); $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`; 
            }
        }; $('mine-grid').appendChild(c);
    }
}

function revealMines(isWin) {
    const cells = document.querySelectorAll('.m-cell');
    cells.forEach((cell, idx) => {
        if (bombs.includes(idx)) {
            cell.innerText = '💣'; cell.style.background = 'var(--neon-red)'; cell.style.borderColor = 'var(--neon-red)';
        } else {
            cell.innerText = '💎';
            if (isWin && cell.classList.contains('open')) {
                cell.style.background = 'rgba(0, 255, 136, 0.2)'; // Зеленая подсветка для выбранных
            }
        }
    });
}

// COINFLIP
let cSide = 'L'; let isFlipping = false;
function setSide(s) { if(isFlipping) return; cSide = s; $('side-l').classList.toggle('active', s==='L'); $('side-x').classList.toggle('active', s==='X'); }
async function playCoin() {
    if(isFlipping) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    const bet = parseFloat($('co-bet').value); 
    if(isNaN(bet) || bet < 0.1 || bet > 25) return showToast('Мин 0.1, Макс 25 TON');
    if(bet > curBal) return showToast('Недостаточно средств!');

    isFlipping = true; $('co-btn').innerText = 'КРУТИМ...';
    
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
            isFlipping = false; $('co-btn').innerText = 'КРУТИТЬ';
        }, 500);
    }, 2000);
}

// BATTLE ROULETTE (Пункт 4)
let activeLobbies = [];
let showMyLobbiesFirst = false;

socket.on('init_battles', lobbies => { activeLobbies = lobbies; renderBattleLobbies(); });
socket.on('battleUpdate', lobbies => { activeLobbies = lobbies; renderBattleLobbies(); });

socket.on('battleSpinStart', lobby => {
    $('br-lobbies').style.display = 'none';
    $('br-game-screen').style.display = 'block';
    $('br-status').innerText = 'РУЛЕТКА КРУТИТСЯ!';
    drawBattleWheel(lobby.players);
    
    const wheel = $('br-wheel');
    wheel.style.transition = 'transform 5s cubic-bezier(0.1, 0.7, 0.1, 1)';
    wheel.style.transform = `rotate(${360 * 5 + Math.random() * 360}deg)`;
});

socket.on('battleFinished', data => {
    $('br-status').innerText = `ПОБЕДИТЕЛЬ: ${data.winner.username} (+${data.winPool.toFixed(2)} TON)`;
    if (data.winner.userId === user.id) { showToast(`ТЫ ВЫИГРАЛ ${data.winPool.toFixed(2)} TON!`); updateUI(); }
    setTimeout(() => {
        $('br-game-screen').style.display = 'none';
        $('br-lobbies').style.display = 'block';
        $('br-wheel').style.transition = 'none';
        $('br-wheel').style.transform = 'rotate(0deg)';
    }, 5000);
});

function toggleBattleSort() {
    showMyLobbiesFirst = !showMyLobbiesFirst;
    renderBattleLobbies();
}

function renderBattleLobbies() {
    const cont = $('br-lobbies');
    if (!cont) return;
    
    let sorted = [...activeLobbies];
    if (showMyLobbiesFirst && user) {
        sorted.sort((a, b) => {
            const aMine = a.creatorId === user.id;
            const bMine = b.creatorId === user.id;
            return aMine === bMine ? 0 : aMine ? -1 : 1;
        });
    }

    if (sorted.length === 0) {
        cont.innerHTML = '<div style="text-align:center; color:#555;">Нет открытых лобби. Создай свое!</div>';
        return;
    }

    cont.innerHTML = sorted.map(l => {
        const isMine = l.creatorId === user.id;
        const totalPool = l.players.reduce((sum, p) => sum + p.bet, 0);
        let timeRemaining = 'Ожидание...';
        if (l.startTime) {
            const diff = Math.max(0, new Date(l.startTime) - new Date());
            timeRemaining = `Старт через ${Math.ceil(diff/1000)}с`;
        }

        return `
        <div class="card" style="margin-bottom:10px; border:1px solid ${isMine ? 'var(--neon)' : '#333'};">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <img src="${l.creatorAvatar}" style="width:30px; border-radius:50%;">
                    <div><b>${l.creatorName}</b><br><span style="font-size:10px; color:var(--sub);">${timeRemaining}</span></div>
                </div>
                <div style="text-align:right;">
                    <b style="color:var(--neon);">${totalPool} TON</b>
                    <div style="font-size:10px; color:#888;">Игроков: ${l.players.length}/4</div>
                </div>
            </div>
            <div style="margin-top:10px; font-size:11px; color:#aaa;">Лимиты: Мин ${l.minBet} TON | Макс ${l.maxLimit} TON</div>
            <div style="margin-top:10px; display:flex; gap:5px;">
                ${isMine && l.players.length === 1 ? `<button class="btn" style="background:var(--neon-red); padding:5px; font-size:12px;" onclick="deleteLobby('${l._id}')">Удалить</button>` : ''}
                ${!isMine && l.players.length < 4 ? `<button class="btn" style="padding:5px; font-size:12px;" onclick="joinLobbyPrompt('${l._id}', ${l.minBet}, ${l.maxLimit})">Присоединиться</button>` : ''}
                <button class="btn" style="background:#222; padding:5px; font-size:12px;" onclick="viewLobby('${l._id}')">Смотреть</button>
            </div>
        </div>`;
    }).join('');
}

async function createBattleLobby() {
    if (mode === 'demo') return showToast('Батл Рулетка только на REAL TON!');
    const amount = parseFloat(prompt('Сумма ставки (1 - 150 TON):'));
    if (!amount || amount < 1 || amount > 150) return showToast('Неверная сумма');
    const minBet = parseFloat(prompt('Минимальная ставка для оппонента (например: ' + (amount * 0.5) + '):'));
    const maxLimit = parseFloat(prompt('Максимальная ставка для оппонента (например: ' + (amount * 1.5) + '):'));
    
    if (!minBet || !maxLimit) return;
    
    const r = await fetch('/api/battle/create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, amount, minBet, maxLimit}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Лобби создано!'); } else { const err = await r.json(); showToast(err.error); }
}

async function joinLobbyPrompt(lobbyId, min, max) {
    if (mode === 'demo') return showToast('Батл Рулетка только на REAL TON!');
    const amount = parseFloat(prompt(`Введите сумму ставки (от ${min} до ${max} TON):`));
    if (!amount || amount < min || amount > max) return showToast('Сумма вне лимитов лобби');
    
    const r = await fetch('/api/battle/join', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, lobbyId, amount}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Вы присоединились!'); viewLobby(lobbyId); } else { const err = await r.json(); showToast(err.error); }
}

async function deleteLobby(lobbyId) {
    const r = await fetch('/api/battle/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, lobbyId}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Лобби удалено, TON возвращены'); }
}

function viewLobby(lobbyId) {
    const lobby = activeLobbies.find(l => l._id === lobbyId);
    if (!lobby) return;
    $('br-lobbies').style.display = 'none';
    $('br-game-screen').style.display = 'block';
    $('br-status').innerText = 'Ожидание игроков...';
    drawBattleWheel(lobby.players);
}

function drawBattleWheel(players) {
    const canvas = $('br-wheel');
    if (!canvas) return;
    const ctxW = canvas.getContext('2d');
    const total = players.reduce((sum, p) => sum + p.bet, 0);
    
    ctxW.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 140;

    let startAngle = 0;
    players.forEach(p => {
        const sliceAngle = (p.bet / total) * 2 * Math.PI;
        ctxW.beginPath();
        ctxW.moveTo(cx, cy);
        ctxW.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
        ctxW.fillStyle = p.color;
        ctxW.fill();
        ctxW.lineWidth = 2;
        ctxW.strokeStyle = '#111';
        ctxW.stroke();

        // Проценты
        const percent = ((p.bet / total) * 100).toFixed(0) + '%';
        const textAngle = startAngle + sliceAngle / 2;
        const tx = cx + Math.cos(textAngle) * (radius * 0.7);
        const ty = cy + Math.sin(textAngle) * (radius * 0.7);
        
        ctxW.fillStyle = p.color === '#ffffff' ? '#000' : '#fff';
        ctxW.font = "bold 14px sans-serif";
        ctxW.textAlign = "center";
        ctxW.textBaseline = "middle";
        ctxW.fillText(percent, tx, ty);

        startAngle += sliceAngle;
    });

    // Отрисовка таблицы под колесом
    const list = $('br-players-list') || document.createElement('div');
    list.id = 'br-players-list';
    list.style.marginTop = '15px';
    list.style.fontSize = '12px';
    
    list.innerHTML = players.map(p => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#1a1a1a; padding:8px; border-radius:8px; margin-bottom:5px; border-left:4px solid ${p.color};">
            <div style="display:flex; align-items:center; gap:8px;">
                <img src="${p.avatar}" style="width:24px; border-radius:50%;">
                <b>${p.username}</b>
            </div>
            <b style="color:var(--neon);">${p.bet} TON</b>
        </div>
    `).join('');
    
    if(!$('br-players-list')) $('br-game-screen').appendChild(list);
}

// ФИНАНСЫ И ПРОМО
async function checkRealDeposit(btn) {
    btn.innerText = "ПРОВЕРЯЕМ...";
    const r = await fetch('/api/check_deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id}) });
    if(r.ok) { const d = await r.json(); user = d.user; updateUI(); renderWalletHistory(); showToast(`+${d.added} TON`); } 
    else { const e = await r.json(); showToast(e.error || 'Не найдено'); } btn.innerText = "ПРОВЕРИТЬ ОПЛАТУ";
}

async function withdraw() {
    const a = parseFloat($('with-amount').value); 
    const ad = $('with-addr').value;
    
    if(!ad || !ad.trim()) return showToast('Введите адрес кошелька!');
    if(a > user.balance || a < 5) return showToast('Ошибка (Мин 5 TON)');
    
    const r = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, address:ad, amount:a}) });
    if(r.ok) { user = await r.json(); updateUI(); renderWalletHistory(); showToast('Заявка создана!'); $('with-amount').value=''; $('with-addr').value=''; } 
    else showToast('Ошибка вывода');
}

// ПУНКТ 7: ПРОМОКОДЫ - ТОЧНЫЕ АЛЕРТЫ
async function activatePromo() {
    const code = $('promo-code').value;
    const r = await fetch('/api/promo', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, code}) });
    if(r.ok) { 
        user = await r.json(); updateUI(); showToast('Успешно активирован!'); $('promo-code').value=''; 
    } else { 
        const e = await r.json(); showToast(e.error || 'Промокод уже был активирован'); 
    }
}

async function reqBet(game, bet, win) {
    const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode}) });
    if(r.ok) { user = await r.json(); updateUI(); return true; } else { showToast('Нет средств!'); return false; }
}

// ПУНКТ 2: АДМИН ПАНЕЛЬ
let aTaps = 0; let adminSearchQuery = ''; let currentFilter = 'all';
async function checkAdmin() { aTaps++; if(aTaps >= 5) { aTaps = 0; let p = prompt('Пароль:'); if(p) { adminPass = p; loadAdminData(); } } }
function switchAdminTab(tab) { document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active')); event.target.classList.add('active'); renderAdminContent(tab); }

let adData = {};
async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) { 
        adData = await r.json(); 
        $('admin-modal').style.display = 'flex'; 
        // Обновляем статистику в модалке
        if($('adm-total-dep')) $('adm-total-dep').innerText = adData.totalDeps.toFixed(2) + ' TON';
        if($('adm-total-with')) $('adm-total-with').innerText = adData.totalWiths.toFixed(2) + ' TON';
        if($('adm-u-count')) $('adm-u-count').innerText = adData.usersCount;
        renderAdminContent('withdraws'); 
    } else showToast('Неверный пароль');
}

async function searchAdminUsers(query) {
    adminSearchQuery = query;
    const r = await fetch('/api/admin/search_user', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, query, filterType: currentFilter}) });
    if(r.ok) { const d = await r.json(); adData.users = d.users; renderAdminContent('users'); }
}

function setAdminFilter(type) {
    currentFilter = type;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    searchAdminUsers(adminSearchQuery);
}

function renderAdminContent(tab) {
    const c = $('admin-content');
    $('admin-user-filters').style.display = tab === 'users' ? 'flex' : 'none';

    if(tab === 'withdraws') {
        c.innerHTML = adData.withdraws.map(w => `
            <div style="background:#1a1a1a; padding:10px; border-radius:8px; margin-bottom:10px;">
                <b>Игрок:</b> <a href="tg://user?id=${w.userId}" style="color:var(--neon);">${w.username}</a> <br>
                <b>Сумма:</b> ${w.amount} TON <br> <code>${w.address}</code><br>
                <button class="btn" style="padding:8px; margin-top:5px;" onclick="adminW('${w._id}', 'approve')">ОДОБРИТЬ</button>
                <button class="btn" style="padding:8px; margin-top:5px; background:var(--neon-red);" onclick="adminW('${w._id}', 'reject')">ОТКЛОНИТЬ (ВЕРНУТЬ)</button>
            </div>
        `).join('') || 'Нет заявок';
    }
    if(tab === 'promo') { 
        c.innerHTML = `
            <input type="text" id="ad-pr-code" class="input-box" style="padding:10px; font-size:14px;" placeholder="Код">
            <input type="number" id="ad-pr-sum" class="input-box" style="padding:10px; font-size:14px;" placeholder="Сумма TON">
            <input type="number" id="ad-pr-lim" class="input-box" style="padding:10px; font-size:14px;" placeholder="Лимит активаций">
            <button class="btn" style="padding:10px;" onclick="adminPromo()">СОЗДАТЬ ПРОМО</button><hr>
            ${adData.promos.map(p => `
                <div style="padding:8px; border-bottom:1px solid #222;">
                    <div><b>${p.code}</b> - ${p.amount} TON | Осталось: <span style="color:var(--neon)">${p.limit - p.usedBy.length}</span> из ${p.limit}</div>
                    <button style="background:#333; color:#fff; border:none; padding:4px 8px; border-radius:4px; margin-top:5px;" onclick="alert('Активации (ID):\\n' + ${JSON.stringify(p.usedBy).replace(/"/g, '')})">Кто юзал?</button>
                    <button style="background:var(--neon-red); color:#fff; border:none; padding:4px 8px; border-radius:4px; margin-top:5px;" onclick="adminDelPromo('${p._id}')">Удалить</button>
                </div>
            `).join('')}
        `;
    }
    if(tab === 'rtp') {
        c.innerHTML = `
            <h4 style="color:var(--neon);">РАССЫЛКА В БОТА</h4>
            <textarea id="ad-bot-msg" class="input-box" style="height:60px; font-size:12px;" placeholder="Сообщение ВСЕМ в бота..."></textarea>
            <button class="btn" style="padding:8px; margin-top:0; margin-bottom:20px; background:var(--neon-blue); color:#000;" onclick="adminBotBroadcast()">ОТПРАВИТЬ ВСЕМ</button>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">RTP</h4>
            <div><b>Crash RTP (%):</b> <input type="number" id="rtp-crash" value="${adData.rtp.crash||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('crash')">OK</button></div>
            <div><b>Mines RTP (%):</b> <input type="number" id="rtp-mines" value="${adData.rtp.mines||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('mines')">OK</button></div>
            <div><b>Coinflip RTP (%):</b> <input type="number" id="rtp-coinflip" value="${adData.rtp.coinflip||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('coinflip')">OK</button></div>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">ОТКЛЮЧЕНИЕ ИГР (Тех. Перерыв)</h4>
            <div><b>Crash:</b> <button onclick="adminMaint('crash', ${!maintenance.crash})">${maintenance.crash ? 'ВКЛЮЧИТЬ' : 'ОТКЛЮЧИТЬ'}</button></div> 
            <div><b>Mines:</b> <button onclick="adminMaint('mines', ${!maintenance.mines})">${maintenance.mines ? 'ВКЛЮЧИТЬ' : 'ОТКЛЮЧИТЬ'}</button></div>
let aTaps = 0; 
let adminSearchQuery = ''; 
let currentFilter = 'all';
let currentAdminTab = 'withdraws';

async function checkAdmin() { 
    aTaps++; 
    if(aTaps >= 5) { 
        aTaps = 0; 
        let p = prompt('Пароль:'); 
        if(p) { adminPass = p; loadAdminData(); } 
    } 
}

let adData = { users: [], withdraws: [], promos: [], rtp: {}, totalDeps: 0, totalWiths: 0, usersCount: 0 };

async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) { 
        adData = await r.json(); 
        $('admin-modal').style.display = 'flex'; 
        if($('adm-total-dep')) $('adm-total-dep').innerText = adData.totalDeps.toFixed(2) + ' TON';
        if($('adm-total-with')) $('adm-total-with').innerText = adData.totalWiths.toFixed(2) + ' TON';
        if($('adm-u-count')) $('adm-u-count').innerText = adData.usersCount;
        renderAdminContent(currentAdminTab); 
    } else showToast('Неверный пароль');
}

async function searchAdminUsers(query) {
    adminSearchQuery = query;
    const r = await fetch('/api/admin/search_user', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, query, filterType: currentFilter}) });
    if(r.ok) { 
        const d = await r.json(); 
        adData.users = d.users; 
        if(currentAdminTab === 'users') renderUsersList(); 
    }
}

function switchAdminTab(tab) { 
    currentAdminTab = tab;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active')); 
    if(event && event.target) event.target.classList.add('active');
    renderAdminContent(tab); 
}

function renderAdminContent(tab) {
    const c = $('admin-content');
async function adminBan(userId, doBan) {
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: doBan?'ban':'unban'}) }); 
    searchAdminUsers(adminSearchQuery);
}

async function adminMsgUser(userId) {
    let msg = prompt('Сообщение в ЛС от бота:'); if(!msg) return;
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: 'message', msg}) }); 
    showToast('Отправлено');
}

async function adminBotBroadcast() {
    const text = $('ad-bot-msg').value; if(!text) return;
    await fetch('/api/admin/bot_broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, text}) });
    $('ad-bot-msg').value = ''; showToast('Разослано!');
}

async function adminPromo() {
    const code = $('ad-pr-code').value; 
    const amount = $('ad-pr-sum').value; 
    const limit = $('ad-pr-lim').value;
    await fetch('/api/admin/promo_create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, code, amount, limit}) }); 
    loadAdminData();
}

async function adminDelPromo(pId) {
    if(!confirm('Удалить промокод?')) return;
    await fetch('/api/admin/promo_delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, pId}) }); 
    loadAdminData();
}

async function adminRTP(game) {
    const value = $(`rtp-${game}`).value;
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value}) }); 
    showToast('RTP сохранен');
}

async function adminMaint(game, state) {
    await fetch('/api/admin/maintenance', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, state}) }); 
    loadAdminData();
}
let aTaps = 0; 
let adminSearchQuery = ''; 
let currentFilter = 'all';
let currentAdminTab = 'withdraws';

async function checkAdmin() { 
    aTaps++; 
    if(aTaps >= 5) { 
        aTaps = 0; 
        let p = prompt('Пароль:'); 
        if(p) { adminPass = p; loadAdminData(); } 
    } 
}

let adData = { users: [], withdraws: [], promos: [], rtp: {}, totalDeps: 0, totalWiths: 0, usersCount: 0 };

async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) { 
        adData = await r.json(); 
        $('admin-modal').style.display = 'flex'; 
        if($('adm-total-dep')) $('adm-total-dep').innerText = adData.totalDeps.toFixed(2) + ' TON';
        if($('adm-total-with')) $('adm-total-with').innerText = adData.totalWiths.toFixed(2) + ' TON';
        if($('adm-u-count')) $('adm-u-count').innerText = adData.usersCount;
        renderAdminContent(currentAdminTab); 
    } else showToast('Неверный пароль');
}

async function searchAdminUsers(query) {
    adminSearchQuery = query;
    const r = await fetch('/api/admin/search_user', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, query, filterType: currentFilter}) });
    if(r.ok) { 
        const d = await r.json(); 
        adData.users = d.users; 
        if(currentAdminTab === 'users') renderUsersList(); 
    }
}

function switchAdminTab(tab) { 
    currentAdminTab = tab;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active')); 
    if(event && event.target) event.target.classList.add('active');
    renderAdminContent(tab); 
}

function renderAdminContent(tab) {
    const c = $('admin-content');
    if(!c) return;
    if($('admin-user-filters')) $('admin-user-filters').style.display = tab === 'users' ? 'flex' : 'none';

    if(tab === 'withdraws') {
        c.innerHTML = adData.withdraws.map(w => `
            <div style="background:#1a1a1a; padding:12px; border-radius:10px; margin-bottom:10px; border-left:3px solid var(--neon);">
                <div style="display:flex; justify-content:space-between;"><b>${w.username}</b><span style="color:var(--neon);">${w.amount} TON</span></div>
                <code style="font-size:10px; color:#888;">${w.address}</code>
                <div style="display:flex; gap:5px; margin-top:8px;">
                    <button class="btn" style="padding:6px; font-size:12px;" onclick="adminW('${w._id}', 'approve')">ОДОБРИТЬ</button>
                    <button class="btn" style="padding:6px; font-size:12px; background:var(--neon-red);" onclick="adminW('${w._id}', 'reject')">ОТКЛОНИТЬ</button>
                </div>
            </div>`).join('') || '<div style="text-align:center; padding:20px; color:#555;">Нет заявок</div>';
    }
    if(tab === 'users') {
        c.innerHTML = `
            <input type="text" class="input-box" placeholder="Поиск (ID / Юзер)..." value="${adminSearchQuery}" oninput="searchAdminUsers(this.value)">
            <div id="admin-users-list-container" style="margin-top:10px;"></div>`;
        renderUsersList();
    }
    if(tab === 'promo') {
        c.innerHTML = `
            <div class="card" style="padding:10px; margin-bottom:15px;">
                <input type="text" id="ad-pr-code" class="input-box" placeholder="Код">
                <input type="number" id="ad-pr-sum" class="input-box" placeholder="Сумма TON">
                <input type="number" id="ad-pr-lim" class="input-box" placeholder="Лимит">
                <button class="btn" onclick="adminPromo()">СОЗДАТЬ</button>
            </div>
            ${adData.promos.map(p => `
                <div style="padding:10px; background:#1a1a1a; margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; border-radius:8px;">
                    <div><b>${p.code}</b> (${p.amount}T)</div>
                    <button class="btn" style="width:auto; padding:5px 10px; background:var(--neon-red);" onclick="adminDelPromo('${p._id}')">Удалить</button>
                </div>`).join('')}`;
    }
    if(tab === 'rtp') {
        c.innerHTML = `
            <textarea id="ad-bot-msg" class="input-box" style="height:60px;" placeholder="Сообщение для рассылки..."></textarea>
            <button class="btn" onclick="adminBotBroadcast()">ОТПРАВИТЬ ВСЕМ</button><hr>
            ${['crash', 'mines', 'coinflip'].map(g => `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; background:#1a1a1a; padding:8px; border-radius:8px;">
                    <span style="text-transform:capitalize;">${g}:</span>
                    <div style="display:flex; gap:5px;">
                        <input type="number" id="rtp-${g}" value="${adData.rtp[g]||90}" class="input-box" style="width:60px; margin:0;">
                        <button class="btn" style="width:auto; padding:5px 10px;" onclick="adminRTP('${g}')">OK</button>
                    </div>
                </div>`).join('')}
            <hr>
            <div style="margin-top:15px;">
                ${['crash', 'mines', 'coinflip', 'battle'].map(g => `
                    <button class="btn" style="margin-bottom:5px; background:${maintenance[g] ? 'var(--neon)' : '#333'}" onclick="adminMaint('${g}', ${!maintenance[g]})">
                        ${g.toUpperCase()}: ${maintenance[g] ? 'ВКЛЮЧИТЬ' : 'ОТКЛЮЧИТЬ'}
                    </button>`).join('')}
            </div>`;
    }
}

function renderUsersList() {
    const container = $('admin-users-list-container');
    if(!container) return;
    container.innerHTML = adData.users.map(u => `
        <div style="padding:10px; background:#1a1a1a; border-radius:10px; margin-bottom:8px; border-left:3px solid ${u.isBlocked ? 'red' : 'var(--neon-blue)'};">
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${u.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:35px; border-radius:50%;">
                <div style="flex-grow:1;">
                    <div style="font-weight:bold;">${u.username}</div>
                    <div style="font-size:12px; color:var(--neon);">${u.balance.toFixed(2)} TON</div>
                </div>
            </div>
            <div style="margin-top:10px; display:flex; gap:5px;">
                <button class="btn" style="padding:6px; font-size:11px; background:var(--neon-blue); color:#000;" onclick="adminMsgUser('${u.id}')">МЕССЕДЖ</button>
                <button class="btn" style="padding:6px; font-size:11px; background:${u.isBlocked ? 'var(--neon)' : 'var(--neon-red)'};" onclick="adminBan('${u.id}', ${!u.isBlocked})">
                    ${u.isBlocked ? 'РАЗБАН' : 'БАН'}
                </button>
            </div>
        </div>`).join('') || '<div style="text-align:center; padding:10px; color:#555;">Ничего не найдено</div>';
}

async function adminW(wId, action) {
    let reason = ''; if(action === 'reject') reason = prompt('Причина отклонения:') || 'Нарушение правил';
    await fetch('/api/admin/withdraw_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, wId, action, reason}) }); 
    loadAdminData();
}

async function adminBan(userId, doBan) {
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: doBan?'ban':'unban'}) }); 
    searchAdminUsers(adminSearchQuery);
}

async function adminMsgUser(userId) {
    let msg = prompt('Сообщение в ЛС от бота:'); if(!msg) return;
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: 'message', msg}) }); 
    showToast('Отправлено');
}

async function adminBotBroadcast() {
    const text = $('ad-bot-msg').value; if(!text) return;
    await fetch('/api/admin/bot_broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, text}) });
    $('ad-bot-msg').value = ''; showToast('Разослано!');
}

async function adminPromo() {
    const code = $('ad-pr-code').value; 
    const amount = $('ad-pr-sum').value; 
    const limit = $('ad-pr-lim').value;
    await fetch('/api/admin/promo_create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, code, amount, limit}) }); 
    loadAdminData();
}

async function adminDelPromo(pId) {
    if(!confirm('Удалить промокод?')) return;
    await fetch('/api/admin/promo_delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, pId}) }); 
    loadAdminData();
}

async function adminRTP(game) {
    const value = $(`rtp-${game}`).value;
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value}) }); 
    showToast('RTP сохранен');
}

async function adminMaint(game, state) {
    await fetch('/api/admin/maintenance', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, state}) }); 
    loadAdminData();
}
}; 
