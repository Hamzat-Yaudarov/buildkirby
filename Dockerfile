# Используем Node Alpine как базовый образ
FROM node:18-alpine

# Устанавливаем необходимые зависимости для Python и сборки
RUN apk add --no-cache python3 py3-pip python3-dev build-base

# Создаём виртуальное окружение для Python
RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"

# Рабочая директория
WORKDIR /app

# Копируем package.json и package-lock.json, ставим Node зависимости
COPY package*.json ./
RUN npm install --production

# Копируем requirements.txt и ставим Python зависимости в виртуальное окружение
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь остальной код
COPY . .

# Создаём директорию для базы данных
RUN mkdir -p data

# Открываем порт
EXPOSE 3000

# Запуск бота
CMD ["npm", "start"]