const tg = window.Telegram.WebApp;
const socket = io();

// Генератор звуков
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;
function playSound(type) {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (type === 'click') { osc.frequency.setValueAtTime(600, now); gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1); osc.start(); osc.stop(now + 0.1); }
    else if (type === 'win') { osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(800, now + 0.3); gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0, now + 0.5); osc.start(); osc.stop(now + 0.5); }
    else if (type === 'bomb') { osc.type = 'square'; osc.frequency.setValueAtTime(100, now); osc.frequency.exponentialRampToValueAtTime(20, now + 0.3); gain.gain.setValueAtTime(0.2, now); osc.start(); osc.stop(now + 0.3); }
}

let tonConnectUI;

const app = {
    userId: tg.initDataUnsafe?.user?.id || "dev_" + Math.floor(Math.random()*1000),
    userName: tg.initDataUnsafe?.user?.first_name || "Player",
    avatarUrl: tg.initDataUnsafe?.user?.photo_url || "img/2793-Photoroom_edit_357020906251818.png",
    mode: 'demo', balances: { real: 0, demo: 50 },
    
    async init() {
        tg.expand(); tg.setHeaderColor('#0a0f1d');
        this.createStars();
        
        try {
            const res = await fetch('/api/init', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: this.userId }) });
            const data = await res.json();
            if(data) {
                this.balances = { real: data.realBalance, demo: data.demoBalance };
                document.getElementById('profile-name').innerText = this.userName;
                document.getElementById('profile-avatar').src = this.avatarUrl;
                document.getElementById('profile-id').innerText = `ID: ${this.userId}`;
                document.getElementById('p-games').innerText = data.games || 0;
                document.getElementById('p-wins').innerText = data.wins || 0;
                document.getElementById('p-losses').innerText = data.losses || 0;
            }
        } catch(e) { console.log("Init error", e); }
        
        this.updateUI(); this.initTonConnect();
        setTimeout(() => document.getElementById('loader').style.display = 'none', 1500);
        
        socket.on('online', n => document.getElementById('online-num').innerText = n);
    },

    createStars() {
        const c = document.getElementById('stars');
        for(let i=0; i<80; i++) {
            const s = document.createElement('div'); s.className = 'star';
            const size = Math.random() * 3 + 'px'; s.style.width = size; s.style.height = size;
            s.style.top = Math.random() * 100 + '%'; s.style.left = Math.random() * 100 + '%';
            s.style.setProperty('--d', Math.random() * 3 + 2 + 's'); c.appendChild(s);
        }
    },

    initTonConnect() {
        try {
            tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
                manifestUrl: window.location.origin + '/tonconnect-manifest.json',
                buttonRootId: 'ton-connect-button'
            });
        } catch (e) { console.error("TON Connect Error:", e); }
    },

    updateUI() {
        const b = this.mode === 'real' ? this.balances.real : this.balances.demo;
        document.getElementById('main-bal').innerText = b.toFixed(2);
        document.getElementById('p-bal').innerText = b.toFixed(2);
        document.getElementById('real-val').innerText = this.balances.real.toFixed(2);
        document.getElementById('mode-badge').innerText = this.mode.toUpperCase();
        
        const pill = document.querySelector('.balance-pill');
        const badge = document.getElementById('mode-badge');
        if(this.mode === 'real') {
            pill.style.borderColor = "var(--green)"; badge.style.color = "var(--green)"; badge.style.background = "rgba(16, 185, 129, 0.1)";
        } else {
            pill.style.borderColor = "var(--neon-purple)"; badge.style.color = "var(--neon-purple)"; badge.style.background = "rgba(139, 92, 246, 0.1)";
        }
    },

    toggleMode() { playSound('click'); this.mode = this.mode === 'demo' ? 'real' : 'demo'; this.updateUI(); },
    
    setTab(id) {
        playSound('click');
        document.querySelectorAll('.tab-page').forEach(t => { t.classList.add('hidden'); t.classList.remove('active'); });
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('tab-' + id)?.classList.remove('hidden');
        document.getElementById('tab-' + id)?.classList.add('active');
        document.getElementById('nav-' + id)?.classList.add('active');
    },

    openModal(id) { playSound('click'); if(id === 'modal-mines') minesGame.initUI(); document.getElementById(id).classList.remove('hidden'); },
    closeModal(id) { playSound('click'); document.getElementById(id).classList.add('hidden'); if(id === 'modal-crash') crashGame.inGame = false; if(id === 'modal-mines') minesGame.endGame(false); },

    async usePromo() {
        const code = document.getElementById('promo-input').value;
        const res = await fetch('/api/promo/use', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: this.userId, code }) });
        const data = await res.json();
        if (data.success) { playSound('win'); alert("Success! +" + data.amount + " TON"); location.reload(); } else { playSound('bomb'); alert("Error or code used"); }
    },

    async requestWithdraw() {
        const amount = parseFloat(document.getElementById('withdraw-amount').value);
        const wallet = document.getElementById('withdraw-wallet').value;
        if (!wallet || amount < 1) return alert("Enter wallet and amount (Min 1 TON)");
        const res = await fetch('/api/withdraw', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: this.userId, amount, wallet }) });
        const data = await res.json();
        if (data.success) { alert("Withdrawal request sent!"); this.balances.real = data.balance; this.updateUI(); } else { alert("Error: " + data.error); }
    },

    // ADMIN
    checkAdmin() { const pass = prompt("Password:"); if (pass === "7788") document.getElementById('modal-admin').classList.remove('hidden'); },
    verifyAdmin() { if (document.getElementById('admin-pass').value === "7788") { document.getElementById('admin-controls').classList.remove('hidden'); playSound('win'); } else { playSound('bomb'); } },
    async admUpdate(m) {
        const id = document.getElementById('adm-id').value; const amt = document.getElementById('adm-amount').value;
        await fetch('/api/balance/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: id, mode: m, amount: Number(amt) }) });
        alert("Balance Updated!");
    },
    async addPromo() {
        const code = document.getElementById('admin-promo-code').value; const amount = document.getElementById('admin-promo-amt').value;
        await fetch('/api/admin/promo', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ code, amount: Number(amount), activations: 100, usedBy: [] }) });
        alert("Promo created!");
    },
    async loadWithdrawals() {
        const res = await fetch('/api/admin/withdrawals'); const data = await res.json();
        const c = document.getElementById('admin-withdrawals'); c.innerHTML = '';
        if (data.length === 0) c.innerHTML = '<p class="text-muted">No requests</p>';
        data.forEach(w => { c.innerHTML += `<div class="p-2 border border-gray-700 rounded mb-2"><p>ID: ${w.userId}</p><p class="text-green">${w.amount} TON</p><p class="text-[10px] break-all">${w.wallet}</p></div>`; });
    }
};

