const TMA = {
    infoClicks: 0,

    init() {
        // Симуляция загрузки (3 секунды)
        setTimeout(() => {
            document.getElementById('splash-screen').classList.add('fade-out');
            document.getElementById('main-app').classList.remove('hidden');
            this.loadPage('main_menu');
        }, 3000);

        // Механика 5 кликов по Инфо
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

    async loadPage(pageName, btn = null) {
        if (btn) {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
        const res = await fetch(`pages/${pageName}.html`);
        document.getElementById('content-area').innerHTML = await res.text();
    },

    toggleModal(show) {
        document.getElementById('admin-modal').classList.toggle('hidden', !show);
    },

    async checkAdmin() {
        const pass = document.getElementById('admin-pass').value;
        const res = await fetch('/api/verify-admin', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (data.success) {
            this.toggleModal(false);
            this.loadPage('admin_panel');
        } else {
            alert('Неверный код!');
        }
    }
};

TMA.init();
