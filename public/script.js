const tg = window.Telegram.WebApp;
const socket = io();

const app = {
    userId: tg.initDataUnsafe?.user?.id || "local_dev",
    mode: 'demo',
    balances: { real: 0, demo: 0 },

    async init() {
        tg.expand();
        const res = await fetch('/api/init', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: this.userId })
        });
        const data = await res.json();
        this.balances = { real: data.realBalance, demo: data.demoBalance };
        this.updateUI();
        
        setTimeout(() => document.getElementById('loader').style.display = 'none', 2000);
        
        socket.on('online', n => document.getElementById('online-num').innerText = n);
        socket.on('update_bal', d => { this.balances = d; this.updateUI(); });
        socket.on('win', d => {
            alert(`ВЫИГРАНО: ${d.amount.toFixed(2)} TON`);
            this.balances = { real: d.real, demo: d.demo };
            this.updateUI();
            crash.inGame = false;
        });
    },

    updateUI() {
        const b = this.mode === 'real' ? this.balances.real : this.balances.demo;
        document.getElementById('main-bal').innerText = b.toFixed(2);
        document.getElementById('real-val').innerText = this.balances.real.toFixed(2) + ' TON';
        document.getElementById('mode-text').innerText = this.mode.toUpperCase();
    },

    toggleMode() { this.mode = this.mode === 'demo' ? 'real' : 'demo'; this.updateUI(); },
    
    setTab(id) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById('tab-' + id).classList.add('active');
    },

    openModal(id) { document.getElementById(id).classList.remove('hidden'); },
    closeModal(id) { document.getElementById(id).classList.add('hidden'); },

    async usePromo() {
        const code = document.getElementById('promo-input').value;
        const res = await fetch('/api/promo/use', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: this.userId, code })
        });
        const data = await res.json();
        if (data.success) { alert("Активировано: " + data.amount + " TON"); location.reload(); }
        else alert("Ошибка или код использован");
    },

    checkAdmin() {
        const pass = prompt("Password:");
        if (pass === "7788") this.openModal('modal-admin');
    },

    async addPromo() {
        const code = document.getElementById('admin-promo-code').value;
        const amount = document.getElementById('admin-promo-amt').value;
        await fetch('/api/admin/promo', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ code, amount: Number(amount), activations: 100, usedBy: [] })
        });
        alert("Промо создан!");
    }
};

const crash = {
    state: 'betting', inGame: false,
    action() {
        if (this.state === 'betting' && !this.inGame) {
            const amt = parseFloat(document.getElementById('bet-input').value);
            if (amt >= 0.5 && amt <= 20) {
                socket.emit('place_bet', { userId: app.userId, amount: amt, mode: app.mode });
                this.inGame = true;
                document.getElementById('bet-btn').innerText = "В ИГРЕ...";
            }
        } else if (this.state === 'flying' && this.inGame) {
            socket.emit('cashout');
        }
    }
};

socket.on('crash_state', s => {
    crash.state = s.status;
    if (s.status === 'betting') {
        document.getElementById('crash-info').innerText = "СТАВКИ: " + s.timer;
        document.getElementById('bet-btn').innerText = "СТАВКА";
        document.getElementById('rocket').style.transform = `translate(0, 0)`;
    }
    if (s.status === 'crashed') {
        document.getElementById('crash-info').innerText = "КРАШ! " + s.multiplier + "x";
        crash.inGame = false;
    }
});

socket.on('crash_tick', m => {
    document.getElementById('mult').innerText = m + 'x';
    const moveX = (m - 1) * 35;
    const moveY = (m - 1) * 20;
    document.getElementById('rocket').style.transform = `translate(${moveX}px, -${moveY}px)`;
    if (crash.inGame) {
        document.getElementById('bet-btn').innerText = "ЗАБРАТЬ";
        document.getElementById('bet-btn').style.background = "#00ff64";
    }
});

app.init();
