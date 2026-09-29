# Session 02: Từ Monolithic đến Microservice

---

## 1. Kiến trúc Monolithic

### Định nghĩa
Toàn bộ ứng dụng được đóng gói và triển khai như **một đơn vị duy nhất** (single deployable unit).

```
┌─────────────────────────────────────┐
│         MONOLITHIC APP              │
│  ┌──────────┐  ┌──────────────────┐ │
│  │    UI    │  │   Business Logic  │ │
│  └──────────┘  └──────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │         Data Access Layer        │ │
│  └─────────────────────────────────┘ │
└──────────────┬──────────────────────┘
               │
         ┌─────▼─────┐
         │  DATABASE  │
         └───────────┘
```

### Ưu điểm Monolithic
- ✅ Đơn giản để develop & debug (cùng 1 codebase)
- ✅ Dễ test end-to-end
- ✅ Không có network latency giữa các module
- ✅ Transaction ACID dễ quản lý (single DB)
- ✅ Phù hợp cho team nhỏ / giai đoạn đầu

### Nhược điểm Monolithic
- ❌ **Scaling khó**: Scale toàn bộ app dù chỉ 1 module cần scale
- ❌ **Deploy chậm**: 1 thay đổi nhỏ → redeploy toàn bộ
- ❌ **Single point of failure**: 1 bug → toàn bộ app down
- ❌ **Tech lock-in**: Không thể dùng technology khác nhau
- ❌ **Codebase lớn**: Khó maintain khi team lớn lên

---

## 2. Kiến trúc Microservice

### Định nghĩa
Ứng dụng được chia thành nhiều **service nhỏ độc lập**, mỗi service:
- Có trách nhiệm riêng (Single Responsibility)
- Có database riêng (Database per Service)
- Giao tiếp qua network (REST, gRPC, Message Queue)
- Có thể deploy độc lập

```
                    ┌─────────────┐
                    │ API Gateway │
                    └──────┬──────┘
          ┌─────────────────┼─────────────────┐
          │                 │                 │
   ┌──────▼──────┐  ┌───────▼──────┐  ┌──────▼──────┐
   │   User      │  │   Order      │  │  Payment    │
   │  Service    │  │  Service     │  │  Service    │
   └──────┬──────┘  └──────┬───────┘  └──────┬──────┘
          │                │                  │
   ┌──────▼──────┐  ┌──────▼───────┐  ┌──────▼──────┐
   │  Users DB   │  │  Orders DB   │  │ Payment DB  │
   └─────────────┘  └──────────────┘  └─────────────┘
```

### Ưu điểm Microservice
- ✅ **Independent scaling**: Scale từng service riêng
- ✅ **Independent deployment**: Deploy service nào cần
- ✅ **Technology diversity**: Mỗi service dùng tech phù hợp
- ✅ **Fault isolation**: 1 service lỗi không ảnh hưởng toàn hệ thống
- ✅ **Team autonomy**: Mỗi team sở hữu 1 service

### Nhược điểm Microservice
- ❌ **Distributed system complexity**: Network failures, latency
- ❌ **Data consistency**: Không có ACID transaction xuyên service
- ❌ **Service discovery**: Cần cơ chế tìm kiếm service
- ❌ **Operational overhead**: Nhiều service = nhiều thứ cần monitor
- ❌ **Testing khó hơn**: Cần test integration giữa các service

---

## 3. So sánh Trực tiếp

| Tiêu chí | Monolithic | Microservice |
|----------|-----------|--------------|
| **Deployment** | Deploy toàn bộ | Deploy độc lập |
| **Scaling** | Scale toàn bộ | Scale từng service |
| **Technology** | Một tech stack | Đa dạng tech |
| **Database** | Chung 1 DB | DB riêng cho mỗi service |
| **Team** | 1 team lớn | Nhiều team nhỏ |
| **Complexity** | Đơn giản ban đầu | Phức tạp hơn |
| **Fault tolerance** | Thấp | Cao (khi cấu hình đúng) |
| **Communication** | In-process calls | Network calls |
| **Transaction** | ACID đơn giản | Cần Saga Pattern |

