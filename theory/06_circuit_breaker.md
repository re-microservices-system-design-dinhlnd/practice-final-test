# Session 12+13: Kháng Lỗi Hệ Thống – Circuit Breaker (Resilience4j)

---

## PHẦN 1: Vấn đề Cascade Failure

### Kịch bản không có Circuit Breaker

```
Request → Order Service → Payment Service (SLOW/DOWN)
                       ↓
           Order Service đợi timeout (30s)
                       ↓
           Thread bị block 30 giây
                       ↓
           Nhiều requests đến → Nhiều threads bị block
                       ↓
           Thread pool cạn kiệt → Order Service CRASH
                       ↓
           Cascade failure: Toàn bộ hệ thống sập
```

### Giải pháp: Circuit Breaker Pattern

```
Giống như cầu dao điện trong nhà:
  → Khi hệ thống điện bị quá tải → Cầu dao nhảy → Bảo vệ thiết bị
  → Sau khi sửa → Reset cầu dao → Hoạt động lại bình thường

Circuit Breaker trong software:
  → Khi service B bị lỗi nhiều → Circuit "mở" → Ngừng gọi B ngay lập tức
  → Trả về fallback response ngay → Không phải đợi timeout
  → Sau một thời gian → Thử lại → Nếu OK → Circuit "đóng" lại
```

---

## PHẦN 2: 3 Trạng thái của Circuit Breaker

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   CLOSED ──────────────────────────────────► OPEN          │
│   (Hoạt động bình thường)    [Lỗi vượt ngưỡng]  (Ngừng gọi)│
│       ▲                                         │          │
│       │                                         │          │
│       │         HALF-OPEN ◄──────────────────── │          │
│       │        (Thử một số request)   [Wait time]          │
│       │              │                                      │
│       └──────────────┘                                      │
│         [Thử thành công → CLOSED]                           │
│         [Thử thất bại → OPEN lại]                           │
└─────────────────────────────────────────────────────────────┘
```

### Mô tả từng trạng thái:

| Trạng thái | Mô tả | Hành động |
|-----------|-------|-----------|
| **CLOSED** | Mặc định, hoạt động bình thường | Cho phép tất cả requests |
| **OPEN** | Đang bảo vệ, service đích có lỗi | Từ chối ngay, gọi fallback |
| **HALF-OPEN** | Đang kiểm tra xem service đã recover | Cho phép một số request test |

---

## PHẦN 3: Resilience4j

### 1. Setup

**Dependency:**
```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

### 2. Cấu hình Circuit Breaker

**application.yml:**
```yaml
resilience4j:
  circuitbreaker:
    instances:
      payment-service-cb:                    # Tên instance (tùy đặt)
        sliding-window-type: COUNT_BASED     # Đếm theo số request (hoặc TIME_BASED)
        sliding-window-size: 10              # Cửa sổ 10 requests gần nhất
        failure-rate-threshold: 50           # 50% lỗi → OPEN
        wait-duration-in-open-state: 10s     # Giữ OPEN 10 giây
        permitted-number-of-calls-in-half-open-state: 3  # 3 test calls ở HALF-OPEN
        automatic-transition-from-open-to-half-open-enabled: true
        minimum-number-of-calls: 5           # Cần tối thiểu 5 calls trước khi evaluate
        
        # Exception nào được tính là failure
        record-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
          - feign.FeignException
        
        # Exception nào KHÔNG tính là failure
        ignore-exceptions:
          - com.example.BusinessException
          
  # Timeout riêng (kết hợp với Circuit Breaker)
  timelimiter:
    instances:
      payment-service-cb:
        timeout-duration: 3s     # Timeout sau 3 giây
        
  # Retry riêng
  retry:
    instances:
      payment-service-cb:
        max-attempts: 3
        wait-duration: 1s
```

### 3. Sử dụng @CircuitBreaker

