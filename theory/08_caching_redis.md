# Session 16+17: Tối ưu Hiệu năng – Spring Cache & Redis

---

## PHẦN 1: Tại sao cần Caching?

### Vấn đề không có Cache

```
User A requests product #1
  → App queries DB → DB responds (50ms)
  → App returns response (50ms)

User B requests product #1  (cùng query!)
  → App queries DB → DB responds (50ms)  ← Lãng phí!
  → App returns response (50ms)

1000 users cùng request product #1:
  → 1000 queries đến DB → DB quá tải!
```

### Với Cache

```
User A requests product #1
  → Cache MISS → Query DB (50ms) → Store in Cache → Return (50ms)

User B requests product #1
  → Cache HIT → Return from Cache (1ms!) ← 50x nhanh hơn!

1000 users cùng request product #1:
  → 1 query DB + 999 reads từ Cache → DB được bảo vệ!
```

---

## PHẦN 2: Cache Strategies

### 1. Cache-Aside (Lazy Loading) – Phổ biến nhất

```
Read Flow:
  App → Check Cache → HIT → Return data
                    → MISS → Query DB → Store in Cache → Return data

Write Flow:
  App → Update DB → Invalidate Cache (xóa cache cũ)

Ưu điểm: Chỉ cache data được request → Tiết kiệm memory
Nhược điểm: Cache miss đầu tiên chậm hơn, có thể stale data
```

### 2. Write-Through

```
Write Flow:
  App → Write to Cache → Write to DB (đồng thời)

Read Flow:
  App → Check Cache → Always HIT (cache luôn sync với DB)

Ưu điểm: Cache luôn fresh, không stale
Nhược điểm: Write latency cao hơn, cache chứa data ít dùng
```

### 3. Write-Behind (Write-Back)

```
Write Flow:
  App → Write to Cache → Async write to DB (sau đó)

Ưu điểm: Write cực nhanh, batch writes vào DB
Nhược điểm: Có thể mất data nếu cache crash trước khi sync
```

### 4. Read-Through

```
App chỉ interact với Cache.
Cache tự fetch từ DB khi MISS (app không biết về DB)

Ưu điểm: Code đơn giản hơn
Nhược điểm: Phụ thuộc vào cache layer
```

---

## PHẦN 3: Redis

### 1. Redis là gì?
- **Re**mote **Di**ctionary **S**erver
- In-memory data store (lưu data trong RAM)
- Hỗ trợ: String, Hash, List, Set, Sorted Set, Stream
- Use cases: Cache, Session store, Message broker, Leaderboard

### 2. Redis Data Types

```bash
# String (phổ biến nhất cho caching)
SET user:1 '{"id":1,"name":"John"}' EX 3600  # EX = expire sau 3600 giây
GET user:1

# Hash (object-like)
HSET product:1 name "iPhone" price "999" stock "100"
HGET product:1 name
HGETALL product:1

# List (queue/stack)
LPUSH queue task1 task2  # Push vào đầu
RPOP queue               # Pop từ cuối

# Set (unique values)
SADD tags "java" "spring" "microservice"
SMEMBERS tags

# Sorted Set (leaderboard)
ZADD leaderboard 100 "player1" 200 "player2"
ZRANGE leaderboard 0 -1 WITHSCORES
```

---

## PHẦN 4: Spring Cache + Redis

### 1. Setup

**Dependency:**
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-cache</artifactId>
</dependency>
```

**application.yml:**
```yaml
spring:
  data:
    redis:
      host: localhost
      port: 6379
      password: ""          # Để trống nếu không có password
      timeout: 2000ms
      
  cache:
    type: redis
    redis:
      time-to-live: 3600000  # 1 giờ (milliseconds)
      cache-null-values: false
```

**Enable Caching:**
```java
@SpringBootApplication
@EnableCaching  // ← Annotation quan trọng!
public class ProductServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(ProductServiceApplication.class, args);
    }
}
```

**Redis Config:**
```java
@Configuration
public class RedisConfig {
    
    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        
        // Serialize key as String
        template.setKeySerializer(new StringRedisSerializer());
        template.setHashKeySerializer(new StringRedisSerializer());
        
