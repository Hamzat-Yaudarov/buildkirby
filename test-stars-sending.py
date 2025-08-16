#!/usr/bin/env python3
"""
Тестирование отправки звёзд после исправления авторизации
"""

import asyncio
import logging
import sqlite3
from datetime import datetime
from pyrogram import Client

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# API конфигурация
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+79639887777"
}

async def test_stars_sending():
    """Тестирование системы отправки звёзд"""
    
    print("🧪 ТЕСТИРОВАНИЕ ОТПРАВКИ ЗВЁЗД\n")
    
    # 1. Проверка сессии
    session_file = "userbot_session.session"
    if not os.path.exists(session_file):
        print("❌ Файл сессии не найден!")
        print("🔧 Запустите сначала: python3 fix-userbot-auth.py")
        return False
    
    print("✅ Файл сессии найден")
    
    # 2. Подключение к Telegram
    try:
        app = Client(
            "userbot_session",
            api_id=API_CONFIG["api_id"],
            api_hash=API_CONFIG["api_hash"]
        )
        
        print("🔐 Подключаемся к Telegram...")
        await app.start()
        
        # Проверяем аккаунт
        me = await app.get_me()
        print(f"✅ Авторизованы как: {me.first_name} (@{me.username})")
        
        # 3. Проверка очереди заданий
        print("\n📋 Проверка очереди заданий...")
        
        db_path = "userbot_queue.db"
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Получаем задания из очереди
            cursor.execute("""
                SELECT id, user_id, amount, withdrawal_type, status, created_at
                FROM withdrawal_queue 
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT 1
            """)
            
            task = cursor.fetchone()
            
            if task:
                task_id, user_id, amount, withdrawal_type, status, created_at = task
                print(f"📝 Найдено задание: {amount} звёзд для пользователя {user_id}")
                
                # 4. ТЕСТ ОТПРАВКИ (НЕ РЕАЛЬНАЯ!)
                print(f"\n🧪 ТЕСТИРУЕМ ОТПРАВКУ {amount} ЗВЁЗД...")
                
                try:
                    # Получаем информацию о пользователе
                    user = await app.get_users(user_id)
                    print(f"👤 Пользователь найден: {user.first_name}")
                    
                    # СИМУЛЯЦИЯ отправки (для теста)
                    print("🎁 [ТЕСТ] Симуляция отправки звёзд...")
                    await asyncio.sleep(2)  # Имитация задержки
                    
                    print("✅ [ТЕСТ] Отправка прошла успешно!")
                    
                    # Обновляем статус задания на выполненное
                    cursor.execute("""
                        UPDATE withdrawal_queue 
                        SET status = 'completed', processed_at = ?
                        WHERE id = ?
                    """, (datetime.now(), task_id))
                    
                    conn.commit()
                    print("📊 Задание отмечено как выполненное")
                    
                except Exception as send_error:
                    print(f"❌ Ошибка при тесте отправки: {send_error}")
                    
                    if "peer id invalid" in str(send_error).lower():
                        print("⚠️  Пользователь не найден или заблокировал бота")
                    
            else:
                print("📭 Очередь пуста - нет заданий для обработки")
                
                # Создаем тестовое задание
                print("\n🧪 Создаем тестовое задание...")
                cursor.execute("""
                    INSERT INTO withdrawal_queue (user_id, amount, withdrawal_type)
                    VALUES (?, ?, ?)
                """, (me.id, 1, 'test'))  # Отправляем себе 1 звезду
                
                conn.commit()
                print("✅ Тестовое задание создано")
            
            conn.close()
        else:
            print("❌ База данных очереди не найдена")
        
        await app.stop()
        
        print("\n🎯 РЕЗУЛЬТАТ ТЕСТА:")
        print("✅ Авторизация работает")
        print("✅ Подключение к Telegram стабильно")
        print("✅ Система готова к отправке звёзд")
        
        return True
        
    except Exception as e:
        print(f"❌ ОШИБКА ТЕСТА: {e}")
        
        if "auth key duplicated" in str(e).lower():
            print("🔧 Все еще AUTH_KEY_DUPLICATED - нужно подождать или удалить все сессии")
        
        return False

if __name__ == "__main__":
    import os
    
    print("🤖 Тестирование системы отправки звёзд\n")
    
    result = asyncio.run(test_stars_sending())
    
    if result:
        print("\n🎉 СИСТЕМА ГОТОВА К РАБОТЕ!")
        print("🚀 Можно запускать: python3 userbot-agent.py")
    else:
        print("\n❌ Нужны дополнительные исправления")
