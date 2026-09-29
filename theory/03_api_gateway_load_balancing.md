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

## ❓ Câu hỏi Ôn tập & Trả lời chi tiết

### 1. API Gateway giải quyết vấn đề gì trong kiến trúc Microservice?
- **Giải quyết rối loạn Endpoint (Single Entry Point)**: Client chỉ cần biết duy nhất một địa chỉ của API Gateway thay vì phải ghi nhớ và kết nối trực tiếp đến hàng chục địa chỉ IP/port khác nhau của từng service con.
- **Bảo mật và che giấu mạng nội bộ (Attack Surface Reduction)**: Toàn bộ các microservice backend được đặt an toàn trong mạng nội bộ (Private Subnet), chỉ mở duy nhất Gateway ra ngoài Internet để hạn chế tối đa bề mặt bị tấn công.
- **Tập trung hóa các mối quan tâm chéo (Cross-Cutting Concerns)**: Xử lý tập trung các tác vụ như Authentication/Authorization (JWT, OAuth2), CORS, Rate Limiting, SSL Termination và Centralized Logging/Tracing tại một nơi thay vì phải lặp lại cấu hình ở mọi service.
- **Tối ưu hóa hiệu năng cho Client (API Aggregation / BFF Pattern)**: Giảm số lượng request từ phía Mobile/Web qua mạng viễn thông có độ trễ cao bằng cách gom nhiều request con từ nhiều service lại thành 1 response duy nhất.

---

### 2. Kể tên 5 chức năng của API Gateway
1. **Routing (Định tuyến)**: Điều hướng các HTTP request từ client đến đúng microservice đích tương ứng.
2. **Authentication & Authorization (Xác thực & Phân quyền)**: Kiểm tra tính hợp lệ của Token/JWT, giải mã danh tính người dùng và kiểm tra quyền truy cập trước khi cho phép request đi sâu vào hệ thống.
3. **Rate Limiting (Giới hạn lưu lượng)**: Giới hạn số lượng request tối đa từ một IP, Client hoặc User trong một khoảng thời gian nhất định (chống spam, bảo vệ chống quá tải và DDoS).
4. **Load Balancing (Cân bằng tải)**: Phân phối lưu lượng traffic đồng đều giữa các instance đang hoạt động của cùng một service.
5. **SSL Termination**: Tiếp nhận và giải mã HTTPS tập trung tại Gateway, giúp các microservice nội bộ phía sau giảm tải CPU vì chỉ cần giao tiếp bằng HTTP thông thường.
*(Ngoài ra còn có: Request/Response Transformation, Circuit Breaker, Centralized Logging & Tracing).*

---

### 3. 3 khái niệm cốt lõi của Spring Cloud Gateway là gì? Giải thích mỗi khái niệm
Kiến trúc của Spring Cloud Gateway được xây dựng xung quanh khái niệm bao trùm là **Route**:
1. **Route (Định tuyến - Khối xây dựng cơ bản)**: Một Route được xác định bởi một **ID**, một **Destination URI**, tập hợp các **Predicates** và tập hợp các **Filters**. Nếu tập Predicates thỏa mãn, request sẽ được chuyển tiếp đến Destination URI thông qua các Filters.
2. **Predicate (Vị từ / Điều kiện so khớp)**: Là một biểu thức logic (dựa trên Java 8 `Predicate`) kiểm tra các thuộc tính của HTTP request như: đường dẫn (`Path`), phương thức (`Method=GET,POST`), headers (`Header`), tham số query (`Query`), cookies,... Nếu điều kiện trả về `true`, request sẽ khớp với Route đó.
3. **Filter (Bộ lọc)**: Là thành phần cho phép can thiệp và sửa đổi HTTP request trước khi forward đến downstream service (**Pre-filter**) hoặc sửa đổi HTTP response trước khi trả về cho client (**Post-filter**).

---

### 4. `lb://order-service` có nghĩa gì trong cấu hình route?
- **Ý nghĩa tiền tố `lb://`**: Là viết tắt của **Load Balanced**. Nó chỉ định cho Spring Cloud Gateway biết rằng đây không phải là một URL tĩnh hay địa chỉ IP cố định, mà là một **Tên dịch vụ (Service ID/Application Name)** cần được cân bằng tải.
- **Cơ chế phối hợp trong hệ thống**:
  1. **Tích hợp với Service Registry (Eureka / Consul)**: Gateway sử dụng tên `order-service` để tra cứu trong Eureka Server nhằm lấy ra danh sách các địa chỉ IP:Port của các instance `order-service` đang hoạt động bình thường (`UP`).
  2. **Tích hợp với Spring Cloud LoadBalancer**: Gateway áp dụng thuật toán cân bằng tải (mặc định là Round-Robin) để chọn ra 1 instance cụ thể, sau đó viết lại URL (ví dụ: chuyển từ `lb://order-service/api/...` thành `http://192.168.1.15:8082/api/...`) trước khi gửi request đi.

