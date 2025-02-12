FROM node:20.18-alpine

# Bundle APP files
RUN mkdir -p /app

WORKDIR /app

# pm2에서 bash를 사용하기 때문에 설치 
RUN apk add --no-cache bash

COPY ./script /app/script/
COPY ./test /app/test/
COPY ./redis-key /app/redis-key/

COPY package.json .
COPY tsconfig.json .
COPY pm2.json .
COPY standalone-run.sh . 
COPY .env-docker ./.env

ENV NPM_CONFIG_LOGLEVEL warn
RUN npm install pm2 -g
RUN npm install
RUN npm run build 

# Show current folder structure in logs
RUN ls -al -R

EXPOSE 3000

CMD [ "pm2-runtime", "start", "pm2.json" ]
#CMD ["tail", "-f", "/dev/null"]
