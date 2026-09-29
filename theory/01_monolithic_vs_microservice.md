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

## ❓ Câu hỏi Ôn tập

1. **Monolithic vs Microservice**: Liệt kê 3 ưu điểm và 3 nhược điểm của mỗi loại
2. Tại sao "Database per Service" lại quan trọng trong Microservice?
3. CAP Theorem là gì? Microservice thường chọn đặc tính nào và tại sao?
4. Khi nào bạn sẽ khuyên team chuyển từ Monolithic sang Microservice?
5. Distributed Transaction khác gì so với Local Transaction? Giải pháp là gì?
6. Tại sao cần API Gateway trong kiến trúc Microservice?
7. Service Discovery hoạt động như thế nào?
8. Giải thích Eventual Consistency là gì?
9. Kể tên 4 design pattern thường dùng trong Microservice
10. Tại sao testing Microservice khó hơn Monolithic?

---

## 💡 Key Takeaways

> **"Microservice solves organizational problems more than technical problems"**
> 
> Mỗi team sở hữu một service → tự chủ, tự deploy → Conway's Law

**Nhớ công thức:**
- 1 Service = 1 Responsibility
- 1 Service = 1 Database
- 1 Service = Deploy independently
