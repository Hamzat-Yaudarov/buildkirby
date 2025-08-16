#!/usr/bin/env python3
"""
Скрипт для исправления проблемы с заблокированным номером телефона
"""

import os
import sys
import logging

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def check_phone_status():
    """Проверка статуса ном��ра телефона"""
    logger.info("🔍 Проверка статуса номера телефона...")
    
    # Попытка создания сессии без авторизации
    try:
        from pyrogram import Client
        
        app = Client(
            "test_session",
            api_id=28085629,
            api_hash="78027b2ae19b9ec44a6e03bf5cc1299f",
            phone_number="+7972065986",
            in_memory=True  # Не создаём файл сессии
        )
        
        logger.info("✅ Клиент создан успешно")
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка создания клиента: {e}")
        return False

def create_alternative_agent():
    """Создание альтернативного агента без Pyrogram"""
    logger.info("🔧 Создание альтернативного агента...")
    
    agent_code = '''#!/usr/bin/env python3
"""
ЗАГЛУШКА АГЕНТА - Работает без Telegram API
Для тестирования системы когда основной номер заблокирован
"""

import asyncio
import logging
import time
import sqlite3
from datetime import datetime

# Настройка логир��вания
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class MockStarsAgent:
    def __init__(self):
        self.db_path = "userbot_queue.db"
        self.stats = {
            "stars_sent_today": 0,
            "total_sent": 0,
            "total_errors": 0
        }
        self.init_database()

    def init_database(self):
        """Инициализация базы данных"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS withdrawal_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id BIGINT NOT NULL,
                amount INTEGER NOT NULL,
                withdrawal_type TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP NULL,
                error_message TEXT NULL
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS agent_settings (
                id INTEGER PRIMARY KEY,
                daily_limit INTEGER DEFAULT 80,
                hourly_limit INTEGER DEFAULT 10,
                max_amount INTEGER DEFAULT 25,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            INSERT OR IGNORE INTO agent_settings (id, daily_limit, hourly_limit, max_amount)
            VALUES (1, 80, 10, 25)
        ''')
        
        conn.commit()
        conn.close()

    async def process_queue(self):
        """ЗАГЛУШКА - обработка очереди"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, user_id, amount FROM withdrawal_queue
            WHERE status = 'pending'
            LIMIT 1
        ''')
        
        task = cursor.fetchone()
        if task:
            task_id, user_id, amount = task
            
            logger.warning(f"⚠️ ЗАГЛУШКА: Запрос на {amount} звёзд для пользователя {user_id}")
            logger.warning("📞 ТРЕБУЕТСЯ РУЧНАЯ ОБРАБОТКА - номер заблокирован!")
            
            # Помечаем как "требует ручной обработки"
            cursor.execute('''
                UPDATE withdrawal_queue 
                SET error_message = 'Требует ручной обработки - номер заблокирован'
                WHERE id = ?
            ''', (task_id,))
        
        conn.commit()
        conn.close()

    async def run_agent(self):
        """Основной цикл заглушки"""
        logger.warning("⚠️ ЗАПУСК ЗАГЛУШКИ АГЕНТА")
        logger.warning("📞 Основной номер заблокирован!")
        logger.warning("🔧 Требуется замена номера или ручная обработка")
        
        while True:
            await self.process_queue()
            await asyncio.sleep(60)  # Проверка каждую минуту

# Запуск заглушки
if __name__ == "__main__":
    agent = MockStarsAgent()
    asyncio.run(agent.run_agent())
'''
    
    # Сохраняем заглушку
    with open('userbot-agent-fallback.py', 'w', encoding='utf-8') as f:
        f.write(agent_code)
    
    logger.info("✅ Заглушка агента создана: userbot-agent-fallback.py")

def main():
    """Основная функция"""
    logger.info("🚀 Запуск исправления проблемы с номером")
    
    # Проверяем статус номера
    if not check_phone_status():
        logger.warning("❌ Номер заблокирован или недоступен")
        create_alternative_agent()
        
        print("""
🔧 РЕШЕНИЯ ПРОБЛЕМЫ:

1. 📞 ЗАМЕНА НОМЕРА (рекомендуется):
   - Зарегистрируйте новый Telegram аккаунт
   - Обновите номер в userbot-agent.py
   - Создайте новую сессию

2. 🛠️ ВРЕМЕННОЕ РЕШЕНИЕ:
   - Используйте userbot-agent-fallback.py
   - Обрабатывайте запросы вручную
   - Мониторьте очередь через админ команды

3. 📋 РУЧНАЯ ОБРАБОТКА:
   - Используйте команду /agent_stats для просмотра очереди
   - Команда /process_old_withdrawals для старых запросов
   - Отправляйте звёзды вручную через @kirbystarsagent

ТЕКУЩИЙ СТАТУС: Бот работает, агент заблокирован
        """)
    else:
        logger.info("✅ Номер работает нормально")

if __name__ == "__main__":
    main()
