const TMA = {
    infoClicks: 0,
    isDemo: true, // По умолчанию демо-счет
    balances: { demo: 50.00, real: 0.00 },
    tonConnectUI: null,

    async init() {
        // Инициализация TonConnect
        this.tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
            manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
            buttonRootId: 'ton-connect-btn'
        });

        // Загружаем реальный баланс с сервера
        try {
            const res = await fetch('/api/user-balance');
            const data = await res.json();
            this.balances.real = data.realBalance;
        } catch(e) { console.log('Офлайн режим'); }

        // Скрываем сплэш через 2 секунды
        setTimeout(() => {
            document.getElementById('splash-screen').classList.add('fade-out');
            document.getElementById('main-app').classList.remove('hidden');
            this.updateBalanceUI();
            this.loadPage('main_menu');
        }, 2000);

        // Пасхалка: 5 кликов на ИНФО
        document.getElementById('info-btn').addEventListener('click', (e) => {
            this.infoClicks++;
            if (this.infoClicks >= 5) {
                this.infoClicks = 0;
                this.toggleModal(true);
            } else {
                this.loadPage('info', e.target);
            }
            setTimeout(() => { this.infoClicks = 0; }, 2000);
        });
    },

    toggleBalanceMode() {
        this.isDemo = !this.isDemo;
        this.updateBalanceUI();
    },

    updateBalanceUI() {
        const modeBtn = document.getElementById('balance-mode');
        const amountDisplay = document.getElementById('balance-amount');
        
        if (this.isDemo) {
            modeBtn.textContent = 'DEMO';
            modeBtn.className = 'mode-badge demo';
            amountDisplay.textContent = this.balances.demo.toFixed(2);
            amountDisplay.style.color = '#fff';
        } else {
            modeBtn.textContent = 'REAL';
            modeBtn.className = 'mode-badge real';
            amountDisplay.textContent = this.balances.real.toFixed(2);
            amountDisplay.style.color = '#4ade80';
        }
    },

    // Метод для игр: проверка и списание ставки
    placeBet(amount) {
        if (amount <= 0) { alert('Ставка должна быть больше нуля!'); return false; }
        const activeBalance = this.isDemo ? this.balances.demo : this.balances.real;
        
        if (activeBalance < amount) {
            alert('Недостаточно средств на балансе!');
            return false;
        }
        
        if (this.isDemo) this.balances.demo -= amount;
        else this.balances.real -= amount;
        
        this.updateBalanceUI();
        return true;
    },

    // Метод для игр: зачисление выигрыша
    addWin(amount) {
        if (this.isDemo) this.balances.demo += amount;
        else this.balances.real += amount;
        this.updateBalanceUI();
    },

    async loadPage(pageName, btn = null) {
        if (btn) {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
        const res = await fetch(`pages/${pageName}.html`);
        document.getElementById('content-area').innerHTML = await res.text();
        
        // Перезапуск скриптов внутри загруженной страницы (для Crash и Mines)
        const scripts = document.getElementById('content-area').getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            eval(scripts[i].innerText);
        }
    },

    toggleModal(show) { document.getElementById('admin-modal').classList.toggle('hidden', !show); },

    async checkAdmin() {
        const pass = document.getElementById('admin-pass').value;
        const res = await fetch('/api/verify-admin', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (data.success) {
            this.toggleModal(false);
            this.loadPage('admin_panel');
        } else alert('Неверный код!');
    }
};

window.onload = () => TMA.init();
