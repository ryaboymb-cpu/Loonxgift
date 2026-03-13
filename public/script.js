const socket = io();
const tg = window.Telegram.WebApp;
tg.expand();

let user = null;
let currentTab = 'home';
let balanceMode = 'demo'; // 'demo' или 'real'
let tonConnectUI = null;

// === ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ===
window.addEventListener('DOMContentLoaded', () => {
    // 5 секунд загрузки
    setTimeout(() => {
        document.getElementById('loader').style.opacity = '0';
        setTimeout(() => { document.getElementById('loader').style.display = 'none'; }, 500);
    }, 5000);

    initStars();
    initTonConnect();
    
    // Данные юзера из TG
    const initData = tg.initDataUnsafe?.user;
    if (initData) {
        socket.emit('auth', initData);
    } else {
        // Для теста в браузере
        socket.emit('auth', { id: 777, first_name: 'Dev_User', username: 'tester' });
    }
});

// === TON CONNECT ===
function initTonConnect() {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: 'https://' + window.location.host + '/tonconnect-manifest.json',
        buttonRootId: 'ton-connect-button'
    });
}

async function processDeposit() {
    const amount = document.getElementById('deposit-amount').value;
    if (!amount || amount <= 0) return showToast('Введите сумму депозита', 'error');

    try {
        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 60,
            messages: [{
                address: "UQCTqV9scQaZR0DHzOnMrOCCY7z3MIT0QfoNrtUDZiXHY1-K", // ЗАМЕНИ НА СВОЙ
                amount: (amount * 1000000000).toString()
            }]
        };
        await tonConnectUI.sendTransaction(transaction);
        showToast('Транзакция отправлена! Ожидайте зачисления', 'success');
        socket.emit('deposit_check', { amount: amount });
    } catch (e) {
        showToast('Ошибка оплаты', 'error');
    }
user.real_balance += amount; 
await user.save();
io.to(found_socket_id).emit('user_data', user); // Обновить баланс у игрока в реальном времени


// === ОБРАБОТКА ДАННЫХ ОТ СЕРВЕРА ===
socket.on('user_data', (data) => {
    user = data;
    updateUI();
});

socket.on('online_count', (count) => {
    document.getElementById('online-counter').innerText = count;
});

socket.on('toast', (data) => {
    showToast(data.text, data.type);
});

// === ЛОГИКА ИНТЕРФЕЙСА ===
function updateUI() {
    if (!user) return;
    
    // Балансы
    const bal = balanceMode === 'demo' ? user.demo_balance : user.real_balance;
    const cur = balanceMode === 'demo' ? 'D-TON' : 'TON';
    
    document.getElementById('top-balance').innerText = bal.toFixed(2);
    document.getElementById('top-currency').innerText = cur;
    document.getElementById('withdraw-available-bal').innerText = user.real_balance.toFixed(2) + ' TON';

    // Профиль
    document.getElementById('u-avatar').src = user.photo_url || 'https://i.imgur.com/6VBx3io.png';
    document.getElementById('prof-avatar-big').src = user.photo_url || 'https://i.imgur.com/6VBx3io.png';
    document.getElementById('prof-name-big').innerText = user.first_name;
    document.getElementById('st-games').innerText = user.stats_games || 0;
    document.getElementById('st-wins').innerText = user.stats_wins || 0;
    document.getElementById('st-deps').innerText = (user.total_dep || 0) + ' TON';
    document.getElementById('st-withdraws').innerText = (user.total_out || 0) + ' TON';
}

function switchMode() {
    balanceMode = (balanceMode === 'demo') ? 'real' : 'demo';
    const btn = document.querySelector('.balance-switcher');
    document.getElementById('top-mode-label').innerText = balanceMode.toUpperCase();
    if (balanceMode === 'real') btn.classList.add('real-mode');
    else btn.classList.remove('real-mode');
    updateUI();
}

function switchTab(tabId, el) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    
    document.getElementById('tab-' + tabId).classList.add('active');
    el.classList.add('active');
    currentTab = tabId;
}

