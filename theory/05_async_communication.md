# Session 10+11: Giao tiếp Bất đồng bộ – Apache Kafka & WebFlux

---

## PHẦN 1: Tại sao cần Giao tiếp Bất đồng bộ?

### Vấn đề với Đồng bộ (REST)

```
Order Service → [REST] → Payment Service → [REST] → Notification Service

Vấn đề:
  1. Nếu Payment Service down → Order Service bị block
  2. Nếu Notification Service chậm → Làm chậm toàn bộ chain
  3. Tight coupling: Order Service cần biết địa chỉ của Payment Service
  4. Khó scale riêng từng service
```

### Giải pháp: Message Queue (Kafka)

```
Order Service → [Kafka Topic] ← Payment Service
                              ← Notification Service
                              ← Analytics Service

Ưu điểm:
  ✅ Loose coupling: Services không biết nhau
  ✅ Fault tolerance: Message được lưu, xử lý sau khi service recover
  ✅ Scale độc lập: Thêm consumer không cần sửa producer
  ✅ Non-blocking: Producer không đợi consumer xử lý xong
```

---

## PHẦN 2: Apache Kafka

### 1. Kiến trúc Kafka

```
                    ┌─────────────────────────────────┐
                    │           KAFKA CLUSTER           │
                    │                                   │
   Producer ──────► │  Topic: "orders"                 │ ◄──── Consumer Group A
                    │  ┌──────────┬──────────┬──────┐  │      (Order Service)
                    │  │Partition0│Partition1│Part2 │  │
                    │  │[msg1]    │[msg2]    │[msg3]│  │ ◄──── Consumer Group B
                    │  │[msg4]    │          │      │  │      (Analytics Service)
                    │  └──────────┴──────────┴──────┘  │
                    │                                   │
                    │  Zookeeper / KRaft (metadata)     │
                    └─────────────────────────────────┘
```

### 2. Các khái niệm quan trọng

| Khái niệm | Định nghĩa |
|-----------|-----------|
| **Topic** | Kênh chứa messages, như 1 "folder" |
| **Partition** | Topic được chia thành partitions để parallel processing |
| **Offset** | Vị trí của message trong partition (sequential, immutable) |
| **Producer** | Service gửi message vào Kafka |
| **Consumer** | Service đọc message từ Kafka |
| **Consumer Group** | Nhóm consumers cùng đọc 1 topic, mỗi partition chỉ được đọc bởi 1 consumer trong group |
| **Broker** | Kafka server, lưu trữ data |
| **Replication Factor** | Số bản sao của mỗi partition (HA) |

### 3. Consumer Group hoạt động như thế nào?

```
Topic "orders" có 3 partitions:

Consumer Group "order-processing" có 3 instances:
  Instance 1 → reads Partition 0
  Instance 2 → reads Partition 1
  Instance 3 → reads Partition 2

⚡ Kết quả: 3x throughput so với 1 consumer!

Nếu thêm Instance 4 vào group → 1 instance sẽ idle (số partitions < số consumers)
Bài học: Số partitions = max số consumers hiệu quả
```

### 4. Setup Kafka trong Spring Boot

**Dependency:**
```xml
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

**application.yml:**
```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      
    consumer:
      group-id: order-service-group
      auto-offset-reset: earliest   # earliest: đọc từ đầu, latest: chỉ đọc mới
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "*"
```

### 5. Kafka Producer

```java
@Service
public class OrderEventPublisher {
    
    @Autowired
    private KafkaTemplate<String, OrderEvent> kafkaTemplate;
    
    private static final String TOPIC = "order-events";
    
    // Gửi message đơn giản
    public void publishOrderCreated(Order order) {
        OrderEvent event = new OrderEvent("ORDER_CREATED", order);
        kafkaTemplate.send(TOPIC, order.getId().toString(), event);
    }
    
    // Gửi với callback
    public void publishOrderWithCallback(Order order) {
        OrderEvent event = new OrderEvent("ORDER_CREATED", order);
        
        CompletableFuture<SendResult<String, OrderEvent>> future = 
            kafkaTemplate.send(TOPIC, event);
        
        future.thenAccept(result -> {
            log.info("Message sent successfully to partition: {}, offset: {}",
                result.getRecordMetadata().partition(),
                result.getRecordMetadata().offset());
        }).exceptionally(ex -> {
            log.error("Failed to send message: {}", ex.getMessage());
            return null;
        });
    }
    
