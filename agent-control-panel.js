#!/usr/bin/env node
/**
 * Интерактивная панель управления агентом
 * Позволяет изменять настройки через командную строку
 */

const readline = require('readline');
const fs = require('fs');
const { execSync } = require('child_process');
const starsAgent = require('./agent-integration');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

class AgentControlPanel {
    constructor() {
        this.currentSettings = {};
    }

    async loadCurrentSettings() {
        console.log('📊 Загрузка текущих настроек...\n');
        
        try {
            // Загружаем настройки из базы данных агента
            const stats = await starsAgent.getAgentStats();
            if (stats.success) {
                this.currentSettings = stats.stats.security_config || {};
            }

            // Дополняем настройки из кода
            this.currentSettings = {
                max_stars_per_day: 80,
                max_stars_per_hour: 10,
                test_max_amount: 25,
                work_hours_start: 0,
                work_hours_end: 23,
                min_delay: 60,
                max_delay: 180,
                test_mode: true,
                ...this.currentSettings
            };

            console.log('✅ Текущие настройки загружены:');
            this.displaySettings();
            
        } catch (error) {
            console.log('❌ Ошибка загрузки настроек:', error.message);
            console.log('🔧 Используются настройки по умолчанию\n');
        }
    }

    displaySettings() {
        console.log('┌─────────────────────────────���───────────┐');
        console.log('│            ТЕКУЩИЕ НАСТРОЙКИ            │');
        console.log('├─────────────────────────────────────────┤');
        console.log(`│ 📅 Лимит в день:      ${this.currentSettings.max_stars_per_day} звёзд        │`);
        console.log(`│ ⏰ Лимит в час:       ${this.currentSettings.max_stars_per_hour} звёзд         │`);
        console.log(`│ ⭐ Макс за раз:       ${this.currentSettings.test_max_amount} звёзд        │`);
        console.log(`│ 🌅 Начало работы:     ${String(this.currentSettings.work_hours_start).padStart(2, '0')}:00 МСК      │`);
        console.log(`│ 🌙 Конец работы:      ${String(this.currentSettings.work_hours_end).padStart(2, '0')}:00 МСК      │`);
        console.log(`│ ⏱️  Мин задержка:      ${this.currentSettings.min_delay} сек         │`);
        console.log(`│ ⏱️  Макс задержка:     ${this.currentSettings.max_delay} сек        │`);
        console.log(`│ 🧪 Тест режим:        ${this.currentSettings.test_mode ? 'ВКЛ' : 'ВЫКЛ'}         │`);
        console.log('└─────────────────────────────────────────┘\n');
    }

    async showMainMenu() {
        console.log('🎛️ ПАНЕЛЬ УПРАВЛЕНИЯ АГЕНТОМ\n');
        console.log('Выберите действие:');
        console.log('1. 📊 Показать статистику агента');
        console.log('2. ⚙️ Изменить лимиты');
        console.log('3. 🕐 Изменить рабочие часы');
        console.log('4. ⏱️ Изменить задержки');
        console.log('5. 🧪 Переключить тест-режим');
        console.log('6. 🔄 Перезапустить агента');
        console.log('7. 📝 Показать логи агента');
        console.log('8. 🧪 Тест отправки');
        console.log('9. 💾 Сохранить настройки');
        console.log('0. 🚪 Выход\n');

        return new Promise(resolve => {
            rl.question('Введите номер действия: ', resolve);
        });
    }

    async showAgentStats() {
        console.log('\n📊 СТАТИСТИКА АГЕНТА:\n');
        
        const stats = await starsAgent.getAgentStats();
        if (stats.success) {
            const s = stats.stats;
            console.log(`📋 В очереди: ${s.queue_pending} заявок`);
            console.log(`✅ Выполнено: ${s.queue_completed} заявок`);
            console.log(`❌ Ошибок: ${s.queue_failed} заявок`);
            console.log(`⭐ Отправлено сегодня: ${s.stars_sent_today}/${this.currentSettings.max_stars_per_day} звёзд`);
            console.log(`🔧 Ошибок сегодня: ${s.errors_today}`);
        } else {
            console.log('❌ Не удалось получить статистику');
        }

        const health = await starsAgent.checkAgentHealth();
        console.log(`🤖 Статус агента: ${health.health_status}`);
        console.log(`🔄 Запущен: ${health.agent_running ? '✅ ДА' : '❌ НЕТ'}`);
        
        console.log('\nНажмите Enter для продолжения...');
        return new Promise(resolve => rl.question('', resolve));
    }

    async changeLimits() {
        console.log('\n⚙️ ИЗМЕНЕНИЕ ЛИМИТОВ:\n');
        
        const newDayLimit = await this.askNumber(
            `Лимит звёзд в день (текущий: ${this.currentSettings.max_stars_per_day}): `,
            this.currentSettings.max_stars_per_day,
            1, 100
        );

        const newHourLimit = await this.askNumber(
            `Лимит звёзд в час (текущий: ${this.currentSettings.max_stars_per_hour}): `,
            this.currentSettings.max_stars_per_hour,
            1, 20
        );

        const newMaxAmount = await this.askNumber(
            `Максимум звёзд за раз (текущий: ${this.currentSettings.test_max_amount}): `,
            this.currentSettings.test_max_amount,
            1, 500
        );

        this.currentSettings.max_stars_per_day = newDayLimit;
        this.currentSettings.max_stars_per_hour = newHourLimit;
        this.currentSettings.test_max_amount = newMaxAmount;

        console.log('\n✅ Лимиты обновлены!');
        this.displaySettings();
    }

