const tg = window.Telegram.WebApp;
const socket = io();
let user = null; let mode = 'real';
let adminPass = '';

const $ = id => document.getElementById(id);
function showToast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerText = msg;
    $('toast-container').appendChild(t); setTimeout(() => t.remove(), 3000);
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
    
    // Подгрузка кошелька админа для депов
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
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); $('page-'+pageId).classList.add('active');
    if(el) { document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); el.classList.add('active'); }
}

socket.on('online', c => $('online-c').innerText = c);

// Лента с аватарками
socket.on('newLiveBet', b => {
    const d = document.createElement('div'); d.className = 'live-bet-item';
    d.innerHTML = `
        <div class="live-user">
            <img src="${b.avatar}" class="live-ava">
            <span>${b.username} <b style="color:var(--sub); font-size:10px;">(${b.game})</b></span>
        </div>
        <span style="font-weight:bold; color:${b.amount.includes('+')?'var(--neon)':'var(--neon-red)'}">${b.amount}</span>
    `;
    $('feed-list').prepend(d); if($('feed-list').children.length > 8) $('feed-list').lastChild.remove();
});

// CRASH
let curCrash = {}; let crBet = 0; let myCrashBetActive = false;

socket.on('crashHistoryUpdate', hist => {
    $('cr-history').innerHTML = hist.map(x => `<div class="cr-badge ${parseFloat(x) >= 2.0 ? 'good' : 'bad'}">${x}x</div>`).join('');
});

socket.on('crashBetsUpdate', bets => {
    if(bets.length === 0) $('cr-live-bets').innerHTML = '<div style="text-align:center; color:#555; padding:10px;">Ставок пока нет</div>';
    else {
        $('cr-live-bets').innerHTML = bets.map(b => `
            <div class="live-bet-item">
                <div class="live-user"><img src="${b.avatar}" class="live-ava"> <span>${b.username}</span></div>
                <span style="color:var(--neon);">${b.bet} TON</span>
            </div>
        `).join('');
    }
});

socket.on('crashData', d => {
    curCrash = d;
    if(d.status === 'waiting') { $('cr-x').innerText = 'ЖДЕМ'; $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; $('cr-x').style.color = '#fff'; }
    if(d.status === 'running') { $('cr-x').innerText = d.multiplier + 'x'; $('cr-timer').innerText = '🚀 В ПОЛЕТЕ'; $('cr-x').style.color = 'var(--neon)'; }
    if(d.status === 'crashed') { 
        $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = 'var(--neon-red)'; 
        if(myCrashBetActive) { 
            reqBet('Crash', crBet, 0); 
            $('cr-btn').innerText = 'ПОСТАВИТЬ'; $('cr-btn').style.background = 'var(--neon)'; myCrashBetActive = false;
        } 
    }
});

async function playCrash() {
    const btn = $('cr-btn');
    const curBal = mode === 'real' ? user.balance : user.demo_balance;

    if(btn.innerText === 'ПОСТАВИТЬ') {
        if(curCrash.status !== 'waiting') return showToast('Ставка пойдет на след. раунд');
        crBet = parseFloat($('cr-bet').value); 
        if(isNaN(crBet) || crBet <= 0) return showToast('Введите сумму');
        if(crBet > curBal) return showToast('Недостаточно средств!');
        
        // Отправляем ставку на сервер (вычитаем баланс)
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:crBet, win:0, mode}) });
        if(r.ok) { 
            user = await r.json(); updateUI();
            btn.innerText = 'ЗАБРАТЬ'; btn.style.background = 'var(--neon-red)'; showToast('Ставка принята!');
            myCrashBetActive = true;
        } else { showToast('Ошибка ставки!'); }
        
    } else if(myCrashBetActive && curCrash.status === 'running') {
        // Забираем выигрыш
        const win = crBet * curCrash.multiplier; 
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win:win, mode}) });
        if(r.ok) {
            user = await r.json(); updateUI();
            btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; showToast(`Вывод: +${win.toFixed(2)} TON`);
            myCrashBetActive = false;
        }
    }
}