    // Gửi đến partition cụ thể
    public void publishToPartition(Order order, int partition) {
        OrderEvent event = new OrderEvent("ORDER_CREATED", order);
        kafkaTemplate.send(TOPIC, partition, order.getId().toString(), event);
    }
}
```

### 6. Kafka Consumer

```java
@Service
public class OrderEventConsumer {
    
    // Consume đơn giản
    @KafkaListener(topics = "order-events", groupId = "payment-service-group")
    public void handleOrderEvent(OrderEvent event) {
        log.info("Received order event: {}", event.getType());
        
        if ("ORDER_CREATED".equals(event.getType())) {
            processPayment(event.getOrder());
        }
    }
    
    // Consume với metadata
    @KafkaListener(topics = "order-events", groupId = "analytics-group")
    public void handleWithMetadata(
            @Payload OrderEvent event,
            @Header(KafkaHeaders.RECEIVED_PARTITION) int partition,
            @Header(KafkaHeaders.OFFSET) long offset,
            @Header(KafkaHeaders.RECEIVED_KEY) String key) {
        
        log.info("Event: {}, Partition: {}, Offset: {}, Key: {}", 
            event.getType(), partition, offset, key);
    }
    
    // Batch consumer (nhận nhiều messages cùng lúc)
    @KafkaListener(topics = "order-events", 
                   groupId = "batch-group",
                   containerFactory = "batchFactory")
    public void handleBatch(List<OrderEvent> events) {
        log.info("Received batch of {} events", events.size());
        events.forEach(this::processEvent);
    }
    
    // Error handling
    @KafkaListener(topics = "order-events", groupId = "resilient-group")
    public void handleWithErrorHandling(OrderEvent event, Acknowledgment ack) {
        try {
            processPayment(event.getOrder());
            ack.acknowledge(); // Commit offset chỉ khi xử lý thành công
        } catch (Exception e) {
            log.error("Failed to process event: {}", e.getMessage());
            // Không ack → message sẽ được retry
        }
    }
}
```

### 7. Tạo Topic programmatically

```java
@Configuration
public class KafkaTopicConfig {
    
    @Bean
    public NewTopic orderEventsTopic() {
        return TopicBuilder.name("order-events")
            .partitions(3)           // 3 partitions
            .replicas(1)             // 1 replica (dev)
            .build();
    }
    
    @Bean
    public NewTopic paymentEventsTopic() {
        return TopicBuilder.name("payment-events")
            .partitions(6)
            .replicas(3)             // 3 replicas (production)
            .compact()               // Log compaction
            .build();
    }
}
```

### 8. Message Delivery Guarantees

| Guarantee | Config | Mô tả |
|-----------|--------|-------|
| **At most once** | auto.commit=true | Có thể mất message |
| **At least once** | ack=all, manual commit | Có thể duplicate |
| **Exactly once** | Transactions + idempotent | Phức tạp nhất |

```yaml
# At-least-once (phổ biến nhất)
spring:
  kafka:
    producer:
      acks: all              # Đợi tất cả replicas xác nhận
      retries: 3
    consumer:
      enable-auto-commit: false  # Tắt auto commit
```

---

## PHẦN 3: WebFlux & Reactive Programming

### 1. Blocking vs Non-blocking

```
Blocking (RestTemplate, JPA):
  Thread 1 → Gửi request → WAIT... → Nhận response → Xử lý
  Thread 2 → Gửi request → WAIT... → Nhận response → Xử lý
  → N requests = N threads (tốn memory)

Non-blocking (WebFlux):
  Thread 1 → Gửi request → làm việc khác → callback khi có response
  → N requests có thể chạy trên ít threads hơn N
  → Phù hợp cho I/O intensive applications
```

### 2. Reactor Types (Mono & Flux)

```java
// Mono<T>: 0 hoặc 1 giá trị
Mono<UserDTO> user = webClient.get()
    .uri("/users/1")
    .retrieve()
    .bodyToMono(UserDTO.class);

// Flux<T>: 0 đến N giá trị (stream)
Flux<ProductDTO> products = webClient.get()
    .uri("/products")
    .retrieve()
    .bodyToFlux(ProductDTO.class);
```

### 3. WebClient (thay thế RestTemplate)

```java
@Configuration
public class WebClientConfig {
    
