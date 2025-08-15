# Дизайн новых типов лотерей

## 🎯 Два новых типа реферальных лотерей

### **Тип 1: Реферальные лотереи с условием участия**
- **Условие участия**: пользователь должен пригласить N рефералов за N часов после создания лотереи
- **Билеты**: 1 бесплатный билет + возможность покупки дополнительных билетов
- **Призы**: настраиваемые админом (разные суммы для разных мест)
- **Завершение**: по времени (не по билетам)
- **Выбор победителей**: вручную админом

### **Тип 2: Автоматические реферальные лотереи**
- **Участие**: каждый новый реферал после старта = +1 билет автоматически
- **Билеты**: только за рефералов (не покупаются)
- **Призы**: настраиваемые админом для каждого места
- **Завершение**: по времени
- **Выбор победителей**: вручную админом

## 🗄️ Структура базы данных

### **Расширение таблицы `lotteries`**
Добавим поле `lottery_type`:
- `'standard'` - обычная лотерея (существующая)
- `'referral_condition'` - реферальная с условием (тип 1)
- `'referral_auto'` - автоматическая реферальная (тип 2)

### **Новая таблица `referral_lotteries`**
```sql
CREATE TABLE referral_lotteries (
    id SERIAL PRIMARY KEY,
    lottery_id INTEGER REFERENCES lotteries(id) ON DELETE CASCADE,
    
    -- Условия участия (для типа 1)
    required_referrals INTEGER,          -- Сколько рефералов нужно пригласить
    referral_time_hours INTEGER,         -- За сколько часов нужно пригласить
    
    -- Настройки билетов (для типа 1)
    additional_ticket_price DECIMAL(10,2), -- Цена дополнительного билета
    
    -- Временные ограничения
    ends_at TIMESTAMP NOT NULL,          -- Время окончания лотереи
    
    -- Статус
    is_manual_selection BOOLEAN DEFAULT TRUE, -- Ручной выбор победителей
    winners_selected BOOLEAN DEFAULT FALSE,   -- Выбраны ли победители
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### **Новая таблица `lottery_prizes`**
```sql
CREATE TABLE lottery_prizes (
    id SERIAL PRIMARY KEY,
    lottery_id INTEGER REFERENCES lotteries(id) ON DELETE CASCADE,
    place INTEGER NOT NULL,              -- Призовое место (1, 2, 3...)
    prize_amount DECIMAL(10,2) NOT NULL, -- Размер приза в звездах
    winner_user_id BIGINT DEFAULT NULL,  -- ID победителя (NULL пока не выбран)
    awarded_at TIMESTAMP DEFAULT NULL,   -- Время присуждения приза
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### **Новая таблица `referral_lottery_tickets`**
```sql
CREATE TABLE referral_lottery_tickets (
    id SERIAL PRIMARY KEY,
    lottery_id INTEGER REFERENCES lotteries(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    ticket_type VARCHAR(20) NOT NULL,    -- 'free', 'purchased', 'referral'
    referral_user_id BIGINT DEFAULT NULL, -- ID реферала (для типа 2)
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### **Новая таблица `lottery_participants`**
```sql
-- Для отслеживания участников и их статистики
CREATE TABLE lottery_participants (
    id SERIAL PRIMARY KEY,
    lottery_id INTEGER REFERENCES lotteries(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    
    -- Статистика участника
    total_tickets INTEGER DEFAULT 0,     -- Общее количество билетов
    free_tickets INTEGER DEFAULT 0,      -- Бесплатные билеты
    purchased_tickets INTEGER DEFAULT 0, -- Купленные билеты
    referral_tickets INTEGER DEFAULT 0,  -- Билеты за рефералов
    
    -- Условия участия (для типа 1)
    referrals_count INTEGER DEFAULT 0,   -- Сколько пригласил рефералов
    qualified BOOLEAN DEFAULT FALSE,     -- Выполнил ли условие участия
    
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(lottery_id, user_id)
);
```

## 🎮 Логика работы

### **Тип 1: Реферальная лотерея с условием**

**Создание:**
```
/create_referral_lottery название|время_часов|мин_рефералов|цена_билета|место1:приз1|место2:приз2|...
```

**Пример:**
```
/create_referral_lottery Недельная|168|3|1.5|1:50|2:30|3:20
```
- Название: "Недельная"
- Время: 168 часов (неделя)
- Условие: пригласить 3 рефералов
- Цена доп. билета: 1.5 ⭐
- Призы: 1 место - 50⭐, 2 место - 30⭐, 3 место - 20⭐

**Участие:**
1. Пользователь должен пригласить N рефералов за указанное время
2. После выполнения условия получает 1 бесплатный билет
3. Может купить дополнительные билеты за звезды

### **Тип 2: Автоматическая реферальная лотерея**

**Создание:**
```
/create_auto_referral_lottery название|время_часов|место1:приз1|место2:приз2|...
```

**Пример:**
```
/create_auto_referral_lottery Авто|72|1:100|2:60|3:40|4:20|5:10
```
- Название: "Авто"
- Время: 72 часа (3 дня)
- Призы: 1-100⭐, 2-60⭐, 3-40⭐, 4-20⭐, 5-10⭐

**Участие:**
1. Каждый новый реферал после старта лотереи = +1 билет автоматически
2. Билеты не покупаются, только за рефералов

## 🏆 Система выбора победителей

### **Ручной выбор админом:**
```
/select_lottery_winners ID место1:userID место2:userID место3:userID
```

**Пример:**
```
/select_lottery_winners 5 1:123456 2:789012 3:345678
```

### **Автоматическая рассылка результатов:**
После выбора победителей всем пользователям отправляется сообщение:

```
🎉 **Лотерея "Недельная" завершена!**

🏆 **Победители:**
🥇 1 место: @username1 - 50 ⭐
🥈 2 место: @username2 - 30 ⭐  
🥉 3 место: @username3 - 20 ⭐

Поздравляем победителей! 🎊
```

## 🔄 Интеграция с существующей системой

1. **Расширяем** существующую таблицу `lotteries` полем `lottery_type`
2. **Сохраняем** обратную совместимость для стандартных лотерей
3. **Добавляем** новые функции без изменения с��ществующих
4. **Используем** существующую систему пользователей и балансов