// MINES
let miActive = false; let bombs = []; let miBet = 0;
function playMines() {
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(miActive) { reqBet('Mines', 0, miBet*1.5); miActive = false; $('mi-btn').innerText='ИГРАТЬ (5 МИН)'; showToast('Деньги забраны!'); return; }
    miBet = parseFloat($('mi-bet').value); 
    if(isNaN(miBet) || miBet<=0) return showToast('Введите ставку');
    if(miBet > curBal) return showToast('Недостаточно средств!');
    
    // Снимаем деньги за старт
    reqBet('Mines', miBet, 0).then(success => {
        if(success) {
            bombs = []; while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
            miActive = true; $('mi-btn').innerText='ЗАБРАТЬ ДЕНЬГИ'; renderMines(); showToast('Ищи кристаллы!');
        }
    });
}
function renderMines() {
    $('mine-grid').innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'm-cell';
        c.onclick = () => {
            if(!miActive) return;
            if(bombs.includes(i)) { 
                c.innerText='💣'; c.style.background='var(--neon-red)'; miActive=false; 
                $('mi-btn').innerText='ИГРАТЬ (5 МИН)'; showToast('БУМ! Проигрыш'); 
            } else { 
                c.innerText='💎'; c.classList.add('open'); 
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
    if(isNaN(bet) || bet<=0) return showToast('Введите ставку');
    if(bet > curBal) return showToast('Недостаточно средств!');

    isFlipping = true; $('co-btn').innerText = 'КРУТИМ...';
    
    const coin = $('coin-3d');
    const result = Math.random() > 0.5 ? 'L' : 'X';
    const turns = 5; 
    const rotation = result === 'L' ? (turns * 360) : (turns * 360 + 180);
    
    coin.style.transform = `rotateY(${rotation}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? bet*2 : 0;
        showToast(win > 0 ? `Победа! Выпало ${result}` : `Проигрыш. Выпало ${result}`);
        await reqBet('Coinflip', bet, win);
        coin.style.transition = 'none'; coin.style.transform = `rotateY(${result === 'L' ? 0 : 180}deg)`; 
        setTimeout(() => coin.style.transition = 'transform 2s cubic-bezier(0.2, 0.8, 0.2, 1)', 50);
        isFlipping = false; $('co-btn').innerText = 'КРУТИТЬ МОНЕТУ';
    }, 2000);
}

// ФИНАНСЫ И ПРОМО
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
        renderAdminContent('withdraws'); // По дефолту выводы
    } else { showToast('Неверный пароль'); }
}

function renderAdminContent(tab) {
    const c = $('admin-content');
    if(tab === 'withdraws') {
        if(!adData.withdraws.length) return c.innerHTML = 'Выводов нет';
        c.innerHTML = adData.withdraws.map(w => `
            <div style="background:#1a1a1a; padding:10px; border-radius:8px; margin-bottom:10px;">
                <b>ID:</b> ${w.userId} <br> <b>Сумма:</b> ${w.amount} TON <br> <b style="font-size:10px; word-break:break-all;">${w.address}</b><br>
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
            ${adData.promos.map(p => `<div style="padding:5px; border-bottom:1px solid #222;">${p.code} - ${p.amount} TON (Лимит: ${p.limit})</div>`).join('')}
        `;
    }
    if(tab === 'rtp') {
        c.innerHTML = `
            <p style="color:var(--sub); margin-bottom:10px;">Текущий RTP: <b style="color:var(--neon)">${adData.rtp}%</b></p>
            <input type="number" id="ad-rtp-val" class="input-box" style="padding:10px; font-size:14px;" placeholder="Новый RTP (например 85)">
            <button class="btn" style="padding:10px;" onclick="adminRTP()">СОХРАНИТЬ RTP</button>
        `;
    }
    if(tab === 'users') {
        c.innerHTML = adData.users.map(u => `
            <div style="padding:8px; border-bottom:1px solid #222; display:flex; justify-content:space-between;">
                <span>${u.username}</span> <b style="color:var(--neon)">${u.balance.toFixed(2)} TON</b>
            </div>
        `).join('');
    }
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
async function adminRTP() {
    const value = $('ad-rtp-val').value;
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, value}) });
    loadAdminData();
}
