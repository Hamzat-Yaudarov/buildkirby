module.exports = {
    // Обязательные параметры — задаются только через переменные окружения
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    DATABASE_URL: process.env.DATABASE_URL || '',
    SUBGRAM_API_KEY: process.env.SUBGRAM_API_KEY || '',

    // Служебные чаты (можно оставить дефолты и переопределить через ENV)
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || '@kirbyvivodstars',
    PAYMENTS_CHAT_ID: process.env.PAYMENTS_CHAT_ID || '@kirbystarspayments',

    // Администраторы: перечислите ID через запятую в ADMIN_IDS
    ADMIN_IDS: (process.env.ADMIN_IDS || '')
        .split(',')
        .map(x => x.trim())
        .filter(x => x.length > 0)
        .map(x => Number(x))
        .filter(n => Number.isFinite(n)),

    // Награды недел�� (фиксированная бизнес-логика)
    WEEKLY_REWARDS: {
        1: 100,
        2: 75,
        3: 50,
        4: 25,
        5: 15
    },

    // Личные спонсорские каналы: перечислите через запятую в PERSONAL_SPONSOR_CHANNELS
    PERSONAL_SPONSOR_CHANNELS: (process.env.PERSONAL_SPONSOR_CHANNELS || '')
        .split(',')
        .map(x => x.trim())
        .filter(x => x.length > 0),

    // Блокировки по языковым кодам: перечислите через запятую в BLOCKED_LANGUAGE_CODES
    BLOCKED_LANGUAGE_CODES: (process.env.BLOCKED_LANGUAGE_CODES || '')
        .split(',')
        .map(x => x.trim())
        .filter(x => x.length > 0)
};
