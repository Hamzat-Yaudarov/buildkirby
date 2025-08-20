#!/bin/bash

# Скрипт для очистки ненужных файлов из проекта
# Создаёт архив перед удалением для безопасности

echo "🧹 Начинаем очистку ненужных файлов..."

# Создаём архивную папку
mkdir -p tools-archive/docs
mkdir -p tools-archive/tests
mkdir -p tools-archive/migrations
mkdir -p tools-archive/diagnostics
mkdir -p tools-archive/sessions-logs

# 1. Debug/test файлы
echo "📁 Архивируем тестовые файлы..."
for file in \
    test-subgram.js \
    test-subgram-simple.js \
    test-subgram-with-db.js \
    test-subscription-flow.js \
    test-subscription-data.js \
    test-subscription-logic-fix.js \
    test-fixed-subscription-flow.js \
    test-new-features.js \
    test-manual-flow.js \
    test-message-format.js \
    test-unified-subscriptions.js \
    test-withdrawal-security.js \
    test-stars-sending.py \
    test-stars-api.py \
    test-sponsor-fix.js \
    test-subscription-stats.js \
    test-ratings.js \
    test-referral-system.js \
    test-fixes.js \
    test-captcha.js \
    test-captcha-complete.js \
    test-final-subscription-logic.js \
    test-throttling.js \
    create-test-data.js
do
    if [ -f "$file" ]; then
        echo "  Перемещаем $file -> tools-archive/tests/"
        mv "$file" tools-archive/tests/
    fi
done

# 2. Файлы миграции и одноразовые скрипты
echo "📁 Архивируем файлы миграции..."
for file in \
    migrate-data.js \
    migrate-captcha.js \
    fix-referral-duplicates.js \
    fix-subgram-sponsor-channels.js \
    fix-queue-issues.py \
    fix-agent-phone.py \
    fix-userbot-auth.py \
    fix-encoding.js \
    fix-captcha-db.js \
    reset-subscription-notifications.js \
    create-session-fixed.py \
    simple-session-creator.py \
    restore-safe-limits.py \
    set-existing-users-captcha.js
do
    if [ -f "$file" ]; then
        echo "  Перемещаем $file -> tools-archive/migrations/"
        mv "$file" tools-archive/migrations/
    fi
done

# 3. Диагностические файлы
echo "📁 Архивируем диагностические файлы..."
for file in \
    diagnose-userbot.js \
    diagnose-subgram-404-issue.js \
    debug-subgram-status.js \
    debug-saved-channels.js \
    debug-deployment.js \
    check-subgram-logs.js \
    check-subgram-database.js \
    check-subgram-config.js \
    check-integration.js \
    check-current-sponsor-state.js \
    check-hardcoded-channels.js \
    check-sponsor-channels.js \
    railway-diagnostic.js \
    investigate-stars-api.py \
    check-agent-status.js \
    check-db-schema.js \
    clear-cached-sponsor-channels.js \
    clear-old-subgram-channels.js \
    monitor-referrals.js \
    admin-tools.js
do
    if [ -f "$file" ]; then
        echo "  Перемещаем $file -> tools-archive/diagnostics/"
        mv "$file" tools-archive/diagnostics/
    fi
done

