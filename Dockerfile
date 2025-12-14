FROM node:20

RUN apt-get update && \
    apt-get install -y yt-dlp ffmpeg

WORKDIR /app
COPY . .
RUN npm install

EXPOSE 3000
CMD ["node", "index.js"]
