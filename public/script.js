const tg = window.Telegram.WebApp;
const socket = io();
let user = null; let mode = 'real';

// UI Helpers
const $ = id => document.getElementById(id);
function showToast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerText = msg;
    $('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// Background Animation
const ctx = $('stars-bg').getContext('2d');
let w = $('stars-bg').width = window.innerWidth;
let h = $('stars-bg').height = window.innerHeight;
let stars = Array(100).fill().map(() => ({ x: Math.random()*w, y: Math.random()*h, s: Math.random()*2 }));
function draw() {
    ctx.clearRect(0,0,w,h); ctx.fillStyle = '#fff';
    stars.forEach(s => ctx.fillRect(s.x, s.y, s.s, s.s));
    requestAnimationFrame(draw);
} draw();

// Init
window.onload = async () => {
    tg.expand();
    const res = await fetch('/api/auth', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(tg.initDataUnsafe.user || {id: "1", first_name: "Dev"})
    });
    user = await res.json();
    $('loader').style.opacity = '0'; setTimeout(() => $('loader').style.display = 'none', 500);
    
    $('user-name').innerText = user.username || 'Player';
    $('user-ava').src = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    updateUI();
};

function updateUI() {
    const bal = mode === 'real' ? user.balance : user.demo_balance;
    $('bal-val').innerText = bal.toFixed(2);
    $('bal-mode').innerText = mode.toUpperCase();
    $('bal-mode').style.color = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    $('bal-mode').style.borderColor = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    
    $('p-bets').innerText = user.stats.bets;
    $('p-wins').innerText = user.stats.wins;
    $('p-plus').innerText = user.stats.plus.toFixed(2) + ' TON';
    $('p-minus').innerText = user.stats.minus.toFixed(2) + ' TON';
}

function toggleMode() { mode = mode === 'real' ? 'demo' : 'real'; updateUI(); }

function nav(pageId, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    $('page-'+pageId).classList.add('active');
    if(el) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
    }
}

// TON Connect
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json', // Замени на свой URL
    buttonRootId: 'ton-connect'
});

// Sockets
socket.on('online', c => $('online-c').innerText = c);
socket.on('newLiveBet', b => {
    const d = document.createElement('div');
    d.innerHTML = `<span>${b.username} (${b.game})</span> <span style="float:right; color:${b.amount.includes('+')?'var(--neon)':'#f44'}">${b.amount}</span>`;
    $('feed-list').prepend(d); if($('feed-list').children.length > 5) $('feed-list').lastChild.remove();
});

// CRASH
let curCrash = {}; let crBet = 0;
socket.on('crashData', d => {
    curCrash = d;
    if(d.status === 'waiting') { $('cr-x').innerText = 'ЖДЕМ'; $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; $('cr-x').style.color = '#fff'; }
    if(d.status === 'running') { $('cr-x').innerText = d.multiplier + 'x'; $('cr-timer').innerText = '🚀 ПОЛЕТ'; $('cr-x').style.color = 'var(--neon)'; }
    if(d.status === 'crashed') { $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = '#f44'; if($('cr-btn').innerText === 'ЗАБРАТЬ') crashLoss(); }
});

async function playCrash() {
    const btn = $('cr-btn');
    if(btn.innerText === 'ПОСТАВИТЬ') {
        if(curCrash.status !== 'waiting') return showToast('Ставка перенесена на след. раунд');
        crBet = parseFloat($('cr-bet').value); if(crBet <= 0) return;
        btn.innerText = 'ЗАБРАТЬ'; btn.style.background = '#f44'; showToast('Ставка принята!');
    } else {
        const win = crBet * curCrash.multiplier;
        await reqBet('Crash', crBet, win);
        btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; showToast(`Ставка выведена: +${win.toFixed(2)}`);
    }
}
async function crashLoss() { await reqBet('Crash', crBet, 0); $('cr-btn').innerText = 'ПОСТАВИТЬ'; $('cr-btn').style.background = 'var(--neon)'; }

// MINES (5 bomb)
let miActive = false; let bombs = []; let miBet = 0;
function playMines() {
    if(miActive) { reqBet('Mines', miBet, miBet*1.8); miActive = false; $('mi-btn').innerText='ИГРАТЬ'; return; }
    miBet = parseFloat($('mi-bet').value); if(miBet<=0) return;
    bombs = []; while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
    miActive = true; $('mi-btn').innerText='ЗАБРАТЬ'; renderMines(); showToast('Ищите кристаллы!');
}
function renderMines() {
    $('mine-grid').innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'm-cell';
        c.onclick = () => {
            if(!miActive) return;
            if(bombs.includes(i)) { c.innerText='💣'; c.style.background='#f44'; miActive=false; reqBet('Mines', miBet, 0); $('mi-btn').innerText='ИГРАТЬ'; showToast('Подорвался!'); }
            else { c.innerText='💎'; c.classList.add('open'); }
        }; $('mine-grid').appendChild(c);
    }
}

// COINFLIP
let cSide = 'ОРЕЛ';
function setSide(s) { cSide = s; $('side-heads').classList.toggle('active', s==='ОРЕЛ'); $('side-tails').classList.toggle('active', s==='РЕШКА'); }
async function playCoin() {
    const bet = parseFloat($('co-bet').value); if(bet<=0) return;
    const res = Math.random() > 0.5 ? 'ОРЕЛ' : 'РЕШКА';
    const win = res === cSide ? bet*2 : 0;
    showToast(`Выпало: ${res}`); await reqBet('Coinflip', bet, win);
}

// PROMO
async function activatePromo() {
    const code = $('promo-code').value;
    const r = await fetch('/api/promo', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: user.id, code}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Успешно!'); } else showToast('Ошибка промокода');
}

// WITHDRAW
async function withdraw() {
    const a = parseFloat($('with-amount').value); const ad = $('with-addr').value;
    const r = await fetch('/api/withdraw', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: user.id, address: ad, amount: a}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Заявка отправлена в Админку'); } else showToast('Ошибка (мин 5 TON)');
}

// API Helper
async function reqBet(game, bet, win) {
    const r = await fetch('/api/bet', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: user.id, game, bet, win, mode}) });
    user = await r.json(); updateUI();
}

// ADMIN PANEL
let taps = 0;
function checkAdmin() { taps++; if(taps>=10) { let p = prompt('Password?'); if(p==='1234') $('admin-modal').style.display='block'; taps=0; } }
