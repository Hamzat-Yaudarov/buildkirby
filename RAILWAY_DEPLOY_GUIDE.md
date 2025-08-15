# 🚂 Деплой Stars Agent на Railway

## ⚠️ ВАЖНО ПЕРЕД ДЕПЛОЕМ

**Stars Agent требует дополнительных настроек на Railway!**

---

## 🔧 ШАГ 1: Обновить package.json

Добавьте Python зависимости в package.json:

```json
{
  "scripts": {
    "start": "node index.js",
    "dev": "node index.js", 
    "postinstall": "pip3 install pyrogram tgcrypto || echo 'Python packages install failed'"
  },
  "engines": {
    "node": ">=16.0.0",
    "python": ">=3.8.0"
  }
}
```

---

## 🐍 ШАГ 2: Создать Dockerfile для Railway

Создайте файл `Dockerfile`:

```dockerfile
FROM node:18

# Установка Python
RUN apt-get update && apt-get install -y python3 python3-pip

# Рабочая директория
WORKDIR /app

# Копирование файлов
COPY package*.json ./
COPY requirements.txt ./

# Установка зависимостей
RUN npm install
RUN pip3 install -r requirements.txt

# Копирование остальных файлов
COPY . .

# Порт
EXPOSE 3000

# Запуск
CMD ["npm", "start"]
```

---

## 📋 ШАГ 3: Обновить .gitignore

Добавьте в `.gitignore`:

```
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
*.session
*.session-journal

# Agent files
userbot_queue.db
userbot-agent.log
logs/
```

---

## 🚀 ШАГ 4: Деплой на Railway

```bash
# 1. Добавить все файлы
git add .

# 2. Коммит
git commit -m "добавлен автоматический вывод звёзд"

# 3. Пуш
git push origin main
```

---

## ⚙️ ШАГ 5: Настройка Railway

### В настройках Railway проекта:

1. **Variables (переменные окружения):**
   ```
   BOT_TOKEN=ваш_токен_бота
   DATABASE_URL=ваша_neon_база
   ADMIN_CHANNEL=@kirbyvivodstars  
   PAYMENTS_CHANNEL=@kirbystarspayments
   ```

2. **Settings → Deploy:**
   - Build Command: `npm install && pip3 install -r requirements.txt`
   - Start Command: `npm start`

3. **Runtime:**
   - Enable Python runtime (если доступно)

---

## 🔐 ШАГ 6: Первая авторизация на Railway

**ПРОБЛЕМА:** На Railway нельзя интерактивно вводить SMS код!

**РЕШЕНИЕ:** Авторизируйтесь локально, затем загрузите сессию:

### Локально:
```bash
# 1. Авторизуйтесь локально
python3 userbot-agent.py
# Введите SMS код и 2FA

# 2. Найдите файл сессии
ls *.session
# Должен появиться userbot_session.session
```

### На Railway:
1. **Загрузите файл сессии** в репозиторий
2. **Добавьте в git:**
   ```bash
   git add userbot_session.session
   git commit -m "добавлена сессия агента"
   git push origin main
   ```

**⚠️ БЕЗОПАСНОСТЬ:** Файл сессии содержит доступ к аккаунту!

---

## ✅ ШАГ 7: Проверка работы

После деплоя:

1. **Проверьте логи Railway** на ошибки
2. **Напишите боту:** `/agent_status`
3. **Тестируйте на малых суммах:** 5-15 звёзд

---

## 🚨 ВОЗМОЖНЫЕ ПРОБЛЕМЫ

### Проблема 1: Python не установлен
**Решение:** Используйте Dockerfile выше

### Проблема 2: Сессия не работает
**Решение:** Пере-авторизуйтесь локально и загрузите новую сессию

### Проблема 3: Агент не запускается
**Решение:** Проверьте логи Railway и переменные окружения

---

## 📊 МОНИТОРИНГ НА RAILWAY

Команды для проверки:
- `/agent_status` - статус агента
- `/agent_logs` - логи агента  
- Railway Logs - логи всего приложения

---

## 🎯 АЛЬТЕРНАТИВНЫЙ ВАРИАНТ

**Если Python на Railway не работает:**

1. **Отключите агент** в коде:
   ```javascript
   // В agent-integration.js
   const AGENT_ENABLED = false; // Отключить агент
   ```

2. **Запустите агент отдельно** на другом сервере
3. **Используйте только ручную обработку** заявок

---

## ✅ ГОТОВО!

После успешного деплоя система будет работать автоматически:
- **Малые суммы** - автоматическая отправка
- **Крупные суммы** - ручное подтверждение через кнопки
- **Мониторинг** - через команды бота
