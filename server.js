require('dotenv').config();
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors()); 

function _crc16ton(buf){let c=0;for(let i=0;i<buf.length;i++){c^=buf[i]<<8;for(let j=0;j<8;j++)c=(c&0x8000)?(c<<1)^0x1021:c<<1;}return c&0xffff;}
function ensureTonAddr48(a){
    if(!a)return null;
    a=a.replace(/[\r\n\s]/g,'').trim();
    try{
        const rm=a.match(/^(-?[0-9]+):([0-9a-fA-F]{64})$/);
        if(rm){const buf=Buffer.alloc(36);const neg=parseInt(rm[1])<0;buf[0]=neg?0x51:0x11;buf[1]=parseInt(rm[1])&0xff;Buffer.from(rm[2],'hex').copy(buf,2);const crc=_crc16ton(buf.slice(0,34));buf[34]=(crc>>8)&0xff;buf[35]=crc&0xff;return buf.toString('base64url').replace(/=+$/,'');}
        let b64=a.replace(/-/g,'+').replace(/_/g,'/');while(b64.length%4)b64+='=';
        const bytes=Buffer.from(b64,'base64');
        if(bytes.length===36)return Buffer.from(bytes).toString('base64url').replace(/=+$/,'');
        if(bytes.length===34){const buf=Buffer.alloc(36);bytes.copy(buf);const crc=_crc16ton(bytes);buf[34]=(crc>>8)&0xff;buf[35]=crc&0xff;return buf.toString('base64url').replace(/=+$/,'');}
        return a;
    }catch(e){return a;}
}
function walletToFriendly48(a){return ensureTonAddr48(a);}
app.use(express.json({ limit: '15mb' }));

// ════ DDOS PROTECTION ════
const _rateLimitMap = new Map();
const _RATE_WINDOW = 60000;
const _RATE_LIMIT_API = 120;
const _BLOCKED_DURATION = 300000;

function getRealIP(req) {
    return req.headers['cf-connecting-ip'] ||
           req.headers['x-real-ip'] ||
           (req.headers['x-forwarded-for']||'').split(',')[0].trim() ||
           req.socket.remoteAddress || '0.0.0.0';
}

function checkRateLimit(req, res, next, limit) {
    const ip = getRealIP(req);
    const now = Date.now();
    let data = _rateLimitMap.get(ip);
    if (!data || (now - data.firstReq) > _RATE_WINDOW) {
        data = { count: 0, firstReq: now, blocked: false, blockedAt: 0 };
    }
    if (data.blocked && (now - data.blockedAt) > _BLOCKED_DURATION) {
        data.blocked = false; data.count = 0; data.firstReq = now;
    }
    if (data.blocked) {
        _rateLimitMap.set(ip, data);
        return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    data.count++;
    if (data.count > limit) {
        data.blocked = true; data.blockedAt = now;
        console.warn('[DDOS] Blocked:', ip, 'requests:', data.count);
        _rateLimitMap.set(ip, data);
        return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    _rateLimitMap.set(ip, data);
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of _rateLimitMap.entries()) {
        if ((now - data.firstReq) > _RATE_WINDOW * 5 && !data.blocked) _rateLimitMap.delete(ip);
    }
}, 600000);

app.use((req, res, next) => {
    if (req.path.endsWith('.png') || req.path.endsWith('.js') || req.path.endsWith('.css') ||
        req.path.startsWith('/sprites') || req.path.startsWith('/sounds')) return next();
    checkRateLimit(req, res, next, _RATE_LIMIT_API);
});

app.use(express.urlencoded({ limit: '15mb', extended: true }));

// Защита от падения сервера
process.on('uncaughtException', (err) => console.error('Критическая ошибка:', err));
process.on('unhandledRejection', (reason, promise) => console.error('Необработанный промис:', reason));

// Защита от мультикликов (глобальная блокировка активных запросов юзера)
const actionLocks = new Set();

// Анти-сон (пинг себя)
const SELF_BASE_URL = process.env.WEB_APP_URL || process.env.RENDER_EXTERNAL_URL;
if (SELF_BASE_URL) {
    setInterval(() => {
        fetch(`${SELF_BASE_URL}/ping`).then(() => console.log('🔄 Анти-сон: Сервер пинганул сам себя')).catch(() => {});
    }, 10 * 60 * 1000);
}

// Подключение к БД
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log('❌ DB Error:', err));

// --- 1. TON CONNECT MANIFEST ---
app.get('/tonconnect-manifest.json', (req, res) => {
    const baseUrl = process.env.WEB_APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://localhost';
    res.json({
        url: baseUrl,
        name: "LoonxGift",
        iconUrl: baseUrl + "/toncoin-ton-logo.png",
        termsOfUseUrl: "",
        privacyPolicyUrl: ""
    });
});

// Синхронизация текстур: textures/ -> sprites/ (для удобной замены текстур)
const fs = require('fs');
function syncTextures() {
    const textureDir = path.join(__dirname, 'public', 'textures');
    const spriteDir = path.join(__dirname, 'public', 'sprites');
    const folders = ['blocks', 'pickaxes', 'chests', 'effects'];
    if (!fs.existsSync(spriteDir)) fs.mkdirSync(spriteDir, { recursive: true });
    for (const folder of folders) {
        const src = path.join(textureDir, folder);
        if (!fs.existsSync(src)) continue;
        for (const file of fs.readdirSync(src)) {
            if (!file.endsWith('.png')) continue;
            const srcFile = path.join(src, file);
            // Map texture filenames to sprite filenames (same name)
            const dstFile = path.join(spriteDir, file);
            try { fs.copyFileSync(srcFile, dstFile); } catch(e) {}
        }
    }
    console.log('Текстуры синхронизированы: textures/ -> sprites/');
}
syncTextures();

// Статические файлы (после манифеста, чтобы роут имел приоритет)
app.use(express.static(path.join(__dirname, 'public')));

// --- ВРЕМЯ МСК ---
const getMskTime = () => new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour12: false });

// --- МОДЕЛИ ДАННЫХ ---
const UserSchema = new mongoose.Schema({
    id: String, 
    username: String, 
    photo: String, 
    isBlocked: { type: Boolean, default: false }, 
    balance: { type: Number, default: 0 }, 
    demo_balance: { type: Number, default: 5000 },
    referredBy: { type: String, default: null }, 
    referrals: [{ type: String }],               
    referralEarnings: { type: Number, default: 0 },
    referralPending: { type: Number, default: 0 }, // накоплено, но не выплачено
    referralDepositCounts: { type: Map, of: Number, default: {} }, // счётчик депозитов per reферал
    freeCaseLastOpened: { type: Map, of: Date, default: {} }, // время последнего открытия бесплатных кейсов 
    stats: { 
        bets: {type:Number, default:0}, 
        wins: {type:Number, default:0}, 
        plus: {type:Number, default:0}, 
        minus: {type:Number, default:0},
        promo: {type:Number, default:0}
    },
    createdAt: { type: Date, default: Date.now },
    withdrawHistory: [{ 
        withdrawId: String, 
        amount: Number, 
        address: String, 
        status: String, 
        reason: String, 
        time: String 
    }],
    depositHistory: [{
        hash: String,
        amount: Number,
        status: String,
        time: String
    }],
    betHistory: { type: Array, default: [] },
    mineFreeSpins: { type: Number, default: 0 },
    wagerRequired: { type: Number, default: 0 },
    wagerCompleted: { type: Number, default: 0 },
    totalDeposited: { type: Number, default: 0 },
    totalWagered: { type: Number, default: 0 }
});

const BetSchema = new mongoose.Schema({
    userId: String, username: String, avatar: String, game: String, amount: Number,
    multiplier: Number, result: Number, mode: String,
    balanceAfter: Number, 
    balance: Number, // ДОБАВЛЕНО: для корректного отображения баланса в админке и меню
    createdAt: { type: Date, default: Date.now }
});

const PromoSchema = new mongoose.Schema({ code: String, amount: Number, limit: Number, usedBy: [String] });
const WithdrawSchema = new mongoose.Schema({ userId: String, address: String, amount: Number, status: { type: String, default: 'pending' }, reason: String, time: String });
const DepositSchema = new mongoose.Schema({ hash: { type: String, unique: true }, userId: String, amount: Number, time: String });
const SettingsSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });
const AdminLogSchema = new mongoose.Schema({ action: String, createdAt: { type: Date, default: Date.now } });

const BattleSchema = new mongoose.Schema({
    creatorId: String,
    players: Array, 
    status: { type: String, default: 'waiting' },
    winnerId: String,
    timerStartedAt: Date,
    timerEndTime: Date,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Bet = mongoose.model('Bet', BetSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Settings = mongoose.model('Settings', SettingsSchema);
const Battle = mongoose.model('Battle', BattleSchema);
const AdminLog = mongoose.model('AdminLog', AdminLogSchema);

// ════ GIFT SYSTEM ════
const GiftSchema = new mongoose.Schema({
    userId:            String,  // owner telegram ID
    ownerUsername:     String,
    name:              String,
    imageUrl:          { type: String, default: '' },
    price:             { type: Number, default: 0 },
    withdrawRequested: { type: Boolean, default: false },
    createdAt:         { type: Date, default: Date.now }
});
const Gift = mongoose.model('Gift', GiftSchema);


async function logAdmin(action) {
    try { await AdminLog.create({ action }); } catch(e) {}
}

let globalBetHistory = [];

// --- ИНИЦИАЛИЗАЦИЯ НАСТРОЕК ---
async function initSettings() {
    const defaultSettings = [
        { key: 'rtp_crash', value: 90 },
        { key: 'rtp_mines', value: 90 },
        { key: 'rtp_coinflip', value: 90 }, 
        { key: 'maintenance_crash', value: false },
        { key: 'maintenance_mines', value: false },
        { key: 'maintenance_coinflip', value: false },
        { key: 'maintenance_battle', value: false },
        { key: 'rtp_spin', value: 90 },
        { key: 'rtp_mine', value: 90 },
        { key: 'maintenance_mine', value: false },
        { key: 'wager_multiplier', value: 2 },
        { key: 'min_withdraw', value: 5 },
        { key: 'rtp_upgrade', value: 85 },
        { key: 'rtp_cases', value: 78 },

        { key: 'maintenance_upgrade', value: false },
        { key: 'maintenance_case', value: false },

    ];
    for (let setting of defaultSettings) {
        const exists = await Settings.findOne({ key: setting.key });
        if (!exists) await Settings.create(setting);
    }
    
    // Note: RTP values are now admin-configurable, no forced override
    
    const lastBets = await Bet.find().sort({createdAt: -1}).limit(50);
    globalBetHistory = lastBets.map(b => {
        const obj = b.toObject();
        obj.timeMsk = new Date(b.createdAt).toLocaleTimeString("ru-RU", {timeZone: "Europe/Moscow"});
        return obj;
    });
}
initSettings();

// --- ТЕЛЕГРАМ БОТ ---
let bot;
if (process.env.BOT_TOKEN) {
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    bot.deleteWebHook().catch(() => {});
    
    bot.on('polling_error', (err) => {
        if (err.message.includes('409 Conflict')) {
            console.log('⚠️ Конфликт: Бот уже запущен в другом месте. Останови его там.');
        } else {
            console.log('❌ Ошибка поллинга бота:', err.message);
        }
    });

    bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
        const refParam = match[1] || '';
        const text = `🚀 Привет, ${msg.from.first_name}!\nДобро пожаловать в LoonxGift.\n\nТут ты можешь играть и выигрывать TON! Твой баланс и все игры находятся внутри Mini App.\n\nВыбирай действие в меню ниже:`;

        const baseUrl = process.env.WEB_APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://localhost';
        const appUrl = refParam ? `${baseUrl}?start_param=${refParam}` : baseUrl;

        // Auto-register user on /start so referral works even before opening mini app
        const tgUser = msg.from;
        let existingUser = await User.findOne({ id: String(tgUser.id) });
        if (!existingUser && refParam && refParam !== String(tgUser.id)) {
            existingUser = await User.create({
                id: String(tgUser.id),
                username: tgUser.username || tgUser.first_name,
                photo: ''
            });
            const referrer = await User.findOne({ id: String(refParam) });
            if (referrer) {
                existingUser.referredBy = String(refParam);
                referrer.referrals.push(String(tgUser.id));
                await referrer.save();
                await existingUser.save();
            }
        }

        bot.sendMessage(msg.chat.id, text, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎮 ИГРАТЬ (MINI APP)", web_app: { url: appUrl } }],
                    [{ text: "📢 Канал", url: "https://t.me/LoonxGift_Channel" }, { text: "💬 Саппорт", url: "https://t.me/LoonxGift_Support" }],
                    [{ text: "🐞 Баги", url: "https://t.me/msgp2p" }]
                ]
            }
        });
    });

    bot.onText(/\/help/, (msg) => {
        bot.sendMessage(msg.chat.id, `ℹ️ LoonxGift — игровая платформа на TON.\n\nКоманды:\n/start — Запустить бота\n/help — Помощь\n\nОткройте Mini App для игры и управления балансом.`);
    });
    console.log('🤖 Бот успешно запущен (Polling)');
} else {
    console.log('❌ BOT_TOKEN не найден в .env');
}

// --- CRASH ENGINE ---
let crash = { status: 'waiting', timer: 10, multiplier: 1.0 };
let crashHistory = [];
let crashLiveBets = [];

async function startCrash() {
    crash.status = 'waiting'; crash.timer = 10; crashLiveBets = [];
    io.emit('crashBetsUpdate', crashLiveBets);
    const t = setInterval(() => {
        crash.timer--; io.emit('crashData', crash);
        if(crash.timer <= 0) { clearInterval(t); runCrash(); }
    }, 1000);
}

