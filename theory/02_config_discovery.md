# Session 03+04: Configuration, Service Registration & Discovery

---

## PHẦN 1: Spring Cloud Config Server

### 1. Tại sao cần Config Server?

**Vấn đề với Monolithic:**
```yaml
# application.properties (hardcode trong từng service)
db.url=jdbc:mysql://localhost:3306/mydb
db.password=secret123
kafka.broker=localhost:9092
```

**Vấn đề:** 100 services → 100 nơi cần sửa config → Deploy lại toàn bộ

**Giải pháp:** Tập trung config vào một nơi → **Config Server**

### 2. Kiến trúc Config Server

```
┌──────────────────┐
│    Git Repo      │  ← Nơi lưu tất cả config files
│  (GitHub/GitLab) │
└────────┬─────────┘
         │ pull config
┌────────▼─────────┐
│  Config Server   │  ← Serve config qua HTTP
│  (Spring Cloud)  │
└────────┬─────────┘
         │ GET /config
    ┌────┴─────────────────┐
    │                      │
┌───▼────┐           ┌─────▼───┐
│Service │           │ Service │
│   A    │           │   B     │
└────────┘           └─────────┘
```

### 3. Setup Config Server

**Dependencies (pom.xml):**
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-config-server</artifactId>
</dependency>
```

**Main class:**
```java
@SpringBootApplication
@EnableConfigServer  // ← Annotation quan trọng!
public class ConfigServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(ConfigServerApplication.class, args);
    }
}
```

**application.yml của Config Server:**
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
          uri: https://github.com/your-repo/config-repo
          default-label: main
          search-paths: configs
```

### 4. Setup Config Client

**Dependencies:**
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-config</artifactId>
</dependency>
```

**bootstrap.yml (hoặc application.yml với Spring Boot 2.4+):**
```yaml
spring:
  application:
    name: order-service  # ← phải khớp với tên file config trên Git
  config:
    import: "configserver:http://localhost:8888"
```

### 5. Cấu trúc file config trên Git Repo

```
config-repo/
├── application.yml          ← Config chung cho tất cả services
├── order-service.yml        ← Config riêng cho order-service
├── order-service-dev.yml    ← Config riêng cho profile dev
└── order-service-prod.yml   ← Config riêng cho profile prod
```

**Quy tắc ưu tiên (priority):**
`{app-name}-{profile}.yml` > `{app-name}.yml` > `application.yml`

### 6. Refresh Config (không cần restart)

**Thêm dependency:**
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

**Expose endpoint:**
```yaml
management:
  endpoints:
    web:
      exposure:
        include: refresh
```

**Đánh dấu bean cần refresh:**
```java
@RestController
@RefreshScope  // ← Annotation quan trọng!
public class OrderController {
    @Value("${order.timeout:30}")
    private int timeout;
}
```

**Trigger refresh:**
```bash
curl -X POST http://localhost:8080/actuator/refresh
```

---

## PHẦN 2: Service Registration & Discovery (Eureka)

### 1. Vấn đề: Service Location

Trong Microservice, địa chỉ IP và port của service có thể thay đổi:
- Scaling up/down → Instance mới với IP khác
- Container restart → IP mới
- Cloud environment → IP dynamic

**Giải pháp:** Service Discovery

### 2. Hai loại Service Discovery

#### Client-Side Discovery (Eureka approach)
```
Client → Eureka → lấy danh sách instances → chọn 1 → gọi trực tiếp
```

#### Server-Side Discovery
```
Client → Load Balancer → LB hỏi Registry → LB chọn & forward
```

### 3. Eureka Server Setup

**Dependency:**
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-eureka-server</artifactId>
</dependency>
```

**Main class:**
```java
@SpringBootApplication
@EnableEurekaServer  // ← Annotation quan trọng!
public class EurekaServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(EurekaServerApplication.class, args);
    }
}
```

