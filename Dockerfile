FROM node:18-alpine

# Устанавливаем Python и pip
RUN apk add --no-cache python3 py3-pip

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json и requirements.txt
COPY package*.json ./
COPY requirements.txt ./

# Устанавливаем зависимости Node.js
RUN npm install --production

# Устанавливаем зависимости Python
RUN pip3 install --no-cache-dir -r requirements.txt

# Копируем исходный код
COPY . .

# Создаем директорию для базы данных
RUN mkdir -p data

# Открываем порт (Railway сам присваивает порт)
EXPOSE 3000

# Запускаем бот
CMD ["npm", "start"]