async function runCrash() {
    crash.status = 'running'; crash.multiplier = 1.0;
    const rtpSetting = await Settings.findOne({key: 'rtp_crash'});
    const rtp = rtpSetting ? rtpSetting.value : 90; 
    const limit = Math.pow(100 / (100 - (Math.random() * rtp)), 0.7).toFixed(2);
    const maxMultSetting = await Settings.findOne({key: 'game_crash_max_mult'});
    const maxMult = maxMultSetting ? Number(maxMultSetting.value) : 1000;
    
    const r = setInterval(async () => {
        crash.multiplier = (parseFloat(crash.multiplier) + 0.01).toFixed(2);
        io.emit('crashData', crash);
        
        if(parseFloat(crash.multiplier) >= parseFloat(limit) || parseFloat(crash.multiplier) >= maxMult) { 
            clearInterval(r); 
            crash.status = 'crashed'; 
            crashHistory.unshift(crash.multiplier);
            if(crashHistory.length > 5) crashHistory.pop();
            io.emit('crashData', crash); 
            io.emit('crashHistoryUpdate', crashHistory);
            
            for (let b of crashLiveBets) {
                if (!b.cashedOut) {
                    const u = await User.findOne({id: b.id});
                    if (u) {
                        const actualMode = b.mode === 'demo' ? 'Demo' : 'Real';
                        const balField = actualMode === 'Demo' ? 'demo_balance' : 'balance';
                        const newBet = new Bet({ 
                            userId: u.id, username: u.username, avatar: b.avatar, 
                            game: 'Crash', amount: b.bet, result: -b.bet, mode: actualMode,
                            balanceAfter: u[balField],
                            balance: u[balField] // ДОБАВЛЕНО
                        });
                        await newBet.save();
                        pushToGlobalHistory(newBet);
                    }
                }
            }
            
            setTimeout(startCrash, 4000);
        }
    }, 50);
}
startCrash();

function pushToGlobalHistory(betObj) {
    const betWithTime = {
        ...(betObj.toObject ? betObj.toObject() : betObj),
        timeMsk: getMskTime()
    };
    
    globalBetHistory.unshift(betWithTime);
    if(globalBetHistory.length > 50) globalBetHistory.pop();
    io.emit('newHistoryEntry', betWithTime);
}

// --- BATTLE ROULETTE ENGINE ---
const BATTLE_COLORS = ['#ffcc00', '#ff0055', '#007bff', '#ffffff'];
setInterval(async () => {
    const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expiredLobbies = await Battle.find({ status: 'waiting', createdAt: { $lt: expiredTime } });
    
    for (let lobby of expiredLobbies) {
        for (let p of lobby.players) {
            const u = await User.findOne({id: p.id});
            if (u) { u.balance = Number((u.balance + p.bet).toFixed(2)); await u.save(); }
        }
        await Battle.findByIdAndDelete(lobby._id);
    }

    const waitingLobbies = await Battle.find({ status: 'waiting' });

    for (let lobby of waitingLobbies) {
        let shouldStart = false;
        
        if (lobby.players.length >= 4) {
            shouldStart = true;
        } else if (lobby.players.length > 1 && lobby.timerEndTime) {
            if (new Date() >= lobby.timerEndTime) shouldStart = true;
        }

        if (shouldStart) {
            lobby.status = 'spinning';
            await lobby.save();
            io.emit('battleUpdate');
            
            const totalPool = lobby.players.reduce((sum, p) => sum + p.bet, 0);
            let rand = Math.random() * totalPool;
            let currentWeight = 0;
            let winner = lobby.players[0];

            for (let p of lobby.players) {
                currentWeight += p.bet;
                if (rand <= currentWeight) { winner = p; break; }
            }

            lobby.status = 'finished';
            lobby.winnerId = winner.id;
            await lobby.save();

            const othersPool = totalPool - winner.bet;
            // Применяем процент комиссии казино из настроек
            const btlFeeGS = await Settings.findOne({ key: 'game_btl_fee_pct' });
            const btlFee = btlFeeGS ? Math.min(50, Math.max(0, Number(btlFeeGS.value))) : 30;
            const winAmount = winner.bet + (othersPool * (1 - btlFee / 100));

            const wUser = await User.findOne({id: winner.id});
            if (wUser) {
                wUser.balance = Number((wUser.balance + winAmount).toFixed(2));
                wUser.stats.wins++; wUser.stats.plus += (winAmount - winner.bet);
                await wUser.save();
            }

            io.emit('battleSpin', { lobbyId: lobby._id, winnerId: winner.id });

            const opponentStr = lobby.players.filter(p => p.id !== lobby.creatorId).map(p => p.username).join(', ');
            const creator = lobby.players.find(p => p.id === lobby.creatorId);
            
            const betEntry = new Bet({
                userId: winner.id, username: winner.username, avatar: winner.avatar,
                game: 'Battle Roulette', amount: winner.bet, result: winAmount - winner.bet, mode: 'Real',
                balanceAfter: wUser ? wUser.balance : 0,
                balance: wUser ? wUser.balance : 0 // ДОБАВЛЕНО
            });
            betEntry.username = `${creator.username} VS ${opponentStr} 🏆 Победитель: ${winner.username}`;
            await betEntry.save();
            pushToGlobalHistory(betEntry);

            if (bot) {
                for (let p of lobby.players) {
                    if (p.id === winner.id) {
                        bot.sendMessage(p.id, `🏆 Поздравляем! Вы выиграли в Battle Roulette!\nВаш выигрыш составил: **${winAmount.toFixed(2)} TON**`, {parse_mode: 'Markdown'}).catch(()=>{});
                    } else {
                        bot.sendMessage(p.id, `😢 Вы проиграли в Battle Roulette.\nВаша ставка **${p.bet} TON** сгорела. Повезет в следующий раз!`, {parse_mode: 'Markdown'}).catch(()=>{});
                    }
                }
            }

            setTimeout(async () => { await Battle.findByIdAndDelete(lobby._id); io.emit('battleUpdate'); }, 120000);
        }
    }
}, 5000);

// --- СОКЕТЫ ---
let online = 0;
const onlineUsers = new Map(); // socketId -> userId

io.on('connection', async (socket) => {
    online++;
    io.emit('online', online);
    socket.emit('crashHistoryUpdate', crashHistory);
    socket.emit('crashBetsUpdate', crashLiveBets);
    socket.emit('init_history', globalBetHistory);
    
    socket.on('register_online', (userId) => {
        if(userId) { onlineUsers.set(socket.id, String(userId)); }
    });
    
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        online--;
        io.emit('online', online);
    });
});

function getOnlineUserIds() { return new Set(onlineUsers.values()); }

// --- API ЭНДПОИНТЫ ---
app.post('/api/auth', async (req, res) => {
    const { id, username, first_name, photo_url, refId } = req.body;
    let user = await User.findOne({ id });
    
    if (!user) { 
        user = await User.create({ id, username: username || first_name, photo: photo_url }); 
        
        if (refId && refId !== String(id)) {
            const referrer = await User.findOne({ id: String(refId) });
            if (referrer) {
                user.referredBy = String(refId);
                referrer.referrals.push(String(id));
                await referrer.save();
                await user.save();
            }
        }
    } else { 
        user.username = username || first_name; 
        user.photo = photo_url; 
        await user.save(); 
    }
    
    if(user.isBlocked) return res.status(403).json({ error: "BLOCKED" });

    const allSettings = await Settings.find();
    const rtpData = {};
    const maintenanceData = {};
    allSettings.forEach(s => {
        if (s && s.key) {
            if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
            if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
        }
    });
    
    const userBets = await Bet.find({ userId: String(id) }).sort({ createdAt: -1 }).limit(50);
    const userObj = user.toObject();
    userObj.betHistory = userBets.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));

    // Enrich referrals with username and avatar
    if (userObj.referrals && userObj.referrals.length > 0) {
        const refUsers = await User.find({ id: { $in: userObj.referrals } }, 'id username photo');
        userObj.referrals = refUsers.map(r => ({ id: r.id, username: r.username || 'User', photo: r.photo || '' }));
    }

    const wagerSett = await Settings.findOne({ key: 'wager_multiplier' });
    const wagerMult = wagerSett ? wagerSett.value : 2;
    const _w48=ensureTonAddr48(process.env.ADMIN_WALLET)||process.env.ADMIN_WALLET||'';
    // добавляем рефStats
    const refPending = userObj.referralPending||0;
    userObj.referralPending = refPending;
    const onlineIds = Array.from(getOnlineUserIds());
    res.json({ user: userObj, onlineIds, adminWallet: (process.env.ADMIN_WALLET||'').trim(), wallet48: _w48, rtp: rtpData, maintenance: maintenanceData, wagerMultiplier: wagerMult });
});

app.post('/api/bet', async (req, res) => {
    const { id, game, bet, win, multiplier, mode } = req.body;
    
    if (actionLocks.has(id)) return res.status(429).json({error: 'Слишком частые клики'});
    actionLocks.add(id);

    try {
        const user = await User.findOne({ id });
        if(!user || user.isBlocked) return res.status(403).send();
        
        const actualMode = mode === 'demo' ? 'demo' : 'real';
        const field = actualMode === 'demo' ? 'demo_balance' : 'balance';
        
        if (isNaN(bet) || isNaN(win) || bet < 0 || win < 0 || user[field] < bet) return res.status(400).json({error: 'No money or invalid amount'});
        if (bet > 0 && (bet < 0.1 || bet > 25)) return res.status(400).json({error: 'Bet must be 0.1-25 TON'});
        
        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

        if (game === 'Crash') {
            if (win === 0 && bet > 0) {
                const activeUserBets = crashLiveBets.filter(b => b.id === user.id && !b.cashedOut);
                if (activeUserBets.length >= 2) return res.status(400).json({error: 'Max 2 bets'});
                crashLiveBets.push({ id: user.id, username: user.username, avatar, bet, cashedOut: false, win: 0, mode: actualMode });
                io.emit('crashBetsUpdate', crashLiveBets);
                
                user[field] = Number((user[field] - bet).toFixed(2));
                if (actualMode === 'real') { user.stats.bets++; user.stats.minus += bet; }
                await user.save();
                return res.json(user);
                
            } else if (win > 0) {
                const activeBet = crashLiveBets.find(b => b.id === user.id && !b.cashedOut);
                if (!activeBet) return res.status(400).json({error: 'Already cashed out or not found'});
                
                const betMode = activeBet.mode === 'demo' ? 'demo' : 'real';
                const correctField = betMode === 'demo' ? 'demo_balance' : 'balance';
                
                activeBet.cashedOut = true;
                activeBet.win = win;
                io.emit('crashBetsUpdate', crashLiveBets);
                
                user[correctField] = Number((user[correctField] + win).toFixed(2));
                if (betMode === 'real') { user.stats.wins++; user.stats.plus += win; }
                await user.save();
                
                const profit = win - activeBet.bet;
                const newBetEntry = new Bet({ 
                    userId: user.id, username: user.username, avatar, game: 'Crash', 
                    amount: activeBet.bet, result: profit, mode: betMode === 'demo' ? 'Demo' : 'Real',
                    balanceAfter: user[correctField],
                    balance: user[correctField] // ДОБАВЛЕНО
                });
                await newBetEntry.save();
                pushToGlobalHistory(newBetEntry);
                
                return res.json(user);
            }
        }

        const profit = win > 0 ? (win - bet) : -bet;
        user[field] = Number((user[field] - bet + win).toFixed(2));
        
        const newBetEntry = new Bet({
            userId: user.id, username: user.username, avatar, game: game,
            amount: bet, multiplier: multiplier || (bet > 0 ? (win / bet).toFixed(2) : 0),
            result: Number(profit.toFixed(2)), mode: actualMode === 'demo' ? 'Demo' : 'Real',
            balanceAfter: user[field],
            balance: user[field] // ДОБАВЛЕНО
        });
        await newBetEntry.save();
        pushToGlobalHistory(newBetEntry);

        if (actualMode === 'real') {
            if (bet > 0) { user.stats.bets++; user.totalWagered = Number(((user.totalWagered || 0) + bet).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + bet).toFixed(2)); }
            if (win > 0) { user.stats.wins++; user.stats.plus += win; }
            else if (bet > 0) { user.stats.minus += bet; }
        }
        await user.save();

        res.json(user);
    } finally {
        actionLocks.delete(id);
    }
});

// API BATTLE ROULETTE
app.get('/api/battle/list', async (req, res) => {
    const lobbies = await Battle.find({status: 'waiting'}).sort({createdAt: -1});
    res.json(lobbies);
});

app.post('/api/battle/create', async (req, res) => {
    const { id, bet } = req.body;
    
    if (actionLocks.has(id)) return res.status(429).json({error: 'Подождите...'});
    actionLocks.add(id);

    try {
        const user = await User.findOne({id});
        if(!user || user.isBlocked) return res.status(403).send();
        
        const btlMinGS = await Settings.findOne({ key: 'game_btl_min' });
        const btlMaxGS = await Settings.findOne({ key: 'game_btl_max' });
        const btlMin = btlMinGS ? Number(btlMinGS.value) : 0.5;
        const btlMax = btlMaxGS ? Number(btlMaxGS.value) : 150;
        if(isNaN(bet) || bet < btlMin || bet > btlMax) return res.status(400).json({error: `Ставка от ${btlMin} до ${btlMax} TON`});
        if(user.balance < bet) return res.status(400).json({error: 'Недостаточно средств'});
        
        user.balance = Number((user.balance - bet).toFixed(2));
        user.stats.bets++; user.stats.minus += bet;
        await user.save();

        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        const newLobby = await Battle.create({
            creatorId: user.id,
            players: [{ id: user.id, username: user.username, avatar, bet, color: BATTLE_COLORS[0] }]
        });

        io.emit('battleUpdate');
        res.json(user);
    } finally {
        actionLocks.delete(id);
    }
});

