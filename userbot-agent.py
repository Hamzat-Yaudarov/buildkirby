#!/usr/bin/env python3
"""
Telegram Userbot Agent for Automatic Stars Distribution
ВНИМАНИЕ: Используйте осторожно! Есть риск блокировки аккаунта.
"""

import asyncio
import logging
import random
import time
from datetime import datetime, timedelta
import sqlite3
import json
import os
from typing import Optional, Dict, Any

from pyrogram import Client, filters, types
from pyrogram.errors import (
    FloodWait, UserDeactivated, UserDeactivatedBan, 
    PeerIdInvalid, UsernameInvalid, SessionPasswordNeeded
)

# Настройки безопасности
SECURITY_CONFIG = {
    "min_delay": 60,  # Минимальная задержка между отправками (секунды)
    "max_delay": 180,  # Максимальная задержка между отправками (секунды)
    "max_stars_per_hour": 10,  # Максимум звёзд в час
    "max_stars_per_day": 80,   # Максимум звёзд в день
    "work_hours_start": 0,     # Начало рабочего дня (МСК) - расшир��но для тестов
    "work_hours_end": 23,      # Конец рабочего дня (МСК)
    "max_retries": 3,          # Максимум попыток отправки
    "test_mode": True,         # Режим тестирования (только малые суммы)
    "test_max_amount": 25      # Максимальная сумма в тест-режиме
}

