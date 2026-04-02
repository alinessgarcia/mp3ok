FROM alpine:3.19

# Install runtime deps + build toolchain required by gifsicle npm package on Alpine
RUN apk add --no-cache \
    nodejs \
    npm \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    build-base \
    autoconf \
    automake \
    libtool \
    bash

# Download and install the latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package descriptors and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy backend source code
COPY ./src ./src

# Expose backend port
EXPOSE 4000

# Start server
CMD ["npm", "start"]
