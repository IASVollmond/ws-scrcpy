FROM node:18-alpine AS builder
RUN apk add --no-cache git python3 make g++
WORKDIR /ws-scrcpy
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run dist

FROM node:18-alpine
RUN apk add --no-cache android-tools
COPY --from=builder /ws-scrcpy/dist /ws-scrcpy/dist
COPY --from=builder /ws-scrcpy/node_modules /ws-scrcpy/node_modules
WORKDIR /ws-scrcpy/dist
CMD ["node", "index.js"]
