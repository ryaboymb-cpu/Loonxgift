const tg = window.Telegram.WebApp;
const socket = io();
let user = null; 
let mode = 'real';
let adminPass = '';
let globalRtp = 90;
let maintenance = { crash: false, mines: false, coinflip: false };
let adminWalletAddress = '';

// TON Connect UI
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonx.ru/tonconnect-manifest.json', 
    buttonRootId: 'ton-connect-btn'
});

const $ = id => document.getElementById(id);

// Время по Москве
function getTimeMSK() {
    return new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow'
    }).format(new Date());
}

function showToast(msg, dur = 3000) {
    const container = $('toast-container');
    const t = document.createElement('div'); 
    t.className = 'toast'; 
    t.innerText = msg;
    container.appendChild(t); 
    setTimeout(() => {
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 500);
    }, dur);
}

socket.on('global_alert', msg => {
    showToast(`📢 ${msg}`, 6000);
});

function copyText(text) {
    if(!text) return;
    navigator.clipboard.writeText(text).then(() => showToast('Скопировано в буфер'));
}

// Звездное небо
const ctx = $('stars-bg').getContext('2d');
let w = $('stars-bg').width = window.innerWidth;
let h = $('stars-bg').height = window.innerHeight;
let stars = Array(100).fill().map(() => ({ x: Math.random()*w, y: Math.random()*h, s: Math.random()*2, speed: Math.random()*0.5 + 0.1 }));
function draw() {
    ctx.clearRect(0,0,w,h); ctx.fillStyle = 'rgba(255,255,255,0.5)';
    stars.forEach(s => {
        ctx.fillRect(s.x, s.y, s.s, s.s);
        s.y += s.speed;
        if(s.y > h) { s.y = 0; s.x = Math.random()*w; }
    });
    requestAnimationFrame(draw);
} draw();

window.onload = async () => {
    tg.expand();
    tg.enableClosingConfirmation();
    
    const initData = tg.initDataUnsafe.user || {id: "123456", first_name: "Игрок", username: "player", photo_url: ""};
    
    const res = await fetch('/api/auth', {
        method: 'POST', 
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(initData)
    });
    
    const data = await res.json();
    user = data.user;
    globalRtp = data.rtp || 90;
    maintenance = data.maintenance || { crash: false, mines: false, coinflip: false };
    adminWalletAddress = data.adminWallet || '';

    $('dep-wallet').innerText = adminWalletAddress || 'Адрес не задан';
    $('dep-memo').innerText = user.id;

    $('loader').style.opacity = '0'; 
    setTimeout(() => $('loader').style.display = 'none', 500);
    
    const avaUrl = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    $('user-ava').src = avaUrl; 
    $('profile-ava').src = avaUrl;
    $('profile-name').innerText = user.username || user.first_name || 'Игрок';
    updateUI();
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

function toggleMode() { 
    mode = mode === 'real' ? 'demo' : 'real'; 
    updateUI(); 
    showToast(`Переключено на ${mode === 'real' ? 'реальный' : 'демо'} баланс`); 
}

function nav(pageId, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); 
    $('page-'+pageId).classList.add('active');
    if(el) { 
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); 
        el.classList.add('active'); 
    }
}

function navGame(game) {
    if (maintenance[game]) return showToast('Игра на техническом обслуживании');
    nav(game);
}

function switchDepTab(type, el) {
    document.querySelectorAll('.w-tab').forEach(b => { 
        b.classList.remove('active'); 
        b.style.background='#222'; 
        b.style.color='#fff'; 
    });
    el.classList.add('active'); el.style.background='var(--neon)'; el.style.color='#000';
    $('dep-manual').style.display = type === 'manual' ? 'block' : 'none';
    $('dep-connect').style.display = type === 'connect' ? 'block' : 'none';
}

// TON Connect оплата с правильным Memo
async function payWithTonConnect() {
    if (!tonConnectUI.connected) return showToast('Сначала подключите кошелек!');
    const amount = parseFloat($('tc-amount').value);
    if(isNaN(amount) || amount < 0.1) return showToast('Минимальная сумма 0.1 TON');
    
    // Текстовый комментарий для TON Connect (Memo) кодируется в Base64 специальным образом
    // Если нет @ton/core, используем готовую строку для текстового коммента (0x00000000 + hex)
    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
            {
                address: adminWalletAddress,
                amount: (amount * 1000000000).toString(), 
                payload: btoa('\0\0\0\0' + user.id) // Упрощенный текстовый коммент
            }
        ]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        showToast('Запрос отправлен в кошелек!');
    } catch (e) {
        showToast('Отменено или ошибка');
    }
}

socket.on('online', c => $('online-c').innerText = c);
socket.on('rtpUpdate', r => globalRtp = r); 
socket.on('maintenanceUpdate', m => maintenance = m); 

socket.on('init_history', bets => {
    $('feed-list').innerHTML = '';
    bets.slice(-10).reverse().forEach(b => addLiveBetToDOM(b));
});

