FROM nginx:stable-alpine-otel

ARG PROJECT_NAME
ARG ENVIRONMENT

ENV NGINX_PORT="80"
ENV NGINX_ENTRYPOINT_QUIET_LOGS="1"

ADD dist/angular/${PROJECT_NAME} /usr/share/nginx/html