app.post('/api/battle/join', async (req, res) => {
    const { id, lobbyId, bet } = req.body;
    
    if (actionLocks.has(id)) return res.status(429).json({error: 'Подождите...'});
    actionLocks.add(id);

    try {
        const user = await User.findOne({id});
        const lobby = await Battle.findById(lobbyId);

        if(!user || !lobby || lobby.status !== 'waiting' || lobby.players.length >= 4) return res.status(400).json({error: 'Ошибка входа'});
        if(lobby.players.find(p => p.id === id)) return res.status(400).json({error: 'Уже в лобби'});
        
        const btlMinGS2 = await Settings.findOne({ key: 'game_btl_min' });
        const btlMaxGS2 = await Settings.findOne({ key: 'game_btl_max' });
        const btlMin2 = btlMinGS2 ? Number(btlMinGS2.value) : 0.5;
        const btlMax2 = btlMaxGS2 ? Number(btlMaxGS2.value) : 150;
        if(isNaN(bet) || bet < btlMin2 || bet > btlMax2) return res.status(400).json({error: `Ставка от ${btlMin2} до ${btlMax2} TON`});
        if(user.balance < bet) return res.status(400).json({error: 'Недостаточно средств'});

        user.balance = Number((user.balance - bet).toFixed(2));
        user.stats.bets++; user.stats.minus += bet;
        await user.save();

        const avatar = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        const pColor = BATTLE_COLORS[lobby.players.length];
        lobby.players.push({ id: user.id, username: user.username, avatar, bet, color: pColor });
        
        if (lobby.players.length >= 2) {
            lobby.timerStartedAt = new Date();
            lobby.timerEndTime = new Date(Date.now() + 2 * 60 * 1000);
        }
        
        await lobby.save();
        io.emit('battleUpdate');

        if(bot) {
            bot.sendMessage(lobby.creatorId, `⚔️ Игрок **${user.username}** присоединился к вашей Battle Roulette! Ставка: ${bet} TON`, {parse_mode: 'Markdown'}).catch(()=>{});
        }

        res.json({user, lobby});
    } finally {
        actionLocks.delete(id);
    }
});

app.post('/api/battle/cancel', async (req, res) => {
    const { id, lobbyId } = req.body;
    const lobby = await Battle.findById(lobbyId);
    if(!lobby || lobby.creatorId !== id || lobby.players.length > 1) return res.status(400).json({error: 'Нельзя отменить'});

    const user = await User.findOne({id});
    user.balance = Number((user.balance + lobby.players[0].bet).toFixed(2));
    await user.save();
    
    await Battle.findByIdAndDelete(lobbyId);
    io.emit('battleUpdate');
    res.json(user);
});

// === SPIN GAME ===
const spinUserStreaks = {};

// 15 пейлайнов: ряды + V-образные + ступеньки + зигзаги + диагонали (синхронизировано с фронтендом)
const SPIN_PAYLINES = [
    [1,1,1,1,1],  // 0: средний ряд
    [0,0,0,0,0],  // 1: верхний ряд
    [2,2,2,2,2],  // 2: нижний ряд
    [0,1,2,1,0],  // 3: V-вниз
    [2,1,0,1,2],  // 4: V-вверх
    [0,0,1,2,2],  // 5: ступенька вниз
    [2,2,1,0,0],  // 6: ступенька вверх
    [1,0,1,0,1],  // 7: зигзаг верх
    [0,1,0,1,0],  // 8: зигзаг низ
    [1,2,1,2,1],  // 9: зигзаг низ2
    [2,1,2,1,2],  // 10: зигзаг верх2
    [0,1,1,1,2],  // 11: прогиб вниз
    [2,1,1,1,0],  // 12: прогиб вверх
    [1,1,0,1,1],  // 13: впадина вверх
    [1,1,2,1,1],  // 14: впадина вниз
];

// L symbols do NOT pay — only X symbols pay (makes most spins losing)
const SPIN_PAYTABLE={'X':{3:2.5,4:6.0,5:12.0},'L':{3:0.9,4:2.2,5:4.5}};

function generateSpinGrid(userId, rtpTarget) {
    const streak = spinUserStreaks[userId] || { losses: 0, wins: 0, progress: 0 };
    // RTP controls whether this spin CAN win at all
    // rtp 90 → 30% chance of winning spin, rtp 50 → 16%, rtp 10 → 3%
    const rtpF=Math.max(0.1,Math.min(1.0,rtpTarget/100));
    const freqG=0.004,freqX=0.05+rtpF*0.08,freqL=0.25+rtpF*0.10;
    const grid=[];
    for(let r=0;r<3;r++){const row=[];
        for(let c=0;c<5;c++){const rand=Math.random();
            if(rand<freqG)row.push('G');else if(rand<freqG+freqX)row.push('X');
            else if(rand<freqG+freqX+freqL)row.push('L');else row.push('N');
        }grid.push(row);}
    return grid;
}

function checkSpinWins(grid, bet, paytable) {
    const PT = paytable || SPIN_PAYTABLE;
    let totalWin = 0; const winLines = [];
    for (let li = 0; li < SPIN_PAYLINES.length; li++) {
        const line = SPIN_PAYLINES[li];
        const first = grid[line[0]][0];
        if(first==='G'||first==='N') continue;
        let count = 1;
        for (let i = 1; i < 5; i++) { if (grid[line[i]][i] === first) count++; else break; }
        if (count >= 3 && PT[first] && PT[first][count]) {
            const mult = PT[first][count];
            totalWin += bet * mult;
            winLines.push({ lineIndex: li, symbol: first, count, multiplier: mult });
        }
    }
    return { totalWin, winLines };
}

function countSymbols(grid, sym) {
    let n = 0;
    for (let row of grid) for (let s of row) if (s === sym) n++;
    return n;
}

function applyHiddenG(grid) {
    const rand = Math.random();
    // Скрытая G очень редко: 4% — одна штука, двух больше нет
    let hiddenCount = rand < 0.01 ? 1 : 0;
    const positions = [];
    if (hiddenCount > 0) {
        const nonG = [];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) if (grid[r][c] !== 'G') nonG.push([r, c]);
        for (let i = nonG.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [nonG[i],nonG[j]]=[nonG[j],nonG[i]]; }
        for (let i = 0; i < Math.min(hiddenCount, nonG.length); i++) {
            const [r, c] = nonG[i]; grid[r][c] = 'G'; positions.push({ row: r, col: c });
        }
    }
    return positions;
}

app.post('/api/spin', async (req, res) => {
    const { id, bet, mode, freeSpinsMode, currentMultiplier } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({ error: 'Подождите...' });
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const betAmount = parseFloat(bet) || 0;
        if (betAmount < 0.1 || betAmount > 25) return res.status(400).json({ error: 'Ставка от 0.1 до 25 TON' });
        if (!freeSpinsMode && user[field] < betAmount) return res.status(400).json({ error: 'Недостаточно средств' });

        const rtpSetting = await Settings.findOne({ key: 'rtp_spin' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 94;

        // Загружаем настройки механики спина из БД
        const spinGS = await Settings.find({ key: /^game_spin_/ });
        const spinG = {}; spinGS.forEach(s => { spinG[s.key] = s.value; });
        const dynPaytable = {
            'X': { 3: Number(spinG['game_spin_x3']) || 2.5, 4: Number(spinG['game_spin_x4']) || 6.0, 5: Number(spinG['game_spin_x5']) || 12.0 },
            'L': { 3: Number(spinG['game_spin_l3']) || 0.9, 4: Number(spinG['game_spin_l4']) || 2.2, 5: Number(spinG['game_spin_l5']) || 4.5 }
        };

        if (!spinUserStreaks[id]) spinUserStreaks[id] = { losses: 0, wins: 0, progress: 0 };
        const streak = spinUserStreaks[id];

        if (!freeSpinsMode) {
            user[field] = Number((user[field] - betAmount).toFixed(2));
            if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; user.totalWagered = Number(((user.totalWagered || 0) + betAmount).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + betAmount).toFixed(2)); }
        }

        const grid = generateSpinGrid(id, rtpTarget);
        // Считаем G ДО hidden G — только настоящие скаттеры триггерят фриспины
        const gCountBase = countSymbols(grid, 'G');
        const hiddenGs = applyHiddenG(grid);
        const { totalWin, winLines } = checkSpinWins(grid, betAmount, dynPaytable);
        const gCount = countSymbols(grid, 'G'); // после hidden G, для прогресс-бара
        const xCount = winLines.filter(wl => wl.symbol === 'X').length; // только X на выигрышных линиях

        // Фриспины только от настоящих G (без hidden), ре-триггер во фриспинах запрещён
        let freeSpinsWon = 0;
        if (!freeSpinsMode) {
            if (gCountBase === 3) freeSpinsWon = 3;
            else if (gCountBase === 4) freeSpinsWon = 5;
            else if (gCountBase >= 5) freeSpinsWon = 8;
        }

        const freeMult = freeSpinsMode ? (parseFloat(currentMultiplier) || 1) : 1;
        let actualWin = Number((totalWin * freeMult).toFixed(2));
        const maxWin = betAmount * 15;
        if (actualWin > maxWin) actualWin = maxWin;

        // Hard cap on spin wins
        if (!freeSpinsMode && actualWin > betAmount * 3) {
            actualWin = Number((betAmount * 3).toFixed(2));
        }
        if (freeSpinsMode && actualWin > betAmount * 8) {
            actualWin = Number((betAmount * 8).toFixed(2));
        }

        let progressGain = gCount * 20 + hiddenGs.length * 10;
        streak.progress = (streak.progress || 0) + progressGain;
        let bonusTriggered = false;
        let bonusSpins = 0;
        if (streak.progress >= 100) { streak.progress -= 100; bonusTriggered = true; bonusSpins = 1; }

        if (actualWin > 0) { streak.wins = Math.min(8, (streak.wins||0)+1); streak.losses = 0; }
        else { streak.losses = Math.min(8, (streak.losses||0)+1); streak.wins = 0; }

        if (actualWin > 0) {
            user[field] = Number((user[field] + actualWin).toFixed(2));
            if (!isDemo) { user.stats.wins++; user.stats.plus += actualWin; }
        }

        await user.save();

        if (!isDemo && (!freeSpinsMode || actualWin > 0)) {
            const betEntry = new Bet({
                userId: user.id, username: user.username,
                avatar: user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
                game: 'Spin', amount: freeSpinsMode ? 0 : betAmount,
                multiplier: betAmount > 0 ? (actualWin / betAmount) : 1,
                result: freeSpinsMode ? Number(actualWin.toFixed(2)) : Number((actualWin-betAmount).toFixed(2)),
                mode: 'Real', balanceAfter: user[field], balance: user[field]
            });
            await betEntry.save();
            pushToGlobalHistory(betEntry);
        }

        res.json({ grid, win: actualWin, winLines, freeSpinsWon, hiddenGs, progressGain, progressValue: streak.progress, bonusTriggered, bonusSpins, xCountInGrid: xCount, gForExtraSpins: 0, user });
    } catch (err) {
        console.error('Spin error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
        actionLocks.delete(id);
    }
});

// === MINE GAME (Minecraft-style) ===
const MINE_BLOCKS=['dirt','stone','redstone','gold_block','diamond_block','obsidian'];
const MINE_BLOCK_MULTS={grass:0.01,dirt:0.03,stone:0.06,redstone:0.09,gold_block:0.12,diamond_block:0.16,obsidian:0.20,gold:0.12,diamond:0.16};
// 6 rows: row 0 = grass top layer, rows 1-5 = underground
const MINE_ROW_WEIGHTS = [
    [1.00,0.00,0.00,0.00,0.00,0.00],
    // row 1 — mostly stone
    [0.10, 0.62, 0.20, 0.06, 0.015, 0.005],
    // row 2
    [0.05, 0.45, 0.28, 0.15, 0.05, 0.02],
    // row 3 — middle
    [0.00, 0.30, 0.30, 0.24, 0.11, 0.05],
    // row 4
    [0.00, 0.18, 0.26, 0.28, 0.18, 0.10],
    // row 5 — bottom (rare ores)
    [0.00, 0.10, 0.20, 0.30, 0.24, 0.16]
];
const MINE_PICKAXES = ['wooden', 'stone', 'iron', 'golden', 'diamond'];
const MINE_PICKAXE_WEIGHTS = [0.46, 0.28, 0.14, 0.08, 0.04];
const MINE_PICKAXE_MULTS = { wooden: 1.2, stone: 1.5, iron: 2.0, golden: 3.0, diamond: 5.0 };

const CHEST_MULT_VALUES  = [2, 2, 3, 3, 4];
const CHEST_MULT_WEIGHTS = [0.50, 0.25, 0.15, 0.07, 0.03];
const CHEST_MULT_EXPECTED = 2.3;

function pickChestMult() {
    const r = Math.random(); let cum = 0;
    for (let i = 0; i < CHEST_MULT_VALUES.length; i++) {
        cum += CHEST_MULT_WEIGHTS[i];
        if (r < cum) return CHEST_MULT_VALUES[i];
    }
    return 2;
}

