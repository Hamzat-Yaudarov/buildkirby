#!/usr/bin/env python3
"""
Скрипт для исправления авторизации userbot после AUTH_KEY_DUPLICATED
"""

import os
import asyncio
import logging
from pyrogram import Client

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# API конфигурация (из userbot-agent.py)
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+79639887777",
    "username": "kirbystarsagent"
}

async def fix_authorization():
    """Исправление авторизации userbot"""
    
    print("🔧 ИСПРАВЛЕНИЕ АВТОРИЗАЦИИ USERBOT\n")
    
    # 1. Удаляем старую сессию
    session_file = "userbot_session.session"
    if os.path.exists(session_file):
        print(f"🗑️  Удаляем старую сессию: {session_file}")
        os.remove(session_file)
        print("✅ Старая сессия удалена")
    else:
        print("ℹ️  Файл сессии не найден")
    
    # 2. Создаем новую сессию
    print("\n🔐 Создание новой сессии...")
    print(f"📱 Телефон: {API_CONFIG['phone_number']}")
    print(f"👤 Username: @{API_CONFIG['username']}")
    
    try:
        app = Client(
            "userbot_session",
            api_id=API_CONFIG["api_id"],
            api_hash=API_CONFIG["api_hash"],
            phone_number=API_CONFIG["phone_number"]
        )
        
        print("\n📲 Начинаем авторизацию...")
        print("⚠️  ВНИМАНИЕ: Потребуется ввести SMS код и 2FA пароль!")
        
        await app.start()
        
        # Проверяем авторизацию
        me = await app.get_me()
        print(f"\n✅ АВТОРИЗАЦИЯ УСПЕШНА!")
        print(f"👤 Имя: {me.first_name}")
        print(f"📱 Username: @{me.username}")
        print(f"🆔 ID: {me.id}")
        
        await app.stop()
        
        print(f"\n💾 Новая сессия сохранена: {session_file}")
        print("📁 Размер файла:", os.path.getsize(session_file), "байт")
        
        print("\n🎯 СЛЕДУЮЩИЕ ШАГИ:")
        print("1. ✅ Файл сессии готов")
        print("2. 🚀 Можно запускать userbot: python3 userbot-agent.py") 
        print("3. 📤 Или загрузить сессию на Railway для автоматизации")
        
        return True
        
    except Exception as e:
        print(f"\n❌ ОШИБКА АВТОРИЗАЦИИ: {e}")
        
        if "phone number is banned" in str(e).lower():
            print("🚫 НОМЕР ТЕЛЕФОНА ЗАБЛОКИРОВАН!")
            print("💡 Решение: Использовать другой номер телефона")
        elif "session password needed" in str(e).lower():
            print("🔒 ТРЕБУЕТСЯ 2FA ПАРОЛЬ!")
            print("💡 Введите пароль от двухфакторной аутентификации")
        else:
            print("🔧 Попробуйте:")
            print("- Проверить интернет соединение")
            print("- Убедиться что номер телефона правильный")
            print("- Проверить что API_ID и API_HASH корректные")
        
        return False

if __name__ == "__main__":
    print("🤖 Telegram Userbot - Исправление авторизации\n")
    
    result = asyncio.run(fix_authorization())
    
    if result:
        print("\n🎉 ГОТОВО! Userbot готов к работе!")
    else:
        print("\n❌ Не удалось исправить авторизацию")
        print("📞 Возможно нужна помощь с настройкой")
