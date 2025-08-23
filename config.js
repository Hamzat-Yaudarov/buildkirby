module.exports = {
    BOT_TOKEN: '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM',
    DATABASE_URL: 'postgresql://neondb_owner:npg_kA5CYbq6KRQD@ep-late-math-a23qdcph-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    SUBGRAM_API_KEY: '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d',
    ADMIN_CHAT_ID: '@kirbyvivodstars',
    PAYMENTS_CHAT_ID: '@kirbystarspayments',
    ADMIN_IDS: [7972065986, 6910097562], // Замените на ваш Telegram ID
    WEEKLY_REWARDS: {
        1: 100,
        2: 75,
        3: 50,
        4: 25,
        5: 15
    },
    // Личные спонсорские каналы (добавьте свои)
    PERSONAL_SPONSOR_CHANNELS: [
        '@BorshPodarki'
        // ВАЖНО: Используйте только username каналов (@channel) или ID каналов
        // Ссылки-пригл��шения (t.me/+xxx) не работают с bot.getChatMember()
    ],

    // Каналы с обязательной подачей заявок (ID каналов)
    CUSTOM_REQUEST_CHANNELS: [
        -1002739109891
    ]
};
