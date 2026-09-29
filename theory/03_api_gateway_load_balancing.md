# Session 05: API Gateway & Load Balancing

---

## PHẦN 1: API Gateway

### 1. Tại sao cần API Gateway?

**Không có API Gateway:**
```
Client → gọi trực tiếp vào từng service
  → Phải biết địa chỉ của 10 services
  → Phải handle Auth ở 10 nơi
  → CORS phải config ở 10 nơi
  → SSL termination ở 10 nơi
```

**Có API Gateway:**
```
Client → API Gateway (single entry point)
  → Gateway lo: Auth, Rate Limiting, CORS, SSL, Logging, Routing
  → Client chỉ cần biết 1 địa chỉ
```

### 2. Chức năng của API Gateway

| Chức năng | Mô tả |
|-----------|-------|
| **Routing** | Điều hướng request đến đúng service |
| **Authentication** | Kiểm tra token/JWT |
| **Rate Limiting** | Giới hạn số request |
| **Load Balancing** | Phân phối traffic |
| **SSL Termination** | Xử lý HTTPS |
| **Request/Response Transform** | Modify headers, body |
| **Circuit Breaker** | Dừng gọi service bị lỗi |
| **Logging & Monitoring** | Ghi log tập trung |

### 3. Spring Cloud Gateway

#### 3 khái niệm cốt lõi:

```
Route = Predicate + Filter(s) + URI

Predicate: Điều kiện để match request
  → Path=/api/orders/**
  → Method=POST
  → Header=X-Request-Id

Filter: Xử lý trước/sau khi forward
  → Pre-filter: Kiểm tra auth, add header
  → Post-filter: Modify response

URI: Địa chỉ đích để forward
  → lb://order-service (lb: = Load Balanced)
  → http://localhost:8082
```

#### Setup:

