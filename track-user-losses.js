const fs = require('fs');
const path = require('path');

// Создаем систему отслеживания потерь пользователей

const analyticsCode = `
// ==================== АНАЛИТИКА ПОТЕРЬ ПОЛЬЗОВАТЕЛЕЙ ====================

class UserLossAnalytics {
    constructor() {
        this.stats = {
            total_starts: 0,
            captcha_shown: 0,
            captcha_passed: 0,
            subscription_checked: 0,
            subscribed: 0,
            menu_shown: 0,
            errors: 0
        };
        
        this.dailyLogs = new Map(); // userId -> [steps]
    }

    logStep(userId, step, success = true, details = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            userId,
            step,
            success,
            details
        };

        // Логируем в консоль
        const status = success ? '✅' : '❌';
        console.log(\`📊 USER_TRACKING: \${status} \${step} - User \${userId} \${details ? '(' + details + ')' : ''}\`);

        // Сохраняем в дневные логи
        if (!this.dailyLogs.has(userId)) {
            this.dailyLogs.set(userId, []);
        }
        this.dailyLogs.get(userId).push(logEntry);

        // Обновляем статистику
        this.updateStats(step, success);

        // Сохраняем в файл каждые 100 записей
        if (this.stats.total_starts % 100 === 0) {
            this.saveStatsToFile();
        }
    }

    updateStats(step, success) {
        switch (step) {
            case 'start':
                this.stats.total_starts++;
                break;
            case 'captcha_shown':
                this.stats.captcha_shown++;
                break;
            case 'captcha_passed':
                if (success) this.stats.captcha_passed++;
                break;
            case 'subscription_check':
                this.stats.subscription_checked++;
                break;
            case 'subscribed':
                if (success) this.stats.subscribed++;
                break;
            case 'menu_shown':
                if (success) this.stats.menu_shown++;
                break;
            case 'error':
                this.stats.errors++;
                break;
        }
    }

    getConversionStats() {
        const total = this.stats.total_starts;
        if (total === 0) return {};

        return {
            captcha_conversion: ((this.stats.captcha_passed / this.stats.captcha_shown) * 100).toFixed(1),
            subscription_conversion: ((this.stats.subscribed / this.stats.subscription_checked) * 100).toFixed(1),
            overall_conversion: ((this.stats.menu_shown / total) * 100).toFixed(1),
            total_users: total,
            lost_at_captcha: this.stats.captcha_shown - this.stats.captcha_passed,
            lost_at_subscription: this.stats.subscription_checked - this.stats.subscribed,
            successful_registrations: this.stats.menu_shown
        };
    }

    saveStatsToFile() {
        try {
            const data = {
                timestamp: new Date().toISOString(),
                stats: this.stats,
                conversion: this.getConversionStats()
            };

            const fileName = \`user_analytics_\${new Date().toISOString().split('T')[0]}.json\`;
            fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
            
            console.log(\`💾 Аналитика сохранена в \${fileName}\`);
        } catch (error) {
            console.error('❌ Ошибка сохранения аналитики:', error);
        }
    }

    printDailyReport() {
        console.log('\\n📊 ЕЖЕДНЕВНЫЙ ОТЧЕТ ПОТЕРЬ ПОЛЬЗОВАТЕЛЕЙ:');
        console.log('═══════════════════════════════════════');
        
        const stats = this.getConversionStats();
        
        console.log(\`👥 Всего /start команд: \${stats.total_users}\`);
        console.log(\`🤖 Показано капч: \${this.stats.captcha_shown}\`);
        console.log(\`✅ Прошли капчу: \${this.stats.captcha_passed} (\${stats.captcha_conversion}%)\`);
        console.log(\`📢 Проверили подписку: \${this.stats.subscription_checked}\`);
        console.log(\`✅ Подписались: \${this.stats.subscribed} (\${stats.subscription_conversion}%)\`);
        console.log(\`🏠 Показано меню: \${this.stats.menu_shown}\`);
        console.log(\`❌ Ошибок: \${this.stats.errors}\`);
        console.log('');
        console.log(\`📈 ОБЩАЯ КОНВЕРСИЯ: \${stats.overall_conversion}%\`);
        console.log(\`💔 Потеряно на капче: \${stats.lost_at_captcha} пользователей\`);
        console.log(\`💔 Потеряно на подписке: \${stats.lost_at_subscription} пользователей\`);
        console.log('═══════════════════════════════════════\\n');
    }
}

// Создаем глобальный экземпляр аналитики
const userAnalytics = new UserLossAnalytics();

// Функция для ежедневного отчета (вызывать в cron)
function generateDailyUserReport() {
    userAnalytics.printDailyReport();
    userAnalytics.saveStatsToFile();
    
    // Сброс ежедневных логов (но оставляем общую статистику)
    userAnalytics.dailyLogs.clear();
    
    console.log('📋 Дневной отчет сгенерирован и логи очищены');
}
`;

// Создаем файл с аналитикой
fs.writeFileSync('./user-analytics.js', analyticsCode);

console.log('📊 СИСТЕМА ОТСЛЕЖИВАНИЯ ПОТЕРЬ ПОЛЬЗОВАТЕЛЕЙ\n');

