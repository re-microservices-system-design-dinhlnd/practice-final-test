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

## ❓ Câu hỏi Ôn tập & Trả lời chi tiết

### 1. Phân biệt giao tiếp đồng bộ (Synchronous) và bất đồng bộ (Asynchronous). Khi nào dùng loại nào?
- **Đồng bộ (Synchronous - Request/Response):**
  - **Cơ chế:** Client/Service A gửi HTTP/gRPC request sang Service B và **phải đợi (block/await thread)** cho đến khi Service B xử lý xong và gửi response trả về.
  - **Tính chất:** *Tight Coupling (Gắn kết chặt về thời gian)* — cả 2 service đều phải đang hoạt động (`UP`) cùng một thời điểm. Nếu Service B chậm hoặc lỗi, Service A sẽ bị nghẽn tài nguyên và dễ dẫn đến lỗi dây chuyền (*Cascading Failure*).
  - **Công nghệ phổ biến:** REST (HTTP/JSON), gRPC.
  - **Khi nào nên dùng:** Khi luồng nghiệp vụ bắt buộc cần kết quả phản hồi ngay lập tức để tiếp tục xử lý (ví dụ: Order Service gọi Payment Service để xác thực số dư trước khi hoàn tất đơn hàng).

- **Bất đồng bộ (Asynchronous - Event-driven / Message-based):**
  - **Cơ chế:** Client/Service A gửi message/event vào hàng đợi (Message Broker) rồi tiếp tục xử lý công việc khác ngay lập tức mà **không cần đợi** Service B phản hồi.
  - **Tính chất:** *Loose Coupling (Tách rời về thời gian và không gian)* — nếu Service B đang bảo trì hoặc sập, message vẫn được lưu trữ an toàn trong Queue và sẽ được xử lý khi Service B khởi động lại.
  - **Công nghệ phổ biến:** Apache Kafka, RabbitMQ, Amazon SQS.
  - **Khi nào nên dùng:**
    - Các tác vụ tốn nhiều thời gian xử lý: Gửi email/SMS thông báo, xuất báo cáo Excel, xử lý nén video.
    - Đệm tải và xả tải (Rate-limiting, Buffering traffic) khi lượng truy cập tăng đột biến.
    - Cập nhật dữ liệu phi tức thời (Eventual Consistency) qua Saga Pattern hoặc CDC.

---

### 2. `@LoadBalanced` RestTemplate khác gì RestTemplate thông thường?
- **Phân giải URL qua Service Name:**
  - *RestTemplate thông thường:* Bắt buộc phải truyền URL tĩnh kèm IP:Port cố định (ví dụ: `http://localhost:8081/products` hoặc `http://192.168.1.10:8081/products`). Nếu truyền tên service (`http://product-service/...`), Java sẽ ném lỗi `UnknownHostException` vì DNS không phân giải được.
  - *RestTemplate `@LoadBalanced`:* Cho phép gọi API trực tiếp bằng **Logical Service Name** đã đăng ký trên Service Registry (Eureka/Consul), ví dụ: `http://product-service/products`.
- **Cơ chế Client-Side Load Balancing:**
  - `@LoadBalanced` can thiệp thông qua `LoadBalancerInterceptor`. Khi request được gửi đi, Spring Cloud LoadBalancer sẽ tra cứu Eureka để lấy danh sách toàn bộ instance đang hoạt động của service đích, sau đó áp dụng thuật toán cân bằng tải (mặc định là **Round Robin**) để tự chọn 1 instance phù hợp và thay thế tên service thành `IP:port` thực tế trước khi gửi gói tin.

---

### 3. `restTemplate.exchange()` dùng khi nào? Ưu điểm gì so với các method khác?
- **Khi nào dùng:** Dùng khi cần kiểm soát toàn diện HTTP Request (Headers, Cookies, Method) và đọc trọn vẹn thông tin HTTP Response (Status Code, Response Headers, Body).
- **Các ưu điểm vượt trội so với `getForObject()` hay `postForEntity()`:**
  1. **Tùy biến Custom Headers & Authentication:** Cho phép gói headers vào `HttpEntity` để gửi token xác thực (ví dụ `Authorization: Bearer <token>`) hoặc `X-Trace-Id` — điều mà `getForObject` không hỗ trợ.
  2. **Hỗ trợ mọi HTTP Method:** Linh hoạt thực thi bất kỳ phương thức nào: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `HEAD`.
  3. **Hỗ trợ Generic Collection Type (`ParameterizedTypeReference`):** Tránh lỗi Type Erasure của Java khi map response dạng danh sách đối tượng:
     ```java
     ResponseEntity<List<ProductDTO>> response = restTemplate.exchange(
         "http://product-service/products",
         HttpMethod.GET,
         null,
         new ParameterizedTypeReference<List<ProductDTO>>() {}
     );
     ```
  4. **Kiểm soát Response toàn diện:** Nhận về `ResponseEntity<T>` giúp kiểm tra chính xác HTTP Status Code (`200 OK`, `201 Created`, `204 No Content`) và Response Headers.

