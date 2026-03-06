const app = {
    tg: window.Telegram.WebApp,

    init() {
        this.tg.ready();
        this.tg.expand();
        this.tg.setHeaderColor('#060913'); 
        
        // Данные юзера
        const user = this.tg.initDataUnsafe?.user;
        if (user) {
            document.getElementById('user-name').textContent = user.first_name + (user.last_name ? ' ' + user.last_name : '');
            document.getElementById('user-id').textContent = 'ID: ' + user.id;
            if (user.photo_url) {
                document.getElementById('user-avatar').src = user.photo_url;
            }
        }

        // Подключаем кошелек
        try {
            new TON_CONNECT_UI.TonConnectUI({
                manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
                buttonRootId: 'ton-connect-btn'
            });
        } catch (e) { console.error("TonConnect Error:", e); }

        // Скрываем экран загрузки через 2.5 секунды
        setTimeout(() => {
            document.getElementById('splash-screen').classList.add('fade-out');
        }, 2500);
    },

    switchTab(tabId, btnElement = null) {
        document.querySelectorAll('.tab-page').forEach(page => page.classList.remove('active'));
        
        const targetPage = document.getElementById(`tab-${tabId}`);
        if(targetPage) targetPage.classList.add('active');

        if (btnElement) {
            document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
            btnElement.classList.add('active');
        } else {
            // Если переключаем через кнопку "+", то подсвечиваем кошелек внизу
            document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.nav-item')[1].classList.add('active');
        }
    }
};

app.init();
