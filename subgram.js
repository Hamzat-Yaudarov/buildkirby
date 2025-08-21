const axios = require('axios');
const config = require('./config');

class SubGram {
    static async checkSubscription(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
        const requestData = {
            UserId: userId.toString(),
            ChatId: chatId.toString(),
            first_name: firstName,
            language_code: languageCode,
            Premium: isPremium,
            MaxOP: 3,
            action: 'subscribe'
        };

        console.log(`🌐 SubGram checkSubscription запрос для пользователя ${userId}:`, {
            userId,
            chatId,
            firstName: firstName || 'не указано',
            languageCode,
            isPremium,
            timestamp: new Date().toISOString()
        });

        const startTime = Date.now();
        try {
            const response = await axios.post('https://api.subgram.ru/request-op/', requestData, {
                headers: {
                    'Auth': config.SUBGRAM_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10 секунд таймаут
            });

            const responseTime = Date.now() - startTime;
            console.log(`✅ SubGram checkSubscription ответ для пользователя ${userId} (${responseTime}ms):`, {
                status: response.status,
                dataStatus: response.data?.status,
                linksCount: response.data?.links?.length || 0,
                hasSponsors: !!response.data?.additional?.sponsors
            });

            return response.data;
        } catch (error) {
            const responseTime = Date.now() - startTime;

            if (error.response && error.response.status === 404) {
                // 404 от SubGram может означать "нет спонсоров для этого пользователя"
                const responseData = error.response.data;
                if (responseData && responseData.message === 'Нет подходящих рекламодателей для данного пользователя') {
                    console.log(`ℹ️ SubGram: нет спонсоров для пользователя ${userId}`);
                    return {
                        status: 'ok',
                        code: 200,
                        message: 'Нет спонсорских каналов для данного пользователя',
                        total_fixed_link: 0
                    };
                }
            }

            console.error(`❌ SubGram checkSubscription ошибка для пользователя ${userId} (${responseTime}ms):`);

            if (error.response) {
                // Сервер ответил с ошибкой
                console.error(`  📊 Статус: ${error.response.status} - ${error.response.statusText}`);
                console.error(`  📄 Данные:`, error.response.data);
                console.error(`  🔗 URL:`, error.config?.url);
                console.error(`  📋 Заголовки:`, error.config?.headers);
            } else if (error.request) {
                // Запрос был отправлен, но ответа не получено
                console.error('  🌐 Нет ответа от сервера SubGram');
                console.error('  ⏱️ Таймаут или сетевая ошибка');
            } else {
                // Другая ошибка
                console.error('  ⚠️ Ошибка конфигурации:', error.message);
            }

            return { status: 'error', message: 'Ошибка связи с сервисом', error: error.message };
        }
    }

    static async getTaskChannels(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
        const requestData = {
            UserId: userId.toString(),
            ChatId: chatId.toString(),
            first_name: firstName,
            language_code: languageCode,
            Premium: isPremium,
            MaxOP: 1,
            action: 'newtask'
        };

        console.log(`📋 SubGram getTaskChannels запрос для пользователя ${userId}:`, {
            userId,
            chatId,
            action: 'newtask',
            maxOP: 1,
            timestamp: new Date().toISOString()
        });

        const startTime = Date.now();
        try {
            const response = await axios.post('https://api.subgram.ru/request-op/', requestData, {
                headers: {
                    'Auth': config.SUBGRAM_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10 секунд таймаут
            });

            const responseTime = Date.now() - startTime;
            console.log(`✅ SubGram getTaskChannels ответ для пользователя ${userId} (${responseTime}ms):`, {
                status: response.status,
                dataStatus: response.data?.status,
                linksCount: response.data?.links?.length || 0,
                hasSponsors: !!response.data?.additional?.sponsors
            });

            return response.data;
        } catch (error) {
            const responseTime = Date.now() - startTime;

            if (error.response && error.response.status === 404) {
                // 404 от SubGram означает "нет заданий для этого пользователя"
                const responseData = error.response.data;
                if (responseData && responseData.message === 'Нет подходящих рекламодателей для данного пользователя') {
                    console.log(`ℹ️ SubGram getTaskChannels: нет заданий для пользователя ${userId}`);
                    return {
                        status: 'ok',
                        code: 200,
                        message: 'Нет заданий для данного пользователя',
                        links: [],
                        total_fixed_link: 0
                    };
                }
            }

            console.error(`❌ SubGram getTaskChannels ошибка для пользователя ${userId} (${responseTime}ms):`);

            if (error.response) {
                console.error(`  📊 Статус: ${error.response.status} - ${error.response.statusText}`);
                console.error(`  📄 Данные:`, error.response.data);
            } else if (error.request) {
                console.error('  🌐 Нет ответа от сервера SubGram');
            } else {
                console.error('  ⚠️ Ошибка конфигурации:', error.message);
            }

            return { status: 'error', message: 'Ошибка связи с сервисом', error: error.message };
        }
    }

    static async getChannelLinks(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
        const requestData = {
            UserId: userId.toString(),
            ChatId: chatId.toString(),
            first_name: firstName,
            language_code: languageCode,
            Premium: isPremium,
            MaxOP: 10, // Запрашиваем больше каналов для получения всех ссылок
            action: 'subscribe'
        };

        console.log(`🔗 SubGram getChannelLinks запрос для пользователя ${userId}:`, {
            userId,
            chatId,
            maxOP: 10,
            timestamp: new Date().toISOString()
        });

        const startTime = Date.now();
        try {
            const response = await axios.post('https://api.subgram.ru/request-op/', requestData, {
                headers: {
                    'Auth': config.SUBGRAM_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10 секунд таймаут
            });

            const responseTime = Date.now() - startTime;
            console.log(`✅ SubGram getChannelLinks ответ для пользователя ${userId} (${responseTime}ms):`, {
                status: response.status,
                dataStatus: response.data?.status,
                linksCount: response.data?.links?.length || 0
            });

            return response.data;
        } catch (error) {
            const responseTime = Date.now() - startTime;

            if (error.response && error.response.status === 404) {
                // 404 от SubGram означает "нет спонсоров для этого пользователя"
                const responseData = error.response.data;
                if (responseData && responseData.message === 'Нет подходящих рекламодателей для данного пользователя') {
                    console.log(`ℹ️ SubGram getChannelLinks: нет спонсоров для пользователя ${userId}`);
                    return {
                        status: 'ok',
                        code: 200,
                        message: 'Нет спонсорских каналов для данного пользователя',
                        links: [],
                        total_fixed_link: 0
                    };
                }
            }

            console.error(`❌ SubGram getChannelLinks ошибка для пользователя ${userId} (${responseTime}ms):`);

            if (error.response) {
                console.error(`  📊 Статус: ${error.response.status} - ${error.response.statusText}`);
            } else if (error.request) {
                console.error('  🌐 Нет ответа от сервера SubGram');
            } else {
                console.error('  ⚠️ Ошибка конфигурации:', error.message);
            }

            return { status: 'error', message: 'Ошибка связи с сервисом', error: error.message };
        }
    }

    static async checkUserSubscriptions(userId, links = []) {
        try {
            const response = await axios.post('https://api.subgram.ru/get-user-subscriptions', {
                user_id: userId,
                links: links
            }, {
                headers: {
                    'Auth': config.SUBGRAM_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10 секунд таймаут
            });

            return response.data;
        } catch (error) {
            if (error.response) {
                console.error(`Ошибка при проверке подписок пользователя: ${error.response.status} - ${error.response.statusText}`);
            } else if (error.request) {
                console.error('Ошибка при проверке подписок пользователя: Нет ответа от сервера');
            } else {
                console.error('Ошибка при пр��верке подписок пользователя:', error.message);
            }
            return { status: 'error', message: 'Ошибка связи с сервисом' };
        }
    }

    static formatSubscriptionMessage(links, sponsors = []) {
        if (!links || links.length === 0) {
            return '✅ Вы подписаны на все спонсорские каналы!';
        }

        let message = '🔒 Для доступа к боту необходимо подписаться на спонсорские каналы:\n\n';

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const sponsor = sponsors[i];
            const channelName = sponsor?.resource_name || `Канал ${i + 1}`;
            message += `${i + 1}. ${channelName}\n${link}\n\n`;
        }

        message += '✅ После подписки нажмите "Проверить подписки"';
        return message;
    }

    static createSubscriptionKeyboard(links) {
        const keyboard = {
            inline_keyboard: []
        };

        // Добавляем кнопки каналов
        links.forEach((link, index) => {
            keyboard.inline_keyboard.push([{
                text: `📢 Канал ${index + 1}`,
                url: link
            }]);
        });

        // Добавляем кнопку проверки
        keyboard.inline_keyboard.push([{
            text: '✅ Проверить подписки',
            callback_data: 'check_subscription'
        }]);

        return keyboard;
    }
}

module.exports = SubGram;
