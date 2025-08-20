/**
 * Система fallback для обработки случаев когда SubGram не возвращает спонсорские каналы
 * Обеспечивает корректную работу бота даже при отсутствии спонсорских каналов
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

/**
 * Проверить доступность SubGram и получить каналы с fallback логикой
 * @param {number} userId - ID пользователя
 * @param {Object} options - Опции запроса
 * @returns {Object} Результат с каналами или fallback
 */
async function getSponsorsWithFallback(userId, options = {}) {
    const result = {
        success: false,
        channels: [],
        source: 'none',
        fallbackUsed: false,
        error: null,
        shouldSkipSponsors: false
    };

    try {
        // 1. Проверяем настройки SubGram
        const settings = await db.getSubGramSettings();
        if (!settings || !settings.enabled) {
            console.log('[FALLBACK] SubGram disabled, skipping sponsors');
            result.shouldSkipSponsors = true;
            result.fallbackUsed = true;
            result.source = 'disabled';
            return result;
        }

        // 2. Проверяем есть ли сохраненные каналы (не старше 2 часов)
        const savedChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '2 hours'
            ORDER BY created_at DESC
        `, [userId]);

        if (savedChannels.rows && savedChannels.rows.length > 0) {
            console.log(`[FALLBACK] Using ${savedChannels.rows.length} saved channels`);
            
            // Убираем дубликаты
            const uniqueChannels = new Map();
            savedChannels.rows.forEach(ch => {
                if (!uniqueChannels.has(ch.channel_link)) {
                    uniqueChannels.set(ch.channel_link, ch);
                }
            });

            result.success = true;
            result.channels = Array.from(uniqueChannels.values()).map(ch => ({
                link: ch.channel_link,
                name: ch.channel_name || 'Спонсорский канал',
                type: 'subgram',
                needsSubscription: true
            }));
            result.source = 'saved';
            return result;
        }

        // 3. Попытка получить новые каналы от API
        console.log('[FALLBACK] No saved channels, requesting from SubGram API...');
        
        const apiParams = {
            userId: userId.toString(),
            chatId: userId.toString(),
            maxOP: settings.max_sponsors || 3,
            action: settings.default_action || 'subscribe',
            excludeChannelIds: [],
            withToken: true,
            ...options
        };

        const apiResponse = await subgramAPI.requestSponsors(apiParams);
        
        // Логируем запрос
        await db.logSubGramAPIRequest(
            userId,
            'fallback_request',
            apiParams,
            apiResponse.data || {},
            apiResponse.success,
            apiResponse.error
        );

        if (apiResponse.success && apiResponse.data) {
            const processedData = subgramAPI.processAPIResponse(apiResponse.data);
            
            console.log(`[FALLBACK] API response: status=${processedData.status}, channels=${processedData.channels.length}, needSubscription=${processedData.needsSubscription}`);

            if (processedData.allSubscribed && processedData.channels.length === 0) {
                // API говорит что все подписаны, но каналов нет = нет доступных спонсоров
                console.log('[FALLBACK] No sponsors available from SubGram');
                result.shouldSkipSponsors = true;
                result.fallbackUsed = true;
                result.source = 'no_sponsors_available';
                return result;
            }

            if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                console.log(`[FALLBACK] Got ${processedData.channelsToSubscribe.length} channels from API`);
                
                // Убираем дубликаты
                const uniqueChannels = new Map();
                processedData.channelsToSubscribe.forEach(ch => {
                    if (!uniqueChannels.has(ch.link)) {
                        uniqueChannels.set(ch.link, ch);
                    }
                });

                result.success = true;
                result.channels = Array.from(uniqueChannels.values());
                result.source = 'api';

                // Сохраняем в БД
                await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
                await db.saveSubGramChannels(userId, result.channels);
                
                return result;
            }

            // API вернул ответ, но без каналов для подписки
            if (processedData.status === 'ok' || processedData.allSubscribed) {
                console.log('[FALLBACK] API says all subscribed or no channels needed');
                result.shouldSkipSponsors = true;
                result.fallbackUsed = true;
                result.source = 'api_no_channels';
                return result;
            }

            // Нужен пол или другие данные
            if (processedData.needsGender) {
                console.log('[FALLBACK] API requires gender, using fallback');
                result.error = 'gender_required';
                result.fallbackUsed = true;
                result.source = 'gender_required';
                return result;
            }
        }

        // 4. API запрос не удался - используем fallback
        console.log('[FALLBACK] API request failed, using fallback logic');
        result.error = apiResponse.error || 'api_failed';
        result.fallbackUsed = true;
        result.source = 'api_failed';

        // Проверяем есть ли старые сохраненные каналы (до 24 часов)
        const oldChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '24 hours'
            ORDER BY created_at DESC
            LIMIT 5
        `, [userId]);

        if (oldChannels.rows && oldChannels.rows.length > 0) {
            console.log(`[FALLBACK] Using ${oldChannels.rows.length} old channels as fallback`);
            
            const uniqueChannels = new Map();
            oldChannels.rows.forEach(ch => {
                if (!uniqueChannels.has(ch.channel_link)) {
                    uniqueChannels.set(ch.channel_link, ch);
                }
            });

            result.success = true;
            result.channels = Array.from(uniqueChannels.values()).map(ch => ({
                link: ch.channel_link,
                name: ch.channel_name || 'Спонсорский канал',
                type: 'subgram',
                needsSubscription: true
            }));
            result.source = 'old_saved';
            return result;
        }

        // 5. Полный fallback - временно пропускаем спонсоров
        console.log('[FALLBACK] No channels available, skipping sponsors temporarily');
        result.shouldSkipSponsors = true;
        result.fallbackUsed = true;
        result.source = 'full_fallback';
        
        return result;

    } catch (error) {
        console.error('[FALLBACK] Critical error in sponsor fallback:', error);
        
        result.error = error.message;
        result.fallbackUsed = true;
        result.shouldSkipSponsors = true;
        result.source = 'critical_error';
        
        // Логируем критическую ошибку
        try {
            await db.logSubGramAPIRequest(
                userId,
                'fallback_critical_error',
                options,
                {},
                false,
                error.message
            );
        } catch (logError) {
            console.error('[FALLBACK] Failed to log critical error:', logError);
        }
        
        return result;
    }
}

