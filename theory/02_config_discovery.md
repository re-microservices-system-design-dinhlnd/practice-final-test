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

## ❓ Câu hỏi Ôn tập & Trả lời chi tiết

### 1. Tại sao trong Microservice cần Config Server thay vì để config trong từng service?
- **Quản lý cấu hình tập trung (Centralized Management)**: Thay vì lưu rải rác trong hàng chục/hàng trăm service (`application.properties`/`application.yml`), toàn bộ cấu hình được lưu tại 1 kho duy nhất (Git repository).
- **Cập nhật động không cần rebuild/redeploy (Dynamic Reload / Zero Downtime)**: Khi thay đổi config (ví dụ: timeout, log level, feature flag), chỉ cần sửa trên Git và gọi `/actuator/refresh` (hoặc qua Spring Cloud Bus) mà không phải build lại source code hay restart service.
- **Quản lý phiên bản & Khả năng Rollback (Version Control & Audit)**: Lưu trên Git giúp theo dõi lịch sử ai đã sửa gì (Git commit history), dễ dàng khôi phục cấu hình cũ (Rollback) ngay lập tức khi xảy ra sự cố.
- **Tách biệt cấu hình theo môi trường (Multi-environment Profiles)**: Dễ dàng cấu hình và switch qua các profile `dev`, `staging`, `prod` mà không đụng chạm đến code ứng dụng.
- **Bảo mật tập trung (Security & Encryption)**: Cho phép mã hóa/giải mã các thông tin nhạy cảm (database password, JWT secret, API key) ở một nơi tập trung thay vì để lộ text trần trong từng repository của từng service.

---

### 2. Giải thích ý nghĩa của `@RefreshScope`. Khi nào cần dùng?
- **Ý nghĩa & Cơ chế hoạt động**:
  - Mặc định, các Bean trong Spring Boot có phạm vi là **Singleton** (chỉ được tạo 1 lần duy nhất lúc container khởi động và các giá trị inject từ `@Value` sẽ bị giữ cố định trong suốt vòng đời của ứng dụng).
  - Khi được đánh dấu bằng `@RefreshScope`, Spring sẽ tạo một **CGLIB Dynamic Proxy** bọc quanh Bean đó.
  - Khi có sự kiện refresh (nhận HTTP `POST /actuator/refresh` hoặc từ Spring Cloud Bus), Spring sẽ xóa sạch instance của Bean trong cache. Ở lần gọi phương thức tiếp theo, một instance mới sẽ được khởi tạo lại với các giá trị cấu hình mới nhất (**Lazy Reload**).
- **Khi nào cần dùng?**:
  - Dùng trên các Controller, Service, Component có inject biến cấu hình bằng annotation **`@Value("${my.property}")`** mà bạn muốn cập nhật giá trị runtime mà không cần restart service.
  - *(Lưu ý: Đối với các class dùng `@ConfigurationProperties`, từ Spring Boot 2.x trở đi mặc định đã tự động rebind lại khi refresh mà không bắt buộc phải có `@RefreshScope`)*.

---

### 3. Thứ tự ưu tiên config khi có cả `application.yml`, `order-service.yml` và `order-service-dev.yml`?
- **Nguyên tắc cốt lõi**: **Càng cụ thể (Specific) $\rightarrow$ Ưu tiên càng cao (Ghi đè cái chung)**.
- **Thứ tự ưu tiên từ THẤP đến CAO** (file sau sẽ ghi đè file trước nếu trùng tên thuộc tính/key):
  1. **`application.yml`** *(Ưu tiên thấp nhất)*: Cấu hình chung cho toàn bộ mọi service trong hệ thống.
  2. **`order-service.yml`**: Cấu hình riêng cho `order-service` trên mọi môi trường (profile).
  3. **`order-service-dev.yml`** *(Ưu tiên cao nhất - Chiến thắng)*: Cấu hình riêng biệt cho `order-service` khi chạy với active profile là `dev`.
- **Kết luận**: Giá trị trong file `order-service-dev.yml` sẽ được áp dụng sau cùng và ghi đè lên các giá trị ở 2 file còn lại nếu có cùng key.

---

### 4. Phân biệt Client-Side Discovery vs Server-Side Discovery

