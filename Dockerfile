# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm install --production && \
    apk del python3 make g++

COPY src ./src
COPY public ./public

EXPOSE 3015

CMD ["npm", "start"]