function generateMineGrid() {
    const grid = [];
    for (let r = 0; r < 6; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
            if (r === 0) {
                // Top layer: grass blocks (visual), underlying type is dirt or rare stone
                row.push('grass');
            } else {
                const weights = MINE_ROW_WEIGHTS[r];
                const rand = Math.random(); let cum = 0; let block = 'stone';
                for (let b = 0; b < MINE_BLOCKS.length; b++) { cum += weights[b]; if (rand < cum) { block = MINE_BLOCKS[b]; break; } }
                row.push(block);
            }
        }
        grid.push(row);
    }
    return grid;
}

function generateMineHotbar(rtpTarget, mineG) {
    // 3 rows x 5 cols = 15 slots
    // TNT: 10%, Book: 5%, Pickaxes: RTP-dependent (lower RTP = fewer/worse pickaxes)
    // Remaining: empty slots
    const rtpFactor = Math.max(0.3, Math.min(1.0, (rtpTarget || 50) / 100));
    const g = mineG || {};
    const tntChance  = g['game_mine_tnt_pct']  !== undefined ? Number(g['game_mine_tnt_pct'])  / 100 : 0.03;
    const bookChance = g['game_mine_book_pct']  !== undefined ? Number(g['game_mine_book_pct']) / 100 : 0.02;
    const pickChance = 0.25 * rtpFactor; // 7.5%-25% depending on RTP

    // Adjust pickaxe weights by RTP: lower RTP = more wooden, less diamond
    const rtpPickWeights = [
        0.46 + (1 - rtpFactor) * 0.3,  // wooden: more at low RTP
        0.28,                            // stone: stable
        0.14 * rtpFactor,               // iron: less at low RTP
        0.08 * rtpFactor,               // golden: less at low RTP
        0.04 * rtpFactor * rtpFactor    // diamond: much less at low RTP
    ];
    const wSum = rtpPickWeights.reduce((a, b) => a + b, 0);
    const normPickWeights = rtpPickWeights.map(w => w / wSum);

    const slots = [];
    let pickCount = 0;
    for (let i = 0; i < 15; i++) {
        const r = Math.random();
        if (r < tntChance) {
            slots.push({ type: 'tnt' });
        } else if (r < tntChance + bookChance) {
            slots.push({ type: 'book' });
        } else if (r < tntChance + bookChance + pickChance) {
            const pr = Math.random(); let cum = 0; let pType = 'wooden';
            for (let j = 0; j < MINE_PICKAXES.length; j++) {
                cum += normPickWeights[j];
                if (pr < cum) { pType = MINE_PICKAXES[j]; break; }
            }
            slots.push({ type: 'pickaxe', pickaxeType: pType });
            pickCount++;
        } else {
            slots.push({ type: 'empty' });
        }
    }
    if (pickCount === 0) {
        const idx = Math.floor(Math.random() * 15);
        slots[idx] = { type: 'pickaxe', pickaxeType: 'wooden' };
    }
    return slots;
}

app.post('/api/mine', async (req, res) => {
    const { id, bet, mode, autoSpin, persistGrid: clientGrid } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({ error: 'Подождите...' });
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const isFreeAutoSpin = autoSpin === true;
        if (isFreeAutoSpin) {
            const freeSpins = user.mineFreeSpins || 0;
            if (freeSpins <= 0) return res.status(400).json({ error: 'Нет бесплатных спинов' });
            user.mineFreeSpins = freeSpins - 1;
        }
        const betAmount = isFreeAutoSpin ? 0 : (parseFloat(bet) || 0);
        if (!isFreeAutoSpin && (betAmount < 0.1 || betAmount > 25)) return res.status(400).json({ error: 'Ставка от 0.1 до 25 TON' });
        if (!isFreeAutoSpin && user[field] < betAmount) return res.status(400).json({ error: 'Недостаточно средств' });

        const maintSetting = await Settings.findOne({ key: 'maintenance_mine' });
        if (maintSetting && maintSetting.value === true) return res.status(400).json({ error: 'Игра на техническом обслуживании' });

        const rtpSetting = await Settings.findOne({ key: 'rtp_mine' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 40;

        // Загружаем настройки механики mine из БД
        const mineGS = await Settings.find({ key: /^game_mine_/ });
        const mineG = {}; mineGS.forEach(s => { mineG[s.key] = s.value; });
        // Динамические множители блоков
        const dynBlockMults = {
            grass:         Number(mineG['game_mine_grass'])    || 0.01,
            dirt:          Number(mineG['game_mine_dirt'])     || 0.03,
            stone:         Number(mineG['game_mine_stone'])    || 0.06,
            redstone:      Number(mineG['game_mine_redstone']) || 0.09,
            gold_block:    Number(mineG['game_mine_gold'])     || 0.12,
            diamond_block: Number(mineG['game_mine_diamond'])  || 0.16,
            obsidian:      Number(mineG['game_mine_obsidian']) || 0.20,
            gold:          Number(mineG['game_mine_gold'])     || 0.12,
            diamond:       Number(mineG['game_mine_diamond'])  || 0.16
        };

        if (!isFreeAutoSpin) {
            user[field] = Number((user[field] - betAmount).toFixed(2));
            if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; user.totalWagered = Number(((user.totalWagered || 0) + betAmount).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + betAmount).toFixed(2)); }
        }

        // For auto-spin: reuse existing grid (broken blocks stay null), only re-roll hotbar
        const grid = (isFreeAutoSpin && clientGrid) ? clientGrid : generateMineGrid();
        const hotbar = generateMineHotbar(rtpTarget, mineG);
        // Per-column chest multipliers (these multiply ENTIRE balance if reached)
        const chestMults = [];
        for (let c = 0; c < 5; c++) chestMults.push(pickChestMult());
        const effectiveBet = isFreeAutoSpin ? 0.5 : betAmount;

        const SRV_DUR={wooden:1,stone:2,iron:3,golden:4,diamond:5};
        // Build per-column best pickaxe (or tnt)
        const colTool={}; // col -> {type:'pickaxe'|'tnt', pType}
        (hotbar||[]).forEach((slot,idx)=>{
            const col=idx%5;
            if(slot&&slot.type==='tnt'){
                // TNT takes priority
                if(!colTool[col]||colTool[col].type!=='tnt') colTool[col]={type:'tnt'};
            } else if(slot&&slot.type==='pickaxe'){
                const pt=slot.pickaxeType||'wooden';
                const rank={wooden:0,stone:1,iron:2,golden:3,diamond:4};
                if(!colTool[col]||colTool[col].type==='tnt') return; // TNT wins
                if(!colTool[col]||rank[pt]>(rank[colTool[col].pType]||0)) colTool[col]={type:'pickaxe',pType:pt};
            }
        });

        const adjustedBlockWins=[];for(let r=0;r<6;r++)adjustedBlockWins.push([0,0,0,0,0]);
        let blockWinSum=0;
        for(const[colStr,tool]of Object.entries(colTool)){
            const col=parseInt(colStr);
            // TNT: 10 durability, breaks 2 rows in the column (first 2 intact blocks)
            // Pickaxe: durability from settings
            const maxB = tool.type==='tnt' ? 2 : (SRV_DUR[tool.pType]||1);
            let broken=0;
            for(let r=0;r<6&&broken<maxB;r++){
                if(!grid[r][col])continue;
                const mult=dynBlockMults[grid[r][col]]||0;
                const bw=parseFloat((effectiveBet*mult).toFixed(3));
                adjustedBlockWins[r][col]=bw;
                blockWinSum+=bw;
                broken++;
            }
        }
        let actualWin=Number(blockWinSum.toFixed(2));

        // CHESTS: if column fully cleared, chest multiplies the TOTAL blockWinSum
        const chestActivated = [];
        for (let c = 0; c < 5; c++) {
            chestActivated.push(Math.random() < 0.005);
        }
        // Apply chest mult to running total (not a flat bonus)
        let chestMultApplied = 1;
        for(let c=0;c<5;c++){
            if(chestActivated[c]) chestMultApplied = Math.max(chestMultApplied, chestMults[c]);
        }
        if(chestMultApplied > 1) actualWin = Number((actualWin * chestMultApplied).toFixed(2));

        let bookCount = hotbar.filter(s => s.type === 'book').length;
        if (bookCount >= 3) {
            user.mineFreeSpins = (user.mineFreeSpins || 0) + 1;
        }

        user[field] = Number((user[field] + actualWin).toFixed(2));
        if (!isDemo && actualWin > 0) { user.stats.wins++; user.stats.plus += actualWin; }
        await user.save();

        if (!isDemo) {
            const betEntry = new Bet({
                userId: user.id, username: user.username,
                avatar: user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
                game: 'Mine', amount: betAmount,
                multiplier: betAmount > 0 ? (actualWin / betAmount) : 0,
                result: Number((actualWin-betAmount).toFixed(2)), mode: 'Real', balanceAfter: user[field], balance: user[field]
            });
            await betEntry.save();
            pushToGlobalHistory(betEntry);
        }

        res.json({ grid, blockWins: adjustedBlockWins, hotbar, chestMults, chestActivated, win: actualWin, blockWinSum: Number(blockWinSum.toFixed(2)), user, freeSpinsLeft: user.mineFreeSpins || 0 });
    } catch (err) {
        console.error('Mine error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
        actionLocks.delete(id);
    }
});

// === UPGRADE GAME ===
app.post('/api/upgrade', async (req, res) => {
    const { id, bet, chance, mode } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({ error: 'Подождите...' });
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const betAmount = parseFloat(bet) || 0;
        const maintSetting = await Settings.findOne({ key: 'maintenance_upgrade' });
        if (maintSetting && maintSetting.value === true) return res.status(400).json({ error: 'Игра на техническом обслуживании' });
        const rtpSetting = await Settings.findOne({ key: 'rtp_upgrade' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 85;

        // Применяем настройки механики апгрейда
        const upgMaxChanceGS = await Settings.findOne({ key: 'game_upg_max_chance' });
        const upgMaxBetGS    = await Settings.findOne({ key: 'game_upg_max_bet' });
        const maxChance = upgMaxChanceGS ? Number(upgMaxChanceGS.value) : 90;
        const maxUpgBet = upgMaxBetGS    ? Number(upgMaxBetGS.value)    : 25;

        if (betAmount < 0.1 || betAmount > maxUpgBet) return res.status(400).json({ error: `Ставка от 0.1 до ${maxUpgBet} TON` });
        if (user[field] < betAmount) return res.status(400).json({ error: 'Недостаточно средств' });
        user[field] = Number((user[field] - betAmount).toFixed(2));
        if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; user.totalWagered = Number(((user.totalWagered || 0) + betAmount).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + betAmount).toFixed(2)); }
        const chanceP=Math.max(1,Math.min(maxChance,parseFloat(chance)||50));
        let mult;if(chanceP<=10){mult=Math.round((20+(9.6-20)*(chanceP-1)/9)*100)/100;}else{mult=Math.max(1.01,Math.floor(96/chanceP*100)/100);}
        const isWin=Math.random()*100<chanceP;const actualWin=isWin?Number((betAmount*mult).toFixed(2)):0;
        const profit=Number((isWin?actualWin-betAmount:-betAmount).toFixed(2));
        if(actualWin>0){user[field]=Number((user[field]+actualWin).toFixed(2));if(!isDemo){user.stats.wins++;user.stats.plus+=profit;}}
        await user.save();
        if (!isDemo) {
            const betEntry = new Bet({ userId: user.id, username: user.username, avatar: user.photo || '', game: 'Upgrade', amount: betAmount, multiplier: mult, result: Number((actualWin-betAmount).toFixed(2)), mode: 'Real', balanceAfter: user[field], balance: user[field] });
            await betEntry.save(); pushToGlobalHistory(betEntry);
        }
        res.json({ win: actualWin, profit, multiplier: Number(mult.toFixed(2)), isWin, user });
    } catch (err) { console.error('Upgrade error:', err); res.status(500).json({ error: 'Ошибка сервера' }); } finally { actionLocks.delete(id); }
});

// === PLINKO GAME ===
app.post('/api/plinko', async (req, res) => {
    const { id, bet, mode, risk } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({ error: 'Подождите...' });
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const betAmount = parseFloat(bet) || 0;
        if (betAmount < 0.1 || betAmount > 25) return res.status(400).json({ error: 'Ставка от 0.1 до 25 TON' });
        if (user[field] < betAmount) return res.status(400).json({ error: 'Недостаточно средств' });
        const maintSetting = await Settings.findOne({ key: 'maintenance_plinko' });
        if (maintSetting && maintSetting.value === true) return res.status(400).json({ error: 'Игра на техническом обслуживании' });
        const rtpSetting = await Settings.findOne({ key: 'rtp_plinko' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 88;
        user[field] = Number((user[field] - betAmount).toFixed(2));
        if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; user.totalWagered = Number(((user.totalWagered || 0) + betAmount).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + betAmount).toFixed(2)); }
        // Plinko: ball drops through 12 rows of pegs, landing in one of 13 buckets
        const riskLevel = risk || 'medium';
        const lowMults =    [1.2, 1.1, 1.0, 0.7, 0.5, 0.3, 0.2, 0.3, 0.5, 0.7, 1.0, 1.1, 1.2];
        const medMults =    [2.0, 1.5, 1.2, 0.8, 0.5, 0.3, 0.2, 0.3, 0.5, 0.8, 1.2, 1.5, 2.0];
        const highMults =   [5.0, 2.5, 1.5, 0.8, 0.4, 0.2, 0.1, 0.2, 0.4, 0.8, 1.5, 2.5, 5.0];
        const mults = riskLevel === 'low' ? lowMults : riskLevel === 'high' ? highMults : medMults;
        // Simulate ball path through 12 rows
        const path = [];
        let pos = 6; // start center
        for (let row = 0; row < 12; row++) {
            const goRight = Math.random() < 0.5;
            pos = Math.max(0, Math.min(12, pos + (goRight ? 1 : -1)));
            path.push(pos);
        }
        // RTP adjustment
        let bucket = path[path.length - 1];
        let mult = mults[bucket];
        // RTP: chance to force low-value bucket
        const loseChance = 1 - (rtpTarget / 150);
        if (Math.random() < loseChance && mult >= 0.8) { bucket = 6; mult = mults[6]; path[path.length - 1] = 6; }
        const actualWin = Number((betAmount * mult).toFixed(2));
        if (actualWin > 0) { user[field] = Number((user[field] + actualWin).toFixed(2)); if (!isDemo && actualWin > betAmount) { user.stats.wins++; user.stats.plus += actualWin; } }
        await user.save();
        if (!isDemo) {
            const betEntry = new Bet({ userId: user.id, username: user.username, avatar: user.photo || '', game: 'Plinko', amount: betAmount, multiplier: mult, result: Number((actualWin-betAmount).toFixed(2)), mode: 'Real', balanceAfter: user[field], balance: user[field] });
            await betEntry.save(); pushToGlobalHistory(betEntry);
        }
        res.json({ path, bucket, multiplier: mult, win: actualWin, mults, user });
    } catch (err) { console.error('Plinko error:', err); res.status(500).json({ error: 'Ошибка сервера' }); } finally { actionLocks.delete(id); }
});