# 4. Документация (отчёты и устаревшие гайды)
echo "📁 Архивируем документацию..."
for file in \
    CHANGES_SUMMARY.md \
    FINAL_UPDATES_REPORT.md \
    FINAL_SUCCESS_COMMANDS.md \
    IMPLEMENTATION_REPORT.md \
    CRITICAL_FIXES_REPORT.md \
    FINAL_FIX_INSTRUCTIONS.md \
    ENCODING_FIXES_SUMMARY.md \
    CAPTCHA_IMPLEMENTATION_REPORT.md \
    CAPTCHA_SYSTEM_DOCUMENTATION.md \
    SUBGRAM_CHANGES_SUMMARY.md \
    SUBGRAM_PROBLEM_SOLUTION.md \
    SUBGRAM_DIAGNOSTIC_GUIDE.md \
    SUBGRAM_SPONSORS_FIX_GUIDE.md \
    SUBGRAM_SETUP_GUIDE.md \
    REFERRAL_LOTTERIES_REPORT.md \
    REFERRAL_SECURITY_REPORT.md \
    THROTTLING_FINAL_REPORT.md \
    THROTTLING_IMPLEMENTATION_SUMMARY.md \
    THROTTLING_QUICK_SUMMARY.md \
    FILES_FOR_GIFTS.md \
    MULTIPLE_MESSAGES_FINAL_FIX.md \
    MULTIPLE_MESSAGES_FIX.md \
    SIMPLIFIED_RETROACTIVE_ACTIVATION_REPORT.md \
    WITHDRAWAL_FIXES_REPORT.md \
    WITHDRAWAL_SECURITY_GUIDE.md \
    WITHDRAWAL_SYSTEM_UPDATE.md \
    FIX_AGENT_SIMPLE.md \
    FIX_USERBOT_GUIDE.md \
    AGENT_CONTROL_GUIDE.md \
    STARS_AGENT_GUIDE.md \
    ADMIN_CHANNEL_DIAGNOSTIC_COMMANDS.md \
    ADMIN_CHAT_FIX_GUIDE.md \
    QUICK_FIX.md \
    QUICK_FIX_COMMANDS.md \
    QUICK_CHEATSHEET.md \
    BOT_ADMIN_RIGHTS_EXPLANATION.md \
    BOT_IMPROVEMENTS_PLAN.md \
    BLOCKED_PHONE_SOLUTION.md \
    debug-automation.md \
    LOTTERY_CONSTRAINT_FIX_REPORT.md \
    manual-processing-commands.md \
    NEON_SUBGRAM_FIXES.md \
    NEW_LOTTERY_DESIGN.md \
    RAILWAY_DEPLOY_GUIDE.md \
    REAL_STARS_SOLUTION.md \
    STEP_BY_STEP_GUIDE.md \
    SUBGRAM_404_PROBLEM_SOLVED.md \
    SUBSCRIPTION_BUG_FIXES.md \
    SUBSCRIPTION_FIX_SUMMARY.md \
    SUBSCRIPTION_LOGIC_FIXES.md \
    SUBSCRIPTION_SYNC_FIX.md \
    THROTTLING_SYSTEM.md \
    UNIFIED_SUBSCRIPTION_SYSTEM.md \
    UPDATES_SUMMARY.md \
    ИСПРАВЛЕНИЯ_ОШИБОК.md
do
    if [ -f "$file" ]; then
        echo "  Перемещаем $file -> tools-archive/docs/"
        mv "$file" tools-archive/docs/
    fi
done

# 5. Session файлы и логи (УДАЛЯЕМ ПОЛНОСТЬЮ - могут содержать секреты)
echo "🗑️  Удаляем session файлы и логи..."
for file in \
    test_session.session \
    userbot_session.session \
    userbot-telethon.log
do
    if [ -f "$file" ]; then
        echo "  УДАЛЯЕМ $file (содержит секреты)"
        rm -f "$file"
    fi
done

# 6. CLI утилиты и скрипты настройки
echo "📁 Архивируем CLI утилиты..."
for file in \
    restart-bot.sh \
    setup-agent.sh \
    create-agent-session.py \
    userbot-agent-fixed.py \
    update-subgram-settings.js \
    unified-subscription-check.js
do
    if [ -f "$file" ]; then
        echo "  Перемещаем $file -> tools-archive/diagnostics/"
        mv "$file" tools-archive/diagnostics/
    fi
done

# Подсчитываем результаты
echo ""
echo "📊 Результаты очист��и:"
echo "  🗂️  Тестовые файлы: $(ls tools-archive/tests/ 2>/dev/null | wc -l) файлов"
echo "  🔄 Миграции: $(ls tools-archive/migrations/ 2>/dev/null | wc -l) файлов"
echo "  🔍 Диагностика: $(ls tools-archive/diagnostics/ 2>/dev/null | wc -l) файлов"
echo "  📖 Документация: $(ls tools-archive/docs/ 2>/dev/null | wc -l) файлов"
echo ""
echo "✅ Очистка завершена!"
echo "📂 Архивированные файлы находятся в папке tools-archive/"
echo "🗑️  Session файлы удалены полностью"
echo ""
echo "💡 Для восстановления файла: mv tools-archive/категория/файл.js ./"
echo "💡 Для полного удаления архива: rm -rf tools-archive/"