```java
@Service
public class PaymentService {
    
    @Autowired
    private PaymentClient paymentClient;
    
    // Circuit Breaker cơ bản
    @CircuitBreaker(name = "payment-service-cb", fallbackMethod = "paymentFallback")
    public PaymentResponse processPayment(PaymentRequest request) {
        return paymentClient.processPayment(request);
    }
    
    // Fallback method - phải có cùng tham số + thêm Throwable
    public PaymentResponse paymentFallback(PaymentRequest request, Throwable t) {
        log.error("Circuit breaker opened! Error: {}", t.getMessage());
        return PaymentResponse.builder()
            .status("PENDING")
            .message("Payment service is temporarily unavailable. Will retry later.")
            .build();
    }
    
    // Circuit Breaker + Retry + TimeLimiter
    @CircuitBreaker(name = "payment-service-cb", fallbackMethod = "paymentFallback")
    @TimeLimiter(name = "payment-service-cb")
    @Retry(name = "payment-service-cb")
    public CompletableFuture<PaymentResponse> processPaymentAsync(PaymentRequest request) {
        return CompletableFuture.supplyAsync(() -> paymentClient.processPayment(request));
    }
}
```

### 4. Các Pattern khác của Resilience4j

#### Retry Pattern
```java
@Retry(name = "retry-service", fallbackMethod = "retryFallback")
public String callWithRetry() {
    return externalService.call();  // Tự động retry nếu lỗi
}
```

```yaml
resilience4j:
  retry:
    instances:
      retry-service:
        max-attempts: 3        # Tổng số lần thử (bao gồm lần đầu)
        wait-duration: 1s      # Đợi 1s giữa mỗi retry
        # Exponential backoff
        enable-exponential-backoff: true
        exponential-backoff-multiplier: 2  # 1s, 2s, 4s...
```

#### Bulkhead Pattern (Giới hạn concurrent calls)
```java
@Bulkhead(name = "payment-bulkhead", type = Bulkhead.Type.SEMAPHORE)
public PaymentResponse processWithBulkhead(PaymentRequest request) {
    return paymentClient.processPayment(request);
}
```

```yaml
resilience4j:
  bulkhead:
    instances:
      payment-bulkhead:
        max-concurrent-calls: 10   # Tối đa 10 concurrent calls
        max-wait-duration: 100ms   # Đợi tối đa 100ms nếu đầy
```

#### RateLimiter Pattern
```java
@RateLimiter(name = "payment-rate-limiter")
public PaymentResponse processWithRateLimit(PaymentRequest request) {
    return paymentClient.processPayment(request);
}
```

```yaml
resilience4j:
  ratelimiter:
    instances:
      payment-rate-limiter:
        limit-for-period: 100        # 100 calls
        limit-refresh-period: 1s     # mỗi 1 giây
        timeout-duration: 0s         # Nếu vượt limit → fail immediately
```

### 5. Monitor Circuit Breaker State

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, metrics, circuitbreakers
  endpoint:
    health:
      show-details: always
  health:
    circuitbreakers:
      enabled: true
```

**Check state via Actuator:**
```bash
GET http://localhost:8080/actuator/health
GET http://localhost:8080/actuator/metrics/resilience4j.circuitbreaker.state
```

---

## PHẦN 4: So sánh các Pattern Resilience

| Pattern | Mục đích | Dùng khi |
|---------|---------|---------|
| **Circuit Breaker** | Ngừng gọi service bị lỗi | Service đích thường xuyên fail |
| **Retry** | Tự động thử lại | Lỗi tạm thời (network flap) |
| **Timeout** | Giới hạn thời gian chờ | Service đích chậm |
| **Bulkhead** | Giới hạn concurrent calls | Tránh resource exhaustion |
| **RateLimiter** | Giới hạn số request/thời gian | API quota management |

---

## ❓ Câu hỏi Ôn tập & Trả lời chi tiết

### 1. Cascade Failure là gì? Tại sao Circuit Breaker ngăn chặn được?
- **Khái niệm Cascade Failure (Lỗi dây chuyền):** Là hiện tượng một microservice đơn lẻ gặp sự cố (bị chậm, nghẽn mạng hoặc sập) kéo theo các service phụ thuộc khác sập theo hàng loạt như hiệu ứng domino.
  - *Nguyên nhân cốt lõi:* Do **Cạn kiệt Thread Pool (Thread Starvation)**. Khi Service A gọi Service B đang bị treo, các luồng (threads) của Service A bị giữ chặt để chờ timeout. Hàng loạt request mới đổ về làm cạn kiệt tài nguyên của Service A ➔ Service A crash ➔ Hệ thống sập toàn bộ.
- **Cách Circuit Breaker ngăn chặn:**
  - **Fail-Fast (Thất bại nhanh):** Khi tỷ lệ lỗi vượt ngưỡng, Circuit Breaker lập tức chuyển sang trạng thái `OPEN`. Mọi request gọi đến downstream service sẽ bị chặn đứng ngay lập tức tại chỗ, không gửi gói tin qua mạng và không chiếm dụng thread.
  - **Fallback:** Lập tức kích hoạt phương thức dự phòng để trả về dữ liệu mặc định hoặc cache cho user.
  - **Bảo vệ service đích:** Cho service đang bị lỗi khoảng thời gian nghỉ để tự phục hồi mà không bị áp lực từ lượng traffic dồn dập.

---

### 2. Mô tả 3 trạng thái của Circuit Breaker và điều kiện chuyển đổi
```
           [Lỗi vượt ngưỡng failure-rate-threshold]