        // Serialize value as JSON
        Jackson2JsonRedisSerializer<Object> jsonSerializer = 
            new Jackson2JsonRedisSerializer<>(Object.class);
        template.setValueSerializer(jsonSerializer);
        template.setHashValueSerializer(jsonSerializer);
        
        return template;
    }
    
    // Custom Cache Manager với TTL riêng cho từng cache
    @Bean
    public CacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(60))
            .disableCachingNullValues();
        
        Map<String, RedisCacheConfiguration> cacheConfigs = new HashMap<>();
        cacheConfigs.put("products", defaultConfig.entryTtl(Duration.ofMinutes(30)));
        cacheConfigs.put("users", defaultConfig.entryTtl(Duration.ofMinutes(10)));
        
        return RedisCacheManager.builder(factory)
            .cacheDefaults(defaultConfig)
            .withInitialCacheConfigurations(cacheConfigs)
            .build();
    }
}
```

### 2. Cache Annotations

#### @Cacheable – Đọc từ cache, nếu MISS thì query DB

```java
@Service
public class ProductService {
    
    // Cache kết quả của method này
    // Key mặc định = tham số method
    @Cacheable(value = "products", key = "#id")
    public ProductDTO getProduct(Long id) {
        log.info("Fetching product {} from DB", id);  // Chỉ log khi MISS
        return productRepository.findById(id)
            .map(ProductDTO::from)
            .orElseThrow(() -> new ProductNotFoundException(id));
    }
    
    // Cache có condition
    @Cacheable(value = "products", key = "#id", 
               condition = "#id > 0",      // Chỉ cache nếu id > 0
               unless = "#result == null") // Không cache nếu result null
    public ProductDTO getProductConditional(Long id) {
        return productRepository.findById(id).map(ProductDTO::from).orElse(null);
    }
    
    // Cache với key phức tạp
    @Cacheable(value = "products", key = "#category + '-' + #page + '-' + #size")
    public Page<ProductDTO> getProductsByCategory(String category, int page, int size) {
        return productRepository.findByCategory(category, PageRequest.of(page, size))
            .map(ProductDTO::from);
    }
}
```

#### @CacheEvict – Xóa cache

```java
// Xóa 1 entry cụ thể
@CacheEvict(value = "products", key = "#id")
public void deleteProduct(Long id) {
    productRepository.deleteById(id);
}

// Xóa toàn bộ cache "products"
@CacheEvict(value = "products", allEntries = true)
public void clearAllProductsCache() {
    // Không cần làm gì, annotation lo
}

// Xóa sau khi method thực thi thành công
@CacheEvict(value = "products", key = "#product.id", beforeInvocation = false)
public ProductDTO updateProduct(ProductDTO product) {
    return productRepository.save(Product.from(product));
}
```

#### @CachePut – Cập nhật cache

```java
// Luôn thực thi method VÀ cập nhật cache
// Khác @Cacheable: @Cacheable bỏ qua method nếu CACHE HIT
@CachePut(value = "products", key = "#product.id")
public ProductDTO updateProduct(Long id, UpdateProductRequest request) {
    Product product = productRepository.findById(id).orElseThrow();
    product.update(request);
    return ProductDTO.from(productRepository.save(product));
}
```

#### @Caching – Kết hợp nhiều cache operations

```java
@Caching(
    evict = {
        @CacheEvict(value = "products", key = "#id"),
        @CacheEvict(value = "product-list", allEntries = true)
    }
)
public void deleteProduct(Long id) {
    productRepository.deleteById(id);
}
```

### 3. Sử dụng RedisTemplate trực tiếp

```java
@Service
public class SessionService {
    
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;
    
    // Set with expiry
    public void saveSession(String sessionId, UserSession session) {
        redisTemplate.opsForValue().set(
            "session:" + sessionId,
            session,
            Duration.ofHours(2)
        );
    }
    
