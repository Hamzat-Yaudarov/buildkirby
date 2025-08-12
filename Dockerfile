FROM node:18-alpine

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Копируем исходный код
COPY . .

# Создаем директорию для базы данных
RUN mkdir -p data

# Открываем порт (Railway автоматически присваивает порт)
EXPOSE 3000

# Запускаем бот
CMD ["npm", "start"]
