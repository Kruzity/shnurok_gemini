FROM node:20-slim

# Установите необходимые системные пакеты
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходники
COPY . .

# Создаём директорию для изображений
RUN mkdir -p generated_images

# Порт приложения
EXPOSE 3000

CMD ["node", "server.js"]