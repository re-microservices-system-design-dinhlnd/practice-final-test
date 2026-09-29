# Session 14+15: Quản lý Giao dịch Phân tán – Saga Pattern

---

## PHẦN 1: Vấn đề Distributed Transaction

### Local Transaction (Monolithic)
```java
@Transactional  // ← 1 transaction duy nhất, ACID đảm bảo
public void placeOrder(Order order) {
    orderRepository.save(order);        // Bước 1
    inventoryService.reduce(order);     // Bước 2
    paymentService.charge(order);       // Bước 3
    // Nếu bước 3 lỗi → rollback cả 3 bước tự động
}
```

### Distributed Transaction (Microservice) – VẤN ĐỀ
```
Order Service → tạo order (DB Order)
     ↓
Inventory Service → trừ kho (DB Inventory)
     ↓
Payment Service → tính tiền (DB Payment) ← LỖI!

Vấn đề:
  - Không có @Transactional xuyên suốt 3 service
  - Payment lỗi nhưng Order và Inventory đã commit
  - Dữ liệu inconsistent!
```

### Các giải pháp
1. **2PC (Two-Phase Commit)**: Phức tạp, blocking, single point of failure
2. **Saga Pattern**: Phổ biến hơn, eventual consistency, non-blocking

---

## PHẦN 2: Saga Pattern

### Định nghĩa
Saga = Chuỗi các **local transactions**, mỗi transaction:
- Có **compensating transaction** tương ứng (để undo)
- Publish event cho bước tiếp theo
- Nếu bước nào fail → chạy compensating transactions ngược lại

### Ví dụ: Order Saga

```
Bước 1: Create Order (PENDING)
  ✅ OK → Publish "OrderCreated" event
  ❌ FAIL → End (không cần compensate)

Bước 2: Reserve Inventory
  ✅ OK → Publish "InventoryReserved" event
  ❌ FAIL → Compensate: Cancel Order (Bước 1C)

Bước 3: Process Payment
  ✅ OK → Publish "PaymentProcessed" event
  ❌ FAIL → Compensate: Release Inventory (Bước 2C) → Cancel Order (Bước 1C)

Bước 4: Confirm Order (CONFIRMED)
  ✅ OK → Done!
  ❌ FAIL → Compensate: Refund Payment (Bước 3C) → Release Inventory (Bước 2C) → Cancel Order (Bước 1C)
```

---

## PHẦN 3: Hai loại Saga

### 1. Choreography (Vũ điệu – không có chỉ huy)

```
Không có trung tâm điều phối.
Mỗi service lắng nghe event và tự quyết định làm gì.

Order Service ──── [OrderCreated] ──────► Inventory Service
                                               │
                                    [InventoryReserved]
                                               │
                                               ▼
                                         Payment Service
                                               │
                                    [PaymentProcessed]
                                               │
                                               ▼
                                         Order Service
                                    (Update status CONFIRMED)

Nếu Payment FAIL:
Payment Service ──── [PaymentFailed] ──► Inventory Service (release)
                                         Inventory Service ──── [InventoryReleased] ──► Order Service (cancel)
```

**Code – Choreography với Kafka:**