| Tiêu chí | Client-Side Discovery (vd: Eureka + LoadBalancer) | Server-Side Discovery (vd: AWS ALB, K8s Service) |
| :--- | :--- | :--- |
| **Bản chất** | Client tự truy vấn Service Registry để lấy danh sách IP rồi tự chọn 1 instance để gọi. | Client chỉ gửi request đến 1 Router / Load Balancer trung gian; Load Balancer tự tra cứu Registry rồi forward request. |
| **Ai hỏi Registry?** | **Client** tự gửi query hỏi Service Registry. | **Load Balancer / Proxy** hỏi Registry. |
| **Ai cân bằng tải?** | **Client** tự chạy thuật toán Load Balancing (Round-Robin, Random,...). | **Load Balancer / Proxy** chọn instance mục tiêu. |
| **Số bước mạng (Hops)**| **1 hop** (Client $\rightarrow$ Target Service, nhanh hơn). | **2 hops** (Client $\rightarrow$ Load Balancer $\rightarrow$ Target Service). |
| **Độ phụ thuộc công nghệ**| Phụ thuộc vào thư viện/SDK của từng ngôn ngữ (khó cho hệ thống Polyglot). | Độc lập ngôn ngữ (Client chỉ cần dùng chuẩn HTTP/REST thông thường). |
| **Ví dụ đại diện** | Netflix Eureka + Spring Cloud LoadBalancer, Consul Client. | Kubernetes Service (Kube-proxy + CoreDNS), AWS ALB, NGINX. |

---

### 5. Eureka xử lý thế nào khi một service instance bị down?
- **Cơ chế Heartbeat (Nhịp tim)**: Service Client chủ động gửi tín hiệu Heartbeat lên Eureka Server định kỳ mỗi **30 giây** để gia hạn hợp đồng (Renew Lease).
- **Lease Expiration & Eviction (Thời gian chờ hết hạn & Gỡ bỏ)**: Nếu sau **90 giây** (tương đương 3 chu kỳ heartbeat liên tiếp) Eureka Server không nhận được tín hiệu từ instance đó $\rightarrow$ Eureka đánh dấu nó đã chết và gỡ bỏ (**Evict**) instance khỏi Registry.
- **Graceful Shutdown (Tắt ứng dụng bình thường)**: Khi service tắt có chủ đích (Ctrl+C, dừng container), client tự động gửi request HTTP `DELETE` (**Deregister**) lên Eureka để gỡ bỏ ngay lập tức mà không cần chờ 90s.
- **Self-Preservation Mode (Chế độ tự bảo vệ)**:
  - Khi xảy ra sự cố mạng (Network Partition), hàng loạt service không thể gửi heartbeat lên Eureka (dù bản thân các service vẫn sống bình thường).
  - Nếu tỷ lệ heartbeat nhận được trong 15 phút rớt xuống dưới **85%** (ngưỡng an toàn), Eureka sẽ kích hoạt **Self-Preservation Mode**: **Tạm ngưng việc gỡ bỏ (Evict) các service** để tránh xóa nhầm toàn bộ hệ thống.

---

### 6. Tại sao cần `@LoadBalanced` khi dùng RestTemplate với Eureka?
Có 2 lý do kỹ thuật quan trọng:
1. **Phân giải Tên dịch vụ (Service Name Resolution - Lý do cốt lõi)**:
   - Khi gọi API theo tên dịch vụ: `http://order-service/api/orders`, nếu không có `@LoadBalanced`, `RestTemplate` sẽ coi `order-service` là một domain Internet thật và yêu cầu DNS của hệ thống phân giải. Vì không có DNS server nào trả về domain này, ứng dụng sẽ quăng lỗi sập ngay: **`java.net.UnknownHostException: order-service`**.
   - Với `@LoadBalanced`, Spring gắn thêm một `ClientHttpRequestInterceptor`. Interceptor này chặn URL lại, bóc tách chuỗi `order-service`, tra vào Eureka Client để lấy danh sách IP/Port thực tế (ví dụ: `192.168.1.10:8082`), sau đó viết lại URL (URL rewrite) rồi mới gửi đi.
2. **Cân bằng tải phía Client (Client-side Load Balancing)**:
   - Nếu `order-service` có nhiều instance đang chạy, bộ cân bằng tải (Spring Cloud LoadBalancer / Ribbon) sẽ tự động phân phối request theo thuật toán (Round Robin, Weighted,...) để dàn đều tải.

---

