const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Базы данных (в памяти)
let promos = []; // { code, activations, amount, usedBy: [] }
let withdrawals = []; // { id, userId, address, amount, status }
let users = {}; // { userId: { realBalance: 0, games: 0, wins: 0, losses: 0 } }

const ADMIN_PASS = '7788';

// Получить данные юзера
app.post('/api/user', (req, res) => {
    const { userId } = req.body;
    if (!users[userId]) users[userId] = { realBalance: 0, games: 0, wins: 0, losses: 0 };
    res.json(users[userId]);
});

// Проверка админа
app.post('/api/admin/verify', (req, res) => {
    if (req.body.password === ADMIN_PASS) res.json({ success: true });
    else res.json({ success: false });
});

// Добавить промокод
app.post('/api/admin/promo', (req, res) => {
    const { code, activations, amount } = req.body;
    promos.push({ code: code.toUpperCase(), activations: Number(activations), amount: Number(amount), usedBy: [] });
    res.json({ success: true });
});

// Активация промокода
app.post('/api/promo/activate', (req, res) => {
    const { userId, code } = req.body;
    const promo = promos.find(p => p.code === code.toUpperCase());

    if (!promo) return res.json({ success: false, message: 'Промокод не найден' });
    if (promo.activations <= 0) return res.json({ success: false, message: 'Лимит активаций исчерпан' });
    if (promo.usedBy.includes(userId)) return res.json({ success: false, message: 'Вы уже активировали этот код' });

    // Успешная активация
    promo.activations -= 1;
    promo.usedBy.push(userId);
    if (!users[userId]) users[userId] = { realBalance: 0, games: 0, wins: 0, losses: 0 };
    users[userId].realBalance += promo.amount;

    res.json({ success: true, amount: promo.amount, newBalance: users[userId].realBalance });
});

// Запрос на вывод
app.post('/api/withdraw/request', (req, res) => {
    const { userId, address, amount } = req.body;
    const user = users[userId];

    if (!user || user.realBalance < amount) return res.json({ success: false, message: 'Недостаточно средств' });
    if (amount < 5) return res.json({ success: false, message: 'Минимальный вывод 5 TON' });

    withdrawals.push({ id: Date.now(), userId, address, amount, status: 'pending', userBalance: user.realBalance });
    res.json({ success: true });
});

// Получить список выводов (для админа)
app.get('/api/admin/withdrawals', (req, res) => {
    res.json(withdrawals.filter(w => w.status === 'pending'));
});

// Одобрить/Отклонить вывод
app.post('/api/admin/withdraw/resolve', (req, res) => {
    const { id, action } = req.body;
    const request = withdrawals.find(w => w.id === id);
    if (!request) return res.json({ success: false });

    if (action === 'approve') {
        users[request.userId].realBalance -= request.amount; // Списываем баланс
        request.status = 'approved';
    } else {
        request.status = 'rejected';
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
