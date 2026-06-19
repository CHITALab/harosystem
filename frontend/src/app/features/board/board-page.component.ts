/**
 * カンバンボード (/board) — タスクを Todo / In Progress / Done の 3 列で管理する軽量ビュー。
 *
 * 特徴 (要件: Jira のような多機能ではなく軽量):
 *   - 既存のタスクをそのまま列に並べ、HTML5 D&D で列間移動 → status を更新
 *   - status は done と相互同期する (done 列に置く = done=true)
 *   - ラベル / ノートで絞り込み可能 (既存のタスク・ノート機能と連動)
 *
 * D&D は月ビューと同じく HTML5 Drag and Drop API を使う (列間移動だけなのでシンプル)。
 *
 * データフロー (CLAUDE.md の 3 層):
 *   TaskApiService が Observable を返す → ここで pipe で整形 → Signal に反映。
 */
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EMPTY, catchError, of, tap } from 'rxjs';
import { TaskApiService } from '../../core/api';
import { StoreService } from '../../core/store.service';
import { ToastService } from '../../core/toast.service';
import { TaskItem } from '../../core/models';
import { pad } from '../../core/util';

type Status = 'todo' | 'in_progress' | 'done';

interface Column {
  key: Status;
  label: string;
  /** 見出しの色クラス (todo=シアン / 進行中=黄 / 完了=緑) */
  color: string;
}

