FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p data && chown -R node:node /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
