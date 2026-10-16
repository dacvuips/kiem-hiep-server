# Build context = thư mục server/ (xem docker-compose.yml).
FROM node:20-alpine AS web
WORKDIR /web
COPY admin-web/package.json admin-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY admin-web/ ./
RUN npm run build

FROM node:20-alpine AS portal
WORKDIR /web
COPY portal-web/package.json portal-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY portal-web/ ./
RUN npm run build

FROM golang:1.23-alpine AS build
WORKDIR /src
COPY account/go.mod account/go.sum ./
RUN go mod download
COPY account/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /account .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /account /account
COPY --from=web /web/dist /admin-web
COPY --from=portal /web/dist /portal-web
ENV ADMIN_WEB_DIR=/admin-web
ENV PORTAL_WEB_DIR=/portal-web
EXPOSE 8080
ENTRYPOINT ["/account"]
