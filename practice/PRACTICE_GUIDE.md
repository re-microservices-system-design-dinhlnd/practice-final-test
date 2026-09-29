# 🛒 Mini E-Commerce Microservice – Hướng dẫn Tự Build

> **Mục tiêu:** Tự tay build một hệ thống microservice hoàn chỉnh áp dụng TẤT CẢ patterns đã học
> **Thời gian:** ~4-6 giờ thực hành
> **Phong cách:** Đọc hướng dẫn → Tự code → Kiểm tra checklist

---

## 🏗️ Kiến trúc Tổng quan

```
                        ┌─────────────────────────┐
                        │      Config Server       │  :8888
                        │  (Spring Cloud Config)   │
                        └────────────┬────────────┘
                                     │ (tất cả services fetch config từ đây)
                        ┌────────────▼────────────┐
                        │     Eureka Server        │  :8761
                        │  (Service Discovery)     │
                        └────────────┬────────────┘
                                     │ (tất cả services đăng ký vào đây)
                        ┌────────────▼────────────┐
                        │      API Gateway         │  :8080
                        │  (Spring Cloud Gateway)  │
                        └──────────────────────────┘
                         /users  /products  /orders
                            │         │        │
              ┌─────────────┘    ┌────┘    ┌───┘
              │                  │         │
    ┌─────────▼────┐  ┌──────────▼──┐  ┌───▼────────────┐
    │ User Service │  │Product Svc  │  │  Order Service  │
    │    :8081     │  │   :8082     │  │     :8083       │
    └─────────┬────┘  └──────────┬──┘  └───┬────────────┘
              │                  │          │
         [MySQL]            [MySQL]    [Kafka Topic]
                                           │
                              ┌────────────┴──────────┐
                              │                       │
                    ┌─────────▼──────┐    ┌──────────▼──────┐
                    │Payment Service │    │Notification Svc  │
                    │    :8084       │    │    :8085          │
                    └───────────────┘    └─────────────────┘
                              │
                         [MySQL]
                              
    [Redis Cache] ← Product Service dùng để cache products
    [Kafka] ← Order Service publish, Payment + Notification consume
```

---

## 📦 Danh sách Services cần tạo

| # | Service | Port | Chức năng chính | Pattern áp dụng |
|---|---------|------|----------------|----------------|
| 1 | `config-server` | 8888 | Cung cấp config trung tâm | Spring Cloud Config |
| 2 | `eureka-server` | 8761 | Service Registry | Eureka |
| 3 | `api-gateway` | 8080 | Entry point, routing | Gateway, Load Balancing |
| 4 | `user-service` | 8081 | CRUD User | Eureka Client |
| 5 | `product-service` | 8082 | CRUD Product + Cache | Eureka Client, Redis Cache |
| 6 | `order-service` | 8083 | Tạo đơn hàng, Saga Orchestrator | FeignClient, Kafka Producer, Circuit Breaker, Saga |
| 7 | `payment-service` | 8084 | Xử lý thanh toán | Kafka Consumer, Saga |
| 8 | `notification-service` | 8085 | Gửi thông báo | Kafka Consumer |

---

## 🗂️ Cấu trúc thư mục Project

```
ecommerce-microservice/
├── config-server/
├── eureka-server/
├── api-gateway/
├── user-service/
├── product-service/
├── order-service/
├── payment-service/
├── notification-service/
└── config-repo/          ← Git repo chứa tất cả config files
    ├── application.yml
    ├── user-service.yml
    ├── product-service.yml
    ├── order-service.yml
    ├── payment-service.yml
    └── notification-service.yml
```

---

## 🔧 Infrastructure cần cài đặt

Trước khi bắt đầu, đảm bảo bạn có:

```bash
# Kiểm tra Java
java -version  # Cần Java 17+

# Kiểm tra Maven
mvn -version

# Start Kafka (dùng Docker)
docker-compose up -d  # ← File docker-compose.yml ở bên dưới

# Kiểm tra Kafka đang chạy
docker ps
```

**docker-compose.yml** (tạo ở root folder):
```yaml
version: '3.8'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.4.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
    ports:
      - "2181:2181"

  kafka:
    image: confluentinc/cp-kafka:7.4.0
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: true

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: ecommerce
    ports:
      - "3306:3306"
```

---

## 📋 STEP-BY-STEP BUILD GUIDE

---

## STEP 1: Config Server (Ngày 2 – Session 03)

