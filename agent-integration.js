const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Интеграция с Userbot Agent для автоматической отправки звёзд
 * 
 * ВНИМАНИЕ: 
 * - Система работает с максимальными предосторожностями
 * - Включён тест-режим (максимум 25 звёзд за раз)
 * - Лимиты: 10 звёзд/час, 80 звёзд/день
 * - Работа то��ько в 9:00-23:00 МСК
 */

class StarsAgentIntegration {
    constructor() {
        this.agentProcess = null;
        this.isAgentRunning = false;
        this.agentDbPath = 'userbot_queue.db';
        this.agentLogPath = 'userbot-agent.log';
    }

    /**
     * Запуск агента (если не запущен)
     */
    async startAgent() {
        if (this.isAgentRunning) {
            console.log('🤖 Агент уже работает');
            return true;
        }

        try {
            console.log('🚀 Запуск Userbot Agent...');
            
            this.agentProcess = spawn('python3', ['userbot-agent.py'], {
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.agentProcess.stdout.on('data', (data) => {
                console.log(`[AGENT] ${data.toString().trim()}`);
            });

            this.agentProcess.stderr.on('data', (data) => {
                console.error(`[AGENT ERROR] ${data.toString().trim()}`);
            });

            this.agentProcess.on('close', (code) => {
                console.log(`🛑 Агент остановлен с кодом ${code}`);
                this.isAgentRunning = false;
                this.agentProcess = null;
            });

            this.agentProcess.on('error', (error) => {
                console.error('❌ Ошибка запуска агента:', error);
                this.isAgentRunning = false;
            });

            this.isAgentRunning = true;
            console.log('✅ Userbot Agent запущен');
            return true;

        } catch (error) {
            console.error('❌ Ошибка запуска агента:', error);
            return false;
        }
    }

    /**
     * Остановка агента
     */
    async stopAgent() {
        if (this.agentProcess) {
            console.log('🛑 Остановка Userbot Agent...');
            this.agentProcess.kill('SIGTERM');
            
            setTimeout(() => {
                if (this.agentProcess) {
                    this.agentProcess.kill('SIGKILL');
                }
            }, 5000);

            this.isAgentRunning = false;
        }
    }

    /**
     * Добавление задания на отправку звёзд в очередь агента
     */
    async addStarsJob(userId, amount, withdrawalType = 'stars') {
        try {
            // Валидация входных данных
            if (!userId || !amount || amount <= 0) {
                throw new Error('Неверные параметры для отправки звёзд');
            }

            // Проверка безопасных лимитов
            if (amount > 200) {
                console.warn(`⚠️ Большая сумма: максимум 200 звёзд за раз, запрошено ${amount}`);
                throw new Error(`Сумма ${amount} превышает безопасный лимит (200 звёзд)`);
            }

            console.log(`📝 Добавление в очередь агента: ${amount} звёзд для пользователя ${userId}`);

            // Добавление в очередь через Python агент
            const { execSync } = require('child_process');
            const command = `python3 -c "
import sqlite3
import sys

conn = sqlite3.connect('${this.agentDbPath}')
cursor = conn.cursor()

cursor.execute('''
    INSERT INTO withdrawal_queue (user_id, amount, withdrawal_type)
    VALUES (?, ?, ?)
''', (${userId}, ${amount}, '${withdrawalType}'))

conn.commit()
conn.close()
print('✅ Задание добавлено в очередь агента')
"`;

            execSync(command);
            
            console.log(`✅ Задание добавлено: ${amount} звёзд для пользователя ${userId}`);
            return true;

        } catch (error) {
            console.error('❌ Ошибка добавления задания в очередь агента:', error);
            return false;
        }
    }

    /**
     * Получение статистики агента
     */
    async getAgentStats() {
        try {
            const { execSync } = require('child_process');
            const command = `python3 -c "
import sqlite3
import json
from datetime import datetime

conn = sqlite3.connect('${this.agentDbPath}')
cursor = conn.cursor()

# Статистика очереди
cursor.execute('SELECT COUNT(*) FROM withdrawal_queue WHERE status = ?', ('pending',))
pending = cursor.fetchone()[0]

cursor.execute('SELECT COUNT(*) FROM withdrawal_queue WHERE status = ?', ('completed',))
completed = cursor.fetchone()[0]

cursor.execute('SELECT COUNT(*) FROM withdrawal_queue WHERE status = ?', ('failed',))
failed = cursor.fetchone()[0]

# Статистика за сегодня
today = datetime.now().date()
cursor.execute('SELECT stars_sent, errors_count FROM stats_log WHERE date = ?', (today,))
result = cursor.fetchone()

stats = {
    'queue_pending': pending,
    'queue_completed': completed,
    'queue_failed': failed,
    'stars_sent_today': result[0] if result else 0,
    'errors_today': result[1] if result else 0,
    'agent_running': True,
    'current_time': datetime.now().isoformat()
}

conn.close()
print(json.dumps(stats))
"`;

            const output = execSync(command, { encoding: 'utf8' });
            const stats = JSON.parse(output.trim());
            
            return {
                success: true,
                stats: {
                    ...stats,
                    agent_running: this.isAgentRunning
                }
            };

        } catch (error) {
            console.error('❌ Ошибка получения статистики агента:', error);
            return {
                success: false,
                error: error.message,
                stats: {
                    agent_running: this.isAgentRunning,
                    queue_pending: 0,
                    queue_completed: 0,
                    queue_failed: 0,
                    stars_sent_today: 0,
                    errors_today: 0
                }
            };
        }
    }

    /**
     * Получение логов агента
     */
    async getAgentLogs(lines = 50) {
        try {
            if (!fs.existsSync(this.agentLogPath)) {
                return { success: false, logs: 'Лог файл не найден' };
            }

            const { execSync } = require('child_process');
            const logs = execSync(`tail -n ${lines} ${this.agentLogPath}`, { encoding: 'utf8' });
            
            return { success: true, logs };

        } catch (error) {
            console.error('❌ Ошибка чтения логов агента:', error);
            return { success: false, logs: 'Ошибка чтения логов' };
        }
    }

    /**
     * Проверка состояния агента
     */
    async checkAgentHealth() {
        try {
            const stats = await this.getAgentStats();
            const logs = await this.getAgentLogs(10);
            
            return {
                agent_running: this.isAgentRunning,
                stats_available: stats.success,
                logs_available: logs.success,
                last_activity: new Date().toISOString(),
                health_status: this.isAgentRunning ? 'healthy' : 'stopped'
            };

        } catch (error) {
            return {
                agent_running: false,
                health_status: 'error',
                error: error.message
            };
        }
    }

    /**
     * Безопасная отправка звёзд с проверками
     */
    async sendStarsSafely(userId, amount, withdrawalType = 'stars') {
        try {
            console.log(`🌟 Запрос на отправку ${amount} звёзд пользователю ${userId}`);

            // Проверка состояния агента
            if (!this.isAgentRunning) {
                console.log('🚀 Агент не запущен, пытаемся запустить...');
                const started = await this.startAgent();
                if (!started) {
                    throw new Error('Не удалось запустить агент');
                }
                
                // Ждём инициализации агента
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            // Получение статистики для проверки лимитов
            const statsResult = await this.getAgentStats();
            if (statsResult.success) {
                const { stats } = statsResult;
                
                if (stats.queue_pending > 10) {
                    throw new Error(`Очередь перегружена: ${stats.queue_pending} заданий в ожидании`);
                }
                
                if (stats.stars_sent_today > 60) {
                    throw new Error(`Дневной лимит почти исчерпан: ${stats.stars_sent_today}/80 звёзд`);
                }
            }

            // Доба��ление в очередь
            const success = await this.addStarsJob(userId, amount, withdrawalType);
            if (!success) {
                throw new Error('Не удалось добавить задание в очередь');
            }

            console.log(`✅ Задание на отправку ${amount} звёзд добавлено в очередь агента`);
            return { success: true, message: 'Задание добавлено в очередь автоматической отправки' };

        } catch (error) {
            console.error('❌ Ошибка безопасной отправки звёзд:', error);
            return { success: false, error: error.message };
        }
    }
}

// Создание глобального экземпляра
const starsAgent = new StarsAgentIntegration();

// Автозапуск агента при старте основного бота
(async () => {
    console.log('🤖 Инициализация Stars Agent Integration...');
    
    // Запуск агента через 10 секунд после старта основного бота
    setTimeout(async () => {
        try {
            await starsAgent.startAgent();
        } catch (error) {
            console.error('❌ Ошибка автозапуска агента:', error);
        }
    }, 10000);
})();

module.exports = starsAgent;
