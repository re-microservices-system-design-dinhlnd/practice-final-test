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

## ❓ Câu hỏi Ôn tập

1. Tại sao cần giao tiếp bất đồng bộ? Liệt kê 3 ưu điểm so với REST
2. Giải thích Kafka Topic, Partition, Offset, Consumer Group
3. Nếu có 3 partitions và 5 consumers trong cùng 1 group, điều gì xảy ra?
4. `auto-offset-reset: earliest` vs `latest` khác nhau thế nào?
5. At-most-once, at-least-once, exactly-once delivery là gì?
6. `@KafkaListener` annotation cần những parameter gì tối thiểu?
7. `KafkaTemplate.send()` trả về gì? Xử lý thất bại như thế nào?
8. Mono vs Flux khác nhau như thế nào?
9. WebClient khác RestTemplate ở điểm gì? Khi nào nên dùng WebClient?
10. Kafka Producer gửi message, nếu Consumer down thì message có bị mất không?

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