const crashGame = {
    state: 'betting', inGame: false, betAmt: 0,
    action() {
        playSound('click'); const btn = document.getElementById('crash-btn');
        if (this.state === 'betting' && !this.inGame) {
            this.betAmt = parseFloat(document.getElementById('crash-bet').value);
            const bal = app.mode === 'real' ? app.balances.real : app.balances.demo;
            if (this.betAmt >= 0.5 && bal >= this.betAmt) {
                app.balances[app.mode] -= this.betAmt; app.updateUI();
                this.inGame = true; btn.innerText = "IN GAME..."; btn.style.background = "#334155";
            } else { alert("Insufficient funds"); }
        } else if (this.state === 'flying' && this.inGame) {
            this.inGame = false; const win = this.betAmt * parseFloat(document.getElementById('crash-mult').innerText);
            fetch('/api/balance/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: app.userId, mode: app.mode, amount: win, isWin: true }) })
            .then(r => r.json()).then(d => { app.balances = {real: d.real, demo: d.demo}; app.updateUI(); playSound('win'); });
            btn.innerText = "CASHED OUT!"; btn.style.background = "#334155";
        }
    }
};

socket.on('crash_state', s => {
    crashGame.state = s.status; const btn = document.getElementById('crash-btn'); const mult = document.getElementById('crash-mult');
    if (s.status === 'betting') {
        document.getElementById('crash-timer-text').innerText = "Betting... " + s.timer + "s";
        mult.innerText = "1.00x"; mult.style.color = "var(--text-main)"; document.getElementById('crash-rocket').style.transform = `translate(0, 0)`;
        if (!crashGame.inGame) { btn.innerText = "PLACE BET"; btn.style.background = "linear-gradient(90deg, var(--neon-blue), var(--neon-purple))"; }
    }
    if (s.status === 'crashed') {
        document.getElementById('crash-timer-text').innerText = "CRASHED!"; mult.innerText = s.multiplier.toFixed(2) + "x"; mult.style.color = "var(--red)";
        if(crashGame.inGame) { fetch('/api/balance/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: app.userId, mode: app.mode, amount: 0, isLose: true }) }); }
        crashGame.inGame = false; if (btn.innerText !== "CASHED OUT!") { btn.innerText = "CRASHED"; btn.style.background = "var(--red)"; playSound('bomb'); }
    }
});
socket.on('crash_tick', m => {
    document.getElementById('crash-mult').innerText = m + 'x';
    document.getElementById('crash-rocket').style.transform = `translate(${Math.min((m - 1) * 20, 180)}px, -${Math.min((m - 1) * 12, 100)}px)`;
    if (crashGame.inGame) { document.getElementById('crash-btn').innerText = `CASHOUT ${(crashGame.betAmt * m).toFixed(2)}`; document.getElementById('crash-btn').style.background = "var(--green)"; }
});

const minesGame = {
    gridSize: 25, bombs: [], opened: 0, inGame: false, betAmount: 0, mult: 1.00,
    initUI() {
        const grid = document.getElementById('mines-grid'); grid.innerHTML = '';
        for(let i=0; i<this.gridSize; i++) {
            const cell = document.createElement('div'); cell.className = 'mine-cell';
            cell.innerHTML = '<img src="img/red-3d-question-mark-transparent-background.png">';
            cell.onclick = () => this.clickCell(i, cell); grid.appendChild(cell);
        }
    },
    async action() {
        playSound('click'); const btn = document.getElementById('mines-btn');
        if (!this.inGame) {
            this.betAmount = parseFloat(document.getElementById('mines-bet').value);
            const bal = app.mode === 'real' ? app.balances.real : app.balances.demo;
            if (this.betAmount > 0 && bal >= this.betAmount) {
                this.inGame = true; this.opened = 0; this.mult = 1.00;
                const bombCount = parseInt(document.getElementById('mines-count').value); this.bombs = [];
                while(this.bombs.length < bombCount) { const r = Math.floor(Math.random() * this.gridSize); if(!this.bombs.includes(r)) this.bombs.push(r); }
                await this.updateStatsAPI(-this.betAmount, false, false); this.initUI();
                btn.innerText = "CASHOUT"; btn.style.background = "var(--green)";
            } else { alert("Insufficient funds"); }
        } else {
            const win = this.betAmount * this.mult; await this.updateStatsAPI(win, true, false);
            playSound('win'); this.endGame(true);
        }
    },
    async clickCell(index, el) {
        if (!this.inGame || el.classList.contains('open')) return;
        el.classList.add('open');
        if (this.bombs.includes(index)) {
            el.innerHTML = '<img src="img/round-black-bomb-realistic-style.png">'; el.style.background = 'var(--red)'; playSound('bomb');
            await this.updateStatsAPI(0, false, true); this.endGame(false);
        } else {
            el.innerHTML = '<img src="img/free-icon-currency-15208522.png">'; playSound('click'); this.opened++;
            this.mult += 0.08 * parseInt(document.getElementById('mines-count').value); 
            document.getElementById('mines-mult').innerText = this.mult.toFixed(2) + 'x';
            const win = (this.betAmount * this.mult).toFixed(2); document.getElementById('mines-win').innerText = win;
            document.getElementById('mines-btn').innerText = "CASHOUT " + win;
        }
    },
    async updateStatsAPI(amount, isWin, isLose) {
        const res = await fetch('/api/balance/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: app.userId, mode: app.mode, amount, isWin, isLose }) });
        const d = await res.json(); app.balances = { real: d.real, demo: d.demo }; app.updateUI();
    },
    endGame(won) {
        this.inGame = false; document.getElementById('mines-btn').innerText = "PLAY";
        document.getElementById('mines-btn').style.background = "linear-gradient(90deg, var(--neon-blue), var(--neon-purple))";
        const cells = document.querySelectorAll('.mine-cell');
        this.bombs.forEach(b => { if(!cells[b].classList.contains('open')) cells[b].innerHTML = '<img src="img/round-black-bomb-realistic-style.png" style="opacity:0.3">'; });
    }
};

app.init();
