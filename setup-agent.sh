#!/bin/bash

echo "🤖 Установка Stars Agent для автоматической отправки звёзд"
echo "============================================================"

# Проверка Python
echo "🔍 Проверка Python..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 не найден! Установите Python 3.8+ для работы агента."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo "✅ Python $PYTHON_VERSION найден"

# Проверка pip
echo "🔍 Проверка pip..."
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 не найден! Установите pip для Python."
    exit 1
fi
echo "✅ pip найден"

# Установка зависимостей
echo "📦 Установка зависимостей Python..."
pip3 install -r requirements.txt

if [ $? -ne 0 ]; then
    echo "❌ Ошибка установки зависимостей!"
    echo "💡 Попробуйте запустить: pip3 install pyrogram tgcrypto"
    exit 1
fi

echo "✅ Зависимости установлены"

# Проверка файлов
echo "🔍 Проверка файлов агента..."
if [ ! -f "userbot-agent.py" ]; then
    echo "❌ Файл userbot-agent.py не найден!"
    exit 1
fi

if [ ! -f "agent-integration.js" ]; then
    echo "❌ Файл agent-integration.js не найден!"
    exit 1
fi

echo "✅ Файлы агента найдены"

# Создание директории для логов
echo "📁 Создание директории для логов..."
mkdir -p logs
chmod 755 logs

# Создание systemd service (опционально)
echo "🔧 Настройка systemd service (опционально)..."
cat > userbot-agent.service << EOF
[Unit]
Description=Telegram Stars Agent
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/python3 $(pwd)/userbot-agent.py
Restart=always
RestartSec=10
StandardOutput=append:$(pwd)/logs/agent-stdout.log
StandardError=append:$(pwd)/logs/agent-stderr.log

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Systemd service создан: userbot-agent.service"

# Информация о безопасности
echo ""
echo "⚠️  ВАЖНАЯ ИНФОРМАЦИЯ О БЕЗОПАСНОСТИ:"
echo "----------------------------------------"
echo "1. 🔒 Агент работает в ТЕСТ-РЕЖИМЕ (максимум 25 звёзд за раз)"
echo "2. ⏰ Лимиты: 10 звёзд/час, 80 звёзд/день"
echo "3. 🕒 Работает только 9:00-23:00 МСК"
echo "4. 🤖 Человекоподобные задержки 1-3 минуты между отправками"
echo "5. ⚠️  РИСК БЛОКИРОВКИ АККАУНТА при детекции автоматизации"
echo ""

# Инструкции по запуску
echo "🚀 ИНСТРУКЦИИ ПО ЗАПУСКУ:"
echo "------------------------"
echo "1. Первый запуск для авторизации:"
echo "   python3 userbot-agent.py"
echo ""
echo "2. Запуск основного бота (агент запустится автоматически):"
echo "   node index.js"
echo ""
echo "3. Управление через админ-панель бота:"
echo "   /admin -> 🤖 Stars Agent"
echo ""
echo "4. Ручные команды:"
echo "   /agent_status - статус агента"
echo "   /agent_logs - логи агента"
echo "   /send_stars_manual USER_ID AMOUNT - отправить звёзды"
echo ""

# Проверка конфигурации
echo "🔧 ПРОВЕРКА КОНФИГУРАЦИИ:"
echo "------------------------"
echo "API_ID: 28085629"
echo "Аккаунт: +7972065986 (@kirbystarsagent)"
echo "Тест-режим: ВКЛЮЧЁН (макс. 25 звёзд)"
echo ""

echo "✅ Установка завершена!"
echo ""
echo "⚡ Для первого запуска выполните:"
echo "   python3 userbot-agent.py"
echo ""
echo "📱 Потребуется ввести код из SMS и возможно 2FA пароль"
echo ""
echo "🎯 После авторизации агент будет готов к автоматической отправке звёзд!"