```java
// Order Service - Publisher
@Service
public class OrderService {
    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;
    
    public Order createOrder(CreateOrderRequest request) {
        Order order = orderRepository.save(
            Order.builder().status("PENDING").build()
        );
        
        // Publish event để khởi động Saga
        kafkaTemplate.send("order-created", 
            new OrderCreatedEvent(order.getId(), request));
        
        return order;
    }
    
    // Lắng nghe kết quả từ các service khác
    @KafkaListener(topics = "payment-processed")
    public void handlePaymentProcessed(PaymentProcessedEvent event) {
        orderRepository.updateStatus(event.getOrderId(), "CONFIRMED");
    }
    
    @KafkaListener(topics = "payment-failed")
    public void handlePaymentFailed(PaymentFailedEvent event) {
        orderRepository.updateStatus(event.getOrderId(), "CANCELLED");
    }
}

// Inventory Service - Consumer + Publisher
@Service
public class InventoryService {
    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;
    
    @KafkaListener(topics = "order-created")
    public void handleOrderCreated(OrderCreatedEvent event) {
        try {
            reserveInventory(event);
            kafkaTemplate.send("inventory-reserved", 
                new InventoryReservedEvent(event.getOrderId()));
        } catch (InsufficientStockException e) {
            kafkaTemplate.send("inventory-failed",
                new InventoryFailedEvent(event.getOrderId(), e.getMessage()));
        }
    }
    
    // Compensating transaction
    @KafkaListener(topics = "payment-failed")
    public void handlePaymentFailed(PaymentFailedEvent event) {
        releaseInventory(event.getOrderId()); // Hoàn trả kho
        kafkaTemplate.send("inventory-released",
            new InventoryReleasedEvent(event.getOrderId()));
    }
}
```

### 2. Orchestration (Chỉ huy – có Saga Orchestrator)

```
Có 1 Orchestrator trung tâm điều phối tất cả bước.
Các service không biết về nhau.

         ┌─────────────────┐
         │  Saga           │
         │  Orchestrator   │
         └────────┬────────┘
                  │ 1. Gọi Inventory Service
                  ▼
         ┌─────────────────┐
         │ Inventory Svc   │ → Trả kết quả về Orchestrator
         └─────────────────┘
                  │ 2. Gọi Payment Service
                  ▼
         ┌─────────────────┐
         │  Payment Svc    │ → Trả kết quả về Orchestrator
         └─────────────────┘
                  │ 3. Cập nhật Order Status
                  ▼
         ┌─────────────────┐
         │  Order Svc      │
         └─────────────────┘
```

**Code – Orchestration:**

```java
@Service
public class OrderSagaOrchestrator {
    
    @Autowired private InventoryServiceClient inventoryClient;
    @Autowired private PaymentServiceClient paymentClient;
    @Autowired private OrderRepository orderRepository;
    @Autowired private KafkaTemplate<String, Object> kafkaTemplate;
    
    public void startOrderSaga(Long orderId) {
        Order order = orderRepository.findById(orderId).orElseThrow();
        
        try {
            // Bước 1: Reserve Inventory
            InventoryResult inventoryResult = inventoryClient.reserve(orderId);
            
            try {
                // Bước 2: Process Payment
                PaymentResult paymentResult = paymentClient.charge(orderId);
                
                // Bước 3: Confirm Order
                orderRepository.updateStatus(orderId, "CONFIRMED");
                
            } catch (PaymentException e) {
                // Compensate: Release Inventory
                inventoryClient.release(orderId);
                orderRepository.updateStatus(orderId, "PAYMENT_FAILED");
            }
            
        } catch (InventoryException e) {
            // Không cần compensate bước 1 vì nó đã fail
            orderRepository.updateStatus(orderId, "INSUFFICIENT_STOCK");
        }
    }
}
```

**Orchestration với Kafka (phổ biến hơn cho async):**

```java
@Service
public class OrderSagaOrchestrator {
    
    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;
    
    // Khởi động saga
    public void startSaga(Long orderId) {
        kafkaTemplate.send("reserve-inventory-command",
            new ReserveInventoryCommand(orderId));
    }
    
    // Nhận kết quả từng bước
    @KafkaListener(topics = "inventory-reserved")
    public void onInventoryReserved(InventoryReservedEvent event) {
        // Kho đã được đặt → Gọi Payment
        kafkaTemplate.send("process-payment-command",
            new ProcessPaymentCommand(event.getOrderId()));
    }
    
    @KafkaListener(topics = "inventory-failed")
    public void onInventoryFailed(InventoryFailedEvent event) {
        orderRepository.updateStatus(event.getOrderId(), "CANCELLED");
    }
    
    @KafkaListener(topics = "payment-processed")
    public void onPaymentProcessed(PaymentProcessedEvent event) {
        orderRepository.updateStatus(event.getOrderId(), "CONFIRMED");
    }
    
    @KafkaListener(topics = "payment-failed")
    public void onPaymentFailed(PaymentFailedEvent event) {
        // Compensate: Release inventory
        kafkaTemplate.send("release-inventory-command",
            new ReleaseInventoryCommand(event.getOrderId()));
        orderRepository.updateStatus(event.getOrderId(), "CANCELLED");
    }
}
```

