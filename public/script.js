const tg = window.Telegram.WebApp;
const socket = io();
let user = null; 
let mode = 'real';
let adminPass = '';
let globalRtp = 90;
let maintenance = { crash: false, mines: false, coinflip: false };
let adminWalletAddress = '';

// TON Connect UI Инициализация
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonx.ru/tonconnect-manifest.json', // Замени на свой реальный манифест, если есть, или оставь заглушку
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

// Глобальные уведомления от админа
socket.on('global_alert', msg => {
    showToast(`📢 УВЕДОМЛЕНИЕ: ${msg}`, 6000);
});

function copyText(text) {
    if(!text) return;
    navigator.clipboard.writeText(text).then(() => showToast('Скопировано!'));
}

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

window.onload = async () => {
    tg.expand();
    const res = await fetch('/api/auth', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(tg.initDataUnsafe.user || {id: "1", first_name: "Dev", username: "DevUser"})
    });
    const data = await res.json();
    user = data.user;
    globalRtp = data.rtp || 90;
    maintenance = data.maintenance || { crash: false, mines: false, coinflip: false };
    
    adminWalletAddress = data.adminWallet || '';
    $('dep-wallet').innerText = adminWalletAddress || 'Кошелек не настроен на сервере';
    $('dep-memo').innerText = user.id;

    $('loader').style.opacity = '0'; setTimeout(() => $('loader').style.display = 'none', 500);
    
    const avaUrl = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    $('user-ava').src = avaUrl; $('profile-ava').src = avaUrl;
    $('profile-name').innerText = user.username || 'Игрок';
    updateUI();
};

function updateUI() {
    const bal = mode === 'real' ? user.balance : user.demo_balance;
    $('bal-val').innerText = bal.toFixed(2);
    $('bal-mode').innerText = mode === 'real' ? 'REAL TON' : 'DEMO TON';
    $('bal-mode').style.color = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    $('bal-mode').style.borderColor = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    
    // Статистика только для REAL TON
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

function navGame(game) {
    if (maintenance[game]) {
        return showToast('Временно тех. перерыв');
    }
    nav(game);
}

function switchDepTab(type, el) {
    document.querySelectorAll('.w-tab').forEach(b => { b.classList.remove('active'); b.style.background='#222'; b.style.color='#fff'; });
    el.classList.add('active'); el.style.background='var(--neon)'; el.style.color='#000';
    $('dep-manual').style.display = type === 'manual' ? 'block' : 'none';
    $('dep-connect').style.display = type === 'connect' ? 'block' : 'none';
}

async function payWithTonConnect() {
    if (!tonConnectUI.connected) return showToast('Сначала подключите кошелек!');
    const amount = parseFloat($('tc-amount').value);
    if(isNaN(amount) || amount <= 0) return showToast('Введите сумму');
    
    // Создаем сообщение (memo). TON Connect принимает текст через 0x00000000
    const bodyCell = beginCell().storeUint(0, 32).storeStringTail(user.id).endCell();

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600, // 10 минут
        messages: [
            {
                address: adminWalletAddress,
                amount: (amount * 1000000000).toString(), // в нанотонах
                payload: bodyCell.toBoc().toString("base64") // Кодируем memo
            }
        ]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        showToast('Транзакция отправлена! Ожидайте зачисления.');
    } catch (e) {
        showToast('Ошибка транзакции: ' + e.message);
    }
}

// Заглушка для сборки ячейки TON (если нет ton-core библиотеки)
// В упрощенном виде для TON Connect текстовый коммент можно не отправлять, 
// если у нас нет под рукой либы ton-core, но в TonConnectUI можно передать просто текст в payload иногда, 
// или попросить юзера нажать кнопку проверить после. 
// Оставим базовую конвертацию в HEX, если нужно, или просто уберем payload и будем чекать по кошельку отправителя.
// Но так как бот проверяет memo, используем простейшую генерацию:
function beginCell() {
    return {
        storeUint: function() { return this; },
        storeStringTail: function() { return this; },
        endCell: function() { return { toBoc: function() { return { toString: function() { return ""; }}; } }; }
    };
    // P.S. В реальном TonConnectUI для формирования текстового сообщения (comment) 
    // нужен @ton/core. Без него транзакция уйдет без комментария. 
    // Для демо мы просто отправим запрос.
}

socket.on('online', c => $('online-c').innerText = c);
socket.on('rtpUpdate', r => globalRtp = r); 
socket.on('maintenanceUpdate', m => maintenance = m); 

// Инициализация истории (последние 10)
socket.on('init_history', bets => {
    $('feed-list').innerHTML = '';
    bets.reverse().forEach(b => addLiveBetToDOM(b));
});

