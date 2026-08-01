// CIM data model definitions, derived from the Splunk Common Information Model
// add-on (Splunk_SA_CIM) v8.5.0 as shipped on Splunkbase — specifically
// `default/data/models/*.json`, which is what Splunk itself runs.
//
// LICENCE: the add-on is Splunk Inc.'s and is distributed under Splunk's terms,
// not an open-source licence. The dataset, field, and tag identifiers below are
// derived from it for interoperability and are NOT covered by this project's
// MIT licence — see the NOTICE file at the repository root. The add-on itself
// is not vendored here and is not needed to build, test, or run the app.
//
// Regenerate with `node scripts/generate-cim-models.js <path-to-Splunk_SA_CIM>`
// rather than editing by hand. How each entry is derived (see #37 — hand-written
// lists had drifted and listed fields several models don't define):
//
//   * One entry per CIM *root dataset* (a dataset whose parent is BaseEvent or
//     BaseSearch), because a root dataset + its tags is what an event actually
//     maps onto. Endpoint has five independent root datasets and no model-wide
//     `tag=endpoint` constraint, so it is five entries.
//   * Field pool = the dataset's own fields plus every calculation output field,
//     and the same for all of its descendant datasets. Hidden fields and fields
//     marked `ta_relevant: false` are dropped: the latter are asset/identity
//     enrichment (`*_bunit`, `*_category`, `*_priority`, `tag`, …) that Splunk
//     adds downstream and that an add-on must NOT extract.
//   * requiredFields = the fields the root dataset flags `comment.recommended:
//     true`. Where a root flags none, the fallback is the key fields Splunk's own
//     Splunk_CIM_Validation model checks for that model (its `Missing_Extractions_*`
//     datasets). Three models declare neither and so require nothing.
//   * recommendedFields = the rest of the pool.
//   * tags = the tags the root constraint requires conjunctively. An event needs
//     ALL of them, so a missing tag breaks dataset membership outright.

export interface CimModel {
  /** CIM dataset identifier: model name, or `Model.Dataset` where a model has several root datasets. */
  name: string;
  displayName: string;
  description: string;
  requiredFields: string[];
  recommendedFields: string[];
  /** Tags the dataset constraint requires — an event needs ALL of them to populate the dataset. */
  tags: string[];
}

/** Version of the Splunk_SA_CIM add-on these definitions were generated from. */
export const CIM_VERSION = '8.5.0';

