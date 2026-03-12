try { require('dotenv').config(); } catch (e) { console.log("Dotenv не найден, используем Render ENV"); }
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://loonxgift.onrender.com';

mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB Connected')).catch(err => console.log('❌ DB Error:', err));

// --- СХЕМЫ БАЗЫ ДАННЫХ ---
const User = mongoose.model('User', new mongoose.Schema({
    id: String, tgName: String, photoUrl: String,
    realBal: { type: Number, default: 0 }, demoBal: { type: Number, default: 200 },
    games: { type: Number, default: 0 }, wins: { type: Number, default: 0 },
    banned: { type: Boolean, default: false }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String, amount: Number, uses: Number, activatedBy: [String]
}));

// Настройки подкрута (RTP)
const Settings = mongoose.model('Settings', new mongoose.Schema({
    id: { type: String, default: 'main' },
    crashWinChance: { type: Number, default: 60 }, // % шанса на нормальный полет
    minesWinChance: { type: Number, default: 70 }
}));

async function initSettings() {
    let s = await Settings.findOne({ id: 'main' });
    if (!s) await new Settings({ id: 'main' }).save();
}
initSettings();

// --- БОТ TELEGRAM ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🪙 Добро пожаловать в Loonx Gift!\nЛучшие игры уже ждут тебя.`, {
        reply_markup: { inline_keyboard: [[{ text: '🫧играть🫧', web_app: { url: WEB_APP_URL } }]] }
    });
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `💎 *Наши контакты:*\n\n• Creator = @tonfrm\n• Channel = @Loonxnews\n• Support = @LoonxGift_Support\n• Bags = @MsgP2P`, { parse_mode: 'Markdown' });
});

// --- ЛОГИКА CRASH (С подкрутом) ---
let crashState = { status: 'waiting', timer: 10, mult: 1.0 };

async function startCrash() {
    crashState = { status: 'waiting', timer: 10, mult: 1.0 };
    io.emit('crash_update', crashState);
    
    let t = setInterval(async () => {
        crashState.timer--;
        io.emit('crash_update', crashState);
        if(crashState.timer <= 0) {
            clearInterval(t);
            let s = await Settings.findOne({ id: 'main' });
            // Подкрут: Если рандом не попал в winChance, ракета взорвется рано (1.0 - 1.15)
            let isWin = (Math.random() * 100) <= (s ? s.crashWinChance : 60);
            let targetMult = isWin ? (1.5 + Math.random() * 5) : (1.0 + Math.random() * 0.15);
            runRocket(targetMult);
        }
    }, 1000);
}

function runRocket(target) {
    crashState.status = 'flying';
    let fly = setInterval(() => {
        crashState.mult += 0.01 + (crashState.mult * 0.005);
        if(crashState.mult >= target) {
            clearInterval(fly);
            crashState.status = 'crashed';
            io.emit('crash_update', crashState);
            setTimeout(startCrash, 4000);
        } else {
            io.emit('crash_update', { status: 'flying', mult: parseFloat(crashState.mult.toFixed(2)) });
        }
    }, 100);
}
startCrash();

// --- СОКЕТЫ: Онлайн, Промо, Админка ---
io.on('connection', (socket) => {
    // Обновляем онлайн для всех
    io.emit('online_count', io.engine.clientsCount);

    socket.on('disconnect', () => {
        io.emit('online_count', io.engine.clientsCount);
    });

    socket.on('init_user', async (data) => {
        let u = await User.findOneAndUpdate({ id: data.id }, { tgName: data.username, photoUrl: data.photo }, { upsert: true, new: true });
        if (u.banned) return socket.emit('alert', { msg: '❌ Вы заблокированы', type: 'error' });
        socket.userId = u.id;
        socket.emit('user_data', u);
        socket.emit('crash_update', crashState);
    });

    // ИСПРАВЛЕННЫЕ ПРОМОКОДЫ
    socket.on('activate_promo', async (code) => {
        let p = await Promo.findOne({ code: code.toUpperCase() });
        let u = await User.findOne({ id: socket.userId });
        
        if (!p) return socket.emit('alert', { msg: '❌ Промокод не найден', type: 'error' });
        if (p.uses <= 0) return socket.emit('alert', { msg: '❌ Лимит исчерпан', type: 'error' });
        if (p.activatedBy.includes(u.id)) return socket.emit('alert', { msg: '❌ Вы уже активировали этот код', type: 'error' });

        u.realBal += p.amount;
        p.uses--;
        p.activatedBy.push(u.id);
        await u.save(); await p.save();
        
        socket.emit('user_data', u);
        socket.emit('alert', { msg: `✅ Успешно! +${p.amount} REAL`, type: 'success' });
    });

    // АДМИНКА (Запуск без багов)
    socket.on('admin_login', async (pass) => {
        if(pass === 'loonx777') {
            const users = await User.find({});
            const settings = await Settings.findOne({ id: 'main' });
            socket.emit('admin_data', { users, settings });
        } else {
            socket.emit('alert', { msg: '❌ Неверный пароль', type: 'error' });
        }
    });

    socket.on('admin_set_rtp', async (data) => {
        await Settings.findOneAndUpdate({ id: 'main' }, { crashWinChance: data.crash, minesWinChance: data.mines });
        socket.emit('alert', { msg: '✅ RTP обновлен', type: 'success' });
    });
});

app.use(express.static('public'));
server.listen(process.env.PORT || 3000, () => console.log('🚀 Server is running'));
