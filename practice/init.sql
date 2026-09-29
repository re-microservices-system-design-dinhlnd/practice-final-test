-- ================================================================
-- Init SQL: Tạo databases khi MySQL khởi động
-- ================================================================

CREATE DATABASE IF NOT EXISTS ecommerce_users;
CREATE DATABASE IF NOT EXISTS ecommerce_products;
CREATE DATABASE IF NOT EXISTS ecommerce_orders;
CREATE DATABASE IF NOT EXISTS ecommerce_payments;

-- Grant permissions
GRANT ALL PRIVILEGES ON ecommerce_users.* TO 'root'@'%';
GRANT ALL PRIVILEGES ON ecommerce_products.* TO 'root'@'%';
GRANT ALL PRIVILEGES ON ecommerce_orders.* TO 'root'@'%';
GRANT ALL PRIVILEGES ON ecommerce_payments.* TO 'root'@'%';
FLUSH PRIVILEGES;
