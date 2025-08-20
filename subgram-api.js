/**
 * SubGram API Integration Module
 * Модуль для интеграции с сервисом SubGram для автомати��еского получения спон��орских каналов
 */

const axios = require('axios');

// SubGram API Configuration
const SUBGRAM_API_URL = 'https://api.subgram.ru/request-op/';
const SUBGRAM_API_KEY = '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d';

class SubGramAPI {
    constructor() {
        this.apiKey = SUBGRAM_API_KEY;
        this.apiUrl = SUBGRAM_API_URL;
    }

    /**
     * Запрос к SubGram API для получения спонсорских каналов
     * ВАЖНО: Этот бот работает С ТОКЕНОМ, поэтому дополнительные поля не требуются
     * @param {Object} params - Параметры запроса
     * @param {string} params.userId - ID пользователя
     * @param {string} params.chatId - ID чата
     * @param {string} params.gender - Пол пользователя (male/female, опционально)
     * @param {number} params.maxOP - Максимальное количество спонсоров (1-10)
     * @param {string} params.action - Тип действия ('subscribe' или 'newtask')
     * @param {Array} params.excludeChannelIds - Массив ID каналов для исключения
     * @param {boolean} params.withToken - Если true, не отпр��вляет дополнительные по��я (по умолчанию true)
     * @returns {Object} Ответ от SubGram API
     */
    async requestSponsors(params) {
        try {
            const {
                userId,
                chatId,
                gender = null,
                firstName = null,
                languageCode = null,
                premium = null,
                maxOP = 3,
                action = 'subscribe',
                excludeChannelIds = [],
                withToken = true // По умолчанию работаем с токеном
            } = params;

            // Подготовка данных для запроса
            const requestData = {
                UserId: userId.toString(),
                ChatId: chatId.toString(),
                MaxOP: maxOP,
                action: action,
                exclude_channel_ids: excludeChannelIds
            };

            // Если бот НЕ добавлен с токеном, добавляем обязательные поля
            // Поскольку наш бот ДОЛЖЕН быть добавлен с токеном, эти поля не нужны
            if (!withToken) {
                if (firstName) requestData.first_name = firstName;
                if (languageCode) requestData.language_code = languageCode;
                if (premium !== undefined) requestData.Premium = premium;
            }

            // Добавляем пол только если он известен и валиден
            if (gender && (gender === 'male' || gender === 'female')) {
                requestData.Gender = gender;
            }

            console.log('[SUBGRAM] Making API request (WITH TOKEN):', {
                url: this.apiUrl,
                userId,
                chatId,
                maxOP,
                action,
                excludeCount: excludeChannelIds.length,
                withToken: withToken,
                requestFields: Object.keys(requestData)
            });

            const response = await axios.post(this.apiUrl, requestData, {
                headers: {
                    'Auth': this.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10 секунд таймаут
            });

            console.log('[SUBGRAM] API response status:', response.data.status, 'code:', response.data.code);

            return {
                success: true,
                data: response.data
            };

        } catch (error) {
            console.error('[SUBGRAM] API request failed:', error.message);

            if (error.response) {
                console.error('[SUBGRAM] Response error:', error.response.status, error.response.data);

                // Специальная обработка 404 - это нормальный ответ "нет подходящих рекламодателей"
                if (error.response.status === 404 && error.response.data) {
                    const data = error.response.data;
                    if (data.status === 'ok' && data.message && data.message.includes('подходящих рекламодателей')) {
                        console.log('[SUBGRAM] 404 is normal - no suitable advertisers available');
                        return {
                            success: true, // Это успешный ответ!
                            data: {
                                status: 'ok',
                                code: 200, // Меняем код на 200 для корректной обработки
                                message: data.message,
                                links: [],
                                linkedCount: 0,
                                totalfixedlink: data.totalfixedlink || 0
                            }
                        };
                    }
                }

                return {
                    success: false,
                    error: `API Error: ${error.response.status}`,
                    details: error.response.data
                };
            } else if (error.request) {
                console.error('[SUBGRAM] Network error:', error.request);
                return {
                    success: false,
                    error: 'Network Error: Unable to reach SubGram API',
                    details: null
                };
            } else {
                console.error('[SUBGRAM] Request setup error:', error.message);
                return {
                    success: false,
                    error: `Request Error: ${error.message}`,
                    details: null
                };
            }
        }
    }

    /**
     * Обработка ответа от SubGram API и подготовка каналов для отображения
     * @param {Object} apiResponse - Ответ от API
     * @returns {Object} Обработанные д��нные каналов
     */
    processAPIResponse(apiResponse) {
        try {
            const { status, code, message, links = [], additional = {} } = apiResponse;
            
            console.log('[SUBGRAM] Processing API response:', { status, code, linksCount: links.length });

            const result = {
                status: status,
                code: code,
                message: message,
                needsSubscription: status === 'warning',
                needsGender: status === 'gender',
                allSubscribed: status === 'ok' && code === 200,
                canProceed: status === 'ok',
                channels: [],
                totalLinks: links.length
            };

            // Обработка каналов из additional.sponsors если доступно
            if (additional.sponsors && Array.isArray(additional.sponsors)) {
                result.channels = additional.sponsors.map(sponsor => ({
                    link: sponsor.link,
                    name: sponsor.resource_name || 'Канал спонсора',
                    logo: sponsor.resource_logo || null,
                    status: sponsor.status, // subscribed, unsubscribed, notgetted
                    type: sponsor.type, // channel, bot, resource
                    needsSubscription: sponsor.status === 'unsubscribed' || sponsor.status === 'notgetted'
                }));
            } else if (links && links.length > 0) {
                // Если только ссылки без до��олнительной информации
                result.channels = links.map((link, index) => ({
                    link: link,
                    name: `Спонсорский канал ${index + 1}`,
                    logo: null,
                    status: 'unknown',
                    type: 'channel',
                    needsSubscription: true
                }));
            }

            // Фильтруем только каналы, которые требуют подписки
            result.channelsToSubscribe = result.channels.filter(channel => 
                channel.needsSubscription
            );

            console.log('[SUBGRAM] Processed channels:', {
                total: result.channels.length,
                needSubscription: result.channelsToSubscribe.length,
                status: result.status
            });

            return result;

        } catch (error) {
            console.error('[SUBGRAM] Error processing API response:', error);
            return {
                status: 'error',
                code: 500,
                message: 'Ошибка обработки от��ета от SubGram',
                needsSubscription: false,
                needsGender: false,
                allSubscribed: false,
                canProceed: false,
                channels: [],
                channelsToSubscribe: [],
                totalLinks: 0
            };
        }
    }

    /**
     * Проверка статуса пользователя в SubGram (повторный запрос для проверки)
     * @param {Object} params - Те же параметры что и в requestSponsors
     * @returns {Object} Результат проверки
     */
    async checkUserStatus(params) {
        console.log('[SUBGRAM] Checking user subscription status...');
        return await this.requestSponsors(params);
    }

    /**
     * Форматирование сообщения с каналами для пользователя
     * @param {Object} processedData - Обработанные данные от processAPIResponse
     * @returns {Object} Сообщение и кнопки для Telegram
     */
    formatChannelsMessage(processedData) {
        try {
            if (processedData.needsGender) {
                return {
                    message: `🤖 **SubGram требует уточнения**\n\nДля подбора подходящих каналов укажите ваш пол:`,
                    buttons: [
                        [
                            { text: '👨 Мужской', callback_data: 'subgram_gender_male' },
                            { text: '👩 Женский', callback_data: 'subgram_gender_female' }
                        ],
                        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                    ]
                };
            }

            if (processedData.allSubscribed) {
                return {
                    message: `✅ **Отлично!**\n\nВы подписаны на все спонсорские каналы!\n\n🎉 Можете продолжать пользоваться ботом.`,
                    buttons: [
                        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                    ]
                };
            }

            if (!processedData.needsSubscription) {
                return {
                    message: `ℹ️ **Информация от SubGram**\n\n${processedData.message}\n\n🎯 Вы можете продолжать использование бота.`,
                    buttons: [
                        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                    ]
                };
            }

            // Основной случай - нужно подписаться на каналы
            let message = `🔔 **Спонсорские каналы от SubGram**\n\n`;
            message += `📋 Для продолжения работы необходимо подписаться на спонсорские каналы:\n\n`;

            const buttons = [];
            
            // Добавляем кнопки для каждого канала
            processedData.channelsToSubscribe.forEach((channel, index) => {
                message += `${index + 1}. ${channel.name}\n`;
                
                // Создаем кнопку для подписки
                buttons.push([{
                    text: `📺 ${channel.name}`,
                    url: channel.link
                }]);
            });

            message += `\n💡 После подписки на все каналы нажмите кнопку проверки`;

            // Добавляем кнопки управления
            buttons.push([{ text: '✅ Проверить подписки', callback_data: 'subgram_check' }]);
            buttons.push([{ text: '🏠 В главное меню', callback_data: 'main_menu' }]);

            return { message, buttons };

        } catch (error) {
            console.error('[SUBGRAM] Error formatting message:', error);
            return {
                message: '❌ Ошибка при формировании сообщения о спонсорских каналах.',
                buttons: [
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        }
    }

    /**
     * Получение конфигурации для отладки
     * @returns {Object} Текущая конфигурация
     */
    getConfig() {
        return {
            apiUrl: this.apiUrl,
            hasApiKey: !!this.apiKey,
            apiKeyLength: this.apiKey ? this.apiKey.length : 0
        };
    }
}

// Создаем единственный экземпляр для использования в боте
const subgramAPI = new SubGramAPI();

module.exports = {
    SubGramAPI,
    subgramAPI
};