    // Get
    public UserSession getSession(String sessionId) {
        return (UserSession) redisTemplate.opsForValue()
            .get("session:" + sessionId);
    }
    
    // Delete
    public void deleteSession(String sessionId) {
        redisTemplate.delete("session:" + sessionId);
    }
    
    // Check if key exists
    public boolean sessionExists(String sessionId) {
        return Boolean.TRUE.equals(
            redisTemplate.hasKey("session:" + sessionId)
        );
    }
    
    // Increment counter (atomic)
    public Long incrementLoginAttempts(String userId) {
        String key = "login-attempts:" + userId;
        Long count = redisTemplate.opsForValue().increment(key);
        redisTemplate.expire(key, Duration.ofMinutes(15));
        return count;
    }
}
```

---

## PHẦN 5: Cache Problems & Solutions

### 1. Cache Stampede (Thundering Herd)
```
Vấn đề: Cache entry expire → Nhiều requests đổ vào DB cùng lúc
Giải pháp: 
  - Jitter (thêm random vào TTL)
  - Locking (1 request query DB, còn lại đợi)
  - Probabilistic refresh (refresh trước khi expire)
```

### 2. Cache Penetration
```
Vấn đề: Request key không tồn tại → Cache MISS liên tục → DB bị tấn công
Giải pháp: 
  - Cache null values (cho phép cache null)
  - Bloom Filter (check xem key có tồn tại không trước khi query)
```

### 3. Cache Avalanche
```
Vấn đề: Nhiều cache entries expire cùng lúc → DB bị quá tải đột ngột
Giải pháp:
  - Stagger TTL (thêm random offset vào TTL)
  - Persistent TTL cho critical data
  - Circuit Breaker protect DB
```

---

## ❓ Câu hỏi Ôn tập & Trả lời chi tiết

### 1. Tại sao cần caching? Lợi ích cụ thể là gì?
- **Bản chất vật lý:** Tốc độ truy xuất trên RAM (In-Memory) chỉ mất **dưới 1ms**, nhanh hơn từ 20 đến 50 lần so với việc đọc đĩa cứng và thực thi các câu lệnh SQL phức tạp trên Database (thường mất 20ms - 100ms).
- **3 lợi ích cốt lõi:**
  1. **Giảm độ trễ (Ultra-low Latency / Faster Response Time):** Phản hồi dữ liệu cho người dùng gần như tức thời, nâng cao trải nghiệm ứng dụng (UX).
  2. **Bảo vệ và giảm tải cho Database (Offload Database):** Với 1.000 người dùng cùng truy cập vào một sản phẩm hot, chỉ có đúng **1 request** chạm vào DB (Cache Miss), **999 request còn lại** được đọc trực tiếp từ Cache (Cache Hit), giúp DB tránh bị cạn kiệt Connection Pool.
  3. **Tăng thông lượng hệ thống (High Throughput & Scalability):** Hệ thống có thể chịu được lượng request/giây (QPS/RPS) khổng lồ mà không cần tốn chi phí nâng cấp phần cứng Database đắt đỏ.

---

### 2. Mô tả Cache-Aside strategy: Read flow và Write flow
```
READ FLOW:
App ──► Check Cache ──[HIT]──► Trả về dữ liệu ngay (< 1ms)
            │
          [MISS]
            ▼
        Query Database ──► Lưu vào Cache (kèm TTL) ──► Trả về dữ liệu

