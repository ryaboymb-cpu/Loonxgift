const tg = window.Telegram.WebApp;
const socket = io();
let user = null; let mode = 'real';

const $ = id => document.getElementById(id);
function showToast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerText = msg;
    $('toast-container').appendChild(t); setTimeout(() => t.remove(), 3000);
}

// ЗВЕЗДЫ ПАДАЮТ ВНИЗ
const ctx = $('stars-bg').getContext('2d');
let w = $('stars-bg').width = window.innerWidth;
let h = $('stars-bg').height = window.innerHeight;
let stars = Array(120).fill().map(() => ({ x: Math.random()*w, y: Math.random()*h, s: Math.random()*2 + 0.5, speed: Math.random()*1 + 0.2 }));
function draw() {
    ctx.clearRect(0,0,w,h); ctx.fillStyle = '#fff';
    stars.forEach(s => {
        ctx.fillRect(s.x, s.y, s.s, s.s);
        s.y += s.speed; // Падение вниз
        if(s.y > h) { s.y = 0; s.x = Math.random()*w; } // Возврат наверх
    });
    requestAnimationFrame(draw);
} draw();

// АВТОРИЗАЦИЯ И ДАННЫЕ В ПРОФИЛЬ
window.onload = async () => {
    tg.expand();
    const res = await fetch('/api/auth', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(tg.initDataUnsafe.user || {id: "1", first_name: "Dev", username: "DevUser"})
    });
    user = await res.json();
    $('loader').style.opacity = '0'; setTimeout(() => $('loader').style.display = 'none', 500);
    
    const avaUrl = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    const uName = user.username || 'Игрок';
    
    $('user-ava').src = avaUrl;
    $('profile-ava').src = avaUrl;
    $('profile-name').innerText = uName;
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

