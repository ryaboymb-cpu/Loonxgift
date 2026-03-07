const app = {
    tg: window.Telegram.WebApp,
    userId: 'test_user', // Дефолт, если не в ТГ
    isDemo: true,
    balances: { demo: 50.00, real: 0.00 },
    adminClicks: 0,

    init() {
        this.tg.ready();
        this.tg.expand();
        this.tg.setHeaderColor('#04060b');

        const user = this.tg.initDataUnsafe?.user;
        if (user) {
            this.userId = String(user.id);
            document.getElementById('user-name').textContent = user.first_name;
            document.getElementById('user-id').textContent = 'ID: ' + user.id;
            if (user.photo_url) document.getElementById('user-avatar').src = user.photo_url;
        }

        setTimeout(() => document.getElementById('splash-screen').classList.add('fade-out'), 2000);
        setTimeout(() => document.getElementById('splash-screen').style.display = 'none', 2500);

        this.initTonConnect();
        this.fetchUserData(); // Тянем инфу с сервера
    },

    // --- СЕРВЕРНЫЕ ЗАПРОСЫ ---
    async apiCall(endpoint, data = {}) {
        try {
            const res = await fetch(`/api/${endpoint}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return await res.json();
        } catch (e) {
            console.error(e);
            return { success: false, message: 'Ошибка сервера' };
        }
    },

    async fetchUserData() {
        const data = await this.apiCall('user', { userId: this.userId });
        if (data) {
            this.balances.real = data.realBalance;
            document.getElementById('stat-games').textContent = data.games;
            document.getElementById('stat-wins').textContent = data.wins;
            document.getElementById('stat-losses').textContent = data.losses;
            this.updateUI();
        }
    },

    // --- UI ЛОГИКА ---
    toggleBalance() {
        this.isDemo = !this.isDemo;
        this.updateUI();
    },

    updateUI() {
        const val = document.getElementById('balance-value');
        const type = document.getElementById('balance-type');
        const label = document.getElementById('mode-label');

        if (this.isDemo) {
            val.textContent = this.balances.demo.toFixed(2);
            type.textContent = 'DEMO'; type.className = 'type-demo'; label.textContent = 'DEMO MODE';
        } else {
            val.textContent = this.balances.real.toFixed(2);
            type.textContent = 'REAL'; type.className = 'type-real'; label.textContent = 'REAL MODE';
        }
        document.getElementById('wallet-real-balance').textContent = this.balances.real.toFixed(2) + ' TON';
    },

    switchTab(id, btn) {
        document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
        document.getElementById('tab-' + id).classList.add('active');
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if(id === 'wallet' || id === 'profile') this.fetchUserData();
    },

    openModal(id) { document.getElementById(id).classList.remove('hidden'); },
    closeModal(id) { document.getElementById(id).classList.add('hidden'); },

    // --- ПРОМОКОДЫ ---
    async activatePromo() {
        const code = document.getElementById('promo-input').value;
        if (!code) return;
        const res = await this.apiCall('promo/activate', { userId: this.userId, code });
        if (res.success) {
            alert(`Успех! Вам начислено ${res.amount} REAL TON`);
            this.balances.real = res.newBalance;
            this.updateUI();
            document.getElementById('promo-input').value = '';
        } else {
            alert(res.message);
        }
    },

    // --- ВЫВОД СРЕДСТВ ---
    openWithdrawModal() {
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('withdraw-address').value = '';
        this.openModal('withdraw-modal');
    },

    async requestWithdraw() {
        const address = document.getElementById('withdraw-address').value;
        const amount = Number(document.getElementById('withdraw-amount').value);
        if (!address || !amount) return alert('Заполните все поля');
        
        const res = await this.apiCall('withdraw/request', { userId: this.userId, address, amount });
        if (res.success) {
            alert('Заявка на вывод успешно создана!');
            this.closeModal('withdraw-modal');
        } else {
            alert(res.message);
        }
    },

    // --- АДМИНКА ---
    adminClick() {
        this.adminClicks++;
        if (this.adminClicks >= 10) {
            this.openModal('admin-auth-modal');
            this.adminClicks = 0;
        }
        setTimeout(() => this.adminClicks = 0, 3000);
    },

    async verifyAdmin() {
        const pass = document.getElementById('admin-pass-input').value;
        const res = await this.apiCall('admin/verify', { password: pass });
        if (res.success) {
            this.closeModal('admin-auth-modal');
            this.openModal('admin-panel');
            this.loadAdminWithdrawals();
        } else {
            alert('Неверный пароль!');
        }
        document.getElementById('admin-pass-input').value = '';
    },

    async addPromo() {
        const code = document.getElementById('new-promo-code').value;
        const acts = document.getElementById('new-promo-acts').value;
        const amt = document.getElementById('new-promo-amt').value;
        if (!code || !acts || !amt) return alert('Заполните все поля');

        const res = await this.apiCall('admin/promo', { code, activations: acts, amount: amt });
        if (res.success) {
            alert(`Промокод ${code} создан!`);
            document.getElementById('new-promo-code').value = '';
        }
    },

    async loadAdminWithdrawals() {
        try {
            const res = await fetch('/api/admin/withdrawals');
            const list = await res.json();
            const container = document.getElementById('admin-withdraw-list');
            container.innerHTML = '';
            
            if (list.length === 0) return container.innerHTML = '<p style="color:#888; font-size:12px;">Нет заявок</p>';

            list.forEach(w => {
                container.innerHTML += `
                    <div class="w-card">
                        <p>ID Игрока: <b>${w.userId}</b></p>
                        <p>Баланс игрока: <b>${w.userBalance} TON</b></p>
                        <p>Сумма вывода: <b>${w.amount} TON</b></p>
                        <p style="word-break: break-all;">Кошелек: ${w.address}</p>
                        <div class="w-btns">
                            <button class="w-btn-yes" onclick="app.resolveWithdraw(${w.id}, 'approve')">ОДОБРИТЬ</button>
                            <button class="w-btn-no" onclick="app.resolveWithdraw(${w.id}, 'reject')">ОТКЛОНИТЬ</button>
                        </div>
                    </div>
                `;
            });
        } catch (e) { console.error(e); }
    },

    async resolveWithdraw(id, action) {
        const res = await this.apiCall('admin/withdraw/resolve', { id, action });
        if (res.success) {
            alert(action === 'approve' ? 'Вывод одобрен и баланс списан' : 'Вывод отклонен');
            this.loadAdminWithdrawals();
            this.fetchUserData(); // Обновляем свой баланс, если админ одобряет свой же вывод
        }
    },

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
