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

## ❓ Câu hỏi Ôn tập

1. Tại sao cần caching? Lợi ích cụ thể là gì?
2. Mô tả Cache-Aside strategy: Read flow và Write flow
3. Phân biệt @Cacheable, @CacheEvict, @CachePut
4. `condition` và `unless` trong @Cacheable dùng để làm gì?
5. Tại sao cần @EnableCaching ở main class?
6. Cách config Redis TTL trong Spring Boot
7. @CachePut khác @Cacheable ở điểm gì?
8. RedisTemplate dùng khi nào thay vì @Cacheable?
9. Cache Stampede là gì? Cách phòng tránh?
10. Redis hỗ trợ những data type nào? Use case của mỗi loại?

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
