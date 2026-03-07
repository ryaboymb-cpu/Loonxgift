const tg = window.Telegram.WebApp;
const socket = io();

// --- ГЕНЕРАТОР ЗВУКОВ (БЕЗ ФАЙЛОВ) ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;
function playSound(type) {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    if (type === 'click') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(600, now);
        gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'win') {
        osc.type = 'triangle'; osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
        gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    } else if (type === 'bomb') {
        osc.type = 'square'; osc.frequency.setValueAtTime(100, now); osc.frequency.exponentialRampToValueAtTime(20, now + 0.3);
        gain.gain.setValueAtTime(0.2, now); gain.gain.linearRampToValueAtTime(0, now + 0.4);
        osc.start(now); osc.stop(now + 0.4);
    }
}

// Слушатель кликов по всему документу для базового звука
document.addEventListener('click', (e) => {
    if(e.target.tagName === 'BUTTON' || e.target.closest('.game-card') || e.target.closest('.balance-pill')) {
        playSound('click');
    }
});

// --- ГЛАВНЫЙ APP ---
const app = {
    userId: tg.initDataUnsafe?.user?.id || "dev_" + Math.floor(Math.random()*1000),
    mode: 'demo', balances: { real: 0, demo: 0 },
    
    async init() {
        tg.expand();
        tg.setHeaderColor('#0a0f1d');
        
        const res = await fetch('/api/init', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: this.userId })
        });
        const data = await res.json();
        this.balances = { real: data.realBalance, demo: data.demoBalance };
        this.updateUI();
        
        setTimeout(() => document.getElementById('loader').style.display = 'none', 1500);
        
        socket.on('online', n => document.getElementById('online-num').innerText = n);
        socket.on('update_bal', d => { this.balances = d; this.updateUI(); });
        socket.on('win', d => {
            playSound('win');
            this.balances = { real: d.real, demo: d.demo };
            this.updateUI();
            crashGame.inGame = false;
        });
    },

    updateUI() {
        const b = this.mode === 'real' ? this.balances.real : this.balances.demo;
        document.getElementById('main-bal').innerText = b.toFixed(2);
        document.getElementById('real-val').innerText = this.balances.real.toFixed(4);
        document.getElementById('mode-badge').innerText = this.mode.toUpperCase();
        document.getElementById('mode-badge').style.background = this.mode === 'real' ? '#10b981' : '#8b5cf6';
    },

    toggleMode() { this.mode = this.mode === 'demo' ? 'real' : 'demo'; this.updateUI(); },
    
    setTab(id) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('tab-' + id).classList.add('active');
        event.currentTarget.classList.add('active');
    },

    openModal(id) { document.getElementById(id).classList.remove('hidden'); },
    closeModal(id) { document.getElementById(id).classList.add('hidden'); },

    connectWallet() {
        const btn = document.getElementById('btn-connect');
        btn.innerHTML = '⏳ Подключение...';
        setTimeout(() => {
            btn.innerHTML = '✅ Кошелек привязан';
            btn.style.background = '#10b981';
            playSound('win');
        }, 1500);
    },

    async usePromo() {
        const code = document.getElementById('promo-input').value;
        const res = await fetch('/api/promo/use', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: this.userId, code })
        });
        const data = await res.json();
        if (data.success) { playSound('win'); tg.showAlert("Успех! +" + data.amount + " TON"); location.reload(); }
        else { playSound('bomb'); tg.showAlert("Ошибка промокода"); }
    },

    checkAdmin() { this.openModal('modal-admin'); },
    verifyAdmin() {
        if (document.getElementById('admin-pass').value === "7788") {
            document.getElementById('admin-controls').classList.remove('hidden');
            playSound('win');
        } else { playSound('bomb'); }
    },
    async addPromo() {
        const code = document.getElementById('admin-promo-code').value;
        const amount = document.getElementById('admin-promo-amt').value;
        await fetch('/api/admin/promo', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ code, amount: Number(amount), activations: 100, usedBy: [] })
        });
        alert("Промокод создан!");
    }
};

// --- CRASH ---
const crashGame = {
    state: 'betting', inGame: false,
    action() {
        const btn = document.getElementById('crash-btn');
        if (this.state === 'betting' && !this.inGame) {
            const amt = parseFloat(document.getElementById('crash-bet').value);
            if (amt > 0) {
                socket.emit('place_bet', { userId: app.userId, amount: amt, mode: app.mode });
                this.inGame = true;
                btn.innerText = "В ИГРЕ...";
                btn.style.background = "#64748b";
            }
        } else if (this.state === 'flying' && this.inGame) {
            socket.emit('cashout');
            btn.innerText = "ВЫВЕЛИ!";
        }
    }
};

