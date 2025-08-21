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
                }
            });

            return response.data;
        } catch (error) {
            console.error('Ошибка при проверке подписки SubGram:', error.message);
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
                }
            });

            return response.data;
        } catch (error) {
            console.error('Ошибка при получении заданий SubGram:', error.message);
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
                }
            });

            return response.data;
        } catch (error) {
            console.error('Ошибка при проверке подписок пользователя:', error.message);
            return { status: 'error', message: 'Ошибка связи с сервисом' };
        }
    }

    static formatSubscriptionMessage(links, sponsors = []) {
        if (!links || links.length === 0) {
            return '✅ Вы подписаны на все спонсорские каналы!';
        }

        let message = '📢 Для продолжения подпишитесь на спонсорские каналы:\n\n';
        
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