**Dependency:**
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-eureka-client</artifactId>
</dependency>
```

**application.yml – Cấu hình routes:**
```yaml
spring:
  application:
    name: api-gateway
  cloud:
    gateway:
      routes:
        # Route đến Order Service
        - id: order-service-route
          uri: lb://order-service          # lb:// = load balanced via Eureka
          predicates:
            - Path=/api/orders/**          # Match path pattern
          filters:
            - StripPrefix=1               # Xóa /api trước khi forward
            
        # Route đến User Service  
        - id: user-service-route
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
            - Method=GET,POST             # Chỉ cho phép GET, POST
          filters:
            - AddRequestHeader=X-Source, gateway   # Thêm header
            
        # Route với Authentication filter tùy chỉnh
        - id: product-service-route
          uri: lb://product-service
          predicates:
            - Path=/api/products/**
          filters:
            - name: AuthFilter            # Custom filter
```

### 4. Custom Global Filter (Logging)

```java
@Component
@Order(1)  // Thứ tự thực thi filter
public class LoggingFilter implements GlobalFilter {
    
    private static final Logger log = LoggerFactory.getLogger(LoggingFilter.class);
    
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        // PRE-FILTER: Thực thi trước khi forward
        ServerHttpRequest request = exchange.getRequest();
        log.info("Incoming request: {} {}", 
            request.getMethod(), 
            request.getURI());
        
        // Tiếp tục chain (forward đến service)
        return chain.filter(exchange).then(Mono.fromRunnable(() -> {
            // POST-FILTER: Thực thi sau khi nhận response
            ServerHttpResponse response = exchange.getResponse();
            log.info("Response status: {}", response.getStatusCode());
        }));
    }
}
```

### 5. Custom Authentication Filter

```java
@Component
public class AuthFilter implements GatewayFilter, Ordered {
    
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        
        // Kiểm tra Authorization header
        if (!request.getHeaders().containsKey("Authorization")) {
            ServerHttpResponse response = exchange.getResponse();
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return response.setComplete();
        }
        
        String token = request.getHeaders().getFirst("Authorization");
        // Validate JWT token...
        if (!isValidToken(token)) {
            exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
            return exchange.getResponse().setComplete();
        }
        
        return chain.filter(exchange);
    }
    
    @Override
    public int getOrder() { return -1; }
    
    private boolean isValidToken(String token) {
        // JWT validation logic
        return token != null && token.startsWith("Bearer ");
    }
}
```

---

## PHẦN 2: Load Balancing

### 1. Định nghĩa

Phân phối đều request đến nhiều instance của cùng 1 service để:
- Tránh quá tải 1 instance
- Tăng throughput tổng thể
- High availability

### 2. Các thuật toán Load Balancing

#### Round Robin (mặc định của Spring Cloud)
```
Request 1 → Instance A
Request 2 → Instance B
Request 3 → Instance C
Request 4 → Instance A (vòng lại)
```

#### Weighted Round Robin
```
Instance A (weight=3): nhận 3/6 = 50% traffic
Instance B (weight=2): nhận 2/6 = 33% traffic
Instance C (weight=1): nhận 1/6 = 17% traffic
```

#### Least Connections
```
Chọn instance đang xử lý ít request nhất
→ Phù hợp khi request có thời gian xử lý khác nhau
```

#### Random
```
Chọn ngẫu nhiên một instance
→ Đơn giản, hiệu quả khi tất cả instances đều tương đương
```

### 3. Load Balancing trong Spring Cloud

Spring Cloud Load Balancer (thay thế Ribbon):

```java
@Configuration
public class LoadBalancerConfig {
    
    @Bean
    @LoadBalanced
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
    
    // Tùy chỉnh thuật toán (mặc định là Round Robin)
    @Bean
    public ReactorLoadBalancer<ServiceInstance> randomLoadBalancer(
            Environment environment,
            LoadBalancerClientFactory loadBalancerClientFactory) {
        String name = environment.getProperty(LoadBalancerClientFactory.PROPERTY_NAME);
        return new RandomLoadBalancer(
            loadBalancerClientFactory.getLazyProvider(name, ServiceInstanceListSupplier.class),
            name
        );
    }
}
```

### 4. Health Check & Instance Removal

```yaml
eureka:
  client:
    healthcheck:
      enabled: true  # Dùng Spring Boot health check thay vì heartbeat đơn thuần
      
management:
  endpoints:
    web:
      exposure:
        include: health
  endpoint:
    health:
      show-details: always
```

---

## PHẦN 3: Gateway vs Load Balancer

| Tiêu chí | API Gateway | Load Balancer |
|----------|-------------|---------------|
| **Hoạt động ở Layer** | Layer 7 (Application) | Layer 4 (Transport) hoặc Layer 7 |
| **Routing logic** | Phức tạp (path, header, method) | Đơn giản (IP-based) |
| **Authentication** | ✅ Có thể làm | ❌ Không |
| **Transformation** | ✅ Modify request/response | ❌ Không |
| **Circuit Breaking** | ✅ Có thể | ❌ Không |
| **Ví dụ** | Spring Cloud Gateway, Kong, Nginx | HAProxy, AWS ELB |

---

## ❓ Câu hỏi Ôn tập

1. API Gateway giải quyết vấn đề gì trong kiến trúc Microservice?
2. Kể tên 5 chức năng của API Gateway
3. 3 khái niệm cốt lõi của Spring Cloud Gateway là gì? Giải thích mỗi khái niệm
4. `lb://order-service` có nghĩa gì trong cấu hình route?
5. Phân biệt Pre-filter và Post-filter trong Gateway
6. `StripPrefix=1` filter làm gì?
7. Kể tên 4 thuật toán Load Balancing và use case của từng loại
8. Tại sao Load Balancing lại quan trọng trong Microservice?
9. API Gateway khác gì Load Balancer?
10. Khi nào bạn chọn Round Robin? Khi nào chọn Least Connections?

---

## 💡 Key Takeaways

```
Gateway = Single Entry Point = BẢO VỆ + ĐIỀU PHỐI

Route = ID + URI + Predicates + Filters
  URI dùng lb:// để tích hợp Eureka + Load Balancing

Load Balancing mặc định: Round Robin
  Thay đổi: Implement ReactorLoadBalancer

Filter thực thi theo thứ tự:
  Pre-filter → Forward → Post-filter
```