socket.on('crash_state', s => {
    crashGame.state = s.status;
    const btn = document.getElementById('crash-btn');
    const mult = document.getElementById('crash-mult');
    
    if (s.status === 'betting') {
        document.getElementById('crash-timer-text').innerText = "Ставки... " + s.timer + "с";
        mult.innerText = "1.00x"; mult.style.color = "var(--text-main)";
        document.getElementById('crash-rocket').style.transform = `translate(0, 0) rotate(0deg)`;
        if (!crashGame.inGame) { btn.innerText = "СТАВКА"; btn.style.background = "linear-gradient(90deg, var(--neon-blue), var(--neon-purple))"; }
    }
    if (s.status === 'crashed') {
        document.getElementById('crash-timer-text').innerText = "ВЗРЫВ!";
        mult.innerText = s.multiplier.toFixed(2) + "x"; mult.style.color = "#ef4444";
        crashGame.inGame = false;
        if (btn.innerText !== "ВЫВЕЛИ!") { btn.innerText = "КРАШ"; btn.style.background = "#ef4444"; playSound('bomb'); }
    }
});

socket.on('crash_tick', m => {
    document.getElementById('crash-mult').innerText = m + 'x';
    const moveX = Math.min((m - 1) * 30, 200);
    const moveY = Math.min((m - 1) * 20, 150);
    document.getElementById('crash-rocket').style.transform = `translate(${moveX}px, -${moveY}px) rotate(45deg)`;
    
    if (crashGame.inGame) {
        document.getElementById('crash-btn').innerText = `ЗАБРАТЬ ${(document.getElementById('crash-bet').value * m).toFixed(2)}`;
        document.getElementById('crash-btn').style.background = "#10b981";
    }
});

// --- MINES ---
const minesGame = {
    gridSize: 25, bombs: [], opened: 0, inGame: false, betAmount: 0, mult: 1.00,

    initUI() {
        const grid = document.getElementById('mines-grid');
        grid.innerHTML = '';
        for(let i=0; i<this.gridSize; i++) {
            const cell = document.createElement('div');
            cell.className = 'mine-cell glow-box';
            // Неоткрытая ячейка (Красный вопрос)
            cell.innerHTML = '<img src="img/red-3d-question-mark-transparent-background.png">';
            cell.onclick = () => this.clickCell(i, cell);
            grid.appendChild(cell);
        }
    },

    async action() {
        if (!this.inGame) {
            this.betAmount = parseFloat(document.getElementById('mines-bet').value);
            const bal = app.mode === 'real' ? app.balances.real : app.balances.demo;
            
            if (this.betAmount > 0 && bal >= this.betAmount) {
                // Списываем ставку локально + на сервере
                await fetch('/api/balance/update', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ userId: app.userId, mode: app.mode, amount: -this.betAmount })
                });
                
                app.balances[app.mode] -= this.betAmount;
                app.updateUI();

                this.startGame();
            } else { alert("Недостаточно средств"); }
        } else {
            // Cashout
            const win = this.betAmount * this.mult;
            await fetch('/api/balance/update', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ userId: app.userId, mode: app.mode, amount: win })
            });
            app.balances[app.mode] += win;
            app.updateUI();
            
            playSound('win');
            tg.showAlert(`Выведено: ${win.toFixed(2)}`);
            this.endGame(true);
        }
    },

    startGame() {
        this.inGame = true; this.opened = 0; this.mult = 1.00;
        this.updateStats();
        document.getElementById('mines-btn').innerText = "ЗАБРАТЬ 0.00";
        document.getElementById('mines-btn').style.background = "#10b981";
        
        const bombCount = parseInt(document.getElementById('mines-count').value);
        this.bombs = [];
        while(this.bombs.length < bombCount) {
            const r = Math.floor(Math.random() * this.gridSize);
            if(!this.bombs.includes(r)) this.bombs.push(r);
        }
        this.initUI();
    },

    clickCell(index, el) {
        if (!this.inGame || el.classList.contains('open')) return;
        
        el.classList.add('open');
        if (this.bombs.includes(index)) {
            // Взрыв
            el.innerHTML = '<img src="img/round-black-bomb-realistic-style.png">';
            el.style.background = '#ef4444';
            playSound('bomb');
            this.endGame(false);
        } else {
            // Кристалл (TON)
            el.innerHTML = '<img src="img/free-icon-currency-15208522.png">';
            playSound('click');
            this.opened++;
            
            // Расчет множителя (простая математика)
            const b = this.bombs.length;
            this.mult += (0.05 * b) + (this.opened * 0.02); 
            this.updateStats();
        }
    },

    updateStats() {
        document.getElementById('mines-mult').innerText = this.mult.toFixed(2) + 'x';
        const win = (this.betAmount * this.mult).toFixed(2);
        document.getElementById('mines-win').innerText = win;
        if(this.inGame && this.opened > 0) {
            document.getElementById('mines-btn').innerText = "ЗАБРАТЬ " + win;
        }
    },

    endGame(won) {
        this.inGame = false;
        document.getElementById('mines-btn').innerText = "ИГРАТЬ";
        document.getElementById('mines-btn').style.background = "linear-gradient(90deg, var(--neon-blue), var(--neon-purple))";
        
        // Показываем все мины
        const cells = document.querySelectorAll('.mine-cell');
        this.bombs.forEach(b => {
            if (!cells[b].classList.contains('open')) {
                cells[b].innerHTML = '<img src="img/round-black-bomb-realistic-style.png" style="opacity:0.5">';
            }
        });
    }
};

minesGame.initUI();
app.init();
