// ---------------------------------------------------------------------------
// directiveRegistry.ts
// Comprehensive registry of Splunk props.conf and transforms.conf directives.
// Powers autocomplete, hover tooltips, linting, and validation features.
// ---------------------------------------------------------------------------

export interface DirectiveInfo {
  key: string;
  description: string;
  example: string;
  defaultValue: string;
  category: string;
  appliesTo: 'props.conf' | 'transforms.conf' | 'both';
  valueType: 'regex' | 'string' | 'number' | 'boolean' | 'enum' | 'strftime' | 'eval';
  enumValues?: string[];
  isClassBased: boolean;
  phase: 'index-time' | 'search-time' | 'both';
  deprecated?: boolean;
}

// ---------------------------------------------------------------------------
// Directive definitions
// ---------------------------------------------------------------------------

const DIRECTIVES: DirectiveInfo[] = [
  // =======================================================================
  // props.conf -- Time Configuration
  // =======================================================================
  {
    key: 'TIME_PREFIX',
    description:
      'A regex that identifies a pattern immediately before the timestamp in the event text. ' +
      'Splunk starts looking for the timestamp immediately after the first match of this regex. ' +
      'If TIME_PREFIX cannot be found, the timestamp will not be extracted.',
    example: 'TIME_PREFIX = \\d{4}-\\d{2}-\\d{2}T',
    defaultValue: '',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'regex',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'TIME_FORMAT',
    description:
      'A strftime-style format string that describes the timestamp format in the event. ' +
      'Splunk uses this format to parse the timestamp from the event text after applying TIME_PREFIX. ' +
      'Common tokens include %Y (4-digit year), %m (month), %d (day), %H (hour), %M (minute), %S (second), %3N (milliseconds), %6N (microseconds), %z (timezone offset).',
    example: 'TIME_FORMAT = %Y-%m-%dT%H:%M:%S.%6N%z',
    defaultValue: '',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'strftime',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'MAX_TIMESTAMP_LOOKAHEAD',
    description:
      'The maximum number of characters into an event that Splunk looks for a timestamp. ' +
      'After finding TIME_PREFIX, Splunk will look this many characters ahead for the timestamp. ' +
      'Setting this too low may cause timestamps to be missed; setting it too high may cause false matches.',
    example: 'MAX_TIMESTAMP_LOOKAHEAD = 150',
    defaultValue: '150',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'TZ',
    description:
      'The timezone to apply to timestamps that do not include timezone information. ' +
      'Accepts IANA/Olson timezone identifiers (e.g. "America/New_York") or UTC offsets (e.g. "UTC-5"). ' +
      'If not set, Splunk uses the timezone of the server where the data was indexed.',
    example: 'TZ = America/Los_Angeles',
    defaultValue: '',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'DATETIME_CONFIG',
    description:
      'The path to the datetime configuration file that Splunk uses for automatic timestamp recognition. ' +
      'Set to CURRENT to use the event\'s receipt time as its timestamp. ' +
      'Set to NONE to disable automatic timestamp parsing entirely.',
    example: 'DATETIME_CONFIG = CURRENT',
    defaultValue: '/etc/datetime.xml',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'MAX_DAYS_AGO',
    description:
      'The maximum number of days in the past that an extracted timestamp is considered valid. ' +
      'If a parsed timestamp is more than this many days before the current date, Splunk rejects it and falls back to other timestamp strategies.',
    example: 'MAX_DAYS_AGO = 2000',
    defaultValue: '2000',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'MAX_DAYS_HENCE',
    description:
      'The maximum number of days in the future that an extracted timestamp is considered valid. ' +
      'If a parsed timestamp is more than this many days after the current date, Splunk rejects it.',
    example: 'MAX_DAYS_HENCE = 2',
    defaultValue: '2',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'MAX_DIFF_SECS_AGO',
    description:
      'The maximum number of seconds that a timestamp from an event can differ (into the past) from the timestamp of the previous event. ' +
      'If the difference exceeds this value, Splunk does not accept the parsed timestamp. ' +
      'This helps guard against false timestamp matches within event text.',
    example: 'MAX_DIFF_SECS_AGO = 86400',
    defaultValue: '3600',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'MAX_DIFF_SECS_HENCE',
    description:
      'The maximum number of seconds that a timestamp from an event can differ (into the future) from the timestamp of the previous event. ' +
      'If the difference exceeds this value, Splunk does not accept the parsed timestamp.',
    example: 'MAX_DIFF_SECS_HENCE = 604800',
    defaultValue: '604800',
    category: 'Time Configuration',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },

  // =======================================================================
  // props.conf -- Event / Line Breaking
  // =======================================================================
  {
    key: 'SHOULD_LINEMERGE',
    description:
      'Controls whether Splunk combines multiple lines from the input into a single event. ' +
      'When true, Splunk uses BREAK_ONLY_BEFORE, MUST_BREAK_AFTER, and related settings to determine where events end. ' +
      'Set to false when LINE_BREAKER alone is sufficient to delineate events.',
    example: 'SHOULD_LINEMERGE = false',
    defaultValue: 'true',
    category: 'Event Breaking',
    appliesTo: 'props.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'BREAK_ONLY_BEFORE',
    description:
      'A regex pattern that, when matched at the start of a line, causes Splunk to start a new event. ' +
      'Requires SHOULD_LINEMERGE = true. Lines that match this pattern begin a new event; ' +
      'preceding lines are appended to the previous event.',
    example: 'BREAK_ONLY_BEFORE = ^\\d{4}-\\d{2}-\\d{2}',
    defaultValue: '',
    category: 'Event Breaking',
    appliesTo: 'props.conf',
    valueType: 'regex',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'BREAK_ONLY_BEFORE_DATE',
    description:
      'When set to true, Splunk starts a new event only when it encounters a line that begins with a date or timestamp pattern. ' +
      'Requires SHOULD_LINEMERGE = true. This is a convenience alternative to specifying a BREAK_ONLY_BEFORE regex.',
    example: 'BREAK_ONLY_BEFORE_DATE = true',
    defaultValue: 'true',
    category: 'Event Breaking',
    appliesTo: 'props.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'MUST_BREAK_AFTER',
    description:
      'A regex pattern that, when matched in a line, forces the current event to end after that line. ' +
      'Requires SHOULD_LINEMERGE = true. The next line begins a new event.',
    example: 'MUST_BREAK_AFTER = </event>',
    defaultValue: '',
    category: 'Event Breaking',
    appliesTo: 'props.conf',
    valueType: 'regex',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'LINE_BREAKER',
    description:
      'A regex with a capturing group that determines where event boundaries occur in the raw data stream. ' +
      'The text matched by the capturing group is consumed as the event break; ' +
      'everything before becomes one event and everything after starts the next. ' +
      'The default value breaks on newlines.',
    example: 'LINE_BREAKER = ([\\r\\n]+)\\d{4}-\\d{2}-\\d{2}',
    defaultValue: '([\\r\\n]+)',
    category: 'Event Breaking',
    appliesTo: 'props.conf',
    valueType: 'regex',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'TRUNCATE',
    description:
      'The maximum number of bytes that an event can contain. Any content beyond this limit is truncated. ' +
      'Set to 0 to disable truncation entirely (not recommended for production).',
    example: 'TRUNCATE = 50000',
    defaultValue: '10000',
    category: 'Event Breaking',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'EVENT_BREAKER_ENABLE',
    description:
      'Enables the event breaker for HTTP Event Collector (HEC) and universal/heavy forwarder data. ' +
      'When true, Splunk uses EVENT_BREAKER to split events before forwarding. ' +
      'This improves load balancing by ensuring events are not split across indexers.',
    example: 'EVENT_BREAKER_ENABLE = true',
    defaultValue: 'false',
    category: 'Event Breaking',
    appliesTo: 'props.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'EVENT_BREAKER',
    description:
      'A regex with a capturing group that determines event boundaries on the forwarder before data is sent to the indexer. ' +
      'Requires EVENT_BREAKER_ENABLE = true. Works similarly to LINE_BREAKER but is applied on the forwarder.',
    example: 'EVENT_BREAKER = ([\\r\\n]+)(?=\\d{4}-\\d{2}-\\d{2})',
    defaultValue: '([\\r\\n]+)',
    category: 'Event Breaking',
    appliesTo: 'props.conf',
    valueType: 'regex',
    isClassBased: false,
    phase: 'index-time',
  },

  // =======================================================================
  // props.conf -- Field Extraction
  // =======================================================================
  {
    key: 'EXTRACT',
    description:
      'Defines an inline regular expression for field extraction at search time. ' +
      'Uses named capturing groups (?P<fieldname>...) to extract fields directly in props.conf. ' +
      'The class name following the dash identifies this extraction uniquely.',
    example: 'EXTRACT-ip_address = (?P<src_ip>\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'props.conf',
    valueType: 'regex',
    isClassBased: true,
    phase: 'search-time',
  },
  {
    key: 'REPORT',
    description:
      'References one or more transforms stanza names (comma-separated) defined in transforms.conf for search-time field extraction. ' +
      'Each referenced stanza should contain a REGEX and FORMAT directive. ' +
      'The class name following the dash identifies this extraction set.',
    example: 'REPORT-custom_fields = extract_user, extract_action',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: true,
    phase: 'search-time',
  },
  {
    key: 'TRANSFORMS',
    description:
      'References one or more transforms stanza names (comma-separated) defined in transforms.conf for index-time field extraction. ' +
      'Used for routing, filtering, or modifying events before they are indexed. ' +
      'Unlike REPORT, TRANSFORMS operations happen at index time.',
    example: 'TRANSFORMS-routing = set_index_by_severity',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: true,
    phase: 'index-time',
  },
  {
    key: 'INDEXED_EXTRACTIONS',
    description:
      'Specifies structured data format for automatic field extraction at index time. ' +
      'Splunk will parse the data according to the chosen format and create indexed fields. ' +
      'Valid values include csv, tsv, psv, w3c, json, and xml.',
    example: 'INDEXED_EXTRACTIONS = json',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'props.conf',
    valueType: 'enum',
    enumValues: ['csv', 'tsv', 'psv', 'w3c', 'json', 'xml'],
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'FIELDALIAS',
    description:
      'Creates an alias for an existing field at search time. ' +
      'Allows you to reference the same field value by an alternative name without duplicating the data. ' +
      'Syntax is FIELDALIAS-<class> = <original_field> AS <alias_field>. Multiple aliases can be comma-separated.',
    example: 'FIELDALIAS-src = src_ip AS src',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: true,
    phase: 'search-time',
  },
  {
    key: 'EVAL',
    description:
      'Creates a calculated field at search time using an eval expression. ' +
      'The class name after the dash becomes the output field name. ' +
      'The value is a valid Splunk eval expression that can reference other fields.',
    example: 'EVAL-duration_seconds = duration / 1000',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'props.conf',
    valueType: 'eval',
    isClassBased: true,
    phase: 'search-time',
  },
  {
    key: 'SEDCMD',
    description:
      'Applies sed-style substitution commands to the raw event text at index time, before other processing. ' +
      'Useful for anonymizing or masking sensitive data such as credit card numbers, SSNs, or passwords. ' +
      'Syntax follows the sed s/regex/replacement/flags format.',
    example: 'SEDCMD-anonymize_ssn = s/\\d{3}-\\d{2}-\\d{4}/XXX-XX-XXXX/g',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: true,
    phase: 'index-time',
  },
  {
    key: 'KV_MODE',
    description:
      'Controls the automatic key-value pair extraction mode at search time. ' +
      '"auto" extracts key=value pairs and JSON. "none" disables automatic extraction. ' +
      '"json" extracts only JSON fields. "xml" extracts only XML fields. "multi" extracts from multi-value fields.',
    example: 'KV_MODE = json',
    defaultValue: 'auto',
    category: 'Field Extraction',
    appliesTo: 'props.conf',
    valueType: 'enum',
    enumValues: ['auto', 'none', 'json', 'xml', 'multi'],
    isClassBased: false,
    phase: 'search-time',
  },

  // =======================================================================
  // props.conf -- Other
  // =======================================================================
  {
    key: 'CHARSET',
    description:
      'The character encoding of the input data. Splunk uses this to correctly decode the raw bytes into text. ' +
      'Common values include UTF-8, UTF-16LE, UTF-16BE, LATIN-1, and AUTO. ' +
      'When set to AUTO, Splunk attempts to detect the encoding automatically.',
    example: 'CHARSET = UTF-8',
    defaultValue: 'UTF-8',
    category: 'Data Input',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'ANNOTATE_PUNCT',
    description:
      'Controls whether Splunk creates the punct:: field, which contains a punctuation signature of the event. ' +
      'The punct field is used for event pattern detection and similarity analysis. ' +
      'Disabling this can slightly improve indexing performance.',
    example: 'ANNOTATE_PUNCT = false',
    defaultValue: 'true',
    category: 'Data Input',
    appliesTo: 'props.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'MATCH_LIMIT',
    description:
      'The maximum number of match attempts the PCRE regex engine makes before aborting (props.conf context). ' +
      'Applies to regex-based field extractions. Increase this when complex regexes time out on long events. ' +
      'Setting to 0 means unlimited (may cause performance issues).',
    example: 'MATCH_LIMIT = 500000',
    defaultValue: '100000',
    category: 'Performance',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'DEPTH_LIMIT',
    description:
      'The maximum recursion depth for the PCRE regex engine (props.conf context). ' +
      'Complex regex patterns with nested groups may hit this limit. ' +
      'Increase when field extractions fail silently on deeply nested patterns.',
    example: 'DEPTH_LIMIT = 5000',
    defaultValue: '1000',
    category: 'Performance',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'LEARN_SOURCETYPE',
    description:
      'Controls whether Splunk attempts to learn and classify the sourcetype of incoming data automatically. ' +
      'When set to true, Splunk uses its sourcetype detection algorithm to categorize data. ' +
      'Set to false when you want to enforce explicit sourcetype assignments.',
    example: 'LEARN_SOURCETYPE = false',
    defaultValue: 'true',
    category: 'Data Input',
    appliesTo: 'props.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'SEGMENTATION',
    description:
      'Specifies the segmentation rule to use for indexing the event text. ' +
      'Segmentation determines how event text is tokenized for efficient searching. ' +
      'Common values include "inner", "outer", "full", and "none".',
    example: 'SEGMENTATION = inner',
    defaultValue: 'indexing',
    category: 'Data Input',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },

  // =======================================================================
  // props.conf -- Lookup
  // =======================================================================
  {
    key: 'LOOKUP',
    description:
      'Defines an automatic lookup that runs at search time for events matching this stanza. ' +
      'References a lookup table (transforms stanza or lookup definition) and specifies how to ' +
      'join fields from the event with fields from the lookup table. The class name identifies the lookup.',
    example: 'LOOKUP-user_info = user_lookup user_id OUTPUT user_name, department',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: true,
    phase: 'search-time',
  },

  // =======================================================================
  // transforms.conf -- Field Extraction
  // =======================================================================
  {
    key: 'REGEX',
    description:
      'A PCRE regular expression used to extract fields from the event data. ' +
      'Must contain at least one named capturing group (?P<fieldname>...) or be paired with a FORMAT directive ' +
      'that maps numbered capturing groups ($1, $2, ...) to field names.',
    example: 'REGEX = (?P<src_ip>\\d+\\.\\d+\\.\\d+\\.\\d+)\\s+(?P<action>\\w+)',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'regex',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'FORMAT',
    description:
      'Specifies how to map captured groups from the REGEX to field-value pairs. ' +
      'Uses $1, $2, etc. to reference numbered capturing groups. ' +
      'Syntax is field_name::$capture_group or $capture_group for indexed field routing.',
    example: 'FORMAT = src_ip::$1 action::$2',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'SOURCE_KEY',
    description:
      'Specifies the field from which the REGEX extracts values. ' +
      'By default, REGEX runs against _raw. Set this to run the regex against a different field. ' +
      'Special values include MetaData:Source, MetaData:Host, and MetaData:Sourcetype.',
    example: 'SOURCE_KEY = MetaData:Source',
    defaultValue: '_raw',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'DEST_KEY',
    description:
      'Specifies the field where the result of the REGEX/FORMAT transformation is written. ' +
      'Commonly used for index-time transforms such as routing events. ' +
      'Special values include queue (for routing), MetaData:Index, MetaData:Host, MetaData:Source, and MetaData:Sourcetype.',
    example: 'DEST_KEY = MetaData:Index',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'WRITE_META',
    description:
      'When set to true, writes the extracted fields into the _meta field of the event at index time. ' +
      'This allows the extracted fields to be stored as indexed fields (metadata) that are available ' +
      'for search without needing search-time extraction.',
    example: 'WRITE_META = true',
    defaultValue: 'false',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'INGEST_EVAL',
    description:
      'An eval expression that runs at index time (ingest) to create or modify fields. ' +
      'This is a powerful mechanism for computing fields before data is written to the index. ' +
      'Multiple expressions can be separated by commas.',
    example: 'INGEST_EVAL = vendor=upper(vendor), index=if(severity>7,"critical","main")',
    defaultValue: '',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'eval',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'CLONE_SOURCETYPE',
    description:
      'Creates a copy of each event and assigns the specified sourcetype to the clone. ' +
      'The original event keeps its original sourcetype. ' +
      'Used in conjunction with REGEX to selectively clone events that match a pattern.',
    example: 'CLONE_SOURCETYPE = cloned_security_event',
    defaultValue: '',
    category: 'Event Routing',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },

  // =======================================================================
  // transforms.conf -- Performance
  // =======================================================================
  {
    key: 'MATCH_LIMIT',
    description:
      'The maximum number of match attempts the PCRE regex engine makes before aborting (transforms.conf context). ' +
      'Applies specifically to the REGEX defined in this transforms stanza. ' +
      'Useful for preventing runaway regex operations on large events.',
    example: 'MATCH_LIMIT = 500000',
    defaultValue: '100000',
    category: 'Performance',
    appliesTo: 'transforms.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'DEPTH_LIMIT',
    description:
      'The maximum recursion depth for the PCRE regex engine (transforms.conf context). ' +
      'Controls how deep PCRE recurses when evaluating complex patterns with nested groups. ' +
      'Increase if your regex fails silently on valid data.',
    example: 'DEPTH_LIMIT = 5000',
    defaultValue: '1000',
    category: 'Performance',
    appliesTo: 'transforms.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'both',
  },

  // =======================================================================
  // transforms.conf -- Lookup
  // =======================================================================
  {
    key: 'filename',
    description:
      'The name of the CSV lookup file located in $SPLUNK_HOME/etc/apps/<app>/lookups/. ' +
      'This file provides the lookup table data for the transforms stanza. ' +
      'Must be a valid CSV file with a header row defining field names.',
    example: 'filename = ip_reputation.csv',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'match_type',
    description:
      'Specifies the matching algorithm for one or more lookup fields. ' +
      'Supported types include EXACT (default), WILDCARD (supports * patterns), and CIDR (for IP subnet matching). ' +
      'Syntax: match_type = WILDCARD(field1), CIDR(field2).',
    example: 'match_type = WILDCARD(src_host), CIDR(src_ip)',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'max_matches',
    description:
      'The maximum number of matching rows from the lookup table that can be returned per event. ' +
      'When a lookup matches multiple rows, this caps how many are returned. ' +
      'Set to 1 for single-value lookups or higher for multi-value results.',
    example: 'max_matches = 5',
    defaultValue: '1',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'min_matches',
    description:
      'The minimum number of matches required from the lookup table for results to be returned. ' +
      'If fewer matches are found, the default_match value is used instead. ' +
      'Useful for ensuring a minimum quality threshold for lookup results.',
    example: 'min_matches = 1',
    defaultValue: '0',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'default_match',
    description:
      'The default value returned when a lookup finds no matches or fewer matches than min_matches. ' +
      'Ensures that lookup-dependent logic always has a fallback value.',
    example: 'default_match = unknown',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'case_sensitive_match',
    description:
      'Controls whether lookup matching is case-sensitive. ' +
      'When true, "Admin" and "admin" are treated as different values. ' +
      'Set to false for case-insensitive matching.',
    example: 'case_sensitive_match = false',
    defaultValue: 'true',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'search-time',
  },

  // =======================================================================
  // transforms.conf -- Event Routing
  // =======================================================================
  {
    key: 'LOOKAHEAD',
    description:
      'The number of characters from the start of an event that Splunk examines when applying the transforms REGEX. ' +
      'Limits the portion of each event that the regex is tested against. ' +
      'Setting this appropriately can improve performance for long events.',
    example: 'LOOKAHEAD = 4096',
    defaultValue: '4096',
    category: 'Event Routing',
    appliesTo: 'transforms.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'MV_ADD',
    description:
      'When set to true, allows the extraction to append values to a multi-value field instead of overwriting it. ' +
      'If the same field is extracted multiple times, each value is retained. ' +
      'When false (default), later extractions overwrite earlier ones.',
    example: 'MV_ADD = true',
    defaultValue: 'false',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'CLEAN_KEYS',
    description:
      'When set to true, Splunk converts extracted field names to lowercase and replaces non-alphanumeric characters ' +
      'with underscores. Helps normalize field names extracted from diverse data sources.',
    example: 'CLEAN_KEYS = true',
    defaultValue: 'true',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'KEEP_EMPTY_VALS',
    description:
      'When set to true, fields that match the REGEX but capture an empty string are still created with an empty value. ' +
      'When false, empty captures are discarded.',
    example: 'KEEP_EMPTY_VALS = true',
    defaultValue: 'false',
    category: 'Field Extraction',
    appliesTo: 'transforms.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'both',
  },
  {
    key: 'CAN_OPTIMIZE',
    description:
      'Controls whether Splunk can optimize this transforms stanza by skipping it when the fields it extracts are not required by the search. ' +
      'Set to false to force the transform to always run, which is necessary when it has side effects.',
    example: 'CAN_OPTIMIZE = false',
    defaultValue: 'true',
    category: 'Performance',
    appliesTo: 'transforms.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'search-time',
  },

  // =======================================================================
  // props.conf -- Additional directives
  // =======================================================================
  {
    key: 'HEADER_FIELD_LINE_NUMBER',
    description:
      'For structured data types (INDEXED_EXTRACTIONS), specifies which line number contains the field/header names. ' +
      'The first line is line number 0.',
    example: 'HEADER_FIELD_LINE_NUMBER = 0',
    defaultValue: '0',
    category: 'Structured Data',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'FIELD_DELIMITER',
    description:
      'For structured data types (INDEXED_EXTRACTIONS = csv/tsv/psv), specifies the character used to delimit fields. ' +
      'Typically set automatically based on the INDEXED_EXTRACTIONS type.',
    example: 'FIELD_DELIMITER = ,',
    defaultValue: '',
    category: 'Structured Data',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'FIELD_QUOTE',
    description:
      'For structured data types (INDEXED_EXTRACTIONS), specifies the character used to quote field values that ' +
      'contain the delimiter character.',
    example: 'FIELD_QUOTE = "',
    defaultValue: '"',
    category: 'Structured Data',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'TIMESTAMP_FIELDS',
    description:
      'A comma-separated list of field names that contain timestamp data in structured data (INDEXED_EXTRACTIONS). ' +
      'Splunk uses the value of the first non-empty field found as the event timestamp.',
    example: 'TIMESTAMP_FIELDS = event_time, created_at',
    defaultValue: '',
    category: 'Structured Data',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'FIELD_NAMES',
    description:
      'Explicitly specifies a comma-separated list of field names for structured data parsing when the data does not contain a header row. ' +
      'Used with INDEXED_EXTRACTIONS when the data files lack a header line.',
    example: 'FIELD_NAMES = timestamp, severity, message, host',
    defaultValue: '',
    category: 'Structured Data',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'PREAMBLE_REGEX',
    description:
      'A regex that matches non-data preamble lines at the beginning of a file that should be skipped. ' +
      'Lines matching this pattern are ignored during structured data parsing.',
    example: 'PREAMBLE_REGEX = ^#',
    defaultValue: '',
    category: 'Structured Data',
    appliesTo: 'props.conf',
    valueType: 'regex',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'rename',
    description:
      'Renames a sourcetype to a new name. When Splunk encounters the original sourcetype, it replaces it with the value of rename. ' +
      'This is useful for normalizing sourcetype names.',
    example: 'rename = cisco:asa',
    defaultValue: '',
    category: 'Data Input',
    appliesTo: 'props.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'index-time',
  },
  {
    key: 'priority',
    description:
      'Sets the priority for stanza matching when a data input matches multiple stanzas. ' +
      'Higher values take precedence. Used to control which stanza\'s settings are applied first.',
    example: 'priority = 10',
    defaultValue: '0',
    category: 'Data Input',
    appliesTo: 'props.conf',
    valueType: 'number',
    isClassBased: false,
    phase: 'index-time',
  },

  // =======================================================================
  // transforms.conf -- Additional directives
  // =======================================================================
  {
    key: 'external_cmd',
    description:
      'Specifies an external command or script to use for a scripted lookup. ' +
      'The script must be located in $SPLUNK_HOME/etc/apps/<app>/bin/ and must accept input/output in CSV format on stdin/stdout.',
    example: 'external_cmd = lookup_user.py user_id',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'external_type',
    description:
      'Specifies the type of external lookup. Currently only "python" and "kvstore" are supported. ' +
      'Used with external_cmd for scripted lookups or with collection for KV Store lookups.',
    example: 'external_type = python',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'enum',
    enumValues: ['python', 'kvstore'],
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'collection',
    description:
      'The name of the KV Store collection to use for a KV Store lookup. ' +
      'Requires external_type = kvstore. The collection must be defined in collections.conf.',
    example: 'collection = asset_inventory',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'fields_list',
    description:
      'A comma-separated list of fields that this lookup provides. ' +
      'Defines which fields are available as both input (matching) fields and output fields for the lookup.',
    example: 'fields_list = user_id, user_name, department, role',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'batch_index_query',
    description:
      'Controls whether the lookup uses batch mode for KV Store or external script queries. ' +
      'When true, Splunk sends all lookup values in one batch instead of querying row by row. ' +
      'Can significantly improve lookup performance for large datasets.',
    example: 'batch_index_query = true',
    defaultValue: 'true',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'boolean',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'time_field',
    description:
      'Specifies which field in the lookup table contains time data, enabling time-based lookup filtering. ' +
      'When set, Splunk can scope the lookup to only match entries within a relevant time range.',
    example: 'time_field = event_timestamp',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'string',
    isClassBased: false,
    phase: 'search-time',
  },
  {
    key: 'time_format',
    description:
      'The strftime format string used to parse the time_field values in the lookup table. ' +
      'Required when time_field is set and the time values are not in epoch format.',
    example: 'time_format = %Y-%m-%dT%H:%M:%S',
    defaultValue: '',
    category: 'Lookups',
    appliesTo: 'transforms.conf',
    valueType: 'strftime',
    isClassBased: false,
    phase: 'search-time',
  },
];