    @Bean
    @LoadBalanced
    public WebClient.Builder webClientBuilder() {
        return WebClient.builder();
    }
}

@Service
public class UserService {
    
    @Autowired
    private WebClient.Builder webClientBuilder;
    
    // GET → Mono
    public Mono<UserDTO> getUser(Long id) {
        return webClientBuilder.build()
            .get()
            .uri("http://user-service/users/{id}", id)
            .header("Authorization", "Bearer token")
            .retrieve()
            .onStatus(HttpStatus::is4xxClientError, response ->
                Mono.error(new UserNotFoundException("User not found")))
            .bodyToMono(UserDTO.class);
    }
    
    // POST
    public Mono<UserDTO> createUser(CreateUserRequest request) {
        return webClientBuilder.build()
            .post()
            .uri("http://user-service/users")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(UserDTO.class);
    }
    
    // Gọi song song nhiều services
    public Mono<OrderSummaryDTO> getOrderSummary(Long orderId) {
        Mono<OrderDTO> order = getOrder(orderId);
        Mono<UserDTO> user = getUser(1L);
        
        // Zip: chờ cả 2 xong rồi combine
        return Mono.zip(order, user, (o, u) -> 
            new OrderSummaryDTO(o, u));
    }
    
    // flatMap: chain multiple async calls
    public Mono<String> processOrder(Long userId, Long productId) {
        return getUser(userId)
            .flatMap(user -> getProduct(productId)
                .flatMap(product -> createOrder(user, product)));
    }
}
```

### 4. Reactive Controller

```java
@RestController
@RequestMapping("/orders")
public class OrderController {
    
    // Trả về Mono (single item)
    @GetMapping("/{id}")
    public Mono<OrderDTO> getOrder(@PathVariable Long id) {
        return orderService.findById(id);
    }
    
    // Trả về Flux (multiple items / stream)
    @GetMapping
    public Flux<OrderDTO> getAllOrders() {
        return orderService.findAll();
    }
    
