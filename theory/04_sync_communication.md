# Session 06+07: Giao tiếp Đồng bộ – RestTemplate & FeignClient

---

## PHẦN 1: Các kiểu giao tiếp trong Microservice

```
Đồng bộ (Synchronous):
  Client gửi request → Đợi response → Nhận kết quả
  Ví dụ: REST HTTP, gRPC
  Dùng khi: Cần kết quả ngay lập tức

Bất đồng bộ (Asynchronous):
  Client gửi message → Không đợi → Tiếp tục làm việc khác
  Ví dụ: Kafka, RabbitMQ
  Dùng khi: Không cần kết quả ngay, background processing
```

---

## PHẦN 2: RestTemplate

### 1. Giới thiệu
RestTemplate là Spring HTTP client (blocking, synchronous) để gọi REST APIs.

> ⚠️ **Lưu ý:** RestTemplate bị deprecated từ Spring 5.0, nhưng vẫn còn dùng nhiều trong production. Replacement là WebClient (reactive).

### 2. Cấu hình RestTemplate

```java
@Configuration
public class RestTemplateConfig {
    
    // Không có @LoadBalanced → gọi trực tiếp bằng URL
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
    
    // Có @LoadBalanced → tích hợp Eureka, dùng service name
    @Bean
    @LoadBalanced
    public RestTemplate loadBalancedRestTemplate() {
        return new RestTemplate();
    }
}
```

### 3. Các phương thức RestTemplate

```java
@Service
public class OrderService {
    
    @Autowired
    @Qualifier("loadBalancedRestTemplate")
    private RestTemplate restTemplate;
    
    // GET - trả về Object
    public UserDTO getUser(Long userId) {
        return restTemplate.getForObject(
            "http://user-service/users/{id}",
            UserDTO.class,
            userId  // path variable
        );
    }
    
    // GET - trả về ResponseEntity (có headers + status)
    public ResponseEntity<UserDTO> getUserWithStatus(Long userId) {
        return restTemplate.getForEntity(
            "http://user-service/users/{id}",
            UserDTO.class,
            userId
        );
    }
    
    // POST - gửi body, nhận Object
    public OrderDTO createOrder(CreateOrderRequest request) {
        return restTemplate.postForObject(
            "http://order-service/orders",
            request,         // request body
            OrderDTO.class   // response type
        );
    }
    
    // PUT - update
    public void updateOrder(Long id, UpdateOrderRequest request) {
        restTemplate.put(
            "http://order-service/orders/{id}",
            request,
            id
        );
    }
    
    // DELETE
    public void deleteOrder(Long id) {
        restTemplate.delete("http://order-service/orders/{id}", id);
    }
    
    // Exchange - linh hoạt nhất (custom headers, method)
    public OrderDTO callWithHeaders(Long orderId) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + getToken());
        headers.setContentType(MediaType.APPLICATION_JSON);
        
        HttpEntity<Void> entity = new HttpEntity<>(headers);
        
        ResponseEntity<OrderDTO> response = restTemplate.exchange(
            "http://order-service/orders/{id}",
            HttpMethod.GET,
            entity,
            OrderDTO.class,
            orderId
        );
        
        return response.getBody();
    }
}
```

### 4. Error Handling với RestTemplate

```java
@Component
public class CustomErrorHandler extends DefaultResponseErrorHandler {
    
    @Override
    public void handleError(ClientHttpResponse response) throws IOException {
        if (response.getStatusCode() == HttpStatus.NOT_FOUND) {
            throw new ResourceNotFoundException("Resource not found");
        }
        if (response.getStatusCode() == HttpStatus.BAD_REQUEST) {
            throw new BadRequestException("Bad request");
        }
        super.handleError(response);
    }
}

@Configuration
public class RestTemplateConfig {
    @Bean
    public RestTemplate restTemplate() {
        RestTemplate template = new RestTemplate();
        template.setErrorHandler(new CustomErrorHandler());
        return template;
    }
}
```

---

## PHẦN 3: FeignClient

### 1. Tại sao dùng FeignClient?

**RestTemplate:** Viết code gọi HTTP tường minh
```java
// Dài dòng, phải xử lý URL, method, headers thủ công
String result = restTemplate.getForObject(
    "http://user-service/users/" + userId, 
    String.class
);
```

**FeignClient:** Khai báo interface, Spring tự tạo implementation
```java
// Ngắn gọn, giống như gọi method local
UserDTO user = userServiceClient.getUserById(userId);
```

### 2. Setup FeignClient

**Dependency:**
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
</dependency>
```

**Bật FeignClient:**
```java
@SpringBootApplication
@EnableFeignClients  // ← Annotation quan trọng!
public class OrderServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderServiceApplication.class, args);
    }
}
```

### 3. Khai báo FeignClient Interface

```java
@FeignClient(
    name = "user-service",          // Tên service trong Eureka
    path = "/users",                // Base path (optional)
    fallback = UserClientFallback.class  // Fallback khi lỗi
)
public interface UserServiceClient {
    
    @GetMapping("/{id}")
    UserDTO getUserById(@PathVariable("id") Long id);
    
    @GetMapping
    List<UserDTO> getAllUsers();
    
