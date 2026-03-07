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
        osc.frequency.setValueAtTime(600, now); gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1); osc.start(); osc.stop(now + 0.1);
    } else if (type === 'win') {
        osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(800, now + 0.3); gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0, now + 0.5); osc.start(); osc.stop(now + 0.5);
    } else if (type === 'bomb') {
        osc.type = 'square'; osc.frequency.setValueAtTime(100, now); osc.frequency.exponentialRampToValueAtTime(20, now + 0.3); gain.gain.setValueAtTime(0.2, now); osc.start(); osc.stop(now + 0.3);
    }
}

let tonConnectUI;

// --- ГЛАВНЫЙ APP ---
const app = {
    userId: tg.initDataUnsafe?.user?.id || "local_dev_" + Math.floor(Math.random()*1000),
    userName: tg.initDataUnsafe?.user?.first_name || "Player",
    avatarUrl: tg.initDataUnsafe?.user?.photo_url || "img/2793-Photoroom_edit_357020906251818.png",
    mode: 'demo', balances: { real: 0, demo: 50 },
    
    async init() {
        tg.expand();
        tg.setHeaderColor('#0a0f1d');
        
        const res = await fetch('/api/init', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: this.userId })
        });
        const data = await res.json();
        if(data) {
            this.balances = { real: data.realBalance, demo: data.demoBalance };
            // Заполняем профиль
            document.getElementById('profile-name').innerText = this.userName;
            document.getElementById('profile-avatar').src = this.avatarUrl;
            document.getElementById('profile-id').innerText = `ID: ${this.userId}`;
            this.updateStatsUI(data);
        }
        this.updateUI();
        this.initTonConnect();
        
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

    initTonConnect() {
        // ИНИЦИАЛИЗАЦИЯ TON CONNECT UI
        tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
            manifestUrl: 'https://loonxgift.render.com/tonconnect-manifest.json', // Manifest served by express
            buttonRootId: 'ton-connect-button'
        });
    },

    updateUI() {
        const b = this.mode === 'real' ? this.balances.real : this.balances.demo;
        document.getElementById('main-bal').innerText = b.toFixed(2);
        document.getElementById('p-bal').innerText = b.toFixed(2);
        document.getElementById('real-val').innerText = this.balances.real.toFixed(4);
        document.getElementById('mode-badge').innerText = this.mode.toUpperCase();
        
        const pill = document.querySelector('.balance-pill');
        const badge = document.getElementById('mode-badge');
        if(this.mode === 'real') {
            pill.style.borderColor = "var(--green)"; badge.style.color = "var(--green)"; badge.style.background = "rgba(16, 185, 129, 0.1)";
        } else {
            pill.style.borderColor = "var(--neon-purple)"; badge.style.color = "var(--neon-purple)"; badge.style.background = "rgba(139, 92, 246, 0.1)";
        }
    },

    updateStatsUI(data) {
        document.getElementById('p-games').innerText = data.games || 0;
        document.getElementById('p-wins').innerText = data.wins || 0;
        document.getElementById('p-losses').innerText = data.losses || 0;
    },

    toggleMode() {
        playSound('click');
        this.mode = this.mode === 'demo' ? 'real' : 'demo';
        this.updateUI();
    },
    
    // --- ПОЧИНЕНО ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ---
    setTab(id) {
        playSound('click');
        // Скрываем все страницы
        document.querySelectorAll('.tab-page').forEach(t => t.classList.add('hidden'));
        document.querySelectorAll('.tab-page').forEach(t => t.classList.remove('active'));
        
        // Деактивируем кнопки навигации
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        
        // Открываем нужную
        const targetTab = document.getElementById('tab-' + id);
        if(targetTab) {
            targetTab.classList.remove('hidden');
            targetTab.classList.add('active');
        }
        
        // Активируем кнопку
        const targetBtn = document.getElementById('nav-' + id);
        if(targetBtn) targetBtn.classList.add('active');
    },

    // --- ПОЧИНЕНО ОТКРЫТИЕ ИГР ---
    openModal(id) {
        playSound('click');
        // Мины генерим при открытии модалки
        if(id === 'modal-mines') minesGame.initUI();
        document.getElementById(id).classList.remove('hidden');
    },

    closeModal(id) {
        playSound('click');
        document.getElementById(id).classList.add('hidden');
        // Если закрываем игру в процессе — сброс состояний
        if(id === 'modal-crash') crashGame.inGame = false;
        if(id === 'modal-mines') minesGame.endGame(false);
    },

    async usePromo() {
        const code = document.getElementById('promo-input').value;
        const res = await fetch('/api/promo/use', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: this.userId, code })
        });
        const data = await res.json();
        if (data.success) { playSound('win'); tg.showAlert("Успех! +" + data.amount + " TON"); location.reload(); }
        else { playSound('bomb'); tg.showAlert("Ошибка или код использован"); }
    },

    // АДМИНКА
    checkAdmin() {
        const pass = prompt("Password:");
        if (pass === "7788") document.getElementById('modal-admin').classList.remove('hidden');
    },
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

