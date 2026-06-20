/**
 * アクティブボード (/board) — 進行中スプリントのタスクを Todo / In Progress / Done で管理。
 *
 * Jira のアクティブスプリントボード相当。表示するのは state==='active' のスプリントに
 * 属するタスクのみ。アクティブなスプリントが無い場合はバックログ画面へ誘導する。
 *
 * 操作:
 *   - カードを列間ドラッグ → status を更新 (done と相互同期)
 *   - 列の空白をダブルクリック → その列のステータスでインライン作成
 *
 * D&D は月ビュー同様 HTML5 Drag and Drop API。
 * データフロー (CLAUDE.md): Api が Observable を返す → pipe で整形 → Signal 反映。
 */
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, catchError, forkJoin, of, tap } from 'rxjs';
import { SprintApiService, TaskApiService } from '../../core/api';
import { StoreService } from '../../core/store.service';
import { ToastService } from '../../core/toast.service';
import { Sprint, TaskItem } from '../../core/models';
import { pad } from '../../core/util';
import { UiButtonComponent } from '../../ui/button.component';

type Status = 'todo' | 'in_progress' | 'done';

interface Column {
  key: Status;
  label: string;
  color: string;
}

@Component({
  selector: 'app-board-page',
  standalone: true,
  imports: [FormsModule, RouterLink, UiButtonComponent],
  host: { class: 'flex flex-col h-screen bg-cyber-bg text-cyber-text' },
  template: `
    <header class="flex items-center gap-4 px-4 py-3 border-b border-cyber-lineStrong shrink-0 flex-wrap">
      <a routerLink="/" class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="カレンダーへ戻る">◄ CAL</a>
      <h1 class="font-head text-base tracking-[3px] uppercase text-cyber-cyan
                 drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.6)]">// Board</h1>
      <a routerLink="/backlog"
         class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="バックログ/スプリント計画">BACKLOG ►</a>

      @if (activeSprint(); as sp) {
        <div class="flex items-center gap-2 ml-2">
          <span class="text-sm text-cyber-text">{{ sp.name }}</span>
          @if (sp.start_date || sp.end_date) {
            <span class="text-[11px] text-cyber-dim">{{ dateRange(sp) }}</span>
          }
        </div>
        <div class="ml-auto">
          <ui-button (click)="completeActive(sp)">スプリント完了</ui-button>
        </div>
      }
    </header>

    @if (activeSprint(); as sp) {
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

            <!-- 空白ダブルクリックでインライン作成 -->
            <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2"
                 (dblclick)="startCreate(col.key, $event)">
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
                    @if (task.start_at) {
                      <span class="ml-auto whitespace-nowrap">{{ fmtDue(task.start_at) }}</span>
                    }
                  </div>
                </article>
              }

              <!-- インライン作成フォーム -->
              @if (creatingIn() === col.key) {
                <input
                  #createInput
                  class="input !text-sm"
                  placeholder="タイトルを入力して Enter"
                  [(ngModel)]="newTitle"
                  (keyup.enter)="commitCreate(col.key)"
                  (keyup.escape)="cancelCreate()"
                  (blur)="cancelCreate()"
                />
              } @else if (tasksOf(col.key).length === 0) {
                <div class="text-xs text-cyber-dim px-1 py-2">空白をダブルクリックで作成</div>
              }
            </div>
          </section>
        }
      </div>
    } @else {
      <!-- アクティブスプリントなし -->
      <div class="flex-1 flex flex-col items-center justify-center gap-3 text-cyber-dim">
        <p class="text-sm">アクティブなスプリントがありません</p>
        <a routerLink="/backlog">
          <ui-button variant="primary">バックログでスプリントを開始</ui-button>
        </a>
      </div>
    }
  `,
})
export class BoardPageComponent {
  store = inject(StoreService);
  private sprintApi = inject(SprintApiService);
  private taskApi = inject(TaskApiService);
  private toast = inject(ToastService);

