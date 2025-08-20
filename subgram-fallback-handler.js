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

        // 2. Сначала делаем свежий запрос к API - если вернется 0 каналов, очищаем старые
        console.log('[FALLBACK] Making fresh API request to check current status...');

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
            'fallback_fresh_check',
            apiParams,
            apiResponse.data || {},
            apiResponse.success,
            apiResponse.error
        );

        // Если API успешно ответил но каналов нет - очищаем старые каналы
        if (apiResponse.success && apiResponse.data) {
            const processedData = subgramAPI.processAPIResponse(apiResponse.data);

            console.log(`[FALLBACK] Fresh API response: status=${processedData.status}, channels=${processedData.channels.length}`);

            if (processedData.status === 'ok' && processedData.channels.length === 0) {
                console.log('[FALLBACK] API confirms no channels available - clearing old saved channels');

                // Очищаем старые каналы для этого пользователя
                await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);

                result.shouldSkipSponsors = true;
                result.fallbackUsed = true;
                result.source = 'api_no_channels_cleared_cache';
                return result;
            }

            if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                console.log(`[FALLBACK] Got ${processedData.channelsToSubscribe.length} fresh channels from API`);

                // Убираем дубликаты
                const uniqueChannels = new Map();
                processedData.channelsToSubscribe.forEach(ch => {
                    if (!uniqueChannels.has(ch.link)) {
                        uniqueChannels.set(ch.link, ch);
                    }
                });

                result.success = true;
                result.channels = Array.from(uniqueChannels.values());
                result.source = 'api_fresh';

                // Сохраняем в БД новые каналы
                await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
                await db.saveSubGramChannels(userId, result.channels);

                return result;
            }
        }

        // 3. Если API недоступен, проверяем есть ли сохраненные каналы (не старше 1 часа)
        console.log('[FALLBACK] API unavailable, checking for recent saved channels...');
        const savedChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '1 hour'
            ORDER BY created_at DESC
        `, [userId]);

        if (savedChannels.rows && savedChannels.rows.length > 0) {
            console.log(`[FALLBACK] Using ${savedChannels.rows.length} recent saved channels (API unavailable)`);

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
            result.source = 'saved_api_unavailable';
            return result;
        }

        // 4. Полный fallback - пропуска��м спонсоров
        console.log('[FALLBACK] No channels available, skipping sponsors');
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
        // Проверяем нас��ройки
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
 * @returns {string} Сообщение о состояни�� спонсорской системы
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
                COUNT(CASE WHEN api_status = 'ok' AND response_data::text LIKE '%подходящих рекламодателей%' THEN 1 END) as no_advertisers_responses,
                COUNT(DISTINCT user_id) as unique_users
            FROM subgram_api_requests
            WHERE created_at > NOW() - INTERVAL '24 hours'
        `);

        if (requestStats.rows.length > 0) {
            const stats = requestStats.rows[0];
            const realErrors = stats.failed_requests - (stats.no_advertisers_responses || 0);
            const errorRate = stats.total_requests > 0 ?
                (realErrors / stats.total_requests * 100).toFixed(1) : 0;

            message += `📈 **Статистика (24ч):**\n`;
            message += `• Всего запросов: ${stats.total_requests}\n`;
            message += `• Успешных: ${stats.successful_requests}\n`;
            message += `• Реальных ошибок: ${realErrors} (${errorRate}%)\n`;
            message += `• "Нет рекламодателей": ${stats.no_advertisers_responses || 0}\n`;
            message += `• Уникальных пользователей: ${stats.unique_users}\n\n`;

            if (errorRate > 50) {
                message += '🚨 **КРИТИЧНО:** Высокий процент ошибок!\n';
            } else if (errorRate > 20) {
                message += '⚠️ **ВНИМАНИЕ:** Умеренный процент ошибок\n';
            } else if (stats.total_requests > 0) {
                message += '✅ **НОРМА:** Приемлемый процент ошибок\n';
            }

            if ((stats.no_advertisers_responses || 0) > stats.total_requests * 0.5) {
                message += '📭 **ИНФОРМАЦИЯ:** В основном "нет подходящих рекламодателей" - это нормально\n';
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
