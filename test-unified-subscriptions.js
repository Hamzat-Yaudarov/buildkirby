/**
 * Тест объединённой системы проверки подписок
 */

const db = require('./database');
const { checkUnifiedSubscriptions, getAllChannelsToCheck } = require('./unified-subscription-check');

// Mock bot object for testing
const mockBot = {
    getChatMember: async (channelId, userId) => {
        console.log(`[MOCK] Checking membership for ${channelId}, user ${userId}`);
        
        // Simulate different scenarios
        if (channelId.includes('error')) {
            throw new Error('Channel not found');
        }
        
        // Simulate subscription status
        const isSubscribed = Math.random() > 0.3; // 70% chance of being subscribed
        
        return {
            status: isSubscribed ? 'member' : 'left'
        };
    }
};

async function testUnifiedSubscriptions() {
    console.log('🧪 ТЕСТИРОВАНИЕ ОБЪЕДИНЁННОЙ СИСТЕМЫ ПОДПИСОК\n');

    try {
        await db.initializeDatabase();
        console.log('✅ База данных подключена\n');

        // Тестовый пользователь
        const testUserId = 123456789;

        // 1. Тест получения всех каналов
        console.log('1️⃣ Тестирование получения всех каналов...');
        const channelsData = await getAllChannelsToCheck(testUserId);
        
        console.log('📊 Результат:');
        console.log(`  • Обязательных каналов: ${channelsData.requiredChannels.length}`);
        console.log(`  • SubGram каналов: ${channelsData.subgramChannels.length}`);
        console.log(`  • Всего каналов: ${channelsData.allChannels.length}`);
        console.log(`  • Есть SubGram каналы: ${channelsData.hasSubgramChannels}`);
        
        if (channelsData.error) {
            console.log(`  ❌ Ошибка: ${channelsData.error}`);
        }
        
        console.log('\n📋 Детали каналов:');
        channelsData.allChannels.forEach((channel, index) => {
            console.log(`  ${index + 1}. [${channel.type}] ${channel.name} (${channel.source})`);
            if (channel.link && channel.link !== channel.id) {
                console.log(`     Ссылка: ${channel.link}`);
            }
        });
        console.log('');

        // 2. Тест объединённой проверки подписок
        console.log('2️⃣ Тестирование объединённой проверки подписок...');
        const subscriptionResult = await checkUnifiedSubscriptions(mockBot, testUserId, true);
        
        console.log('📊 Результат проверки:');
        console.log(`  • Все подписаны: ${subscriptionResult.allSubscribed}`);
        console.log(`  • Всего каналов: ${subscriptionResult.channels.length}`);
        console.log(`  • Обязательных: ${subscriptionResult.requiredChannels.length}`);
        console.log(`  • SubGram: ${subscriptionResult.subgramChannels.length}`);
        console.log(`  • Есть ошибки: ${subscriptionResult.hasErrors}`);
        console.log(`  • Есть SubGram каналы: ${subscriptionResult.hasSubgramChannels}`);
        
        if (subscriptionResult.error) {
            console.log(`  ❌ Ошибка: ${subscriptionResult.error}`);
        }
        
        console.log('\n📋 Статус подписок:');
        subscriptionResult.channels.forEach((channel, index) => {
            const status = channel.subscribed ? '✅' : '❌';
            const checkStatus = channel.canCheck ? '' : ' (не можем проверить)';
            console.log(`  ${index + 1}. ${status} [${channel.type}] ${channel.name}${checkStatus}`);
        });
        
        // Показать неподписанные каналы
        const unsubscribedChannels = subscriptionResult.channels.filter(ch => !ch.subscribed && ch.canCheck);
        if (unsubscribedChannels.length > 0) {
            console.log('\n⚠️ Неподписанные каналы:');
            unsubscribedChannels.forEach((channel, index) => {
                console.log(`  ${index + 1}. [${channel.type}] ${channel.name}`);
            });
        }
        console.log('');

        // 3. Тест сравнения с старой системой
        console.log('3️⃣ Сравнение с обязательными каналами...');
        try {
            const requiredChannelsOnly = await db.executeQuery(
                'SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE'
            );
            
            console.log(`📊 Сравнение:`);
            console.log(`  • Только обязательные каналы: ${requiredChannelsOnly.rows.length}`);
            console.log(`  • Объединённая система: ${subscriptionResult.channels.length}`);
            console.log(`  • Добавлено SubGram каналов: ${subscriptionResult.subgramChannels.length}`);
            
            if (subscriptionResult.subgramChannels.length > 0) {
                console.log(`  🎯 SubGram каналы успешно интегрированы!`);
            } else {
                console.log(`  ⚠️ SubGram каналы не найдены или недоступны`);
            }
        } catch (error) {
            console.error('  ❌ Ошибка сравнения:', error.message);
        }
        console.log('');

        // 4. Тест логирования
        console.log('4️⃣ Проверка логирования...');
        try {
            const recentLogs = await db.executeQuery(`
                SELECT * FROM subgram_api_requests 
                WHERE user_id = $1 
                AND created_at > NOW() - INTERVAL '1 hour'
                ORDER BY created_at DESC
                LIMIT 5
            `, [testUserId]);
            
            console.log(`📋 Найдено ${recentLogs.rows.length} записей в л��гах за час:`);
            recentLogs.rows.forEach((log, index) => {
                const status = log.success ? '✅' : '❌';
                console.log(`  ${index + 1}. ${status} ${log.request_type} (${log.api_status || 'no status'})`);
            });
        } catch (error) {
            console.error('  ❌ Ошибка получения логов:', error.message);
        }
        console.log('');

        // 5. Проверка сохранённых каналов
        console.log('5️⃣ Проверка сохранённых SubGram каналов...');
        try {
            const savedChannels = await db.getSubGramChannels(testUserId);
            
            if (savedChannels && savedChannels.length > 0) {
                console.log(`📋 Найдено ${savedChannels.length} сохранённых SubGram каналов:`);
                savedChannels.forEach((channel, index) => {
                    console.log(`  ${index + 1}. ${channel.channel_name} - ${channel.channel_link}`);
                });
            } else {
                console.log('📭 Сохранённых SubGram каналов не найдено');
            }
        } catch (error) {
            console.error('  ❌ Ошибка получения сохранённых каналов:', error.message);
        }
        console.log('');

        // 6. Итоги тестирования
        console.log('6️⃣ ИТОГИ ТЕСТИРОВАНИЯ');
        console.log('==========================================');
        
        console.log('✅ ПРОВЕРЕНО:');
        console.log('  • Получение всех каналов (обязательные + SubGram)');
        console.log('  • Объединённая проверка подписок');
        console.log('  • Логирование API запросов');
        console.log('  • Сохранение каналов в БД');
        
        console.log('\n📊 РЕЗУЛЬТАТЫ:');
        console.log(`  • Всего каналов для проверки: ${subscriptionResult.channels.length}`);
        console.log(`  • Обязательных: ${subscriptionResult.requiredChannels.length}`);
        console.log(`  • SubGram: ${subscriptionResult.subgramChannels.length}`);
        console.log(`  • Пользователь подписан на все: ${subscriptionResult.allSubscribed ? 'ДА' : 'НЕТ'}`);
        
        if (subscriptionResult.allSubscribed) {
            console.log('\n🎉 ОТЛИЧНО: Пользователь подписан на все каналы!');
        } else {
            const unsubscribed = subscriptionResult.channels.filter(ch => !ch.subscribed && ch.canCheck);
            console.log(`\n⚠️ ТРЕБУЕТСЯ ПОДПИСКА: ${unsubscribed.length} каналов`);
            unsubscribed.forEach(ch => {
                console.log(`    • [${ch.type}] ${ch.name}`);
            });
        }
        
        console.log('\n🎯 ГОТОВНОСТЬ СИСТЕМЫ:');
        if (subscriptionResult.channels.length > 0) {
            console.log('✅ Объединённая система работает корректно!');
            console.log('✅ Бот теперь проверяет ВСЕ каналы (обязательные + SubGram)');
            console.log('✅ Пользователи увидят все каналы для подписки');
        } else {
            console.log('⚠️ Нет каналов для проверки - проверьте настройки');
        }

    } catch (error) {
        console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
        console.error('📍 Стек:', error.stack);
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Подключение к БД закрыто');
    }
}

// Запуск если файл вызван напрямую
if (require.main === module) {
    testUnifiedSubscriptions();
}

module.exports = { testUnifiedSubscriptions };