---

### 5. Phân biệt Pre-filter và Post-filter trong Gateway
- **Thời điểm thực thi**:
  - **Pre-filter**: Được kích hoạt và thực thi **TRƯỚC KHI** request được forward đến downstream microservice bên trong.
  - **Post-filter**: Được kích hoạt và thực thi **SAU KHI** downstream microservice đã xử lý xong và trả response về lại cho Gateway (trước khi response được gửi trả về cho Client).
- **Use Case thực tế điển hình**:
  - *Pre-filter*:
    - **Authentication / Authorization**: Kiểm tra JWT Token trong header `Authorization`. Nếu không hợp lệ hoặc thiếu quyền thì ngắt chuỗi và trả về HTTP `401 Unauthorized` ngay lập tức.
    - **Header Injection**: Giải mã JWT lấy `userId`, sau đó gắn thêm header nội bộ `X-User-Id: 123` để các service con dùng luôn mà không cần parse lại token.
    - **Rate Limiting**: Kiểm tra quota gọi API qua Redis Token Bucket.
  - *Post-filter*:
    - **Logging & Latency Measurement**: Ghi log mã trạng thái HTTP (`response.getStatusCode()`) và đo tổng thời gian xử lý request (`endTime - startTime`).
    - **Header Modification**: Thêm các header bảo mật (`Strict-Transport-Security`, `X-Frame-Options`, `CORS`) hoặc gắn `X-Trace-Id` trả về cho Client để phục vụ việc truy vết lỗi.

---

### 6. `StripPrefix=1` filter làm gì?
- **Chức năng**: Bộ lọc `StripPrefix=n` sẽ cắt bỏ đúng `n` phân đoạn (path segments) đầu tiên của đường dẫn URL (tính từ trái sang phải) trước khi chuyển tiếp request đến microservice phía sau.
- **Ví dụ cụ thể**:
  - Client gửi request đến Gateway với đường dẫn: `http://localhost:8080/api/orders/123` (Path gồm các segment: `api` (1), `orders` (2), `123` (3)).
  - Sau khi qua bộ lọc `StripPrefix=1`, segment `/api` bị loại bỏ.
  - Microservice `order-service` phía sau sẽ nhận được request với đường dẫn là: `/orders/123`.
- **Mục đích thực tế**: Giúp chuẩn hóa đường dẫn public ở Gateway (như `/api/...` hoặc `/v1/...`) mà không bắt buộc Controller bên trong microservice phải khai báo lặp lại các tiền tố này trong `@RequestMapping`.

---

### 7. Kể tên 4 thuật toán Load Balancing và use case của từng loại
1. **Round Robin (Mặc định)**:
   - *Nguyên lý*: Luân chuyển request tuần tự qua từng server theo vòng tròn ($A \rightarrow B \rightarrow C \rightarrow A$).
   - *Use case*: Các instance có cấu hình phần cứng tương đương nhau và các request có khối lượng xử lý xấp xỉ nhau (như các API đọc/ghi CRUD đơn giản).
2. **Weighted Round Robin**:
   - *Nguyên lý*: Mỗi server được gán một trọng số (weight) dựa trên năng lực. Server có trọng số cao hơn sẽ nhận tỷ lệ request nhiều hơn.
   - *Use case*: Cụm server có cấu hình phần cứng không đồng đều (ví dụ máy chủ 16GB RAM nhận weight=3, máy chủ 4GB RAM nhận weight=1).
3. **Least Connections**:
   - *Nguyên lý*: Phân phối request đến instance hiện đang duy trì số lượng kết nối đang hoạt động (active connections) ít nhất.
   - *Use case*: Khi thời gian xử lý giữa các request chênh lệch lớn (ví dụ hệ thống có các tác vụ nặng như xuất file Excel/PDF, upload file lớn, hoặc các kết nối duy trì lâu như WebSocket, Chat, Video streaming).
4. **Random**:
   - *Nguyên lý*: Chọn ngẫu nhiên một instance trong danh sách sẵn sàng.
   - *Use case*: Hệ thống có số lượng request cực lớn và các instance hoàn toàn tương đồng nhau; thuật toán này nhẹ và không cần quản lý trạng thái.
*(Thuật toán mở rộng: **IP Hash / Consistent Hashing** dùng khi cần gắn kết cố định một Client IP vào một Instance cụ thể để phục vụ Sticky Session hoặc tối ưu Local Cache).*

---