---

## 4. Khi nào dùng Microservice?

**Nên dùng Microservice khi:**
- Team lớn (>10 developer)
- Ứng dụng có các phần cần scale khác nhau
- Cần deploy thường xuyên (CI/CD)
- Các phần có yêu cầu công nghệ khác nhau
- Ứng dụng đã mature, domain rõ ràng

**Không nên dùng Microservice khi:**
- Team nhỏ, startup giai đoạn đầu
- Domain chưa rõ ràng (sẽ tách sai)
- Không có DevOps/infrastructure team
- Deadline gấp

> 💡 **Martin Fowler**: "Don't start with microservices. Start with a monolith and break it apart when you have scaling issues."

---

## 5. Các Thách thức của Microservice

### 5.1 CAP Theorem
Hệ thống phân tán chỉ đảm bảo được **2 trong 3**:
- **C** – Consistency (tính nhất quán)
- **A** – Availability (tính khả dụng)
- **P** – Partition Tolerance (chịu lỗi mạng)

Microservice thường chọn **AP** (Availability + Partition Tolerance) → Eventual Consistency

### 5.2 Distributed Tracing
Cần tool để trace 1 request qua nhiều service:
- **Zipkin**, **Jaeger**: Distributed tracing tools
- **Sleuth**: Spring Cloud integration

### 5.3 Data Consistency
- Không có distributed ACID transaction
- Giải pháp: **Saga Pattern** (học ở Session 14)

### 5.4 Service Communication
- **Sync**: REST, gRPC (học Session 06)
- **Async**: Kafka, RabbitMQ (học Session 10)

---

## 6. Design Patterns trong Microservice

| Pattern | Mục đích |
|---------|---------|
| **API Gateway** | Single entry point, routing, auth |
| **Service Discovery** | Tìm địa chỉ service động |
| **Circuit Breaker** | Ngăn cascade failure |
| **Saga** | Distributed transaction |
| **CQRS** | Tách read/write operations |
| **Event Sourcing** | Lưu lịch sử thay đổi dạng event |
| **Sidecar** | Tách cross-cutting concerns |

---

## ❓ Câu hỏi Ôn tập & Lời giải Chi tiết

### 1. Monolithic vs Microservice: Liệt kê 3 ưu điểm và 3 nhược điểm của mỗi loại
- **Monolithic**:
  - *Ưu điểm*:
    1. **Dễ phát triển & triển khai ban đầu**: 1 codebase duy nhất, quy trình build/test/deploy đóng gói trong 1 artifact (.jar, .war).
    2. **Hiệu năng cao, độ trễ thấp**: Giao tiếp trực tiếp qua In-memory / In-process call giữa các hàm, không bị hao phí Network Latency.
    3. **Quản lý Transaction đơn giản**: Chung 1 CSDL quan hệ nên đảm bảo hoàn hảo tính chất **ACID** qua Local Transaction của DB engine.
  - *Nhược điểm*:
    1. **Single Point of Failure (SPOF)**: Một module bị lỗi (memory leak, infinite loop) có thể kéo sập toàn bộ ứng dụng.
    2. **Khó scale linh hoạt**: Khi một chức năng bị nghẽn tải, bắt buộc phải scale toàn bộ cục Monolith (tốn RAM/CPU).
    3. **Ràng buộc công nghệ (Tight Coupling)**: Khó thay đổi hoặc nâng cấp tech stack; codebase phình to khiến việc bảo trì và onboarding người mới rất chậm chạp.