console.log(' Создан файл: user-analytics.js');
console.log('');
console.log('🔧 КАК ИНТЕГРИРОВАТЬ:');
console.log('');
console.log('1. Добавьте в начало index.js:');
console.log('   const userAnalytics = require("./user-analytics");');
console.log('');
console.log('2. Добавьте отслеживание в ключевых местах:');
console.log('');
console.log('   // В начале /start команды');
console.log('   userAnalytics.logStep(userId, "start", true);');
console.log('');
console.log('   // При показе капчи');
console.log('   userAnalytics.logStep(userId, "captcha_shown", true);');
console.log('');
console.log('   // При прохождении капчи');
console.log('   userAnalytics.logStep(userId, "captcha_passed", true);');
console.log('');
console.log('   // При проверке подписки');
console.log('   userAnalytics.logStep(userId, "subscription_check", true);');
console.log('');
console.log('   // При успешной подписке');
console.log('   userAnalytics.logStep(userId, "subscribed", isSubscribed);');
console.log('');
console.log('   // При показе главного меню');
console.log('   userAnalytics.logStep(userId, "menu_shown", true);');
console.log('');
console.log('   // При ошибках');
console.log('   userAnalytics.logStep(userId, "error", false, error.message);');
console.log('');
console.log('3. Добавьте ежедневный отчет в cron (в index.js):');
console.log('');
console.log('   // Ежедневный отчет в 23:59');
console.log('   cron.schedule("59 23 * * *", () => {');
console.log('       generateDailyUserReport();');
console.log('   });');

// Создаем пример интеграции
const integrationExample = `
// ПРИМЕР ИНТЕГРАЦИИ АНАЛИТИКИ В /start КОМАНДУ

bot.onText(/\\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const referralCode = match[1] ? match[1].trim() : null;
    
    // 📊 ОТСЛЕЖИВАНИЕ: Пользователь запустил команду /start
    userAnalytics.logStep(userId, 'start', true);
    
    try {
        let user = await Database.getUser(userId);
        
        if (!user) {
            const referrerId = referralCode ? parseInt(referralCode) : null;
            user = await Database.createUser({
                userId: userId,
                username: msg.from.username,
                firstName: msg.from.first_name,
                languageCode: msg.from.language_code || 'ru',
                isPremium: msg.from.is_premium || false,
                referrerId: referrerId
            });
            
            console.log(\`✅ НОВЫЙ ПОЛЬЗОВАТЕЛЬ СОХРАНЕН: \${userId}\`);
        }

        let captchaPassed = passedCaptcha.get(userId) || user?.captcha_passed || false;

        if (!captchaPassed) {
            // 📊 ОТСЛЕЖИВАНИЕ: Показываем капчу
            userAnalytics.logStep(userId, 'captcha_shown', true);
            
            await showCaptcha(chatId, userId);
            userStates.set(userId, 'waiting_after_captcha');
            return;
        }

        // 📊 ОТСЛЕЖИВАНИЕ: Капча уже пройдена
        userAnalytics.logStep(userId, 'captcha_passed', true, 'already_passed');

        // Проверяем подписку
        // 📊 ОТСЛЕЖИВАНИЕ: Проверяем подписку
        userAnalytics.logStep(userId, 'subscription_check', true);
        
        const subscriptionStatus = await checkUserSubscription(userId, chatId, ...);
        
        // 📊 ОТСЛЕЖИВАНИЕ: Результат проверки подписки
        userAnalytics.logStep(userId, 'subscribed', subscriptionStatus.isSubscribed);

        if (!subscriptionStatus.isSubscribed) {
            // Показываем каналы для подписки
            if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                await sendSponsorMessage(chatId, userId, subscriptionStatus.subscriptionData);
            }
            return;
        }

        // 📊 ОТСЛЕЖИВАНИЕ: Показываем главное меню (успешная регистрация!)
        userAnalytics.logStep(userId, 'menu_shown', true);
        
        await showMainMenu(chatId, userId);
        
    } catch (error) {
        // 📊 ОТСЛЕЖИВАНИЕ: Ошибка регистрации
        userAnalytics.logStep(userId, 'error', false, error.message);
        
        console.error('❌ Ошибка в /start:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// В обработчике капчи:
async function handleCaptcha(chatId, userId, data, messageId, callbackQueryId) {
    const choice = parseInt(data.split('_')[1]);

    if (choice === 6) { // Правильный ответ
        // 📊 ОТСЛЕЖИВАНИЕ: Капча пройдена успешно
        userAnalytics.logStep(userId, 'captcha_passed', true);
        
        passedCaptcha.set(userId, true);
        await Database.setCaptchaPassed(userId, true);
        
        // Продолжаем регистрацию...
        
    } else {
        // 📊 ОТСЛЕЖИВАНИЕ: Неправильный ответ капчи
        userAnalytics.logStep(userId, 'captcha_passed', false, 'wrong_answer');
        
        // Показываем капчу заново...
    }
}
`;

fs.writeFileSync('./integration-example.js', integrationExample);

console.log('📁 Создан файл: integration-example.js (примеры интеграции)');
console.log('');
console.log('🎯 РЕЗУЛЬТАТ:');
console.log('• Будете видеть где именно теряются пользователи');
console.log('• Получать ежедневные отчеты конверсии');
console.log('• Сможете оптимизировать каждый этап регистрации');
console.log('• Никого больше не потеряете!');
