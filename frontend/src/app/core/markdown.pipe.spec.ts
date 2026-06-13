/** MarkdownPipe のユニットテスト — md 変換・チェックボックス活性化・XSS 対策 */
import { TestBed } from '@angular/core/testing';
import { MarkdownPipe } from './markdown.pipe';

/** SafeHtml から実際の HTML 文字列を取り出す (テスト用) */
const toHtml = (safe: unknown): string =>
  (safe as { changingThisBreaksApplicationSecurity: string })
    .changingThisBreaksApplicationSecurity;

describe('MarkdownPipe', () => {
  let pipe: MarkdownPipe;

  beforeEach(() => {
    pipe = TestBed.runInInjectionContext(() => new MarkdownPipe());
  });

  it('見出し・リスト・強調を HTML に変換する', () => {
    const html = toHtml(pipe.transform('# 見出し\n\n- 項目\n\n**強調**'));
    expect(html).toContain('<h1>見出し</h1>');
    expect(html).toContain('<li>項目</li>');
    expect(html).toContain('<strong>強調</strong>');
  });

  it('タスクリストの checkbox から disabled を外す (クリック可能にする)', () => {
    const html = toHtml(pipe.transform('- [ ] todo\n- [x] done'));
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('disabled');
    expect(html).toContain('checked'); // [x] はチェック済みで描画
  });

  it('script タグなどの危険な HTML を除去する (XSS 対策)', () => {
    const html = toHtml(pipe.transform('hello <script>alert(1)</script>'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('hello');
  });

  it('イベントハンドラ属性を除去する', () => {
    const html = toHtml(pipe.transform('<img src="x" onerror="alert(1)">'));
    expect(html).not.toContain('onerror');
  });

  it('null / undefined は空文字として扱う', () => {
    expect(toHtml(pipe.transform(null))).toBe('');
    expect(toHtml(pipe.transform(undefined))).toBe('');
  });
});
