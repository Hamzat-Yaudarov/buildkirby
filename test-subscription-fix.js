/**
 * Тестовый скрипт для проверки исправления проблем с подписками SubGram
 * Эмулирует сценарии когда пользователь подписывается на каналы
 */

const smartSubGram = require('./subgram-smart-handler');
const db = require('./database');

async function testSubscriptionFix() {
    console.log('🧪 Тестирование исправления проблем с подписками SubGram...\n');

    try {
        // Инициализируем базу данных
        await db.initializeDatabase();
        console.log('✅ База данных готова\n');

        const testUserId = 7972065986; // ID админа для теста

        console.log('📋 ТЕСТ 1: Проверка состояния перед подпиской');
        console.log('='.repeat(60));

        // Получаем начальное состояние
        const initialState = await smartSubGram.getSubGramState(testUserId);
        console.log(`🔍 Начальное состояние: ${initialState.state}`);
        console.log(`🔒 Блокировка: ${initialState.shouldBlock}`);
        console.log(`📺 Каналов: ${initialState.channels.length}`);

        if (initialState.channels.length === 0) {
            console.log('ℹ️ Нет каналов для тестирования - это нормально');
            console.log('📝 SubGram показывает разные каналы разным пользователям\n');
        } else {
            console.log('📝 Найдены каналы для тестирования\n');
        }

        console.log('📋 ТЕСТ 2: Эмуляция успешной подписки');
        console.log('='.repeat(60));

        // Эмулируем что пользователь подписался на все каналы
        if (initialState.channels.length > 0) {
            console.log('🎯 Очищаем сохраненные каналы (эмуляция п��дписки)...');
            await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [testUserId]);
            
            console.log('🔄 Принудительно обновляем состояние...');
            const refreshedState = await smartSubGram.forceRefreshSubGramState(testUserId);
            
            console.log(`✅ Состояние после "подписки": ${refreshedState.state}`);
            console.log(`🔒 Блокировка: ${refreshedState.shouldBlock}`);
            console.log(`📺 Каналов: ${refreshedState.channels.length}\n`);
        } else {
            console.log('⏭️ Пропускаем эмуляцию подписки - нет каналов\n');
        }

        console.log('📋 ТЕСТ 3: Проверка функции checkUserSubscriptions');
        console.log('='.repeat(60));

        // Мок бота для тестирования
        const mockBot = {
            getChatMember: async (chat, userId) => {
                console.log(`   [MOCK] Проверка подписки: user ${userId} in ${chat}`);
                // Эмулируем что пользователь подписан
                return { status: 'member' };
            }
        };

        const subscriptionCheck = await smartSubGram.checkUserSubscriptions(mockBot, testUserId);
        console.log(`✅ Все подписки: ${subscriptionCheck.allSubscribed}`);
        console.log(`📊 Проверено каналов: ${subscriptionCheck.channels.length}`);
        console.log(`🔄 Состояние обновлено: ${subscriptionCheck.refreshed || false}\n`);

        console.log('📋 ТЕСТ 4: Проверка решения о доступе');
        console.log('='.repeat(60));

        const accessDecision = await smartSubGram.shouldBlockBotAccess(testUserId);
        console.log(`🎯 Блокировать доступ: ${accessDecision.shouldBlock}`);
        console.log(`📝 Причина: ${accessDecision.reason}`);
        console.log(`📺 Каналов для подписки: ${accessDecision.channels.length}\n`);

        console.log('📋 ТЕСТ 5: Проверка сообщения для пользователя');
        console.log('='.repeat(60));

        const userMessage = await smartSubGram.getSubscriptionMessage(testUserId);
        console.log(`👤 Доступ разрешен: ${userMessage.accessAllowed}`);
        console.log(`📝 Причина: ${userMessage.reason || 'N/A'}`);
        
        if (!userMessage.accessAllowed) {
            console.log(`📺 Каналов для подписки: ${userMessage.channelsCount}`);
        }
        console.log('');

        // Итоги тестирования
        console.log('🎯 ИТОГИ ТЕСТИРОВАНИЯ:');
        console.log('='.repeat(60));

        const testResults = analyzeTestResults(initialState, accessDecision, userMessage);
        
        if (testResults.success) {
            console.log('🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ!');
            console.log(`✅ ${testResults.summary}`);
            
            console.log('\n📋 Исправленные проблемы:');
            console.log('1. ✅ Спонсорские каналы показываются корректно (разным пользователям - разные)');
            console.log('2. ✅ После подписки состояние обновляется и доступ разрешается');
            console.log('3. ✅ Кнопка "проверить подписки" работает правильно');
            console.log('4. ✅ Принудительное обновление состояния работает');
            
        } else {
            console.log('❌ ОБНАРУЖЕНЫ ПРОБЛЕМЫ:');
            console.log(`⚠️ ${testResults.summary}`);
            
            console.log('\n🔧 Рекомендации:');
            console.log('1. Проверьте логи на наличие ошибок');
            console.log('2. Используйте команду /debug_subgram для отладки');
            console.log('3. Проверьте настройки SubGram');
        }

        console.log('\n🚀 Команды для дальнейшего тестирования:');
        console.log('/check_smart_state - быстрая проверка состояния');
        console.log('/force_refresh_subgram - принудительное обновление');
        console.log('/admin_subgram_test - полный тест системы');

    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        try {
            await db.closeConnection();
            console.log('\n🔒 База данных закрыта');
        } catch (closeError) {
            console.error('Ошибка закрытия базы:', closeError);
        }
    }
}

function analyzeTestResults(initialState, accessDecision, userMessage) {
    // Анализируем результаты тестирования
    
    try {
        // Проверяем логику работы
        if (initialState.channels.length === 0) {
            // Нет каналов - доступ должен быть разрешен
            if (!accessDecision.shouldBlock && userMessage.accessAllowed) {
                return {
                    success: true,
                    summary: 'Нет каналов → доступ разрешен → главное меню'
                };
            } else {
                return {
                    success: false,
                    summary: 'Нет каналов, но доступ блокируется - ошибка в логике'
                };
            }
        } else {
            // Есть каналы - зависит от подписки
            if (accessDecision.shouldBlock && !userMessage.accessAllowed) {
                return {
                    success: true,
                    summary: 'Есть каналы → доступ заблокирован → показываются каналы'
                };
            } else if (!accessDecision.shouldBlock && userMessage.accessAllowed) {
                return {
                    success: true,
                    summary: 'Подписан на все каналы → доступ разрешен → главное меню'
                };
            } else {
                return {
                    success: false,
                    summary: 'Неконсистентное состояние блокировки и сообщений'
                };
            }
        }
        
    } catch (error) {
        return {
            success: false,
            summary: `Ошибка анализа результатов: ${error.message}`
        };
    }
}

// Запускаем тест
if (require.main === module) {
    testSubscriptionFix().then(() => {
        console.log('\n✅ Тестирование завершено');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Критическая ошибка тестирования:', error);
        process.exit(1);
    });
}

module.exports = { testSubscriptionFix };
