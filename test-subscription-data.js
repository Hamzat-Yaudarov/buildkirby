/**
 * Скрипт для проверки настроек подписок в базе данных
 */

const db = require('./database');

async function checkSubscriptionConfiguration() {
    console.log('🔍 Проверка конфигурации подписок...\n');

    try {
        // 1. Проверяем настройки SubGram
        console.log('1️⃣ Проверка настроек SubGram:');
        const subgramSettings = await db.getSubGramSettings();
        console.log('   Настройки SubGram:', JSON.stringify(subgramSettings, null, 2));
        
        if (!subgramSettings) {
            console.log('   ❌ SubGram настройки не найдены');
        } else if (!subgramSettings.enabled) {
            console.log('   ❌ SubGram отключен');
        } else {
            console.log('   ✅ SubGram включен');
        }

        // 2. Проверяем обязательные каналы
        console.log('\n2️⃣ Проверка обязательных каналов:');
        const requiredChannels = await db.executeQuery(
            'SELECT channel_id, channel_name, is_active FROM required_channels ORDER BY created_at'
        );
        
        console.log(`   Всего каналов в БД: ${requiredChannels.rows.length}`);
        
        if (requiredChannels.rows.length === 0) {
            console.log('   ❌ Нет обязательных каналов в базе данных');
        } else {
            const activeChannels = requiredChannels.rows.filter(ch => ch.is_active);
            console.log(`   Активных каналов: ${activeChannels.length}`);
            
            activeChannels.forEach((ch, index) => {
                console.log(`   ${index + 1}. ${ch.channel_name || ch.channel_id} (${ch.channel_id})`);
            });
            
            if (activeChannels.length === 0) {
                console.log('   ❌ Нет активных обязательных каналов');
            } else {
                console.log('   ✅ Обязательные каналы настроены');
            }
        }

        // 3. Проверяем сохраненные SubGram каналы для тестового пользователя
        console.log('\n3️⃣ Проверка сохраненных SubGram каналов:');
        const testUserId = 12345;
        const savedSubgramChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 10
        `, [testUserId]);
        
        console.log(`   Сохраненных каналов для пользователя ${testUserId}: ${savedSubgramChannels.rows.length}`);
        
        if (savedSubgramChannels.rows.length > 0) {
            savedSubgramChannels.rows.forEach((ch, index) => {
                const timeAgo = Math.round((Date.now() - new Date(ch.created_at).getTime()) / (1000 * 60));
                console.log(`   ${index + 1}. ${ch.channel_name} (${timeAgo} мин назад)`);
            });
        }

        // 4. Тестируем получение каналов через subscription-flow-manager
        console.log('\n4️⃣ Тестирование subscription-flow-manager:');
        const subscriptionFlow = require('./subscription-flow-manager');
        
        try {
            const sponsorChannels = await subscriptionFlow.getSponsorChannels(testUserId);
            console.log(`   Спонсорских каналов получено: ${sponsorChannels.length}`);
            
            const requiredChannelsFlow = await subscriptionFlow.getRequiredChannels();
            console.log(`   Обязательных каналов получено: ${requiredChannelsFlow.length}`);
            
            if (sponsorChannels.length === 0 && requiredChannelsFlow.length === 0) {
                console.log('   ❌ НЕТ КАНАЛОВ! Поэтому allCompleted = true и показывается главное меню');
            } else {
                console.log('   ✅ Каналы найдены');
            }
        } catch (error) {
            console.error('   ❌ Ошибка тестирования subscription-flow-manager:', error);
        }

        console.log('\n📊 РЕЗЮМЕ:');
        const issues = [];
        
        if (!subgramSettings || !subgramSettings.enabled) {
            issues.push('SubGram отключен - нет спонсорских каналов');
        }
        
        if (requiredChannels.rows.filter(ch => ch.is_active).length === 0) {
            issues.push('Нет активных обязательных каналов');
        }
        
        if (issues.length === 0) {
            console.log('✅ Конфигурация выглядит корректной');
        } else {
            console.log('❌ Найдены проблемы:');
            issues.forEach((issue, index) => {
                console.log(`   ${index + 1}. ${issue}`);
            });
            console.log('\n💡 РЕШЕНИЕ: Если нет каналов, то allCompleted становится true и показывается главное меню!');
        }

    } catch (error) {
        console.error('❌ Ошибка проверки конфигурации:', error);
    }
}

// Запускаем проверку
if (require.main === module) {
    checkSubscriptionConfiguration()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { checkSubscriptionConfiguration };
