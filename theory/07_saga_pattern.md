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

## ❓ Câu hỏi Ôn tập

1. Tại sao không thể dùng @Transactional trong Microservice?
2. Compensating Transaction là gì? Cho ví dụ
3. Mô tả flow của Order Saga với 3 bước (Inventory, Payment, Confirmation)
4. Phân biệt Choreography vs Orchestration Saga
5. Ưu điểm lớn nhất của Choreography? Của Orchestration?
6. Khi Payment thất bại trong Saga, điều gì phải xảy ra với Inventory?
7. Idempotency trong Saga là gì? Tại sao cần?
8. Eventual Consistency trong Saga nghĩa là gì?
9. Saga có đảm bảo ACID không? Thay thế bằng gì?
10. Trong Orchestration Saga, nếu Orchestrator bị crash, điều gì xảy ra?

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
