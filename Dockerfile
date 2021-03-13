FROM node:14.16.0-alpine3.13 AS BUILD_IMAGE
WORKDIR /usr/src/app
COPY . /usr/src/app
RUN npm ci --only=production && yarn add uWebSockets.js@uNetworking/uWebSockets.js#v18.14.0


FROM node:14.16.0-alpine3.13

COPY --from=BUILD_IMAGE /usr/src/app/ .
RUN ./setup_sockets.sh

CMD "node" "index.js"