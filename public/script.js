/**
 * 👑 LOONX GIFTS - CORE FRONTEND V7.0
 * 1. Полная интеграция TON Connect (Депозиты)
 * 2. Движок Crash & Mines
 * 3. Система Haptic Feedback (Вибрация)
 * 4. Скрытая админка (10 тапов)
 */

const tg = window.Telegram.WebApp;
const socket = io();

// Расширяем приложение на весь экран
tg.expand();
tg.ready();

// Состояние приложения
let currentView = 'crash';
let adminTaps = 0;
let userBalance = 0;
let myUsername = "Player";

// --- 1. ИНИЦИАЛИЗАЦИЯ TON CONNECT ---
// Замени 'YOUR_WALLET_ADDRESS' на свой реальный TON кошелек!
const MY_WALLET = "UQXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"; 

const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-box'
});

// Функция для совершения депозита
async function makeDeposit() {
    const amount = document.getElementById('dep-amount').value;
    if (!amount || amount < 0.1) {
        tg.showAlert("Минимальная сумма депозита — 0.1 TON");
        return;
    }

    // Переводим TON в нано-единицы (1 TON = 10^9)
    const nanoAmount = (parseFloat(amount) * 1000000000).toString();

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 60, // 60 секунд на оплату
        messages: [
            {
                address: MY_WALLET, 
                amount: nanoAmount,
            }
        ]
    };

    try {
        tg.HapticFeedback.impactOccurred('heavy');
        const result = await tonConnectUI.sendTransaction(transaction);
        
        // Если транзакция отправлена успешно
        tg.showAlert("✅ Транзакция отправлена! Баланс обновится после подтверждения в сети (1-2 мин).");
        console.log("Tx Result:", result);
    } catch (e) {
        console.error("Deposit Error:", e);
        tg.showAlert("❌ Ошибка при оплате или пользователь отменил транзакцию.");
    }
}

// --- 2. АНИМАЦИЯ ЗВЕЗДНОГО НЕБА (CANVAS) ---
const canvas = document.getElementById('stars-canvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let stars = Array.from({ length: 100 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: Math.random() * 2,
    speed: 0.2 + Math.random() * 0.5
}));

function animateStars() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    stars.forEach(s => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        s.y += s.speed;
        if (s.y > canvas.height) s.y = 0;
    });
    requestAnimationFrame(animateStars);
}
animateStars();

// --- 3. СКРЫТАЯ АДМИНКА ---
function handleAdminTap() {
    adminTaps++;
    tg.HapticFeedback.impactOccurred('light');
    if (adminTaps >= 10) {
        socket.emit('trigger_admin', tg.initDataUnsafe.user?.id || 12345);
        tg.showAlert("🔐 Запрос на вход отправлен в Telegram!");
        adminTaps = 0;
    }
    setTimeout(() => { adminTaps = 0; }, 5000);
}

// --- 4. УПРАВЛЕНИЕ ВКЛАДКАМИ ---
function setTab(name, element) {
    currentView = name;
    
    // Скрываем все виды
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    // Показываем нужный
    const target = document.getElementById('v-' + name);
    if(target) target.classList.add('active');

    // Обновляем визуальное состояние кнопок
    document.querySelectorAll('.g-btn, .nav-item').forEach(el => el.classList.remove('active'));
    if(element) element.classList.add('active');

    // Если открыли мины — инициализируем поле
    if(name === 'mines') initMines();
    
    tg.HapticFeedback.impactOccurred('medium');
}

// --- 5. ЛОГИКА ИГРЫ MINES ---
function initMines() {
    const grid = document.getElementById('mine-grid');
    if(!grid) return;
    grid.innerHTML = '';
    
    for(let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.onclick = () => {
            cell.classList.add('open');
            cell.innerHTML = '💎';
            cell.style.boxShadow = '0 0 15px var(--success)';
            tg.HapticFeedback.notificationOccurred('success');
        };
        grid.appendChild(cell);
    }
}

// --- 6. ОБРАБОТКА СТАВКИ CRASH ---
function handlePlay() {
    const amount = document.getElementById('bet-amt').value;
    if (amount <= 0) {
        tg.showAlert("Введите сумму ставки!");
        return;
    }

    tg.HapticFeedback.impactOccurred('medium');
    
    if (currentView === 'crash') {
        socket.emit('place_bet', { 
            username: myUsername, 
            amount: parseFloat(amount) 
        });
    } else {
        tg.showAlert("Эта игра временно в разработке!");
    }
}

// --- 7. РАБОТА С СЕРВЕРОМ (SOCKET.IO) ---
window.onload = () => {
    // Получаем данные юзера из TG или ставим заглушку для теста
    const userData = tg.initDataUnsafe.user || { id: 8423153067, username: "Guest" };
    myUsername = userData.username;
    
    socket.emit('auth', userData);
};

socket.on('init', (data) => {
    document.getElementById('u-name').innerText = data.user.username;
    document.getElementById('bal-real').innerText = data.user.real_balance.toFixed(2) + ' TON';
    
    // Аватарка
    if (data.user.avatar) {
        document.getElementById('u-avatar').src = data.user.avatar;
    }
    
    // История краша
    if (data.crash && data.crash.history) {
        updateHistory(data.crash.history);
    }
});

socket.on('crash_timer', (time) => {
    if (currentView === 'crash') {
        const display = document.getElementById('crash-mult');
        const label = document.getElementById('crash-label');
        display.innerText = time;
        display.style.color = "#ffffff";
        label.innerText = "ВЗЛЕТ ЧЕРЕЗ";
    }
});

socket.on('crash_tick', (mult) => {
    if (currentView === 'crash') {
        const display = document.getElementById('crash-mult');
        display.innerText = mult + 'x';
        display.style.color = "var(--success)";
        document.getElementById('crash-label').innerText = "ПОЛЕТ";
    }
});

socket.on('crash_end', (data) => {
    if (currentView === 'crash') {
        const display = document.getElementById('crash-mult');
        display.innerText = data.point + 'x';
        display.style.color = "var(--error)";
        document.getElementById('crash-label').innerText = "CRASH!";
        updateHistory(data.history);
        tg.HapticFeedback.notificationOccurred('error');
    }
});

socket.on('update_bets', (bets) => {
    const list = document.getElementById('bets-list');
    if (!list) return;
    
    list.innerHTML = bets.length > 0 
        ? bets.map(b => `
            <div class="bet-item">
                <span>👤 ${b.user}</span>
                <span style="color:var(--success)">${b.amount} TON</span>
            </div>
        `).join('')
        : '<div style="color:var(--text-secondary); font-size:0.8rem; text-align:center;">Ставок пока нет</div>';
});

socket.on('bet_accepted', (res) => {
    tg.showAlert(res.msg);
    tg.HapticFeedback.notificationOccurred('success');
});

// Вспомогательная функция для истории
function updateHistory(history) {
    const container = document.getElementById('crash-history');
    if (!container) return;
    container.innerHTML = history.map(h => `<div class="h-node">${h}</div>`).join('');
}
