/**
 * サイドバー — ラベル (プロジェクト) 管理 + タスク一覧。
 *   - ラベル: 追加/削除/クリックで絞り込みトグル
 *   - タスク: チェックボックスで完了切替、クリックで詳細パネル表示
 */
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { catchError, tap, EMPTY } from 'rxjs';
import { StoreService } from '../core/store.service';
import { Label, TaskItem } from '../core/models';
import { MdCheckbox, listCheckboxes, pad, toggleNthCheckbox } from '../core/util';
import { UiButtonComponent } from '../ui/button.component';
import { UiColorPaletteComponent } from '../ui/color-palette.component';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [FormsModule, UiButtonComponent, UiColorPaletteComponent],
  host: {
    class:
      'w-[295px] shrink-0 border-r border-cyber-lineStrong bg-cyber-panel ' +
      'flex flex-col overflow-y-auto p-3.5 gap-5',
  },
  template: `
    <!-- ラベル管理 -->
    <section>
      <div class="font-head text-sm tracking-[3px] uppercase mb-2 text-cyber-magenta
                  drop-shadow-[0_0_8px_rgb(var(--c-magenta)/0.6)]">
        // Labels
      </div>
      @for (label of store.labels(); track label.id) {
        <div
          class="flex items-center gap-2 px-2.5 py-2 cursor-pointer border text-sm
                 hover:bg-cyber-cyan/5"
          [class.border-cyber-cyan]="store.filterLabelId() === label.id"
          [class.border-transparent]="store.filterLabelId() !== label.id"
          [style.background]="store.filterLabelId() === label.id ? 'rgb(var(--c-cyan) / 0.10)' : null"
          (click)="store.setFilter(label.id)"
        >
          <span
            class="w-2.5 h-2.5 shrink-0 shadow-[0_0_6px_currentColor]"
            [style.background]="label.color"
            [style.color]="label.color"
          ></span>
          <span class="flex-1 truncate">{{ label.name }}</span>
          <button
            class="px-1 text-cyber-dim hover:text-cyber-cyan"
            title="名前と色を編集"
            (click)="startEdit(label, $event)"
          >✎</button>
          <button
            class="px-1 text-cyber-dim hover:text-cyber-red"
            title="削除"
            (click)="removeLabel(label.id, $event)"
          >×</button>
        </div>
        <!-- インライン編集 (名前 + 色パレット) -->
        @if (editId === label.id) {
          <div class="flex flex-col gap-1.5 px-2.5 py-2 border border-cyber-line"
               (click)="$event.stopPropagation()">
            <input
              type="text"
              class="input !px-2 !py-1.5 !text-xs"
              [(ngModel)]="editName"
              (keyup.enter)="saveEdit(label)"
            />
            <ui-color-palette [value]="editColor" (valueChange)="editColor = $event" />
            <div class="flex gap-1.5 justify-end">
              <ui-button (click)="editId = null">Cancel</ui-button>
              <ui-button variant="primary" [disabled]="!editName.trim()"
                         (click)="saveEdit(label)">Save</ui-button>
            </div>
          </div>
        }
      } @empty {
        <div class="text-xs text-cyber-dim">ラベルなし</div>
      }
      <!-- 新規ラベル追加 (色は視認性の高いプリセットパレットから選ぶ) -->
      <div class="flex flex-col gap-1.5 mt-2">
        <div class="flex gap-1.5">
          <input
            type="text"
            class="input flex-1 !px-2 !py-1.5 !text-xs"
            placeholder="新規ラベル"
            [(ngModel)]="newName"
            (keyup.enter)="addLabel()"
          />
          <ui-button (click)="addLabel()">+</ui-button>
        </div>
        <ui-color-palette [value]="newColor" (valueChange)="newColor = $event" />
      </div>
    </section>

    <!-- 同期カレンダー (フィード) の表示/非表示 -->
    @if (store.feeds().length > 0) {
      <section>
        <div class="font-head text-sm tracking-[3px] uppercase mb-2 text-cyber-magenta
                    drop-shadow-[0_0_8px_rgb(var(--c-magenta)/0.6)]">
          // Calendars
        </div>
        @for (feed of store.feeds(); track feed.id) {
          <label
            class="flex items-center gap-2 px-2.5 py-2 cursor-pointer text-sm select-none
                   hover:bg-cyber-cyan/5"
            [class.opacity-40]="store.hiddenFeedIds().has(feed.id)"
            [title]="store.hiddenFeedIds().has(feed.id) ? 'クリックで表示' : 'クリックで非表示'"
          >
            <input
              type="checkbox"
              [checked]="!store.hiddenFeedIds().has(feed.id)"
              (change)="store.toggleFeedVisibility(feed.id)"
            />
            <span
              class="w-2.5 h-2.5 shrink-0 border border-dotted shadow-[0_0_6px_currentColor]"
              [style.border-color]="feed.color"
              [style.color]="feed.color"
            ></span>
            <span class="flex-1 truncate">{{ feed.name }}</span>
          </label>
        }
      </section>
    }

    <!-- タスク一覧 -->
    <section>
      <div class="font-head text-sm tracking-[3px] uppercase mb-2 text-cyber-magenta
                  drop-shadow-[0_0_8px_rgb(var(--c-magenta)/0.6)]">
        // Tasks
      </div>
      @for (task of store.tasks(); track task.id) {
        <div
          class="flex items-baseline gap-2 px-2 py-2 cursor-pointer text-sm border-l-2
                 hover:bg-cyber-cyan/5"
          [class.opacity-45]="task.done"
          [class.line-through]="task.done"
          [style.border-left-color]="task.color ?? task.label?.color ?? 'transparent'"
          (click)="store.select({ kind: 'task', item: task })"
        >
          <!-- サブタスクがある場合のみ開閉キャレット (なければ幅を揃える空白) -->
          @if (subtasks(task).length) {
            <button
              class="shrink-0 w-3 text-center leading-none text-cyber-dim hover:text-cyber-cyan"
              [title]="isCollapsed(task.id) ? 'サブタスクを展開' : 'サブタスクを折りたたみ'"
              (click)="toggleCollapse(task.id, $event)"
            >{{ isCollapsed(task.id) ? '▸' : '▾' }}</button>
          } @else {
            <span class="shrink-0 w-3"></span>
          }
          <input type="checkbox" [checked]="task.done" (click)="toggleDone(task, $event)" />
          <span class="flex-1 truncate">{{ task.title }}</span>
          @if (task.due_at) {
            <span class="text-xs text-cyber-dim whitespace-nowrap ml-auto">
              {{ fmtDue(task.due_at) }}
            </span>
          }
        </div>
        <!-- md 内のチェックボックスをサブタスクとして表示 (折りたたみ中は隠す / クリックで反転) -->
        @if (!isCollapsed(task.id)) {
          @for (sub of subtasks(task); track $index) {
            <label
              class="flex items-baseline gap-2 pl-7 pr-2 py-1 cursor-pointer text-xs
                     text-cyber-dim hover:bg-cyber-cyan/5 select-none border-l-2
                     border-transparent"
              [class.line-through]="sub.checked"
              [class.opacity-50]="sub.checked"
              (click)="$event.stopPropagation()"
            >
              <input
                type="checkbox"
                [checked]="sub.checked"
                (change)="toggleSubtask(task, $index)"
              />
              <span class="flex-1 truncate">{{ sub.text }}</span>
            </label>
          }
        }
      } @empty {
        <div class="text-xs text-cyber-dim">タスクなし</div>
      }
    </section>

    <!-- ログアウト (最下部に配置) -->
    <section class="mt-auto pt-3 border-t border-cyber-line">
      <ui-button variant="danger" (click)="logout()">Logout</ui-button>
    </section>
  `,
})
export class SidebarComponent {
  store = inject(StoreService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  private router = inject(Router);

  /** ログアウトしてログイン画面へ遷移する */
  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  /** サブタスクを折りたたみ中の親タスク ID 集合 (既定は全展開) */
  private readonly collapsedTasks = signal<Set<number>>(new Set());

  /** 指定タスクのサブタスクが折りたたまれているか */
  isCollapsed(taskId: number): boolean {
    return this.collapsedTasks().has(taskId);
  }

  /** 親タスクのサブタスク表示を開閉する (行クリックの詳細表示は発火させない) */
  toggleCollapse(taskId: number, ev: MouseEvent): void {
    ev.stopPropagation();
    const next = new Set(this.collapsedTasks());
    next.has(taskId) ? next.delete(taskId) : next.add(taskId);
    this.collapsedTasks.set(next);
  }

  newName = '';
  newColor = '#00f0ff';

  // ラベルのインライン編集状態
  editId: number | null = null;
  editName = '';
  editColor = '#00f0ff';

  startEdit(label: Label, ev: MouseEvent): void {
    ev.stopPropagation();
    this.editId = label.id;
    this.editName = label.name;
    this.editColor = label.color;
  }

  /** 名前と色を保存する。通知設定は変更しないため既存値をそのまま送る (PUT は全項目必須) */
  saveEdit(label: Label): void {
    const name = this.editName.trim();
    if (!name) return;
    this.api.updateLabel(label.id, {
      name,
      color: this.editColor,
      notify_default: label.notify_default,
      notify_before_min_default: label.notify_before_min_default,
    }).pipe(
      tap(() => {
        this.editId = null;
        this.store.loadLabels();
        this.store.reload();
      }),
      catchError(() => {
        this.toast.error('ラベルの更新に失敗しました');
        return EMPTY;
      }),
    ).subscribe();
  }

  addLabel(): void {
    const name = this.newName.trim();
    if (!name) return;
    this.api.createLabel({ name, color: this.newColor }).pipe(
      tap(() => {
        this.newName = '';
        this.store.loadLabels();
        this.store.reload();
      }),
      catchError(() => {
        this.toast.error('ラベルの作成に失敗しました');
        return EMPTY;
      }),
    ).subscribe();
  }

  removeLabel(id: number, ev: MouseEvent): void {
    ev.stopPropagation();
    if (!confirm('このラベルを削除しますか？')) return;
    this.api.deleteLabel(id).pipe(
      tap(() => {
        if (this.store.filterLabelId() === id) this.store.filterLabelId.set(null);
        this.store.loadLabels();
        this.store.reload();
      }),
      catchError(() => {
        this.toast.error('ラベルの削除に失敗しました');
        return EMPTY;
      }),
    ).subscribe();
  }

  toggleDone(task: TaskItem, ev: MouseEvent): void {
    ev.stopPropagation(); // 行クリック (詳細表示) を発火させない
    this.api
      .updateTask(task.id, { done: !task.done })
      .pipe(
        catchError(() => {
          this.toast.error('完了状態の更新に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe((item) => this.store.syncSelected('task', item));
  }

  /** タスク本文 (md) からチェックボックスを抽出してサブタスクとして返す */
  subtasks(task: TaskItem): MdCheckbox[] {
    if (task.content_type !== 'md' || !task.content) return [];
    return listCheckboxes(task.content);
  }

  /** サブタスク (md チェックボックス) の完了状態を反転して保存する */
  toggleSubtask(task: TaskItem, index: number): void {
    const content = toggleNthCheckbox(task.content, index);
    if (content === null) return; // 本文が変わっていて対象が見つからない場合
    this.api
      .updateTask(task.id, { content })
      .pipe(
        catchError(() => {
          this.toast.error('サブタスクの更新に失敗しました');
          this.store.reload(); // チェック表示を元の状態へ戻す
          return EMPTY;
        }),
      )
      .subscribe((item) => this.store.syncSelected('task', item));
  }

  fmtDue(due: string): string {
    const d = new Date(due);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