WRITE FLOW:
App ──► Update Database ──► XÓA (Evict) key khỏi Cache
```
- **Read Flow (Luồng đọc - Lazy Loading):**
  1. Ứng dụng kiểm tra dữ liệu trong Cache trước.
  2. *Nếu Cache Hit:* Lấy dữ liệu từ Cache trả về ngay.
  3. *Nếu Cache Miss:* Truy vấn dữ liệu từ Database ➔ Lưu dữ liệu vừa lấy được vào Cache (kèm thời gian TTL) ➔ Trả về kết quả cho client.
- **Write Flow (Luồng ghi/cập nhật):**
  1. Ứng dụng cập nhật dữ liệu mới vào Database trước.
  2. Sau đó, **XÓA (Invalidate / Evict) key tương ứng khỏi Cache**, để lần đọc tiếp theo tự động nạp lại.
  - *Tại sao XÓA chứ không ghi đè ngay:*
    - **Tiết kiệm RAM:** Tránh nạp những dữ liệu mà sau khi sửa không có ai đọc lại.
    - **Tránh Race Condition:** Ngăn chặn việc 2 luồng ghi đồng thời làm thứ tự ghi đè Cache bị đảo lộn, khiến Cache chứa dữ liệu cũ còn DB chứa dữ liệu mới.

---

### 3. Phân biệt `@Cacheable`, `@CacheEvict`, `@CachePut`
| Annotation | Cơ chế thực thi method | Tác động lên Cache | Ứng dụng thực tế |
|:---|:---|:---|:---|
| **`@Cacheable`** | **CHỈ CHẠY KHI CACHE MISS**. Nếu đã có sẵn trong Cache (HIT), method **bị bỏ qua hoàn toàn**. | Nạp kết quả vào Cache nếu chưa có. | API Xem chi tiết, Tìm kiếm (`GET /products/{id}`) |
| **`@CacheEvict`** | **LUÔN LUÔN THỰC THI METHOD**. | **Xóa bỏ (Invalidate)** 1 key (hoặc xóa sạch toàn bộ `allEntries = true`) khỏi Cache. | API Xóa hoặc Cập nhật dữ liệu (`DELETE`, `PUT`) |
| **`@CachePut`** | **LUÔN LUÔN THỰC THI METHOD** (không bao giờ bỏ qua). | Lấy kết quả mới nhất trả về của method để **cập nhật đè vào Cache**. | API Cập nhật cần đồng bộ cache tức thời |

*(Lưu ý: Các annotation này chỉ can thiệp vào Cache, việc đọc/ghi/xóa Database là do logic bên trong method đảm nhận).*

---

### 4. `condition` và `unless` trong `@Cacheable` dùng để làm gì?
- **`condition` (Đánh giá TRƯỚC khi method chạy):**
  - Đánh giá dựa trên các **tham số đầu vào** của method.
  - Nếu `condition == false`: Spring bỏ qua toàn bộ cơ chế cache (không đọc cache và không lưu cache).
  - *Ví dụ:* `condition = "#id > 0"` (chỉ áp dụng cache nếu ID hợp lệ).
  - ⚠️ *Lưu ý:* Không thể truy cập biến `#result` trong `condition` vì method chưa thực thi!
- **`unless` (Đánh giá SAU khi method chạy xong):**
  - Đánh giá dựa trên **kết quả trả về (`#result`)** của method.
  - Mang nghĩa: *"Lưu vào cache TRỪ KHI điều kiện này là đúng"* (nếu `unless == true` ➔ KHÔNG LƯU VÀO CACHE).
  - *Ví dụ kinh điển:* `unless = "#result == null"` (nếu kết quả là `null` thì không lưu vào cache, tránh lưu giá trị rỗng).

---

### 5. Tại sao cần `@EnableCaching` ở main class?
- **Bản chất kỹ thuật:** Là annotation "công tắc" kích hoạt cơ chế Spring AOP (`CacheInterceptor` / Dynamic Proxy) để quét và bọc quanh các Service Bean có chứa các annotation cache.
- **Nếu thiếu `@EnableCaching`:**
  - Ứng dụng **vẫn khởi động và chạy bình thường, không hề có lỗi đỏ hay crash**.
  - Tuy nhiên, tất cả các annotation `@Cacheable`, `@CacheEvict`, `@CachePut` sẽ **hoàn toàn vô tác dụng** (bị Spring bỏ qua trong im lặng).
  - Kết quả là mỗi lần gọi hàm, ứng dụng luôn âm thầm truy vấn thẳng vào Database mà không hề có bộ đệm nào hoạt động.

