SELECT 'object:' || type || ':' || name AS schema_item
FROM sqlite_master WHERE type IN ('table', 'index')
UNION ALL
SELECT m.name || '.' || p.name AS schema_item
FROM sqlite_master AS m
JOIN pragma_table_info(m.name) AS p
WHERE m.type = 'table'
ORDER BY schema_item;
