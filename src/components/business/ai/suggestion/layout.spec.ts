import { describe, expect, it } from 'vitest';
import {
  estimateSuggestionChipWidth,
  getSuggestionVisualLength,
  groupSuggestionsByEstimatedWidth,
} from '@/components/business/ai/suggestion/layout';

describe('suggestion-layout', () => {
  it('按宽字符和 emoji 估算提示词视觉长度', () => {
    expect(getSuggestionVisualLength('abc')).toBe(3);
    expect(getSuggestionVisualLength('中文')).toBe(4);
    expect(getSuggestionVisualLength('A🙂')).toBe(3);
    expect(getSuggestionVisualLength('e\u0301')).toBe(1);
  });

  it('按目标宽度把提示词分成多行', () => {
    const rows = groupSuggestionsByEstimatedWidth(
      ['解释当前脚本', '修复 ShellCheck 报错', '生成提交说明', '总结运行失败原因'],
      {
        targetWidth: 260,
        fontAverageWidth: 8,
        chipHorizontalPadding: 32,
        chipGap: 12,
      },
    );

    expect(rows.length).toBeGreaterThan(1);
    expect(rows.flat()).toEqual([
      '解释当前脚本',
      '修复 ShellCheck 报错',
      '生成提交说明',
      '总结运行失败原因',
    ]);
  });

  it('为空白提示词做过滤且保持单个过宽提示词可独占一行', () => {
    const rows = groupSuggestionsByEstimatedWidth(['  ', '解释一个特别长的中文提示词并保留它'], {
      targetWidth: 120,
    });

    expect(rows).toEqual([['解释一个特别长的中文提示词并保留它']]);
    expect(estimateSuggestionChipWidth(rows[0]?.[0] ?? '', { maxChipWidth: 160 })).toBe(160);
  });
});
