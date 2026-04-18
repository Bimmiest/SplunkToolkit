export interface SampleConfig {
  name: string;
  description: string;
  rawData: string;
  propsConf: string;
  transformsConf: string;
  metadata: { index: string; host: string; source: string; sourcetype: string };
}

export const SAMPLE_CONFIGS: SampleConfig[] = [
  {
    name: 'Apache Access Log',
    description: 'Field extraction from Apache combined log format with EVAL enrichment',
    metadata: {
      index: 'web',
      host: 'web-prod-01',
      source: '/var/log/apache2/access.log',
      sourcetype: 'access_combined',
    },
    rawData: `192.168.1.10 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326
192.168.1.20 - - [10/Oct/2000:13:55:37 -0700] "POST /login HTTP/1.1" 403 512
192.168.1.30 - admin [10/Oct/2000:13:55:38 -0700] "GET /admin/dashboard HTTP/1.0" 200 1024
192.168.1.40 - - [10/Oct/2000:13:55:39 -0700] "GET /nonexistent HTTP/1.1" 404 209
192.168.1.50 - jdoe [10/Oct/2000:13:55:40 -0700] "DELETE /api/v1/record/42 HTTP/1.1" 204 0`,
    propsConf: `[access_combined]
TIME_PREFIX = \\[
TIME_FORMAT = %d/%b/%Y:%H:%M:%S %z
MAX_TIMESTAMP_LOOKAHEAD = 28
SHOULD_LINEMERGE = false
KV_MODE = none

EXTRACT-fields = ^(?P<clientip>\\S+) \\S+ (?P<user>\\S+) \\[(?P<timestamp>[^\\]]+)\\] "(?P<method>\\w+) (?P<uri>\\S+) (?P<http_version>[^"]+)" (?P<status>\\d+) (?P<bytes>\\d+)

REPORT-uri_parts = uri_path_extract

EVAL-user = if(user=="-", "anonymous", user)
EVAL-success = if(status < 400, "true", "false")
EVAL-category = case(status < 300, "success", status < 400, "redirect", status < 500, "client_error", true(), "server_error")`,
    transformsConf: `[uri_path_extract]
SOURCE_KEY = uri
REGEX = ^(?P<uri_path>[^?#]+)(?:\\?(?P<uri_query>[^#]*))?
WRITE_META = false`,
  },
  {
    name: 'Palo Alto Firewall',
    description: 'Palo Alto TRAFFIC log parsing with REGEX extraction, field aliases and EVAL enrichment',
    metadata: {
      index: 'network',
      host: 'pa-fw-01',
      source: 'syslog',
      sourcetype: 'pan:traffic',
    },
    rawData: `1,2024/01/15 14:23:01,007051000012345,TRAFFIC,end,2561,2024/01/15 14:23:01,10.0.1.5,8.8.8.8,0.0.0.0,0.0.0.0,allow-internet,,,dns,vsys1,trust,untrust,ethernet1/1,ethernet1/2,default-logging,2024/01/15 14:23:01,12345,1,54321,53,0,0,0x0,udp,allow,120,80,40,1,2024/01/15 14:23:00,0,any,0,1234567890,0x0,United States,10.0.0.0-10.255.255.255,0,1,0
1,2024/01/15 14:23:05,007051000012345,TRAFFIC,end,2561,2024/01/15 14:23:05,10.0.1.10,93.184.216.34,0.0.0.0,0.0.0.0,allow-internet,,,web-browsing,vsys1,trust,untrust,ethernet1/1,ethernet1/2,default-logging,2024/01/15 14:23:05,54321,1,45678,443,0,0,0x0,tcp,allow,4096,2048,2048,3,2024/01/15 14:23:02,0,any,0,9876543210,0x0,United States,10.0.0.0-10.255.255.255,0,3,2`,
    propsConf: `[pan:traffic]
SHOULD_LINEMERGE = false
KV_MODE = none

REPORT-pan_traffic = pan_traffic_fields

FIELDALIAS-src       = src_ip AS src
FIELDALIAS-dest      = dest_ip AS dest
FIELDALIAS-transport = proto AS transport

EVAL-action      = if(action=="allow", "allowed", "blocked")
EVAL-bytes_total = bytes_sent + bytes_received`,
    transformsConf: `[pan_traffic_fields]
REGEX = ^[^,]+,(?P<receive_time>[^,]+),[^,]+,(?P<type>[^,]+),(?P<subtype>[^,]+),[^,]+,[^,]+,(?P<src_ip>[^,]+),(?P<dest_ip>[^,]+),[^,]+,[^,]+,(?P<rulename>[^,]+),[^,]*,[^,]*,(?P<app>[^,]+),[^,]+,(?P<from_zone>[^,]+),(?P<to_zone>[^,]+),[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,(?P<sport>[^,]+),(?P<dport>[^,]+),[^,]+,[^,]+,[^,]+,(?P<proto>[^,]+),(?P<action>[^,]+),(?P<bytes_sent>[^,]+),(?P<bytes_received>[^,]+)`,
  },
];
