#!/bin/bash

echo "🛑 Остановка предыдущих экземпляров бота..."
pkill -f "node.*index.js"

echo "⏳ Ожидание 2 секунды..."
sleep 2

echo "🚀 Запуск бота..."
npm start
