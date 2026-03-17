const tg = window.Telegram.WebApp;
const socket = io();
let user = null; let mode = 'real';
let adminPass = '';
let globalRtp = 90;
let gameStatuses = { crash: 1, mines: 1, coinflip: 1 };
let isReqPending = false; // Анти-абуз блокировка кликов
let tonConnectUI = null;

const $ = id => document.getElementById(id);

function showToast(msg) {
    const container = $('toast-container');
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

// Инициализация TON Connect
setTimeout(() => {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
        buttonRootId: 'ton-connect'
    });
}, 500);

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
    if (data.statuses) gameStatuses = data.statuses;
    
    $('dep-wallet').innerText = data.adminWallet || 'Кошелек не настроен на сервере';
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
    
    $('p-bets').innerText = user.stats.bets; $('p-wins').innerText = user.stats.wins;
    $('p-plus').innerText = user.stats.plus.toFixed(2) + ' TON'; $('p-minus').innerText = user.stats.minus.toFixed(2) + ' TON';
}
function toggleMode() { mode = mode === 'real' ? 'demo' : 'real'; updateUI(); showToast(`Включен ${mode} режим`); }

function nav(pageId, el) {
    // Проверка тех. перерыва
    const keyMap = {crash: 'crash', mines: 'mines', coin: 'coinflip'};
    if (keyMap[pageId] && gameStatuses[keyMap[pageId]] === 0) {
        return showToast('Временно тех. перерыв!');
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); $('page-'+pageId).classList.add('active');
    if(el) { document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); el.classList.add('active'); }
}

function playBattleRullet() {
    showToast('Игра в разработке и скоро будет добавлена!');
}

socket.on('online', c => $('online-c').innerText = c);
socket.on('rtpUpdate', r => globalRtp = r); 
socket.on('statusUpdate', s => gameStatuses = s); 

// Уведомление от админа
socket.on('notification', msg => {
    $('notification-text').innerText = msg;
    $('notification-modal').style.display = 'flex';
});

// Инициализация ленты (при заходе)
socket.on('init_feed', feed => {
    $('feed-list').innerHTML = '';
    feed.forEach(renderFeedItem);
});

// Новая ставка в ленте (только завершенные)
socket.on('newLiveBet', b => {
    renderFeedItem(b, true);
});

function renderFeedItem(b, prepend = false) {
    const isWin = b.type === 'win';
    const color = isWin ? 'var(--neon)' : 'var(--neon-red)';
    const modeBadge = b.mode === 'Real' 
        ? `<span style="background:rgba(0,152,234,0.2); color:#0098EA; padding:2px 4px; border-radius:4px; font-size:8px; margin-left:5px;">REAL</span>`
        : `<span style="background:rgba(255,255,255,0.1); color:#aaa; padding:2px 4px; border-radius:4px; font-size:8px; margin-left:5px;">DEMO</span>`;
        
    const d = document.createElement('div'); d.className = 'live-bet-item';
    d.innerHTML = `
        <div class="live-user">
            <img src="${b.avatar}" class="live-ava">
            <span style="display:flex; align-items:center;">
                ${b.username} <b style="color:var(--sub); font-size:10px; margin-left:5px;">(${b.game})</b>
                ${modeBadge}
            </span>
        </div>
        <span style="font-weight:bold; color:${color}">${b.amount}</span>
    `;
    if (prepend) {
        $('feed-list').prepend(d); 
        if($('feed-list').children.length > 15) $('feed-list').lastChild.remove();
    } else {
        $('feed-list').appendChild(d);
    }
}

// CRASH
let curCrash = {}; 
let myCrashBets = []; 

socket.on('crashHistoryUpdate', hist => {
    $('cr-history').innerHTML = hist.map(x => `<div class="cr-badge ${parseFloat(x) >= 2.0 ? 'good' : 'bad'}">${x}x</div>`).join('');
});

socket.on('crashBetsUpdate', bets => {
    if(bets.length === 0) $('cr-live-bets').innerHTML = '<div style="text-align:center; color:#555; padding:10px;">Ставок пока нет</div>';
    else {
        $('cr-live-bets').innerHTML = bets.map(b => `
            <div class="live-bet-item">
                <div class="live-user"><img src="${b.avatar}" class="live-ava"> <span>${b.username} <span style="font-size:8px; color:#888;">${b.mode==='Real'?'REAL':'DEMO'}</span></span></div>
                <span style="color:${b.cashedOut ? 'var(--neon)' : (curCrash.status === 'crashed' ? 'var(--neon-red)' : 'var(--sub)')}; font-weight:bold;">
                    ${b.cashedOut ? `Забрал: ${b.cashoutMult}x` : (curCrash.status === 'crashed' ? 'Разбился' : `${b.bet} TON`)}
                </span>
            </div>
        `).join('');
    }
});