---

## PHẦN 4: So sánh Choreography vs Orchestration

| Tiêu chí | Choreography | Orchestration |
|----------|-------------|---------------|
| **Coordination** | Phân tán (mỗi service tự quyết) | Tập trung (1 orchestrator) |
| **Coupling** | Loose coupling | Services couple với orchestrator |
| **Complexity** | Phức tạp khi nhiều bước | Dễ hiểu flow hơn |
| **Single point of failure** | Không | Orchestrator có thể fail |
| **Testing** | Khó test toàn bộ flow | Dễ test vì logic tập trung |
| **Visibility** | Khó trace flow | Dễ trace (orchestrator biết toàn bộ) |
| **Scalability** | Tốt hơn | Orchestrator có thể là bottleneck |
| **Dùng khi** | Ít bước, team nhỏ | Nhiều bước, cần visibility |

---

## PHẦN 5: Idempotency trong Saga

**Vấn đề:** Kafka gửi message 2 lần → Service xử lý 2 lần → Duplicate

**Giải pháp: Idempotent Consumer**

```java
@Service
public class PaymentService {
    
    @Autowired
    private ProcessedEventRepository processedEventRepo;
    
    @KafkaListener(topics = "process-payment-command")
    @Transactional
    public void processPayment(ProcessPaymentCommand command) {
        String eventId = command.getEventId();
        
        // Kiểm tra đã xử lý chưa
        if (processedEventRepo.existsById(eventId)) {
            log.info("Event {} already processed, skipping", eventId);
            return;
        }
        
        // Xử lý payment...
        doProcessPayment(command);
        
        // Đánh dấu đã xử lý
        processedEventRepo.save(new ProcessedEvent(eventId));
    }
}
```

---

## ❓ Câu hỏi Ôn tập & Trả lời chi tiết

### 1. Tại sao không thể dùng `@Transactional` trong Microservice?
- **Hạn chế của `@Transactional` truyền thống:**
  - `@Transactional` của Spring chỉ quản lý được các **Local Transaction** trên cùng một kết nối Database (`DataSource / PlatformTransactionManager`) duy nhất trong hệ thống Monolithic.
  - Trong Microservices, mỗi service sở hữu một Database độc lập (*Database-per-service pattern*) đặt tại các máy chủ vật lý khác nhau (thậm chí khác loại: MySQL, PostgreSQL, MongoDB). `@Transactional` hoàn toàn không có khả năng gửi tín hiệu commit hay rollback xuyên qua mạng sang các database độc lập của service khác.
- **Tại sao không dùng 2-Phase Commit (2PC / XA):**
  - Giao thức 2PC khóa tài nguyên (blocking lock) quá lâu gây nghẽn cổ chai hiệu năng, tạo điểm sập duy nhất (*Single Point of Failure*) tại Coordinator, và không tương thích với NoSQL hay Message Broker.
  - Do đó, **Saga Pattern** ra đời như một giải pháp chuẩn mực để quản lý giao dịch phân tán thông qua chuỗi các Local Transaction độc lập.

---

### 2. Compensating Transaction là gì? Cho ví dụ
- **Khái niệm:** Là một giao dịch mới tinh được thực thi để **hoàn tác về mặt ngữ nghĩa (Semantic Rollback)** những thay đổi mà một bước local transaction trước đó đã commit thành công vào DB, khi phát hiện có một bước tiếp theo trong chuỗi Saga bị thất bại.
- **Phân biệt Rollback vs Compensate:**
  - *Database Rollback truyền thống:* Hủy bỏ dữ liệu chưa commit ở bộ nhớ đệm (dữ liệu bẩn chưa bao giờ được lưu vĩnh viễn xuống đĩa cứng).
  - *Compensating Transaction:* Bước trước đó **đã commit vĩnh viễn vào DB rồi**, bù trừ là một transaction mới độc lập được chạy để đảo ngược hiệu ứng logic.