---

### 4. Annotation nào cần thiết để bật FeignClient trong Spring Boot? Đặt ở đâu?
- **Annotation bắt buộc:** **`@EnableFeignClients`**
- **Vị trí khai báo:** Thường được đặt trên **Main Application Class** (nơi có `@SpringBootApplication`) hoặc bất kỳ class nào được đánh dấu `@Configuration`.
- **Lưu ý cấu hình package:** Nếu các Interface `@FeignClient` nằm ở một package độc lập không phải package con của Application, cần chỉ định rõ:
  ```java
  @SpringBootApplication
  @EnableFeignClients(basePackages = "com.example.client")
  public class OrderServiceApplication { ... }
  ```

---

### 5. Viết FeignClient interface có method: GET /products/{id} trả về ProductDTO
```java
package com.example.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@FeignClient(
    name = "product-service",                 // Tên service đăng ký trên Eureka
    fallback = ProductServiceClientFallback.class // Class xử lý khi service gặp sự cố (optional)
)
public interface ProductServiceClient {

    @GetMapping("/products/{id}")
    ProductDTO getProductById(@PathVariable("id") Long id);
}
```
*(Ghi chú: Luôn nên khai báo tường minh `@PathVariable("id") Long id` để tránh lỗi biên dịch khi cờ `-parameters` không được bật).*

---

### 6. Fallback trong FeignClient là gì? Cách implement?
- **Khái niệm:** Fallback là cơ chế **chịu lỗi và suy thoái mềm (Fault Tolerance & Graceful Degradation)**. Khi microservice đích bị sập, timeout hoặc trả về lỗi HTTP 5xx, FeignClient sẽ chuyển hướng gọi sang phương thức Fallback để trả về dữ liệu mặc định hoặc dữ liệu từ cache, ngăn chặn sập dây chuyền toàn hệ thống.
- **3 bước triển khai (Implementation):**
  1. **Tạo Fallback Class:** Class này bắt buộc phải `implements` Interface FeignClient và được đánh dấu `@Component`:
     ```java
     @Component
     public class ProductServiceClientFallback implements ProductServiceClient {
         @Override
         public ProductDTO getProductById(Long id) {
             return new ProductDTO(id, "Dịch vụ sản phẩm tạm ngưng", 0.0);
         }
     }
     ```
  2. **Gắn Fallback vào Feign Interface:**
     ```java
     @FeignClient(name = "product-service", fallback = ProductServiceClientFallback.class)
     public interface ProductServiceClient { ... }
     ```
     *(Hoặc dùng `fallbackFactory` nếu muốn truy cập nguyên nhân lỗi/Exception).*
  3. **Bật Circuit Breaker cho OpenFeign trong `application.yml`:**
     ```yaml
     spring:
       cloud:
         openfeign:
           circuitbreaker:
             enabled: true
     ```

---

### 7. So sánh RestTemplate vs FeignClient – khi nào nên dùng cái nào?
| Tiêu chí | RestTemplate | FeignClient |
|:---|:---|:---|
| **Phong cách code** | Imperative (Thủ công, tường minh) | Declarative (Khai báo Interface) |
| **Boilerplate Code** | Nhiều (tạo URL, HttpEntity, parse response) | Rất ít (Spring tự động sinh proxy implementation) |
| **Tích hợp Eureka & LB** | Phải cấu hình `@LoadBalanced` | Tự động hoàn toàn qua thuộc tính `name` |
| **Cơ chế Chịu lỗi** | Phải tự bọc `try/catch` hoặc cấu hình Resilience4j ngoài | Tích hợp sẵn Fallback (`fallback`, `fallbackFactory`) |
| **Logging** | Phải tự cấu hình Interceptor phức tạp | Tích hợp sẵn qua `Logger.Level` |
| **Trạng thái hỗ trợ** | Bị Deprecated từ Spring 5.0 (khuyên dùng `RestClient`/`WebClient`) | Được Spring Cloud hỗ trợ và phát triển tích cực |

