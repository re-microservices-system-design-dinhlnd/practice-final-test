# 🎯 Bộ Câu hỏi Phỏng vấn – Microservice System Design

> **Hướng dẫn sử dụng:** Đọc câu hỏi → Trả lời thành tiếng → So sánh với gợi ý bên dưới
> Đánh dấu ✅ khi đã tự trả lời được, ⚠️ khi cần ôn thêm

---

## 🏗️ PHẦN 1: Architecture & Design (Session 02)

### Q1. ⬜ Monolithic vs Microservice – trình bày ưu nhược điểm của mỗi loại
**Gợi ý trả lời:**
- Monolithic: ✅ Đơn giản, dễ debug, transaction ACID; ❌ Khó scale, deploy chậm, tech lock-in
- Microservice: ✅ Scale độc lập, deploy nhanh, fault isolation; ❌ Phức tạp, data consistency khó

### Q2. ⬜ Khi nào nên chuyển từ Monolithic sang Microservice?
**Gợi ý:** Team > 10 người, cần scale từng phần khác nhau, domain đã rõ ràng, CI/CD thường xuyên

### Q3. ⬜ Database per Service pattern là gì và tại sao quan trọng?
**Gợi ý:** Mỗi service có DB riêng để độc lập về schema, technology, scaling. Tránh coupling qua DB.

### Q4. ⬜ CAP Theorem là gì? Microservice thường chọn gì?
**Gợi ý:** 
- C=Consistency, A=Availability, P=Partition Tolerance
- Chỉ đảm bảo được 2/3
- Microservice chọn AP → Eventual Consistency

### Q5. ⬜ Eventual Consistency là gì?
**Gợi ý:** Dữ liệu không nhất quán ngay lập tức nhưng sẽ nhất quán sau một thời gian (khi tất cả events được xử lý)

---

## ⚙️ PHẦN 2: Configuration & Discovery (Session 03, 04)

### Q6. ⬜ Spring Cloud Config Server hoạt động như thế nào?
**Gợi ý:**
1. Config Server connect đến Git repo
2. Service khởi động → Hỏi Config Server về config của mình
3. Config Server trả về config từ Git
4. Service dùng config nhận được để khởi động

### Q7. ⬜ @RefreshScope làm gì? Trigger refresh như thế nào?
**Gợi ý:** 
- @RefreshScope: Bean được tạo lại khi có refresh event
- Trigger: POST /actuator/refresh hoặc Spring Cloud Bus

### Q8. ⬜ Phân biệt Client-Side và Server-Side Service Discovery
**Gợi ý:**
- Client-Side (Eureka): Client hỏi registry → chọn instance → gọi trực tiếp
- Server-Side: Client gọi LB → LB hỏi registry → LB forward

### Q9. ⬜ Eureka self-preservation mode là gì?
**Gợi ý:** Khi Eureka nhận < 85% heartbeats trong 1 phút → Không xóa services (có thể là network partition, không phải services down)

### Q10. ⬜ Tại sao cần `prefer-ip-address: true` trong Eureka client config?
**Gợi ý:** Đảm bảo Eureka đăng ký IP thay vì hostname → Tránh DNS resolution issues trong container environment

---

## 🌐 PHẦN 3: API Gateway & Load Balancing (Session 05)

### Q11. ⬜ API Gateway là gì? Kể tên 5 chức năng
**Gợi ý:** Single entry point. Chức năng: Routing, Auth, Rate Limiting, SSL Termination, Logging, Load Balancing, Circuit Breaking, Request Transform

### Q12. ⬜ 3 khái niệm cốt lõi của Spring Cloud Gateway?
**Gợi ý:**
- **Route**: Đơn vị routing (ID + Predicate + Filter + URI)
- **Predicate**: Điều kiện match request (path, method, header...)
- **Filter**: Xử lý request/response (pre và post)