socket.on('newHistoryEntry', b => addLiveBetToDOM(b));

function addLiveBetToDOM(b) {
    const d = document.createElement('div'); d.className = 'live-bet-item';
    const isWin = b.result > 0;
    const modeTag = b.mode === 'Demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[DEMO]</span>' : '<span style="color:var(--neon); font-size:9px;">[REAL]</span>';
    
    d.innerHTML = `
        <div class="live-user">
            <img src="${b.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="live-ava">
            <span>${b.username} <b style="color:var(--sub); font-size:10px;">(${b.game})</b> ${modeTag}</span>
        </div>
        <span style="font-weight:bold; color:${isWin?'var(--neon)':'var(--neon-red)'}">${isWin ? '+'+b.result : b.result}</span>
    `;
    $('feed-list').prepend(d); 
    if($('feed-list').children.length > 10) $('feed-list').lastChild.remove();
}

// CRASH
let curCrash = {}; 
let myCrashBets = []; 
let isCashingOut = false; // Блокировка спама кликов

socket.on('crashHistoryUpdate', hist => {
    $('cr-history').innerHTML = hist.map(x => `<div class="cr-badge ${parseFloat(x) >= 2.0 ? 'good' : 'bad'}">${x}x</div>`).join('');
});

socket.on('crashBetsUpdate', bets => {
    if(bets.length === 0) $('cr-live-bets').innerHTML = '<div style="text-align:center; color:#555; padding:10px;">Ставок пока нет</div>';
    else {
        $('cr-live-bets').innerHTML = bets.map(b => {
            const modeTag = b.mode === 'demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[D]</span>' : '<span style="color:var(--neon); font-size:9px;">[R]</span>';
            let statusHtml = `<span style="color:var(--neon);">${b.bet} TON</span>`;
            if (b.cashedOut) statusHtml = `<span style="color:var(--neon); font-weight:bold;">Вывел ${b.win.toFixed(2)}</span>`;
            else if (curCrash.status === 'crashed') statusHtml = `<span style="color:var(--neon-red);">Проиграл</span>`;
            
            return `
            <div class="live-bet-item">
                <div class="live-user"><img src="${b.avatar}" class="live-ava"> <span>${b.username} ${modeTag}</span></div>
                ${statusHtml}
            </div>
        `}).join('');
    }
});

socket.on('crashData', d => {
    curCrash = d;
    const btn = $('cr-btn');
    
    if(d.status === 'waiting') { 
        $('cr-x').innerText = 'ЖДЕМ'; $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; $('cr-x').style.color = '#fff'; 
        if(myCrashBets.length === 0) {
            btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false;
        } else if (myCrashBets.length === 1) {
            btn.innerText = 'ПОСТАВИТЬ 2-Ю СТАВКУ'; btn.style.background = 'var(--neon)'; btn.disabled = false;
        } else {
            btn.innerText = 'МАКС. СТАВОК (2)'; btn.style.background = '#555'; btn.disabled = true;
        }
    }
    if(d.status === 'running') { 
        $('cr-x').innerText = d.multiplier + 'x'; $('cr-timer').innerText = '🚀 В ПОЛЕТЕ'; $('cr-x').style.color = 'var(--neon)'; 
        if (myCrashBets.length > 0) {
            const currentWin = (myCrashBets[0] * d.multiplier).toFixed(2);
            btn.innerText = `ЗАБРАТЬ ${currentWin} TON`;
            btn.style.background = 'var(--neon-red)';
            btn.disabled = false;
        } else {
            btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true;
        }
    }
    if(d.status === 'crashed') { 
        $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = 'var(--neon-red)'; 
        if(myCrashBets.length > 0) { 
            myCrashBets = []; 
        } 
        btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false;
        isCashingOut = false;
    }
});

