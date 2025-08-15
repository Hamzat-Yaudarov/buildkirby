FROM node:18-alpine

# Устанавливаем Python и venv
RUN apk add --no-cache python3 py3-pip python3-venv

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем npm зависимости
RUN npm install --production

# Копируем остальные файлы
COPY . .

# Создаем виртуальное окружение для Python
RUN python3 -m venv venv
# Активируем venv и устанавливаем зависимости
RUN . venv/bin/activate && pip install --no-cache-dir -r requirements.txt

# Создаем папку для базы
RUN mkdir -p data

EXPOSE 3000

# Активируем venv при запуске и стартуем бота
CMD ["/bin/sh", "-c", ". venv/bin/activate && npm start"]