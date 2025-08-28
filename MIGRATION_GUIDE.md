# 🚀 Миграция данных из xlsx файлов

## Подготовка к миграции

### 1. Установка зависимостей
```bash
npm install
```

### 2. Подготовка данных
1. Создайте папку `xlsx-data` в корне проекта:
   ```bash
   mkdir xlsx-data
   ```

2. Поместите все ваши xlsx файлы в папку `xlsx-data/`
   
   **Требуемые файлы:**
   - `users.xlsx`
   - `tasks.xlsx`
   - `user_tasks.xlsx`
   - `withdrawal_requests.xlsx`
   - `subgram_tasks.xlsx`
   - `sponsor_channels_stats.xlsx`
   - `sponsor_channel_user_checks.xlsx`
   - `promocodes.xlsx`
   - `promocode_uses.xlsx`
   - `lottery_tickets.xlsx`
   - `lotteries.xlsx`
   - `bot_stats.xlsx`

   ✅ **Если какой-то файл пустой или отсутствует - это нормально, скрипт пропустит его**

### 3. Проверка подключения к новой БД
Убедитесь что в `config.js` указана новая база данных:
```javascript
DATABASE_URL: 'postgresql://neondb_owner:npg_YC1S8JfBNKWg@ep-quiet-cloud-a2e7auqd-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
```

## Запуск миграции

### Способ 1: Через npm скрипт
```bash
npm run migrate-xlsx
```

### Способ 2: Прямой запуск
```bash
node migrate-from-xlsx.js
```

## Что происходит во время миграции?

1. **Инициализация БД** - создаются все таблицы
2. **Проверка файлов** - сканируется папка `xlsx-data/`
3. **Загрузка данных** - в правильном порядке (учитывая зависимости):
   - users
   - tasks  
   - promocodes
   - lotteries
   - sponsor_channels_stats
   - user_tasks
   - withdrawal_requests
   - subgram_tasks
   - sponsor_channel_user_checks
   - promocode_uses
   - lottery_tickets
   - bot_stats

4. **Обработка дублей** - использует `ON CONFLICT DO NOTHING`

## Структура папок
```
project/
├── xlsx-data/
│   ├── users.xlsx
│   ├── tasks.xlsx
│   ├── user_tasks.xlsx
│   └── ... (остальные файлы)
├── migrate-from-xlsx.js
├── config.js
└── database.js
```

## Проверка результата

После миграции:

1. **Запустите бота:**
   ```bash
   npm start
   ```

2. **Проверьте логи** - должно быть сообщение о успешном подключении к БД

3. **Протестируйте функции:**
   - Команда `/start` должна работать
   - Пользователи должны видеть свои балансы
   - Задания должны отображаться

## Возможные проблемы и решения

### ❌ Ошибка: "Cannot find module 'xlsx'"
**Решение:** Установите зависимости
```bash
npm install
```

### ❌ Ошибка: "ENOENT: no such file or directory 'xlsx-data'"
**Решение:** Создайте папку и поместите туда xlsx файлы
```bash
mkdir xlsx-data
# Скопируйте файлы в xlsx-data/
```

### ❌ Ошибка подключения к БД
**Решение:** Проверьте правильность DATABASE_URL в config.js

### ❌ Ошибка: "column does not exist"
**Решение:** 
1. Проверьте что поля в xlsx соответствуют структуре БД
2. Если нужно - добавьте недостающие колонки в xlsx файл

### ❌ Ошибка: "foreign key constraint"
**Решение:** Убедитесь что все xlsx файлы содержат корректные данные и ссылки между таблицами

## Что дальше?

После успешной миграции:

1. ✅ **Запустите бота** - `npm start`
2. ✅ **Протестируйте основные функции**
3. ✅ **Проверьте что пользователи не потеряли данные**
4. ✅ **Удалите старые файлы xlsx** (после подтверждения что все работает)

## Дополнительные команды

```bash
# Просмотр логов при миграции
npm run migrate-xlsx 2>&1 | tee migration.log

# Сброс БД (если нужно перемигрировать)
npm run reset-db

# Запуск бота после миграции  
npm start
```

🎉 **Готово!** Ваши данные должны быть восстановлены в новой базе данных.
