const tg = window.Telegram.WebApp;
const socket = io();

const app = {
    userId: tg.initDataUnsafe?.user?.id || "local_user",
    mode: 'demo',
    balances: { real: 0, demo: 100 },

    async init() {
        tg.expand();
        
        // Гарантированно убираем загрузку через 3 сек, если всё зависло
        setTimeout(() => this.hideLoader(), 3000);

        try {
            const res = await fetch('/api/init', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ userId: this.userId })
            });
            const data = await res.json();
            if (data) {
                this.balances = { real: data.realBalance, demo: data.demoBalance };
                this.updateUI();
            }
        } catch (err) {
            console.error("Сервер недоступен, работаем в демо", err);
        }
        
        this.hideLoader();
        this.setupSockets();
    },

    hideLoader() {
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
    },

    setupSockets() {
        socket.on('online', n => {
            const el = document.getElementById('online-num');
            if (el) el.innerText = n;
        });
        // Добавь остальные сокеты для краша тут...
    },

    updateUI() {
        const bal = this.mode === 'real' ? this.balances.real : this.balances.demo;
        document.getElementById('main-bal').innerText = bal.toFixed(2);
        document.getElementById('mode-badge').innerText = this.mode.toUpperCase();
    },

    toggleMode() {
        this.mode = this.mode === 'demo' ? 'real' : 'demo';
        this.updateUI();
    },

    setTab(id) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById('tab-' + id).classList.add('active');
    },

    checkAdmin() {
        const pass = prompt("Password:");
        if (pass === "7788") document.getElementById('modal-admin').classList.remove('hidden');
    }
};

app.init();
