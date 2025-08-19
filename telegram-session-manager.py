#!/usr/bin/env python3
"""
Универсальный скрипт для управления сессиями Telegram
Объединяет функциональность всех дублированных Python скриптов
"""

import os
import sys
import json
import asyncio
import argparse
from datetime import datetime

# Централизованная конфигурация API (импортируем из JavaScript config)
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+7972065986",
    "phone_number_alt": "+79639887777"
}

# Название файла сессии
SESSION_FILE = "telegram_session.session"

async def create_session(api_id, api_hash, phone_number, session_name=None):
    """Создает новую сессию Telegram"""
    try:
        from pyrogram import Client
        
        if not session_name:
            session_name = SESSION_FILE.replace('.session', '')
        
        print(f"📱 Создание сессии для номера: {phone_number}")
        print(f"📁 Файл сессии: {session_name}.session")
        
        client = Client(
            session_name,
            api_id=api_id,
            api_hash=api_hash,
            phone_number=phone_number
        )
        
        await client.start()
        
        # Получаем информацию о пользователе
        me = await client.get_me()
        print(f"✅ Сессия создана успешно!")
        print(f"👤 Пользователь: {me.first_name} {me.last_name or ''}")
        print(f"📱 Телефон: {me.phone_number}")
        print(f"🆔 ID: {me.id}")
        
        await client.stop()
        return True
        
    except ImportError:
        print("❌ Pyrogram не установлен. Установите: pip install pyrogram tgcrypto")
        return False
    except Exception as e:
        print(f"❌ Ошибка создания сесс��и: {e}")
        return False

async def test_session(session_name=None):
    """Тестирует существующую сессию"""
    try:
        from pyrogram import Client
        
        if not session_name:
            session_name = SESSION_FILE.replace('.session', '')
        
        session_file = f"{session_name}.session"
        
        if not os.path.exists(session_file):
            print(f"❌ Файл сессии {session_file} не найден")
            return False
        
        print(f"🔍 Тестирование сессии: {session_file}")
        
        client = Client(session_name, **API_CONFIG)
        await client.start()
        
        # Проверяем авторизацию
        me = await client.get_me()
        print(f"✅ Сессия работает!")
        print(f"👤 Авторизован как: {me.first_name} {me.last_name or ''}")
        
        await client.stop()
        return True
        
    except ImportError:
        print("❌ Pyrogram не установлен. Установите: pip install pyrogram tgcrypto")
        return False
    except Exception as e:
        print(f"❌ Ошибка тестирования сессии: {e}")
        return False

async def test_stars_sending(session_name=None):
    """Тестирует отправку звёзд (безопасный тест без реальной отправки)"""
    try:
        from pyrogram import Client
        
        if not session_name:
            session_name = SESSION_FILE.replace('.session', '')
        
        print(f"⭐ Тестирование функции отправки звёзд...")
        
        client = Client(session_name, **API_CONFIG)
        await client.start()
        
        me = await client.get_me()
        print(f"👤 Авторизован: {me.first_name}")
        
        # Здесь был бы код для отправки звёзд
        # НО мы делаем только безопасный тест подключения
        print("✅ Подключение к API успешно")
        print("⚠️  Реальная отправка звёзд отключена для безопасности")
        
        await client.stop()
        return True
        
    except ImportError:
        print("❌ Pyrogram не установлен")
        return False
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False

def list_sessions():
    """Показывает список всех файлов сессий"""
    print("📁 Поиск файлов сессий...")
    
    session_files = [f for f in os.listdir('.') if f.endswith('.session')]
    
    if not session_files:
        print("❌ Файлы сессий не найдены")
        return
    
    print(f"✅ Найдено сессий: {len(session_files)}")
    for i, session_file in enumerate(session_files, 1):
        stat = os.stat(session_file)
        modified = datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
        print(f"  {i}. {session_file} (изменен: {modified})")

def cleanup_sessions():
    """Удаляет старые файлы сессий"""
    print("🧹 Очистка старых сессий...")
    
    session_files = [f for f in os.listdir('.') if f.endswith('.session')]
    
    if not session_files:
        print("❌ Файлы сессий не найдены")
        return
    
    for session_file in session_files:
        try:
            os.remove(session_file)
            print(f"🗑️  Удален: {session_file}")
        except Exception as e:
            print(f"❌ Ошибка удаления {session_file}: {e}")

async def main():
    """Главная функция с аргументами командной строки"""
    parser = argparse.ArgumentParser(description='Универсальный менеджер сессий Telegram')
    parser.add_argument('action', choices=['create', 'test', 'test-stars', 'list', 'cleanup'], 
                       help='Действие для выполнения')
    parser.add_argument('--session', '-s', default=None, 
                       help='Имя сессии (без .session)')
    parser.add_argument('--phone', '-p', default=API_CONFIG['phone_number'], 
                       help='Номер телефона')
    
    args = parser.parse_args()
    
    print(f"🚀 Telegram Session Manager")
    print(f"⚡ Действие: {args.action}")
    print("-" * 50)
    
    if args.action == 'create':
        success = await create_session(
            API_CONFIG['api_id'], 
            API_CONFIG['api_hash'], 
            args.phone, 
            args.session
        )
        sys.exit(0 if success else 1)
        
    elif args.action == 'test':
        success = await test_session(args.session)
        sys.exit(0 if success else 1)
        
    elif args.action == 'test-stars':
        success = await test_stars_sending(args.session)
        sys.exit(0 if success else 1)
        
    elif args.action == 'list':
        list_sessions()
        
    elif args.action == 'cleanup':
        cleanup_sessions()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n⏹️  Операция прервана пользователем")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 Критическая ошибка: {e}")
        sys.exit(1)