  readonly columns: Column[] = [
    { key: 'todo', label: 'Todo', color: 'text-cyber-cyan' },
    { key: 'in_progress', label: 'In Progress', color: 'text-cyber-yellow' },
    { key: 'done', label: 'Done', color: 'text-cyber-green' },
  ];

  private readonly allTasks = signal<TaskItem[]>([]);
  readonly activeSprint = signal<Sprint | null>(null);

  /** インライン作成中の列 (null = なし) */
  readonly creatingIn = signal<Status | null>(null);
  newTitle = '';
  private readonly createInput = viewChild<ElementRef<HTMLInputElement>>('createInput');

  /** アクティブスプリントに属するタスク */
  private readonly sprintTasks = computed(() => {
    const sp = this.activeSprint();
    if (!sp) return [];
    return this.allTasks().filter((t) => t.sprint_id === sp.id);
  });

  ngOnInit(): void {
    this.store.loadLabels();
    this.store.loadNotes();
    this.load();
  }

  /** アクティブスプリントと全タスクを取得する */
  private load(): void {
    forkJoin({
      sprints: this.sprintApi.getSprints(),
      tasks: this.taskApi.getAllTasks(),
    })
      .pipe(
        catchError(() => {
          this.toast.error('ボードの取得に失敗しました');
          return of({ sprints: [] as Sprint[], tasks: [] as TaskItem[] });
        }),
      )
      .subscribe(({ sprints, tasks }) => {
        this.activeSprint.set(sprints.find((s) => s.state === 'active') ?? null);
        this.allTasks.set(tasks);
      });
  }

  tasksOf(status: Status): TaskItem[] {
    return this.sprintTasks().filter((t) => t.status === status);
  }

  noteTitle(noteId: number | null): string | null {
    if (noteId == null) return null;
    return this.store.notes().find((n) => n.id === noteId)?.title ?? null;
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
        tap((updated) => this.replaceTask(updated)),
        catchError(() => {
          this.toast.error('ステータスの更新に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  // ---- インライン作成 ----
  startCreate(status: Status, ev: Event): void {
    // カード上のダブルクリックでは発火させない (空白のみ)
    if ((ev.target as HTMLElement).closest('article')) return;
    this.newTitle = '';
    this.creatingIn.set(status);
    // 入力欄が描画された後にフォーカス
    setTimeout(() => this.createInput()?.nativeElement.focus());
  }

  commitCreate(status: Status): void {
    const title = this.newTitle.trim();
    const sp = this.activeSprint();
    if (!title || !sp) {
      this.cancelCreate();
      return;
    }
    this.taskApi
      .createTask({ title, status, sprint_id: sp.id })
      .pipe(
        tap((created) => {
          this.allTasks.update((list) => [...list, created]);
          // 連続作成できるよう入力欄は開いたまま、値だけクリア
          this.newTitle = '';
          setTimeout(() => this.createInput()?.nativeElement.focus());
        }),
        catchError(() => {
          this.toast.error('タスクの作成に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  cancelCreate(): void {
    this.creatingIn.set(null);
    this.newTitle = '';
  }

  completeActive(sprint: Sprint): void {
    if (!confirm(`スプリント「${sprint.name}」を完了しますか？`)) return;
    this.sprintApi
      .completeSprint(sprint.id)
      .pipe(
        tap(() => {
          this.toast.success('スプリントを完了しました');
          // サーバー状態と同期するため再取得 (activeSprint と allTasks を更新)
          this.load();
        }),
        catchError(() => {
          this.toast.error('スプリントの完了に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  private replaceTask(t: TaskItem): void {
    this.allTasks.update((list) => list.map((x) => (x.id === t.id ? t : x)));
  }

  dateRange(sp: Sprint): string {
    const f = (iso: string | null) => (iso ? `${new Date(iso).getMonth() + 1}/${new Date(iso).getDate()}` : '');
    return `${f(sp.start_date)} – ${f(sp.end_date)}`;
  }

  fmtDue(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