### Q13. ⬜ `lb://order-service` trong Gateway config nghĩa là gì?
**Gợi ý:** `lb://` = Load Balanced. Spring Cloud sẽ resolve `order-service` qua Eureka và load balance giữa các instances

### Q14. ⬜ Phân biệt API Gateway và Load Balancer
**Gợi ý:**
- API Gateway: Layer 7, routing phức tạp, auth, transform
- Load Balancer: Layer 4/7, chỉ phân phối traffic
- API Gateway có thể bao gồm Load Balancer

### Q15. ⬜ Các thuật toán Load Balancing phổ biến?
**Gợi ý:** Round Robin (default), Weighted Round Robin, Least Connections, Random, IP Hash

---

## 🔗 PHẦN 4: Sync Communication (Session 06, 07)

### Q16. ⬜ FeignClient là gì? Ưu điểm so với RestTemplate?
**Gợi ý:**
- FeignClient: Declarative HTTP client, chỉ cần khai báo interface
- Ưu điểm: Code ít hơn, tự tích hợp Eureka & Load Balancing, dễ test

### Q17. ⬜ Cần annotation gì để bật FeignClient? Đặt ở đâu?
**Gợi ý:** `@EnableFeignClients` đặt ở main application class

### Q18. ⬜ Fallback trong FeignClient là gì? Implement như thế nào?
**Gợi ý:**
1. Tạo class implements FeignClient interface
2. Override các methods với fallback logic
3. Đặt `fallback = YourFallback.class` trong @FeignClient
4. Bật `spring.cloud.openfeign.circuitbreaker.enabled: true`

### Q19. ⬜ Khi RestTemplate gọi service và nhận HTTP 500, điều gì xảy ra mặc định?
**Gợi ý:** Throw HttpServerErrorException. Có thể custom với ErrorHandler

### Q20. ⬜ Timeout trong RestTemplate được config ở đâu?
**Gợi ý:**
```java
HttpComponentsClientHttpRequestFactory factory = new HttpComponentsClientHttpRequestFactory();
factory.setConnectTimeout(5000);
factory.setReadTimeout(30000);
RestTemplate template = new RestTemplate(factory);
```

---

## 📨 PHẦN 5: Async Communication – Kafka (Session 10, 11)

### Q21. ⬜ Kafka Topic, Partition, Offset là gì?
**Gợi ý:**
- Topic: Kênh messages (như folder)
- Partition: Topic chia thành nhiều phần để parallel processing
- Offset: Số thứ tự của message trong partition (immutable)

### Q22. ⬜ Consumer Group hoạt động như thế nào?
**Gợi ý:**
- Nhiều consumers cùng group đọc cùng 1 topic
- Mỗi partition chỉ được đọc bởi 1 consumer trong group tại 1 thời điểm
- → Load balancing tự động giữa consumers

### Q23. ⬜ Nếu có 3 partitions và 5 consumers trong cùng 1 group?
**Gợi ý:** 3 consumers active (mỗi consumer đọc 1 partition), 2 consumers idle

### Q24. ⬜ At-most-once vs At-least-once vs Exactly-once delivery?
**Gợi ý:**
- At-most-once: Auto commit, có thể mất message (commit trước xử lý)
- At-least-once: Manual commit sau khi xử lý thành công, có thể duplicate
- Exactly-once: Transactions + Idempotent producer, phức tạp nhất

### Q25. ⬜ Tại sao cần `acks: all` trong Kafka Producer?
**Gợi ý:** Đảm bảo message được ghi vào tất cả replica brokers trước khi acknowledge → Không mất data khi 1 broker fail

### Q26. ⬜ `auto-offset-reset: earliest` vs `latest`?
**Gợi ý:**
- earliest: Consumer mới đọc từ đầu topic (từ message cũ nhất)
- latest: Consumer mới chỉ đọc messages mới (từ thời điểm join)

---

## 🛡️ PHẦN 6: Circuit Breaker (Session 12, 13)

