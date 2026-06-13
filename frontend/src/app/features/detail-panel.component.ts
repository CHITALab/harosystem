/**
 * 詳細パネル — 画面右側に出るスライドイン表示。
 *   - 枠色は種別で変える: 予定=シアン / タスク=マゼンタ (左ボーダー)
 *   - md 内の "- [ ]" チェックボックスはクリックで ON/OFF を切替え、
 *     元の markdown 本文を書き換えてサーバーへ保存する (下記 onContentClick)
 *   - タスクは完了チェック、両者とも Edit/Delete が可能
 */
import { Component, Input, inject } from '@angular/core';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { catchError, tap, EMPTY } from 'rxjs';
import { MarkdownPipe } from '../core/markdown.pipe';
import { StoreService } from '../core/store.service';
import { EventItem, Selected, TaskItem } from '../core/models';
import { fmtDateTime, toggleNthCheckbox } from '../core/util';
import { UiBadgeComponent } from '../ui/badge.component';
import { UiButtonComponent } from '../ui/button.component';

@Component({
  selector: 'app-detail-panel',
  standalone: true,
  imports: [MarkdownPipe, UiBadgeComponent, UiButtonComponent],
  host: { class: 'contents' },
  template: `
    <aside
      class="w-[380px] shrink-0 bg-cyber-panel border-l-2 flex flex-col
             animate-[slide-in_0.15s_ease-out]"
      [class.border-cyber-cyan]="selected.kind === 'event'"
      [class.border-cyber-magenta]="selected.kind === 'task'"
    >
      <!-- ヘッダー: 種別バッジ + (タスクのみ) 完了トグル + 閉じる -->
      <div class="flex items-center gap-3 px-4 py-3 border-b border-cyber-lineStrong">
        <ui-badge [kind]="selected.kind" />
        @if (selected.kind === 'task') {
          <label class="flex items-center gap-1.5 text-sm cursor-pointer select-none"
                 [class.text-cyber-green]="task.done"
                 [class.text-cyber-dim]="!task.done">
            <input type="checkbox" [checked]="task.done" (change)="toggleDone()" />
            {{ task.done ? 'DONE' : 'OPEN' }}
          </label>
        }
        <button
          class="ml-auto text-xl text-cyber-dim hover:text-cyber-red px-1"
          title="閉じる"
          (click)="store.select(null)"
        >×</button>
      </div>

      <!-- 本文 -->
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0">
        <div class="text-lg font-bold leading-snug">{{ selected.item.title }}</div>

        <!-- メタ情報 (日時/作業時間/ラベル) -->
        <div class="flex flex-col gap-1 text-sm text-cyber-dim">
          @if (selected.kind === 'event') {
            @if (event.all_day) { <span>終日</span> }
            <span>開始: {{ fmt(event.start_at) }}</span>
            <span>終了: {{ fmt(event.end_at) }}</span>
          } @else {
            <span>期限: {{ task.due_at ? fmt(task.due_at) : 'なし' }}</span>
            @if (task.duration_min) {
              <span>作業時間: {{ fmtDuration(task.duration_min) }}</span>
            }
          }
          @if (selected.item.label; as label) {
            <span [style.color]="label.color">◈ {{ label.name }}</span>
          }
        </div>

        <!-- 内容 (md はクリックでチェックボックス連動) -->
        <div class="border-t border-cyber-line pt-3">
          @if (selected.item.content) {
            @if (selected.item.content_type === 'md') {
              <div class="md" [innerHTML]="selected.item.content | markdown"
                   (click)="onContentClick($event)"></div>
            } @else {
              <pre class="whitespace-pre-wrap text-sm">{{ selected.item.content }}</pre>
            }
          } @else {
            <span class="text-xs text-cyber-dim">内容なし</span>
          }
        </div>
      </div>

      <!-- フッター: 操作ボタン -->
      <div class="flex gap-2 px-4 py-3 border-t border-cyber-lineStrong">
        <ui-button variant="primary" (click)="edit()">Edit</ui-button>
        <ui-button variant="danger" (click)="remove()">Delete</ui-button>
      </div>
    </aside>
  `,
})
export class DetailPanelComponent {
  @Input({ required: true }) selected!: Selected;

  store = inject(StoreService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  // 判別共用体 Selected を各型として読むためのアクセサ
  get event(): EventItem {
    return this.selected.item as EventItem;
  }
  get task(): TaskItem {
    return this.selected.item as TaskItem;
  }

  fmt(iso: string): string {
    return fmtDateTime(new Date(iso));
  }

  fmtDuration(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? (m ? `${h}時間${m}分` : `${h}時間`) : `${m}分`;
  }

  /**
   * md 内チェックボックスのクリック処理。
   * 1. クリックされた要素がレンダリング済み md 内の checkbox か判定
   * 2. md コンテナ内で「何番目の checkbox か」を数える
   * 3. 元の markdown 文字列の同じ順番の "[ ]" / "[x]" をトグルして PUT 保存
   * これにより画面上のチェック操作がそのまま本文に永続化される。
   */
  onContentClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    e.preventDefault(); // 表示は保存成功後の再レンダリングで更新する

    const container = target.closest('.md');
    if (!container) return;
    const boxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    const index = boxes.indexOf(target);
    if (index < 0) return;

    const content = toggleNthCheckbox(this.selected.item.content ?? '', index);
    if (content === null) return;

    if (this.selected.kind === 'event') {
      this.api
        .updateEvent(this.selected.item.id, { content })
        .pipe(
          catchError(() => {
            this.toast.error('チェックボックスの更新に失敗しました');
            return EMPTY;
          }),
        )
        .subscribe((item) => this.store.afterMutation({ kind: 'event', item }));
    } else {
      this.api
        .updateTask(this.selected.item.id, { content })
        .pipe(
          catchError(() => {
            this.toast.error('チェックボックスの更新に失敗しました');
            return EMPTY;
          }),
        )
        .subscribe((item) => this.store.afterMutation({ kind: 'task', item }));
    }
  }

  toggleDone(): void {
    this.api
      .updateTask(this.task.id, { done: !this.task.done })
      .pipe(
        catchError(() => {
          this.toast.error('完了状態の更新に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe((item) => this.store.afterMutation({ kind: 'task', item }));
  }

  edit(): void {
    this.store.openForm({ kind: this.selected.kind, item: this.selected.item });
  }

  remove(): void {
    if (!confirm('削除しますか？')) return;
    const done = () => this.store.afterMutation(null); // パネルを閉じて再取得
    const handleError = catchError(() => {
      this.toast.error('削除に失敗しました');
      return EMPTY;
    });
    if (this.selected.kind === 'event') {
      this.api.deleteEvent(this.selected.item.id).pipe(handleError).subscribe(done);
    } else {
      this.api.deleteTask(this.selected.item.id).pipe(handleError).subscribe(done);
    }
  }
}
