const app = {
    tg: window.Telegram.WebApp,
    isDemo: true,
    balances: { demo: 50.00, real: 0.00 },
    adminClicks: 0,
    validPromos: ["START", "LOONX"], // Список рабочих промокодов

    init() {
        this.tg.ready();
        this.tg.expand();
        this.tg.setHeaderColor('#04060b');

        // Подгружаем имя из ТГ
        const user = this.tg.initDataUnsafe?.user;
        if (user) {
            document.getElementById('user-name').textContent = user.first_name;
            document.getElementById('user-id').textContent = 'ID: ' + user.id;
            if (user.photo_url) document.getElementById('user-avatar').src = user.photo_url;
        }

        // Скрываем сплэш
        setTimeout(() => document.getElementById('splash-screen').classList.add('fade-out'), 2000);
        setTimeout(() => document.getElementById('splash-screen').style.display = 'none', 2500);

        this.initTonConnect();
    },

    toggleBalance() {
        this.isDemo = !this.isDemo;
        const val = document.getElementById('balance-value');
        const type = document.getElementById('balance-type');
        const label = document.getElementById('mode-label');

        if (this.isDemo) {
            val.textContent = this.balances.demo.toFixed(2);
            type.textContent = 'DEMO';
            type.className = 'type-demo';
            label.textContent = 'DEMO MODE';
        } else {
            val.textContent = this.balances.real.toFixed(2);
            type.textContent = 'REAL';
            type.className = 'type-real';
            label.textContent = 'REAL MODE';
        }
    },

    switchTab(id, btn) {
        document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
        document.getElementById('tab-' + id).classList.add('active');
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    },

    activatePromo() {
        const input = document.getElementById('promo-input');
        const code = input.value.toUpperCase();
        
        if (this.validPromos.includes(code)) {
            alert('Промокод активирован! +1.00 TON (Demo)');
            this.balances.demo += 1.0;
            // Удаляем из списка, так как он одноразовый
            this.validPromos = this.validPromos.filter(p => p !== code);
            this.updateUI();
            input.value = '';
        } else {
            alert('Неверный или уже использованный код');
        }
    },

    updateUI() {
        if (this.isDemo) document.getElementById('balance-value').textContent = this.balances.demo.toFixed(2);
    },

    // Админка: 10 кликов по логотипу
    adminClick() {
        this.adminClicks++;
        if (this.adminClicks >= 10) {
            document.getElementById('admin-panel').classList.remove('hidden');
            this.adminClicks = 0;
        }
        setTimeout(() => this.adminClicks = 0, 3000);
    },

    addPromo() {
        const code = document.getElementById('new-promo').value.toUpperCase();
        if (code) {
            this.validPromos.push(code);
            alert('Промокод ' + code + ' добавлен!');
            document.getElementById('new-promo').value = '';
        }
    },

    closeAdmin() { document.getElementById('admin-panel').classList.add('hidden'); },

    initTonConnect() {
        try {
            new TON_CONNECT_UI.TonConnectUI({
                manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
                buttonRootId: 'ton-connect-btn'
            });
        } catch(e) {}
    }
};

app.init();
