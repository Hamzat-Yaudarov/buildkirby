const XLSX = require('xlsx');
const Database = require('./database');

// Если нужно продолжить с определенной записи
const RESUME_FROM_USER = 2130; // Начать с записи где остановились

async function resumeMigration() {
    try {
        console.log(`🔄 ПРОДОЛЖЕНИЕ МИГРАЦИИ с пользователя ${RESUME_FROM_USER}`);

        const workbook = XLSX.readFile('./xlsx-data/users.xlsx');
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        console.log(`📊 Всего пользователей: ${data.length}`);
        console.log(`🎯 Пропускаем первые ${RESUME_FROM_USER} записей`);

        const remainingData = data.slice(RESUME_FROM_USER);
        console.log(`⏭️ Осталось обработать: ${remainingData.length} записей`);

        const client = await Database.pool.connect();
        let processed = 0;
        let errors = 0;

        try {
            for (let i = 0; i < remainingData.length; i++) {
                const row = remainingData[i];
                const globalIndex = RESUME_FROM_USER + i + 1;

                try {
                    await client.query(`
                        INSERT INTO users (
                            user_id, username, first_name, language_code, is_premium,
                            balance, total_earned, referral_earned, total_referrals,
                            referrer_id, referral_completed, captcha_passed, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                        ON CONFLICT (user_id) DO NOTHING
                    `, [
                        row.user_id,
                        row.username || null,
                        row.first_name || null,
                        row.language_code || 'ru',
                        row.is_premium || false,
                        parseFloat(row.balance) || 0,
                        parseFloat(row.total_earned) || 0,
                        parseFloat(row.referral_earned) || 0,
                        parseInt(row.total_referrals) || 0,
                        row.referrer_id || null,
                        row.referral_completed || false,
                        row.captcha_passed || false,
                        row.created_at || new Date()
                    ]);

                    processed++;

                    if (globalIndex % 100 === 0) {
                        console.log(`✅ Обработано ${processed} записей (позиция ${globalIndex})`);
                    }

                } catch (error) {
                    console.log(`❌ Ошибка пользователя ${globalIndex}: ${error.message}`);
                    errors++;
                }
            }

            console.log(`🎉 ПРОДОЛЖЕНИЕ ЗАВЕРШЕНО!`);
            console.log(`✅ Успешно: ${processed}`);
            console.log(`❌ Ошибок: ${errors}`);

        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ Ошибка продолжения:', error);
    }
}

resumeMigration();