// ---------------------------------------------------------------------------
// Build lookup maps for fast access
// ---------------------------------------------------------------------------

/**
 * Canonical map of all directives, keyed by their base key name.
 * When a key exists in both props.conf and transforms.conf (e.g. MATCH_LIMIT)
 * we keep both entries, so the lookup helpers filter by file at runtime.
 */
const directivesByKey = new Map<string, DirectiveInfo[]>();

for (const d of DIRECTIVES) {
  const existing = directivesByKey.get(d.key);
  if (existing) {
    existing.push(d);
  } else {
    directivesByKey.set(d.key, [d]);
  }
}

// ---------------------------------------------------------------------------
// Class-based directive prefixes -- e.g. EXTRACT, REPORT, etc.
// ---------------------------------------------------------------------------

const CLASS_BASED_PREFIXES: string[] = DIRECTIVES
  .filter((d) => d.isClassBased)
  .map((d) => d.key);

// ---------------------------------------------------------------------------
// Exported helper functions
// ---------------------------------------------------------------------------

/**
 * Look up a directive by its key, scoped to a given configuration file.
 *
 * For class-based directives (e.g. "EXTRACT-myfield") the lookup uses the
 * base prefix ("EXTRACT").
 */
export function getDirectiveInfo(
  key: string,
  file: 'props.conf' | 'transforms.conf',
): DirectiveInfo | undefined {
  // Try an exact match first.
  const exact = directivesByKey.get(key);
  if (exact) {
    return exact.find((d) => d.appliesTo === file || d.appliesTo === 'both');
  }

  // Try matching a class-based prefix (e.g. "EXTRACT-myfield" -> "EXTRACT").
  const parsed = getClassBasedDirectiveBase(key);
  if (parsed) {
    const byBase = directivesByKey.get(parsed.base);
    if (byBase) {
      return byBase.find((d) => d.appliesTo === file || d.appliesTo === 'both');
    }
  }

  return undefined;
}