### Q27. ⬜ Cascade Failure là gì? Circuit Breaker ngăn chặn như thế nào?
**Gợi ý:**
- Cascade Failure: Service A gọi B bị chậm → A block threads → A crash → Toàn hệ thống sập
- Circuit Breaker: Khi B fail nhiều → "Mở mạch" → A trả fallback ngay → Không block threads

### Q28. ⬜ Mô tả 3 trạng thái Circuit Breaker và điều kiện chuyển đổi
**Gợi ý:**
- CLOSED → OPEN: Failure rate vượt threshold
- OPEN → HALF-OPEN: Sau wait-duration-in-open-state
- HALF-OPEN → CLOSED: Test calls thành công
- HALF-OPEN → OPEN: Test calls thất bại

### Q29. ⬜ Config này có nghĩa gì?
```yaml
sliding-window-size: 10
failure-rate-threshold: 50
minimum-number-of-calls: 5
```
**Gợi ý:** Cần tối thiểu 5 calls. Trong 10 calls gần nhất, nếu ≥ 50% lỗi → Mở circuit breaker

### Q30. ⬜ Phân biệt Circuit Breaker và Retry. Khi nào dùng cái nào?
**Gợi ý:**
- Retry: Lỗi tạm thời (network flap) → Thử lại sẽ thành công
- Circuit Breaker: Service đích thực sự có vấn đề → Không nên tiếp tục gọi
- Thường dùng cả hai: Retry → Circuit Breaker

### Q31. ⬜ Bulkhead Pattern là gì?
**Gợi ý:** Giới hạn số concurrent calls đến một service cụ thể. Giống như vách ngăn trên tàu thủy → 1 khoang bị nước không làm chìm cả tàu

---

## 🔄 PHẦN 7: Saga Pattern (Session 14, 15)

### Q32. ⬜ Tại sao không dùng @Transactional trong Microservice?
**Gợi ý:** @Transactional chỉ hoạt động trong cùng 1 datasource. Microservice có DB riêng → Không có global transaction manager

### Q33. ⬜ Saga Pattern là gì?
**Gợi ý:** Chuỗi các local transactions. Mỗi bước thành công thì kích hoạt bước tiếp theo. Nếu fail → Chạy compensating transactions để undo các bước đã làm

### Q34. ⬜ Compensating Transaction là gì? Ví dụ?
**Gợi ý:**
- Action: Reserve inventory → Compensate: Release inventory
- Action: Process payment → Compensate: Refund payment
- Action: Create order → Compensate: Cancel order

### Q35. ⬜ Choreography vs Orchestration Saga – phân biệt
**Gợi ý:**
- Choreography: Không có trung tâm, mỗi service phản ứng với events → Loose coupling, khó trace
- Orchestration: Orchestrator điều phối tất cả → Centralized logic, dễ trace, potential SPOF

### Q36. ⬜ Idempotency trong Saga là gì? Tại sao cần?
**Gợi ý:** Xử lý cùng 1 event nhiều lần vẫn cho kết quả như xử lý 1 lần. Cần vì Kafka có thể deliver message nhiều lần (at-least-once)

---

## 🚀 PHẦN 8: Caching & Redis (Session 16, 17)

### Q37. ⬜ Cache-Aside Strategy hoạt động như thế nào?
**Gợi ý:**
- Read: Check cache → HIT: return; MISS: query DB → store in cache → return
- Write: Update DB → Invalidate cache

### Q38. ⬜ Phân biệt @Cacheable, @CacheEvict, @CachePut
**Gợi ý:**
- @Cacheable: Đọc cache trước, MISS mới chạy method
- @CacheEvict: Xóa cache entry sau khi method chạy
- @CachePut: Luôn chạy method VÀ cập nhật cache (không bỏ qua method)

### Q39. ⬜ Cache Stampede là gì? Cách phòng tránh?
**Gợi ý:** 
- Vấn đề: Cache expire → Nhiều requests đồng thời query DB
- Giải pháp: Jitter (thêm random vào TTL), Locking, Probabilistic refresh