### Tạo project
Vào [start.spring.io](https://start.spring.io) hoặc dùng IntelliJ:
- **Group:** `com.ecommerce`
- **Artifact:** `config-server`
- **Dependencies:** `Config Server`

### Checklist tự build

- [ ] **1.1** Tạo Spring Boot project với dependency `spring-cloud-config-server`
- [ ] **1.2** Thêm `@EnableConfigServer` vào main class
- [ ] **1.3** Cấu hình `application.yml`:
  ```yaml
  server:
    port: 8888
  spring:
    application:
      name: config-server
    cloud:
      config:
        server:
          git:
            uri: file://${user.home}/config-repo  # Dùng local git repo
            default-label: main
  ```
- [ ] **1.4** Tạo thư mục `config-repo` trên máy, init git, tạo `application.yml` chứa:
  ```yaml
  # Shared config cho tất cả services
  eureka:
    client:
      service-url:
        defaultZone: http://localhost:8761/eureka/
  ```
- [ ] **1.5** Chạy Config Server, kiểm tra: `http://localhost:8888/user-service/default`

### ✅ Checkpoint
Config Server đang chạy và trả về config khi gọi `GET /user-service/default`

---

## STEP 2: Eureka Server (Ngày 2 – Session 03)

### Checklist tự build

- [ ] **2.1** Tạo project với dependency `Eureka Server`
- [ ] **2.2** Thêm `@EnableEurekaServer` vào main class
- [ ] **2.3** Cấu hình `bootstrap.yml`:
  ```yaml
  spring:
    application:
      name: eureka-server
    config:
      import: "configserver:http://localhost:8888"
  ```
- [ ] **2.4** Tạo `eureka-server.yml` trong config-repo:
  ```yaml
  server:
    port: 8761
  eureka:
    instance:
      hostname: localhost
    client:
      register-with-eureka: false
      fetch-registry: false
  ```
- [ ] **2.5** Chạy Eureka, kiểm tra dashboard: `http://localhost:8761`

### ✅ Checkpoint
Eureka dashboard hiển thị, chưa có service nào đăng ký

---

## STEP 3: API Gateway (Ngày 3 – Session 05)

### Checklist tự build

- [ ] **3.1** Tạo project với dependencies: `Gateway`, `Eureka Discovery Client`
- [ ] **3.2** Tạo `api-gateway.yml` trong config-repo:
  ```yaml
  server:
    port: 8080
  spring:
    cloud:
      gateway:
        routes:
          - id: user-service
            uri: lb://user-service
            predicates:
              - Path=/api/users/**
            filters:
              - StripPrefix=1
          - id: product-service
            uri: lb://product-service
            predicates:
              - Path=/api/products/**
            filters:
              - StripPrefix=1
          - id: order-service
            uri: lb://order-service
            predicates:
              - Path=/api/orders/**
            filters:
              - StripPrefix=1
  ```
- [ ] **3.3** Tạo `GlobalLoggingFilter` implements `GlobalFilter`:
  ```java
  // Log mỗi request vào/ra Gateway
  log.info("Request: {} {}", request.getMethod(), request.getURI());
  ```
- [ ] **3.4** Chạy Gateway, check service đã đăng ký vào Eureka chưa

### ✅ Checkpoint
Gateway đã đăng ký trong Eureka dashboard

---

## STEP 4: User Service (Ngày 2 – Session 03)

### Entities & APIs cần implement

```
GET  /users/{id}       → Lấy thông tin user
POST /users            → Tạo user mới
PUT  /users/{id}       → Cập nhật user
```

### Checklist tự build

- [ ] **4.1** Tạo project với dependencies: `Web`, `JPA`, `MySQL`, `Eureka Client`, `Config Client`, `Actuator`
- [ ] **4.2** Tạo `user-service.yml` trong config-repo với database config
- [ ] **4.3** Tạo entity `User` (id, name, email, phone)
- [ ] **4.4** Tạo `UserRepository extends JpaRepository`
- [ ] **4.5** Tạo `UserService` với các methods CRUD
- [ ] **4.6** Tạo `UserController` với các endpoints
- [ ] **4.7** Tạo `UserDTO` để trả về (không expose entity trực tiếp)
- [ ] **4.8** Chạy và test: `GET http://localhost:8081/users/1`

### ✅ Checkpoint
User Service chạy, đăng ký vào Eureka, gọi được qua Gateway: `GET http://localhost:8080/api/users/1`

---

## STEP 5: Product Service + Redis Cache (Ngày 3 + 6 – Session 05, 16)

### APIs cần implement

```
GET  /products/{id}    → Lấy product (CÓ CACHE)
GET  /products         → Lấy danh sách products
POST /products         → Tạo product
PUT  /products/{id}    → Cập nhật product (INVALIDATE CACHE)
```

### Checklist tự build

- [ ] **5.1** Dependencies: `Web`, `JPA`, `MySQL`, `Redis`, `Cache`, `Eureka Client`, `Config Client`
- [ ] **5.2** Thêm `@EnableCaching` vào main class
- [ ] **5.3** Tạo entity `Product` (id, name, price, stock, category)
- [ ] **5.4** Tạo `ProductDTO implements Serializable` (QUAN TRỌNG: Redis cần serialize)
- [ ] **5.5** Áp dụng annotations:
  ```java
  @Cacheable(value = "products", key = "#id")
  public ProductDTO getProduct(Long id) { ... }
  
  @CacheEvict(value = "products", key = "#id")
  public ProductDTO updateProduct(Long id, ...) { ... }
  
  @CachePut(value = "products", key = "#result.id")
  public ProductDTO createProduct(...) { ... }
  ```
- [ ] **5.6** Config Redis trong `product-service.yml`:
  ```yaml
  spring:
    data:
      redis:
        host: localhost
        port: 6379
    cache:
      type: redis
      redis:
        time-to-live: 1800000  # 30 phút
  ```
- [ ] **5.7** Test cache: Gọi GET /products/1 lần 1 (xem log "Fetching from DB"), lần 2 không thấy log

### ✅ Checkpoint
Product có cache: Lần đầu query DB, lần sau lấy từ Redis

---

## STEP 6: Order Service (Ngày 3+4+5 – Session 06, 10, 12, 14)

### APIs cần implement

```
POST /orders           → Tạo đơn hàng (SAGA bắt đầu)
GET  /orders/{id}      → Lấy thông tin đơn hàng
GET  /orders/user/{userId} → Lấy đơn hàng của user
```

### Checklist tự build

**6A. Setup FeignClient (Session 06):**
- [ ] **6A.1** Dependency: thêm `spring-cloud-starter-openfeign`
- [ ] **6A.2** `@EnableFeignClients` trên main class
- [ ] **6A.3** Tạo `UserServiceClient`:
  ```java
  @FeignClient(name = "user-service", fallback = UserClientFallback.class)
  public interface UserServiceClient {
      @GetMapping("/users/{id}")
      UserDTO getUserById(@PathVariable Long id);
  }
  ```
- [ ] **6A.4** Tạo `ProductServiceClient` tương tự
- [ ] **6A.5** Tạo Fallback class cho từng client
- [ ] **6A.6** Bật circuit breaker cho Feign trong config

**6B. Setup Kafka Producer (Session 10):**
- [ ] **6B.1** Dependency: thêm `spring-kafka`
- [ ] **6B.2** Tạo `OrderEvent` POJO (orderId, userId, productId, amount, status)
- [ ] **6B.3** Config Kafka trong `order-service.yml`
- [ ] **6B.4** Tạo `OrderEventPublisher`:
  ```java
  kafkaTemplate.send("order-events", event);
  ```

**6C. Setup Circuit Breaker (Session 12):**
- [ ] **6C.1** Dependency: `resilience4j-spring-boot3`, `spring-boot-starter-aop`
- [ ] **6C.2** Config Circuit Breaker trong yml
- [ ] **6C.3** Áp dụng `@CircuitBreaker` khi gọi Product Service để check stock:
  ```java
  @CircuitBreaker(name = "product-service-cb", fallbackMethod = "productFallback")
  public ProductDTO checkProduct(Long productId) { ... }
  ```

**6D. Order Creation với Saga Choreography (Session 14):**
- [ ] **6D.1** Tạo flow: `createOrder()` → Validate user → Check product → Save order (PENDING) → Publish `order-created` event
- [ ] **6D.2** Lắng nghe `payment-processed` event → Update order status CONFIRMED
- [ ] **6D.3** Lắng nghe `payment-failed` event → Update order status CANCELLED

### ✅ Checkpoint
Tạo order → Log thấy event được publish → Order status = PENDING

---

## STEP 7: Payment Service (Ngày 5 – Session 14)

### Checklist tự build

- [ ] **7.1** Dependency: `Web`, `JPA`, `MySQL`, `spring-kafka`, `Eureka Client`, `Config Client`
- [ ] **7.2** Tạo `Payment` entity (id, orderId, amount, status)
- [ ] **7.3** Tạo Kafka Consumer lắng nghe `order-created`:
  ```java
  @KafkaListener(topics = "order-events", groupId = "payment-group")
  public void handleOrderCreated(OrderEvent event) {
      if ("ORDER_CREATED".equals(event.getStatus())) {
          processPayment(event);
      }
  }
  ```
- [ ] **7.4** Logic `processPayment()`:
  - Lưu Payment với status PROCESSING
  - Mock payment (random 80% success, 20% fail)
  - Publish `payment-processed` hoặc `payment-failed` event

**Compensating Transaction:**
- [ ] **7.5** Lắng nghe `payment-rollback` event → Hoàn tiền → Publish `payment-refunded`

### ✅ Checkpoint
Sau khi tạo order → Payment Service nhận event → Xử lý → Publish result → Order status cập nhật

---

## STEP 8: Notification Service (Ngày 4 – Session 10)

### Checklist tự build

- [ ] **8.1** Dependency: `Web`, `spring-kafka`, `Eureka Client`, `Config Client`
- [ ] **8.2** Tạo Consumer lắng nghe nhiều topics:
  ```java
  @KafkaListener(topics = {"payment-events"}, groupId = "notification-group")
  public void handlePaymentEvent(PaymentEvent event) {
      if ("PAYMENT_SUCCESS".equals(event.getStatus())) {
          sendOrderConfirmationEmail(event);
      } else {
          sendOrderFailureEmail(event);
      }
  }
  ```
- [ ] **8.3** Mock `sendEmail()` → chỉ cần log ra console

### ✅ Checkpoint
Thấy log "Email sent to user..." sau khi payment được xử lý

---

## 🧪 Test Toàn bộ Flow

### Thứ tự khởi động services
```
1. Config Server    (8888) ← Bắt buộc khởi động đầu tiên
2. Eureka Server    (8761)
3. User Service     (8081)
4. Product Service  (8082)
5. Order Service    (8083)
6. Payment Service  (8084)
7. Notification Svc (8085)
8. API Gateway      (8080) ← Khởi động sau cùng
```

### Happy Path Test
```bash
# 1. Tạo user
curl -X POST http://localhost:8080/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Nguyen Van A", "email": "a@test.com"}'
# → Nhận được userId: 1

# 2. Tạo product
curl -X POST http://localhost:8080/api/products \
  -H "Content-Type: application/json" \
  -d '{"name": "iPhone 15", "price": 999.99, "stock": 100}'
# → Nhận được productId: 1

# 3. Tạo order (kích hoạt Saga)
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "productId": 1, "quantity": 1}'
# → Nhận được orderId: 1, status: PENDING

# 4. Đợi vài giây rồi check order status
curl http://localhost:8080/api/orders/1
# → status: CONFIRMED (hoặc CANCELLED nếu payment fail)

# 5. Test Cache - gọi product 2 lần
curl http://localhost:8080/api/products/1  # Lần 1: query DB
curl http://localhost:8080/api/products/1  # Lần 2: từ Redis Cache

# 6. Check Eureka Dashboard
# http://localhost:8761
# → Thấy tất cả services đã registered
```

### Failure Scenarios Test
```bash
# Tắt Payment Service → Test Circuit Breaker
# → Order Service nên dùng fallback, không crash

# Gửi request với userId không tồn tại
curl -X POST http://localhost:8080/api/orders \
  -d '{"userId": 999, "productId": 1, "quantity": 1}'
# → FeignClient fallback hoạt động

# Test Kafka consumer
# Tắt Notification Service → Restart → Thấy nó xử lý messages bị missed
```

---

## 🎯 Bảng Kiểm tra Cuối (Self Assessment)

Sau khi build xong, tick vào những gì bạn đã làm được:

### Infrastructure
- [ ] Config Server hoạt động, services fetch config từ Git repo
- [ ] Eureka Dashboard hiển thị tất cả services
- [ ] API Gateway routing đúng đến từng service
- [ ] Có ít nhất 1 custom Gateway Filter

### Communication
- [ ] FeignClient gọi được User Service từ Order Service
- [ ] FeignClient có Fallback hoạt động đúng
- [ ] Kafka Producer publish được event
- [ ] Kafka Consumer nhận và xử lý event

### Resilience
- [ ] Circuit Breaker mở khi service bị down
- [ ] Fallback method được gọi khi Circuit Breaker OPEN
- [ ] Circuit Breaker tự close lại sau khi service recover

### Saga Pattern
- [ ] Order tạo ra với status PENDING
- [ ] Payment xử lý thành công → Order status CONFIRMED
- [ ] Payment thất bại → Order status CANCELLED (Compensating transaction)

### Caching
- [ ] Lần đầu gọi product → Log "Fetching from DB"
- [ ] Lần 2 gọi product → Không thấy log DB, nhanh hơn
- [ ] Update product → Cache bị xóa, lần gọi sau query lại DB

---

## 💡 Tips khi gặp lỗi

| Lỗi thường gặp | Nguyên nhân | Cách fix |
|---------------|-------------|---------|
| `Connection refused :8888` | Config Server chưa chạy | Khởi động Config Server trước |
| Service không đăng ký Eureka | Thiếu `spring.application.name` | Thêm vào config |
| FeignClient 404 | Sai path hoặc service name | Kiểm tra @FeignClient(name=...) |
| Kafka consumer không nhận | Sai `groupId` hoặc topic name | Kiểm tra topic name khớp |
| Redis serialization error | DTO không implements Serializable | Thêm `implements Serializable` |
| Circuit Breaker không hoạt động | Thiếu `spring-boot-starter-aop` | Thêm dependency |
