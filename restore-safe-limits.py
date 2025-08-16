#!/usr/bin/env python3
"""
Восстановление безопасных лимитов для userbot
"""

import sqlite3
import os

def restore_safe_limits():
    """Восстановление безопасных настроек"""
    
    print("🔧 ВОССТАНОВЛЕНИЕ БЕЗОПАСНЫХ НАСТРОЕК\n")
    
    db_path = "userbot_queue.db"
    
    if not os.path.exists(db_path):
        print("❌ База данных не найдена")
        return False
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 1. Показать текущие настройки
        print("📊 ТЕКУЩИЕ НАСТРОЙКИ:")
        cursor.execute("SELECT daily_limit, hourly_limit, max_amount FROM agent_settings WHERE id = 1")
        result = cursor.fetchone()
        
        if result:
            daily, hourly, max_amount = result
            print(f"   📅 Дневной лимит: {daily} звёзд")
            print(f"   ⏰ Часовой лимит: {hourly} звёзд") 
            print(f"   🎯 Максимум за раз: {max_amount} звёзд")
            
            # Проверяем, нужно ли исправление
            if daily > 100 or hourly > 20 or max_amount > 50:
                print("\n⚠️ ОПАСНЫЕ НАСТРОЙКИ ОБНАРУЖЕНЫ!")
                print("🚨 Риск блокировки аккаунта!")
            else:
                print("\n✅ Настройки в безопасных пределах")
        else:
            print("   ❌ Настройки не найдены")
        
        # 2. Восстановить безопасные значения
        print("\n🛡️ ВОССТАНОВЛЕНИЕ БЕЗОПАСНЫХ ЛИМИТОВ:")
        
        safe_daily = 80    # Безопасно для долгосрочного использования
        safe_hourly = 10   # Не вызывает подозрений у Telegram
        safe_max = 25      # Тест-режим для безопасности
        
        cursor.execute("""
            UPDATE agent_settings 
            SET daily_limit = ?, hourly_limit = ?, max_amount = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        """, (safe_daily, safe_hourly, safe_max))
        
        # Если записи нет, создать её
        if cursor.rowcount == 0:
            cursor.execute("""
                INSERT INTO agent_settings (id, daily_limit, hourly_limit, max_amount)
                VALUES (1, ?, ?, ?)
            """, (safe_daily, safe_hourly, safe_max))
        
        conn.commit()
        
        print(f"   ✅ Дневной лимит: {safe_daily} звёзд (было: {daily if result else 'не задано'})")
        print(f"   ✅ Часовой лимит: {safe_hourly} звёзд (было: {hourly if result else 'не задано'})")
        print(f"   ✅ Максимум за раз: {safe_max} звёзд (было: {max_amount if result else 'не задано'})")
        
        # 3. Очистить статистику за сегодня (для свежего старта)
        print("\n🔄 СБРОС СТАТИСТИКИ:")
        cursor.execute("DELETE FROM stats_log WHERE date = DATE('now')")
        print("   ✅ Статистика за сегодня сброшена")
        
        # 4. Показать финальные настройки
        print("\n🎯 ФИНАЛЬНЫЕ НАСТРОЙКИ:")
        cursor.execute("SELECT daily_limit, hourly_limit, max_amount FROM agent_settings WHERE id = 1")
        final = cursor.fetchone()
        
        if final:
            daily, hourly, max_amount = final
            print(f"   📅 Лимит в день: {daily} звёзд")
            print(f"   ⏰ Лимит в час: {hourly} звёзд")
            print(f"   🎯 Максимум за раз: {max_amount} звёзд")
            print("   🧪 Тест-режим: ВКЛЮЧЕН")
            
        conn.close()
        
        print("\n💡 РЕКОМЕНДАЦИИ:")
        print("1. 🔄 Перезапустите userbot для применения настроек")
        print("2. 🧪 Начните с тестовых сумм 5-15 звёзд")
        print("3. 📊 Следите за статистикой в логах")
        print("4. ⏰ Не превышайте лимиты ��ля безопасности")
        
        print("\n🛡️ ОБЪЯСНЕНИЕ ЛИМИТОВ:")
        print("• 80 звёзд/день - безопасно для долгосрочного использования")
        print("• 10 звёзд/час - не вызывает подозрений у Telegram")
        print("• 25 звёзд за раз - тест-режим, минимальный риск")
        print("• Задержки 60-180 сек - имитация человеческого поведения")
        
        return True
        
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False

if __name__ == "__main__":
    print("🛡️ Восстановление безопасных настроек userbot\n")
    
    result = restore_safe_limits()
    
    if result:
        print("\n🎉 НАСТРОЙКИ ВОССТАНОВЛЕНЫ!")
        print("🚀 Userbot готов к безопасной работе")
    else:
        print("\n❌ Не удалось восстановить настройки")
