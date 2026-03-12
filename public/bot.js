const TelegramBot = require('node-telegram-bot-api');

// Подтягиваем токен из переменных окружения (Render Env)
const token = process.env.BOT_TOKEN; 
const webAppUrl = process.env.WEB_APP_URL || 'https://loonxgift.onrender.com';

// Проверка, чтобы бот не крашился, если токен забыли добавить
if (!token) {
    console.error('❌ ОШИБКА: BOT_TOKEN не указан в Environment Variables!');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

const CONTACTS = {
    creator: '@tonfrm',
    channel: '@Loonxnews',
    support: '@LoonxGift_Support',
    bugs: '@MsgP2P'
};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeText = `🪙 Добро пожаловать в Loonx Gift!\nЛучшие игры уже ждут тебя.`;

    bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🫧играть🫧', web_app: { url: webAppUrl } }],
                [{ text: '📢 Channel', url: `https://t.me/${CONTACTS.channel.replace('@', '')}` }]
            ]
        }
    });
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `💎 *Наши контакты:*\n\n` +
                     `• Creator = ${CONTACTS.creator}\n\n` +
                     `• Channel and promo = ${CONTACTS.channel}\n\n` +
                     `• Support = ${CONTACTS.support}\n\n` +
                     `• Bags = ${CONTACTS.bugs}`;

    bot.sendMessage(chatId, helpText, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
    });
});

console.log('✅ Бот Loonx Gift запущен! Токен успешно подгружен из ENV.');
