const socket = io();
const tg = window.Telegram.WebApp;
tg.expand();

const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-btn'
});

let user = { id: tg.initDataUnsafe?.user?.id || 123, username: tg.initDataUnsafe?.user?.username || "Player" };
socket.emit('init_user', user);

let localData = { realBal: 0, demoBal: 0 };
let mode = 'demo';
let inGame = false;

// SOUNDS
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(freq, type='sine', dur=0.2) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + dur);
}

socket.on('user_data', d => {
    localData = d;
    updateUI();
});

function updateUI() {
    let b = mode === 'demo' ? localData.demoBal : localData.realBal;
    document.getElementById('h-bal').innerText = b.toFixed(2);
    document.getElementById('w-bal').innerText = b.toFixed(2);
    document.getElementById('h-mode').innerText = mode.toUpperCase();
    document.getElementById('p-name').innerText = user.username;
    document.getElementById('s-games').innerText = localData.games || 0;
    document.getElementById('s-wins').innerText = localData.wins || 0;
}

function toggleMode() { mode = mode === 'demo' ? 'real' : 'demo'; updateUI(); }

function switchTab(tab, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
}

function openGame(g) { document.getElementById('screen-' + g).style.display = 'block'; if(g==='mines') drawMines(); }
function closeGame() { document.querySelectorAll('.game-fullscreen').forEach(s => s.style.display = 'none'); }

// TON DEPOSIT
async function makeDeposit() {
    let amt = document.getElementById('dep-amt').value;
    if(!tonConnectUI.connected) return tg.showAlert("Подключите кошелек!");
    const tx = {
        validUntil: Math.floor(Date.now()/1000)+300,
        messages: [{ address: "UQCTqV9scQaZR0DHzOnMrOCCY7z3MIT0QfoNrtUDZiXHY1-K", amount: (amt*1000000000).toString() }]
    };
    try { await tonConnectUI.sendTransaction(tx); tg.showAlert("Транзакция отправлена!"); } catch(e) { tg.showAlert("Ошибка"); }
}

// CRASH LOGIC
socket.on('crash_update', d => {
    document.getElementById('c-mult').innerText = d.mult.toFixed(2) + 'x';
    if(d.status === 'crashed') {
        playSound(100, 'square', 0.5); // Взрыв
        document.getElementById('c-mult').style.color = 'red';
        inGame = false; document.getElementById('c-btn').innerText = "СТАВКА";
    } else {
        document.getElementById('c-mult').style.color = 'white';
        if(d.status === 'flying' && inGame) document.getElementById('c-btn').innerText = "ЗАБРАТЬ";
    }
});

function crashAction() {
    if(!inGame) {
        socket.emit('crash_bet', { bet: document.getElementById('c-bet').value, mode });
        inGame = true;
    } else {
        socket.emit('crash_cashout');
        inGame = false; document.getElementById('c-btn').innerText = "СТАВКА";
    }
}

// MINES LOGIC
function drawMines() {
    const g = document.getElementById('m-grid'); g.innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'mine-cell';
        c.onclick = () => socket.emit('mines_open', i);
        g.appendChild(c);
    }
}
function minesAction() {
    if(!inGame) {
        socket.emit('mines_start', { bet: document.getElementById('m-bet').value, mode });
        inGame = true; document.getElementById('m-btn').innerText = "ЗАБРАТЬ";
    } else {
        socket.emit('mines_cashout');
        inGame = false; document.getElementById('m-btn').innerText = "ИГРАТЬ";
    }
}
socket.on('mines_safe', d => { playSound(600); document.getElementById('m-grid').children[d.idx].innerText = '💎'; });
socket.on('mines_boom', () => { playSound(100, 'square', 0.5); inGame = false; document.getElementById('m-btn').innerText = "ИГРАТЬ"; tg.showAlert("БОМБА!"); });

socket.on('alert', m => tg.showAlert(m));