    @PostMapping
    UserDTO createUser(@RequestBody CreateUserRequest request);
    
    @PutMapping("/{id}")
    UserDTO updateUser(@PathVariable("id") Long id, 
                       @RequestBody UpdateUserRequest request);
    
    @DeleteMapping("/{id}")
    void deleteUser(@PathVariable("id") Long id);
    
    // Gửi kèm header
    @GetMapping("/profile")
    UserDTO getProfile(@RequestHeader("Authorization") String token);
    
    // Query parameters
    @GetMapping("/search")
    List<UserDTO> searchUsers(@RequestParam("keyword") String keyword,
                              @RequestParam(value = "page", defaultValue = "0") int page);
}
```

### 4. Sử dụng FeignClient

```java
@Service
public class OrderService {
    
    @Autowired
    private UserServiceClient userServiceClient;
    
    public OrderDTO createOrder(CreateOrderRequest request) {
        // Gọi user-service để validate user
        UserDTO user = userServiceClient.getUserById(request.getUserId());
        
        if (user == null) {
            throw new UserNotFoundException("User not found");
        }
        
        // Tạo order...
        return orderRepository.save(new Order(request, user));
    }
}
```

### 5. Fallback (Xử lý khi service bị down)

**Bước 1: Tạo Fallback class**
```java
@Component
public class UserClientFallback implements UserServiceClient {
    
    @Override
    public UserDTO getUserById(Long id) {
        // Trả về default value khi service bị down
        UserDTO fallbackUser = new UserDTO();
        fallbackUser.setId(id);
        fallbackUser.setName("Unknown User");
        return fallbackUser;
    }
    
    @Override
    public List<UserDTO> getAllUsers() {
        return Collections.emptyList(); // Trả về empty list
    }
    
    @Override
    public UserDTO createUser(CreateUserRequest request) {
        throw new ServiceUnavailableException("User service is unavailable");
    }
}
```

**Bước 2: Cấu hình FeignClient dùng fallback**
```java
@FeignClient(
    name = "user-service",
    fallback = UserClientFallback.class
)
public interface UserServiceClient { ... }
```

**Bước 3: Bật circuit breaker cho Feign**
```yaml
spring:
  cloud:
    openfeign:
      circuitbreaker:
        enabled: true
```

### 6. FeignClient với Custom Configuration

```java
@Configuration
public class FeignConfig {
    
    // Tăng timeout
    @Bean
    public Request.Options options() {
        return new Request.Options(
            5000,  // connectTimeout ms
            30000, // readTimeout ms
            true   // followRedirects
        );
    }
    
    // Custom logger
    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.FULL; // NONE, BASIC, HEADERS, FULL
    }
    
    // Custom error decoder
    @Bean
    public ErrorDecoder errorDecoder() {
        return new CustomErrorDecoder();
    }
}

// Áp dụng config cho 1 FeignClient cụ thể
@FeignClient(name = "user-service", configuration = FeignConfig.class)
public interface UserServiceClient { ... }
```

---

## PHẦN 4: So sánh RestTemplate vs FeignClient

| Tiêu chí | RestTemplate | FeignClient |
|----------|-------------|-------------|
| **Code style** | Imperative (tường minh) | Declarative (khai báo) |
| **Boilerplate** | Nhiều | Ít (chỉ cần interface) |
| **Tích hợp Eureka** | @LoadBalanced | Tự động qua name |
| **Error handling** | ErrorHandler | ErrorDecoder |
| **Fallback** | Thủ công try/catch | @FeignClient(fallback=...) |
| **Logging** | Manual | Tự động với Logger.Level |
| **Testing** | Mock RestTemplate | Mock interface |
| **Learning curve** | Dễ | Dễ hơn |
| **Deprecated** | Deprecated Spring 5+ | Không (vẫn active) |
| **Reactive** | ❌ | ❌ (dùng WebClient) |

---

## ❓ Câu hỏi Ôn tập

1. Phân biệt giao tiếp đồng bộ và bất đồng bộ. Khi nào dùng loại nào?
2. `@LoadBalanced` RestTemplate khác gì RestTemplate thông thường?
3. `restTemplate.exchange()` dùng khi nào? Ưu điểm gì?
4. Annotation nào cần thiết để bật FeignClient trong Spring Boot?
5. Viết FeignClient interface có method: GET /products/{id} trả về ProductDTO
6. Fallback trong FeignClient là gì? Cách implement?
7. So sánh RestTemplate vs FeignClient – khi nào nên dùng cái nào?
8. `@RequestHeader`, `@RequestParam` trong FeignClient dùng như thế nào?
9. Logger.Level.FULL trong Feign log những gì?
10. Khi FeignClient nhận HTTP 404, mặc định sẽ throw exception gì?

---

## 💡 Key Takeaways

```
RestTemplate:
  Dùng @LoadBalanced để tích hợp Eureka
  Dùng .exchange() cho custom headers/method

FeignClient:
  @EnableFeignClients → khai báo interface → inject & dùng như method thường
  Fallback = xử lý graceful khi service down
  name = "service-name" → Eureka service name

Quy tắc:
  Ưu tiên FeignClient cho code đẹp hơn
  RestTemplate khi cần control tường minh hơn
```
