#!/usr/bin/env python3
"""Fail closed unless D1's existing email schema and additive push state are verified."""
import argparse
import json
from pathlib import Path

BASE_TABLES = {'subscribers', 'push_subscriptions', 'tokens', 'alert_state', 'request_limits'}
BASE_COLUMNS = {
    'subscribers': {'id', 'email', 'email_confirmed', 'prefs_json', 'unsubscribed', 'created_at', 'updated_at'},
    'push_subscriptions': {'id', 'subscriber_id', 'endpoint', 'p256dh', 'auth', 'expires_at', 'created_at', 'updated_at'},
    'tokens': {'hash', 'subscriber_id', 'email', 'purpose', 'payload_json', 'expires_at', 'used_at'},
    'alert_state': {'subscriber_id', 'channel', 'metric', 'active', 'last_sent'},
    'request_limits': {'ip_hash', 'until_ts'},
}
CORE_PUSH_COLUMNS = {
    'coastal_event_snapshots': {'event_key', 'active', 'fingerprint', 'source_observed_at', 'updated_at'},
    'coastal_event_deliveries': {'id', 'subscriber_id', 'event_key', 'transition_kind', 'event_fingerprint', 'created_at', 'sent_at', 'status'},
    'push_devices': {'id', 'endpoint', 'p256dh', 'auth', 'token_hash', 'event_prefs_json', 'enabled', 'created_at', 'updated_at'},
    'push_device_deliveries': {'id', 'device_id', 'event_key', 'transition_kind', 'event_fingerprint', 'status', 'created_at', 'sent_at'},
    'push_delivery_queue': {'id', 'device_id', 'event_key', 'transition_kind', 'event_fingerprint', 'payload_json', 'status', 'attempts', 'next_attempt_at', 'created_at', 'sent_at', 'last_error'},
}
CORE_PUSH_INDEXES = {
    'coastal_event_deliveries_subscriber_idx', 'coastal_event_deliveries_pending_idx',
    'push_devices_enabled_idx', 'push_device_deliveries_pending_idx',
    'push_delivery_queue_pending_idx', 'push_delivery_queue_device_idx',
}

def read_wrangler_json(path):
    raw = Path(path).read_text(encoding='utf-8')
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        for start, char in enumerate(raw):
            if char not in '[{':
                continue
            try:
                return json.loads(raw[start:])
            except json.JSONDecodeError:
                pass
    raise SystemExit('Could not parse Wrangler --json output; refusing to inspect or migrate D1')

def rows(value):
    if isinstance(value, dict):
        if isinstance(value.get('results'), list):
            yield from value['results']
        for child in value.values():
            if isinstance(child, (dict, list)):
                yield from rows(child)
    elif isinstance(value, list):
        for child in value:
            yield from rows(child)

def field_values(doc, field):
    found = []
    def visit(value):
        if isinstance(value, dict):
            if field in value:
                found.append(value[field])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(doc)
    return found

def schema_items(path):
    doc = read_wrangler_json(path)
    return {str(row['schema_item']) for row in rows(doc) if isinstance(row, dict) and row.get('schema_item') is not None}

def _tables(items):
    return {x.removeprefix('object:table:') for x in items if x.startswith('object:table:')}

def verify_schema(path):
    items = schema_items(path)
    tables = _tables(items)
    missing = sorted(BASE_TABLES - tables)
    columns_missing = sorted(f'{table}.{col}' for table, cols in BASE_COLUMNS.items() for col in cols if f'{table}.{col}' not in items)
    if missing or columns_missing:
        raise SystemExit('Live D1 does not match the expected existing email schema; refusing Worker release. Missing tables: '+str(missing)+'; columns: '+str(columns_missing))
    print('Live D1 contains the expected pre-existing email-alert tables and columns.')

THRESHOLD_COLUMNS = {
    'push_threshold_preferences': {'device_id', 'linked_subscriber_id', 'prefs_json', 'updated_at'},
}
THRESHOLD_INDEXES = {'push_threshold_preferences_subscriber_idx'}

def _verify_named_schema(items, columns, indexes_expected, label):
    tables = _tables(items)
    missing_tables = sorted(set(columns) - tables)
    columns_missing = sorted(f'{table}.{col}' for table, cols in columns.items() for col in cols if f'{table}.{col}' not in items)
    indexes = {x.removeprefix('object:index:') for x in items if x.startswith('object:index:')}
    missing_indexes = sorted(indexes_expected - indexes)
    if missing_tables or columns_missing or missing_indexes:
        raise SystemExit(f'D1 has a partial/incomplete {label} schema; refusing to guess migration state. Missing tables: {missing_tables}; columns: {columns_missing}; indexes: {missing_indexes}')

def migration_state(path):
    items = schema_items(path)
    tables = _tables(items)
    indexes = {x.removeprefix('object:index:') for x in items if x.startswith('object:index:')}
    core_present = bool((tables & set(CORE_PUSH_COLUMNS)) or (indexes & CORE_PUSH_INDEXES))
    threshold_present = bool((tables & set(THRESHOLD_COLUMNS)) or (indexes & THRESHOLD_INDEXES))
    if not core_present and not threshold_present:
        return 'absent'
    _verify_named_schema(items, CORE_PUSH_COLUMNS, CORE_PUSH_INDEXES, 'core push')
    if not threshold_present:
        return 'thresholds_pending'
    _verify_named_schema(items, THRESHOLD_COLUMNS, THRESHOLD_INDEXES, 'custom threshold push')
    return 'complete'

def verify_push_schema(path):
    items = schema_items(path)
    _verify_named_schema(items, CORE_PUSH_COLUMNS, CORE_PUSH_INDEXES, 'core push')
    _verify_named_schema(items, THRESHOLD_COLUMNS, THRESHOLD_INDEXES, 'custom threshold push')
    print('D1 contains all expected additive event/push/custom-threshold tables, columns, and indexes.')

def subscriber_count(path):
    values = field_values(read_wrangler_json(path), 'subscriber_count')
    if not values or not isinstance(values[0], int):
        raise SystemExit('Could not verify the live subscriber count; refusing Worker release')
    return values[0]

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--schema')
    parser.add_argument('--push-schema')
    parser.add_argument('--migration-state')
    parser.add_argument('--before')
    parser.add_argument('--after')
    args = parser.parse_args()
    if args.schema:
        verify_schema(args.schema)
    if args.push_schema:
        verify_push_schema(args.push_schema)
    if args.migration_state:
        state = migration_state(args.migration_state)
        print('MIGRATION_STATE='+state)
    if args.before or args.after:
        if not (args.before and args.after):
            parser.error('--before and --after must be supplied together')
        before, after = subscriber_count(args.before), subscriber_count(args.after)
        if before != after:
            raise SystemExit(f'Existing subscriber count changed from {before} to {after}; Worker release stopped')
        print('Existing subscriber count preserved across D1 migration.')