export const CIM_MODELS: CimModel[] = [
  {
    name: 'Alerts',
    displayName: 'Alerts',
    description: 'Alert and notification events from monitoring systems',
    requiredFields: ['app', 'dest', 'severity', 'signature_id', 'src', 'type', 'user'],
    recommendedFields: ['body', 'description', 'dest_type', 'id', 'mitre_technique_id', 'severity_id', 'signature', 'src_type', 'subject', 'user_name', 'vendor_account', 'vendor_region'],
    tags: ['alert'],
  },
  {
    name: 'Authentication',
    displayName: 'Authentication',
    description: 'Login/logout events and user access attempts',
    requiredFields: ['action', 'app', 'dest', 'src', 'src_user', 'user'],
    recommendedFields: ['authentication_method', 'authentication_service', 'dest_nt_domain', 'duration', 'process', 'reason', 'reason_id', 'response_time', 'result', 'session_id', 'signature', 'signature_id', 'src_nt_domain', 'src_user_id', 'src_user_role', 'src_user_type', 'user_agent', 'user_id', 'user_role', 'user_type', 'vendor_account'],
    tags: ['authentication'],
  },
  {
    // The ssl_* fields belong to the child SSL dataset (tag=ssl OR tag=tls).
    name: 'Certificates',
    displayName: 'Certificates',
    description: 'SSL/TLS certificate lifecycle and validation',
    requiredFields: ['ssl_hash', 'ssl_issuer', 'ssl_subject'],
    recommendedFields: ['dest', 'dest_port', 'duration', 'response_time', 'src', 'src_port', 'ssl_end_time', 'ssl_engine', 'ssl_issuer_common_name', 'ssl_issuer_email', 'ssl_issuer_email_domain', 'ssl_issuer_locality', 'ssl_issuer_organization', 'ssl_issuer_state', 'ssl_issuer_street', 'ssl_issuer_unit', 'ssl_name', 'ssl_policies', 'ssl_publickey', 'ssl_publickey_algorithm', 'ssl_serial', 'ssl_session_id', 'ssl_signature_algorithm', 'ssl_start_time', 'ssl_subject_common_name', 'ssl_subject_email', 'ssl_subject_email_domain', 'ssl_subject_locality', 'ssl_subject_organization', 'ssl_subject_state', 'ssl_subject_street', 'ssl_subject_unit', 'ssl_version', 'transport'],
    tags: ['certificate'],
  },
  {
    name: 'Change',
    displayName: 'Change',
    description: 'Configuration, account and instance change events',
    requiredFields: ['action', 'change_type', 'command', 'dest', 'dvc', 'object', 'object_attrs', 'object_category', 'object_id', 'object_path', 'result', 'result_id', 'src', 'status', 'user', 'vendor_product'],
    recommendedFields: ['dest_nt_domain', 'image_id', 'instance_type', 'src_nt_domain', 'src_user', 'src_user_name', 'src_user_type', 'user_agent', 'user_name', 'user_type', 'vendor_account', 'vendor_region'],
    tags: ['change'],
  },
  {
    // Also needs one of tag=cpu / memory / network / storage / (system version) / user / virtual.
    name: 'Compute_Inventory',
    displayName: 'Inventory',
    description: 'CPU, memory, storage, network and OS inventory records',
    requiredFields: ['dest', 'vendor_product'],
    recommendedFields: ['array', 'blocksize', 'cluster', 'cpu_cores', 'cpu_count', 'cpu_mhz', 'description', 'dest_ip', 'dns', 'enabled', 'family', 'fd_max', 'hypervisor', 'hypervisor_id', 'inline_nat', 'interactive', 'interface', 'ip', 'latency', 'lb_method', 'mac', 'mem', 'mount', 'name', 'node', 'node_port', 'os', 'parent', 'password', 'read_blocks', 'read_latency', 'read_ops', 'serial', 'shell', 'size', 'snapshot', 'src_ip', 'status', 'storage', 'time', 'user', 'user_id', 'version', 'vip_port', 'write_blocks', 'write_latency', 'write_ops'],
    tags: ['inventory'],
  },
  {
    name: 'DLP',
    displayName: 'Data Loss Prevention',
    description: 'Data protection and exfiltration incidents',
    requiredFields: ['action', 'category', 'dest', 'dlp_type', 'dvc', 'object', 'object_category', 'object_path', 'severity', 'signature', 'src', 'src_user', 'user', 'vendor_product'],
    recommendedFields: ['app', 'dest_zone', 'dvc_zone', 'severity_id', 'signature_id', 'src_zone'],
    tags: ['dlp', 'incident'],
  },
  {
    name: 'Data_Access',
    displayName: 'Data Access',
    description: 'Access to files, records and objects in data stores',
    requiredFields: ['action', 'app', 'dest', 'object', 'object_attrs', 'object_category', 'object_id', 'object_size', 'signature', 'src', 'user', 'user_name', 'vendor_account', 'vendor_product'],
    recommendedFields: ['application_id', 'dest_name', 'dest_type', 'dest_url', 'dvc', 'email', 'object_path', 'owner', 'owner_email', 'owner_id', 'parent_object', 'parent_object_category', 'parent_object_id', 'signature_id', 'user_agent', 'user_email', 'user_group', 'user_id', 'user_role', 'user_type', 'vendor_product_id', 'vendor_region'],
    tags: ['data', 'access'],
  },
  {
    // CIM declares no key fields for this model, so nothing is listed as required.
    name: 'Databases',
    displayName: 'Databases',
    description: 'Database instance, session, lock and query activity',
    requiredFields: [],
    recommendedFields: ['availability', 'avg_executions', 'buffer_cache_hit_ratio', 'commits', 'cpu_used', 'cursor', 'dest', 'dump_area_used', 'duration', 'elapsed_time', 'free_bytes', 'indexes_hit', 'instance_name', 'instance_reads', 'instance_version', 'instance_writes', 'last_call_minute', 'lock_mode', 'lock_session_id', 'logical_reads', 'logon_time', 'machine', 'memory_sorts', 'number_of_users', 'obj_name', 'object', 'os_pid', 'physical_reads', 'process_limit', 'processes', 'query', 'query_id', 'query_plan_hit', 'query_time', 'records_affected', 'response_time', 'seconds_in_wait', 'serial_num', 'session_id', 'session_limit', 'session_status', 'sessions', 'sga_buffer_cache_size', 'sga_buffer_hit_limit', 'sga_data_dict_hit_ratio', 'sga_fixed_area_size', 'sga_free_memory', 'sga_library_cache_size', 'sga_redo_log_buffer_size', 'sga_shared_pool_size', 'sga_sql_area_size', 'src', 'start_time', 'stored_procedures_called', 'table_scans', 'tables_hit', 'tablespace_name', 'tablespace_reads', 'tablespace_status', 'tablespace_used', 'tablespace_writes', 'user', 'vendor_product', 'wait_state', 'wait_time'],
    tags: ['database'],
  },
  {
    name: 'Email',
    displayName: 'Email',
    description: 'Email client, gateway and filtering events',
    requiredFields: ['action', 'dest', 'recipient', 'recipient_domain', 'src', 'src_user', 'src_user_domain', 'vendor_product'],
    recommendedFields: ['delay', 'duration', 'file_hash', 'file_name', 'file_size', 'filter_action', 'filter_score', 'internal_message_id', 'message_id', 'message_info', 'orig_dest', 'orig_recipient', 'orig_src', 'process', 'process_id', 'protocol', 'recipient_status', 'response_time', 'retries', 'return_addr', 'signature', 'signature_extra', 'signature_id', 'size', 'status_code', 'subject', 'url', 'user', 'xdelay', 'xref'],
    tags: ['email'],
  },
  {
    name: 'Endpoint.Filesystem',
    displayName: 'Endpoint: Filesystem',
    description: 'File create/read/write/delete activity on a host',
    requiredFields: ['action', 'dest', 'file_access_time', 'file_acl', 'file_create_time', 'file_hash', 'file_modify_time', 'file_name', 'file_path', 'file_size', 'process', 'process_name', 'user', 'vendor_product'],
    recommendedFields: ['image', 'parent_process', 'parent_process_exec', 'parent_process_guid', 'parent_process_hash', 'parent_process_id', 'parent_process_name', 'parent_process_path', 'process_exec', 'process_guid', 'process_hash', 'process_id', 'process_path'],
    tags: ['endpoint', 'filesystem'],
  },
  {
    name: 'Endpoint.Ports',
    displayName: 'Endpoint: Ports',
    description: 'Listening network ports on a host',
    requiredFields: ['dest', 'dest_port', 'src', 'src_port', 'transport', 'user', 'vendor_product'],
    recommendedFields: ['creation_time', 'process_guid', 'process_id', 'state'],
    tags: ['listening', 'port'],
  },
  {
    name: 'Endpoint.Processes',
    displayName: 'Endpoint: Processes',
    description: 'Process execution and parent/child process activity',
    requiredFields: ['dest', 'loaded_file', 'original_file_name', 'parent_process', 'parent_process_name', 'process', 'process_name', 'user', 'vendor_product'],
    recommendedFields: ['action', 'cpu_load_percent', 'mem_used', 'os', 'parent_process_exec', 'parent_process_guid', 'parent_process_hash', 'parent_process_id', 'parent_process_path', 'parent_user', 'process_current_directory', 'process_exec', 'process_guid', 'process_hash', 'process_id', 'process_integrity_level', 'process_path', 'user_id'],
    tags: ['process', 'report'],
  },
  {
    name: 'Endpoint.Registry',
    displayName: 'Endpoint: Registry',
    description: 'Windows registry key and value activity',
    requiredFields: ['action', 'dest', 'process', 'process_name', 'registry_key_name', 'registry_path', 'registry_value_data', 'registry_value_name', 'registry_value_type', 'user', 'vendor_product'],
    recommendedFields: ['image', 'parent_process', 'parent_process_exec', 'parent_process_guid', 'parent_process_hash', 'parent_process_id', 'parent_process_name', 'parent_process_path', 'process_exec', 'process_guid', 'process_hash', 'process_id', 'process_path', 'registry_value_text'],
    tags: ['endpoint', 'registry'],
  },
  {
    name: 'Endpoint.Services',
    displayName: 'Endpoint: Services',
    description: 'Service inventory and start/stop state on a host',
    requiredFields: ['dest', 'service', 'service_id', 'service_name', 'start_mode', 'status', 'user', 'vendor_product'],
    recommendedFields: ['description', 'process_guid', 'process_id', 'service_dll', 'service_dll_hash', 'service_dll_path', 'service_dll_signature_exists', 'service_dll_signature_verified', 'service_exec', 'service_hash', 'service_path', 'service_signature_exists', 'service_signature_verified'],
    tags: ['service', 'report'],
  },
  {
    // Also requires signature or signature_id to be present.
    name: 'Event_Signatures',
    displayName: 'Event Signatures',
    description: 'Vendor event codes tracked for signature reporting',
    requiredFields: ['vendor_product'],
    recommendedFields: ['dest', 'signature', 'signature_id'],
    tags: ['track_event_signatures'],
  },
  {
    // CIM declares no key fields for this model, so nothing is listed as required.
    name: 'Interprocess_Messaging',
    displayName: 'Interprocess Messaging',
    description: 'Message queue and RPC request/response events',
    requiredFields: [],
    recommendedFields: ['dest', 'duration', 'endpoint', 'endpoint_version', 'message', 'message_consumed_time', 'message_correlation_id', 'message_delivered_time', 'message_delivery_mode', 'message_expiration_time', 'message_id', 'message_priority', 'message_properties', 'message_received_time', 'message_redelivered', 'message_reply_dest', 'message_type', 'parameters', 'payload', 'payload_type', 'request_payload', 'request_payload_type', 'request_sent_time', 'response_code', 'response_payload_type', 'response_received_time', 'response_time', 'return_message', 'rpc_protocol', 'status'],
    tags: ['messaging'],
  },
  {
    name: 'Intrusion_Detection',
    displayName: 'Intrusion Detection',
    description: 'IDS/IPS security alerts',
    requiredFields: ['category', 'dest', 'dvc', 'ids_type', 'severity', 'signature', 'src', 'user', 'vendor_product'],
    recommendedFields: ['action', 'dest_ip', 'dest_port', 'dest_type', 'severity_id', 'signature_id', 'src_ip', 'src_port', 'transport'],
    tags: ['ids', 'attack'],
  },
  {
    // CIM declares no key fields for this model, so nothing is listed as required.
    name: 'JVM',
    displayName: 'JVM',
    description: 'Java Virtual Machine runtime, memory and threading metrics',
    requiredFields: [],
    recommendedFields: ['cm_enabled', 'cm_supported', 'committed_memory', 'compilation_time', 'cpu_time', 'cpu_time_enabled', 'cpu_time_supported', 'current_cpu_time', 'current_loaded', 'current_user_time', 'daemon_thread_count', 'free_physical_memory', 'free_swap', 'heap_committed', 'heap_initial', 'heap_max', 'heap_used', 'jvm_description', 'max_file_descriptors', 'non_heap_committed', 'non_heap_initial', 'non_heap_max', 'non_heap_used', 'objects_pending', 'omu_supported', 'open_file_descriptors', 'os', 'os_architecture', 'os_version', 'peak_thread_count', 'physical_memory', 'process_name', 'start_time', 'swap_space', 'synch_supported', 'system_load', 'thread_count', 'threads_started', 'total_loaded', 'total_processors', 'total_unloaded', 'uptime', 'vendor_product', 'version'],
    tags: ['jvm'],
  },
  {
    // The Malware_Operations dataset (`tag=malware tag=operations`) is not modelled here.
    name: 'Malware',
    displayName: 'Malware',
    description: 'Anti-malware and malicious file detections',
    requiredFields: ['action', 'category', 'date', 'dest', 'dest_nt_domain', 'severity', 'signature', 'user', 'vendor_product'],
    recommendedFields: ['dest_ip', 'file_hash', 'file_name', 'file_path', 'severity_id', 'signature_id', 'src', 'src_ip', 'src_user', 'url'],
    tags: ['malware', 'attack'],
  },
  {
    name: 'Network_Resolution',
    displayName: 'Network Resolution (DNS)',
    description: 'DNS query and resolution events',
    requiredFields: ['answer', 'dest', 'message_type', 'query', 'reply_code', 'reply_code_id', 'vendor_product'],
    recommendedFields: ['additional_answer_count', 'authority_answer_count', 'dest_ip', 'dest_port', 'duration', 'name', 'query_type', 'record_type', 'response_time', 'src', 'src_ip', 'src_port', 'transaction_id', 'transport', 'ttl'],
    tags: ['network', 'resolution', 'dns'],
  },
  {
    name: 'Network_Sessions',
    displayName: 'Network Sessions',
    description: 'DHCP/VPN session start and end events',
    requiredFields: ['dest_dns', 'dest_ip', 'dest_mac', 'dest_nt_host', 'dvc', 'user', 'vendor_product'],
    recommendedFields: ['action', 'duration', 'lease_duration', 'lease_scope', 'response_time', 'signature', 'signature_id', 'src_dns', 'src_ip', 'src_mac', 'src_nt_host'],
    tags: ['network', 'session'],
  },
  {
    name: 'Network_Traffic',
    displayName: 'Network Traffic',
    description: 'Firewall, proxy, and network flow data',
    requiredFields: ['action', 'bytes', 'bytes_in', 'bytes_out', 'dest', 'dest_port', 'dvc', 'rule', 'src', 'src_port', 'transport', 'user', 'vendor_product'],
    recommendedFields: ['app', 'channel', 'dest_interface', 'dest_ip', 'dest_mac', 'dest_translated_ip', 'dest_translated_port', 'dest_zone', 'direction', 'duration', 'dvc_ip', 'dvc_mac', 'dvc_zone', 'flow_id', 'icmp_code', 'icmp_type', 'packets', 'packets_in', 'packets_out', 'process_guid', 'process_id', 'protocol', 'protocol_version', 'response_time', 'rule_id', 'session_id', 'src_ip', 'src_mac', 'src_translated_ip', 'src_translated_port', 'src_zone', 'ssid', 'tcp_flag', 'tos', 'ttl', 'vendor_account', 'vlan', 'wifi'],
    tags: ['network', 'communicate'],
  },
  {
    // Also needs one of tag=cpu / facilities / memory / storage / network / (os with time+synchronize or uptime).
    name: 'Performance',
    displayName: 'Performance',
    description: 'System performance metrics (CPU, memory, storage, network, facilities)',
    requiredFields: ['dest'],
    recommendedFields: ['action', 'array', 'blocksize', 'cluster', 'cpu_load_mhz', 'cpu_load_percent', 'cpu_time', 'cpu_user_percent', 'fan_speed', 'fd_max', 'fd_used', 'hypervisor_id', 'latency', 'mem', 'mem_committed', 'mem_free', 'mem_used', 'mount', 'parent', 'power', 'read_blocks', 'read_latency', 'read_ops', 'resource_type', 'signature', 'signature_id', 'storage', 'storage_free', 'storage_free_percent', 'storage_used', 'storage_used_percent', 'swap', 'swap_free', 'swap_used', 'temperature', 'thruput', 'thruput_max', 'uptime', 'write_blocks', 'write_latency', 'write_ops'],
    tags: ['performance'],
  },
  {
    name: 'Ticket_Management',
    displayName: 'Ticket Management',
    description: 'Incident, problem and change tickets',
    requiredFields: ['dest', 'ticket_id'],
    recommendedFields: ['affect_dest', 'change', 'comments', 'description', 'incident', 'priority', 'problem', 'severity', 'severity_id', 'splunk_id', 'splunk_realm', 'src_user', 'status', 'time_submitted', 'user'],
    tags: ['ticketing'],
  },
  {
    // The Update_Errors dataset (`tag=update tag=error`) is not modelled here.
    name: 'Updates',
    displayName: 'Updates',
    description: 'Software patches and update installations',
    requiredFields: ['dest', 'signature', 'signature_id', 'status', 'vendor_product'],
    recommendedFields: ['dvc', 'file_hash', 'file_name', 'severity', 'severity_id'],
    tags: ['update', 'status'],
  },
  {
    name: 'Vulnerabilities',
    displayName: 'Vulnerabilities',
    description: 'Vulnerability scan results and assessments',
    requiredFields: ['category', 'cve', 'dest', 'dvc', 'severity', 'signature', 'vendor_product'],
    recommendedFields: ['bugtraq', 'cert', 'cvss', 'msft', 'mskb', 'severity_id', 'signature_id', 'url', 'user', 'xref'],
    tags: ['vulnerability', 'report'],
  },
  {
    name: 'Web',
    displayName: 'Web',
    description: 'HTTP/HTTPS requests and responses',
    requiredFields: ['action', 'bytes', 'bytes_in', 'bytes_out', 'dest', 'http_content_type', 'http_method', 'http_referrer', 'http_referrer_domain', 'http_user_agent', 'src', 'status', 'url', 'url_domain', 'user', 'vendor_product'],
    recommendedFields: ['app', 'cached', 'category', 'cookie', 'dest_ip', 'dest_port', 'duration', 'response_time', 'site', 'src_ip', 'uri_path', 'uri_query'],
    tags: ['web'],
  },
];