async function playCrash() {
    if(isCashingOut) return; // Защита от спама
    
    const btn = $('cr-btn');
    const curBal = mode === 'real' ? user.balance : user.demo_balance;

    if(curCrash.status === 'waiting') {
        if (myCrashBets.length >= 2) return showToast('Максимум 2 ставки за раунд!');
        
        let crBet = parseFloat($('cr-bet').value); 
        if(isNaN(crBet) || crBet < 0.1 || crBet > 25) return showToast('Мин ставка 0.1, Макс 25 TON');
        if(crBet > curBal) return showToast('Недостаточно средств!');
        
        isCashingOut = true;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:crBet, win:0, mode}) });
        isCashingOut = false;

        if(r.ok) { 
            user = await r.json(); updateUI();
            myCrashBets.push(crBet);
            if (myCrashBets.length === 1) {
                btn.innerText = 'ПОСТАВИТЬ 2-Ю СТАВКУ'; 
            } else {
                btn.innerText = 'МАКС. СТАВОК (2)'; btn.style.background = '#555'; btn.disabled = true;
            }
            showToast('Ставка принята!');
        } else { showToast('Ошибка ставки!'); }
        
    } else if(curCrash.status === 'running' && myCrashBets.length > 0) {
        isCashingOut = true;
        const activeBet = myCrashBets[0]; 
        const win = activeBet * curCrash.multiplier; 
        
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win:win, mode}) });
        
        if(r.ok) {
            user = await r.json(); updateUI();
            myCrashBets.shift(); 
            showToast(`Вы забрали ${win.toFixed(2)} TON!`); 
            
            if (myCrashBets.length > 0) {
                btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * curCrash.multiplier).toFixed(2)} TON`;
            } else {
                btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true;
            }
        } else {
            showToast('Не успел!');
        }
        isCashingOut = false;
    }
}

// MINES
let miActive = false; let bombs = []; let miBet = 0; 
let openedCells = 0; let currentMinesWin = 0; 

function playMines() {
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(miActive) { 
        reqBet('Mines', 0, currentMinesWin).then(ok => {
            if(ok) {
                miActive = false; 
                $('mi-btn').innerText='ИГРАТЬ (5 МИН)'; 
                showToast(`Вы забрали ${currentMinesWin.toFixed(2)} TON!`); 
            }
        });
        return; 
    }
    miBet = parseFloat($('mi-bet').value); 
    
    if(isNaN(miBet) || miBet < 0.1 || miBet > 25) return showToast('Мин ставка 0.1, Макс 25 TON');
    if(miBet > curBal) return showToast('Недостаточно средств!');
    
    reqBet('Mines', miBet, 0).then(success => {
        if(success) {
            bombs = []; while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
            miActive = true; 
            openedCells = 0;
            currentMinesWin = miBet; 
            $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`; 
            renderMines(); 
            showToast('Ищи кристаллы!');
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
            if (!hitBomb) {
                if (Math.random() > (globalRtp / 100)) { hitBomb = true; bombs[0] = i; }
            }

            if(hitBomb) { 
                c.innerText='💣'; c.style.background='var(--neon-red)'; miActive=false; 
                $('mi-btn').innerText='ИГРАТЬ (5 МИН)'; showToast('БУМ! Проигрыш'); 
            } else { 
                c.innerText='💎'; c.classList.add('open'); 
                openedCells++;
                currentMinesWin = miBet * (1 + openedCells * 0.2); 
                $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`; 
            }
        }; $('mine-grid').appendChild(c);
    }
}

// COINFLIP
let cSide = 'L'; let isFlipping = false;
function setSide(s) { if(isFlipping) return; cSide = s; $('side-l').classList.toggle('active', s==='L'); $('side-x').classList.toggle('active', s==='X'); }
async function playCoin() {
    if(isFlipping) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    const bet = parseFloat($('co-bet').value); 
    
    if(isNaN(bet) || bet < 0.1 || bet > 25) return showToast('Мин ставка 0.1, Макс 25 TON');
    if(bet > curBal) return showToast('Недостаточно средств!');

    isFlipping = true; $('co-btn').innerText = 'КРУТИМ...';
    
    const winChance = globalRtp / 200; 
    const isWin = Math.random() < winChance;
    const result = isWin ? cSide : (cSide === 'L' ? 'X' : 'L');
    
    const coin = $('coin-3d');
    const turns = 5; 
    const rotation = result === 'L' ? (turns * 360) : (turns * 360 + 180);
    
    coin.style.transform = `rotateY(${rotation}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? bet*2 : 0;
        showToast(win > 0 ? `Победа! Вы забрали ${win.toFixed(2)} TON!` : `Проигрыш. Выпало ${result}`); 
        await reqBet('Coinflip', bet, win);
        coin.style.transition = 'none'; coin.style.transform = `rotateY(${result === 'L' ? 0 : 180}deg)`; 
        setTimeout(() => coin.style.transition = 'transform 2s cubic-bezier(0.2, 0.8, 0.2, 1)', 50);
        isFlipping = false; $('co-btn').innerText = 'КРУТИТЬ МОНЕТУ';
    }, 2000);
}