- **Ví dụ thực tế:**
  - Thao tác chính: `Khóa 2 sản phẩm trong kho (Reserve 2 items)` ➔ Giao dịch bù trừ: `Mở khóa hoàn lại 2 sản phẩm (Release 2 items)`.
  - Thao tác chính: `Trừ 500.000đ trong ví (Charge 500k)` ➔ Giao dịch bù trừ: `Hoàn trả lại 500.000đ vào ví (Refund 500k)`.

---

### 3. Mô tả flow của Order Saga với 3 bước (Inventory, Payment, Confirmation)
- **Kịch bản 1: Thành công trọn vẹn (Happy Path)**
  1. `Order Service`: Tạo đơn hàng ở trạng thái chờ (`status = PENDING`).
  2. `Inventory Service`: Khóa số lượng sản phẩm trong kho thành công (`INVENTORY_RESERVED`).
  3. `Payment Service`: Trừ tiền tài khoản khách hàng thành công (`PAYMENT_SUCCESS`).
  4. `Order Service`: Xác nhận đơn hàng thành công (`status = ORDER_CONFIRMED`).
- **Kịch bản 2: Thất bại tại bước Payment (Failure Path)**
  1. `Order Service`: Tạo đơn hàng ở trạng thái `PENDING`.
  2. `Inventory Service`: Khóa hàng trong kho thành công (`INVENTORY_RESERVED`).
  3. `Payment Service`: Trừ tiền thất bại (`PAYMENT_FAILED` do hết số dư hoặc thẻ bị khóa).
  4. **Kích hoạt chuỗi bù trừ (Rollback chain):**
     - Bù trừ cho Inventory: `Inventory Service` mở khóa và hoàn trả số lượng hàng lại vào kho (`RELEASE_INVENTORY`).
     - Bù trừ cho Order: `Order Service` cập nhật trạng thái đơn hàng thành thất bại (`status = ORDER_CANCELLED`).

---

### 4. Phân biệt Choreography vs Orchestration Saga
```
CHOREOGRAPHY (Event-driven)                ORCHESTRATION (Command-driven)
Order ──Event──► Inventory                 Order Orchestrator
                   │                         ├──Command──► Inventory
                 Event                       ├──Command──► Payment
                   ▼                         └──Command──► Notification
Payment ◄──────────┘                         (Nhạc trưởng điều phối tập trung)
(Tự phối hợp qua Broker)
```
- **Choreography-based (Vũ đạo / Tự điều phối):**
  - Hoạt động dựa trên **Domain Events** (qua Kafka/RabbitMQ). Không có service nào làm chỉ huy trung tâm.
  - Mỗi service sau khi làm xong việc của mình sẽ phát ra một Event. Các service khác tự lắng nghe Event đó để thực hiện bước tiếp theo.
  - *Hình tượng:* Các vũ công tự nhìn nhau để phối hợp nhảy theo điệu nhạc.
- **Orchestration-based (Dàn nhạc giao hưởng / Điều phối tập trung):**
  - Sử dụng một service trung tâm đóng vai trò là **Nhạc trưởng (Saga Orchestrator)** nắm giữ State Machine của toàn bộ luồng.
  - Orchestrator chủ động gửi các lệnh (Command) yêu cầu từng service con thực thi và lắng nghe kết quả trả về. Nếu có lỗi, chính Orchestrator sẽ ra lệnh bù trừ.
  - *Hình tượng:* Vị nhạc trưởng đứng chỉ huy dàn nhạc giao hưởng.

---

