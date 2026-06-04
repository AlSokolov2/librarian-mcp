# Используем легковесный образ Node.js
FROM node:20-slim

# Устанавливаем системные зависимости
RUN apt-get update && apt-get install -y \
    git \
    grep \
    openssl \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Создаем рабочую директорию и настраиваем права для пользователя node
WORKDIR /app
RUN chown -R node:node /app

# Переключаемся на пользователя node
USER node

# Копируем конфиги зависимостей
COPY --chown=node:node package*.json ./
COPY --chown=node:node tsconfig.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY --chown=node:node src ./src

# Собираем проект
RUN npm run build

# Создаем точку монтирования
RUN mkdir -p /app/knowledge-hub

# Настраиваем Git Identity для автоматических коммитов
RUN git config --global user.name "AI Librarian" && \
    git config --global user.email "librarian@knowledge-hub.local" && \
    git config --global --add safe.directory /app/knowledge-hub

ENV KNOWLEDGE_HUB_PATH=/app/knowledge-hub

# Открываем порт для Ingest API
EXPOSE 3000

CMD ["node", "build/index.js"]
