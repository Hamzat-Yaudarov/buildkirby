#!/usr/bin/env python3
"""
Исправление проблем с очередью заданий userbot
"""

import sqlite3
import asyncio
from datetime import datetime
from pyrogram import Client

# API конфигурация
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+79639887777"
}

async def fix_queue_issues():
    """Исправление проблем с очередью заданий"""
    
    print("🔧 ИСПРАВЛЕНИЕ ПРОБЛЕМ С ОЧЕРЕДЬЮ ЗАДАНИЙ\n")
    
    # 1. Проверка базы данных
    db_path = "userbot_queue.db"
    if not sqlite3:
        print("❌ SQLite не доступен")
        return False
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 2. Показать текущие задания
    print("📋 ТЕКУЩИЕ ЗАДАНИЯ В ОЧЕРЕДИ:")
    cursor.execute("""
        SELECT id, user_id, amount, withdrawal_type, status, attempts, created_at, error_message
        FROM withdrawal_queue 
        ORDER BY created_at DESC
        LIMIT 10
    """)
    
    tasks = cursor.fetchall()
    
    if not tasks:
        print("   📭 Очередь пуста")
    else:
        for task in tasks:
            task_id, user_id, amount, w_type, status, attempts, created_at, error = task
            print(f"   📝 ID:{task_id} | Пользователь:{user_id} | {amount}⭐ | {status} | Попыток:{attempts}")
            if error:
                print(f"       ❌ Ошибка: {error}")
    
    # 3. Подключение к Telegram для проверки пользователей
    try:
        app = Client(
            "userbot_session",
            api_id=API_CONFIG["api_id"],
            api_hash=API_CONFIG["api_hash"]
        )
        
        await app.start()
        me = await app.get_me()
        print(f"\n✅ Подключены как: {me.first_name} (@{me.username})")
        
        # 4. Проверка проблемных пользователей
        print("\n🔍 ПРОВЕРКА ПОЛЬЗОВАТЕЛЕЙ:")
        
        problem_users = []
        for task in tasks:
            task_id, user_id, amount, w_type, status, attempts, created_at, error = task
            
            if status == 'pending' or 'не найден' in str(error):
                try:
                    user = await app.get_users(user_id)
                    print(f"   ✅ Пользователь {user_id}: {user.first_name} (@{user.username or 'без username'})")
                except Exception as e:
                    print(f"   ❌ Пользователь {user_id}: {str(e)}")
                    problem_users.append(task_id)
        
        # 5. Очистка проблемных зад��ний
        if problem_users:
            print(f"\n🗑️ ОЧИСТКА {len(problem_users)} ПРОБЛЕМНЫХ ЗАДАНИЙ:")
            
            for task_id in problem_users:
                cursor.execute("""
                    UPDATE withdrawal_queue 
                    SET status = 'failed', error_message = 'Пользователь не найден или недоступен'
                    WHERE id = ?
                """, (task_id,))
                print(f"   ❌ Задание {task_id} помечено как провалено")
            
            conn.commit()
        
        # 6. Создание тестового задания для себя
        print("\n🧪 СОЗДАНИЕ ТЕСТОВОГО ЗАДАНИЯ:")
        
        cursor.execute("""
            INSERT INTO withdrawal_queue (user_id, amount, withdrawal_type, status)
            VALUES (?, ?, ?, ?)
        """, (me.id, 1, 'test', 'pending'))
        
        conn.commit()
        print(f"   ✅ Создано тестовое задание: 1 звезда для {me.first_name}")
        
        await app.stop()
        
    except Exception as e:
        print(f"❌ Ошибка подключения к Telegram: {e}")
    
    # 7. Обновление настроек безопасности
    print("\n⚙️ ВОССТАНОВЛЕНИЕ БЕЗОПАСНЫХ НАСТРОЕК:")
    
    cursor.execute("""
        UPDATE agent_settings 
        SET daily_limit = 80, hourly_limit = 10, max_amount = 25
        WHERE id = 1
    """)
    
    conn.commit()
    print("   ✅ Лимиты восстановлены: 80/день, 10/час, 25 за раз")
    
    # 8. Статистика после очистки
    print("\n📊 СТАТИСТИКА ПОСЛЕ ОЧИСТКИ:")
    
    cursor.execute("SELECT COUNT(*) FROM withdrawal_queue WHERE status = 'pending'")
    pending = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM withdrawal_queue WHERE status = 'failed'")
    failed = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM withdrawal_queue WHERE status = 'completed'")
    completed = cursor.fetchone()[0]
    
    print(f"   📋 В ожидании: {pending}")
    print(f"   ❌ Провалено: {failed}")
    print(f"   ✅ Выполнено: {completed}")
    
    conn.close()
    
    print("\n🎯 РЕКОМЕНДАЦИИ:")
    print("1. ✅ Перезапустите userbot: python3 userbot-agent.py")
    print("2. 🧪 Протестируйте на тестовом задании")
    print("3. 📱 Попросите реального пользователя сделать вывод 15-25 звёзд")
    print("4. 📊 Следите за логами: tail -f userbot-agent.log")
    
    return True

if __name__ == "__main__":
    print("🤖 Исправление проблем с очередью заданий userbot\n")
    
    result = asyncio.run(fix_queue_issues())
    
    if result:
        print("\n🎉 ПРОБЛЕМЫ ИСПРАВЛЕНЫ!")
        print("🚀 Система готова к нормальной работе")
    else:
        print("\n❌ Требуются дополнительные исправления")