---

### 6. Cách config Redis TTL trong Spring Boot
- **Cách 1: Cấu hình mặc định toàn cục qua `application.yml`:**
  ```yaml
  spring:
    cache:
      type: redis
      redis:
        time-to-live: 60m            # Tất cả cache mặc định hết hạn sau 60 phút
        cache-null-values: false     # Không cache giá trị null
  ```
- **Cách 2: Java Config bằng `RedisCacheManager` (Đặt TTL riêng cho từng loại dữ liệu):**
  ```java
  @Bean
  public CacheManager cacheManager(RedisConnectionFactory factory) {
      RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
          .entryTtl(Duration.ofMinutes(60)); // Mặc định 60 phút

      Map<String, RedisCacheConfiguration> cacheConfigs = new HashMap<>();
      cacheConfigs.put("products", defaultConfig.entryTtl(Duration.ofMinutes(30))); // 30 phút
      cacheConfigs.put("users", defaultConfig.entryTtl(Duration.ofMinutes(10)));    // 10 phút
      cacheConfigs.put("flash-deals", defaultConfig.entryTtl(Duration.ofMinutes(5))); // 5 phút

      return RedisCacheManager.builder(factory)
          .cacheDefaults(defaultConfig)
          .withInitialCacheConfigurations(cacheConfigs)
          .build();
  }
  ```

---

### 7. `@CachePut` khác `@Cacheable` ở điểm gì?
- **Khác biệt cốt lõi:**
  - `@Cacheable` kiểm tra cache trước: nếu dữ liệu **đã có trong Cache**, nó **bỏ qua hoàn toàn không chạy code trong method**.
  - `@CachePut` **luôn luôn thực thi method**, sau đó mới lấy kết quả trả về để ghi đè/cập nhật vào cache.
- **Trường hợp bắt buộc dùng `@CachePut`:** Dùng cho các method Cập nhật dữ liệu (Update). Nếu bạn gắn nhầm `@Cacheable` lên method update, Spring thấy key đã tồn tại trong Cache sẽ bỏ qua method ➔ **Database không hề được cập nhật dữ liệu mới!**

---

### 8. `RedisTemplate` dùng khi nào thay vì `@Cacheable`?
Các annotation cấp cao chỉ hỗ trợ lưu Key-Value đơn giản dạng JSON/String. Bắt buộc phải dùng `RedisTemplate` (hoặc `StringRedisTemplate`) trong 4 bài toán:
1. **Sử dụng cấu trúc dữ liệu nâng cao của Redis:**
   - `Hash` (`opsForHash`): Lưu giỏ hàng (*Shopping Cart*) để cập nhật số lượng từng món mà không serialize lại cả giỏ hàng.
   - `Sorted Set` (`opsForZSet`): Làm Bảng xếp hạng điểm số Realtime (*Leaderboard*).
   - `List` (`opsForList`): Làm hàng đợi tin nhắn nhỏ (FIFO Queue), timeline bài viết.
   - `Geo` (`opsForGeo`): Tìm kiếm tài xế/quán ăn gần vị trí người dùng nhất.
2. **Thao tác nguyên tử (Atomic Counter):**
   - Đếm số lượt xem (View Counter), đếm số lần nhập sai mật khẩu: `redisTemplate.opsForValue().increment(key)`. Áp dụng làm Rate Limiter chống spam.
3. **Khóa phân tán (Distributed Lock với `SETNX`):**
   - Dùng `setIfAbsent(key, "LOCKED", timeout)` để đảm bảo chỉ duy nhất 1 server được phép chạy một tác vụ cronjob tại một thời điểm.
4. **Quản lý Session & TTL động:**
   - Cài đặt thời gian sống linh hoạt theo từng người dùng (ví dụ: OTP hết hạn sau 2 phút, User Session tự gia hạn sau mỗi thao tác).