/**
 * Проверить нужно ли показывать спонсорские каналы для этапа подписки
 * @param {number} userId - ID пользователя
 * @returns {Object} Решение о показе спонсоров
 */
async function shouldShowSponsors(userId) {
    try {
        // Проверяем настройки
        const settings = await db.getSubGramSettings();
        if (!settings || !settings.enabled) {
            return {
                shouldShow: false,
                reason: 'disabled_in_settings',
                fallbackUsed: true
            };
        }

        // Проверяем статистику ошибок за последние 6 часов
        const errorStats = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_requests,
                COUNT(CASE WHEN success = false THEN 1 END) as failed_requests
            FROM subgram_api_requests 
            WHERE created_at > NOW() - INTERVAL '6 hours'
            AND user_id = $1
        `, [userId]);

        if (errorStats.rows.length > 0) {
            const stats = errorStats.rows[0];
            if (stats.total_requests > 3 && stats.failed_requests / stats.total_requests > 0.8) {
                console.log(`[FALLBACK] High error rate for user ${userId}, skipping sponsors`);
                return {
                    shouldShow: false,
                    reason: 'high_error_rate',
                    fallbackUsed: true,
                    stats: stats
                };
            }
        }

        // Проверяем есть ли доступные каналы
        const sponsorResult = await getSponsorsWithFallback(userId);
        
        if (sponsorResult.shouldSkipSponsors) {
            return {
                shouldShow: false,
                reason: sponsorResult.source,
                fallbackUsed: sponsorResult.fallbackUsed,
                error: sponsorResult.error
            };
        }

        if (sponsorResult.success && sponsorResult.channels.length > 0) {
            return {
                shouldShow: true,
                reason: 'channels_available',
                channelsCount: sponsorResult.channels.length,
                source: sponsorResult.source
            };
        }

        // По умолчанию не показываем если не уверены
        return {
            shouldShow: false,
            reason: 'no_channels_or_error',
            fallbackUsed: true,
            error: sponsorResult.error
        };

    } catch (error) {
        console.error('[FALLBACK] Error checking if should show sponsors:', error);
        return {
            shouldShow: false,
            reason: 'check_error',
            fallbackUsed: true,
            error: error.message
        };
    }
}

/**
 * Получить сообщение о проблемах с спонсорами для админа
 * @returns {string} Сообщение о состоянии спонсорской системы
 */
async function getSponsorStatusMessage() {
    try {
        const settings = await db.getSubGramSettings();
        
        let message = '🔍 **Статус спонсорской системы SubGram**\n\n';
        
        if (!settings) {
            message += '❌ **Настройки не найдены**\n';
            message += 'Настройки SubGram не настроены в базе данных\n\n';
        } else {
            message += `📊 **Настройки:**\n`;
            message += `• Включено: ${settings.enabled ? '✅' : '❌'}\n`;
            message += `• Макс спонсоров: ${settings.max_sponsors}\n`;
            message += `• API ключ: ${settings.api_key ? '✅ Есть' : '❌ Нет'}\n\n`;
        }

        // Статистика запросов за 24 часа
        const requestStats = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_requests,
                COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
                COUNT(CASE WHEN success = false THEN 1 END) as failed_requests,
                COUNT(DISTINCT user_id) as unique_users
            FROM subgram_api_requests 
            WHERE created_at > NOW() - INTERVAL '24 hours'
        `);

        if (requestStats.rows.length > 0) {
            const stats = requestStats.rows[0];
            const errorRate = stats.total_requests > 0 ? 
                (stats.failed_requests / stats.total_requests * 100).toFixed(1) : 0;

            message += `📈 **Статистика (24ч):**\n`;
            message += `• Всего запросов: ${stats.total_requests}\n`;
            message += `• Успешных: ${stats.successful_requests}\n`;
            message += `• Ошибок: ${stats.failed_requests} (${errorRate}%)\n`;
            message += `• Уникальных пользователей: ${stats.unique_users}\n\n`;

            if (errorRate > 50) {
                message += '🚨 **КРИТИЧНО:** Высокий процент ошибок!\n';
            } else if (errorRate > 20) {
                message += '⚠️ **ВНИМАНИЕ:** Умеренный процент ошибок\n';
            } else if (stats.total_requests > 0) {
                message += '✅ **НОРМА:** Приемлемый процент ошибок\n';
            }
        }

        // Последние ошибки
        const recentErrors = await db.executeQuery(`
            SELECT error_message, created_at
            FROM subgram_api_requests 
            WHERE success = false 
            AND created_at > NOW() - INTERVAL '6 hours'
            ORDER BY created_at DESC
            LIMIT 3
        `);

        if (recentErrors.rows.length > 0) {
            message += `\n❌ **Последние ошибки:**\n`;
            recentErrors.rows.forEach((error, index) => {
                const timeAgo = Math.round((Date.now() - new Date(error.created_at).getTime()) / (1000 * 60));
                message += `${index + 1}. ${error.error_message} (${timeAgo} мин назад)\n`;
            });
        }

        // Рекомендации
        message += '\n🔧 **Рекомендации:**\n';
        if (!settings?.enabled) {
            message += '• Включите SubGram в настройках\n';
        }
        if (!settings?.api_key) {
            message += '• Добавьте API ключ SubGram\n';
        }
        if (requestStats.rows[0]?.failed_requests > 5) {
            message += '• Проверьте настройки бота в SubGram панели\n';
            message += '• Убедитесь что бот добавлен с токеном\n';
        }

        return message;

    } catch (error) {
        return `❌ Ошибка получения статуса: ${error.message}`;
    }
}

module.exports = {
    getSponsorsWithFallback,
    shouldShowSponsors,
    getSponsorStatusMessage
};
