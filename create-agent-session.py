#!/usr/bin/env python3
"""
Скрипт для создания сессии Telegram агента
Запустите ЛОКАЛЬНО для создания файла сессии, затем загрузите на Railway
"""

import asyncio
import os
from pyrogram import Client

# Конфигурация API (та же что в userbot-agent.py)
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+7972065986",
    "username": "kirbystarsagent"
}

async def create_session():
    """Создание сессии для userbot агента"""
    print("🔐 Создание сессии для Telegram Userbot Agent")
    print(f"📱 Номер телефона: {API_CONFIG['phone_number']}")
    print("⚠️  ВАЖНО: Запускайте этот скрипт ЛОКАЛЬНО, не на Railway!")
    print()

    # Создаем клиент
    app = Client(
        "userbot_session",
        api_id=API_CONFIG["api_id"],
        api_hash=API_CONFIG["api_hash"],
        phone_number=API_CONFIG["phone_number"]
    )

    try:
        print("🚀 Запуск авторизации...")
        
        # Запускаем клиент (это попросит ввести код)
        await app.start()
        
        # Получаем информацию об аккаунте
        me = await app.get_me()
        print(f"✅ Успешная авторизация!")
        print(f"👤 Имя: {me.first_name}")
        print(f"📱 Username: @{me.username}")
        print(f"🆔 ID: {me.id}")
        
        # Останавливаем клиент
        await app.stop()
        
        print()
        print("✅ Сессия создана успешно!")
        print("📁 Файл сессии: userbot_session.session")
        print()
        print("🚀 СЛЕДУЮЩИЕ ШАГИ:")
        print("1. Загрузите файл userbot_session.session в ваш Railway проект")
        print("2. Перезапустите деплой на Railway")
        print("3. Агент должен запуститься автоматически")
        
        # Проверяем что файл сессии создан
        if os.path.exists("userbot_session.session"):
            file_size = os.path.getsize("userbot_session.session")
            print(f"📏 Размер файла сессии: {file_size} байт")
        
    except Exception as e:
        print(f"❌ Ошибка авторизации: {e}")
        print()
        print("🔧 ВОЗМОЖНЫЕ ПРИЧИНЫ:")
        print("- Неверный номер телефона")
        print("- Номер заблокирован")
        print("- Неверные API ключи")
        print("- Требуется 2FA код")
        
        return False

    return True

async def check_existing_session():
    """Проверка существующей сессии"""
    if not os.path.exists("userbot_session.session"):
        print("❌ Файл сессии не найден")
        return False
    
    print("📁 Найден файл сессии, проверяем...")
    
    try:
        app = Client(
            "userbot_session",
            api_id=API_CONFIG["api_id"],
            api_hash=API_CONFIG["api_hash"]
        )
        
        await app.start()
        me = await app.get_me()
        
        print(f"✅ Сессия работает!")
        print(f"👤 Авторизован как: {me.first_name} (@{me.username})")
        
        await app.stop()
        return True
        
    except Exception as e:
        print(f"❌ Сессия не работает: {e}")
        return False

def main():
    """Основная функция"""
    print("🤖 СОЗДАНИЕ СЕССИИ TELEGRAM USERBOT AGENT")
    print("=" * 50)
    
    # Проверяем существующую сессию
    print("🔍 Проверка существующей сессии...")
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        session_exists = loop.run_until_complete(check_existing_session())
        
        if session_exists:
            print()
            print("✅ У вас уже есть рабочая сессия!")
            print("📁 Просто загрузите файл userbot_session.session на Railway")
        else:
            print()
            print("🔐 Создание новой сессии...")
            success = loop.run_until_complete(create_session())
            
            if not success:
                print()
                print("❌ Не удалось создать сессию")
                print("💡 Обратитесь за помощью")
    
    finally:
        loop.close()

if __name__ == "__main__":
    main()