socket.on('newHistoryEntry', b => addLiveBetToDOM(b));

function addLiveBetToDOM(b) {
    const d = document.createElement('div'); d.className = 'live-bet-item';
    const isWin = b.result > 0;
    const modeTag = b.mode === 'Demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[D]</span>' : '<span style="color:var(--neon); font-size:9px;">[R]</span>';
    const time = b.time || getTimeMSK();
    
    d.innerHTML = `
        <div class="live-user">
            <img src="${b.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="live-ava">
            <span>
                <b>${b.username}</b> <span class="bet-time">${time}</span><br>
                <small style="color:#555">${b.game}</small> ${modeTag}
            </span>
        </div>
        <span style="font-weight:900; color:${isWin?'var(--neon)':'var(--neon-red)'}">${isWin ? '+'+b.result.toFixed(2) : b.result.toFixed(2)}</span>
    `;
    $('feed-list').prepend(d); 
    if($('feed-list').children.length > 10) $('feed-list').lastChild.remove();
}

// --- CRASH LOGIC ---
let curCrash = {}; 
let myCrashBets = []; 
let isCashingOut = false;

socket.on('crashHistoryUpdate', hist => {
    $('cr-history').innerHTML = hist.map(x => `<div class="cr-badge ${parseFloat(x) >= 2.0 ? 'good' : 'bad'}">${x}x</div>`).join('');
});

socket.on('crashBetsUpdate', bets => {
    if(bets.length === 0) {
        $('cr-live-bets').innerHTML = '<div style="text-align:center; color:#333; padding:10px;">Ставок нет</div>';
    } else {
        $('cr-live-bets').innerHTML = bets.map(b => {
            const modeTag = b.mode === 'demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[D]</span>' : '';
            let val = `<span style="color:#fff;">${b.bet} TON</span>`;
            if (b.cashedOut) val = `<span style="color:var(--neon); font-weight:bold;">×${b.winFactor}</span>`;
            else if (curCrash.status === 'crashed') val = `<span style="color:var(--neon-red);">×</span>`;
            
            return `
            <div class="live-bet-item">
                <div class="live-user"><img src="${b.avatar}" class="live-ava"> <span>${b.username} ${modeTag}</span></div>
                ${val}
            </div>`
        }).join('');
    }
});

