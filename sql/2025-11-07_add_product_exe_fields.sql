-- Migration: add fields for executable validation and portable handling
-- Safe to re-run. Requires MySQL 5.7+/8.0+. Adjust if your version lacks JSON etc.

USE wap;

-- 1) Add products.executable_name if missing
SET @exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'executable_name'
);
SET @sql := IF(@exists=0,
  'ALTER TABLE products ADD COLUMN executable_name VARCHAR(255) NULL AFTER download_url',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Add products.expected_publisher if missing
SET @exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'expected_publisher'
);
SET @sql := IF(@exists=0,
  'ALTER TABLE products ADD COLUMN expected_publisher VARCHAR(255) NULL AFTER executable_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Add products.expected_product_name if missing (optional override for name)
SET @exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'expected_product_name'
);
SET @sql := IF(@exists=0,
  'ALTER TABLE products ADD COLUMN expected_product_name VARCHAR(255) NULL AFTER expected_publisher',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Add products.is_portable if missing
SET @exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'is_portable'
);
SET @sql := IF(@exists=0,
  'ALTER TABLE products ADD COLUMN is_portable BOOLEAN NULL AFTER expected_product_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Normalize charset/collation for text columns (BOOLEAN -> TINYINT(1) for compatibility)
ALTER TABLE products
  MODIFY COLUMN executable_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN expected_publisher VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN expected_product_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN is_portable TINYINT(1) NULL;

-- Backfill executable_name from download_url if it ends with .exe (safe-update friendly via JOIN)
UPDATE products p
JOIN (
  SELECT product_id, SUBSTRING_INDEX(download_url, '/', -1) AS exe
  FROM products
  WHERE executable_name IS NULL AND download_url LIKE '%.exe'
) s ON s.product_id = p.product_id
SET p.executable_name = s.exe;

-- Optionally default expected_product_name to name when null (safe-update friendly)
UPDATE products p
JOIN (
  SELECT product_id, name AS n
  FROM products WHERE expected_product_name IS NULL
) s ON s.product_id = p.product_id
SET p.expected_product_name = s.n;

-- Create indexes if not exists (portable: check via information_schema)
-- idx_products_executable_name
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_executable_name'
);
SET @sql := IF(@idx_exists=0,
  'CREATE INDEX idx_products_executable_name ON products (executable_name)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- idx_products_expected_publisher
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_expected_publisher'
);
SET @sql := IF(@idx_exists=0,
  'CREATE INDEX idx_products_expected_publisher ON products (expected_publisher)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- (Optional) tiny helper view to inspect launch-relevant fields
DROP VIEW IF EXISTS vw_product_launch_fields;
CREATE VIEW vw_product_launch_fields AS
SELECT product_id, name, expected_product_name, executable_name, expected_publisher, is_portable, download_url
FROM products;
