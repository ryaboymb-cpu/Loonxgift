require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Раздаем фронтенд

// Твои ENV
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '7788';

// Подключение к MongoDB
if (MONGO_URI) {
    mongoose.connect(MONGO_URI).then(() => console.log('✅ База подключена'));
}

// Эндпоинт для проверки админки
app.post('/api/admin-auth', (req, res) => {
    const { code } = req.body;
    if (code === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
