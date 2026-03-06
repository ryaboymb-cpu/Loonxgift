const TMA = {
    infoClicks: 0,
    
    init() {
        // Логика 5 кликов на Инфо
        document.getElementById('info-btn').addEventListener('click', () => {
            this.infoClicks++;
            if (this.infoClicks >= 5) {
                this.infoClicks = 0;
                this.adminLogin();
            }
            setTimeout(() => { this.infoClicks = 0; }, 2000);
        });
        this.loadPage('main_menu');
    },

    async loadPage(name) {
        const res = await fetch(`pages/${name}.html`);
        document.getElementById('content').innerHTML = await res.text();
    },

    async adminLogin() {
        const pin = prompt("Введите ADMIN_PASSWORD (7788):");
        const res = await fetch('/api/admin-auth', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ code: pin })
        });
        const data = await res.json();
        if (data.success) {
            this.loadPage('admin_panel');
        } else {
            alert("Ошибочка, бро!");
        }
    }
};

window.onload = () => TMA.init();
