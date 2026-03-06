const app = {
    tg: window.Telegram.WebApp,

    init() {
        // Говорим ТГ, что мы загрузились
        this.tg.ready();
        this.tg.expand();
        this.tg.setHeaderColor('#0a0e17'); // Делаем шторку ТГ в цвет приложения
        
        // Подтягиваем данные юзера
        const user = this.tg.initDataUnsafe?.user;
        if (user) {
            document.getElementById('user-name').textContent = user.first_name + (user.last_name ? ' ' + user.last_name : '');
            document.getElementById('user-id').textContent = 'ID: ' + user.id;
            if (user.photo_url) {
                document.getElementById('user-avatar').src = user.photo_url;
            }
        }

        // Подключаем кошелек (ВАЖНО: манифест должен быть рабочим!)
        try {
            new TON_CONNECT_UI.TonConnectUI({
                manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
                buttonRootId: 'ton-connect-btn'
            });
        } catch (e) {
            console.error("TonConnect Error:", e);
        }
    },

    // Функция переключения вкладок
    switchTab(tabId, btnElement = null) {
        // Скрываем все страницы
        document.querySelectorAll('.tab-page').forEach(page => {
            page.classList.remove('active');
        });
        
        // Показываем нужную
        const targetPage = document.getElementById(`tab-${tabId}`);
        if(targetPage) targetPage.classList.add('active');

        // Меняем цвет иконок в нижнем меню
        if (btnElement) {
            document.querySelectorAll('.nav-item').forEach(btn => {
                btn.classList.remove('active');
            });
            btnElement.classList.add('active');
        }
    }
};

// Запускаем
app.init();
