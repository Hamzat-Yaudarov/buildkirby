#!/usr/bin/env python3
"""
Тестирование правильных API методов для отправки Star подарков
"""

import asyncio
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Конфигурация API
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+79639887777",
    "username": "kirbystarsagent"
}

async def test_pyrogram_api():
    """Тестирование Pyrogram API"""
    try:
        from pyrogram import Client
        from pyrogram.raw import functions, types as raw_types
        
        logger.info("🔬 Тестиров��ние Pyrogram API...")
        
        app = Client(
            "test_session",
            api_id=API_CONFIG["api_id"],
            api_hash=API_CONFIG["api_hash"],
            phone_number=API_CONFIG["phone_number"]
        )
        
        await app.start()
        me = await app.get_me()
        logger.info(f"✅ Pyrogram: Авторизован как {me.first_name}")
        
        # Тестирование загрузки каталога подарков
        try:
            result = await app.invoke(functions.payments.GetStarGifts())
            logger.info(f"✅ Pyrogram: Каталог подарков загружен ({len(result.gifts)} подарков)")
            
            # Показываем первые 3 подарка
            for i, gift in enumerate(result.gifts[:3]):
                logger.info(f"   🎁 Подарок {i+1}: {gift.stars} звёзд (ID: {gift.id})")
                
            await app.stop()
            return True, "Pyrogram API работает"
            
        except Exception as api_error:
            logger.error(f"❌ Pyrogram API ошибка: {api_error}")
            await app.stop()
            return False, str(api_error)
            
    except Exception as e:
        logger.error(f"❌ Pyrogram недоступен: {e}")
        return False, str(e)

async def test_telethon_api():
    """Тестирование Telethon API"""
    try:
        from telethon import TelegramClient, functions
        
        logger.info("🔬 Тестирование Telethon API...")
        
        client = TelegramClient(
            'test_telethon',
            API_CONFIG["api_id"],
            API_CONFIG["api_hash"]
        )
        
        await client.start(phone=API_CONFIG["phone_number"])
        me = await client.get_me()
        logger.info(f"✅ Telethon: Авторизован как {me.first_name}")
        
        # Тестирование загрузки каталога подарков
        try:
            result = await client(functions.payments.GetStarGiftsRequest())
            logger.info(f"✅ Telethon: Каталог подарков загружен ({len(result.gifts)} подарков)")
            
            # Показываем первые 3 подарка
            for i, gift in enumerate(result.gifts[:3]):
                logger.info(f"   🎁 Подарок {i+1}: {gift.stars} звёзд (ID: {gift.id})")
            
            # Проверка наличия SendStarsFormRequest
            if hasattr(functions.payments, 'SendStarsFormRequest'):
                logger.info("✅ Telethon: SendStarsFormRequest доступен!")
            else:
                logger.warning("⚠️ Telethon: SendStarsFormRequest не найден")
                
            await client.disconnect()
            return True, "Telethon API работает"
            
        except Exception as api_error:
            logger.error(f"❌ Telethon API ошибка: {api_error}")
            await client.disconnect()
            return False, str(api_error)
            
    except Exception as e:
        logger.error(f"❌ Telethon недоступен: {e}")
        return False, str(e)

async def main():
    """Основная функция тестирования"""
    print("🧪 ТЕСТИРОВАНИЕ API МЕТОДОВ ДЛЯ ОТПРАВКИ STAR ПОДАРКОВ\n")
    
    results = {}
    
    # Тест Pyrogram
    print("1️⃣ Тестирование Pyrogram...")
    pyrogram_success, pyrogram_msg = await test_pyrogram_api()
    results['pyrogram'] = (pyrogram_success, pyrogram_msg)
    print(f"   Результат: {'✅' if pyrogram_success else '❌'} {pyrogram_msg}\n")
    
    # Тест Telethon
    print("2️⃣ Тестирование Telethon...")
    telethon_success, telethon_msg = await test_telethon_api()
    results['telethon'] = (telethon_success, telethon_msg)
    print(f"   Результат: {'✅' if telethon_success else '❌'} {telethon_msg}\n")
    
    # Итоговые рекомендации
    print("🎯 ИТОГОВЫЕ РЕКОМЕНДАЦИИ:")
    
    if pyrogram_success and telethon_success:
        print("✅ Обе библиотеки работают! Рекомендуется использовать Telethon с SendStarsFormRequest")
        print("📁 Запускайте: python3 userbot-telethon.py")
    elif telethon_success:
        print("✅ Telethon работает! Используйте Telethon версию")
        print("📁 Запускайте: python3 userbot-telethon.py")
    elif pyrogram_success:
        print("✅ Pyrogram работает! Используйте исправленную Pyrogram версию")
        print("📁 Запускайте: python3 userbot-agent-correct.py")
    else:
        print("❌ Обе библиотеки имеют проблемы. Проверьте:")
        print("   1. Установку зависимостей: pip install -r requirements-updated.txt")
        print("   2. Авторизацию аккаунта")
        print("   3. Актуальность API методов")
    
    print("\n" + "="*50)
    return results

if __name__ == "__main__":
    try:
        results = asyncio.run(main())
        print("\n🏁 Тестирование завершено!")
    except KeyboardInterrupt:
        print("\n🛑 Тестирование прервано пользователем")
    except Exception as e:
        print(f"\n❌ Критическая ошибка тестирования: {e}")