---

### 9. Cache Stampede là gì? Cách phòng tránh?
- **Hiện tượng Cache Stampede (Thảm họa giẫm đạp / Dog-piling):**
  - Xảy ra khi một key dữ liệu cực HOT (Hotkey có hàng chục ngàn người truy cập mỗi giây) vừa **hết hạn TTL** hoặc bị xóa.
  - Ngay tại tích tắc đó, hàng ngàn request cùng lúc đều bị **Cache Miss**.
  - Cả hàng ngàn request này đồng loạt dội thẳng vào Database để chạy câu lệnh SQL nặng nạp lại cache ➔ **Database bị quá tải CPU 100%, cạn pool kết nối và sập ngay lập tức!**
- **3 giải pháp kỹ thuật phòng tránh:**
  1. **Mutex Lock / Khóa phân tán (`SETNX`):** Chỉ cho phép duy nhất 1 request lấy được Lock được phép query DB để nạp lại Cache. Các request khác tạm nghỉ 50ms rồi quay lại đọc Cache (khi này đã có dữ liệu).
  2. **Background Refresh (Làm mới chủ động):** Worker chạy ngầm định kỳ kiểm tra, nếu key sắp hết hạn (ví dụ TTL còn dưới 10%) thì chủ động query DB nạp mới lại trước.
  3. **Jitter TTL:** Cộng thêm một khoảng thời gian ngẫu nhiên vào TTL (`TTL = 30 phút + random(1, 5) phút`) để các key không bao giờ bị hết hạn cùng một thời điểm (chống sập hàng loạt - *Cache Avalanche*).

---

### 10. Redis hỗ trợ những data type nào? Use case của mỗi loại?
1. **String:** Cấu trúc cơ bản nhất (Text, JSON, Binary tối đa 512MB).  
   *Use case:* Caching API Response (JSON DTO), lưu mã OTP, User Session, biến đếm View Counter (`INCR`).
2. **Hash:** Cấu trúc dạng Object (`Key ➔ Field:Value`).  
   *Use case:* Lưu trữ User Profile (`user:1 ➔ name, email`), Giỏ hàng thương mại điện tử (`cart:userId ➔ productId:quantity`) giúp update từng món nhanh chóng.
3. **List:** Danh sách liên kết hai đầu (Doubly Linked List).  
   *Use case:* Hàng đợi tin nhắn đơn giản FIFO (`LPUSH`/`RPOP`), hiển thị timeline 10 bài viết mới nhất.
4. **Set:** Tập hợp các phần tử duy nhất, không trùng lặp, không thứ tự.  
   *Use case:* Quản lý Tag bài viết, lọc trùng lặp, tính năng Bạn chung (`SINTER`), Blacklist IP.
5. **Sorted Set (ZSet):** Tập hợp phần tử duy nhất, tự động sắp xếp theo điểm số (**Score**).  
   *Use case:* Bảng xếp hạng Realtime (Leaderboard game/doanh số), thuật toán Sliding Window Rate Limiter.
6. **Stream:** Nhật ký tuần tự có hỗ trợ Consumer Groups.  
   *Use case:* Event Sourcing, Message Broker nhẹ xử lý sự kiện thời gian thực.


---

## 💡 Key Takeaways

```
Spring Cache Annotations:
  @EnableCaching → Bật trên main class
  @Cacheable  → Đọc cache, miss thì query
  @CacheEvict → Xóa cache
  @CachePut   → Cập nhật cache (luôn chạy method)

Cache Strategy:
  Cache-Aside: Phổ biến nhất, app tự quản lý cache
  Write-Through: Cache luôn sync, write chậm hơn

Cache Problems:
  Penetration → Bloom Filter hoặc cache null
  Stampede   → Jitter TTL
  Avalanche  → Stagger TTL
  
Redis Commands:
  SET key value EX seconds
  GET key
  DEL key
  TTL key  ← Xem thời gian còn lại
  KEYS *   ← List all keys (cẩn thận production!)
```