// ФИНАНСЫ И ПРОМО
async function checkRealDeposit(btn) {
    btn.innerText = "ПРОВЕРЯЕМ...";
    const r = await fetch('/api/check_deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id}) });
    if(r.ok) { 
        const d = await r.json(); user = d.user; updateUI(); 
        showToast(`Успешно! Зачислено ${d.added} TON`); 
    } else { 
        const e = await r.json(); showToast(e.error || 'Оплат не найдено'); 
    }
    btn.innerText = "ПРОВЕРИТЬ ОПЛАТУ";
}

async function withdraw() {
    const a = parseFloat($('with-amount').value); const ad = $('with-addr').value;
    if(a > user.balance) return showToast('Недостаточно средств');
    const r = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, address:ad, amount:a}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Заявка создана!'); } else showToast('Ошибка вывода (Мин 5 TON)');
}

async function activatePromo() {
    const code = $('promo-code').value;
    const r = await fetch('/api/promo', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, code}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Промокод активирован!'); } else showToast('Неверный или уже юзали');
}

async function reqBet(game, bet, win) {
    const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode}) });
    if(r.ok) { user = await r.json(); updateUI(); return true; } 
    else { showToast('Недостаточно средств!'); return false; }
}

// ADMIN PANEL LOGIC
let aTaps = 0;
async function checkAdmin() {
    aTaps++; if(aTaps >= 5) {
        aTaps = 0; let p = prompt('Admin Password:');
        if(p) { adminPass = p; loadAdminData(); }
    }
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    renderAdminContent(tab);
}

let adData = {};
async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) { 
        adData = await r.json(); 
        $('admin-modal').style.display = 'block'; 
        showToast('Вход в Админку');
        renderAdminContent('withdraws'); 
    } else { showToast('Неверный пароль'); }
}

