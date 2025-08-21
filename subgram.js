const axios = require('axios');
const config = require('./config');

class SubGram {
    static async checkSubscription(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
        try {
            const response = await axios.post('https://api.subgram.ru/request-op/', {
                UserId: userId.toString(),
                ChatId: chatId.toString(),
                first_name: firstName,
                language_code: languageCode,
                Premium: isPremium,
                MaxOP: 3,
                action: 'subscribe'
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
                // Сервер ответил с ошибкой
                console.error(`Ошибка при регистрации подписки SubGram: ${error.response.status} - ${error.response.statusText}`);
            } else if (error.request) {
                // Запрос был отправлен, но ответа не получено
                console.error('Ошибка при регистрации подписки SubGram: Нет ответа от сервера');
            } else {
                // Другая ошибка
                console.error('Ошибка при регистрации подписки SubGram:', error.message);
            }
            return { status: 'error', message: 'Ошибка связи с сервисом' };
        }
    }

    static async getTaskChannels(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
        try {
            const response = await axios.post('https://api.subgram.ru/request-op/', {
                UserId: userId.toString(),
                ChatId: chatId.toString(),
                first_name: firstName,
                language_code: languageCode,
                Premium: isPremium,
                MaxOP: 1,
                action: 'newtask'
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
                console.error(`Ошибка при получении заданий SubGram: ${error.response.status} - ${error.response.statusText}`);
            } else if (error.request) {
                console.error('Ошибка при получении заданий SubGram: Нет ответа от сервера');
            } else {
                console.error('Ошибка при получении заданий SubGram:', error.message);
            }
            return { status: 'error', message: 'Ошибка связи с сервисом' };
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
}

module.exports = SubGram;
