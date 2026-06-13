/**
 * Markdown -> 安全な HTML へ変換するパイプ。
 *   marked     : GFM (テーブル・タスクリスト等) 対応の Markdown パーサ
 *   DOMPurify  : XSS 対策のサニタイズ
 *
 * 使い方: <div class="md" [innerHTML]="content | markdown"></div>
 * 見た目は styles.scss の `.md` セクションで定義している。
 */
import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    let html = marked.parse(value ?? '', { async: false }) as string;
    // marked はタスクリストのチェックボックスを disabled で出力するが、
    // 本アプリではクリックで内容を更新できるようにするため外す。
    // 属性順は項目により異なる (checked="" disabled="" など) ため
    // <input ...> 内の disabled だけを取り除く。
    // (クリック処理は detail-panel.component.ts を参照)
    html = html.replace(/(<input[^>]*?)\s*disabled=""/g, '$1');
    return this.sanitizer.bypassSecurityTrustHtml(DOMPurify.sanitize(html));
  }
}
