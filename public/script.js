const TMA = {
    tg: window.Telegram.WebApp,
    infoClicks: 0,
    isDemo: true,
    balances: { demo: 50.00, real: 0.00 },

    init() {
        this.tg.ready();
        this.tg.expand();

        // Подгружаем данные из ТГ
        const user = this.tg.initDataUnsafe?.user;
        if (user) {
            if (user.photo_url) document.getElementById('user-avatar').src = user.photo_url;
        }

        // Инициализация TonConnect
        new TON_CONNECT_UI.TonConnectUI({
            manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
            buttonRootId: 'ton-connect-btn'
        });

        // 5 кликов на ИНФО для админки
        document.getElementById('info-trigger').addEventListener('click', (e) => {
            this.infoClicks++;
            if (this.infoClicks >= 5) {
                this.infoClicks = 0;
                this.openModal();
            } else {
                this.loadPage('info', e.currentTarget);
            }
            setTimeout(() => { this.infoClicks = 0; }, 2000);
        });

        // Скрытие загрузки
        setTimeout(() => {
            document.getElementById('splash-screen').classList.add('fade-out');
            document.getElementById('main-app').classList.remove('hidden');
            this.loadPage('main_menu');
        }, 2500);
    },

    toggleBalance() {
        this.isDemo = !this.isDemo;
        const btn = document.getElementById('balance-mode');
        const amount = document.getElementById('balance-amount');
        
        if (this.isDemo) {
            btn.textContent = 'DEMO';
            btn.className = 'mode-badge demo';
            amount.textContent = this.balances.demo.toFixed(2);
        } else {
            btn.textContent = 'REAL';
            btn.className = 'mode-badge real';
            amount.textContent = this.balances.real.toFixed(2);
        }
    },

    async loadPage(name, btn = null) {
        if (btn) {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
        const res = await fetch(`pages/${name}.html`);
        const html = await res.text();
        document.getElementById('content-area').innerHTML = html;

        // Запуск скриптов внутри страниц (для игр)
        const scripts = document.getElementById('content-area').getElementsByTagName('script');
        for (let s of scripts) eval(s.innerText);
    },

    openModal() { document.getElementById('admin-modal').classList.remove('hidden'); },
    closeModal() { document.getElementById('admin-modal').classList.add('hidden'); },

    async checkAdmin() {
        const pass = document.getElementById('admin-pass').value;
        const res = await fetch('/api/verify-admin', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password: pass })
        });
        if (res.ok) {
            this.closeModal();
            this.loadPage('admin_panel');
        } else alert('Wrong PIN');
    }
};

TMA.init();