- **Microservice**:
  - *Ưu điểm*:
    1. **Độc lập triển khai & Mở rộng (Independent Deploy & Scale)**: Từng service có thể được deploy và scale riêng biệt theo tải thực tế.
    2. **Cách ly lỗi tốt (Fault Isolation)**: Một service gặp sự cố không làm sập toàn bộ hệ thống nếu có Circuit Breaker.
    3. **Đa dạng công nghệ (Polyglot Tech Stack & Persistence)**: Mỗi service tự do chọn ngôn ngữ và loại Database tối ưu nhất cho bài toán của mình.
  - *Nhược điểm*:
    1. **Độ phức tạp vận hành cao (Operational Overhead)**: Cần hạ tầng mạnh mẽ (Docker, Kubernetes, CI/CD, Centralized Logging, Tracing).
    2. **Network Latency & Rủi ro mạng**: Giao tiếp qua mạng (HTTP/gRPC/Kafka) làm tăng độ trễ và dễ phát sinh lỗi đường truyền.
    3. **Mất tính ACID thuần túy**: Giao dịch phân tán (Distributed Transaction) phức tạp, phải chấp nhận Eventual Consistency và dùng Saga Pattern.

---

### 2. Tại sao "Database per Service" lại quan trọng trong Microservice?
Nếu dùng chung 1 Database (**Shared Database Anti-pattern**), hệ thống sẽ gặp các vấn đề nghiêm trọng:
1. **Loose Coupling (Ràng buộc Schema)**: Nếu dùng chung DB, khi Team A thay đổi tên cột hoặc kiểu dữ liệu trong bảng của họ, **Service của Team B sẽ bị crash**. Điều này phá vỡ hoàn toàn khả năng deploy độc lập.
2. **Tránh Single Point of Failure (SPOF) & Tranh chấp tài nguyên**: Một câu query chậm hoặc deadlock bảng ở Service A sẽ nghẽn Connection Pool và kéo sập tất cả các service khác.
3. **Bảo vệ tính đóng gói dữ liệu (Encapsulation)**: Mọi truy cập vào dữ liệu của một service bắt buộc phải đi qua API/Business Logic của service đó. Dùng chung DB sẽ làm các service khác bypass qua logic kiểm tra nghiệp vụ.
4. **Polyglot Persistence**: Cho phép mỗi bài toán dùng loại DB tối ưu (Sản phẩm dùng Elasticsearch, Giỏ hàng dùng Redis, Thanh toán dùng PostgreSQL).

---

### 3. CAP Theorem là gì? Microservice thường chọn đặc tính nào và tại sao?
- **Định lý CAP**: Trong một hệ thống phân tán, chỉ có thể chọn tối đa **2 trong 3** thuộc tính tại cùng một thời điểm:
  - **C (Consistency)**: Mọi node đều thấy cùng một dữ liệu mới nhất tại cùng một thời điểm.
  - **A (Availability)**: Mọi request đều nhận được phản hồi hợp lệ (không bị treo hay lỗi 500).
  - **P (Partition Tolerance)**: Hệ thống vẫn hoạt động dù kết nối mạng giữa các node bị phân mảnh/đứt đoạn.
- **Lựa chọn trong Microservice**:
  - Trong môi trường phân tán qua mạng, sự cố mạng chắc chắn sẽ xảy ra $\rightarrow$ **P là thuộc tính bắt buộc**.
  - Phần lớn Microservice chọn **AP (Availability + Partition Tolerance)**: Hệ thống ưu tiên luôn sẵn sàng phục vụ người dùng 24/7, chấp nhận dữ liệu có độ trễ cập nhật ngắn và đạt **Eventual Consistency** (nhất quán cuối cùng).
  - *(Ngoại lệ: Nghiệp vụ tài chính/ngân hàng có thể chọn **CP** để đảm bảo tuyệt đối không bị sai lệch số dư).*

---

