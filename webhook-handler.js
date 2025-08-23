const express = require('express');
const config = require('./config');
const Database = require('./database');

class WebhookHandler {
    constructor(bot) {
        this.bot = bot;
        this.app = express();
        this.userSubscriptionCache = new Map(); // Кеш статусов подписок
        
        // Настройка middleware
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // Логирование всех запросов для отладки
        this.app.use((req, res, next) => {
            console.log(`📥 ${req.method} ${req.path} - ${req.ip} - Headers:`, JSON.stringify(req.headers, null, 2));
            next();
        });
        
        // Настройка роутов
        this.setupRoutes();
    }

    setupRoutes() {
        // Корневой маршрут для отладки
        this.app.get('/', (req, res) => {
            res.json({
                message: 'Telegram Stars Bot Webhook Server',
                status: 'running',
                endpoints: {
                    health: '/health',
                    webhook: '/webhook/subgram'
                },
                timestamp: new Date().toISOString()
            });
        });

        // Простой тест эндпоинт
        this.app.get('/test', (req, res) => {
            console.log('🧪 Test endpoint вызван');
            res.send('OK - Railway webhook server works!');
        });

        // Эндпоинт для здоровья сервера
        this.app.get('/health', (req, res) => {
            console.log('💚 Health endpoint вызван');
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                service: 'telegram-stars-bot',
                port: process.env.PORT || 'unknown'
            });
        });

        // Главный эндпоинт для вебхуков SubGram
        this.app.post('/webhook/subgram', async (req, res) => {
            try {
                await this.handleSubgramWebhook(req, res);
            } catch (error) {
                console.error('Ошибка обработки вебхука SubGram:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Эндпоинт для получения статуса подписки пользователя (для отладки)
        this.app.get('/api/user/:userId/subscription', async (req, res) => {
            try {
                const userId = parseInt(req.params.userId);
                const subscription = this.getUserSubscriptionStatus(userId);
                res.json({
                    userId,
                    subscription,
                    cached: this.userSubscriptionCache.has(userId)
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Catch-all маршрут для отладки неопознанных запросов
        this.app.all('*', (req, res) => {
            console.log(`🚫 Неопознанный запрос: ${req.method} ${req.path}`);
            res.status(404).json({
                error: 'Endpoint not found',
                method: req.method,
                path: req.path,
                availableEndpoints: {
                    '/': 'GET - Bot info',
                    '/health': 'GET - Health check',
                    '/webhook/subgram': 'POST - SubGram webhook',
                    '/api/user/:userId/subscription': 'GET - User subscription status'
                }
            });
        });
    }

    async handleSubgramWebhook(req, res) {
        // Проверяем API ключ в заголовке СНАЧАЛА (до ответа)
        const apiKey = req.headers['api-key'] || req.headers['authorization'] || req.headers['auth'];
        console.log('🔑 Проверка API ключа:', {
            received: apiKey ? 'есть' : 'отсутствует',
            expected: config.SUBGRAM_API_KEY ? 'настроен' : 'не настроен'
        });

        if (!apiKey || apiKey !== config.SUBGRAM_API_KEY) {
            console.error('❌ Неверный API ключ в вебхуке SubGram. Получен:', apiKey, 'Ожидался:', config.SUBGRAM_API_KEY);
            res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
            return;
        }

        // Быстро отвечаем на запрос, чтобы SubGram не считал его неуспешным
        res.status(200).json({ received: true, timestamp: new Date().toISOString() });

        // Логируем входящий вебхук
        console.log('Получен вебхук SubGram:', JSON.stringify(req.body, null, 2));

        const { webhooks } = req.body;
        if (!webhooks || !Array.isArray(webhooks)) {
            console.error('Неверный формат вебхука: отсутствует массив webhooks');
            return;
        }

        // Обрабатываем каждое событие асинхронно
        for (const webhook of webhooks) {
            try {
                await this.processWebhookEvent(webhook);
            } catch (error) {
                console.error('Ошибка обработки события вебхука:', error, webhook);
            }
        }
    }

    async processWebhookEvent(webhook) {
        const { webhook_id, link, user_id, bot_id, status, subscribe_date } = webhook;

        console.log(`Обработка события ${webhook_id}: пользователь ${user_id}, статус: ${status}`);

        // Проверяем, что это наш бот
        if (bot_id.toString() !== config.BOT_TOKEN.split(':')[0]) {
            console.log(`Вебхук для другого бота: ${bot_id}, игнорируем`);
            return;
        }

        // Обновляем кеш статуса подписки пользователя
        this.updateUserSubscriptionCache(user_id, status, link);

        // Обрабатываем событие в зависимости от статуса
        switch (status) {
            case 'subscribed':
                await this.handleSubscribed(user_id, link, subscribe_date);
                break;
            case 'notgetted':
                await this.handleNotGetted(user_id, link, subscribe_date);
                break;
            case 'unsubscribed':
                await this.handleUnsubscribed(user_id, link);
                break;
            default:
                console.log(`Неизвестный статус: ${status}`);
        }
    }

    updateUserSubscriptionCache(userId, status, link) {
        console.log(`🔄 Обновление кеша подписки: пользователь ${userId}, статус ${status}, ссылка ${link}`);

        if (!this.userSubscriptionCache.has(userId)) {
            this.userSubscriptionCache.set(userId, {
                subscriptions: new Map(),
                lastUpdate: Date.now()
            });
        }

        const userCache = this.userSubscriptionCache.get(userId);
        userCache.subscriptions.set(link, {
            status,
            timestamp: Date.now()
        });
        userCache.lastUpdate = Date.now();

        console.log(`📊 Кеш пользователя ${userId} обновлен:`, {
            totalSubscriptions: userCache.subscriptions.size,
            lastUpdate: new Date(userCache.lastUpdate).toISOString()
        });

        // Очищаем старые записи (старше 1 часа)
        this.cleanupCache();
    }

    cleanupCache() {
        const oneHour = 60 * 60 * 1000;
        const now = Date.now();

        for (const [userId, userCache] of this.userSubscriptionCache.entries()) {
            if (now - userCache.lastUpdate > oneHour) {
                this.userSubscriptionCache.delete(userId);
            }
        }
    }

    getUserSubscriptionStatus(userId) {
        const userCache = this.userSubscriptionCache.get(userId);
        if (!userCache) {
            console.log(`📭 Нет кеша для пользователя ${userId}`);
            return { isSubscribed: null, unsubscribedLinks: [], lastUpdate: null };
        }

        const unsubscribedLinks = [];
        const subscribedLinks = [];
        let hasUnsubscribed = false;

        for (const [link, data] of userCache.subscriptions.entries()) {
            if (data.status === 'unsubscribed') {
                unsubscribedLinks.push(link);
                hasUnsubscribed = true;
            } else if (data.status === 'subscribed' || data.status === 'notgetted') {
                subscribedLinks.push(link);
            }
        }

        const isFullySubscribed = !hasUnsubscribed && userCache.subscriptions.size > 0;

        console.log(`📊 Статус подписки пользователя ${userId}:`, {
            isSubscribed: isFullySubscribed,
            unsubscribedCount: unsubscribedLinks.length,
            subscribedCount: subscribedLinks.length,
            totalLinks: userCache.subscriptions.size,
            lastUpdate: new Date(userCache.lastUpdate).toISOString()
        });

        return {
            isSubscribed: isFullySubscribed,
            unsubscribedLinks,
            subscribedLinks,
            subscribedCount: subscribedLinks.length,
            unsubscribedCount: unsubscribedLinks.length,
            lastUpdate: userCache.lastUpdate,
            totalLinks: userCache.subscriptions.size
        };
    }

    async handleSubscribed(userId, link, subscribeDate) {
        console.log(`Пользователь ${userId} подписался на ${link}`);
        
        try {
            // Проверяем, есть ли пользователь в базе
            const user = await Database.getUser(userId);
            if (user) {
                // Можем добавить логику награды за подписку
                console.log(`Пользователь ${userId} получил подписку на ${link}`);
                
                // Если пользователь полностью подписан, можем отправить уведомление
                // Не отправляем автоматические уведомления от вебхука
                // Логика уведомлений должна быть в основном боте при проверке подписки
                const subscriptionStatus = this.getUserSubscriptionStatus(userId);
                if (subscriptionStatus.isSubscribed) {
                    console.log(`✅ Пользователь ${userId} полностью подписан (кеш обновлен)`);
                }
            }
        } catch (error) {
            console.error('Ошибка обработки подписки:', error);
        }
    }

    async handleNotGetted(userId, link, subscribeDate) {
        console.log(`Пользователь ${userId} был подписан ранее на ${link}`);
        // Обрабатываем как обычную подписку
        await this.handleSubscribed(userId, link, subscribeDate);
    }

    async handleUnsubscribed(userId, link) {
        console.log(`📉 Пользователь ${userId} отписался от ${link}`);

        try {
            // Получаем статус подписки после обновления кеша
            const subscriptionStatus = this.getUserSubscriptionStatus(userId);
            console.log(`📊 Новый статус подписки пользователя ${userId}:`, {
                subscribedCount: subscriptionStatus.subscribedCount,
                unsubscribedCount: subscriptionStatus.unsubscribedCount,
                totalLinks: subscriptionStatus.totalLinks,
                isFullySubscribed: subscriptionStatus.isSubscribed
            });

            // Уведомляем пользователя об отписке (если нужно)
            const user = await Database.getUser(userId);
            if (user) {
                // Можем отправить предупреждение об ограничении функций
                try {
                    await this.bot.sendMessage(userId,
                        '⚠️ Обнаружена отписка от спонсорского канала.\n' +
                        `📊 Активных подписок: ${subscriptionStatus.subscribedCount} из ${subscriptionStatus.totalLinks}\n` +
                        'Для полного доступа к боту необходимо быть подписанным на все каналы.'
                    );
                } catch (e) {
                    console.log(`Не удалось отправить уведомление об отписке пользователю ${userId}`);
                }
            }
        } catch (error) {
            console.error('Ошибка обработки отписки:', error);
        }
    }

    // Метод для проверки статуса подписки (используется в основном боте)
    isUserSubscribed(userId) {
        const status = this.getUserSubscriptionStatus(userId);
        return status.isSubscribed === true;
    }

    // Получить неподписанные ссылки для пользователя
    getUnsubscribedLinks(userId) {
        const status = this.getUserSubscriptionStatus(userId);
        return status.unsubscribedLinks || [];
    }

    start(port = 3000) {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(port, '0.0.0.0', (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`🚀 Webhook сервер запущен на порту ${port}`);
                    console.log(`📡 ндпоинт для SubGram: /webhook/subgram`);
                    console.log(`💚 Health check: /health`);
                    console.log(`🌐 Railway URL: https://kirbystars.up.railway.app`);
                    console.log(`📝 Доступные маршруты: GET /health, POST /webhook/subgram`);
                    resolve(this.server);
                }
            });
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            console.log('Webhook сервер остановлен');
        }
    }
}

module.exports = WebhookHandler;