**application.yml:**
```yaml
server:
  port: 8761

spring:
  application:
    name: eureka-server

eureka:
  instance:
    hostname: localhost
  client:
    register-with-eureka: false  # Server không tự đăng ký
    fetch-registry: false        # Server không cần fetch
  server:
    wait-time-in-ms-when-sync-empty: 0
```

### 4. Eureka Client Setup

**Dependency:**
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-eureka-client</artifactId>
</dependency>
```

**application.yml:**
```yaml
spring:
  application:
    name: order-service

eureka:
  client:
    service-url:
      defaultZone: http://localhost:8761/eureka/
  instance:
    prefer-ip-address: true
```

### 5. Cơ chế hoạt động của Eureka

```
Timeline:
T=0s: Service đăng ký với Eureka (registration)
T=30s: Service gửi heartbeat (renewal interval mặc định: 30s)
T=90s: Nếu không có heartbeat → Eureka xóa service (eviction)

Eureka Dashboard: http://localhost:8761
```

**Eureka tự động:**
1. Service đăng ký khi khởi động
2. Gửi heartbeat định kỳ
3. Hủy đăng ký khi shutdown gracefully

### 6. Gọi service qua Eureka (DiscoveryClient)

```java
@Autowired
private DiscoveryClient discoveryClient;

public String callOrderService() {
    List<ServiceInstance> instances = 
        discoveryClient.getInstances("order-service");
    
    if (instances.isEmpty()) {
        throw new RuntimeException("No instances available");
    }
    
    // Lấy instance đầu tiên
    ServiceInstance instance = instances.get(0);
    String url = instance.getUri() + "/orders";
    
    return restTemplate.getForObject(url, String.class);
}
```

### 7. Sử dụng với @LoadBalanced RestTemplate

```java
@Configuration
public class RestTemplateConfig {
    
    @Bean
    @LoadBalanced  // ← Tích hợp Eureka + Load Balancing tự động
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}

// Sử dụng service name thay vì URL cụ thể
String result = restTemplate.getForObject(
    "http://order-service/orders",  // ← Dùng service name
    String.class
);
```

---

## PHẦN 3: So sánh & Tổng hợp

| Tính năng | Config Server | Eureka |
|-----------|--------------|--------|
| **Mục đích** | Quản lý configuration | Quản lý service location |
| **Port mặc định** | 8888 | 8761 |
| **Annotation Server** | @EnableConfigServer | @EnableEurekaServer |
| **Storage** | Git repo | In-memory (+ tự đồng bộ cluster) |
| **Refresh** | POST /actuator/refresh | Tự động |

---

## ❓ Câu hỏi Ôn tập

1. Tại sao trong Microservice cần Config Server thay vì để config trong từng service?
2. Giải thích ý nghĩa của `@RefreshScope`. Khi nào cần dùng?
3. Thứ tự ưu tiên config khi có cả `application.yml`, `order-service.yml` và `order-service-dev.yml`?
4. Phân biệt Client-Side Discovery vs Server-Side Discovery
5. Eureka xử lý thế nào khi một service instance bị down?
6. Tại sao cần `@LoadBalanced` khi dùng RestTemplate với Eureka?
7. Giải thích quá trình một service đăng ký vào Eureka từ lúc khởi động
8. `register-with-eureka: false` trên Eureka Server có nghĩa gì?
9. Interval heartbeat mặc định của Eureka là bao lâu?
10. Nếu Config Server down, các service đang chạy có bị ảnh hưởng không?

---

## 💡 Key Takeaways

```
Config Server:
  Bootstrap order: Config Server → fetch config → start service

Eureka:
  Register → Heartbeat → Discovery → Load Balance

Cần nhớ:
  @EnableConfigServer  = biến app thành Config Server
  @EnableEurekaServer  = biến app thành Eureka Server
  @RefreshScope        = bean sẽ được refresh khi POST /actuator/refresh
  @LoadBalanced        = RestTemplate tích hợp Eureka + LB
```
