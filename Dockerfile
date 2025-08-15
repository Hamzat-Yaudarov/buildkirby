# Базовый образ
FROM node:18-bullseye

# Устанавливаем Python, сборку и Rust
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv build-essential rustc cargo \
 && rm -rf /var/lib/apt/lists/*

# Создаём виртуальное окружение для Python
RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"

# Рабочая директория
WORKDIR /app

# Копируем Node-зависимости и ставим их
COPY package*.json ./
RUN npm install --production

# Копируем Python-зависимости и ставим их
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Копируем остальной код
COPY . .

# Создаём директорию для базы данных
RUN mkdir -p /app/data

# Открываем порт
EXPOSE 3000

# Запуск
CMD ["npm", "start"]

# Запуск бота
CMD ["npm", "start"]

