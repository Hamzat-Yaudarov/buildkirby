# ⚡ БЫСТРОЕ ИСПРАВЛЕНИЕ - 3 КОМАНДЫ

## 🛑 ПРОБЛЕМА: "database is locked"

Старые процессы блокируют файл сессии.

---

## 🚀 РЕШЕНИЕ (3 команды):

### 1️⃣ Установите зависимость:
```bash
pip install psutil
```

### 2️⃣ Запустите исправленный скрипт:
```bash
python3 create-session-fixed.py
```

### 3️⃣ Если не работает, попробуйте простой:
```bash
python3 simple-session-creator.py
```

---

## 🔧 ЧТО ДЕЛАЮТ СКРИПТЫ:

**create-session-fixed.py:**
- ✅ Убивает блокирующие процессы  
- 🧹 Очищает старые файлы сессии
- 🔐 Создает новую сессию
- 📊 Проверяет результат

**simple-session-creator.py:**
- 🗑️ Удаляет старые файлы
- 📱 Просто создает сессию
- ✅ Без лишних проверок

---

## ⚠️ ЕСЛИ ВСЁ ЕЩЁ НЕ РАБОТАЕТ:

### Вариант 1: Перезагрузка
```bash
# Перезагрузите компьютер и попробуйте снова
python3 simple-session-creator.py
```

### Вариант 2: Ручная очистка
```bash
# Удалите ВСЕ файлы сессии вручную
rm -f userbot_session.*
rm -f *.session*
python3 simple-session-creator.py
```

### Вариант 3: Другая папка
```bash
# Создайте в новой папке
mkdir telegram_session
cd telegram_session
python3 ../simple-session-creator.py
```

---

## ✅ ПОСЛЕ СОЗДАНИЯ СЕССИИ:

1. **Найдите файл:** `userbot_session.session`
2. **Скопируйте в проект Railway**
3. **Сделайте commit и push:**
   ```bash
   git add userbot_session.session
   git commit -m "Add telegram session"
   git push origin main
   ```
4. **Railway перезапустится автоматически**

---

## 🎯 РЕЗУЛ��ТАТ

В логах Railway должно появиться:
```
✅ Авторизован как: [Ваше имя] (@kirbystarsagent)
✅ Агент запущен и готов к работе
```

**АВТОМАТИЧЕСКИЙ ВЫВОД ЗВЁЗД ЗАРАБОТАЕТ!**