// === УВЕДОМЛЕНИЯ ===
function showToast(text, type = 'info') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerText = text;
    container.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 3000);
}

// === ИГРА: CRASH (Анимация кадров) ===
let crashInterval;
function crashAction() {
    const btn = document.getElementById('crash-main-btn');
    const bet = parseFloat(document.getElementById('crash-bet-val').value);
    
    if (btn.innerText === 'ПОСТАВИТЬ') {
        socket.emit('crash_bet', { amount: bet, mode: balanceMode });
        btn.innerText = 'ЗАБРАТЬ';
        btn.classList.replace('btn-green-solid', 'btn-blue-solid');
        
        // Запуск анимации ракеты
        const rocket = document.getElementById('rocket-anim');
        rocket.classList.remove('rocket-crashed');
        rocket.classList.add('rocket-flying');
    } else {
        socket.emit('crash_cashout');
    }
}

socket.on('crash_tick', (multiplier) => {
    document.getElementById('crash-multiplier').innerText = multiplier.toFixed(2) + 'x';
});

socket.on('crash_end', () => {
    const btn = document.getElementById('crash-main-btn');
    btn.innerText = 'ПОСТАВИТЬ';
    btn.classList.replace('btn-blue-solid', 'btn-green-solid');
    
    const rocket = document.getElementById('rocket-anim');
    rocket.classList.remove('rocket-flying');
    rocket.classList.add('rocket-crashed');
    showToast('ВЗРЫВ!', 'error');
});

// === ИГРА: COINFLIP (3D Золотая монета) ===
function playCoin(side) {
    const bet = parseFloat(document.getElementById('coin-bet-val').value);
    const coin = document.getElementById('coin-object');
    
    coin.classList.add('coin-flipping');
    socket.emit('coin_play', { side: side, amount: bet, mode: balanceMode });
}

socket.on('coin_result', (data) => {
    const coin = document.getElementById('coin-object');
    setTimeout(() => {
        coin.classList.remove('coin-flipping');
        // Поворот на нужную сторону
        coin.style.transform = data.winSide === 'L' ? 'rotateY(0deg)' : 'rotateY(180deg)';
        
        if (data.win) showToast(`Выиграл +${data.prize} ${data.cur}`, 'success');
        else showToast('Проигрыш', 'error');
    }, 1500);
});

// === ВСПОМОГАТЕЛЬНОЕ ===
function initStars() {
    const container = document.getElementById('stars');
    for (let i = 0; i < 50; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.width = star.style.height = (Math.random() * 3) + 'px';
        star.style.animationDuration = (Math.random() * 5 + 5) + 's';
        star.style.animationDelay = (Math.random() * 10) + 's';
        container.appendChild(star);
    }
}

function openGame(name) {
    document.getElementById('modal-' + name).classList.add('open');
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
}

// Админка (скрытая функция)
let taps = 0;
function handleAdminTaps() {
    taps++;
    if (taps >= 7) {
        document.getElementById('modal-admin').classList.add('open');
        taps = 0;
        socket.emit('admin_load_data');
    // Функция для кнопки "Админ панель"
function clickAdminButton() {
    const pass = prompt("Введите код доступа для управления:");
    if (pass) {
        socket.emit('admin_auth', pass);
    }
}

// Слушаем ответ от сервера
socket.on('admin_ok', (data) => {
    alert("Доступ разрешен!");
    // Здесь код, который открывает твое скрытое окно админки
    document.getElementById('admin-modal').classList.add('active'); 
    
    // Пример отрисовки пользователей в таблицу (Раздел 1: БД)
    const userTable = document.getElementById('admin-user-list');
    if (userTable) {
        userTable.innerHTML = data.users.map(u => `
            <tr>
                <td>${u.tgId}</td>
                <td>${u.username}</td>
                <td>${u.real_balance.toFixed(2)} TON</td>
            </tr>
        `).join('');
    }
});