CLOSED ─────────────────────────────────────────────► OPEN
  ▲                                                     │
  │                                                     │ [Hết thời gian chờ:
  │                                                     │  wait-duration-in-open-state]
  │               HALF-OPEN ◄───────────────────────────┘
  │         (Cho 1 vài request đi qua thăm dò)
  │                      │
  └──────────────────────┘
    - Thử thành công ➔ Quay về CLOSED (Hồi phục)
    - Thử thất bại ➔ Quay lại OPEN (Tiếp tục ngắt mạch)
```
1. **`CLOSED` (Đóng mạch - Hoạt động bình thường):**
   - Mọi request được phép đi qua bình thường.
   - *Điều kiện chuyển sang `OPEN`:* Tỷ lệ lỗi trong cửa sổ trượt vượt quá ngưỡng cho phép (`failure-rate > failure-rate-threshold`).
2. **`OPEN` (Ngắt mạch / Mở cầu dao - Chặn đứng cuộc gọi):**
   - Chặn đứng mọi request (Fail-Fast) và chuyển thẳng vào Fallback method mà không gọi mạng.
   - *Điều kiện chuyển sang `HALF-OPEN`:* Hết khoảng thời gian chờ cấu hình trong open state (`wait-duration-in-open-state`, ví dụ sau 10s hoặc 30s).
3. **`HALF-OPEN` (Mở hé / Thăm dò sức khỏe):**
   - Cho phép một số lượng giới hạn request (`permitted-number-of-calls-in-half-open-state`) đi qua để kiểm tra xem service đích đã bình phục chưa.
   - *Nếu các request thăm dò thành công:* Chuyển về **`CLOSED`** (hệ thống hồi phục hoàn toàn).
   - *Nếu các request thăm dò thất bại:* Lập tức quay lại **`OPEN`** và tiếp tục chu kỳ ngắt mạch.

---

### 3. `sliding-window-size: 10` và `failure-rate-threshold: 50` có nghĩa gì?
- **`sliding-window-size: 10`**: Cửa sổ trượt lưu lại kết quả của **10 cuộc gọi (calls) gần nhất** (nếu là `COUNT_BASED`) hoặc trong 10 giây gần nhất (nếu là `TIME_BASED`). Khi có cuộc gọi thứ 11, kết quả của cuộc gọi thứ 1 cũ nhất sẽ bị đẩy ra ngoài.
- **`failure-rate-threshold: 50`**: Ngưỡng tỷ lệ lỗi tối đa cho phép là **50%**.
- **Ý nghĩa phối hợp:** Cứ trong 10 cuộc gọi gần nhất, nếu có từ **5 cuộc gọi bị lỗi (≥ 50%)** trở lên thì Circuit Breaker sẽ tự động ngắt mạch và nhảy từ `CLOSED` sang `OPEN`.

---

### 4. `permitted-number-of-calls-in-half-open-state: 3` có nghĩa gì?
- **Ý nghĩa:** Khi Circuit Breaker vừa chuyển từ `OPEN` sang `HALF-OPEN`, nó chỉ cấp phép cho tối đa **3 request đầu tiên đi qua để thăm dò (Trial Calls)**. Mọi request khác đến trong lúc này vẫn bị chặn.
- **Cơ chế đánh giá:**
  - Sau khi nhận kết quả của 3 request thăm dò này, Resilience4j sẽ tính toán tỷ lệ lỗi:
    - Nếu thành công (tỷ lệ lỗi < `failure-rate-threshold`) ➔ Chuyển về **`CLOSED`**.
    - Nếu thất bại (tỷ lệ lỗi ≥ `failure-rate-threshold`) ➔ Lập tức quay lại **`OPEN`**.

---

### 5. Fallback method trong `@CircuitBreaker` cần tuân thủ những quy tắc gì?
Một phương thức Fallback trong Resilience4j bắt buộc phải tuân thủ **4 quy tắc nghiêm ngặt**:
1. **Cùng Return Type:** Kiểu dữ liệu trả về phải trùng khớp hoàn toàn (hoặc là kiểu cha tương thích) với method gốc.
2. **Cùng danh sách tham số:** Phải giữ nguyên toàn bộ các tham số của method gốc theo đúng thứ tự.
3. **Thêm `Throwable` ở vị trí cuối cùng:** Tham số cuối cùng của Fallback method bắt buộc phải là `Throwable` (hoặc Exception cụ thể để bắt nguyên nhân lỗi).
4. **Cùng nằm trong một Class:** Mặc định Fallback method phải nằm trong cùng Class với method được gắn `@CircuitBreaker`, và tên method phải khớp với thuộc tính `fallbackMethod = "tên_fallback"`.

*Ví dụ minh họa chuẩn:*
```java
// Method gốc
@CircuitBreaker(name = "payment-cb", fallbackMethod = "paymentFallback")
public PaymentResponse processPayment(PaymentRequest request) { ... }

