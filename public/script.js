const tg = window.Telegram.WebApp;
const socket = io();
let user = null;
let currentMode = 'demo';

// Звездный фон
const canvas = document.getElementById('stars-canvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth; canvas.height = window.innerHeight;
let stars = Array(80).fill().map(() => ({ x: Math.random()*canvas.width, y: Math.random()*canvas.height, s: Math.random()*2 }));
function drawStars() {
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle = "#fff";
    stars.forEach(s => ctx.fillRect(s.x, s.y, s.s, s.s)); requestAnimationFrame(drawStars);
}
drawStars();

window.onload = async () => {
    tg.expand();
    const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(tg.initDataUnsafe.user || {id: 1, first_name: "Tester"})
    });
    user = await response.json();
    document.getElementById('user-name').innerText = user.username || user.id;
    document.getElementById('user-ava').src = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    updateBalance();
};

function updateBalance() {
    const bal = currentMode === 'demo' ? user.demo_balance : user.balance;
    document.getElementById('balance').innerText = bal.toFixed(2);
    document.getElementById('mode-text').innerText = currentMode === 'demo' ? 'D-TON DEMO' : 'TON BALANCE';
}

function toggleMode() {
    currentMode = currentMode === 'demo' ? 'real' : 'demo';
    updateBalance();
}

function nav(page, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-'+page).classList.add('active');
    if(el) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
    }
}

function openGame(g) { nav(g); if(g === 'mines') renderGrid(); }

// MINES ЛОГИКА
let mineGameActive = false; let bombLocations = []; let minesBet = 0;
function renderGrid() {
    const grid = document.getElementById('mines-grid'); grid.innerHTML = '';
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div'); cell.className = 'cell';
        cell.onclick = () => clickCell(i, cell);
        grid.appendChild(cell);
    }
}

async function startMines() {
    if(mineGameActive) { // Забрать деньги
        await finishMines(true); return;
    }
    minesBet = parseFloat(document.getElementById('mines-bet').value);
    if(isNaN(minesBet) || minesBet <= 0) return alert("Введите ставку");
    
    bombLocations = []; while(bombLocations.length < 5) {
        let r = Math.floor(Math.random()*25); if(!bombLocations.includes(r)) bombLocations.push(r);
    }
    mineGameActive = true; renderGrid();
    document.getElementById('mines-main-btn').innerText = "ЗАБРАТЬ";
}

async function clickCell(idx, el) {
    if(!mineGameActive) return;
    if(bombLocations.includes(idx)) {
        el.innerText = '💣'; el.style.background = '#ff0055';
        mineGameActive = false; await finishMines(false);
    } else {
        el.innerText = '💎'; el.style.color = '#00ff88';
    }
}

async function finishMines(isWin) {
    const winAmount = isWin ? minesBet * 1.5 : 0;
    const res = await fetch('/api/bet', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({id: user.id, bet: minesBet, win: winAmount, game: 'Mines', mode: currentMode})
    });
    user = await res.json(); updateBalance();
    mineGameActive = false; document.getElementById('mines-main-btn').innerText = "ИГРАТЬ";
}

// CRASH ЛОГИКА
socket.on('crashTick', (data) => {
    const display = document.getElementById('crash-multiplier');
    if(data.status === 'running') display.innerText = data.multiplier + 'x';
    if(data.status === 'crashed') { display.innerText = 'BOOM!'; display.style.color = '#ff0055'; }
    if(data.status === 'waiting') { display.innerText = 'ЖДЕМ...'; display.style.color = '#fff'; }
});