socket.on('crashData', d => {
    curCrash = d;
    const btn = $('cr-btn');
    
    if(d.status === 'waiting') { 
        $('cr-x').innerText = 'WAIT'; $('cr-timer').innerText = `ДО СТАРТА: ${d.timer}s`; $('cr-x').style.color = '#fff'; 
        btn.disabled = myCrashBets.length >= 2;
        btn.innerText = myCrashBets.length > 0 ? 'СТАВКА ПРИНЯТА' : 'ПОСТАВИТЬ';
        btn.style.background = 'var(--neon)';
    }
    if(d.status === 'running') { 
        $('cr-x').innerText = d.multiplier.toFixed(2) + 'x'; $('cr-timer').innerText = '🚀 В ПОЛЕТЕ'; $('cr-x').style.color = 'var(--neon)'; 
        if (myCrashBets.length > 0) {
            btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * d.multiplier).toFixed(2)}`;
            btn.style.background = 'var(--neon-red)';
            btn.disabled = false;
        } else {
            btn.innerText = 'ЖДЕМ СЛЕДУЮЩИЙ'; btn.style.background = '#333'; btn.disabled = true;
        }
    }
    if(d.status === 'crashed') { 
        $('cr-x').innerText = d.multiplier.toFixed(2) + 'x'; $('cr-x').style.color = 'var(--neon-red)'; 
        $('cr-timer').innerText = 'BOOM!';
        myCrashBets = []; 
        btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false;
        isCashingOut = false;
    }
});

async function playCrash() {
    if(isCashingOut) return;
    const bet = parseFloat($('cr-bet').value);
    
    if(curCrash.status === 'waiting') {
        if(isNaN(bet) || bet < 0.1) return showToast('Мин. ставка 0.1 TON');
        isCashingOut = true;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet, win:0, mode}) });
        if(r.ok) {
            user = await r.json(); updateUI();
            myCrashBets.push(bet);
            showToast('Ставка принята!');
        } else showToast('Ошибка ставки');
        isCashingOut = false;
    } else if(curCrash.status === 'running' && myCrashBets.length > 0) {
        isCashingOut = true;
        const win = myCrashBets[0] * curCrash.multiplier;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win, mode}) });
        if(r.ok) {
            user = await r.json(); updateUI();
            myCrashBets.shift();
            showToast(`Выиграно: ${win.toFixed(2)} TON`);
        } else showToast('Слишком поздно!');
        isCashingOut = false;
    }
}

// --- MINES LOGIC ---
let miActive = false; let bombs = []; let miBet = 0; let opened = 0;

function playMines() {
    if(miActive) {
        const win = miBet * (1 + opened * 0.25);
        reqBet('Mines', 0, win).then(ok => {
            if(ok) { miActive = false; $('mi-btn').innerText = 'ИГРАТЬ'; showToast(`Забрали ${win.toFixed(2)} TON`); }
        });
        return;
    }
    miBet = parseFloat($('mi-bet').value);
    if(isNaN(miBet) || miBet < 0.1) return showToast('Мин. 0.1 TON');
    
    reqBet('Mines', miBet, 0).then(success => {
        if(success) {
            miActive = true; opened = 0; bombs = [];
            while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
            renderMines();
            $('mi-btn').innerText = `ЗАБРАТЬ ${miBet.toFixed(2)}`;
        }
    });
}

function renderMines() {
    $('mine-grid').innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'm-cell';
        c.onclick = () => {
            if(!miActive || c.classList.contains('open')) return;
            if(bombs.includes(i)) {
                c.innerText = '💣'; c.style.background = 'var(--neon-red)';
                miActive = false; $('mi-btn').innerText = 'ИГРАТЬ'; showToast('Взрыв!');
            } else {
                c.innerText = '💎'; c.classList.add('open'); opened++;
                const curWin = miBet * (1 + opened * 0.25);
                $('mi-btn').innerText = `ЗАБРАТЬ ${curWin.toFixed(2)}`;
            }
        };
        $('mine-grid').appendChild(c);
    }
}

// --- COINFLIP LOGIC ---
let cSide = 'L'; let isFlipping = false;
function setSide(s) { if(isFlipping) return; cSide = s; $('side-l').classList.toggle('active', s==='L'); $('side-x').classList.toggle('active', s==='X'); }
async function playCoin() {
    if(isFlipping) return;
    const bet = parseFloat($('co-bet').value);
    if(isNaN(bet) || bet < 0.1) return showToast('Мин. 0.1 TON');

    isFlipping = true; 
    const isWin = Math.random() < (globalRtp / 200);
    const result = isWin ? cSide : (cSide === 'L' ? 'X' : 'L');
    const coin = $('coin-3d');
    
    coin.style.transform = `rotateY(${result === 'L' ? 1800 : 1980}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? bet * 1.95 : 0;
        await reqBet('Coinflip', bet, win);
        showToast(win > 0 ? `Победа! +${win.toFixed(2)}` : 'Проигрыш');
        coin.style.transition = 'none';
        coin.style.transform = `rotateY(${result === 'L' ? 0 : 180}deg)`;
        setTimeout(() => coin.style.transition = 'transform 2s cubic-bezier(0.175, 0.885, 0.32, 1.275)', 50);
        isFlipping = false;
    }, 2000);
}

// ФИНАНСЫ
async function checkRealDeposit(btn) {
    btn.innerText = "ПРОВЕРКА..."; btn.disabled = true;
    const r = await fetch('/api/check_deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id}) });
    const res = await r.json();
    if(r.ok) { user = res.user; updateUI(); showToast(`Зачислено ${res.added} TON!`); } 
    else showToast(res.error || 'Транзакция не найдена');
    btn.innerText = "ПРОВЕРИТЬ ОПЛАТУ"; btn.disabled = false;
}

async function activatePromo() {
    const code = $('promo-code').value;
    const r = await fetch('/api/promo', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, code}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Бонус зачислен!'); $('promo-code').value=''; } 
    else showToast('Неверный код или лимит исчерпан');
}

async function reqBet(game, bet, win) {
    const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode, time: getTimeMSK()}) });
    if(r.ok) { user = await r.json(); updateUI(); return true; }
    showToast('Ошибка баланса'); return false;
}

async function withdraw() {
    const amount = parseFloat($('with-amount').value);
    const address = $('with-addr').value;
    if(amount < 5) return showToast('Минимум 5 TON');
    if(!address.startsWith('U')) return showToast('Неверный адрес');
    
    const r = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, address, amount}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Заявка создана'); } else showToast('Ошибка вывода');
}

// ADMIN PANEL
let aTaps = 0;
function checkAdmin() { aTaps++; if(aTaps >= 5) { aTaps=0; let p=prompt('Pass:'); if(p){ adminPass=p; loadAdminData(); }} }
async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) { adData = await r.json(); $('admin-modal').style.display='block'; renderAdminContent('withdraws'); } else showToast('Доступ запрещен');
}
function switchAdminTab(t) { document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active')); event.target.classList.add('active'); renderAdminContent(t); }
function renderAdminContent(t) {
    const c = $('admin-content');
    if(t==='withdraws') c.innerHTML = adData.withdraws.map(w => `<div class="card">${w.amount} TON -> ${w.address} <button class="btn" style="padding:5px" onclick="adminW('${w._id}','approve')">OK</button></div>`).join('') || 'Пусто';
    // Остальные вкладки админки аналогично...
}