// Method Fallback chuẩn quy tắc:
public PaymentResponse paymentFallback(PaymentRequest request, Throwable t) {
    log.error("Payment thất bại: {}", t.getMessage());
    return new PaymentResponse("FAILED", "Dịch vụ tạm thời gián đoạn");
}
```

---

### 6. Phân biệt Retry vs Circuit Breaker – khi nào dùng cái nào?
- **So sánh mục đích:**
  - **`Retry` (Thử lại):** Dùng cho **Lỗi tạm thời (Transient Faults / Network Flaps)** — ví dụ mạng chập chờn trong 100ms, thử lại sau 1-2 giây là thành công.
  - **`Circuit Breaker` (Ngắt mạch):** Dùng cho **Lỗi kéo dài / Sập hệ thống (Persistent Failures)** — ví dụ service đích đã chết hoặc tràn bộ nhớ, việc tiếp tục gọi chỉ làm lãng phí tài nguyên và làm hệ thống nghẽn thêm.
- **Nguy cơ khi kết hợp thiếu cẩn trọng ("Cơn bão Retry" - Retry Storm / Tự DDoS):**
  - Khi service đích đang bị quá tải, nếu 1.000 client đều cấu hình retry 3 lần, tổng lượng request dội vào service đích sẽ tăng vọt thành **3.000 requests**!
  - Lượng request nhân lên này chẳng khác nào một cuộc tấn công tự DDoS, đè bẹp service đích khiến nó không thể nào tự hồi phục.
- **Quy tắc phối hợp chuẩn:** Luôn áp dụng **Exponential Backoff** kèm **Jitter**, và khi Circuit Breaker đã nảy sang `OPEN` thì phải **chặn đứng luôn cả Retry**.

---

### 7. Bulkhead Pattern giải quyết vấn đề gì?
- **Nguồn gốc thực tế:** Bắt nguồn từ các **vách ngăn chống nước (Bulkheads)** chia thân tàu thủy thành nhiều khoang độc lập. Khi tàu thủng một khoang, nước chỉ ngập khoang đó, các khoang khác vẫn khô giúp tàu không bị chìm.
- **Vấn đề giải quyết trong Microservices:** **Chống cạn kiệt tài nguyên (Resource Exhaustion / Thread Starvation)**. Ngăn không cho một service bị lỗi hoặc chậm chạp chiếm dụng hết toàn bộ Thread Pool của server, khiến các service khỏe mạnh khác bị tê liệt theo.
- **2 cách triển khai trong Resilience4j:**
  1. **Semaphore Bulkhead (Mặc định):** Dùng biến đếm Semaphore để giới hạn số lượng request đồng thời (Concurrent Calls). Rất nhẹ, chạy chung thread của caller.
  2. **ThreadPool Bulkhead:** Cấp một Thread Pool và Queue độc lập tách biệt cho từng tác vụ bên ngoài, chạy bất đồng bộ (`CompletableFuture`).

---

### 8. `record-exceptions` vs `ignore-exceptions` trong config có nghĩa gì?
- **`record-exceptions`**: Danh sách các Exception được tính là **lỗi kỹ thuật hệ thống (Failure)** để tính toán tỷ lệ lỗi trong sliding window (thường là lỗi mạng, timeout, service down: `IOException`, `TimeoutException`, `FeignException`, `5xx`).
- **`ignore-exceptions`**: Danh sách các Exception bị **bỏ qua**, không bị tính là thất bại (và cũng không tính là thành công, hoàn toàn vô hại với tỷ lệ lỗi). Thường dùng cho các **lỗi nghiệp vụ (Business Exceptions)** như: `BadRequestException` (400), `UserNotFoundException` (404), `ValidationException`.
- **Ý nghĩa thực tế:** Nếu không cấu hình `ignore-exceptions`, khi người dùng nhập sai mật khẩu 10 lần liên tiếp (lỗi 400), Circuit Breaker sẽ hiểu nhầm hệ thống bị sập và **ngắt cầu dao (`OPEN`) luôn cả chức năng đăng nhập** của những người dùng vô tội khác!

---

### 9. Cần dependency gì để dùng Resilience4j annotation?
Trong file `pom.xml`, bắt buộc phải có **2 dependencies cốt lõi**:
1. **`resilience4j-spring-boot3`** (hoặc `resilience4j-spring-boot2`): Thư viện lõi chứa các logic Circuit Breaker, Retry, Bulkhead.
2. **`spring-boot-starter-aop`** (**Cực kỳ quan trọng, rất dễ bị thiếu**): Cung cấp runtime cho AspectJ.
   - *Lý do:* Các annotation như `@CircuitBreaker`, `@Retry` hoạt động bằng cơ chế **Spring AOP**. Nếu thiếu dependency này, code Java vẫn biên dịch bình thường nhưng khi chạy, Spring sẽ âm thầm bỏ qua annotation và không có bất kỳ cơ chế ngắt mạch nào được kích hoạt!
*(Ngoài ra, khuyến nghị thêm `spring-boot-starter-actuator` để phục vụ việc giám sát metrics).*

---

### 10. Làm sao monitor trạng thái Circuit Breaker?
- **Sử dụng Spring Boot Actuator qua 2 endpoint chính:**
  1. `GET /actuator/health`: Giám sát tình trạng sức khỏe và trạng thái hiện tại của Circuit Breaker (`UP`, `CIRCUIT_OPEN`, `CIRCUIT_HALF_OPEN`).
  2. `GET /actuator/metrics/resilience4j.circuitbreaker.state`: Đo lường chi tiết các chỉ số (tỷ lệ lỗi, số lượng request thành công/thất bại).
- **Cấu hình bắt buộc trong `application.yml`:**
  ```yaml
  management:
    endpoints:
      web:
        exposure:
          include: health, metrics, circuitbreakers
    endpoint:
      health:
        show-details: always
    health:
      circuitbreakers:
        enabled: true
  ```
- **Triển khai Production:** Tích hợp endpoint `/actuator/prometheus` với **Prometheus** để cào dữ liệu định kỳ và hiển thị trực quan trạng thái cầu dao trên Dashboard của **Grafana**.


---

## 💡 Key Takeaways

```
Circuit Breaker States:
  CLOSED → (failure-rate > threshold) → OPEN
  OPEN → (after wait-duration) → HALF-OPEN
  HALF-OPEN → (test calls OK) → CLOSED
  HALF-OPEN → (test calls FAIL) → OPEN

Resilience4j Annotations:
  @CircuitBreaker(name, fallbackMethod)
  @Retry(name)
  @TimeLimiter(name)
  @Bulkhead(name, type)
  @RateLimiter(name)

Fallback rule:
  Cùng method signature + thêm Throwable parameter cuối
```