// --- CRASH GAME (Мультиплеер синхронный) ---
const crashGame = {
    state: 'betting', inGame: false,
    action() {
        playSound('click');
        const btn = document.getElementById('crash-btn');
        if (this.state === 'betting' && !this.inGame) {
            const amt = parseFloat(document.getElementById('crash-bet').value);
            const bal = app.mode === 'real' ? app.balances.real : app.balances.demo;
            if (amt >= 0.5 && bal >= amt) {
                // Прямой вызов сокета
                socket.emit('place_bet', { userId: app.userId, amount: amt, mode: app.mode });
                this.inGame = true;
                btn.innerText = "В ИГРЕ..."; btn.style.background = "#334155";
            } else { alert("Недостаточно средств"); }
        } else if (this.state === 'flying' && this.inGame) {
            socket.emit('cashout');
            btn.innerText = "ВЫВЕЛИ!"; btn.style.background = "#334155";
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
        document.getElementById('crash-rocket').style.transform = `translate(0, 0)`;
        if (!crashGame.inGame) { btn.innerText = "СТАВКА"; btn.style.background = "linear-gradient(90deg, var(--neon-blue), var(--neon-purple))"; }
    }
    if (s.status === 'crashed') {
        document.getElementById('crash-timer-text').innerText = "ВЗРЫВ!";
        mult.innerText = s.multiplier.toFixed(2) + "x"; mult.style.color = "var(--red)";
        crashGame.inGame = false;
        if (btn.innerText !== "ВЫВЕЛИ!") { btn.innerText = "КРАШ"; btn.style.background = "var(--red)"; playSound('bomb'); }
    }
});

socket.on('crash_tick', m => {
    document.getElementById('crash-mult').innerText = m + 'x';
    // Плавное движение ракеты по иксу
    const moveX = Math.min((m - 1) * 20, 180);
    const moveY = Math.min((m - 1) * 12, 100);
    document.getElementById('crash-rocket').style.transform = `translate(${moveX}px, -${moveY}px)`;
    
    if (crashGame.inGame) {
        document.getElementById('crash-btn').innerText = `ЗАБРАТЬ ${(document.getElementById('crash-bet').value * m).toFixed(2)}`;
        document.getElementById('crash-btn').style.background = "var(--green)";
    }
});

// --- MINES GAME (Одиночная) ---
const minesGame = {
    gridSize: 25, bombs: [], opened: 0, inGame: false, betAmount: 0, mult: 1.00,
    
    // --- ПОЧИНЕНЫ ИКОНКИ ВОПРОСОВ ---
    initUI() {
        const grid = document.getElementById('mines-grid');
        grid.innerHTML = '';
        for(let i=0; i<this.gridSize; i++) {
            const cell = document.createElement('div');
            cell.className = 'mine-cell';
            // Неоткрытая ячейка -> КРАСНЫЙ ВОПРОС (emoji style)
            cell.innerHTML = '<img src="img/red-3d-question-mark-transparent-background.png">';
            cell.onclick = () => this.clickCell(i, cell);
            grid.appendChild(cell);
        }
    },

    async action() {
        playSound('click');
        const btn = document.getElementById('mines-btn');
        if (!this.inGame) {
            this.betAmount = parseFloat(document.getElementById('mines-bet').value);
            const bal = app.mode === 'real' ? app.balances.real : app.balances.demo;
            if (this.betAmount > 0 && bal >= this.betAmount) {
                // Старт игры, списываем баланс через API
                this.inGame = true; this.opened = 0; this.mult = 1.00;
                const bombCount = parseInt(document.getElementById('mines-count').value);
                this.bombs = [];
                while(this.bombs.length < bombCount) {
                    const r = Math.floor(Math.random() * this.gridSize);
                    if(!this.bombs.includes(r)) this.bombs.push(r);
                }
                
                await this.updateStatsAPI(-this.betAmount, false, false);
                this.initUI();
                btn.innerText = "ЗАБРАТЬ"; btn.style.background = "var(--green)";
            } else { alert("Недостаточно средств"); }
        } else {
            // Кэшаут
            const win = this.betAmount * this.mult;
            await this.updateStatsAPI(win, true, false);
            playSound('win');
            this.endGame(true);
        }
    },

    async clickCell(index, el) {
        if (!this.inGame || el.classList.contains('open')) return;
        el.classList.add('open');
        if (this.bombs.includes(index)) {
            // БОМБА -> ПОРАЖЕНИЕ
            el.innerHTML = '<img src="img/round-black-bomb-realistic-style.png">';
            el.style.background = 'var(--red)';
            playSound('bomb');
            await this.updateStatsAPI(0, false, true); // Проигрыш (games++)
            this.endGame(false);
        } else {
            // КРИСТАЛЛ -> СИНЕЕ ТОН ЛОГО
            el.innerHTML = '<img src="img/free-icon-currency-15208522.png">';
            playSound('click');
            this.opened++;
            // Математика множителя
            this.mult += 0.08 * parseInt(document.getElementById('mines-count').value); 
            this.updateStatsUI();
        }
    },

    updateStatsUI() {
        document.getElementById('mines-mult').innerText = this.mult.toFixed(2) + 'x';
        const win = (this.betAmount * this.mult).toFixed(2);
        document.getElementById('mines-win').innerText = win;
        if(this.inGame) document.getElementById('mines-btn').innerText = "ЗАБРАТЬ " + win;
    },

    // Апдейт статистики и баланса через API
    async updateStatsAPI(amount, isWin, isLose) {
        const res = await fetch('/api/balance/update', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: app.userId, mode: app.mode, amount, isWin, isLose })
        });
        const d = await res.json();
        app.balances = { real: d.real, demo: d.demo };
        app.updateUI();
    },

    endGame(won) {
        this.inGame = false;
        document.getElementById('mines-btn').innerText = "ИГРАТЬ";
        document.getElementById('mines-btn').style.background = "linear-gradient(90deg, var(--neon-blue), var(--neon-purple))";
        // Показываем бомбы
        const cells = document.querySelectorAll('.mine-cell');
        this.bombs.forEach(b => {
            if(!cells[b].classList.contains('open')) cells[b].innerHTML = '<img src="img/round-black-bomb-realistic-style.png" style="opacity:0.3">';
        });
    }
};

app.init();