socket.on('crashData', d => {
    curCrash = d;
    const btn = $('cr-btn');
    
    if(d.status === 'waiting') { 
        $('cr-x').innerText = 'ЖДЕМ'; $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; $('cr-x').style.color = '#fff'; 
        if(myCrashBets.length === 0) {
            btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)';
        } else if (myCrashBets.length === 1) {
            btn.innerText = 'ПОСТАВИТЬ 2-Ю СТАВКУ'; btn.style.background = 'var(--neon)';
        } else {
            btn.innerText = 'МАКС. СТАВОК (2)'; btn.style.background = '#555';
        }
    }
    if(d.status === 'running') { 
        $('cr-x').innerText = d.multiplier + 'x'; $('cr-timer').innerText = '🚀 В ПОЛЕТЕ'; $('cr-x').style.color = 'var(--neon)'; 
        if (myCrashBets.length > 0) {
            const currentWin = (myCrashBets[0] * d.multiplier).toFixed(2);
            btn.innerText = `ЗАБРАТЬ ${currentWin} TON`;
            btn.style.background = 'var(--neon-red)';
        } else {
            btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555';
        }
    }
    if(d.status === 'crashed') { 
        $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = 'var(--neon-red)'; 
        if(myCrashBets.length > 0) { 
            myCrashBets = []; 
        } 
        btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)';
    }
});

