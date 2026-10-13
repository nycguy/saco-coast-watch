SELECT 'object:' || type || ':' || name AS schema_item
FROM sqlite_master
WHERE type IN ('table', 'index')

UNION ALL SELECT 'subscribers.' || name FROM pragma_table_info('subscribers')
UNION ALL SELECT 'push_subscriptions.' || name FROM pragma_table_info('push_subscriptions')
UNION ALL SELECT 'tokens.' || name FROM pragma_table_info('tokens')
UNION ALL SELECT 'alert_state.' || name FROM pragma_table_info('alert_state')
UNION ALL SELECT 'request_limits.' || name FROM pragma_table_info('request_limits')

UNION ALL SELECT 'coastal_event_snapshots.' || name FROM pragma_table_info('coastal_event_snapshots')
UNION ALL SELECT 'coastal_event_deliveries.' || name FROM pragma_table_info('coastal_event_deliveries')
UNION ALL SELECT 'push_devices.' || name FROM pragma_table_info('push_devices')
UNION ALL SELECT 'push_device_deliveries.' || name FROM pragma_table_info('push_device_deliveries')
UNION ALL SELECT 'push_delivery_queue.' || name FROM pragma_table_info('push_delivery_queue')

ORDER BY schema_item;
