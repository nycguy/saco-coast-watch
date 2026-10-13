SELECT 'object:' || type || ':' || name AS schema_item
FROM sqlite_master
WHERE type IN ('table', 'index');

SELECT 'subscribers.' || name AS schema_item FROM pragma_table_info('subscribers');
SELECT 'push_subscriptions.' || name AS schema_item FROM pragma_table_info('push_subscriptions');
SELECT 'tokens.' || name AS schema_item FROM pragma_table_info('tokens');
SELECT 'alert_state.' || name AS schema_item FROM pragma_table_info('alert_state');
SELECT 'request_limits.' || name AS schema_item FROM pragma_table_info('request_limits');

SELECT 'coastal_event_snapshots.' || name AS schema_item FROM pragma_table_info('coastal_event_snapshots');
SELECT 'coastal_event_deliveries.' || name AS schema_item FROM pragma_table_info('coastal_event_deliveries');
SELECT 'push_devices.' || name AS schema_item FROM pragma_table_info('push_devices');
SELECT 'push_device_deliveries.' || name AS schema_item FROM pragma_table_info('push_device_deliveries');
SELECT 'push_delivery_queue.' || name AS schema_item FROM pragma_table_info('push_delivery_queue');

SELECT 'push_threshold_preferences.' || name AS schema_item FROM pragma_table_info('push_threshold_preferences');
