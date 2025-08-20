/**
 * Проверка старых спонсорских каналов в базе данных
 */

const db = require('./database');

async function checkSubGramDatabase() {
    console.log('🔍 ПРОВЕРКА СТАРЫХ КАНАЛОВ В БАЗЕ ДАННЫХ\n');

    try {
        await db.initializeDatabase();

        // 1. Проверяем все сохраненные каналы
        console.log('1️⃣ Проверка всех сохраненных каналов...');
        const allChannels = await db.executeQuery(`
            SELECT user_id, channel_name, channel_link, created_at, 
                   DATE_PART('hour', NOW() - created_at) as hours_ago
            FROM subgram_channels 
            ORDER BY created_at DESC
        `);

        console.log(`📊 Найдено ${allChannels.rows.length} каналов в базе данных:`);
        
        if (allChannels.rows.length > 0) {
            console.log('\n📝 Все каналы:');
            allChannels.rows.forEach((ch, i) => {
                console.log(`${i+1}. User ${ch.user_id}: ${ch.channel_name}`);
                console.log(`   Ссылка: ${ch.channel_link}`);
                console.log(`   Создан: ${ch.created_at} (${Math.round(ch.hours_ago)} часов назад)`);
                console.log('');
            });
        }

        // 2. Проверяем "свежие" каналы (до 2 часов)
        console.log('2️⃣ Проверка "свежих" каналов (до 2 часов)...');
        const freshChannels = await db.executeQuery(`
            SELECT user_id, channel_name, channel_link, created_at
            FROM subgram_channels 
            WHERE created_at > NOW() - INTERVAL '2 hours'
            ORDER BY created_at DESC
        `);

        console.log(`📊 Найдено ${freshChannels.rows.length} свежих каналов:`);
        freshChannels.rows.forEach((ch, i) => {
            console.log(`${i+1}. User ${ch.user_id}: ${ch.channel_name} (${ch.channel_link})`);
        });

        // 3. Проверяем каналы для конкретного пользователя
        const testUserId = 7961237966;
        console.log(`\n3️⃣ Проверка каналов для пользователя ${testUserId}...`);
        const userChannels = await db.executeQuery(`
            SELECT channel_name, channel_link, created_at,
                   DATE_PART('hour', NOW() - created_at) as hours_ago
            FROM subgram_channels 
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [testUserId]);

        console.log(`📊 Найдено ${userChannels.rows.length} каналов для пользователя:`);
        userChannels.rows.forEach((ch, i) => {
            console.log(`${i+1}. ${ch.channel_name}`);
            console.log(`   Ссылка: ${ch.channel_link}`);
            console.log(`   Возраст: ${Math.round(ch.hours_ago)} часов`);
        });

        // 4. Проверяем логику загрузки каналов
        console.log(`\n4️⃣ Тестирование логики загрузки каналов...`);
        
        // Симулируем логику из subscription-flow-manager.js
        const savedChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '2 hours'
            ORDER BY created_at DESC
        `, [testUserId]);

        console.log(`🧪 Логика загрузки: найдено ${savedChannels.rows.length} каналов по критерию "до 2 часов"`);

        // 5. Проверяем старые каналы (старше 2 часов)
        const oldChannels = await db.executeQuery(`
            SELECT channel_name, channel_link, created_at,
                   DATE_PART('hour', NOW() - created_at) as hours_ago
            FROM subgram_channels 
            WHERE user_id = $1
            AND created_at <= NOW() - INTERVAL '2 hours'
            ORDER BY created_at DESC
        `, [testUserId]);

        console.log(`📰 Старые каналы (>2ч): найдено ${oldChannels.rows.length}`);
        if (oldChannels.rows.length > 0) {
            console.log('⚠️ ПРОБЛЕМА: Есть старые каналы, которые могут показываться!');
            oldChannels.rows.forEach((ch, i) => {
                console.log(`${i+1}. ${ch.channel_name} (${Math.round(ch.hours_ago)}ч назад)`);
            });
        }

        // 6. Анализ проблемы
        console.log('\n6️⃣ АНАЛИЗ ПРОБЛЕМЫ:');
        console.log('==========================================');
        
        if (userChannels.rows.length > 0) {
            console.log('🚨 **НАЙДЕНА ПРИЧИНА ПРОБЛЕМЫ:**');
            console.log(`• В базе данных есть ${userChannels.rows.length} старых каналов`);
            console.log('• Эти каналы показываются пользователю');
            console.log('• Логика очистки не работает корректно');
            
            console.log('\n🔧 **РЕШЕНИЕ:**');
            console.log('1. Очистить все старые каналы');
            console.log('2. Исправить логику очистки при получении 0 каналов');
            console.log('3. Добавить принудительную очистку кэша');
        } else {
            console.log('✅ **КАНАЛОВ В БД НЕТ**');
            console.log('Проблема может быть в другом месте - проверим логику отображения');
        }

        // 7. Предложение очистки
        console.log('\n7️⃣ ПРЕДЛОЖЕНИЕ ДЕЙСТВИЙ:');
        console.log('==========================================');
        console.log('Хотите очистить все старые каналы? Выполните:');
        console.log('```sql');
        console.log('DELETE FROM subgram_channels;');
        console.log('```');
        console.log('');
        console.log('Или только для конкретного пользователя:');
        console.log('```sql');
        console.log(`DELETE FROM subgram_channels WHERE user_id = ${testUserId};`);
        console.log('```');

    } catch (error) {
        console.error('\n❌ ОШИБКА:', error.message);
        console.error(error.stack);
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Подключение закрыто');
    }
}

if (require.main === module) {
    checkSubGramDatabase();
}

module.exports = { checkSubGramDatabase };
