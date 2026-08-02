import { describe, expect, it } from 'vitest';

import { interpretArticleSaveResult } from '../../src/toutiao/publisher/save-monitor.js';
import { ToutiaoCommandError } from '../../src/toutiao/types.js';

describe('interpretArticleSaveResult', () => {
  it('accepts successful save responses with pgc_id', () => {
    const result = interpretArticleSaveResult(
      'https://mp.toutiao.com/mp/agw/article/publish',
      {
        code: 0,
        message: 'success',
        data: { pgc_id: '1234567890' }
      }
    );

    expect(result.pgcId).toBe('1234567890');
    expect(result.code).toBe(0);
  });

  it('accepts micro-post draft responses with top-level gid', () => {
    const result = interpretArticleSaveResult(
      'https://mp.toutiao.com/mp/agw/draft/save_ugc_draft',
      {
        code: 0,
        gid: '1872428785810444',
        message: 'success'
      }
    );

    expect(result.pgcId).toBe('1872428785810444');
  });

  it('rejects 7050 save failures', () => {
    expect(() => interpretArticleSaveResult(
      'https://mp.toutiao.com/mp/agw/article/publish',
      {
        code: 7050,
        data: { pgc_id: '0' },
        err_no: 7050,
        message: '保存失败',
        reason: '保存失败'
      }
    )).toThrowError(ToutiaoCommandError);

    try {
      interpretArticleSaveResult('https://example.test', {
        code: 7050,
        data: { pgc_id: '0' },
        message: '保存失败'
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'TOUTIAO_PUBLISH_REJECTED'
      });
    }
  });

  it('rejects success-looking responses without a real pgc_id', () => {
    expect(() => interpretArticleSaveResult('https://example.test', {
      code: 0,
      data: { pgc_id: '0' },
      message: 'ok'
    })).toThrowError(ToutiaoCommandError);
  });
});