### Q40. ⬜ Khi nào dùng RedisTemplate thay vì @Cacheable?
**Gợi ý:** Khi cần: Custom TTL per entry, dùng Redis data types khác (List, Set, Hash), atomic operations (increment), manual control over cache keys

---

## 🌟 PHẦN 9: System Design Tổng hợp

### Q41. ⬜ Thiết kế hệ thống đặt hàng (Order System) với Microservice
**Gợi ý – Các services cần có:**
- API Gateway (entry point, auth, routing)
- User Service (quản lý user)
- Product Service (catalog, inventory)
- Order Service (tạo và quản lý order)
- Payment Service (xử lý thanh toán)
- Notification Service (email, SMS)

**Communication patterns:**
- Sync: Gateway → Services (REST/FeignClient)
- Async: Order → Payment → Notification (Kafka)
- Resilience: Circuit Breaker cho các lời gọi sync

**Data management:**
- Saga Pattern cho distributed transaction
- Redis Cache cho product catalog
- Event Sourcing (optional)

### Q42. ⬜ Microservice nào của bạn bị chậm? Debug thế nào?
**Gợi ý:**
1. Distributed Tracing (Zipkin/Jaeger) → Tìm service/span chậm
2. Metrics (Actuator + Prometheus + Grafana) → CPU/Memory/Request rate
3. Logs tập trung (ELK Stack)
4. Database query analysis

### Q43. ⬜ Làm thế nào để deploy Microservice một cách an toàn?
**Gợi ý:**
- Blue-Green Deployment
- Canary Deployment
- Rolling Update
- Feature Flags

### Q44. ⬜ Microservice communication security như thế nào?
**Gợi ý:**
- API Gateway: JWT validation
- Service-to-Service: mTLS hoặc JWT propagation
- Secret management: Vault, Kubernetes Secrets

### Q45. ⬜ Khi nào bạn KHÔNG nên dùng Microservice?
**Gợi ý:**
- Team nhỏ < 5 người
- Domain chưa rõ ràng (sẽ tách sai ranh giới)
- Không có DevOps/Infrastructure team
- MVP/Startup giai đoạn đầu
- Deadline cực gấp

---

## 📊 Bảng Tự Đánh Giá

| Chủ đề | Câu hỏi | Tự đánh giá |
|--------|---------|------------|
| Architecture | Q1–Q5 | ⬜ Cần ôn / ✅ Ổn |
| Config & Discovery | Q6–Q10 | ⬜ Cần ôn / ✅ Ổn |
| API Gateway | Q11–Q15 | ⬜ Cần ôn / ✅ Ổn |
| Sync Communication | Q16–Q20 | ⬜ Cần ôn / ✅ Ổn |
| Kafka | Q21–Q26 | ⬜ Cần ôn / ✅ Ổn |
| Circuit Breaker | Q27–Q31 | ⬜ Cần ôn / ✅ Ổn |
| Saga Pattern | Q32–Q36 | ⬜ Cần ôn / ✅ Ổn |
| Caching & Redis | Q37–Q40 | ⬜ Cần ôn / ✅ Ổn |
| System Design | Q41–Q45 | ⬜ Cần ôn / ✅ Ổn |

---

## 💡 Tips Phỏng vấn Microservice

1. **Luôn đề cập trade-offs**: Mỗi pattern đều có ưu và nhược điểm. Interviewer muốn thấy bạn hiểu trade-offs.

2. **Dùng ví dụ thực tế**: Ví dụ "Trong project của tôi, tôi đã dùng Kafka cho..."

3. **Vẽ kiến trúc**: Khi được hỏi về system design, hãy vẽ diagram trước khi giải thích.

4. **Mention monitoring**: Luôn đề cập đến observability (logging, metrics, tracing) khi nói về production system.

5. **Biết khi nào KHÔNG dùng**: Interviewer sẽ đánh giá cao nếu bạn biết giới hạn của mỗi pattern.
