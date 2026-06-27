FROM node:22-alpine
WORKDIR /app
COPY server.js index.html sw.js manifest.webmanifest ./
EXPOSE 8080
CMD ["node", "server.js"]