async function playCrash() {
    if(isReqPending) return;
    const btn = $('cr-btn');
    const curBal = mode === 'real' ? user.balance : user.demo_balance;

    if(curCrash.status === 'waiting') {
        if (myCrashBets.length >= 2) return showToast('Максимум 2 ставки за раунд!');
        let crBet = parseFloat($('cr-bet').value); 
        if(isNaN(crBet) || crBet < 0.1 || crBet > 25) return showToast('Мин ставка 0.1, Макс 25 TON');
        if(crBet > curBal) return showToast('Недостаточно средств!');
        
        isReqPending = true;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:crBet, win:0, mode}) });
        isReqPending = false;
        
        if(r.ok) { 
            user = await r.json(); updateUI();
            myCrashBets.push(crBet);
            if (myCrashBets.length === 1) {
                btn.innerText = 'ПОСТАВИТЬ 2-Ю СТАВКУ'; 
            } else {
                btn.innerText = 'МАКС. СТАВОК (2)'; btn.style.background = '#555';
            }
            showToast('Ставка принята!');
        } else { const e = await r.json(); showToast(e.error || 'Ошибка ставки!'); }
        
    } else if(curCrash.status === 'running' && myCrashBets.length > 0) {
        const activeBet = myCrashBets[0]; 
        const win = activeBet * curCrash.multiplier; 
        
        isReqPending = true;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win:win, mode}) });
        isReqPending = false;
        
        if(r.ok) {
            user = await r.json(); updateUI();
            myCrashBets.shift(); 
            showToast(`Вы забрали ${win.toFixed(2)} TON!`); 
            
            if (myCrashBets.length > 0) {
                btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * curCrash.multiplier).toFixed(2)} TON`;
            } else {
                btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555';
            }
        } else {
            const e = await r.json(); showToast(e.error || 'Ошибка вывода!');
        }
    }
}

// MINES
let miActive = false; let bombs = []; let miBet = 0; 
let openedCells = 0; let currentMinesWin = 0; 

function playMines() {
    if(isReqPending) return;
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
            if(!miActive || c.classList.contains('open') || isReqPending) return;
            
            let hitBomb = bombs.includes(i);
            if (!hitBomb) {
                if (Math.random() > (globalRtp / 100)) { hitBomb = true; bombs[0] = i; }
            }

            if(hitBomb) { 
                c.innerText='💣'; c.style.background='var(--neon-red)'; miActive=false; 
                $('mi-btn').innerText='ИГРАТЬ (5 МИН)'; 
                showToast('БУМ! Проигрыш');
                reqBet('Mines', miBet, -1); // Отправляем -1 для записи луза в ленту
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
    if(isFlipping || isReqPending) return;
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
function switchPay(method) {
    if(method === 'tc') {
        $('pay-tc-block').style.display = 'block';
        $('pay-transfer-block').style.display = 'none';
        $('btn-pay-tc').style.background = 'var(--neon)'; $('btn-pay-tc').style.color = '#000';
        $('btn-pay-transfer').style.background = '#222'; $('btn-pay-transfer').style.color = '#fff';
    } else {
        $('pay-transfer-block').style.display = 'block';
        $('pay-tc-block').style.display = 'none';
        $('btn-pay-transfer').style.background = 'var(--neon)'; $('btn-pay-transfer').style.color = '#000';
        $('btn-pay-tc').style.background = '#222'; $('btn-pay-tc').style.color = '#fff';
    }
}

async function sendTonConnect() {
    if (!tonConnectUI || !tonConnectUI.connected) return showToast("Сначала подключите кошелек кнопкой выше!");
    const amount = parseFloat($('tc-amount').value);
    if(isNaN(amount) || amount <= 0) return showToast("Введите корректную сумму");

    try {
        const tonweb = new window.TonWeb();
        const cell = new tonweb.boc.Cell();
        cell.bits.writeUint(0, 32);
        cell.bits.writeString(user.id.toString()); // Комментарий
        const payload = tonweb.utils.bytesToBase64(await cell.toBoc());

        const adminWallet = $('dep-wallet').innerText;

        const tx = {
            validUntil: Math.floor(Date.now() / 1000) + 300,
            messages: [
                { address: adminWallet, amount: (amount * 1000000000).toString(), payload: payload }
            ]
        };

        await tonConnectUI.sendTransaction(tx);
        showToast("Транзакция отправлена! Жмите 'Проверить оплату' через минуту.");
    } catch(e) {
        console.error(e);
        showToast("Отмена или ошибка транзакции.");
    }
}

async function checkRealDeposit() {
    const btn = event.target;
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
    isReqPending = true;
    const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode}) });
    isReqPending = false;
    if(r.ok) { user = await r.json(); updateUI(); return true; } 
    else { const e = await r.json(); showToast(e.error || 'Ошибка!'); return false; }
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
            <div style="margin-bottom:10px;"><b>Crash RTP (%):</b> <input type="number" id="rtp-crash" value="${adData.rtp.crash||90}" class="input-box" style="padding:5px; font-size:14px; width:70px; display:inline-block; margin:0 5px;"> <button class="btn" style="padding:5px 10px; width:auto; display:inline-block;" onclick="adminRTP('crash')">OK</button></div>
            <div style="margin-bottom:10px;"><b>Mines RTP (%):</b> <input type="number" id="rtp-mines" value="${adData.rtp.mines||90}" class="input-box" style="padding:5px; font-size:14px; width:70px; display:inline-block; margin:0 5px;"> <button class="btn" style="padding:5px 10px; width:auto; display:inline-block;" onclick="adminRTP('mines')">OK</button></div>
            <div style="margin-bottom:10px;"><b>Coinflip RTP (%):</b> <input type="number" id="rtp-coinflip" value="${adData.rtp.coinflip||90}" class="input-box" style="padding:5px; font-size:14px; width:70px; display:inline-block; margin:0 5px;"> <button class="btn" style="padding:5px 10px; width:auto; display:inline-block;" onclick="adminRTP('coinflip')">OK</button></div>
            
            <hr style="border-color:#333; margin:15px 0;">
            <h3 style="color:var(--neon); margin-bottom:10px;">Статус игр (Вкл/Выкл)</h3>
            <div style="display:flex; justify-content:space-between; margin-bottom:10px; align-items:center;"><b>Crash:</b> <button class="btn" style="width:auto; margin:0; padding:5px 10px; background:${adData.statuses.crash ? 'var(--neon)' : 'var(--neon-red)'}" onclick="adminToggleGame('crash', ${adData.statuses.crash ? 0 : 1})">${adData.statuses.crash ? 'ВКЛЮЧЕНО' : 'ВЫКЛЮЧЕНО'}</button></div>
            <div style="display:flex; justify-content:space-between; margin-bottom:10px; align-items:center;"><b>Mines:</b> <button class="btn" style="width:auto; margin:0; padding:5px 10px; background:${adData.statuses.mines ? 'var(--neon)' : 'var(--neon-red)'}" onclick="adminToggleGame('mines', ${adData.statuses.mines ? 0 : 1})">${adData.statuses.mines ? 'ВКЛЮЧЕНО' : 'ВЫКЛЮЧЕНО'}</button></div>
            <div style="display:flex; justify-content:space-between; margin-bottom:10px; align-items:center;"><b>Coinflip:</b> <button class="btn" style="width:auto; margin:0; padding:5px 10px; background:${adData.statuses.coinflip ? 'var(--neon)' : 'var(--neon-red)'}" onclick="adminToggleGame('coinflip', ${adData.statuses.coinflip ? 0 : 1})">${adData.statuses.coinflip ? 'ВКЛЮЧЕНО' : 'ВЫКЛЮЧЕНО'}</button></div>

            <hr style="border-color:#333; margin:15px 0;">
            <h3 style="color:var(--neon-blue); margin-bottom:10px;">Рассылка уведомления</h3>
            <textarea id="ad-broadcast-msg" class="input-box" style="height:60px; font-size:14px; padding:10px;" placeholder="Текст уведомления..."></textarea>
            <button class="btn" style="padding:10px; background:var(--neon-blue); color:#000;" onclick="adminBroadcast()">ОТПРАВИТЬ ВСЕМ</button>
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
                    Выиграл (Реал): <span style="color:var(--neon)">${(u.stats.realWon||0).toFixed(2)}</span> | 
                    Проиграл (Реал): <span style="color:var(--neon-red)">${(u.stats.realLost||0).toFixed(2)}</span> | 
                    Промо: <span style="color:var(--neon-blue)">${(u.stats.promoTon||0).toFixed(2)}</span>
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

async function adminToggleGame(game, value) {
    await fetch('/api/admin/set_status', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value}) });
    loadAdminData();
    showToast('Статус изменен!');
}

async function adminBroadcast() {
    const msg = $('ad-broadcast-msg').value;
    if(!msg) return showToast('Введите текст!');
    await fetch('/api/admin/broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, message: msg}) });
    $('ad-broadcast-msg').value = '';
    showToast('Уведомление отправлено всем!');
}