### 7. Giải thích quá trình một service đăng ký vào Eureka từ lúc khởi động
Vòng đời gồm 4 giai đoạn chính:
1. **Registration (Đăng ký lúc startup)**: Sau khi Spring Context khởi động hoàn tất, Eureka Client gửi một HTTP POST request (`/eureka/apps/{appName}`) chứa metadata của instance (Service Name, IP, Port, Health check URL, Status: UP) lên Eureka Server.
2. **Heartbeat / Lease Renewal (Duy trì nhịp tim)**: Cứ mỗi **30 giây**, Client gửi một HTTP PUT request để gia hạn hợp đồng (renew).
3. **Fetch Registry & Local Cache (Đồng bộ danh sách dịch vụ)**: Định kỳ (mặc định **30 giây**), Client tự động kéo toàn bộ danh bạ từ Eureka Server về lưu vào bộ nhớ tạm (**Local Cache**) của chính nó. Khi cần gọi service khác, nó tra cứu ngay trong Local Cache này để tiết kiệm thời gian và giảm tải cho Eureka Server.
4. **Cancellation / Deregister (Hủy đăng ký lúc shutdown)**: Khi ứng dụng tắt đúng cách (Graceful Shutdown), Client gửi HTTP DELETE để Eureka Server gỡ bỏ instance ngay lập tức khỏi Registry.

---

### 8. `register-with-eureka: false` trên Eureka Server có nghĩa gì?
- **Ý nghĩa**:
  - `eureka.client.register-with-eureka: false`: Báo cho Eureka Server biết **không tự đăng ký chính nó** vào danh bạ Registry.
  - Thường đi kèm `eureka.client.fetch-registry: false`: Báo cho server **không cố gắng kết nối tìm kiếm các server Eureka khác** để kéo danh bạ về.
- **Tại sao cần trong môi trường Standalone (Đơn lẻ)?**:
  - Eureka Server là cuốn danh bạ trung tâm. Khi chạy 1 node độc lập, nó không cần tự ghi tên mình vào chính nó.
  - Nếu quên set `false`, khi khởi động Eureka Server sẽ liên tục log ra các ngoại lệ lỗi đỏ (`ConnectException: Connection refused` hoặc `Cannot execute request on any known server`) vì nó cố tìm kiếm các Eureka Peer khác mà không thấy.
  - *(Chỉ bật `true` khi triển khai cụm nhiều Eureka Server - **Eureka High Availability Cluster** để chúng đồng bộ chéo danh bạ cho nhau)*.

---

### 9. Interval heartbeat mặc định của Eureka là bao lâu?
- **Heartbeat Interval (Chu kỳ gửi nhịp tim)**: **30 giây** (`eureka.instance.lease-renewal-interval-in-seconds: 30`).
- **Lease Expiration Duration (Thời gian chờ hết hạn/gỡ bỏ)**: **90 giây** (`eureka.instance.lease-expiration-duration-in-seconds: 90`), tương đương với 3 chu kỳ lỡ nhịp tim liên tiếp thì Eureka Server mới đánh dấu instance chết và thực hiện gỡ bỏ (Eviction).

---

### 10. Nếu Config Server down, các service đang chạy có bị ảnh hưởng không?
1. **Đối với các service ĐANG CHẠY BÌNH THƯỜNG**:
   - **Hoàn toàn KHÔNG bị sập hay ảnh hưởng hoạt động**: Vì toàn bộ cấu hình đã được nạp sẵn vào bộ nhớ RAM (Spring Context) từ lúc khởi động. Service vẫn xử lý request như bình thường.
   - **Hạn chế**: Không thể cập nhật cấu hình mới khi gọi `/actuator/refresh` cho đến khi Config Server được phục hồi.
2. **Đối với service MỚI KHỞI ĐỘNG (hoặc restart / auto-scaling)**:
   - Sẽ **KHỞI ĐỘNG THẤT BẠI (Startup Failure / Crash)**: Vì bước đầu tiên trong quá trình bootstrap là gọi lên Config Server để lấy cấu hình (Database URL, credentials, Kafka,...). Do Config Server chết, service không thể khởi tạo context.
3. **Giải pháp kiến trúc xử lý rủi ro (Resilience & HA)**:
   - **Cụm Config Server sẵn sàng cao (High Availability - HA)**: Chạy từ 2 instance Config Server trở lên đứng sau Load Balancer hoặc đăng ký Config Server lên chính Eureka (`spring.cloud.config.discovery.enabled: true`).
   - **Retry Mechanism**: Tích hợp `spring-retry` để Client tự động thử lại nhiều lần trước khi ném ngoại lệ dừng khởi động.
   - **Cấu hình Fallback**: Cung cấp các giá trị mặc định trong file `application.yml` nội bộ và cấu hình `spring.cloud.config.fail-fast: false` để nếu Config Server down, service vẫn dùng tạm config local để khởi động.

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