    // Server-Sent Events (real-time stream)
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<OrderDTO> streamOrders() {
        return orderService.streamNewOrders(); // Flux liên tục
    }
}
```

---

## PHẦN 4: So sánh Kafka vs REST

| Tiêu chí | REST (Sync) | Kafka (Async) |
|----------|-------------|---------------|
| **Coupling** | Tight | Loose |
| **Blocking** | Có | Không |
| **Message persistence** | Không | Có (configurable) |
| **Ordering** | Không đảm bảo | Đảm bảo trong partition |
| **Replay** | Không | Có (đọc lại offset cũ) |
| **Throughput** | Thấp hơn | Cao hơn |
| **Latency** | Thấp | Cao hơn 1 chút |
| **Complexity** | Đơn giản | Phức tạp hơn |
| **Use case** | Query, CRUD | Events, notifications |

---

## ❓ Câu hỏi Ôn tập & Trả lời chi tiết

### 1. Tại sao cần giao tiếp bất đồng bộ? Liệt kê 3 ưu điểm so với REST
- **Vấn đề của REST đồng bộ trong Microservices:**
  - **Nghẽn chuỗi gọi (Service Chain Latency):** Khi A gọi B, B gọi C, thời gian phản hồi là tổng thời gian của cả chuỗi. Nếu một service chậm, toàn bộ chuỗi bị nghẽn.
  - **Lỗi dây chuyền (Cascading Failure):** Nếu downstream service (ví dụ Payment/Notification) bị sập, upstream service (Order) sẽ bị cạn kiệt tài nguyên (Thread Pool) và sập theo.
  - **Gắn kết chặt (Tight Coupling):** Service gọi bắt buộc phải biết địa chỉ mạng/tên của service nhận.
- **4 ưu điểm vượt trội của Message-driven (Kafka):**
  1. **Loose Coupling (Tách rời các service):** Producer chỉ đẩy message/event vào Topic mà không cần biết Consumer là ai, địa chỉ ở đâu, hay có bao nhiêu Consumer đang lắng nghe.
  2. **Non-blocking & High Performance:** Producer gửi message vào Kafka xong là tiếp tục phục vụ client khác ngay lập tức, không bị block thread chờ đợi.
  3. **Fault Tolerance & Resilience (Khả năng chịu lỗi cao):** Nếu Consumer service bị sập hoặc bảo trì, message vẫn nằm an toàn trên Kafka Broker và sẽ được xử lý đầy đủ khi Consumer hồi phục, không làm mất dữ liệu đơn hàng.
  4. **Traffic Spikes Buffering (Đệm tải & Xả tải):** Trong các dịp cao điểm (Flash Sale), Kafka đóng vai trò như một hồ chứa đệm, giúp Consumer đọc và xử lý từ từ theo đúng công suất cho phép mà không bị tràn bộ nhớ hay sập database.

---

### 2. Giải thích Kafka Topic, Partition, Offset, Consumer Group
- **Topic:** Kênh/danh mục logic để chứa các message (tương đương với một Table trong cơ sở dữ liệu hoặc một Folder lưu trữ).
- **Partition:** Đơn vị phân chia vật lý của một Topic. Một Topic có thể có nhiều Partitions nằm rải rác trên nhiều Broker khác nhau, cho phép Kafka phân tán dữ liệu và xử lý song song (*Parallel Processing*).
- **Offset:** Số nguyên tăng dần tuần tự (sequential, immutable) định danh vị trí duy nhất của từng message trong Partition. Hoạt động giống như **"dấu trang (bookmark)"** để Consumer ghi nhớ vị trí đã đọc đến đâu.
- **Consumer Group:** Tập hợp các Consumer cùng phối hợp đọc dữ liệu từ một Topic để chia tải.
  - *Quy tắc vàng:* Tại một thời điểm, **một Partition chỉ được đọc bởi tối đa một Consumer** trong cùng một group.

---

### 3. Nếu có 3 partitions và 5 consumers trong cùng 1 group, điều gì xảy ra?
- **Hiện tượng xảy ra:**
  - 3 Partitions sẽ được gán cho 3 Consumers (mỗi Consumer đọc 1 Partition).
  - **2 Consumers còn lại sẽ rơi vào trạng thái nhàn rỗi (IDLE / Standby)**, không được gán bất kỳ partition nào và không nhận được message nào để xử lý.
- **Về hiệu năng:** **Hiệu năng KHÔNG hề tăng thêm** so với khi chỉ chạy 3 Consumers, vì số lượng partitions chính là giới hạn trên của mức độ song song (Max Concurrency) trong cùng một group.
- **Ý nghĩa thực tế của 2 Consumer nhàn rỗi:** Đóng vai trò là **Hot Standby (Dự phòng)**. Nếu chẳng may 1 trong 3 active consumer bị chết (crash), cơ chế **Rebalance** của Kafka sẽ lập tức gán partition đó cho 1 trong 2 consumer nhàn rỗi để tiếp tục xử lý ngay mà không làm gián đoạn hệ thống.
- **Quy tắc thiết kế:** *Số Partitions = Số lượng Consumer tối đa hoạt động hiệu quả trong một Group*.

---

### 4. `auto-offset-reset: earliest` vs `latest` khác nhau thế nào?
- **Điều kiện phát huy tác dụng:** Cấu hình này **CHỈ** được kích hoạt trong 2 trường hợp:
  1. Consumer Group **lần đầu tiên kết nối vào Topic** (chưa từng lưu lại lịch sử `committed offset` trên Kafka).
  2. `Offset` trước đó của group **đã bị xóa/hết hạn** trên Broker (do chính sách dọn dẹp log retention).
  *(Nếu group đã có committed offset hợp lệ, ứng dụng luôn đọc tiếp từ offset tiếp theo bất kể đặt `earliest` hay `latest`)*.
- **So sánh 2 giá trị:**
  - **`earliest`:** Bắt đầu đọc từ message cũ nhất còn tồn tại trong Partition (offset 0 hoặc offset nhỏ nhất còn lưu).  
    *Khi nào dùng:* Dịch vụ nạp dữ liệu phân tích (Analytics), đồng bộ dữ liệu vào kho data mới cần đọc lại toàn bộ lịch sử.
  - **`latest`** *(Mặc định của Kafka):* Bỏ qua toàn bộ dữ liệu lịch sử trong quá khứ, chỉ bắt đầu đọc các message mới được ghi vào Topic sau thời điểm Consumer kết nối.  
    *Khi nào dùng:* Dịch vụ gửi thông báo đẩy (Push Notification), chat realtime, cảm biến IoT nơi dữ liệu cũ không còn giá trị.

---

### 5. At-most-once, at-least-once, exactly-once delivery là gì?
| Cấp độ | Cơ chế cam kết | Rủi ro | Ứng dụng thực tế |
|:---|:---|:---:|:---|
| **At-most-once** *(Tối đa 1 lần)* | Consumer commit offset **TRƯỚC** khi hoàn tất xử lý logic và ghi DB. Nếu app sập giữa chừng, tin nhắn đó bị bỏ qua vĩnh viễn. | ❌ **Mất message** | Dùng cho log metric, dữ liệu cảm biến định kỳ (chấp nhận mất vài bản ghi). |
| **At-least-once** *(Ít nhất 1 lần)* | Consumer xử lý DB xong mới commit offset. Nếu vừa ghi DB xong mà lỗi mạng hoặc app sập trước khi kịp commit offset, Kafka sẽ gửi lại tin nhắn đó khi khởi động lại. | ⚠️ **Trùng message** | **Phổ biến nhất!** Bắt buộc phải thiết kế Consumer có tính **Idempotent** (chống xử lý trùng giao dịch). |
| **Exactly-once** *(Đúng 1 lần)* | Kết hợp Idempotent Producer (`enable.idempotence=true`) + Kafka Transactions + Consumer 2-Phase Commit. Đảm bảo tin nhắn xử lý đúng 1 lần duy nhất. | Không mất, không trùng | Các hệ thống thanh toán, ngân hàng cốt lõi (chi phí tài nguyên và độ trễ cao nhất). |

---

### 6. `@KafkaListener` annotation cần những parameter gì tối thiểu?
- **Thuộc tính tối thiểu:**
  1. **`topics`**: Tên của Topic (hoặc danh sách topics) mà Consumer sẽ lắng nghe.
  2. **`groupId`**: Tên định danh Consumer Group của service (nếu chưa cấu hình thuộc tính `spring.kafka.consumer.group-id` trong YAML).
- **Code minh họa chuẩn:**
```java
@Service
public class OrderEventConsumer {