### 8. Tại sao Load Balancing lại quan trọng trong Microservice?
1. **Chống nghẽn cổ chai và Quá tải (Bottleneck & Overload Prevention)**: Phân bổ đều lưu lượng request, ngăn chặn tình trạng một instance bị dồn ép đến mức cạn kiệt CPU/RAM dẫn đến sập toàn bộ service.
2. **Đảm bảo Tính sẵn sàng cao & Khả năng chịu lỗi (High Availability & Fault Tolerance)**: Kết hợp với cơ chế Health Check để tự động phát hiện instance gặp sự cố (down/crash) và cách ly, chuyển hướng traffic sang các instance còn sống mà người dùng không bị gián đoạn.
3. **Hỗ trợ Khả năng mở rộng ngang (Horizontal Scalability & Auto-scaling)**: Dễ dàng mở rộng từ 2 lên 10-20 container trong đợt cao điểm (Flash Sale) mà không cần cấu hình lại phía Client hay sửa code.
4. **Tối ưu hóa hiệu suất tài nguyên (Resource Utilization)**: Đảm bảo toàn bộ phần cứng được tận dụng tối đa và đồng đều.
5. **Hỗ trợ Zero-Downtime Deployment**: Cho phép triển khai phiên bản mới theo chiến lược Rolling Update hoặc Blue-Green (rút traffic khỏi node cần nâng cấp, sau đó mới cho nhận request trở lại).

---

### 9. API Gateway khác gì Load Balancer?

| Tiêu chí | API Gateway | Load Balancer thuần túy (HAProxy, AWS NLB/ALB) |
| :--- | :--- | :--- |
| **Tầng hoạt động (OSI)** | Luôn ở **Layer 7** (Application Layer - hiểu sâu cấu trúc HTTP, Path, Header, JSON Body). | Thường ở **Layer 4** (Transport - TCP/UDP) hoặc **Layer 7** dạng cơ bản. |
| **Mục đích chính** | Bảo vệ, quản lý API, xác thực và điều phối nghiệp vụ cho Microservice. | Tối ưu hóa phân phối lưu lượng mạng (Traffic Distribution). |
| **Logic Routing** | **Rất phức tạp & linh hoạt**: Theo Path (`/api/orders`), HTTP Method, Header, Query param, Role,... | **Đơn giản**: Theo địa chỉ IP, Port hoặc Domain Name. |
| **Xác thực (Auth)** | ✅ **Có**: Xác thực JWT, OAuth2, kiểm tra quyền hạn (Role/Permission) tại cửa ngõ. | ❌ **Không**: Không can thiệp vào logic người dùng của ứng dụng. |
| **Biến đổi dữ liệu (Transformation)** | ✅ **Có**: Sửa đổi header (`X-User-Id`), sửa path (`StripPrefix`), mã hóa/giải mã response. | ❌ **Không**: Chỉ chuyển tiếp nguyên vẹn các gói tin. |
| **Tính năng mở rộng** | Rate Limiting theo User/API Key, Circuit Breaker, API Composition (BFF), Caching API. | SSL Offloading tốc độ cao, Health check phần cứng, cân bằng tải TCP/UDP. |
| **Ví dụ đại diện** | Spring Cloud Gateway, Kong, Apigee, KrakenD. | HAProxy, AWS NLB/ELB, F5 BIG-IP. |

> 💡 *Trong kiến trúc thực tế, hai thành phần này thường phối hợp với nhau: `Client` $\rightarrow$ `Load Balancer (HAProxy/AWS ALB)` $\rightarrow$ `Cụm API Gateway` $\rightarrow$ `Microservices`.*

---

### 10. Khi nào bạn chọn Round Robin? Khi nào chọn Least Connections?
- **Chọn Round Robin khi**:
  - Các server/instance có **cấu hình phần cứng tương đương nhau** (cùng CPU, RAM).
  - Các request có **thời gian xử lý nhanh, ngắn và xấp xỉ nhau** (thường từ 5ms - 50ms).
  - *Ví dụ thực tế*: Các API đọc dữ liệu CRUD chuẩn hoặc truy vấn Cache Redis (ví dụ: `GET /api/products/123`, `GET /api/users/profile`). Luân chuyển tuần tự sẽ giúp chia đều tải với chi phí tính toán thuật toán thấp nhất.
- **Chọn Least Connections khi**:
  - Thời gian xử lý giữa các request **chênh lệch nhau rất lớn** (có request hoàn thành sau vài mili-giây, nhưng có request giữ kết nối nhiều chục giây đến hàng giờ).
  - *Ví dụ thực tế*: 
    1. **Service xuất báo cáo / xử lý dữ liệu nặng**: Request xuất file Excel báo cáo doanh thu 1 năm mất 30 giây, trong khi request xem đơn hàng chỉ mất 50ms. Nếu dùng Round Robin, một server có thể vô tình nhận liên tiếp nhiều request xuất Excel và bị cạn kiệt tài nguyên; Least Connections sẽ nhận biết server đó đang bận và điều hướng request mới sang server khác.
    2. **Hệ thống duy trì kết nối lâu dài**: Ứng dụng chat trực tuyến, WebSocket, hoặc luồng Video Streaming.

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
