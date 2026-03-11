const TelegramBot = require('node-telegram-bot-api');
const token = process.env.BOT_TOKEN;
const webAppUrl = 'https://loonxgift.onrender.com'; // Ссылка на твое приложение

const bot = new TelegramBot(token, { polling: true });

// Твои контакты
const CONTACTS = {
    creator: '@tonfrm',
    channel: '@Loonxnews',
    support: '@LoonxGift_Support',
    bugs: '@MsgP2P'
};

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    // Твоя фраза (строго по запросу)
    const welcomeText = `🪙 Добро пожаловать в Loonx Gift!\nЛучшие игры уже ждут тебя.`;

    bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                // Твоя кнопка с пузырьками
                [{ text: '🫧играть🫧', web_app: { url: webAppUrl } }],
                [{ text: '📢 Channel', url: `https://t.me/${CONTACTS.channel.replace('@', '')}` }]
            ]
        }
    });
});

// Команда /help (Только твои контакты)
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

console.log('✅ Бот Loonx Gift полностью настроен!');
