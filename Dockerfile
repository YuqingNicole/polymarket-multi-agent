FROM node:20-alpine

WORKDIR /app

# Install dependencies only
COPY package*.json ./
RUN npm install --production=false

# Copy source
COPY . .

# Default: run scanner in loop mode
CMD ["npx", "tsx", "src/scanner.ts", "--loop"]