@Component({
  selector: 'app-board-page',
  standalone: true,
  imports: [RouterLink],
  host: { class: 'flex flex-col h-screen bg-cyber-bg text-cyber-text' },
  template: `
    <!-- ヘッダー -->
    <header class="flex items-center gap-4 px-4 py-3 border-b border-cyber-lineStrong shrink-0 flex-wrap">
      <a routerLink="/" class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="カレンダーへ戻る">◄ CAL</a>
      <h1 class="font-head text-base tracking-[3px] uppercase text-cyber-cyan
                 drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.6)]">// Board</h1>

      <!-- 絞り込み -->
      <div class="flex items-center gap-1.5 ml-auto flex-wrap">
        <button
          class="text-xs px-2 py-1 border"
          [class.border-cyber-cyan]="filterLabelId() === null"
          [class.text-cyber-cyan]="filterLabelId() === null"
          [class.border-cyber-line]="filterLabelId() !== null"
          (click)="filterLabelId.set(null)"
        >全ラベル</button>
        @for (label of store.labels(); track label.id) {
          <button
            class="text-xs px-2 py-1 border flex items-center gap-1"
            [class.border-cyber-cyan]="filterLabelId() === label.id"
            [class.border-cyber-line]="filterLabelId() !== label.id"
            (click)="filterLabelId.set(label.id)"
          >
            <span class="w-2 h-2 shrink-0" [style.background]="label.color"></span>{{ label.name }}
          </button>
        }
        @if (store.notes().length) {
          <select class="input !py-1 !text-xs !w-auto ml-2"
                  [value]="filterNoteId() ?? ''"
                  (change)="onNoteFilter($event)">
            <option value="">全ノート</option>
            @for (note of store.notes(); track note.id) {
              <option [value]="note.id">🔗 {{ note.title }}</option>
            }
          </select>
        }
      </div>
    </header>

    <!-- 3 列 -->
    <div class="flex-1 flex gap-3 p-3 min-h-0 overflow-x-auto">
      @for (col of columns; track col.key) {
        <section
          class="flex-1 min-w-[260px] flex flex-col border border-cyber-line bg-cyber-panel min-h-0"
          (dragover)="$event.preventDefault()"
          (drop)="onDrop($event, col.key)"
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-cyber-line shrink-0">
            <span class="font-head text-sm tracking-[2px] uppercase" [class]="col.color">{{ col.label }}</span>
            <span class="text-xs text-cyber-dim ml-auto">{{ tasksOf(col.key).length }}</span>
          </div>

          <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            @for (task of tasksOf(col.key); track task.id) {
              <article
                class="px-2.5 py-2 border-l-2 bg-cyber-bg3 cursor-grab text-sm
                       hover:brightness-125 select-none"
                draggable="true"
                [style.border-left-color]="task.color ?? task.label?.color ?? 'transparent'"
                (dragstart)="onDragStart($event, task.id)"
              >
                <div class="truncate" [class.line-through]="task.done" [class.opacity-50]="task.done">
                  {{ task.title }}
                </div>
                <div class="flex items-center gap-2 text-[11px] text-cyber-dim mt-1 flex-wrap">
                  @if (task.label) {
                    <span class="flex items-center gap-1">
                      <span class="w-2 h-2 shrink-0" [style.background]="task.label.color"></span>
                      {{ task.label.name }}
                    </span>
                  }
                  @if (noteTitle(task.note_id); as nt) {
                    <span class="truncate max-w-[120px]" [title]="nt">🔗 {{ nt }}</span>
                  }
                  @if (task.due_at) {
                    <span class="ml-auto whitespace-nowrap">{{ fmtDue(task.due_at) }}</span>
                  }
                </div>
              </article>
            } @empty {
              <div class="text-xs text-cyber-dim px-1 py-2">なし</div>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class BoardPageComponent {
  store = inject(StoreService);
  private taskApi = inject(TaskApiService);
  private toast = inject(ToastService);

  readonly columns: Column[] = [
    { key: 'todo', label: 'Todo', color: 'text-cyber-cyan' },
    { key: 'in_progress', label: 'In Progress', color: 'text-cyber-yellow' },
    { key: 'done', label: 'Done', color: 'text-cyber-green' },
  ];

  /** 全タスク (期間フィルタなし) */
  private readonly allTasks = signal<TaskItem[]>([]);
  /** ラベル絞り込み (null = すべて) */
  readonly filterLabelId = signal<number | null>(null);
  /** ノート絞り込み (null = すべて) */
  readonly filterNoteId = signal<number | null>(null);

  /** 絞り込みを適用したタスク */
  private readonly filtered = computed(() => {
    const labelId = this.filterLabelId();
    const noteId = this.filterNoteId();
    return this.allTasks().filter(
      (t) =>
        (labelId == null || t.label_id === labelId) &&
        (noteId == null || t.note_id === noteId),
    );
  });

  ngOnInit(): void {
    this.store.loadLabels();
    this.store.loadNotes();
    this.load();
  }

  /** ボード用に全タスクを取得する */
  private load(): void {
    this.taskApi
      .getAllTasks()
      .pipe(
        catchError(() => {
          this.toast.error('タスクの取得に失敗しました');
          return of([] as TaskItem[]);
        }),
      )
      .subscribe((tasks) => this.allTasks.set(tasks));
  }

  /** 指定ステータスの列に並べるタスク */
  tasksOf(status: Status): TaskItem[] {
    return this.filtered().filter((t) => t.status === status);
  }

  /** ノート ID からタイトルを引く (なければ null) */
  noteTitle(noteId: number | null): string | null {
    if (noteId == null) return null;
    return this.store.notes().find((n) => n.id === noteId)?.title ?? null;
  }

  onNoteFilter(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterNoteId.set(v ? Number(v) : null);
  }

  // ---- D&D: 列間移動でステータス変更 ----
  onDragStart(e: DragEvent, taskId: number): void {
    e.dataTransfer?.setData('text/plain', String(taskId));
  }

  onDrop(e: DragEvent, status: Status): void {
    e.preventDefault();
    const id = Number(e.dataTransfer?.getData('text/plain'));
    const task = this.allTasks().find((t) => t.id === id);
    if (!task || task.status === status) return;
    this.taskApi
      .updateTask(id, { status })
      .pipe(
        // サーバーが done も同期して返すので、返り値でローカルを置き換える
        tap((updated) =>
          this.allTasks.update((list) => list.map((t) => (t.id === updated.id ? updated : t))),
        ),
        catchError(() => {
          this.toast.error('ステータスの更新に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  /** ISO 文字列を M/D HH:MM 形式に整形する */
  fmtDue(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
