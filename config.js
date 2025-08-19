/**
 * Единый конфигурационный файл для всего проекта
 * Централизованное управление настройками для избежания дублирования
 */

// Основные настройки бота
const BOT_CONFIG = {
    // Telegram Bot Token (должен браться из переменных окружения)
    BOT_TOKEN: process.env.BOT_TOKEN || '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM',
    
    // Администратор бота
    ADMIN_ID: 7972065986,
    ADMIN_CHANNEL: process.env.ADMIN_CHANNEL || '@kirbyvivodstars',
    PAYMENTS_CHANNEL: process.env.PAYMENTS_CHANNEL || '@kirbystarspayments',
};

// Настройки Telegram API для Python скриптов
const TELEGRAM_API_CONFIG = {
    api_id: 28085629,
    api_hash: "78027b2ae19b9ec44a6e03bf5cc1299f",
    phone_number: "+7972065986", // Основной номер
    phone_number_alt: "+79639887777" // Альтернативный номер
};

// Настройки SubGram API
const SUBGRAM_CONFIG = {
    API_KEY: '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d',
    API_URL: 'https://api.subgram.ru/request-op/',
    DEFAULT_MAX_SPONSORS: 3,
    DEFAULT_ACTION: 'subscribe'
};

// Настройки базы данных
const DATABASE_CONFIG = {
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_s6iWtmzZU8XA@ep-dawn-waterfall-a23jn5vi-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    POOL_CONFIG: {
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    }
};

// Настройки тайм-аутов и лимитов
const LIMITS_CONFIG = {
    WITHDRAWAL_COOLDOWN_MS: 5000, // 5 секунд
    MESSAGE_THROTTLE_INTERVAL: 1000, // 1 секунда между сообщениями
    CAPTCHA_SESSION_TIMEOUT: 600000, // 10 минут
    SUBGRAM_SESSION_TIMEOUT: 3600000, // 1 час
    MAX_REFERRALS_PER_DAY: 50,
    MAX_CLICKS_PER_DAY: 100
};

// Настройки вознаграждений
const REWARDS_CONFIG = {
    REFERRAL_BONUS: 3, // звёзды за реферала
    TASK_COMPLETION_POINTS: 2, // очки за выполнение задания
    BOT_ACTIVATION_POINTS: 1, // очки за активацию бота
    DAILY_CLICK_REWARD: 1, // звёзды за клик
    WEEKLY_TOP_REWARDS: [10, 5, 3, 2, 1] // награды за топ места в недельном рейтинге
};

// Экспорт всех конфигураций
module.exports = {
    BOT_CONFIG,
    TELEGRAM_API_CONFIG,
    SUBGRAM_CONFIG,
    DATABASE_CONFIG,
    LIMITS_CONFIG,
    REWARDS_CONFIG,
    
    // Вспомогательные функции
    isAdmin: (userId) => userId === BOT_CONFIG.ADMIN_ID,
    getEnvironment: () => process.env.NODE_ENV || 'development',
    isProduction: () => process.env.NODE_ENV === 'production'
};
