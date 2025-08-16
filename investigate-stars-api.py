#!/usr/bin/env python3
"""
Исследование доступных методов для отправки Telegram Stars
"""

import asyncio
from pyrogram import Client
from pyrogram.raw import functions
import inspect

# API конфигурация
API_CONFIG = {
    "api_id": 28085629,
    "api_hash": "78027b2ae19b9ec44a6e03bf5cc1299f",
    "phone_number": "+79639887777"
}

async def investigate_stars_api():
    """Исследование доступных методов для работы со звёздами"""
    
    print("🔍 ИССЛЕДОВАНИЕ TELEGRAM STARS API\n")
    
    try:
        app = Client(
            "userbot_session",
            api_id=API_CONFIG["api_id"],
            api_hash=API_CONFIG["api_hash"]
        )
        
        await app.start()
        me = await app.get_me()
        print(f"✅ Подключен как: {me.first_name} (@{me.username})")
        
        # 1. Исследование payments модуля
        print("\n💳 ДОСТУПНЫЕ PAYMENT МЕТОДЫ:")
        
        try:
            import pyrogram.raw.functions.payments as payments
            payment_methods = [method for method in dir(payments) if not method.startswith('_')]
            
            for method in payment_methods:
                print(f"   📝 {method}")
                
        except Exception as e:
            print(f"   ❌ Ошибка импорта payments: {e}")
        
        # 2. Поиск методов связанных со звёздами
        print("\n⭐ ПОИСК МЕТОДОВ СО ЗВЁЗДАМИ:")
        
        try:
            all_functions = []
            
            # Проверяем разные модули
            modules_to_check = [
                'pyrogram.raw.functions.payments',
                'pyrogram.raw.functions.messages', 
                'pyrogram.raw.functions.users',
                'pyrogram.raw.functions.channels'
            ]
            
            for module_name in modules_to_check:
                try:
                    module = __import__(module_name, fromlist=[''])
                    methods = [method for method in dir(module) if not method.startswith('_')]
                    
                    for method in methods:
                        if 'star' in method.lower() or 'gift' in method.lower():
                            print(f"   🌟 {module_name}.{method}")
                            
                except ImportError:
                    print(f"   ❌ Модуль {module_name} не найден")
                    
        except Exception as e:
            print(f"   ❌ Ошибка поиска: {e}")
        
        # 3. Попытка найти gift методы
        print("\n🎁 ПОИСК GIFT МЕТОДОВ:")
        
        try:
            # Проверяем Bot API методы (если доступны)
            if hasattr(app, 'send_gift'):
                print("   ✅ app.send_gift доступен")
            else:
                print("   ❌ app.send_gift не найден")
                
            # Проверяем другие потенциальные методы
            potential_methods = [
                'send_stars',
                'send_gift', 
                'gift_stars',
                'transfer_stars',
                'send_payment'
            ]
            
            for method in potential_methods:
                if hasattr(app, method):
                    print(f"   ✅ app.{method} доступен")
                else:
                    print(f"   ❌ app.{method} не найден")
                    
        except Exception as e:
            print(f"   ❌ Ошибка проверки методов: {e}")
        
        # 4. Проверка возможностей аккаунта
        print(f"\n👤 ИНФОРМАЦИЯ ОБ АККАУНТЕ:")
        print(f"   🆔 ID: {me.id}")
        print(f"   📱 Username: @{me.username}")
        print(f"   🤖 Is Bot: {me.is_bot}")
        print(f"   ⭐ Is Premium: {getattr(me, 'is_premium', 'Неизвестно')}")
        
        # 5. Попытка отправки через разные методы
        print(f"\n🧪 ТЕСТИРОВАНИЕ МЕТОДОВ ОТПРАВКИ:")
        
        # Метод 1: Через Bot API (если доступен)
        try:
            # Это работает только для ботов, но проверим
            result = await app.send_message(me.id, "🌟 Тест отправки подарка")
            print("   ✅ Отправка сообщений работает")
            await result.delete()
        except Exception as e:
            print(f"   ❌ Ошибка отправки сообщения: {e}")
        
        # Метод 2: Через MTProto raw API
        try:
            # Попытка найти правильный метод для звёзд
            print("   🔍 Поиск правильного MTProto метода...")
            
            # Возможные варианты API
            potential_apis = [
                'payments.SendStarsForm',
                'payments.SendGift', 
                'payments.SendPayment',
                'messages.SendGift',
                'users.SendGift'
            ]
            
            for api in potential_apis:
                try:
                    module_name, method_name = api.split('.')
                    module = getattr(functions, module_name)
                    if hasattr(module, method_name):
                        print(f"   ✅ Найден: {api}")
                    else:
                        print(f"   ❌ Не найден: {api}")
                except Exception:
                    print(f"   ❌ Ошибка проверки: {api}")
                    
        except Exception as e:
            print(f"   ❌ Ошибка тестирования MTProto: {e}")
        
        await app.stop()
        
        # 6. Выводы и рекомендации
        print(f"\n💡 ВЫВОДЫ:")
        print("1. Telegram Stars - относительно новая функция")
        print("2. API для отправки через userbot может быть ограничен")
        print("3. Возможно требуется использование Bot API вместо User API")
        print("4. Или API еще не добавлен в Pyrogram")
        
        print(f"\n🎯 ВОЗМОЖНЫЕ РЕШЕНИЯ:")
        print("1. 🤖 Использовать Bot API через основной бот")
        print("2. 📱 Найти обновленный API метод в новой версии Pyrogram")
        print("3. 🔄 Интегрировать с основным ботом для отправки")
        print("4. 📞 Использовать Telegram Bot API напрямую")
        
        return True
        
    except Exception as e:
        print(f"❌ Критическая ошибка: {e}")
        return False

if __name__ == "__main__":
    print("🔬 Исследование Telegram Stars API\n")
    
    result = asyncio.run(investigate_stars_api())
    
    if result:
        print("\n🎉 ИССЛЕДОВАНИЕ ЗАВЕРШЕНО!")
    else:
        print("\n❌ Исследование не завершено")
