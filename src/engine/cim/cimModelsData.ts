export interface CimModel {
  name: string;
  displayName: string;
  description: string;
  requiredFields: string[];
  recommendedFields: string[];
  tags: string[];
}

export const CIM_MODELS: CimModel[] = [
  {
    name: 'Authentication',
    displayName: 'Authentication',
    description: 'Login/logout events and user access attempts',
    requiredFields: ['action', 'app', 'dest', 'src', 'user'],
    recommendedFields: ['authentication_method', 'duration', 'reason', 'signature', 'signature_id', 'src_user', 'vendor_product'],
    tags: ['authentication'],
  },
  {
    name: 'Network_Traffic',
    displayName: 'Network Traffic',
    description: 'Firewall, proxy, and network flow data',
    requiredFields: ['action', 'bytes', 'bytes_in', 'bytes_out', 'dest', 'dest_port', 'src', 'src_port', 'transport'],
    recommendedFields: ['app', 'direction', 'duration', 'packets', 'packets_in', 'packets_out', 'protocol', 'user', 'vendor_product'],
    tags: ['network', 'communicate'],
  },
  {
    name: 'Web',
    displayName: 'Web',
    description: 'HTTP/HTTPS requests and responses',
    requiredFields: ['action', 'dest', 'http_method', 'src', 'status', 'uri_path', 'url'],
    recommendedFields: ['bytes', 'bytes_in', 'bytes_out', 'cached', 'cookie', 'duration', 'http_content_type', 'http_referrer', 'http_user_agent', 'site', 'uri_query', 'user', 'vendor_product'],
    tags: ['web'],
  },
  {
    name: 'Endpoint',
    displayName: 'Endpoint',
    description: 'Host/system activity, processes, file operations',
    requiredFields: ['action', 'dest', 'user'],
    recommendedFields: ['file_hash', 'file_name', 'file_path', 'parent_process', 'parent_process_id', 'process', 'process_id', 'vendor_product'],
    tags: ['endpoint'],
  },
  {
    name: 'Intrusion_Detection',
    displayName: 'Intrusion Detection',
    description: 'IDS/IPS security alerts',
    requiredFields: ['action', 'dest', 'dvc', 'signature', 'src'],
    recommendedFields: ['category', 'dest_port', 'file_hash', 'file_name', 'severity', 'signature_id', 'src_port', 'transport', 'user', 'vendor_product'],
    tags: ['ids', 'attack'],
  },
  {
    name: 'Malware',
    displayName: 'Malware',
    description: 'Anti-malware and malicious file detections',
    requiredFields: ['action', 'dest', 'file_hash', 'file_name', 'signature'],
    recommendedFields: ['file_path', 'severity', 'signature_id', 'src', 'user', 'vendor_product'],
    tags: ['malware', 'attack'],
  },
  {
    name: 'Vulnerabilities',
    displayName: 'Vulnerabilities',
    description: 'Vulnerability scan results and assessments',
    requiredFields: ['dest', 'signature', 'severity'],
    recommendedFields: ['bugtraq', 'category', 'cert', 'cve', 'cvss', 'dest_port', 'dvc', 'msft', 'mskb', 'os', 'vendor_product', 'xref'],
    tags: ['vulnerability', 'report'],
  },
  {
    name: 'DLP',
    displayName: 'Data Loss Prevention',
    description: 'Data protection and exfiltration events',
    requiredFields: ['action', 'dest', 'src', 'user'],
    recommendedFields: ['app', 'file_name', 'file_path', 'protocol', 'severity', 'signature', 'src_user', 'url', 'vendor_product'],
    tags: ['dlp'],
  },
  {
    name: 'Email',
    displayName: 'Email',
    description: 'Email client and gateway events',
    requiredFields: ['action', 'dest', 'src', 'subject'],
    recommendedFields: ['file_name', 'file_size', 'message_id', 'orig_recipient', 'protocol', 'recipient', 'recipient_count', 'return_addr', 'size', 'src_user', 'vendor_product'],
    tags: ['email'],
  },
  {
    name: 'Network_Resolution',
    displayName: 'Network Resolution (DNS)',
    description: 'DNS query and resolution events',
    requiredFields: ['dest', 'query', 'src'],
    recommendedFields: ['answer', 'message_type', 'query_count', 'query_type', 'record_type', 'reply_code', 'reply_code_id', 'transaction_id', 'transport', 'vendor_product'],
    tags: ['dns', 'network', 'resolution'],
  },
  {
    name: 'Change',
    displayName: 'Change',
    description: 'Configuration change and deployment events',
    requiredFields: ['action', 'dest', 'user'],
    recommendedFields: ['change_type', 'command', 'dvc', 'object', 'object_category', 'result', 'status', 'vendor_product'],
    tags: ['change'],
  },
  {
    name: 'Alerts',
    displayName: 'Alerts',
    description: 'Alert and notification events',
    requiredFields: ['description', 'dest', 'severity', 'signature'],
    recommendedFields: ['app', 'body', 'id', 'mitre_technique_id', 'src', 'subject', 'type', 'user', 'vendor_product'],
    tags: ['alert'],
  },
  {
    name: 'Updates',
    displayName: 'Updates',
    description: 'Software patches and update installations',
    requiredFields: ['dest', 'signature', 'status'],
    recommendedFields: ['dvc', 'severity', 'signature_id', 'vendor_product'],
    tags: ['update'],
  },
  {
    name: 'Databases',
    displayName: 'Databases',
    description: 'Database activity and queries',
    requiredFields: ['action', 'dest', 'query'],
    recommendedFields: ['app', 'db_name', 'duration', 'object', 'query_type', 'src', 'status', 'user', 'vendor_product'],
    tags: ['database'],
  },
  {
    name: 'Certificates',
    displayName: 'Certificates',
    description: 'SSL/TLS certificate lifecycle and validation',
    requiredFields: ['dest', 'ssl_issuer', 'ssl_subject'],
    recommendedFields: ['ssl_end_time', 'ssl_hash', 'ssl_issuer_common_name', 'ssl_serial', 'ssl_start_time', 'ssl_subject_common_name', 'ssl_version', 'vendor_product'],
    tags: ['certificate'],
  },
  {
    name: 'Performance',
    displayName: 'Performance',
    description: 'System performance metrics (CPU, memory, disk, network)',
    requiredFields: ['dest'],
    recommendedFields: ['cpu_load_percent', 'mem_used', 'mem', 'os', 'storage_used', 'storage', 'vendor_product'],
    tags: ['performance'],
  },
];