### 5. Ưu điểm lớn nhất của Choreography? Của Orchestration?
- **Choreography:**
  - *Ưu điểm lớn nhất:* **Loose Coupling (Phụ thuộc lỏng lẻo)**, phân tán hoàn toàn, không có điểm sập đơn độc (**No SPOF** - *Single Point of Failure*). Rất phù hợp cho luồng nghiệp vụ đơn giản (2-4 services).
  - *Nhược điểm khi mở rộng:* Khi hệ thống có nhiều bước, luồng event trở thành một "mớ bòng bong" (*Spaghetti Events*), rất khó quan sát tổng thể (low visibility) và cực kỳ khó viết test/trace vết lỗi.
- **Orchestration:**
  - *Ưu điểm lớn nhất:* **High Visibility (Dễ quan sát & kiểm soát)**. Toàn bộ logic luồng, trạng thái và kịch bản bù trừ đều tập trung tại một nơi (State Machine của Orchestrator), cực kỳ dễ theo dõi, dễ debug và dễ viết unit/integration test.
  - *Nhược điểm cần lưu ý:* Orchestrator có thể trở thành điểm nghẽn hiệu năng (*Bottleneck*) và điểm sập duy nhất (*SPOF*) nếu không được thiết kế chịu lỗi (High Availability).

---

### 6. Khi Payment thất bại trong Saga, điều gì phải xảy ra với Inventory?
- **Về mặt nghiệp vụ:** `Inventory Service` **bắt buộc phải thực hiện giao dịch bù trừ để hoàn trả (Release / Unreserve) số lượng hàng đã khóa** lại vào kho, đảm bảo số lượng tồn kho khả dụng để khách hàng khác có thể tiếp tục mua hàng.
- **Cơ chế kỹ thuật đảm bảo:**
  - **Nguyên tắc bất biến:** *Compensating Transaction bắt buộc KHÔNG ĐƯỢC PHÉP thất bại vĩnh viễn!*
  - Lệnh bù trừ được gửi qua Message Broker có tính lưu đĩa bền vững (Kafka/RabbitMQ). Nếu Inventory tạm thời bị sập hoặc mạng chập chờn, message vẫn nằm trong Queue và hệ thống sẽ tự động **Retry liên tục (Exponential Backoff)** cho đến khi hoàn tất việc trả hàng.
  - Nếu gặp lỗi nghiêm trọng (bug code), message sẽ được chuyển vào **Dead Letter Queue (DLQ)** để gửi cảnh báo đỏ cho kỹ sư can thiệp thủ công (Manual Reconciliation), tuyệt đối không để mất hàng tồn kho.

---

### 7. Idempotency trong Saga là gì? Tại sao cần?
- **Định nghĩa:** Một thao tác được gọi là **Idempotent (Tính lũy thừa)** nếu việc thực thi nó 1 lần hay $N$ lần liên tiếp thì kết quả trạng thái cuối cùng của hệ thống vẫn không thay đổi ($f(f(x)) = f(x)$).
- **Tại sao bắt buộc phải có trong Saga:**
  - Các Message Broker như Kafka hoạt động theo cơ chế **At-least-once delivery**. Khi gặp sự cố mạng chập chờn hoặc timeout lúc commit offset, Broker sẽ gửi lại tin nhắn đó lần 2 (Duplicate Message).
  - Nếu Consumer không có tính Idempotent, khách hàng có thể bị **trừ tiền 2 lần (Double Charge)** hoặc kho bị **nhả hàng 2 lần**.
- **Cách implement chuẩn:** Sử dụng **`Idempotency Key`** (hoặc `event_id`). Consumer kiểm tra ID trong bảng `processed_events` trước khi xử lý: nếu đã có ID thì bỏ qua ngay, nếu chưa có thì xử lý logic và lưu ID vào DB trong cùng một local `@Transactional`.

---

### 8. Eventual Consistency trong Saga nghĩa là gì?
- **Bản chất:** Chấp nhận trong khoảng thời gian Saga đang chạy, dữ liệu giữa các microservice tồn tại ở một **trạng thái trung gian tạm thời chưa đồng nhất (Temporarily Inconsistent / Intermediate State)**.
  - *Ví dụ:* Kho đã khóa hàng nhưng tài khoản khách vẫn chưa bị trừ tiền; hoặc tiền đã trừ nhưng đơn hàng vẫn đang ở trạng thái `PENDING`.
