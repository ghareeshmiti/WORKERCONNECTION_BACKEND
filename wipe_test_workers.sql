-- SQL to wipe all workers and related data for a clean start
-- CAUTION: This will delete ALL registered workers.

BEGIN;

-- 1. Delete Attendance Data
DELETE FROM attendance_daily_rollups;
DELETE FROM attendance_events;

-- 2. Delete Worker Mappings
DELETE FROM worker_mappings;

-- 3. Delete Workers
DELETE FROM workers;

-- 4. Delete Auth Users (Optional, only if you want to remove logins too)
-- DELETE FROM auth.users WHERE email LIKE '%@worker.com'; -- Example filter

COMMIT;