    async changeWorkingHours() {
        console.log('\n🕐 ИЗМЕНЕНИЕ РАБОЧИХ ЧАСОВ:\n');
        
        const startHour = await this.askNumber(
            `Начало работы, час (текущий: ${this.currentSettings.work_hours_start}): `,
            this.currentSettings.work_hours_start,
            0, 23
        );

        const endHour = await this.askNumber(
            `Конец работы, час (текущий: ${this.currentSettings.work_hours_end}): `,
            this.currentSettings.work_hours_end,
            startHour, 23
        );

        this.currentSettings.work_hours_start = startHour;
        this.currentSettings.work_hours_end = endHour;

        console.log('\n✅ Рабочие часы обновлены!');
        this.displaySettings();
    }

    async changeDelays() {
        console.log('\n⏱️ ИЗМЕНЕНИЕ ЗАДЕРЖЕК:\n');
        
        const minDelay = await this.askNumber(
            `Минимальная задержка, сек (текущая: ${this.currentSettings.min_delay}): `,
            this.currentSettings.min_delay,
            10, 300
        );

        const maxDelay = await this.askNumber(
            `Максимальная задержка, сек (текущая: ${this.currentSettings.max_delay}): `,
            this.currentSettings.max_delay,
            minDelay, 600
        );

        this.currentSettings.min_delay = minDelay;
        this.currentSettings.max_delay = maxDelay;

        console.log('\n✅ Задержки обновлены!');
        this.displaySettings();
    }

    async toggleTestMode() {
        console.log('\n🧪 ПЕРЕКЛЮЧЕНИЕ ТЕСТ-РЕЖИМА:\n');
        
        const current = this.currentSettings.test_mode ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН';
        console.log(`Текущий статус: ${current}`);
        
        const answer = await this.askYesNo('Переключить тест-режим? (y/n): ');
        
        if (answer) {
            this.currentSettings.test_mode = !this.currentSettings.test_mode;
            console.log(`\n✅ Тест-режим ${this.currentSettings.test_mode ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}!`);
            
            if (this.currentSettings.test_mode) {
                console.log('⚠️ В тест-режиме максимальная сумма ограничена настройкой "Макс за раз"');
            } else {
                console.log('🚀 Тест-режим отключен - все лимиты сняты (кроме безопасных)');
            }
        }
    }

    async askNumber(question, defaultValue, min, max) {
        return new Promise(resolve => {
            rl.question(question, (answer) => {
                const num = parseInt(answer.trim());
                if (isNaN(num) || num < min || num > max) {
                    console.log(`⚠️ Введите число от ${min} до ${max}`);
                    resolve(defaultValue);
                } else {
                    resolve(num || defaultValue);
                }
            });
        });
    }

    async askYesNo(question) {
        return new Promise(resolve => {
            rl.question(question, (answer) => {
                const response = answer.trim().toLowerCase();
                resolve(response === 'y' || response === 'yes' || response === 'да');
            });
        });
    }

    async saveSettings() {
        console.log('\n💾 СОХРАНЕНИЕ НАСТРОЕК...\n');
        
        try {
            // Здесь можно добавить код для сохранения настроек в базу данных
            // Пока просто показываем что нужно сделать
            
            console.log('📝 Для применения настроек выполните:');
            console.log('1. Обновите код с новыми настройками');
            console.log('2. git add . && git commit -m "Update agent settings"');
            console.log('3. git push origin main');
            console.log('4. Подождите перезапуска Railway\n');
            
            console.log('🔧 Или используйте команду /agent_limits в боте для быстрого изменения базовых лимитов');
            
        } catch (error) {
            console.log('❌ Ошибка сохранения:', error.message);
        }
    }

    async testSending() {
        console.log('\n🧪 ТЕСТ ОТПРАВКИ:\n');
        
        const testUserId = 999999999;
        const testAmount = 1;
        
        console.log(`Тестируем отправку ${testAmount} звёзд пользователю ${testUserId}...`);
        
        try {
            const result = await starsAgent.sendStarsSafely(testUserId, testAmount, 'test');
            
            if (result.success) {
                console.log('✅ Тест успешен!');
                console.log(`💬 ${result.message}`);
            } else {
                console.log('❌ Тест не прошёл:', result.error);
            }
        } catch (error) {
            console.log('❌ Ошибка теста:', error.message);
        }
        
        console.log('\nНажмите Enter для продолжения...');
        return new Promise(resolve => rl.question('', resolve));
    }

    async run() {
        console.log('🎛️ ПАНЕЛЬ УПРАВЛЕНИЯ АГЕНТОМ');
        console.log('========================================\n');
        
        await this.loadCurrentSettings();
        
        while (true) {
            const choice = await this.showMainMenu();
            
            switch (choice) {
                case '1':
                    await this.showAgentStats();
                    break;
                case '2':
                    await this.changeLimits();
                    break;
                case '3':
                    await this.changeWorkingHours();
                    break;
                case '4':
                    await this.changeDelays();
                    break;
                case '5':
                    await this.toggleTestMode();
                    break;
                case '6':
                    console.log('\n🔄 Для перезапуска выполните: git push origin main');
                    break;
                case '7':
                    const logs = await starsAgent.getAgentLogs(10);
                    if (logs.success) {
                        console.log('\n📝 ПОСЛЕДНИЕ ЛОГИ:\n');
                        console.log(logs.logs);
                    }
                    console.log('\nНажмите Enter для продолжения...');
                    await new Promise(resolve => rl.question('', resolve));
                    break;
                case '8':
                    await this.testSending();
                    break;
                case '9':
                    await this.saveSettings();
                    break;
                case '0':
                    console.log('\n👋 До свидания!');
                    rl.close();
                    return;
                default:
                    console.log('\n❌ Неверный выбор, попробуйте снова\n');
            }
        }
    }
}

if (require.main === module) {
    const panel = new AgentControlPanel();
    panel.run().catch(console.error);
}

module.exports = { AgentControlPanel };
