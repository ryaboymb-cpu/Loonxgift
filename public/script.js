/**
 * ==============================================================================
 * LOONX GIFTS - MAIN SCRIPT ENGINE v3.0.0
 * ==============================================================================
 * Разработчик: Loonx Team
 * Особенности: Socket.io, TON Connect, Advanced Admin, Game Logic
 */

// --- ГЛОБАЛЬНЫЕ КОНСТАНТЫ ---
const tg = window.Telegram.WebApp;
const socket = io(); // Подключение к твоему бэкенду на Render
let currentUser = null;
let currentBalance = 0;
let adminTaps = 0;
let adminTimer = null;

// --- 1. ИНИЦИАЛИЗАЦИЯ И ЭКРАН ЗАГРУЗКИ ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Loonx Engine Starting...");
    tg.expand();
    tg.ready();

    // Плавное скрытие спиннера после загрузки данных
    setTimeout(async () => {
        await authorizeUser();
        initStars();
        
        const loader = document.getElementById('loading-screen');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 500);
        }
    }, 2800); // Держим спиннер чуть дольше для солидности
});

// --- 2. СИСТЕМА АВТОРИЗАЦИИ (Sync с бэкендом) ---
async function authorizeUser() {
    const initData = tg.initData;
    const userData = tg.initDataUnsafe.user || { id: 0, first_name: "LocalDev" };

    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData, user: userData })
        });
        
        currentUser = await response.json();
        syncUI();
        console.log("✅ User authorized:", currentUser.id);
    } catch (err) {
        console.error("❌ Auth failed:", err);
        notify("Ошибка сервера!", "error");
    }
}

function syncUI() {
    if (!currentUser) return;
    document.getElementById('player-name').innerText = currentUser.username || currentUser.name;
    document.getElementById('user-balance').innerText = currentUser.balance.toFixed(2);
    currentBalance = currentUser.balance;
}

// --- 3. РЕАЛЬНОЕ ВРЕМЯ (Socket.io) ---
socket.on('onlineUpdate', (count) => {
    const counter = document.getElementById('online-counter');
    if (counter) counter.innerText = count;
});

// Живая лента выигрышей
socket.on('liveFeed', (data) => {
    // Здесь можно выводить "User123 выиграл 5 TON в Coinflip"
    console.log("Live Event:", data);
});

// --- 4. СЕКРЕТНАЯ АДМИНКА (10 тапов) ---
document.getElementById('main-header').addEventListener('click', () => {
    adminTaps++;
    clearTimeout(adminTimer);
    
    if (adminTaps >= 10) {
        const password = prompt("ADMIN ACCESS CODE:");
        if (password === "8877") {
            openAdminPanel();
        }
        adminTaps = 0;
    }
    
    adminTimer = setTimeout(() => { adminTaps = 0; }, 2000);
});

function openAdminPanel() {
    tg.HapticFeedback.notificationOccurred('success');
    const panel = document.getElementById('admin-panel');
    if (panel) panel.style.display = 'flex';
}

// --- 5. ЛОГИКА ИГРЫ: CRASH (Пример) ---
let crashMultiplier = 1.0;
let crashInterval = null;

function startCrash() {
    if (currentBalance <= 0) return notify("Пополните баланс!", "error");
    
    crashMultiplier = 1.0;
    document.getElementById('crash-btn').innerText = "ЗАБРАТЬ";
    
    crashInterval = setInterval(() => {
        crashMultiplier += 0.01;
        document.getElementById('multiplier-display').innerText = crashMultiplier.toFixed(2) + "x";
        
        // Рандомный взрыв (шанс зависит от RTP с сервера)
        if (Math.random() < 0.01) { 
            stopCrash(true);
        }
    }, 100);
}

function stopCrash(isBoom) {
    clearInterval(crashInterval);
    if (isBoom) {
        notify("BOOM! Взрыв на " + crashMultiplier.toFixed(2) + "x", "error");
    } else {
        notify("ВЫИГРЫШ! Множитель: " + crashMultiplier.toFixed(2), "success");
    }
}

// --- 6. TON CONNECT & ТРАНЗАКЦИИ ---
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://raw.githubusercontent.com/ton-community/tutorials/main/03-client/test/public/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-btn'
});

async function depositTON() {
    const amountInput = document.getElementById('dep-amount');
    const amount = parseFloat(amountInput.value);
    
    if (!amount || amount < 0.1) return notify("Минимум 0.1 TON", "error");

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
            {
                address: "ВАШ_КОШЕЛЕК_АДМИНА", 
                amount: (amount * 1000000000).toString() 
            }
        ]
    };

    try {
        const result = await tonConnectUI.sendTransaction(transaction);
        notify("Ожидание подтверждения...", "success");
        // Отправляем хеш на сервер для проверки
        socket.emit('checkDeposit', { hash: result.boc, userId: currentUser.id });
    } catch (e) {
        notify("Транзакция отменена", "error");
    }
}

// --- 7. ВИЗУАЛЬНЫЕ ЭФФЕКТЫ (STARS ENGINE) ---
function initStars() {
    const canvas = document.getElementById('stars-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let stars = [];
    for (let i = 0; i < 150; i++) {
        stars.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2,
            speed: Math.random() * 0.5 + 0.2,
            opacity: Math.random()
        });
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        
        stars.forEach(s => {
            ctx.globalAlpha = s.opacity;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
            
            s.y += s.speed;
            if (s.y > canvas.height) s.y = -5;
        });
        
        requestAnimationFrame(draw);
    }
    draw();
}

// --- 8. УТИЛИТЫ ---
function notify(text, type) {
    tg.HapticFeedback.notificationOccurred(type === 'success' ? 'success' : 'error');
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = text;
        toast.className = 'show ' + (type === 'success' ? 'success' : 'error');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

/**
 * ==============================================================================
 * END OF SCRIPT
 * ==============================================================================
 */