/**
 * Return all directives that apply to the given configuration file.
 */
export function getDirectivesForFile(
  file: 'props.conf' | 'transforms.conf',
): DirectiveInfo[] {
  return DIRECTIVES.filter((d) => d.appliesTo === file || d.appliesTo === 'both');
}

/**
 * Return directives grouped by category for the given configuration file.
 */
export function getDirectivesByCategory(
  file: 'props.conf' | 'transforms.conf',
): Map<string, DirectiveInfo[]> {
  const result = new Map<string, DirectiveInfo[]>();
  for (const d of DIRECTIVES) {
    if (d.appliesTo !== file && d.appliesTo !== 'both') {
      continue;
    }
    const group = result.get(d.category);
    if (group) {
      group.push(d);
    } else {
      result.set(d.category, [d]);
    }
  }
  return result;
}

/**
 * Parse a class-based directive key like "EXTRACT-myfield" into its base
 * prefix and class name.  Returns null if the key is not class-based.
 */
export function getClassBasedDirectiveBase(
  key: string,
): { base: string; className: string } | null {
  const dashIndex = key.indexOf('-');
  if (dashIndex === -1) {
    return null;
  }

  const base = key.substring(0, dashIndex);
  const className = key.substring(dashIndex + 1);

  if (CLASS_BASED_PREFIXES.includes(base) && className.length > 0) {
    return { base, className };
  }

  return null;
}

/**
 * Return the full list of registered directives.  Useful for iteration in
 * autocomplete providers and documentation generators.
 */
export function getAllDirectives(): DirectiveInfo[] {
  return [...DIRECTIVES];
}