- **Khi nào nên dùng FeignClient:** Ưu tiên hàng đầu cho tất cả giao tiếp nội bộ giữa các microservice (Inter-service communication) trong hệ thống Spring Cloud vì tính tiện lợi, clean code và tích hợp sẵn Service Discovery, Load Balancing và Circuit Breaker.
- **Khi nào nên dùng RestTemplate:** Dùng trong các dự án cũ (Legacy) hoặc khi cần can thiệp sâu, tùy biến cấu hình mạng phức tạp (custom SSL socket, kết nối proxy đặc thù, streaming file dung lượng lớn) hoặc gọi các API bên ngoài bên thứ 3 không thuộc Eureka.

---

### 8. `@RequestHeader`, `@RequestParam` trong FeignClient dùng như thế nào?
- **Khác biệt góc nhìn:** Trong FeignClient, vai trò của chúng ta là **Client gửi request đi** (Outgoing Request), khác với Controller là Server nhận request đến (Incoming Request).
- **`@RequestHeader`:** Dùng để **gán/đính kèm dữ liệu vào HTTP Request Header** gửi sang service đích.
  - *Ví dụ:* Truyền token xác thực JWT hoặc Tracking ID:
    ```java
    @GetMapping("/users/profile")
    UserDTO getProfile(@RequestHeader("Authorization") String token);
    ```
- **`@RequestParam`:** Dùng để **nối tham số vào Query String trên URL** (`?key=value`).
  - *Ví dụ:* Tìm kiếm, phân trang và sắp xếp:
    ```java
    @GetMapping("/products/search")
    List<ProductDTO> searchProducts(@RequestParam("keyword") String keyword,
                                    @RequestParam("page") int page);
    ```
    *(URL sinh ra thực tế: `/products/search?keyword=laptop&page=0`)*.

---

### 9. Logger.Level.FULL trong Feign log những gì?
- **Các mức độ Log trong Feign (`feign.Logger.Level`):**
  - **`NONE`** *(Mặc định):* Không ghi bất kỳ log nào.
  - **`BASIC`:** Chỉ ghi lại HTTP Method, URL, Response Status Code và Thời gian thực thi (Execution time).
  - **`HEADERS`:** Bao gồm thông tin của `BASIC` cộng thêm toàn bộ **Request & Response Headers**.
  - **`FULL`:** Ghi lại **TOÀN BỘ**: URL, Method, Headers, **Request Body, Response Body** và Metadata cho cả 2 chiều gửi và nhận.
- **Cấu hình kích hoạt:**
  ```java
  @Bean
  feign.Logger.Level feignLoggerLevel() {
      return feign.Logger.Level.FULL;
  }
  ```
  Và trong `application.yml` phải set mức log của package Feign thành `DEBUG`:
  ```yaml
  logging:
    level:
      com.example.client: DEBUG
  ```
- ⚠️ **Lưu ý thực tế:** Chỉ bật `FULL` trong môi trường Local/Development để debug. Không bật trên Production vì gây suy giảm hiệu năng I/O và có nguy cơ rò rỉ dữ liệu nhạy cảm (mật khẩu, thẻ tín dụng, token) ra log file.

---

### 10. Khi FeignClient nhận HTTP 404, mặc định sẽ throw exception gì?
- **Exception mặc định:** Ném ra **`feign.FeignException.NotFound`** (lớp cha là **`feign.FeignException`**).
- **Cơ chế:** Mặc định OpenFeign sử dụng `ErrorDecoder.Default`. Khi nhận bất kỳ mã trạng thái HTTP nào từ 400 trở lên:
  - `400` ➔ ném `FeignException.BadRequest`
  - `404` ➔ ném `FeignException.NotFound`
  - `500` ➔ ném `FeignException.InternalServerError`
- **Cách xử lý chuẩn:**
  - *Cách 1 (Trả về null hoặc Optional thay vì throw):* Bật cờ `decode404` trong `application.yml`:
    ```yaml
    feign:
      client:
        config:
          default:
            decode404: true
    ```
  - *Cách 2 (Custom ErrorDecoder):* Viết class `implements ErrorDecoder` để bắt status 404 và ném ra Custom Business Exception (ví dụ: `ProductNotFoundException`) cho ExceptionHandler toàn cục xử lý.


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