// === DUCK GAME ===
app.post('/api/duck', async (req, res) => {
    const { id, bet, mode, duckCount } = req.body;
    if (actionLocks.has(id)) return res.status(429).json({ error: 'Подождите...' });
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const betAmount = parseFloat(bet) || 0;
        if (betAmount < 0.1 || betAmount > 25) return res.status(400).json({ error: 'Ставка от 0.1 до 25 TON' });
        if (user[field] < betAmount) return res.status(400).json({ error: 'Недостаточно средств' });
        const maintSetting = await Settings.findOne({ key: 'maintenance_duck' });
        if (maintSetting && maintSetting.value === true) return res.status(400).json({ error: 'Игра на техническом обслуживании' });
        const rtpSetting = await Settings.findOne({ key: 'rtp_duck' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 87;
        user[field] = Number((user[field] - betAmount).toFixed(2));
        if (!isDemo) { user.stats.bets++; user.stats.minus += betAmount; user.totalWagered = Number(((user.totalWagered || 0) + betAmount).toFixed(2)); user.wagerCompleted = Number(((user.wagerCompleted || 0) + betAmount).toFixed(2)); }
        // Duck: pick N ducks from a pond of 10, some have prizes
        const totalDucks = 10;
        const picks = Math.min(Math.max(1, duckCount || 3), 5);
        const prizes = [];
        for (let i = 0; i < totalDucks; i++) {
            const r = Math.random();
            if (r < 0.15) prizes.push(Number((betAmount * (0.5 + Math.random() * 2)).toFixed(2)));
            else if (r < 0.35) prizes.push(Number((betAmount * (0.1 + Math.random() * 0.5)).toFixed(2)));
            else prizes.push(0);
        }
        // Shuffle prizes
        for (let i = prizes.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [prizes[i], prizes[j]] = [prizes[j], prizes[i]]; }
        // Player picks
        const picked = [];
        const usedIdxs = new Set();
        for (let p = 0; p < picks; p++) {
            let idx;
            do { idx = Math.floor(Math.random() * totalDucks); } while (usedIdxs.has(idx));
            usedIdxs.add(idx);
            picked.push({ index: idx, prize: prizes[idx] });
        }
        let totalWin = picked.reduce((s, p) => s + p.prize, 0);
        // RTP control: stricter loss chance
        const duckLoseChance = 1 - (rtpTarget / 150);
        if (Math.random() < duckLoseChance || totalWin > betAmount * 2) {
            totalWin = Number((betAmount * (Math.random() * 0.2)).toFixed(2));
            picked.forEach(p => p.prize = Number((totalWin / picks).toFixed(2)));
        }
        totalWin = Number(totalWin.toFixed(2));
        if (totalWin > 0) { user[field] = Number((user[field] + totalWin).toFixed(2)); if (!isDemo && totalWin > betAmount) { user.stats.wins++; user.stats.plus += totalWin; } }
        await user.save();
        if (!isDemo) {
            const betEntry = new Bet({ userId: user.id, username: user.username, avatar: user.photo || '', game: 'Duck', amount: betAmount, multiplier: betAmount > 0 ? totalWin / betAmount : 0, result: totalWin - betAmount, mode: 'Real', balanceAfter: user[field], balance: user[field] });
            await betEntry.save(); pushToGlobalHistory(betEntry);
        }
        res.json({ ducks: prizes, picked, totalWin, user });
    } catch (err) { console.error('Duck error:', err); res.status(500).json({ error: 'Ошибка сервера' }); } finally { actionLocks.delete(id); }
});

app.post('/api/check_deposit', async (req, res) => {
    const { id } = req.body;
    const adminWallet = process.env.ADMIN_WALLET;
    const apiKey = process.env.TON_API_KEY;

    if (!adminWallet) return res.status(500).json({error: 'Адрес кошелька не настроен. Установите ADMIN_WALLET в .env'});
    if (!apiKey) return res.status(500).json({error: 'TON_API_KEY не установлен в .env'});

    try {
        const cleanAddr = adminWallet.trim().replace(/[\r\n\s]/g, '');
        const cleanKey = apiKey.trim().replace(/[\r\n\s]/g, '');
        // FIX: добавляем CRC16 если адрес 46 символов (без checksum)
        const tcAddr = ensureTonAddr48(cleanAddr) || cleanAddr;
        const tcUrl = `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(tcAddr)}&limit=50`;
        console.log('[TonCenter] addr len:', tcAddr.length, tcAddr.slice(0,10)+'...');
        const tcRes = await fetch(tcUrl, {
            headers: { 'X-API-Key': cleanKey }
        });
        if (!tcRes.ok) {
            const errBody = await tcRes.text().catch(() => '');
            console.error('TonCenter HTTP error:', tcRes.status, errBody);
            return res.status(400).json({ error: `TonCenter HTTP ${tcRes.status}: ${errBody.slice(0, 100)}` });
        }
        const data = await tcRes.json();
        if (!data.ok) {
            console.error('TonCenter error:', data.error);
            return res.status(400).json({ error: `Ошибка TonCenter: ${data.error || 'нет ответа'}` });
        }

        let foundNew = false;
        let totalAdded = 0;
        const userId = String(id).trim();

        for (const tx of (data.result || [])) {
            if (!tx.in_msg || !tx.in_msg.value || Number(tx.in_msg.value) <= 0) continue;

            // Check comment in multiple possible fields
            let comment = '';
            if (tx.in_msg.message) comment = String(tx.in_msg.message).trim();
            if (!comment && tx.in_msg.msg_data && tx.in_msg.msg_data.text) {
                try { comment = Buffer.from(tx.in_msg.msg_data.text, 'base64').toString('utf-8').trim(); } catch(e) {}
            }

            if (!comment.includes(userId) && comment !== userId) continue;

            const txHash = tx.transaction_id ? tx.transaction_id.hash : tx.hash;
            if (!txHash) continue;
            const amountTON = Number(tx.in_msg.value) / 1e9;
            if (amountTON < 0.01) continue;

            const exists = await Deposit.findOne({ hash: txHash });
            if (exists) continue;

            await Deposit.create({ hash: txHash, userId: id, amount: amountTON, time: getMskTime() });
            const user = await User.findOne({ id });
            user.balance = Number((user.balance + amountTON).toFixed(2));
            user.depositHistory.unshift({ hash: txHash, amount: amountTON, status: 'Успешно', time: getMskTime() });
            // Wager requirement: add deposit * wager_multiplier to required wagering
            const wagerSetting = await Settings.findOne({ key: 'wager_multiplier' });
            const wagerMult = wagerSetting ? Number(wagerSetting.value) : 2;
            user.totalDeposited = Number(((user.totalDeposited || 0) + amountTON).toFixed(2));
            // Вейджер: каждый депозит добавляет свой отыгрыш
            // Промо и выдача от адмнина НЕ добавляют к вейджеру
            const prevWagerLeft = Math.max(0, (user.wagerRequired||0) - (user.wagerCompleted||0));
            user.wagerRequired = Number(((user.wagerCompleted||0) + prevWagerLeft + amountTON * wagerMult).toFixed(2));
            await user.save();
            foundNew = true;
            totalAdded += amountTON;

            if(bot) {
                bot.sendMessage(id, `📥 ✅ Ваш баланс успешно пополнен на **${amountTON} TON**!`, {parse_mode: 'Markdown'}).catch(()=>{});
            }

            if (user.referredBy) {
                const referrer = await User.findOne({ id: user.referredBy });
                if (referrer) {
                    const refUserId = String(id);
                    const depCount = (referrer.referralDepositCounts && referrer.referralDepositCounts.get(refUserId)) || 0;
                    if (depCount < 10) {
                        // Только первые 10 депозитов приносят %
                        const refBonus = Number((amountTON * 0.10).toFixed(2));
                        // Накапливаем в pending (не сразу на баланс)
                        referrer.referralPending = Number(((referrer.referralPending||0) + refBonus).toFixed(2));
                        referrer.referralEarnings = Number(((referrer.referralEarnings||0) + refBonus).toFixed(2));
                        if(!referrer.referralDepositCounts) referrer.referralDepositCounts = new Map();
                        referrer.referralDepositCounts.set(refUserId, depCount + 1);
                        referrer.markModified('referralDepositCounts');
                        await referrer.save();
                        if (bot) {
                            bot.sendMessage(referrer.id, '🎉 Реферал пополнил! +'+refBonus+' TON (10%) ожидают в реферальном кошельке.', {parse_mode:'Markdown'}).catch(()=>{});
                        }
                    }
                }
            }
        }
        if(foundNew) {
            const updUser = await User.findOne({id});
            res.json({ success: true, added: totalAdded, user: updUser });
        } else res.status(400).json({ error: 'Новых оплат не найдено. Убедитесь что в комментарии указан ваш ID и прошло достаточно времени.' });
    } catch (e) {
        console.error('Deposit check error:', e);
        res.status(500).json({error: 'Ошибка сети при проверке. Попробуйте позже.'});
    }
});

app.post('/api/promo', async (req, res) => {
    const { id, code } = req.body;
    const promo = await Promo.findOne({ code: { $regex: new RegExp('^'+String(code||'').trim()+'$','i') } });
    
    if(!promo) return res.status(400).json({error: 'Промокод не найден'});
    if(promo.usedBy.length >= promo.limit || promo.usedBy.includes(id)) return res.status(400).json({error: 'Промокод уже активирован'});
    
    const user = await User.findOne({ id });
    user.balance = Number((user.balance + promo.amount).toFixed(2)); 
    user.stats.promo += promo.amount; 
    promo.usedBy.push(id);
    // Промокод НЕ добавляет к wagerRequired (только реальные депозиты)
    await user.save(); await promo.save();
    await logAdmin(`Промокод ${promo.code || ''} активирован юзером ${id}, +${promo.amount} TON`);

    if(bot){bot.sendMessage(id,'🎁 Промокод активирован! +'+promo.amount+' TON зачислено.',{parse_mode:'Markdown'}).catch(()=>{});}
    res.json({user,amount:promo.amount});
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address, amount } = req.body;
    
    if (actionLocks.has(id)) return res.status(429).json({error: 'Подождите...'});
    actionLocks.add(id);

    try {
        const user = await User.findOne({ id });
        const minWdSett=await Settings.findOne({key:'min_withdraw'});const minWd=minWdSett?Number(minWdSett.value):5;
        if (isNaN(amount) || user.balance < amount || amount < minWd) return res.status(400).json({error: 'Min '+minWd+' TON'});
        // Check wager requirement
        const wagerLeft = Math.max(0, (user.wagerRequired||0) - (user.wagerCompleted||0));
        if (wagerLeft > 0.01) return res.status(400).json({error: `Нужно отыграть ещё ${wagerLeft.toFixed(2)} TON перед выводом`});
        user.balance = Number((user.balance - amount).toFixed(2)); 
        
        const newW = await Withdraw.create({ userId: id, address, amount, time: getMskTime() });
        
        user.withdrawHistory.unshift({ withdrawId: newW._id, amount, address, status: 'В обработке', reason: '', time: newW.time });
        await user.save();

        res.json(user);
    } finally {
        actionLocks.delete(id);
    }
});

// --- АДМИН ПАНЕЛЬ ---
const checkAdmin = (req, res, next) => {
    if(req.body.pass !== (process.env.ADMIN_PASS || '1234')) return res.status(403).json({error: 'Wrong pass'});
    next();
};

app.post('/api/admin/data', checkAdmin, async (req, res) => {
    const withdraws = await Withdraw.find({status: 'pending'});
    const promos = await Promo.find().sort({_id: -1}).limit(10);
    const users = await User.find().sort({balance: -1}).limit(100);
    const totalUsers = await User.countDocuments();
    
    const allDeps = await Deposit.aggregate([{$group: {_id: null, total: {$sum: "$amount"}}}]);
    const allWiths = await Withdraw.aggregate([{$match: {status: 'approved'}}, {$group: {_id: null, total: {$sum: "$amount"}}}]);
    const totalDeposited = allDeps[0] ? allDeps[0].total : 0;
    const totalWithdrawn = allWiths[0] ? allWiths[0].total : 0;
    
    const latestDepositsRaw = await Deposit.find().sort({_id: -1}).limit(20);
    const latestDeposits = [];
    for(let d of latestDepositsRaw) {
        const u = await User.findOne({id: d.userId});
        latestDeposits.push({amount: d.amount, userId: d.userId, username: u ? u.username : 'Unknown', time: d.time});
    }

    const allSettings = await Settings.find();
    const rtpData = {};
    const maintenanceData = {};
    allSettings.forEach(s => {
        if (s && s.key) {
            if (s.key.startsWith('rtp_')) rtpData[s.key.replace('rtp_', '')] = s.value;
            if (s.key.startsWith('maintenance_')) maintenanceData[s.key.replace('maintenance_', '')] = s.value;
        }
    });

    const latestBetsRaw = await Bet.find().sort({createdAt: -1}).limit(20);
    const latestBets = latestBetsRaw.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));
    
    const wagerSetting = await Settings.findOne({ key: 'wager_multiplier' });
    const wagerMultiplier = wagerSetting ? wagerSetting.value : 2;

    res.json({
        withdraws, promos, users, totalUsers,
        totalDeposited, totalWithdrawn, latestDeposits,
        latestBets, betHistory: latestBets, history: latestBets,
        rtp: rtpData, maintenance: maintenanceData, wagerMultiplier
    });
});

