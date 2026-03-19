FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o relay-server .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=build /app/relay-server /usr/local/bin/relay-server
EXPOSE 4001
ENV RELAY_PORT=4001
CMD ["relay-server"]
