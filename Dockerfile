FROM node:20-slim

RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Копируем папку credentials целиком
COPY credentials ./credentials

RUN mkdir -p generated_images

EXPOSE 3000

CMD ["node", "server.js"]