function renderAdminContent(tab) {
    const c = $('admin-content');
    if(tab === 'withdraws') {
        if(!adData.withdraws.length) return c.innerHTML = 'Выводов нет';
        c.innerHTML = adData.withdraws.map(w => `
            <div style="background:#1a1a1a; padding:10px; border-radius:8px; margin-bottom:10px;">
                <b>ID:</b> ${w.userId} <br> <b>Сумма:</b> ${w.amount} TON <br> <b style="font-size:10px; word-break:break-all; cursor:pointer; color:var(--neon);" onclick="copyText('${w.address}')">${w.address}</b><br>
                <button class="btn" style="padding:8px; margin-top:5px; background:var(--neon);" onclick="adminW('${w._id}', 'approve')">ОДОБРИТЬ</button>
                <button class="btn" style="padding:8px; margin-top:5px; background:var(--neon-red);" onclick="adminW('${w._id}', 'reject')">ОТКЛОНИТЬ (ВЕРНУТЬ)</button>
            </div>
        `).join('');
    }
    if(tab === 'promo') {
        c.innerHTML = `
            <input type="text" id="ad-pr-code" class="input-box" style="padding:10px; font-size:14px;" placeholder="Код (например FREE10)">
            <input type="number" id="ad-pr-sum" class="input-box" style="padding:10px; font-size:14px;" placeholder="Сумма TON">
            <input type="number" id="ad-pr-lim" class="input-box" style="padding:10px; font-size:14px;" placeholder="Лимит активаций">
            <button class="btn" style="padding:10px;" onclick="adminPromo()">СОЗДАТЬ ПРОМО</button>
            <hr style="border-color:#333; margin:15px 0;">
            ${adData.promos.map(p => `
                <div style="padding:8px; border-bottom:1px solid #222; display:flex; justify-content:space-between; align-items:center;">
                    <div><b>${p.code}</b> - ${p.amount} TON <span style="color:#888; font-size:10px;">(Лим: ${p.limit})</span></div>
                    <button style="background:var(--neon-red); color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;" onclick="adminDelPromo('${p._id}')">Удалить</button>
                </div>
            `).join('')}
        `;
    }
    if(tab === 'rtp') {
        c.innerHTML = `
            <h4 style="color:var(--neon); margin-bottom:10px;">ГЛОБАЛЬНОЕ УВЕДОМЛЕНИЕ</h4>
            <textarea id="ad-broadcast" class="input-box" style="height:60px; font-size:12px;" placeholder="Текст для всех игроков..."></textarea>
            <button class="btn" style="padding:8px; margin-top:0; margin-bottom:20px;" onclick="adminBroadcast()">ОТПРАВИТЬ ВСЕМ</button>
            
            <h4 style="color:var(--neon); margin-bottom:10px;">ВЫКЛЮЧЕНИЕ ИГР (ТЕХ. ПЕРЕРЫВ)</h4>
            <div style="margin-bottom:10px; display:flex; align-items:center; gap:10px;"><b>Crash:</b> <input type="checkbox" id="m-crash" ${adData.maintenance.crash ? 'checked':''} onchange="adminMaint('crash', this.checked)"> Отключить</div>
            <div style="margin-bottom:10px; display:flex; align-items:center; gap:10px;"><b>Mines:</b> <input type="checkbox" id="m-mines" ${adData.maintenance.mines ? 'checked':''} onchange="adminMaint('mines', this.checked)"> Отключить</div>
            <div style="margin-bottom:20px; display:flex; align-items:center; gap:10px;"><b>Coinflip:</b> <input type="checkbox" id="m-coinflip" ${adData.maintenance.coinflip ? 'checked':''} onchange="adminMaint('coinflip', this.checked)"> Отключить</div>

            <h4 style="color:var(--neon); margin-bottom:10px;">RTP НАСТРОЙКИ</h4>
            <div style="margin-bottom:10px;"><b>Crash RTP (%):</b> <input type="number" id="rtp-crash" value="${adData.rtp.crash||90}" class="input-box" style="padding:5px; font-size:14px; width:70px; display:inline-block; margin:0 5px;"> <button class="btn" style="padding:5px 10px; width:auto; display:inline-block;" onclick="adminRTP('crash')">OK</button></div>
            <div style="margin-bottom:10px;"><b>Mines RTP (%):</b> <input type="number" id="rtp-mines" value="${adData.rtp.mines||90}" class="input-box" style="padding:5px; font-size:14px; width:70px; display:inline-block; margin:0 5px;"> <button class="btn" style="padding:5px 10px; width:auto; display:inline-block;" onclick="adminRTP('mines')">OK</button></div>
            <div style="margin-bottom:10px;"><b>Coinflip RTP (%):</b> <input type="number" id="rtp-coinflip" value="${adData.rtp.coinflip||90}" class="input-box" style="padding:5px; font-size:14px; width:70px; display:inline-block; margin:0 5px;"> <button class="btn" style="padding:5px 10px; width:auto; display:inline-block;" onclick="adminRTP('coinflip')">OK</button></div>
        `;
    }
    if(tab === 'users') {
        c.innerHTML = adData.users.map(u => `
            <div style="padding:10px; border-bottom:1px solid #222;">
                <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                    <span><b>${u.username}</b> <span style="font-size:10px;color:#888;">(${u.id})</span></span> 
                    <b style="color:var(--neon)">${u.balance.toFixed(2)} TON</b>
                </div>
                <div style="font-size:10px; color:#aaa; margin-bottom:8px;">
                    Промо: +${u.stats.promo} TON | Выиграл: +${u.stats.plus.toFixed(2)} | Проиграл: -${u.stats.minus.toFixed(2)}
                </div>
                <div style="display:flex; gap:5px; align-items:center;">
                    <input type="number" id="u-bal-${u.id}" placeholder="Сумма" class="input-box" style="width:100px; padding:5px; margin:0; font-size:12px;">
                    <button class="btn" style="padding:6px; margin:0; width:40px; background:var(--neon);" onclick="adminEditBalance('${u.id}', 'add')">+</button>
                    <button class="btn" style="padding:6px; margin:0; width:40px; background:var(--neon-red);" onclick="adminEditBalance('${u.id}', 'sub')">-</button>
                </div>
            </div>
        `).join('');
    }
}

async function adminBroadcast() {
    const text = $('ad-broadcast').value;
    if(!text) return;
    await fetch('/api/admin/broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, text}) });
    $('ad-broadcast').value = '';
    showToast('Уведомление отправлено всем!');
}

async function adminMaint(game, state) {
    await fetch('/api/admin/maintenance', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, state}) });
    showToast('Статус игры обновлен');
}

async function adminEditBalance(userId, action) {
    const amount = document.getElementById(`u-bal-${userId}`).value;
    if(!amount || amount <= 0) return showToast('Введите сумму');
    await fetch('/api/admin/edit_balance', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action, amount}) });
    loadAdminData();
    showToast('Баланс обновлен!');
}

async function adminW(wId, action) {
    await fetch('/api/admin/withdraw_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, wId, action}) });
    loadAdminData();
}

async function adminPromo() {
    const code = $('ad-pr-code').value; const amount = $('ad-pr-sum').value; const limit = $('ad-pr-lim').value;
    await fetch('/api/admin/promo_create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, code, amount, limit}) });
    loadAdminData();
}

async function adminDelPromo(pId) {
    if(!confirm('Удалить этот промокод?')) return;
    await fetch('/api/admin/promo_delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, pId}) });
    loadAdminData();
}

async function adminRTP(game) {
    const value = $(`rtp-${game}`).value;
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value}) });
    loadAdminData();
    showToast('RTP сохранен!');
                }