app.post('/api/admin/search_user', checkAdmin, async (req, res) => {
    const { query, filterType } = req.body;
    let filter = {};
    if (query) filter = { $or: [{ id: new RegExp(query,'i') }, { username: new RegExp(query,'i') }] };
    if (filterType === 'banned') filter.isBlocked = true;
    let sortConfig = { balance: -1 };
    if (filterType === 'new') sortConfig = { createdAt: -1 };
    if (filterType === 'online') {
        const ids = Array.from(getOnlineUserIds());
        filter = { ...filter, id: { $in: ids } };
    }
    const users = await User.find(filter).sort(sortConfig).limit(500);
    const onlineIds = getOnlineUserIds();
    const usersWithOnline = users.map(u => ({ ...u.toObject(), isOnline: onlineIds.has(String(u.id)) }));
    res.json({ users: usersWithOnline, onlineCount: onlineIds.size });
});

// Топ рефералов для админки
app.post('/api/admin/top_referrals', checkAdmin, async (req, res) => {
    try {
        const users = await User.find({})
            .select('id username photo balance referrals referralEarnings referralPending totalDeposited')
            .lean();
        const sorted = users
            .map(u => ({ ...u, refCount: (u.referrals || []).length }))
            .filter(u => u.refCount > 0)
            .sort((a, b) => b.refCount - a.refCount)
            .slice(0, 50);
        res.json({ users: sorted });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post(['/api/admin/user_details', '/api/admin/user_history'], checkAdmin, async (req, res) => {
    const targetId = String(req.body.userId || req.body.id || req.body.tgId || req.body.user_id);
    const page = req.body.page || 1;
    const limit = req.body.limit || 50; 
    
    const user = await User.findOne({ id: targetId });
    if (!user) return res.status(404).json({error: 'User not found'});

    const totalBets = await Bet.countDocuments({ userId: targetId });
    const totalPages = Math.ceil(totalBets / limit);
    const bets = await Bet.find({ userId: targetId })
        .sort({ createdAt: -1 }) 
        .skip((page - 1) * limit)
        .limit(limit);

    const formattedBets = bets.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));

    // Get deposit/withdraw totals for this user
    const userDeposits = await Deposit.find({ userId: targetId }).sort({ _id: -1 }).limit(50);
    const userWithdraws = await Withdraw.find({ userId: targetId }).sort({ _id: -1 }).limit(50);
    const totalUserDeposited = userDeposits.reduce((s, d) => s + d.amount, 0);
    const totalUserWithdrawn = userWithdraws.filter(w => w.status === 'approved').reduce((s, w) => s + w.amount, 0);

    const userObj = user.toObject();
    userObj.betHistory = formattedBets;

    res.json({
        user: userObj,
        bets: formattedBets,
        betHistory: formattedBets,
        history: formattedBets,
        deposits: userDeposits.map(d => ({ amount: d.amount, time: d.time, hash: d.hash })),
        withdrawals: userWithdraws.map(w => ({ amount: w.amount, status: w.status, address: w.address, time: w.time, reason: w.reason })),
        totalUserDeposited: Number(totalUserDeposited.toFixed(2)),
        totalUserWithdrawn: Number(totalUserWithdrawn.toFixed(2)),
        wagerRequired: user.wagerRequired || 0,
        wagerCompleted: user.wagerCompleted || 0,
        pagination: {
            currentPage: Number(page),
            totalPages,
            totalBets
        }
    });
});
// Усиленная обработка кнопок баланса (исправленная версия без краша Mongoose)
app.post('/api/admin/edit_balance', checkAdmin, async (req, res) => {
    try {
        const targetId = String(req.body.userId || req.body.id || req.body.tgId || req.body.user_id);
        if (!targetId) return res.status(400).json({ error: 'ID не передан' });

        // БЕЗОПАСНЫЙ ПОИСК: формируем условия динамически
        const searchConditions = [{ id: targetId }];
        if (mongoose.isValidObjectId(targetId)) {
            searchConditions.push({ _id: targetId });
        }

        let user = await User.findOne({ $or: searchConditions });

        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        const rawAmount = req.body.amount !== undefined ? req.body.amount : (req.body.balance !== undefined ? req.body.balance : req.body.value);
        let val = Number(String(rawAmount || 0).replace(',', '.'));
        
        if (isNaN(val)) return res.status(400).json({ error: 'Неверное число' });

        const action = String(req.body.action || req.body.type || req.body.method || '').toLowerCase();
        
        // Определяем, нужно ли вычесть деньги
        const isSubtraction = val < 0 || action.includes('sub') || action.includes('minus') || action.includes('remove') || action.includes('take') || action.includes('decrease');
        const absVal = Math.abs(val);

        if (isSubtraction) {
            user.balance = Number((user.balance - absVal).toFixed(2));
            if (user.balance < 0) user.balance = 0; // Защита от отрицательного баланса
            if (bot && absVal > 0) bot.sendMessage(user.id, `📉 С вашего баланса было списано **${absVal} TON** администратором.`, {parse_mode: 'Markdown'}).catch(() => {});
        } else {
            user.balance = Number((user.balance + absVal).toFixed(2));
            if (bot && absVal > 0) bot.sendMessage(user.id, `💰 Ваш баланс был пополнен администратором на **${absVal} TON**!`, {parse_mode: 'Markdown'}).catch(() => {});
        }

        await user.save();
        const logStr = isSubtraction
            ? `Списал ${absVal} TON у пользователя ${user.username || user.id} (новый баланс: ${user.balance} TON)`
            : `Выдал ${absVal} TON пользователю ${user.username || user.id} (новый баланс: ${user.balance} TON)`;
        await logAdmin(logStr);
        res.json({ success: true, newBalance: user.balance, balance: user.balance });

    } catch (err) {
        console.error('Ошибка в edit_balance:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Алиас для фронтенда (вызывает ту же логику)
app.post('/api/admin/change_balance', checkAdmin, async (req, res) => {
    const targetId = String(req.body.userId || req.body.id || '');
    if (!targetId) return res.status(400).json({ error: 'ID не передан' });
    const searchConditions = [{ id: targetId }];
    if (mongoose.isValidObjectId(targetId)) searchConditions.push({ _id: targetId });
    let user = await User.findOne({ $or: searchConditions });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const rawAmount = req.body.amount !== undefined ? req.body.amount : 0;
    const absVal = Math.abs(Number(String(rawAmount).replace(',', '.')));
    if (isNaN(absVal) || absVal <= 0) return res.status(400).json({ error: 'Неверная сумма' });
    const type = String(req.body.type || '').toLowerCase();
    const isSub = type === 'sub' || type === 'minus' || type === 'remove';
    if (isSub) {
        user.balance = Number(Math.max(0, user.balance - absVal).toFixed(2));
        if (bot) bot.sendMessage(user.id, `📉 С вашего баланса было списано **${absVal} TON** администратором.`, {parse_mode: 'Markdown'}).catch(() => {});
        await logAdmin(`Списал ${absVal} TON у пользователя ${user.username || user.id} (новый баланс: ${user.balance} TON)`);
    } else {
        user.balance = Number((user.balance + absVal).toFixed(2));
        if (bot) bot.sendMessage(user.id, `💰 Ваш баланс был пополнен администратором на **${absVal} TON**!`, {parse_mode: 'Markdown'}).catch(() => {});
        await logAdmin(`Выдал ${absVal} TON пользователю ${user.username || user.id} (новый баланс: ${user.balance} TON)`);
    }
    await user.save();
    res.json({ success: true, newBalance: user.balance, balance: user.balance });
});

app.post('/api/admin/broadcast', checkAdmin, (req, res) => {
    const { text } = req.body;
    if(text) io.emit('global_alert', text);
    res.json({success: true});
});

app.post('/api/admin/bot_broadcast', checkAdmin, async (req, res) => {
    const { text } = req.body;
    if(!text || !bot) return res.status(400).json({error: 'Текст пуст'});
    const users = await User.find({ isBlocked: false });
    for(let u of users) { bot.sendMessage(u.id, text).catch(()=>{}); }
    res.json({success: true});
});

app.post('/api/admin/reset_all_stats', checkAdmin, async (req, res) => {
    await User.updateMany({}, { $set: { betHistory: [], demo_balance: 5000, stats: { bets: 0, wins: 0, plus: 0, minus: 0, promo: 0 } } });
    await Bet.deleteMany({});
    globalBetHistory = [];
    io.emit('init_history', globalBetHistory);
    res.json({success: true});
});

app.post('/api/admin/maintenance', checkAdmin, async (req, res) => {
    const { game, state } = req.body;
    const key = `maintenance_${game}`;
    await Settings.updateOne({key}, {value: state}, {upsert: true});
    
    const allSettings = await Settings.find({key: /maintenance_/});
    const mData = {};
    allSettings.forEach(s => { if (s && s.key) mData[s.key.replace('maintenance_', '')] = s.value; });
    io.emit('maintenanceUpdate', mData);
    res.json({success: true});
});

app.post('/api/admin/promo_create', checkAdmin, async (req, res) => {
    const { code, amount, limit } = req.body;
    if(!code || !amount || !limit) return res.status(400).json({error: 'Заполните все поля'});
    await Promo.create({ code, amount: Number(amount), limit: Number(limit) });
    res.json({success: true});
});

app.post('/api/admin/promo_delete', checkAdmin, async (req, res) => {
    await Promo.findByIdAndDelete(req.body.pId);
    res.json({success: true});
});

app.post('/api/admin/set_rtp', checkAdmin, async (req, res) => {
    const { game, value } = req.body;
    const key = `rtp_${game}`;
    const old = await Settings.findOne({key});
    await Settings.updateOne({key}, {value: Number(value)}, {upsert: true});
    await logAdmin(`Изменил RTP ${game}: ${old?old.value:'?'} → ${value}%`);
    res.json({success: true});
});

app.post('/api/admin/set_wager', checkAdmin, async (req, res) => {
    const { value } = req.body;
    await Settings.updateOne({key: 'wager_multiplier'}, {value: Number(value)}, {upsert: true});
    await logAdmin(`Изменил множитель отыгрыша на x${value}`);
    res.json({success: true});
});

app.post('/api/admin/withdraw_action', checkAdmin, async (req, res) => {
    const { wId, action, reason } = req.body;
    const w = await Withdraw.findById(wId);
    if(!w || w.status !== 'pending') return res.status(400).json({error: 'Error'});
    
    const u = await User.findOne({id: w.userId});
    if(u) {
        let uHist = u.withdrawHistory.find(h => h.withdrawId ? h.withdrawId.toString() === w._id.toString() : (h.time === w.time && h.amount === w.amount));
        
        if(action === 'reject') {
            u.balance = Number((u.balance + w.amount).toFixed(2)); 
            if(uHist) { uHist.status = 'Отклонено'; uHist.reason = reason; }
        } else {
            if(uHist) { uHist.status = 'Подтверждено'; }
            if(bot) {
                bot.sendMessage(w.userId, `✅ Ваш вывод на сумму **${w.amount} TON** успешно обработан и отправлен на ваш кошелек!`, {parse_mode: 'Markdown'}).catch(()=>{});
            }
        }
        await u.save();
    }
    
    if(action === 'reject') { 
        w.status = 'rejected'; w.reason = reason;
        await logAdmin(`Отклонил вывод ${w.amount} TON (ID юзера: ${w.userId}) — причина: ${reason}`);
    } else { 
        w.status = 'approved';
        await logAdmin(`Одобрил вывод ${w.amount} TON (ID юзера: ${w.userId}) на адрес ${w.address}`);
    }
    await w.save();
    
    res.json({success: true});
});

app.post('/api/admin/user_action', checkAdmin, async (req, res) => {
    const { userId, action, msg } = req.body;
    if (!userId || !action) return res.status(400).json({ error: 'Не указаны параметры' });
    const user = await User.findOne({ id: String(userId) });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (action === 'ban') {
        user.isBlocked = true;
        await logAdmin(`Забанил пользователя ${user.username || user.id}`);
        if (bot) bot.sendMessage(user.id, '🚫 Ваш аккаунт заблокирован администратором.').catch(() => {});
    } else if (action === 'unban') {
        user.isBlocked = false;
        await logAdmin(`Разбанил пользователя ${user.username || user.id}`);
        if (bot) bot.sendMessage(user.id, '✅ Ваш аккаунт разблокирован.').catch(() => {});
    } else if (action === 'message') {
        if (!msg) return res.status(400).json({ error: 'Пустое сообщение' });
        if (bot) {
            try {
                await bot.sendMessage(user.id, `📩 Сообщение от администрации:\n\n${msg}`);
                await logAdmin(`Отправил сообщение пользователю ${user.username || user.id}: ${msg.substring(0, 50)}...`);
            } catch(e) {
                return res.status(400).json({ error: 'Не удалось отправить сообщение. Возможно, пользователь не запускал бота.' });
            }
        } else {
            return res.status(400).json({ error: 'Бот не запущен' });
        }
        return res.json({ success: true });
    } else {
        return res.status(400).json({ error: 'Неизвестное действие' });
    }
    await user.save();
    res.json({ success: true });
});

app.post('/api/admin/game_stats', checkAdmin, async (req, res) => {
    try {
        const games = ['Crash', 'Mines', 'Coinflip', 'Battle', 'Spin', 'Mine', 'Upgrade', 'Case'];
        const stats = {};
        for (const game of games) {
            const agg = await Bet.aggregate([
                { $match: { game, mode: 'Real' } },
                { $group: {
                    _id: null,
                    playCount: { $sum: 1 },
                    totalBet: { $sum: '$amount' },
                    totalPayout: { $sum: { $cond: [{ $gt: ['$result', 0] }, { $add: ['$amount', '$result'] }, 0] } }
                }}
            ]);
            const d = agg[0] || { playCount: 0, totalBet: 0, totalPayout: 0 };
            stats[game] = { playCount: d.playCount, totalBet: d.totalBet, totalPayout: d.totalPayout, profit: d.totalBet - d.totalPayout };
        }
        res.json({ stats });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/reset_game_stats', checkAdmin, async (req, res) => {
    try {
        const { game } = req.body;
        if (game) {
            await Bet.deleteMany({ game, mode: 'Real' });
        } else {
            await Bet.deleteMany({ mode: 'Real' });
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/banner', async (req, res) => {
    try{const b=await Settings.findOne({key:'banner'});res.json({banner:b?b.value:null});}catch(e){res.json({banner:null});}
});
app.post('/api/admin/set_banner', checkAdmin, async (req, res) => {
    try{const {imageUrl,linkUrl,text,active}=req.body;
        // Проверяем размер base64 картинки (макс 5MB в base64 = ~6.7MB строка)
        const imgSize = imageUrl ? Buffer.byteLength(imageUrl,'utf8') : 0;
        if(imgSize > 7*1024*1024) return res.status(400).json({error:'Картинка >5MB. Уменьши или используй URL.'});
        await Settings.findOneAndUpdate({key:'banner'},{key:'banner',value:{imageUrl:imageUrl||'',linkUrl:linkUrl||'',text:text||'',active:active!==false}},{upsert:true,new:true});
        res.json({ok:true});
    }catch(e){res.status(500).json({error:'Ошибка: '+(e.message||'')});}
});
app.get('/api/casino_sound', async (req, res) => {
    try{const s=await Settings.findOne({key:'casino_sound'});res.json({sound:s?s.value:null});}catch(e){res.json({sound:null});}
});
app.post('/api/admin/set_casino_sound', checkAdmin, async (req, res) => {
    try{const {soundUrl,volume,enabled}=req.body;
        const sizeBytes=soundUrl?Buffer.byteLength(soundUrl,'utf8'):0;
        if(sizeBytes>10*1024*1024)return res.status(400).json({error:'Файл >10MB. Используй URL.'});
        await Settings.findOneAndUpdate({key:'casino_sound'},{key:'casino_sound',value:{soundUrl:soundUrl||'',volume:volume!==undefined?volume:0.3,enabled:enabled!==false}},{upsert:true,new:true});
        res.json({ok:true});
    }catch(e){res.status(500).json({error:e.message});}
});
// Мин вывод + настройки
app.post('/api/admin/set_min_withdraw', checkAdmin, async (req, res) => {
    try{const {value}=req.body;const v=parseFloat(value);if(isNaN(v)||v<0)return res.status(400).json({error:'Неверное значение'});
        await Settings.findOneAndUpdate({key:'min_withdraw'},{key:'min_withdraw',value:v},{upsert:true,new:true});
        await logAdmin(`Изменил мин. вывод на ${v} TON`);
        res.json({ok:true});
    }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/admin/game_user_stats', checkAdmin, async (req, res) => {
    try{const{game}=req.body;if(!game)return res.status(400).json({error:'required'});
        const agg=await Bet.aggregate([{$match:{game,mode:'Real'}},{$group:{_id:'$userId',username:{$last:'$username'},playCount:{$sum:1},totalBet:{$sum:'$amount'},totalPayout:{$sum:{$cond:[{$gt:['$result',0]},{$add:['$amount','$result']},0]}}}},{$sort:{totalBet:-1}},{$limit:50}]);
        res.json({users:agg.map(u=>({userId:u._id,username:u.username||u._id,playCount:u.playCount,totalBet:Number(u.totalBet.toFixed(2)),totalPayout:Number(u.totalPayout.toFixed(2)),profit:Number((u.totalBet-u.totalPayout).toFixed(2))}))});
    }catch(err){res.status(500).json({error:'Ошибка'});}
});
app.post('/api/admin/remove_user_game_stats', checkAdmin, async (req, res) => {
    try{const{game,userId}=req.body;if(!game||!userId)return res.status(400).json({error:'required'});
        const r=await Bet.deleteMany({game,userId:String(userId),mode:'Real'});
        res.json({ok:true,deleted:r.deletedCount});
    }catch(err){res.status(500).json({error:'Ошибка'});}
});
app.post('/api/admin/set_game_setting', checkAdmin, async (req, res) => {
    try{const{key,value}=req.body;
        if(!key||!key.startsWith('game_'))return res.status(400).json({error:'Key must start with game_'});
        await Settings.findOneAndUpdate({key},{key,value},{upsert:true,new:true});
        res.json({ok:true});
    }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/admin/get_game_settings', checkAdmin, async (req, res) => {
    try{const settings=await Settings.find({key:/^game_/});
        const result={};settings.forEach(s=>{result[s.key]=s.value;});
        res.json({ok:true,settings:result});
    }catch(e){res.status(500).json({error:e.message});}
});

// Публичный эндпоинт настроек механик (только чтение, без пароля)
app.get('/api/game_settings', async (req, res) => {
    try{
        const settings=await Settings.find({key:/^game_/});
        const result={};settings.forEach(s=>{result[s.key]=s.value;});
        res.json({ok:true,settings:result});
    }catch(e){res.json({ok:true,settings:{}});}
});

// Забрать реф бонус
app.post('/api/ref/claim', async (req, res) => {
    const { id } = req.body;
    try {
        const user = await User.findOne({ id });
        if (!user) return res.status(404).json({error:'Не найден'});
        const pending = user.referralPending || 0;
        if (pending < 0.01) return res.status(400).json({error:'Нечего забирать (мин 0.01 TON)'});
        user.balance = Number((user.balance + pending).toFixed(2));
        user.referralPending = 0;
        await user.save();
        res.json({ ok:true, claimed: pending, user });
    } catch(e) { res.status(500).json({error:e.message}); }
});
// Детальная инфо по рефералам (баланс и депозиты каждого)
app.post('/api/ref/details', async (req, res) => {
    const { id } = req.body;
    try {
        const user = await User.findOne({ id });
        if (!user) return res.status(404).json({error:'Не найден'});
        const refIds = (user.referrals||[]).map(r=>typeof r==='string'?r:r.id);
        const refUsers = await User.find({id:{$in:refIds}}, 'id username photo balance totalDeposited');
        const counts = user.referralDepositCounts || {};
        const details = refUsers.map(r=>{
            const c = (counts && typeof counts.get==='function') ? (counts.get(String(r.id))||0) : (counts[String(r.id)]||0);
            return {
                id: r.id, username: r.username||'User', photo: r.photo||'',
                balance: r.balance||0, totalDeposited: r.totalDeposited||0,
                depositsCounted: c, depositsLeft: Math.max(0,10-c),
                myEarnings: Number(((r.totalDeposited||0)*0.1).toFixed(2)) // примерно
            };
        });
        res.json({ ok:true, details, pending: user.referralPending||0, total: user.referralEarnings||0 });
    } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════
// CASES GAME
// ════════════════════════════════════════
// Базовый конфиг - может быть переопределён из MongoDB Settings
const CASES_DEFAULT = {
    "case1": {"id":"case1","price":0.5,"name":"Трэш Гифт","img":"case1.png",
        "drops":[{"val":0.1,"w":2000},{"val":0.2,"w":1800},{"val":0.3,"w":1500},
                 {"val":0.4,"w":1000},{"val":0.5,"w":700},{"val":0.67,"w":2145},
                 {"val":0.8,"w":200},{"val":1.0,"w":150},{"val":2.0,"w":70},{"val":3.0,"w":30}]},
    "case2": {"id":"case2","price":1.0,"name":"Комон Гифт","img":"case2.png",
        "drops":[{"val":0.2,"w":1908},{"val":0.4,"w":1600},{"val":0.6,"w":1300},
                 {"val":0.8,"w":900},{"val":1.0,"w":700},{"val":1.5,"w":500},
                 {"val":2.0,"w":300},{"val":3.0,"w":200},{"val":5.0,"w":80},
                 {"val":6.7,"w":30},{"val":10.0,"w":10}]},
    "case3": {"id":"case3","price":3.0,"name":"Гуд Гифт","img":"case3.png",
        "drops":[{"val":0.5,"w":1500},{"val":1.0,"w":1400},{"val":1.5,"w":1200},
                 {"val":2.0,"w":1000},{"val":3.0,"w":800},{"val":4.0,"w":1558},
                 {"val":5.0,"w":400},{"val":7.0,"w":200},{"val":10.0,"w":80},{"val":15.0,"w":20}]},
    "case4": {"id":"case4","price":5.0,"name":"Голд Гифт","img":"case4.png",
        "drops":[{"val":1.0,"w":1414},{"val":2.0,"w":1300},{"val":3.0,"w":1200},
                 {"val":4.0,"w":1000},{"val":5.0,"w":800},{"val":6.0,"w":1336},
                 {"val":7.5,"w":400},{"val":10.0,"w":200},{"val":15.0,"w":80},{"val":20.0,"w":20}]},
    "case5": {"id":"case5","price":10.0,"name":"Даймонд Гифт","img":"case5.png",
        "drops":[{"val":2.0,"w":1212},{"val":3.0,"w":1100},{"val":5.0,"w":1000},
                 {"val":7.0,"w":900},{"val":8.0,"w":700},{"val":10.0,"w":4091},
                 {"val":12.0,"w":400},{"val":15.0,"w":250},{"val":20.0,"w":120},
                 {"val":30.0,"w":50},{"val":50.0,"w":15}]},
    "case6": {"id":"case6","price":0,"name":"Лоникс Гифт","img":"case6.png","isFree":true,
        "cooldownHours":24,
        "channels":[],
        "drops":[{"val":0.1,"w":3000},{"val":0.2,"w":2000},{"val":0.3,"w":1500},
                 {"val":0.5,"w":1000},{"val":1.0,"w":500},{"val":2.0,"w":200},
                 {"val":5.0,"w":50},{"val":10.0,"w":10}]}
};
// Рабочая конфигурация (может быть перезаписана из DB)
let CASES_CONFIG = JSON.parse(JSON.stringify(CASES_DEFAULT));
// Загружаем переопределения из Settings при старте
async function loadCasesFromDB() {
    try {
        const saved = await Settings.findOne({key:'cases_config'});
        if(saved && saved.value) {
            CASES_CONFIG = Object.assign({}, CASES_DEFAULT, saved.value);
        }
    } catch(e) {}
}
// Вызываем после initSettings
setTimeout(loadCasesFromDB, 1000);

function weightedRandom(drops) {
    const totalWeight = drops.reduce((s, d) => s + d.w, 0);
    let r = Math.random() * totalWeight;
    for (const d of drops) {
        r -= d.w;
        if (r <= 0) return d.val;
    }
    return drops[drops.length - 1].val;
}

// RTP-скорректированный выбор для кейсов
// С вероятностью (1 - rtp/100) принудительно выдаётся дроп ниже цены кейса
function rtpAdjustedCasePick(drops, rtpTarget, price) {
    const rtp = Math.max(1, Math.min(99, rtpTarget || 78)) / 100;
    if (Math.random() > rtp) {
        const losing = drops.filter(d => d.val < price);
        if (losing.length > 0) return weightedRandom(losing);
    }
    return weightedRandom(drops);
}

// Admin: сохранить конфиг кейса
app.post('/api/admin/set_case_config', checkAdmin, async (req, res) => {
    try {
        const { caseId, price, drops, channels, cooldownHours } = req.body;
        if(!caseId || !CASES_CONFIG[caseId]) return res.status(400).json({error:'Кейс не найден'});
        if(price !== undefined && !CASES_CONFIG[caseId].isFree) CASES_CONFIG[caseId].price = parseFloat(price);
        if(drops && Array.isArray(drops)) {
            const valid = drops.filter(d => d.val>0 && d.w>0);
            if(valid.length > 0) CASES_CONFIG[caseId].drops = valid;
        }
        if(channels !== undefined && CASES_CONFIG[caseId].isFree) {
            CASES_CONFIG[caseId].channels = Array.isArray(channels) ? channels : [];
        }
        if(cooldownHours !== undefined && CASES_CONFIG[caseId].isFree) {
            CASES_CONFIG[caseId].cooldownHours = parseInt(cooldownHours) || 24;
        }
        // Сохраняем в DB
        await Settings.findOneAndUpdate(
            {key:'cases_config'},
            {key:'cases_config', value: CASES_CONFIG},
            {upsert:true, new:true}
        );
        res.json({ok:true, case: CASES_CONFIG[caseId]});
    } catch(e) { res.status(500).json({error:e.message}); }
});
// Admin: получить конфиг кейсов
app.get('/api/admin/cases_config', checkAdmin, async (req, res) => {
    res.json({ cases: Object.values(CASES_CONFIG) });
});

// Статистика кейсов (для админки)
app.post('/api/admin/case_stats', checkAdmin, async (req, res) => {
    try {
        const { caseId } = req.body;
        const matchFilter = caseId ? { game:'Case', 'result': { $exists: true } } : { game:'Case' };
        // Агрегируем по caseId из username поля (hack: храним caseId в multiplier>0 bets)
        const allBets = await Bet.find({game:'Case'}).sort({createdAt:-1}).limit(500);
        const byCaseId = {};
        allBets.forEach(b => {
            // caseId определяем по amount (price)
            const price = b.amount;
            let cid = 'unknown';
            Object.values(CASES_CONFIG).forEach(c => { if(c.price===price) cid=c.id; });
            if(!byCaseId[cid]) byCaseId[cid]={count:0,totalBet:0,totalPayout:0,players:{}};
            byCaseId[cid].count++;
            byCaseId[cid].totalBet+=price;
            const win=Number((price+b.result).toFixed(2));
            byCaseId[cid].totalPayout+=win;
            if(!byCaseId[cid].players[b.userId]) byCaseId[cid].players[b.userId]={username:b.username,count:0,won:0};
            byCaseId[cid].players[b.userId].count++;
            byCaseId[cid].players[b.userId].won+=win;
        });
        // Форматируем
        const result = Object.entries(byCaseId).map(([id,d])=>({
            caseId:id,caseName:(CASES_CONFIG[id]?.name||id),
            openCount:d.count,totalBet:Number(d.totalBet.toFixed(2)),
            totalPayout:Number(d.totalPayout.toFixed(2)),
            profit:Number((d.totalBet-d.totalPayout).toFixed(2)),
            topPlayers:Object.values(d.players).sort((a,b)=>b.count-a.count).slice(0,10)
        }));
        res.json({ok:true, stats:result, total:allBets.length});
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/cases/config', (req, res) => {
    res.json({ cases: Object.values(CASES_CONFIG) });
});

// Получить статус бесплатного кейса для юзера
app.post('/api/cases/free_status', async (req, res) => {
    try {
        const { id, caseId } = req.body;
        const cfg = CASES_CONFIG[caseId];
        if (!cfg || !cfg.isFree) return res.json({ available: true });
        const user = await User.findOne({ id });
        if (!user) return res.json({ available: true });
        const lastMap = user.freeCaseLastOpened || new Map();
        const lastTime = (lastMap instanceof Map) ? lastMap.get(caseId) : lastMap[caseId];
        if (!lastTime) return res.json({ available: true, nextAvailableAt: null });
        const cooldownMs = (cfg.cooldownHours || 24) * 3600000;
        const nextAt = new Date(new Date(lastTime).getTime() + cooldownMs);
        const now = new Date();
        if (now >= nextAt) return res.json({ available: true, nextAvailableAt: null });
        return res.json({ available: false, nextAvailableAt: nextAt.toISOString(), lastOpened: lastTime });
    } catch(e) { res.json({ available: true }); }
});

app.post('/api/cases/open', async (req, res) => {
    const { id, caseId, mode, count } = req.body;
    // Бесплатный кейс (case6): только 1 раз, с cooldown
    const isFreeCase = CASES_CONFIG[caseId] && CASES_CONFIG[caseId].isFree;
    const openCount = isFreeCase ? 1 : Math.min(5, Math.max(1, parseInt(count)||1));
    if (actionLocks.has(id)) return res.status(429).json({error:'Подождите...'});
    actionLocks.add(id);
    try {
        const user = await User.findOne({ id });
        if (!user || user.isBlocked) return res.status(403).send();
        
        const cfg = CASES_CONFIG[caseId];
        if (!cfg) return res.status(400).json({error:'Кейс не найден'});
        
        // Проверяем cooldown для бесплатных кейсов
        if (cfg.isFree) {
            const lastMap = user.freeCaseLastOpened || new Map();
            const lastTime = (lastMap instanceof Map) ? lastMap.get(caseId) : lastMap[caseId];
            if (lastTime) {
                const cooldownMs = (cfg.cooldownHours || 24) * 3600000;
                const nextAt = new Date(new Date(lastTime).getTime() + cooldownMs);
                if (new Date() < nextAt) {
                    const hoursLeft = ((nextAt - new Date()) / 3600000).toFixed(1);
                    return res.status(400).json({error:`Кейс доступен через ${hoursLeft} ч`});
                }
            }
            // Проверяем подписку на каналы (server-side enforcement)
            const channels = cfg.channels || [];
            if (channels.length > 0) {
                const token = process.env.BOT_TOKEN;
                if (token) {
                    for (const ch of channels) {
                        try {
                            const chId = ch.startsWith('@') ? ch : '@'+ch;
                            const r = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chId)}&user_id=${id}`);
                            const d = await r.json();
                            if (d.ok) {
                                const status = d.result?.status;
                                const isIn = ['creator','administrator','member'].includes(status);
                                if (!isIn) return res.status(400).json({error:`Подпишитесь на ${chId} чтобы открыть кейс`});
                            }
                        } catch(e) { /* network error - skip check */ }
                    }
                }
            }
        }
        
        const maintSetting = await Settings.findOne({ key: 'maintenance_case' });
        if (maintSetting && maintSetting.value === true) return res.status(400).json({error:'Игра временно недоступна'});
        
        const isDemo = mode === 'demo';
        const field = isDemo ? 'demo_balance' : 'balance';
        const price = cfg.price;
        
        const totalCost = Number((price * openCount).toFixed(2));
        if (user[field] < totalCost) return res.status(400).json({error:'Недостаточно средств'});
        
        // RTP из настроек
        const rtpSetting = await Settings.findOne({ key: 'rtp_cases' });
        const rtpTarget = rtpSetting ? Number(rtpSetting.value) : 78;
        
        // Генерируем результаты для каждого кейса с учётом RTP
        const results = [];
        let totalWin = 0;
        for(let i=0; i<openCount; i++){
            const w = rtpAdjustedCasePick(cfg.drops, rtpTarget, price);
            results.push(w);
            totalWin += w;
        }
        totalWin = Number(totalWin.toFixed(2));
        const totalProfit = Number((totalWin - totalCost).toFixed(2));
        
        user[field] = Number((user[field] - totalCost + totalWin).toFixed(2));
        
        if (!isDemo) {
            user.stats.bets += openCount;
            user.totalWagered = Number(((user.totalWagered||0) + totalCost).toFixed(2));
            user.wagerCompleted = Number(((user.wagerCompleted||0) + totalCost).toFixed(2));
            user.stats.plus = Number(((user.stats.plus||0) + totalWin).toFixed(2));
            user.stats.minus = Number(((user.stats.minus||0) + totalCost).toFixed(2));
            if(totalProfit > 0) user.stats.wins++;
        }
        // Записываем время открытия бесплатного кейса
        if (cfg.isFree) {
            if (!user.freeCaseLastOpened) user.freeCaseLastOpened = new Map();
            if (!(user.freeCaseLastOpened instanceof Map)) {
                user.freeCaseLastOpened = new Map(Object.entries(user.freeCaseLastOpened));
            }
            user.freeCaseLastOpened.set(caseId, new Date());
            user.markModified('freeCaseLastOpened');
        }
        await user.save();
        
        if (!isDemo) {
            const betEntry = new Bet({
                userId: user.id, username: user.username,
                avatar: user.photo||'https://cdn-icons-png.flaticon.com/512/149/149071.png',
                game: 'Case', amount: totalCost,
                multiplier: Number((totalWin/totalCost).toFixed(2)),
                result: totalProfit, mode: 'Real',
                balanceAfter: user[field], balance: user[field]
            });
            await betEntry.save();
            pushToGlobalHistory(betEntry);
        }
        
        res.json({ results, totalWin, totalProfit, price, openCount, user, caseId });
    } catch(e) {
        console.error('Cases error:', e);
        res.status(500).json({error:'Ошибка сервера'});
    } finally {
        actionLocks.delete(id);
    }
});

// Проверка подписки на каналы для бесплатного кейса
app.post('/api/cases/check_subscriptions', async (req, res) => {
    try {
        const { id, caseId } = req.body;
        const cfg = CASES_CONFIG[caseId];
        if (!cfg || !cfg.isFree) return res.json({ok:true, subscribed:true});
        
        const channels = cfg.channels || [];
        
        // Если каналов нет - сразу разрешаем
        if (channels.length === 0) return res.json({ok:true, subscribed:true});
        
        // Проверяем через Telegram Bot API
        const token = process.env.BOT_TOKEN;
        if (!token) return res.json({ok:true, subscribed:true}); // если нет бота - пропускаем
        
        for (const ch of channels) {
            try {
                const chId = ch.startsWith('@') ? ch : '@'+ch;
                const r = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chId)}&user_id=${id}`);
                const d = await r.json();
                if (!d.ok) {
                    // Канал недоступен боту — логируем и пропускаем (для публичных каналов должно работать)
                    console.warn(`[Sub check] Бот не может проверить ${chId}: ${d.description||'нет доступа'}. Добавьте бота в канал.`);
                    continue;
                }
                const status = d.result?.status;
                const isIn = ['creator','administrator','member'].includes(status);
                if (!isIn) return res.json({ok:false, subscribed:false, error:`Подпишитесь на ${chId}`});
            } catch(e) { /* Сеть недоступна — пропускаем */ }
        }
        
        res.json({ok:true, subscribed:true});
    } catch(e) { res.json({ok:true, subscribed:true}); }
});

// Обновление конфига кейса (включая case6 channels + cooldown)

app.post('/api/admin/logs', checkAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.body.page) || 1);
        const limit = Math.min(50, parseInt(req.body.limit) || 30);
        const dateQuery = req.body.date || '';
        const filter = dateQuery ? { action: { $regex: dateQuery, $options: 'i' } } : {};
        const total = await AdminLog.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const logs = await AdminLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
        const formatted = logs.map(l => {
            const d = new Date(l.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
            const parts = d.split(', ');
            return { date: parts[0] || '', time: parts[1] || '', adminUser: 'Админ', action: l.action };
        });
        res.json({ logs: formatted, totalPages, total });
    } catch(e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/user/history', async (req, res) => {
    const targetId = String(req.body.id || req.body.userId || req.body.tgId);
    if (!targetId) return res.status(400).json({error: 'No ID provided'});
    const bets = await Bet.find({ userId: targetId }).sort({ createdAt: -1 }).limit(50);
    const formattedBets = bets.map(b => ({
        ...b.toObject(),
        timeMsk: new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    }));
    res.json({ bets: formattedBets, betHistory: formattedBets, history: formattedBets });
});

// Keep-alive endpoint (for uptime monitors like UptimeRobot)
// ping removed

// ── Gift: list user gifts ──
app.post('/api/gifts/list', async (req, res) => {
    try {
        const { id } = req.body;
        const gifts = await Gift.find({ userId: String(id), withdrawRequested: false }).sort({ createdAt: -1 });
        res.json({ gifts });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Gift: get single gift ──
app.post('/api/gifts/get', async (req, res) => {
    try {
        const { id, giftId } = req.body;
        const gift = await Gift.findOne({ _id: giftId, userId: String(id) });
        if (!gift) return res.status(404).json({ error: 'Не найден' });
        res.json({ gift });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Gift: withdraw request (costs 0.3 TON) ──
app.post('/api/gifts/withdraw', async (req, res) => {
    try {
        const { id, giftId } = req.body;
        const user = await User.findOne({ id: String(id) });
        if (!user || user.isBlocked) return res.status(403).json({ error: 'Заблокирован' });
        if (user.balance < 0.3) return res.status(400).json({ error: 'Нужно 0.3 TON на балансе' });
        const gift = await Gift.findOne({ _id: giftId, userId: String(id) });
        if (!gift) return res.status(404).json({ error: 'Подарок не найден' });
        if (gift.withdrawRequested) return res.status(400).json({ error: 'Уже подана заявка' });
        user.balance = Number((user.balance - 0.3).toFixed(2));
        await user.save();
        gift.withdrawRequested = true;
        await gift.save();
        await logAdmin(`Заявка на вывод подарка "${gift.name}" от @${user.username||id}`);
        if (bot) bot.sendMessage(id, `Заявка на вывод подарка "${gift.name}" принята. Ожидайте.`).catch(()=>{});
        res.json({ ok: true, user });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: give gift to user ──
app.post('/api/admin/give_gift', checkAdmin, async (req, res) => {
    try {
        const { userId, name, imageUrl, price } = req.body;
        if (!userId || !name) return res.status(400).json({ error: 'userId и name обязательны' });
        const user = await User.findOne({ id: String(userId) });
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        const gift = await Gift.create({
            userId: String(userId),
            ownerUsername: user.username || String(userId),
            name, imageUrl: imageUrl || '', price: Number(price) || 0
        });
        await logAdmin(`Выдал подарок "${name}" пользователю @${user.username||userId}`);
        if (bot) bot.sendMessage(userId, `🎁 Вам выдан подарок: "${name}"! Посмотрите в разделе Подарки.`).catch(()=>{});
        res.json({ ok: true, gift });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: list all gifts ──
app.post('/api/admin/gifts_list', checkAdmin, async (req, res) => {
    try {
        const gifts = await Gift.find().sort({ createdAt: -1 }).limit(200);
        res.json({ gifts });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: delete gift ──
app.post('/api/admin/delete_gift', checkAdmin, async (req, res) => {
    try {
        const { giftId } = req.body;
        await Gift.findByIdAndDelete(giftId);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught:', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('Unhandled:', err);
});
