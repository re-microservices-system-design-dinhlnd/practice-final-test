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

## ❓ Câu hỏi Ôn tập

1. Cascade Failure là gì? Tại sao Circuit Breaker ngăn chặn được?
2. Mô tả 3 trạng thái của Circuit Breaker và điều kiện chuyển đổi
3. `sliding-window-size: 10` và `failure-rate-threshold: 50` có nghĩa gì?
4. `permitted-number-of-calls-in-half-open-state: 3` có nghĩa gì?
5. Fallback method trong @CircuitBreaker cần tuân thủ những quy tắc gì?
6. Phân biệt Retry vs Circuit Breaker – khi nào dùng cái nào?
7. Bulkhead Pattern giải quyết vấn đề gì?
8. `record-exceptions` vs `ignore-exceptions` trong config có nghĩa gì?
9. Cần dependency gì để dùng Resilience4j annotation?
10. Làm sao monitor trạng thái Circuit Breaker?

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
