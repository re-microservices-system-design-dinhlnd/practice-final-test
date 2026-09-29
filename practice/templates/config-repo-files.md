# Config Repo – Tất cả configuration files cho E-Commerce Microservice

---

## 📁 Hướng dẫn Setup Config Repo

```bash
# 1. Tạo thư mục config-repo
mkdir ~/config-repo
cd ~/config-repo
git init
git checkout -b main

# 2. Copy các file config bên dưới vào đây
# 3. Commit
git add .
git commit -m "Initial config"

# 4. Trong Config Server application.yml, trỏ đến thư mục này:
# uri: file://${user.home}/config-repo
```

---

## 📄 File: application.yml (Shared config cho tất cả services)

```yaml
# =====================================================
# SHARED CONFIG - Áp dụng cho TẤT CẢ services
# =====================================================

# Eureka Client config (tất cả services đều cần)
eureka:
  client:
    service-url:
      defaultZone: http://localhost:8761/eureka/
  instance:
    prefer-ip-address: true

# Actuator endpoints
management:
  endpoints:
    web:
      exposure:
        include: health,info,refresh,metrics
  endpoint:
    health:
      show-details: always

# Logging
logging:
  level:
    com.ecommerce: DEBUG
    org.springframework.cloud: INFO
```

---

## 📄 File: eureka-server.yml

```yaml
server:
  port: 8761

eureka:
  instance:
    hostname: localhost
  client:
    register-with-eureka: false
    fetch-registry: false
  server:
    wait-time-in-ms-when-sync-empty: 0
    enable-self-preservation: false  # Tắt self-preservation cho dev
```

---

## 📄 File: api-gateway.yml

```yaml
server:
  port: 8080

spring:
  cloud:
    gateway:
      # Tự động discovery từ Eureka (optional - thay cho config thủ công)
      discovery:
        locator:
          enabled: false  # Tắt để dùng config thủ công bên dưới

      routes:
        # =====================================================
        # USER SERVICE ROUTES
        # =====================================================
        - id: user-service-route
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - StripPrefix=1    # Xóa /api trước khi forward
            - AddRequestHeader=X-Gateway-Source, api-gateway

        # =====================================================
        # PRODUCT SERVICE ROUTES
        # =====================================================
        - id: product-service-route
          uri: lb://product-service
          predicates:
            - Path=/api/products/**
          filters:
            - StripPrefix=1

        # =====================================================
        # ORDER SERVICE ROUTES
        # =====================================================
        - id: order-service-route
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
          filters:
            - StripPrefix=1

      # Global CORS config
      globalcors:
        cors-configurations:
          '[/**]':
            allowed-origins: "*"
            allowed-methods: "*"
            allowed-headers: "*"
```

---

## 📄 File: user-service.yml

```yaml
server:
  port: 8081

spring:
  application:
    name: user-service
  datasource:
    url: jdbc:mysql://localhost:3306/ecommerce_users?createDatabaseIfNotExist=true
    username: root
    password: root
    driver-class-name: com.mysql.cj.jdbc.Driver
  jpa:
    hibernate:
      ddl-auto: update   # Tự tạo bảng nếu chưa có
    show-sql: true
    properties:
      hibernate:
        dialect: org.hibernate.dialect.MySQLDialect
```

---

## 📄 File: product-service.yml

```yaml
server:
  port: 8082

spring:
  application:
    name: product-service
  datasource:
    url: jdbc:mysql://localhost:3306/ecommerce_products?createDatabaseIfNotExist=true
    username: root
    password: root
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true

  # Redis Cache Config
  data:
    redis:
      host: localhost
      port: 6379
      timeout: 2000ms
  cache:
    type: redis
    redis:
      time-to-live: 1800000   # 30 phút (milliseconds)
      cache-null-values: false
```

---

## 📄 File: order-service.yml

```yaml
server:
  port: 8083

spring:
  application:
    name: order-service
  datasource:
    url: jdbc:mysql://localhost:3306/ecommerce_orders?createDatabaseIfNotExist=true
    username: root
    password: root
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true

  # Kafka Producer Config
  kafka:
    bootstrap-servers: localhost:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 3

    consumer:
      group-id: order-service-group
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "com.ecommerce.*"

# FeignClient config
spring:
  cloud:
    openfeign:
      circuitbreaker:
        enabled: true   # Bật Circuit Breaker cho FeignClient

# Resilience4j Circuit Breaker
resilience4j:
  circuitbreaker:
    instances:
      user-service-cb:
        sliding-window-size: 10
        failure-rate-threshold: 50
        wait-duration-in-open-state: 10s
        permitted-number-of-calls-in-half-open-state: 3
        minimum-number-of-calls: 5
        automatic-transition-from-open-to-half-open-enabled: true

      product-service-cb:
        sliding-window-size: 10
        failure-rate-threshold: 50
        wait-duration-in-open-state: 10s
        permitted-number-of-calls-in-half-open-state: 3
        minimum-number-of-calls: 5

  timelimiter:
    instances:
      user-service-cb:
        timeout-duration: 3s
      product-service-cb:
        timeout-duration: 3s
```

---

## 📄 File: payment-service.yml

```yaml
server:
  port: 8084

spring:
  application:
    name: payment-service
  datasource:
    url: jdbc:mysql://localhost:3306/ecommerce_payments?createDatabaseIfNotExist=true
    username: root
    password: root
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true

  # Kafka Consumer + Producer
  kafka:
    bootstrap-servers: localhost:9092
    consumer:
      group-id: payment-service-group
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "com.ecommerce.*"
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
```

---

## 📄 File: notification-service.yml

```yaml
server:
  port: 8085

spring:
  application:
    name: notification-service

  # Kafka Consumer only
  kafka:
    bootstrap-servers: localhost:9092
    consumer:
      group-id: notification-service-group
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "com.ecommerce.*"
```

---

## 📋 Checklist Config Repo

- [ ] Tạo thư mục `~/config-repo` và init git
- [ ] Tạo tất cả 7 files config trên
- [ ] Commit tất cả files
- [ ] Trỏ Config Server đến thư mục này
- [ ] Test: `curl http://localhost:8888/order-service/default` trả về config đúng
