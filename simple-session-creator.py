#!/usr/bin/env python3
"""
САМЫЙ ПРОСТОЙ способ создать сессию
Без проверок и сложностей - просто создает сессию
"""

import asyncio
import os
from pyrogram import Client

# Ваши данные
API_ID = 28085629
API_HASH = "78027b2ae19b9ec44a6e03bf5cc1299f"
PHONE = "+7972065986"

async def simple_create_session():
    print("📱 Создание сессии для", PHONE)
    print()
    
    # Удаляем старые файлы если есть
    old_files = ["userbot_session.session", "userbot_session.session-journal"]
    for file in old_files:
        if os.path.exists(file):
            os.remove(file)
            print(f"🗑️ Удален старый файл: {file}")
    
    print("🚀 Запуск авторизации...")
    print("📨 Приготовьтесь ввести код из SMS")
    print()
    
    # Создаем клиент
    app = Client(
        name="userbot_session",
        api_id=API_ID,
        api_hash=API_HASH,
        phone_number=PHONE
    )
    
    try:
        # Запускаем (попросит SMS код)
        await app.start()
        
        # Получаем инфо
        me = await app.get_me()
        
        print("✅ УСПЕХ!")
        print(f"Имя: {me.first_name}")
        print(f"Username: @{me.username}")
        
        # Останавливаем
        await app.stop()
        
        # Проверяем файл
        if os.path.exists("userbot_session.session"):
            size = os.path.getsize("userbot_session.session")
            print(f"📁 Файл создан: userbot_session.session ({size} байт)")
            print()
            print("🎯 ГОТОВО! Загрузите этот файл на Railway")
        else:
            print("❌ Файл не создан")
            
    except Exception as e:
        print(f"❌ Ошибка: {e}")

if __name__ == "__main__":
    asyncio.run(simple_create_session())
