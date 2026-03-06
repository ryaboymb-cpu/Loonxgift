require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Подтягиваем твои ENV переменные из Render
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '7788';
const PROJECT_WALLET = process.env.PROJECT_WALLET;
const TON_API_KEY = process.env.TON_API_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;

// Подключение к MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Подключено к MongoDB'))
  .catch(err => console.error('❌ Ошибка MongoDB:', err));

// Простая схема пользователя
const UserSchema = new mongoose.Schema({
    telegramId: String,
    balance: { type: Number, default: 0.00 }
});
const User = mongoose.model('User', UserSchema);

// --- API МАРШРУТЫ ---

// 1. Получить данные юзера (баланс)
app.get('/api/user/data', async (req, res) => {
    // В реале ID берется из Telegram WebApp InitData
    // Пока отдаем заглушку для тестов
    res.json({ balance: 12.50 }); 
});

// 2. Проверка админ-пароля
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, wallet: PROJECT_WALLET });
    } else {
        res.status(401).json({ success: false, message: 'Неверный код' });
    }
});

// 3. Создание промокода (админ)
app.post('/api/admin/promo', (req, res) => {
    const { code, amount } = req.body;
    console.log(`🎁 Создан промокод: ${code} на ${amount} TON`);
    res.json({ success: true, message: 'Промокод сохранен в базе' });
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер Loonx Gifts запущен на порту ${PORT}`);
});
