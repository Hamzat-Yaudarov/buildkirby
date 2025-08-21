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
                totalFixedLink: response.data?.total_fixed_link || 0,
                hasSponsors: !!response.data?.additional?.sponsors,
                sponsorsCount: response.data?.additional?.sponsors?.length || 0
            });

            // Подробное логирование если есть несоответствие
            if (response.data?.total_fixed_link > 0 && (!response.data?.links || response.data.links.length === 0)) {
                console.log(`🚨 НЕСООТВЕТСТВИЕ! total_fixed_link=${response.data.total_fixed_link} но links=${response.data?.links?.length || 0}`);
                console.log(`📋 Полный ответ от SubGram:`, JSON.stringify(response.data, null, 2));
            }

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
            MaxOP: 10,
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
                totalFixedLink: response.data?.total_fixed_link || 0,
                hasSponsors: !!response.data?.additional?.sponsors
            });

            // Подробное логирование если есть несоответствие
            if (response.data?.total_fixed_link > 0 && (!response.data?.links || response.data.links.length === 0)) {
                console.log(`🚨 getTaskChannels НЕСООТВЕТСТВИЕ! total_fixed_link=${response.data.total_fixed_link} но links=${response.data?.links?.length || 0}`);
                console.log(`📋 Полный ответ:`, JSON.stringify(response.data, null, 2));
            }

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
            MaxOP: 10, // Запрашиваем больше каналов для полу��ения всех ссылок
            action: 'subscribe' // Попробуем обычный action
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
                linksCount: response.data?.links?.length || 0,
                totalFixedLink: response.data?.total_fixed_link || 0
            });

            // Подробное логирование если есть несоответствие
            if (response.data?.total_fixed_link > 0 && (!response.data?.links || response.data.links.length === 0)) {
                console.log(`🚨 getChannelLinks НЕСООТВЕТСТВИЕ! total_fixed_link=${response.data.total_fixed_link} но links=${response.data?.links?.length || 0}`);
                console.log(`📋 Полный ответ:`, JSON.stringify(response.data, null, 2));
            }

            return response.data;
        } catch (error) {
            const responseTime = Date.now() - startTime;

            if (error.response && error.response.status === 404) {
                // 404 от SubGram означает "нет спонсоров для этого пользователя"
                const responseData = error.response.data;
                if (responseData && responseData.message === 'Нет подходящих рекламодателей для данного пользователя') {
                    console.log(`ℹ️ SubGram getChannelLinks: нет спонсоров для пользоветеля ${userId}`);
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
                console.error(`Ошибка при прове��ке подписок пользователя: ${error.response.status} - ${error.response.statusText}`);
            } else if (error.request) {
                console.error('Ошибка при проверке подписок пользователя: Нет ответа от сервера');
            } else {
                console.error('Ошибка при проверке подписок пользователя:', error.message);
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

    // Агрессивная функция для получения ссылок когда знаем что они должны быть
    static async getLinksAggressively(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
        console.log(`🔥 Агрессивный поиск ссылок для пользователя ${userId}`);

        // Различные стратегии для получения ссылок
        const strategies = [
            // 1. С MaxOP = 1 и action = 'subscribe'
            {
                name: 'MaxOP=1,subscribe',
                data: {
                    UserId: userId.toString(),
                    ChatId: chatId.toString(),
                    first_name: firstName,
                    language_code: languageCode,
                    Premium: isPremium,
                    MaxOP: 1,
                    action: 'subscribe'
                }
            },
            // 2. С MaxOP = 5 и action = 'subscribe'
            {
                name: 'MaxOP=5,subscribe',
                data: {
                    UserId: userId.toString(),
                    ChatId: chatId.toString(),
                    first_name: firstName,
                    language_code: languageCode,
                    Premium: isPremium,
                    MaxOP: 5,
                    action: 'subscribe'
                }
            },
            // 3. С MaxOP = 10 и action = 'subscribe'
            {
                name: 'MaxOP=10,subscribe',
                data: {
                    UserId: userId.toString(),
                    ChatId: chatId.toString(),
                    first_name: firstName,
                    language_code: languageCode,
                    Premium: isPremium,
                    MaxOP: 10,
                    action: 'subscribe'
                }
            },
            // 4. С MaxOP = 1 и action = 'newtask'
            {
                name: 'MaxOP=1,newtask',
                data: {
                    UserId: userId.toString(),
                    ChatId: chatId.toString(),
                    first_name: firstName,
                    language_code: languageCode,
                    Premium: isPremium,
                    MaxOP: 1,
                    action: 'newtask'
                }
            },
            // 5. С MaxOP = 10 и action = 'newtask'
            {
                name: 'MaxOP=10,newtask',
                data: {
                    UserId: userId.toString(),
                    ChatId: chatId.toString(),
                    first_name: firstName,
                    language_code: languageCode,
                    Premium: isPremium,
                    MaxOP: 10,
                    action: 'newtask'
                }
            },
            // 6. Без action (возможно по умолчанию)
            {
                name: 'MaxOP=5,no-action',
                data: {
                    UserId: userId.toString(),
                    ChatId: chatId.toString(),
                    first_name: firstName,
                    language_code: languageCode,
                    Premium: isPremium,
                    MaxOP: 5
                }
            }
        ];

        for (let i = 0; i < strategies.length; i++) {
            const strategy = strategies[i];
            console.log(`🔄 Попытка ${i + 1}/${strategies.length}: ${strategy.name}`);

            try {
                const response = await axios.post('https://api.subgram.ru/request-op/', strategy.data, {
                    headers: {
                        'Auth': config.SUBGRAM_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                console.log(`📋 Стратегия ${strategy.name} ответ:`, {
                    status: response.data?.status,
                    linksCount: response.data?.links?.length || 0,
                    totalFixed: response.data?.total_fixed_link || 0,
                    hasSponsors: !!response.data?.additional?.sponsors
                });

                // Если получили ссылки - возвращаем их
                if (response.data?.links && response.data.links.length > 0) {
                    console.log(`✅ Стратегия ${strategy.name} дала ${response.data.links.length} ссылок!`);
                    return response.data;
                }

            } catch (error) {
                console.log(`❌ Стратегия ${strategy.name} не сработала:`, error.response?.status || error.message);
            }
        }

        console.log(`😞 Все стратегии исчерпаны для пользователя ${userId}, ссылки не найдены`);
        return null;
    }
}

module.exports = SubGram;