    @KafkaListener(topics = "order-events", groupId = "payment-service-group")
    public void handleOrderEvent(OrderEvent event) {
        log.info("Nhận event đơn hàng: {}", event.getOrderId());
        if ("ORDER_CREATED".equals(event.getType())) {
            processPayment(event);
        }
    }
}
```

---

### 7. `KafkaTemplate.send()` trả về gì? Xử lý thất bại như thế nào?
- **Kiểu trả về:** **`CompletableFuture<SendResult<K, V>>`** *(trong Spring Boot 3 / Spring-Kafka 3.x)* hoặc `ListenableFuture<SendResult<K, V>>` *(trong Spring Boot 2)*.
- **Vì sao trả về Future:** Vì phương thức `send()` hoạt động hoàn toàn **bất đồng bộ (Non-blocking)**. Thread gửi tin không bị block đứng chờ mạng, mà nhận ngay một Future đại diện cho kết quả xác nhận (ACK) từ Kafka Broker.
- **Cách xử lý lỗi gửi thất bại:** Sử dụng callback non-blocking `.whenComplete()`:
```java
@Autowired
private KafkaTemplate<String, OrderEvent> kafkaTemplate;

public void publishOrder(OrderEvent event) {
    kafkaTemplate.send("order-events", event.getOrderId(), event)
        .whenComplete((result, ex) -> {
            if (ex != null) {
                // XỬ LÝ THẤT BẠI: Kafka Broker sập, timeout, serialization error...
                log.error("Gửi event thất bại cho order {}: {}", event.getOrderId(), ex.getMessage());
                // Giải pháp: Ghi vào bảng Transactional Outbox trong DB để worker retry sau
            } else {
                // GỬI THÀNH CÔNG: Lấy metadata do Broker phản hồi
                log.info("Gửi thành công vào Partition {} với Offset {}", 
                         result.getRecordMetadata().partition(),
                         result.getRecordMetadata().offset());
            }
        });
}
```

---

### 8. Mono vs Flux khác nhau như thế nào?
- **`Mono<T>`**: Là Reactive Publisher phát ra **0 hoặc 1 phần tử** duy nhất (hoặc tín hiệu lỗi `onError`), sau đó hoàn tất (`onComplete`).
  - *Tương đương:* `Optional<T>` hoặc `CompletableFuture<T>` trong thế giới Reactive.
  - *Ví dụ:* Tìm entity theo ID `findById(id)` ➔ `Mono<UserDTO>`, hoặc thao tác xóa không cần body trả về ➔ `Mono<Void>`.
- **`Flux<T>`**: Là Reactive Publisher phát ra một chuỗi gồm **0 đến N phần tử** (có thể là stream hữu hạn hoặc vô hạn theo thời gian).
  - *Tương đương:* `List<T>` hoặc `Stream<T>` nhưng hoạt động bất đồng bộ và non-blocking.
  - *Ví dụ:* Lấy toàn bộ danh sách `findAll()` ➔ `Flux<UserDTO>`, hoặc truyền dữ liệu thời gian thực Server-Sent Events (SSE) như cập nhật giá chứng khoán, chat stream ➔ `Flux<PriceTick>`.

---

### 9. WebClient khác RestTemplate ở điểm gì? Khi nào nên dùng WebClient?
- **So sánh điểm cốt lõi:**
  | Tiêu chí | RestTemplate | WebClient |
  |:---|:---|:---|
  | **Mô hình kiến trúc** | Blocking / Synchronous (1 Thread = 1 Request) | Non-blocking / Reactive (Event Loop dựa trên Netty) |
  | **Tiêu tốn tài nguyên** | Ngốn RAM lớn khi traffic cao (*Thread Starvation*) | Cực kỳ tiết kiệm thread, chỉ cần ít thread cho hàng vạn request |
  | **Khả năng thực thi** | Chỉ chạy được Blocking | Hỗ trợ cả Non-blocking (Reactive) lẫn Blocking (qua `.block()`) |
  | **Streaming / SSE** | Kém hoặc không hỗ trợ | Tích hợp sẵn và hỗ trợ hoàn hảo qua `Flux` |
  | **Trạng thái hỗ trợ** | Bị Deprecated / Maintenance Mode từ Spring 5.0 | Được Spring Team khuyến nghị chính thức cho mọi dự án mới |

- **Khi nào nên dùng WebClient:**
  1. Khi xây dựng các hệ thống yêu cầu thông lượng cao (*High Throughput / High Concurrency*), gọi nhiều API song song để tổng hợp dữ liệu (BFF pattern).
  2. Khi làm việc với Spring WebFlux, Reactive Microservices hoặc Spring Cloud Gateway.
  3. Thay thế toàn bộ `RestTemplate` trong các dự án Spring Boot hiện đại.

---

### 10. Kafka Producer gửi message, nếu Consumer down thì message có bị mất không?
- **Khẳng định:** **Message KHÔNG HỀ BỊ MẤT**.
- **Giải thích cơ chế hoạt động của Kafka:**
  1. **Lưu trữ bền vững trên đĩa cứng (Disk Persistence):** Message khi gửi vào Kafka không chỉ nằm trên RAM mà được ghi tuần tự trực tiếp xuống đĩa cứng của Kafka Broker trong file segment của Partition.
  2. **Chính sách lưu giữ (Retention Policy):** Kafka lưu trữ message theo thời gian cấu hình (mặc định là **7 ngày** - `log.retention.hours=168`), độc lập hoàn toàn với việc có Consumer nào đọc hay chưa.
  3. **Truy vết đọc qua Offset:** Vị trí đọc của Consumer Group được lưu trong topic nội bộ `__consumer_offsets`. Khi Consumer khởi động lại, nó chỉ cần truy vấn offset đã commit lần trước (ví dụ 50) và tiếp tục đọc các message tồn đọng từ offset 51 trở đi một cách mượt mà và an toàn.


---

## 💡 Key Takeaways

```
Kafka:
  Producer → Topic[Partitions] → Consumer Group
  Offset = bookmark của Consumer
  Consumer Group = load balancing giữa consumers
  1 Partition ↔ 1 Consumer trong group tại 1 thời điểm

WebFlux:
  Mono<T> = 0|1 giá trị
  Flux<T> = 0|N giá trị (stream)
  WebClient = non-blocking HTTP client
  Dùng .subscribe() hoặc return từ Controller

Chọn lựa:
  Dùng Kafka khi: event-driven, decoupled, high throughput
  Dùng REST khi: cần kết quả ngay, query, CRUD đơn giản
```