### 4. Khi nào bạn sẽ khuyên team chuyển từ Monolithic sang Microservice?
Chỉ nên chuyển đổi khi đáp ứng đủ các tiêu chí:
1. **Quy mô Team lớn (>10-15 developers / nhiều squads)**: Team quá đông dẫm chân lên nhau khi merge code và deploy (Conway's Law).
2. **Nhu cầu Scale không đồng đều (Unbalanced Scale)**: Một vài tính năng chịu tải đột biến (Flash Sale, Đặt hàng, Live Stream) trong khi các phần khác rất ít tải.
3. **Nghiệp vụ (Domain) đã rõ ràng**: Hệ thống đã vận hành đủ lâu, xác định được ranh giới nghiệp vụ (Bounded Context theo DDD) để tránh chia tách sai service.
4. **Cần CI/CD & Deploy độc lập liên tục**: Các team muốn release tính năng mới hàng ngày mà không cần chờ đợi chu kỳ release chung của toàn công ty.
5. **Năng lực DevOps & Hạ tầng sẵn sàng**: Team có đủ kiến thức về Docker, Kubernetes, Monitoring, CI/CD.

> 💡 *Lời khuyên của Martin Fowler*: *"Don't start with microservices. Start with a monolith and break it apart when you have scaling issues."*

---

### 5. Distributed Transaction khác gì so với Local Transaction? Giải pháp là gì?
- **Khác biệt**:
  - **Local Transaction**: Diễn ra trên **1 Database duy nhất**, được Database Engine hỗ trợ tự nhiên tính ACID qua các lệnh `BEGIN`, `COMMIT`, `ROLLBACK`.
  - **Distributed Transaction**: Trải dài trên **nhiều Database và nhiều Service khác nhau qua mạng**. Không có transaction boundary chung, không thể rollback tự động bằng lệnh DB thông thường.
- **Giải pháp**:
  - Tránh dùng **2PC (Two-Phase Commit)** vì đây là giao thức blocking, độ trễ cao và tạo ra SPOF tại Coordinator.
  - Sử dụng **Saga Pattern**: Chia một business transaction lớn thành chuỗi các local transaction nhỏ nối tiếp nhau. Nếu có một bước thất bại, Saga sẽ kích hoạt các **Compensating Transactions (Giao dịch bù trừ)** để hoàn tác trạng thái các bước trước đó. Thường kết hợp với Message Queue (Kafka/RabbitMQ) theo dạng **Choreography** hoặc **Orchestration**.

---

### 6. Tại sao cần API Gateway trong kiến trúc Microservice?
API Gateway đóng vai trò là **Single Entry Point** (Điểm tiếp nhận duy nhất) đứng trước toàn bộ hệ thống Microservice với các trách nhiệm chính:
1. **Routing & Reverse Proxy**: Giấu toàn bộ địa chỉ mạng nội bộ của backend; Client chỉ cần gọi tới 1 domain duy nhất của Gateway.
2. **Authentication & Authorization**: Kiểm tra Token (JWT/OAuth2), phân quyền người dùng, xử lý CORS và giải mã HTTPS (SSL Termination) tập trung.
3. **Traffic Management**: Thực hiện **Rate Limiting** (giới hạn số request/phút tránh spam, DDoS) và **Load Balancing** giữa các instance.
4. **API Composition / BFF (Backend For Frontend)**: Gom dữ liệu từ nhiều service trả về 1 response duy nhất cho mobile/web, giảm số lần gọi mạng.
5. **Observability**: Ghi log tập trung, gắn `Trace-ID` để truy vết luồng request.

---

### 7. Service Discovery hoạt động như thế nào?
- **Tại sao không hardcode IP:Port?**: Trong môi trường container/cloud (Docker, Kubernetes, Auto-scaling), các instance service liên tục sinh ra, chết đi hoặc di chuyển sang server khác với **địa chỉ IP và Port động (Dynamic IP:Port)**. Cấu hình cứng sẽ làm gãy kết nối ngay khi container khởi động lại.
- **Cơ chế 3 bước hoạt động**:
  1. **Self-Registration (Đăng ký)**: Khi khởi động, instance tự gửi thông tin (Tên Service, IP, Port) lên **Service Registry** (Eureka, Consul).
  2. **Heartbeat / Health Check**: Định kỳ (vd: mỗi 30s), instance gửi tín hiệu nhịp tim báo trạng thái còn sống. Nếu mất tín hiệu quá thời gian quy định, Registry tự động loại bỏ instance đó.
  3. **Service Lookup & Client-side Load Balancing**: Khi Service A cần gọi Service B, nó truy vấn Registry bằng tên service để lấy danh sách IP/Port đang sống, sau đó dùng thuật toán (Round Robin, Random) để chọn 1 instance gửi request.

---

### 8. Giải thích Eventual Consistency là gì?
- **Định nghĩa**: Là mô hình nhất quán dữ liệu trong hệ thống phân tán, chấp nhận dữ liệu có một khoảng trễ đồng bộ nhất định. Hệ thống cam kết: **nếu không có cập nhật mới nào phát sinh, dần dần (eventually) tất cả các bản sao/service sẽ đạt trạng thái đồng nhất hoàn toàn**.
- **So sánh với Strong Consistency**:
  - **Strong Consistency**: Mọi thao tác đọc ngay sau thao tác ghi đều thấy dữ liệu mới nhất (yêu cầu lock dữ liệu, độ trễ cao, khó scale). *Ví dụ: Rút tiền tại cây ATM*.
  - **Eventual Consistency**: Dữ liệu được đồng bộ bất đồng bộ qua Message Queue/Kafka. Hệ thống phản hồi cực nhanh, tính sẵn sàng cao, chấp nhận người dùng thấy dữ liệu cũ tạm thời trong vài giây. *Ví dụ: Lượt Like trên mạng xã hội, trạng thái đơn hàng từ "Chờ xử lý" chuyển sang "Đã xác nhận"*.

---

### 9. Kể tên 4 Design Pattern thường dùng trong Microservice
1. **API Gateway**: Cổng tiếp nhận duy nhất cho mọi client, xử lý routing, auth, rate limiting.
2. **Circuit Breaker (Resilience4j / Hystrix)**: Ngăn chặn lỗi sập lan truyền (Cascading Failure) khi một service phụ thuộc gặp sự cố (với 3 trạng thái: *Closed, Open, Half-Open*).
3. **Saga Pattern**: Quản lý giao dịch phân tán qua chuỗi các local transaction và giao dịch bù trừ (Compensating Transaction).
4. **CQRS (Command Query Responsibility Segregation)**: Tách riêng mô hình ghi dữ liệu (Command) và mô hình đọc dữ liệu (Query) để tối ưu hiệu năng và khả năng mở rộng.
*(Các pattern tiêu biểu khác: Service Discovery, Sidecar, Event Sourcing, Database per Service).*

---

### 10. Tại sao Testing Microservice khó hơn Monolithic?
- **Các thách thức chính**:
  1. **Phụ thuộc dây chuyền (Dependency Hell)**: Một service phụ thuộc vào nhiều service khác; muốn test integration phải dựng cả hệ sinh thái (các service phụ thuộc, DB, Message Queue), tốn nhiều tài nguyên máy.
  2. **Giao tiếp Bất đồng bộ & Mạng trễ**: Test các luồng qua Kafka/RabbitMQ dễ gặp hiện tượng **Flaky Test** (test lúc pass lúc fail do timeout mạng hoặc độ trễ event).
  3. **Dữ liệu phân tán**: Rất khó chuẩn bị dữ liệu mẫu (Seed Data) và dọn dẹp (Rollback/Cleanup) dữ liệu trên nhiều CSDL khác nhau sau mỗi lần test.
  4. **Rủi ro Breaking Change ở API**: Thay đổi payload response của một service có thể âm thầm làm lỗi các service gọi tới nó.
- **Giải pháp thực tế**:
  - Dùng **Contract Testing (Pact / Spring Cloud Contract)** để kiểm thử giao ước API mà không cần dựng service phụ thuộc thật.
  - Dùng **WireMock / Mock Server** để giả lập response của các service bên ngoài.
  - Dùng **Testcontainers** để tự động khởi tạo môi trường DB / Kafka thật bằng Docker khi test rồi tự hủy.

---

## 💡 Key Takeaways

> **"Microservice solves organizational problems more than technical problems"**
> 
> Mỗi team sở hữu một service → tự chủ, tự deploy → Conway's Law

**Nhớ công thức:**
- 1 Service = 1 Responsibility
- 1 Service = 1 Database
- 1 Service = Deploy independently