- **Cam kết cuối cùng:** Sau một khoảng thời gian ngắn (vài giây), khi toàn bộ chuỗi transaction (hoặc chuỗi bù trừ) chạy xong, dữ liệu trên toàn bộ các database phân tán sẽ **hội tụ về một trạng thái nhất quán và chính xác hoàn toàn** (hoặc tất cả các service cùng hoàn tất thành công, hoặc tất cả đều được hoàn tác bù trừ về trạng thái ban đầu).

---

### 9. Saga có đảm bảo ACID không? Thay thế bằng gì?
- **Saga KHÔNG đảm bảo trọn vẹn mô hình ACID**.
- **Tính chất bị khuyết thiếu lớn nhất:** Đó là chữ **`I` - ISOLATION (Tính cô lập)**:
  - Trong ACID truyền thống, dữ liệu trung gian của một transaction đang chạy dở sẽ bị giấu kín (tránh Dirty Read).
  - Trong Saga, vì mỗi bước là một Local Transaction **đã commit vĩnh viễn vào DB riêng**, nên các transaction khác từ bên ngoài hoàn toàn có thể nhìn thấy dữ liệu dở dang này (*ví dụ: người dùng khác nhìn thấy sản phẩm báo hết hàng dù người mua trước thanh toán thất bại*).
- **Mô hình thay thế:** Được thay thế bằng mô hình **`BASE`** (nền tảng của hệ thống phân tán):
  - **B**asically **A**vailable: Hệ thống luôn ưu tiên tính sẵn sàng phục vụ.
  - **S**oft-state: Trạng thái hệ thống biến thiên theo thời gian ngay cả khi không có input mới.
  - **E**ventual consistency: Cam kết nhất quán và hội tụ dữ liệu cuối cùng.

---

### 10. Trong Orchestration Saga, nếu Orchestrator bị crash, điều gì xảy ra?
- Đơn hàng **KHÔNG BAO GIỜ bị kẹt lơ lửng vĩnh viễn** nếu Orchestrator được thiết kế chuẩn theo mẫu **Persistent State Machine (Saga Log)**.
- **Nguyên tắc thiết kế sống còn:**
  1. Trước khi gửi bất kỳ lệnh (Command) nào sang service tiếp theo, Orchestrator **bắt buộc phải lưu trạng thái hiện tại (`current_step`, `status = IN_PROGRESS`, `payload`) xuống Database vĩnh viễn**, tuyệt đối không lưu trạng thái trên bộ nhớ RAM tạm thời.
  2. Khi Orchestrator khởi động lại (hoặc một instance khác trong cụm cluster chạy lên), một **Background Watcher / Scheduler** sẽ quét bảng Saga Log tìm các saga đang bị treo quá thời gian (Timeout).
  3. Dựa vào bước cuối cùng đã lưu trong DB, Orchestrator sẽ tự động chạy tiếp luồng (**Resume**) hoặc kích hoạt chuỗi bù trừ (**Compensate**) để kết thúc giao dịch an toàn.
*(Các doanh nghiệp thường sử dụng các framework chuyên dụng như **Temporal.io, Cadence, Camunda BPM, hoặc Axon Framework** để quản lý Persistent Saga)*.


---

## 💡 Key Takeaways

```
Saga = Chuỗi local transactions + Compensating transactions

Choreography:
  Service A publish event → Service B listen → Service B publish event...
  "Ai làm gì?" → Mỗi service tự biết

Orchestration:
  Orchestrator ra lệnh → Service thực thi → Orchestrator nhận kết quả
  "Ai làm gì?" → Orchestrator quyết định

Lưu ý:
  ✅ Saga đảm bảo eventual consistency (không phải ACID)
  ✅ Mỗi bước cần có compensating transaction tương ứng
  ✅ Consumer cần idempotent (xử lý duplicate events an toàn)
```
