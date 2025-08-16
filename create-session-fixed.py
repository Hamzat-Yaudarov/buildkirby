#!/usr/bin/env python3
"""
ИСПРАВЛЕННЫЙ скрипт для создания сессии Telegram агента
Решает проблему "database is locked"
"""

import asyncio
import os
import time
import signal
import psutil
from pyrogram import Client

# Конфигурация API
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+7972065986",
    "username": "kirbystarsagent"
}

def kill_existing_processes():
    """Убить все процессы которые могут блокировать сессию"""
    print("🔍 Поиск процессов блокирующих сессию...")
    
    killed_processes = 0
    
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            # Ищем процессы Python с userbot или pyrogram
            if proc.info['name'] and 'python' in proc.info['name'].lower():
                cmdline = ' '.join(proc.info['cmdline'] or [])
                if any(keyword in cmdline.lower() for keyword in ['userbot', 'pyrogram', 'agent']):
                    print(f"🛑 Завершаем процесс: {proc.info['pid']} - {cmdline}")
                    proc.kill()
                    killed_processes += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    
    if killed_processes > 0:
        print(f"✅ Завершено {killed_processes} процессов")
        time.sleep(2)  # Ждём завершения процессов
    else:
        print("ℹ️ Блокирующие процессы не найдены")

def cleanup_session_files():
    """Очистка старых файлов сессии"""
    print("🧹 Очистка старых файлов сессии...")
    
    # Файлы которые нужно удалить
    files_to_remove = [
        "userbot_session.session",
        "userbot_session.session-journal", 
        "userbot_session.session-wal",
        "userbot_session.session-shm"
    ]
    
    removed_count = 0
    for file_path in files_to_remove:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                print(f"   ❌ Удален: {file_path}")
                removed_count += 1
            except OSError as e:
                print(f"   ⚠️ Не удалось удалить {file_path}: {e}")
    
    if removed_count == 0:
        print("   ℹ️ Файлы сессии не найдены")
    else:
        print(f"   ✅ Удалено {removed_count} файлов")

async def create_fresh_session():
    """Создание новой сессии с нуля"""
    print("🔐 Создание новой сессии Telegram агента")
    print(f"📱 Номер телефона: {API_CONFIG['phone_number']}")
    print()
    
    # Создаем уникальное имя сессии
    session_name = f"userbot_session_{int(time.time())}"
    
    try:
        print("🚀 Инициализация Pyrogram клиента...")
        
        # Создаем клиент с новым именем сессии
        app = Client(
            session_name,
            api_id=API_CONFIG["api_id"],
            api_hash=API_CONFIG["api_hash"],
            phone_number=API_CONFIG["phone_number"],
            workdir="."
        )
        
        print("📞 Запуск авторизации (потребуется SMS код)...")
        print("⌨️ Приготовьтесь ввести код из SMS...")
        
        # Запускаем авторизацию
        await app.start()
        
        # Получаем информацию об аккаунте
        me = await app.get_me()
        print()
        print("✅ АВТОРИЗАЦИЯ УСПЕШНА!")
        print(f"👤 Имя: {me.first_name} {me.last_name or ''}")
        print(f"📱 Username: @{me.username}")
        print(f"🆔 ID: {me.id}")
        print(f"📞 Телефон: {me.phone_number}")
        
        # Останавливаем клиент
        await app.stop()
        
        # Переименовываем файл сессии в стандартное имя
        old_session_file = f"{session_name}.session"
        new_session_file = "userbot_session.session"
        
        if os.path.exists(old_session_file):
            if os.path.exists(new_session_file):
                os.remove(new_session_file)
            
            os.rename(old_session_file, new_session_file)
            print(f"📁 Сессия сохранена как: {new_session_file}")
            
            # Проверяем размер файла
            file_size = os.path.getsize(new_session_file)
            print(f"📏 Размер файла сессии: {file_size} байт")
            
            if file_size > 0:
                print()
                print("🎉 СЕССИЯ СОЗДАНА УСПЕШНО!")
                print()
                print("📋 СЛЕДУЮЩИЕ ШАГИ:")
                print("1. Загрузите файл userbot_session.session в Railway проект")
                print("2. Убедитесь что файл в корневой папке проекта")
                print("3. Сделайте git add, commit и push")
                print("4. Railway автоматически перезапустится")
                print("5. Проверьте логи - должно появиться 'Авторизован как: [ваше имя]'")
                return True
            else:
                print("❌ Файл сессии создан но пустой")
                return False
        else:
            print("❌ Файл сессии не создан")
            return False
            
    except Exception as e:
        print(f"❌ Ошибка создания сессии: {e}")
        print()
        print("🔧 ВОЗМОЖНЫЕ РЕШЕНИЯ:")
        print("- Проверьте интернет соединение")
        print("- Убедитесь что номер телефона правильный")
        print("- Попробуйте через VPN если есть блокировки")
        print("- Проверьте что Telegram доступен")
        return False

async def test_existing_session():
    """Тест существующей сессии"""
    session_file = "userbot_session.session"
    
    if not os.path.exists(session_file):
        print(f"❌ Файл сессии {session_file} не найден")
        return False
    
    print(f"📁 Найден файл сессии {session_file}")
    print("🔍 Проверяем работоспособность...")
    
    try:
        app = Client(
            "userbot_session",
            api_id=API_CONFIG["api_id"],
            api_hash=API_CONFIG["api_hash"]
        )
        
        await app.start()
        me = await app.get_me()
        await app.stop()
        
        print(f"✅ Сессия работает!")
        print(f"👤 Авторизован как: {me.first_name} (@{me.username})")
        return True
        
    except Exception as e:
        print(f"❌ Сессия не работает: {e}")
        return False

def main():
    """Основная функция"""
    print("🤖 ИСПРАВЛЕННОЕ СОЗДАНИЕ СЕССИИ TELEGRAM USERBOT")
    print("=" * 55)
    print()
    
    # Шаг 1: Завершаем мешающие процессы
    kill_existing_processes()
    
    # Шаг 2: Очищаем старые файлы сессии
    cleanup_session_files()
    
    # Шаг 3: Проверяем существующую сессию
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        print()
        print("🔍 Проверка существующей сессии...")
        session_works = loop.run_until_complete(test_existing_session())
        
        if session_works:
            print()
            print("✅ У ВАС УЖЕ ЕСТЬ РАБОЧАЯ СЕССИЯ!")
            print("📤 Просто загрузите файл userbot_session.session на Railway")
            return
        
        # Шаг 4: Создаём новую сессию
        print()
        print("🔐 Создание новой сессии...")
        success = loop.run_until_complete(create_fresh_session())
        
        if success:
            print()
            print("🎉 ВСЁ ГОТОВО!")
            print("📤 З��грузите файл userbot_session.session на Railway")
        else:
            print()
            print("❌ НЕ УДАЛОСЬ СОЗДАТЬ СЕССИЮ")
            print("💬 Попробуйте:")
            print("   1. Перезапустить компьютер")
            print("   2. Запустить от имени администратора")
            print("   3. Проверить что Telegram работает на этом номере")
    
    except KeyboardInterrupt:
        print()
        print("🛑 Прервано пользователем")
    except Exception as e:
        print(f)
        print(f"❌ Неожиданная ошибка: {e}")
    finally:
        loop.close()

if __name__ == "__main__":
    main()
