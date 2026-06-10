import { describe, it, expect } from 'vitest';
import { runPipeline } from '../pipeline';
import type { EventMetadata } from '../types';

const META: EventMetadata = { index: 'main', host: '', source: '', sourcetype: 'aws:cloudtrail' };
const JSON_RAW = '{"eventTime":"2024-01-15T10:00:00Z","action":"login","user":"alice"}';

const hasDupWarning = (diags: { message: string }[]) =>
  diags.some((d) => d.message.includes('duplicate (multivalue) field values'));

describe('runPipeline — INDEXED_EXTRACTIONS + KV_MODE duplicate-extraction warning', () => {
  it('warns when INDEXED_EXTRACTIONS=json and KV_MODE=json are both set', () => {
    const props = '[aws:cloudtrail]\nINDEXED_EXTRACTIONS = json\nKV_MODE = json';
    const { diagnostics } = runPipeline(JSON_RAW, META, props, '');
    expect(hasDupWarning(diagnostics)).toBe(true);
  });

  it('warns when INDEXED_EXTRACTIONS=json and KV_MODE is unset (default auto re-extracts JSON)', () => {
    const props = '[aws:cloudtrail]\nINDEXED_EXTRACTIONS = json';
    const { diagnostics } = runPipeline(JSON_RAW, META, props, '');
    expect(hasDupWarning(diagnostics)).toBe(true);
  });

  it('does NOT warn when KV_MODE = none is set alongside INDEXED_EXTRACTIONS=json', () => {
    const props = '[aws:cloudtrail]\nINDEXED_EXTRACTIONS = json\nKV_MODE = none';
    const { diagnostics } = runPipeline(JSON_RAW, META, props, '');
    expect(hasDupWarning(diagnostics)).toBe(false);
  });

  it('does NOT warn when AUTO_KV_JSON = false disables the search-time JSON re-extraction', () => {
    const props = '[aws:cloudtrail]\nINDEXED_EXTRACTIONS = json\nAUTO_KV_JSON = false';
    const { diagnostics } = runPipeline(JSON_RAW, META, props, '');
    expect(hasDupWarning(diagnostics)).toBe(false);
  });

  it('does NOT warn for delimited INDEXED_EXTRACTIONS (no search-time duplication)', () => {
    const csv = 'ts,action,user\n2024-01-15,login,alice';
    const props = '[csv:st]\nINDEXED_EXTRACTIONS = csv\nKV_MODE = json';
    const { diagnostics } = runPipeline(csv, { ...META, sourcetype: 'csv:st' }, props, '');
    expect(hasDupWarning(diagnostics)).toBe(false);
  });
});

describe('runPipeline — DEST_KEY validation (SEM-11)', () => {
  const PLAIN_META: EventMetadata = { index: 'main', host: '', source: '', sourcetype: 'st' };
  const props = '[st]\nTRANSFORMS-t = route';

  it('warns when DEST_KEY is not a recognised routing key', () => {
    const transforms = '[route]\nREGEX = (.*)\nDEST_KEY = made_up_key\nFORMAT = $1';
    const { diagnostics } = runPipeline('a log line', PLAIN_META, props, transforms);
    expect(diagnostics.some((d) => d.message.includes('not a recognised Splunk DEST_KEY'))).toBe(true);
  });

  it('warns that _TCP_ROUTING is valid but not simulated', () => {
    const transforms = '[route]\nREGEX = (.*)\nDEST_KEY = _TCP_ROUTING\nFORMAT = group1';
    const { diagnostics } = runPipeline('a log line', PLAIN_META, props, transforms);
    expect(diagnostics.some((d) => d.message.includes('not simulated'))).toBe(true);
  });

  it('does NOT warn for a documented key like queue', () => {
    const transforms = '[route]\nREGEX = (.*)\nDEST_KEY = queue\nFORMAT = indexQueue';
    const { diagnostics } = runPipeline('a log line', PLAIN_META, props, transforms);
    expect(diagnostics.some((d) => d.message.includes('DEST_KEY'))).toBe(false);
  });
});

describe('runPipeline — INGEST_EVAL is scoped to referencing stanzas (SEM-2)', () => {
  const PLAIN_META: EventMetadata = { index: 'main', host: '', source: '', sourcetype: 'st' };

  it('does NOT apply an INGEST_EVAL stanza that no props.conf stanza references', () => {
    const props = '[st]\n'; // no TRANSFORMS reference to the eval stanza
    const transforms = '[addtag]\nINGEST_EVAL = tag="prod"';
    const { result } = runPipeline('a log line', PLAIN_META, props, transforms);
    expect(result.events[0].fields.tag).toBeUndefined();
  });

  it('applies an INGEST_EVAL stanza when a TRANSFORMS-<class> references it', () => {
    const props = '[st]\nTRANSFORMS-t = addtag';
    const transforms = '[addtag]\nINGEST_EVAL = tag="prod"';
    const { result } = runPipeline('a log line', PLAIN_META, props, transforms);
    expect(result.events[0].fields.tag).toBe('prod');
  });
});