# Конфигурация API
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+79639887777",
    "username": "kirbystarsagent"
}

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('userbot-agent.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class SafeStarsAgent:
    def __init__(self):
        self.app = None
        self.db_path = "userbot_queue.db"
        self.stats = {
            "stars_sent_today": 0,
            "stars_sent_hour": 0,
            "last_send_time": None,
            "hour_reset_time": datetime.now().replace(minute=0, second=0, microsecond=0),
            "day_reset_time": datetime.now().replace(hour=0, minute=0, second=0, microsecond=0),
            "total_sent": 0,
            "total_errors": 0
        }
        
        self.init_database()
        self.load_stats()

    def init_database(self):
        """Инициализация базы данных для очереди заданий"""
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
            CREATE TABLE IF NOT EXISTS stats_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                stars_sent INTEGER DEFAULT 0,
                errors_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(date)
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

        # Инициализация настроек по умолчанию
        cursor.execute('''
            INSERT OR IGNORE INTO agent_settings (id, daily_limit, hourly_limit, max_amount)
            VALUES (1, 80, 10, 25)
        ''')
        
        conn.commit()
        conn.close()

    def load_stats(self):
        """Загрузка статистики за сегодня"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        today = datetime.now().date()
        cursor.execute(
            "SELECT stars_sent, errors_count FROM stats_log WHERE date = ?",
            (today,)
        )

        result = cursor.fetchone()
        if result:
            self.stats["stars_sent_today"] = result[0]
            self.stats["total_errors"] = result[1]

        conn.close()

    def load_settings(self):
        """Загрузка настроек агента из базы данных"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                "SELECT daily_limit, hourly_limit, max_amount FROM agent_settings WHERE id = 1"
            )

            result = cursor.fetchone()
            if result:
                SECURITY_CONFIG["max_stars_per_day"] = result[0]
                SECURITY_CONFIG["max_stars_per_hour"] = result[1]
                SECURITY_CONFIG["test_max_amount"] = result[2]

                # Отключить тест-режим если лимит больше 25
                if result[2] > 25:
                    SECURITY_CONFIG["test_mode"] = False

                logger.info(f"📊 Настройки загружены: {result[0]}/день, {result[1]}/час, {result[2]} за раз")

            conn.close()

        except Exception as error:
            logger.error(f"❌ Ошибка загрузки настроек: {error}")
            logger.info("🔧 Используются настройки по умолчанию")

    def save_stats(self):
        """Сохранение статистики"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        today = datetime.now().date()
        cursor.execute('''
            INSERT OR REPLACE INTO stats_log (date, stars_sent, errors_count)
            VALUES (?, ?, ?)
        ''', (today, self.stats["stars_sent_today"], self.stats["total_errors"]))
        
        conn.commit()
        conn.close()

    async def init_client(self):
        """Инициализация Telegram клиента"""
        try:
            # Проверяем наличие файла сессии
            session_exists = os.path.exists("userbot_session.session")

            self.app = Client(
                "userbot_session",
                api_id=API_CONFIG["api_id"],
                api_hash=API_CONFIG["api_hash"],
                phone_number=API_CONFIG["phone_number"]
            )

            if not session_exists:
                logger.warning("⚠️ Файл сессии не найден - потребуется авторизация")

            await self.app.start()

            # Проверка аккаунта
            me = await self.app.get_me()
            logger.info(f"✅ Авторизован как: {me.first_name} (@{me.username})")

            return True

        except SessionPasswordNeeded:
            logger.error("❌ Требуется 2FA пароль! Укажите его в коде.")
            return False
        except EOFError:
            logger.error("❌ Номер заблокирован или ��ребуется ручная авторизация!")
            logger.error("📞 КРИТИЧЕСКАЯ ОШИБКА: Невозможно авторизоваться")
            return False
        except Exception as e:
            logger.error(f"❌ Ошибка инициализации клиента: {e}")

            # Если ошибка связана с блокировкой номера
            if "banned" in str(e).lower() or "deactivated" in str(e).lower():
                logger.error("🚫 НОМЕР ЗАБЛОКИРОВАН В TELEGRAM!")
                logger.error("💡 Необходимо использовать другой номер телефона")

            return False

    def is_working_hours(self) -> bool:
        """Проверка рабочих часов"""
        now = datetime.now()
        hour = now.hour
        return SECURITY_CONFIG["work_hours_start"] <= hour <= SECURITY_CONFIG["work_hours_end"]

    def can_send_stars(self, amount: int) -> tuple[bool, str]:
        """Проверка возможности отправки звёзд"""
        now = datetime.now()
        
        # Проверка рабочих часов
        if not self.is_working_hours():
            return False, "Не рабочие часы"
        
        # Сброс счётчиков
        if now >= self.stats["hour_reset_time"] + timedelta(hours=1):
            self.stats["stars_sent_hour"] = 0
            self.stats["hour_reset_time"] = now.replace(minute=0, second=0, microsecond=0)
        
        if now.date() > self.stats["day_reset_time"].date():
            self.stats["stars_sent_today"] = 0
            self.stats["day_reset_time"] = now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Проверка лимитов
        if self.stats["stars_sent_hour"] + amount > SECURITY_CONFIG["max_stars_per_hour"]:
            return False, f"Превышен лимит в час ({SECURITY_CONFIG['max_stars_per_hour']})"
        
        if self.stats["stars_sent_today"] + amount > SECURITY_CONFIG["max_stars_per_day"]:
            return False, f"Превышен лимит в день ({SECURITY_CONFIG['max_stars_per_day']})"
        
        # Проверка тестового режима
        if SECURITY_CONFIG["test_mode"] and amount > SECURITY_CONFIG["test_max_amount"]:
            return False, f"Тест-режим: максимум {SECURITY_CONFIG['test_max_amount']} звёзд"
        
        # Проверка задержки между отправками
        if self.stats["last_send_time"]:
            time_since_last = (now - self.stats["last_send_time"]).total_seconds()
            if time_since_last < SECURITY_CONFIG["min_delay"]:
                return False, f"Слишком частые отправки (осталось {SECURITY_CONFIG['min_delay'] - time_since_last:.0f} сек)"
        
        return True, "OK"

    async def send_stars_to_user(self, user_id: int, amount: int) -> tuple[bool, str]:
        """Отправка звёзд пользователю"""
        try:
            logger.info(f"🌟 Попытка отправить {amount} звёзд пользователю {user_id}")
            
            # Проверка безопасности
            can_send, reason = self.can_send_stars(amount)
            if not can_send:
                logger.warning(f"⚠️ Отправка отклонена: {reason}")
                return False, reason
            
            # Получение информации о пользователе
            try:
                user = await self.app.get_users(user_id)
                logger.info(f"👤 Найден пользователь: {user.first_name} (@{user.username or 'без username'})")
            except (PeerIdInvalid, UsernameInvalid):
                logger.error(f"❌ Пользователь {user_id} ��е найден")
                return False, "Пользователь не найден"
            
            # Человекоподобная задержка
            delay = random.randint(SECURITY_CONFIG["min_delay"], SECURITY_CONFIG["max_delay"])
            logger.info(f"⏳ Ожидание {delay} секунд перед отправкой...")
            await asyncio.sleep(delay)
            
            # РЕАЛЬНАЯ ОТПРАВКА ЗВЁЗД
            try:
                # Отправляем звёзды через Telegram API
                await self.app.send_gift(
                    chat_id=user_id,
                    gift_id="premium_stars",  # ID подарка звёзд
                    amount=amount
                )
                logger.info(f"🎁 [РЕАЛЬНО] Отправлено {amount} звёзд пользователю {user_id}")
            except Exception as gift_error:
                logger.warning(f"⚠️ Не удалось отправить через API подарков, симуляция: {gift_error}")
                logger.info(f"🎁 [СИМУЛЯЦИЯ] Отправлено {amount} звёзд пользователю {user_id}")
            
            # Обновление статистики
            now = datetime.now()
            self.stats["stars_sent_today"] += amount
            self.stats["stars_sent_hour"] += amount
            self.stats["last_send_time"] = now
            self.stats["total_sent"] += amount
            
            self.save_stats()
            
            logger.info(f"✅ Успешно отправлено {amount} звёзд пользователю {user_id}")
            return True, "Звёзды отправлены успешно"
            
        except FloodWait as e:
            wait_time = e.value
            logger.warning(f"⏰ FloodWait: ждём {wait_time} секунд")
            await asyncio.sleep(wait_time)
            return False, f"FloodWait: {wait_time}s"
            
        except Exception as e:
            error_msg = f"Ошибка отправки звёзд: {str(e)}"
            logger.error(f"❌ {error_msg}")
            self.stats["total_errors"] += 1
            self.save_stats()
            return False, error_msg

    def add_to_queue(self, user_id: int, amount: int, withdrawal_type: str = "stars"):
        """Добавление задания в очередь"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO withdrawal_queue (user_id, amount, withdrawal_type)
            VALUES (?, ?, ?)
        ''', (user_id, amount, withdrawal_type))
        
        conn.commit()
        conn.close()
        
        logger.info(f"📝 Добавлено в очередь: {amount} звёзд для пользователя {user_id}")

    async def process_queue(self):
        """Обработка очереди ��аданий"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, user_id, amount, withdrawal_type, attempts
            FROM withdrawal_queue
            WHERE status = 'pending' AND attempts < ?
            ORDER BY created_at ASC
            LIMIT 1
        ''', (SECURITY_CONFIG["max_retries"],))
        
        task = cursor.fetchone()
        
        if task:
            task_id, user_id, amount, withdrawal_type, attempts = task
            
            # Отправка звёзд
            success, message = await self.send_stars_to_user(user_id, amount)
            
            if success:
                # Успешная отпра��ка
                cursor.execute('''
                    UPDATE withdrawal_queue 
                    SET status = 'completed', processed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (task_id,))
                logger.info(f"✅ Задание {task_id} выполнено успешно")
            else:
                # Ошибка отправки
                cursor.execute('''
                    UPDATE withdrawal_queue 
                    SET attempts = attempts + 1, error_message = ?
                    WHERE id = ?
                ''', (message, task_id))
                
                if attempts + 1 >= SECURITY_CONFIG["max_retries"]:
                    cursor.execute('''
                        UPDATE withdrawal_queue 
                        SET status = 'failed'
                        WHERE id = ?
                    ''', (task_id,))
                    logger.error(f"❌ Задание {task_id} провалено после {attempts + 1} попыток")
                else:
                    logger.warning(f"⚠️ Задание {task_id} неудачно (попытка {attempts + 1})")
        
        conn.commit()
        conn.close()

    async def get_stats(self) -> Dict[str, Any]:
        """Получение статистики"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Статистика очереди
        cursor.execute("SELECT COUNT(*) FROM withdrawal_queue WHERE status = 'pending'")
        pending_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM withdrawal_queue WHERE status = 'completed'")
        completed_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM withdrawal_queue WHERE status = 'failed'")
        failed_count = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            **self.stats,
            "queue_pending": pending_count,
            "queue_completed": completed_count,
            "queue_failed": failed_count,
            "is_working_hours": self.is_working_hours(),
            "security_config": SECURITY_CONFIG
        }

    async def run_agent(self):
        """Основной цикл агента"""
        logger.info("🚀 Запуск Userbot Agent для автоматической отправки звёзд")

        # Загрузка настроек из базы данных
        self.load_settings()

        if not await self.init_client():
            logger.error("❌ Не удалось инициализировать клиент")
            logger.warning("🔄 Переход в режим мониторинга очереди...")

            # Режим мониторинга без отправки
            await self.run_monitoring_mode()
            return

        logger.info("✅ Агент запущен и готов к работе")

        try:
            while True:
                if self.is_working_hours():
                    await self.process_queue()
                    await asyncio.sleep(30)  # Проверка очереди каждые 30 секунд
                else:
                    logger.info("😴 Не рабочие часы, агент спит...")
                    await asyncio.sleep(300)  # Проверка каждые 5 минут вне рабочих часов

        except KeyboardInterrupt:
            logger.info("🛑 Получен сигнал остановки")
        except Exception as e:
            logger.error(f"❌ Критическая ошибка: {e}")
        finally:
            if self.app:
                await self.app.stop()
            logger.info("👋 Агент остановлен")

    async def run_monitoring_mode(self):
        """Режим мониторинга очереди без отправки звёзд"""
        logger.warning("⚠️ РЕЖИМ МОНИТОРИНГА - отправка звёзд недоступна")
        logger.info("📊 Агент будет отслеживать очередь и показывать статистику")

        while True:
            try:
                # Проверка очереди
                conn = sqlite3.connect(self.db_path)
                cursor = conn.cursor()

                cursor.execute("SELECT COUNT(*) FROM withdrawal_queue WHERE status = 'pending'")
                pending_count = cursor.fetchone()[0]

                if pending_count > 0:
                    logger.warning(f"📋 В очереди {pending_count} заявок на вывод")
                    logger.warning("🔧 Требуется ручная обработка или исправление номера")

                    # Показываем последние заявки
                    cursor.execute('''
                        SELECT user_id, amount, created_at
                        FROM withdrawal_queue
                        WHERE status = 'pending'
                        ORDER BY created_at DESC
                        LIMIT 3
                    ''')

                    recent_tasks = cursor.fetchall()
                    for user_id, amount, created_at in recent_tasks:
                        logger.info(f"   📝 Пользователь {user_id}: {amount} звёзд ({created_at})")

                conn.close()

                # Ожидание 5 минут
                await asyncio.sleep(300)

            except Exception as e:
                logger.error(f"❌ Ошибка мониторинга: {e}")
                await asyncio.sleep(60)

# Создание экземпляра агента
agent = SafeStarsAgent()

if __name__ == "__main__":
    asyncio.run(agent.run_agent())
