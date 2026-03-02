-- Canonical role migration:
-- operator -> employee
-- supervisor -> manager

UPDATE "User"
SET "role" = 'employee'
WHERE lower("role") = 'operator';

UPDATE "User"
SET "role" = 'manager'
WHERE lower("role") = 'supervisor';

-- Keep existing admin roles unchanged.

ALTER TABLE "User"
ALTER COLUMN "role" SET DEFAULT 'employee';
