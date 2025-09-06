// ИСПРАВЛЕНИЕ ЛОГИКИ РЕГИСТРАЦИИ ПОЛЬЗОВАТЕЛЕЙ
// Чтобы не терять 13,000 пользователей

const fs = require('fs');

// Читаем текущий index.js
const indexPath = './index.js';
const indexContent = fs.readFileSync(indexPath, 'utf8');

// Находим и заменяем логику /start команды
const improvedStartHandler = `
// Обработчик команды /start
bot.onText(/\\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const referralCode = match[1] ? match[1].trim() : null;
    
    try {
        // НОВОЕ: СРАЗУ создаем пользователя в БД (не теряем никого!)
        let user = await Database.getUser(userId);
        
        if (!user) {
            // Создаем пользователя НЕМЕДЛЕННО
            const referrerId = referralCode ? parseInt(referralCode) : null;
            user = await Database.createUser({
                userId: userId,
                username: msg.from.username,
                firstName: msg.from.first_name,
                languageCode: msg.from.language_code || 'ru',
                isPremium: msg.from.is_premium || false,
                referrerId: referrerId
            });
            
            console.log(\`✅ НОВЫЙ ПОЛЬЗОВАТЕЛЬ СОХРАНЕН: \${userId} (\${msg.from.first_name})\`);
            
            if (referrerId) {
                console.log(\`👥 Пользователь \${userId} пришел по реферальной ссылке от \${referrerId}\`);
            }
        }

        // ВТОРОЙ ЭТАП: Проверяем, прошел ли пользователь капчу
        let captchaPassed = passedCaptcha.get(userId);

        if (!captchaPassed) {
            // Проверяем в базе данных
            captchaPassed = user?.captcha_passed || false;

            if (captchaPassed) {
                passedCaptcha.set(userId, true);
                console.log(\`✅ Пользователь \${userId} уже проходил капчу (восстановлено из БД)\`);
            }
        }

        if (!captchaPassed) {
            console.log(\`🤖 Пользователь \${userId} не прошел капчу, показываем капчу\`);
            await showCaptcha(chatId, userId);

            // Сохраняем состояние для продолжения после капчи
            userStates.set(userId, 'waiting_after_captcha');
            return;
        }

        // ЗАЩИТА ОТ СПАМА: проверяем не вызывали ли мы недавно проверку подписки
        const now = Date.now();
        const lastCheck = lastSubscriptionCheck.get(userId);
        if (lastCheck && (now - lastCheck) < 3000) { // 3 секунды защита
            console.log(\`⚠️ Защита от спама: пропускаем повторные /start для пользователя \${userId}\`);
            return;
        }
        lastSubscriptionCheck.set(userId, now);
        
        // ТРЕТИЙ ЭТАП: Проверяем подп��ску на каналы
        console.log(\`🔍 Проверка подписки для пользователя \${userId}\`);
        const subscriptionStatus = await checkUserSubscription(
            userId, 
            chatId,
            msg.from.first_name || '',
            msg.from.language_code || 'ru',
            msg.from.is_premium || false
        );
        
        console.log(\`📊 Статус подписки:\`, subscriptionStatus);

        // Если пользователь НЕ подписан - показываем спонсорские каналы
        if (!subscriptionStatus.isSubscribed) {
            console.log(\`🔒 Пользователь \${userId} НЕ подписан на SubGram каналы, показываем каналы для подписки\`);

            if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                console.log(\`📢 Показываем \${subscriptionStatus.subscriptionData.links.length} спонсорских каналов\`);
                const messageSent = await sendSponsorMessage(chatId, userId, subscriptionStatus.subscriptionData);
                if (!messageSent) {
                    console.log(\`⚠️ Не удалось отправить спонсорское сообщение пользователю \${userId}\`);
                }
            } else {
                // Если нет ссылок - все равно даем доступ (или показываем сообщение)
                console.log(\`⚠️ Нет спонсорских каналов для \${userId}, даем доступ к боту\`);
                await showMainMenu(chatId, userId);
            }
            return; // Выходим, НЕ показываем главное меню сразу
        }

        // ЧЕТВЕРТЫЙ ЭТАП: Пользователь подписан - показываем главное меню
        console.log(\`✅ Пользователь \${userId} подписан, показываем главное меню\`);
        await showMainMenu(chatId, userId);
        
    } catch (error) {
        console.error('❌ Ошибка в команде /start:', error);
        
        // ВАЖНО: Даже при ошибке стараемся показать меню
        try {
            await bot.sendMessage(chatId, '❌ Произошла ошибка, но мы попробуем продолжить...');
            await showMainMenu(chatId, userId);
        } catch (fallbackError) {
            await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
        }
    }
});`;

console.log('🔧 ИСПРАВЛЕНИЕ ЛОГИКИ РЕГИСТРАЦИИ ПОЛЬЗОВАТЕЛЕЙ\n');

console.log('📋 ЧТО ИЗМЕНИТСЯ:');
console.log('1. ✅ Пользователи сохраняются в БД СРАЗУ при /start');
console.log('2. ✅ Капча становится вторым этапом (не блокирует сохранение)');
console.log('3. ✅ Подписка на каналы - третий этап');
console.log('4. ✅ Даже при ошибках пользователь не теряется');
console.log('5. ✅ Больше никого не потеряем!\n');

console.log('💡 РЕКОМЕНДАЦИИ ДЛЯ ЗАМЕНЫ:');
console.log('1. Сделайте backup index.js:');
console.log('   cp index.js index_backup_registration.js');
console.log('');
console.log('2. Найдите в index.js строку:');
console.log('   bot.onText(/\\/start(.*)/, async (msg, match) => {');
console.log('');
console.log('3. Замените всю функцию на улучшенную версию выше');
console.log('');
console.log('4. Перезапустите бота');
console.log('');
console.log('🎯 РЕЗУЛЬТАТ: Все новые пользователи будут сохраняться!');

// Создаем файл с новой логикой для удобства
fs.writeFileSync('./improved-start-handler.js', `
// УЛУЧШЕННАЯ ЛОГИКА /start КОМАНДЫ
// Копируйте эту функцию в index.js

${improvedStartHandler}

// ДОПОЛНИТЕЛЬНО: Добавьте функцию для сбора статистики потерь

async function logUserRegistrationStep(userId, step, success = true, error = null) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        userId: userId,
        step: step, // 'captcha', 'subscription', 'menu'
        success: success,
        error: error
    };
    
    // Можно сохранять в файл или БД для анализа
    console.log(\`📊 Registration step: \${JSON.stringify(logEntry)}\`);
}

// Используйте logUserRegistrationStep() в ключевых местах для отслеживания потерь
`);

console.log('📁 Создан файл: improved-start-handler.js');
console.log('📁 Используйте его как референс для обновления index.js');

module.exports = {
    improvedStartHandler
};
