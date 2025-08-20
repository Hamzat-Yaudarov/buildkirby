/**
 * Отладочный скрипт для анализа ответов SubGram API
 * Поможет понять почему бот не видит спонсорские каналы
 */

const { subgramAPI } = require('./subgram-api');
const db = require('./database');

async function debugSubGramResponse() {
    console.log('🔍 Отладка ответов SubGram API...\n');

    try {
        // Инициализируем базу данных
        await db.initializeDatabase();
        console.log('✅ База данных ин��циализирована\n');

        // Тестовый пользователь (ID админа)
        const testUserId = 7972065986;

        // Получаем настройки
        const settings = await db.getSubGramSettings();
        console.log('⚙️ Настройки SubGram:');
        console.log(`   • Включено: ${settings?.enabled}`);
        console.log(`   • API ключ: ${settings?.api_key ? 'Есть' : 'Нет'}`);
        console.log(`   • Макс спонсоров: ${settings?.max_sponsors}`);
        console.log('');

        if (!settings || !settings.enabled) {
            console.log('❌ SubGram отключен в настройках!');
            return;
        }

        console.log('🌐 Делаем запрос к SubGram API...');

        // Делаем запрос
        const apiResponse = await subgramAPI.requestSponsors({
            userId: testUserId.toString(),
            chatId: testUserId.toString(),
            maxOP: settings.max_sponsors || 3,
            action: settings.default_action || 'subscribe',
            excludeChannelIds: [],
            withToken: true
        });

        console.log('📥 RAW API Response:');
        console.log('   • Success:', apiResponse.success);
        if (apiResponse.error) {
            console.log('   • Error:', apiResponse.error);
        }
        if (apiResponse.data) {
            console.log('   • Data:', JSON.stringify(apiResponse.data, null, 2));
        }
        console.log('');

        if (!apiResponse.success) {
            console.log('❌ API запрос неуспешен');
            return;
        }

        // Обрабатываем ответ
        const processedData = subgramAPI.processAPIResponse(apiResponse.data);
        console.log('🔄 Обработанные данные:');
        console.log('   • Status:', processedData.status);
        console.log('   • Code:', processedData.code);
        console.log('   • Message:', processedData.message);
        console.log('   • NeedsSubscription:', processedData.needsSubscription);
        console.log('   • AllSubscribed:', processedData.allSubscribed);
        console.log('   • CanProceed:', processedData.canProceed);
        console.log('   • Channels count:', processedData.channels.length);
        console.log('   • ChannelsToSubscribe count:', processedData.channelsToSubscribe?.length || 0);
        console.log('');

        if (processedData.channels.length > 0) {
            console.log('📺 Найденные каналы:');
            processedData.channels.forEach((channel, index) => {
                console.log(`   ${index + 1}. ${channel.name}`);
                console.log(`      • Link: ${channel.link}`);
                console.log(`      • Status: ${channel.status}`);
                console.log(`      • Needs subscription: ${channel.needsSubscription}`);
                console.log('');
            });
        }

        if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
            console.log('⚠️ Каналы требующие подписки:');
            processedData.channelsToSubscribe.forEach((channel, index) => {
                console.log(`   ${index + 1}. ${channel.name}`);
                console.log(`      • Link: ${channel.link}`);
                console.log('');
            });
        }

        // Анализируем почему бот может не видеть каналы
        console.log('🎯 АНАЛИЗ ПРОБЛЕМЫ:');
        console.log('='.repeat(50));

        if (processedData.status === 'ok' && processedData.code === 200) {
            console.log('⚠️ SubGram возвращает status="ok" и code=200');
            console.log('   Это означает что пользователь подписан на все каналы');
            console.log('   ИЛИ нет доступных спонсорских кана��ов');
            
            if (processedData.channels.length === 0) {
                console.log('✅ Каналов действительно нет - это нормально');
            } else {
                console.log('❓ Каналы есть, но статус OK - возможная проблема');
            }
        }

        if (processedData.status === 'warning') {
            console.log('🚨 SubGram возвращает status="warning"');
            console.log('   Это означает что есть каналы для подписки');
            
            if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                console.log('✅ Каналы для подписки найдены - блокировка должна работать');
            } else {
                console.log('❌ Статус warning, но каналов нет - проблема в обработке');
            }
        }

        // Проверяем сохраненные каналы
        const savedChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 10
        `, [testUserId]);

        console.log('\n💾 Сохраненные каналы в базе:');
        if (savedChannels.rows.length === 0) {
            console.log('   Нет сохраненных каналов');
        } else {
            savedChannels.rows.forEach((channel, index) => {
                console.log(`   ${index + 1}. ${channel.channel_name}`);
                console.log(`      • Link: ${channel.channel_link}`);
                console.log(`      • Created: ${channel.created_at}`);
                console.log('');
            });
        }

        // Рекомендации
        console.log('\n💡 РЕКОМЕНДАЦИИ:');
        console.log('='.repeat(50));
        
        if (processedData.status === 'ok' && processedData.channels.length === 0) {
            console.log('✅ Всё работает правильно - нет спонсорских каналов');
            console.log('   Бот не должен блокировать доступ');
        }
        
        if (processedData.status === 'ok' && processedData.channels.length > 0) {
            console.log('⚠️ Возможная проблема в логике обработки');
            console.log('   Проверьте processAPIResponse в subgram-api.js');
        }
        
        if (processedData.status === 'warning' && processedData.channelsToSubscribe?.length > 0) {
            console.log('🚨 Каналы есть - бот ДОЛЖЕН блокировать доступ');
            console.log('   Если не блокирует, проблема в умной системе');
        }

    } catch (error) {
        console.error('❌ Ошибка отладки:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        try {
            await db.closeConnection();
            console.log('\n🔒 Соединение с базой данных закрыто');
        } catch (closeError) {
            console.error('Ошибка закрытия соединения:', closeError);
        }
    }
}

// Запускаем отладку
if (require.main === module) {
    debugSubGramResponse().then(() => {
        console.log('\n✅ Отладка завершена');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Критическая ошибка отладки:', error);
        process.exit(1);
    });
}

module.exports = { debugSubGramResponse };