const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({ manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json', buttonRootId: 'ton-connect' });

socket.on('online', c => $('online-c').innerText = c);
socket.on('newLiveBet', b => {
    const d = document.createElement('div'); d.style.padding = "5px 0"; d.style.borderBottom = "1px solid #222";
    d.innerHTML = `<span>${b.username} <b>(${b.game})</b></span> <span style="float:right; font-weight:bold; color:${b.amount.includes('+')?'var(--neon)':'var(--neon-red)'}">${b.amount}</span>`;
    $('feed-list').prepend(d); if($('feed-list').children.length > 5) $('feed-list').lastChild.remove();
});

// CRASH
let curCrash = {}; let crBet = 0;
socket.on('crashData', d => {
    curCrash = d;
    if(d.status === 'waiting') { $('cr-x').innerText = 'ЖДЕМ'; $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; $('cr-x').style.color = '#fff'; }
    if(d.status === 'running') { $('cr-x').innerText = d.multiplier + 'x'; $('cr-timer').innerText = '🚀 В ПОЛЕТЕ'; $('cr-x').style.color = 'var(--neon)'; }
    if(d.status === 'crashed') { $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = 'var(--neon-red)'; if($('cr-btn').innerText === 'ЗАБРАТЬ') { reqBet('Crash', crBet, 0); $('cr-btn').innerText = 'ПОСТАВИТЬ'; $('cr-btn').style.background = 'var(--neon)'; } }
});

async function playCrash() {
    const btn = $('cr-btn');
    if(btn.innerText === 'ПОСТАВИТЬ') {
        if(curCrash.status !== 'waiting') return showToast('Ставка пойдет на след. раунд');
        crBet = parseFloat($('cr-bet').value); if(isNaN(crBet) || crBet <= 0) return showToast('Введите сумму');
        btn.innerText = 'ЗАБРАТЬ'; btn.style.background = 'var(--neon-red)'; showToast('Ставка принята!');
    } else {
        const win = crBet * curCrash.multiplier; await reqBet('Crash', crBet, win);
        btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; showToast(`Вывод: +${win.toFixed(2)} TON`);
    }
}

// MINES
let miActive = false; let bombs = []; let miBet = 0;
function playMines() {
    if(miActive) { reqBet('Mines', miBet, miBet*1.5); miActive = false; $('mi-btn').innerText='ИГРАТЬ (5 МИН)'; showToast('Деньги забраны!'); return; }
    miBet = parseFloat($('mi-bet').value); if(isNaN(miBet) || miBet<=0) return showToast('Введите ставку');
    bombs = []; while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
    miActive = true; $('mi-btn').innerText='ЗАБРАТЬ ДЕНЬГИ'; renderMines(); showToast('Ищи кристаллы!');
}
function renderMines() {
    $('mine-grid').innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'm-cell';
        c.onclick = () => {
            if(!miActive) return;
            if(bombs.includes(i)) { c.innerText='💣'; c.style.background='var(--neon-red)'; miActive=false; reqBet('Mines', miBet, 0); $('mi-btn').innerText='ИГРАТЬ (5 МИН)'; showToast('БУМ! Проигрыш'); }
            else { c.innerText='💎'; c.classList.add('open'); }
        }; $('mine-grid').appendChild(c);
    }
}

// COINFLIP (3D АНИМАЦИЯ L / X)
let cSide = 'L'; let isFlipping = false;
function setSide(s) { if(isFlipping) return; cSide = s; $('side-l').classList.toggle('active', s==='L'); $('side-x').classList.toggle('active', s==='X'); }
async function playCoin() {
    if(isFlipping) return;
    const bet = parseFloat($('co-bet').value); if(isNaN(bet) || bet<=0) return showToast('Введите ставку');
    isFlipping = true; $('co-btn').innerText = 'КРУТИМ...';
    
    // Анимация вращения
    const coin = $('coin-3d');
    const result = Math.random() > 0.5 ? 'L' : 'X';
    const turns = 5; // количество оборотов
    const rotation = result === 'L' ? (turns * 360) : (turns * 360 + 180);
    
    coin.style.transform = `rotateY(${rotation}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? bet*2 : 0;
        showToast(win > 0 ? `Победа! Выпало ${result}` : `Проигрыш. Выпало ${result}`);
        await reqBet('Coinflip', bet, win);
        coin.style.transition = 'none'; coin.style.transform = `rotateY(${result === 'L' ? 0 : 180}deg)`; // Сброс для след раза
        setTimeout(() => coin.style.transition = 'transform 2s cubic-bezier(0.2, 0.8, 0.2, 1)', 50);
        isFlipping = false; $('co-btn').innerText = 'КРУТИТЬ МОНЕТУ';
    }, 2000);
}

// ФИНАНСЫ И ПРОМО
async function mockDeposit() {
    const a = parseFloat($('dep-amount').value); if(isNaN(a) || a<=0) return;
    const r = await fetch('/api/deposit_mock', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, amount:a}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Баланс пополнен!'); }
}
async function withdraw() {
    const a = parseFloat($('with-amount').value); const ad = $('with-addr').value;
    const r = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, address:ad, amount:a}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Заявка создана!'); } else showToast('Ошибка вывода');
}
async function activatePromo() {
    const code = $('promo-code').value;
    const r = await fetch('/api/promo', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, code}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Промокод активирован!'); } else showToast('Неверный промокод');
}

// ADMIN (5 нажатий на аватарку)
let aTaps = 0;
async function checkAdmin() {
    aTaps++; if(aTaps >= 5) {
        aTaps = 0; let p = prompt('Admin Password:');
        if(p) {
            const r = await fetch('/api/admin', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: p}) });
            if(r.ok) { $('admin-modal').style.display = 'block'; showToast('Вход выполнен'); } else showToast('Неверный пароль');
        }
    }
}

async function reqBet(game, bet, win) {
    const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode}) });
    if(r.ok) { user = await r.json(); updateUI(); } else showToast('Недостаточно средств!');
}
