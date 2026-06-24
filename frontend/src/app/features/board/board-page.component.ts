/**
 * アクティブボード (/board) — 選択ラベルの進行中スプリントを Todo / In Progress / Done で管理。
 *
 * Jira のアクティブスプリントボード相当:
 *   - ヘッダーのラベルセレクタで「プロジェクト(ラベル)」を切り替え (単一選択 / 未分類あり)
 *   - 表示するのは選択ラベルの state==='active' スプリントに属するタスクのみ
 *   - カードクリック → カレンダーと同じ詳細パネル。詳細パネルのタイトル/本文ダブルクリックで編集
 *   - 列の空白をダブルクリック → その列の status + スプリントを持つタスク作成フォームを開く
 *   - カードを列間ドラッグ → status を更新 (done と相互同期)
 *
 * タスク変更は共有の詳細パネル/フォーム経由で StoreService に集約し、
 * store.tasksVersion の変化で再取得する (画面間で状態が食い違わない)。
 */
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, catchError, forkJoin, of, tap } from 'rxjs';
import { SprintApiService, TaskApiService } from '../../core/api';
import { StoreService } from '../../core/store.service';
import { ToastService } from '../../core/toast.service';
import { Sprint, TaskItem } from '../../core/models';
import { pad } from '../../core/util';
import { UiButtonComponent } from '../../ui/button.component';
import { DetailPanelComponent } from '../detail-panel.component';
import { ItemFormComponent } from '../item-form.component';

type Status = 'todo' | 'in_progress' | 'done';

interface Column {
  key: Status;
  label: string;
  color: string;
}

@Component({
  selector: 'app-board-page',
  standalone: true,
  imports: [FormsModule, RouterLink, UiButtonComponent, DetailPanelComponent, ItemFormComponent],
  host: { class: 'flex flex-col h-screen bg-cyber-bg text-cyber-text' },
  template: `
    <header class="flex items-center gap-3 px-4 py-3 border-b border-cyber-lineStrong shrink-0 flex-wrap">
      <a routerLink="/" class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="カレンダーへ戻る">◄ CAL</a>
      <h1 class="font-head text-base tracking-[3px] uppercase text-cyber-cyan
                 drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.6)]">// Board</h1>
      <a routerLink="/backlog"
         class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="バックログ/スプリント計画">BACKLOG ►</a>

      <!-- ラベル (プロジェクト) セレクタ -->
      <label class="flex items-center gap-1.5 text-xs text-cyber-dim uppercase tracking-wider ml-2">
        ラベル
        <select class="input !py-1 !text-sm" [ngModel]="selectedLabelId()"
                (ngModelChange)="selectedLabelId.set($event)">
          @for (label of store.labels(); track label.id) {
            <option [ngValue]="label.id">{{ label.name }}</option>
          }
          <option [ngValue]="null">（未分類）</option>
        </select>
      </label>

      @if (activeSprint(); as sp) {
        <div class="flex items-center gap-2">
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

    <div class="flex-1 flex min-h-0">
      <div class="flex-1 flex flex-col min-w-0 min-h-0">
        @if (activeSprint(); as sp) {
          <div class="flex-1 flex gap-3 p-3 min-h-0 overflow-x-auto">
            @for (col of columns; track col.key) {
              <section
                class="flex-1 min-w-[240px] flex flex-col border border-cyber-line bg-cyber-panel min-h-0"
                (dragover)="$event.preventDefault()"
                (drop)="onDrop($event, col.key)"
              >
                <div class="flex items-center gap-2 px-3 py-2 border-b border-cyber-line shrink-0">
                  <span class="font-head text-sm tracking-[2px] uppercase" [class]="col.color">{{ col.label }}</span>
                  <span class="text-xs text-cyber-dim ml-auto">{{ tasksOf(col.key).length }}</span>
                </div>

                <!-- 空白ダブルクリックで作成フォームを開く -->
                <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2"
                     (dblclick)="createIn(col.key, sp, $event)">
                  @for (task of tasksOf(col.key); track task.id) {
                    <article
                      class="px-2.5 py-2 border-l-2 bg-cyber-bg3 cursor-pointer text-sm
                             hover:brightness-125 select-none"
                      [class.outline]="isSelected(task.id)"
                      [class.outline-1]="isSelected(task.id)"
                      [style.outline-color]="isSelected(task.id) ? 'rgb(var(--c-cyan))' : null"
                      [style.border-left-color]="task.color ?? task.label?.color ?? 'transparent'"
                      draggable="true"
                      (dragstart)="onDragStart($event, task.id)"
                      (click)="select(task)"
                    >
                      <div class="truncate" [class.line-through]="task.done" [class.opacity-50]="task.done">
                        {{ task.title }}
                      </div>
                      <div class="flex items-center gap-2 text-[11px] text-cyber-dim mt-1 flex-wrap">
                        @if (noteTitle(task.note_id); as nt) {
                          <span class="truncate max-w-[120px]" [title]="nt">🔗 {{ nt }}</span>
                        }
                        @if (task.start_at) {
                          <span class="ml-auto whitespace-nowrap">{{ fmtDue(task.start_at) }}</span>
                        }
                      </div>
                    </article>
                  } @empty {
                    <div class="text-xs text-cyber-dim px-1 py-2">空白をダブルクリックで作成</div>
                  }
                </div>
              </section>
            }
          </div>
        } @else {
          <div class="flex-1 flex flex-col items-center justify-center gap-3 text-cyber-dim">
            <p class="text-sm">このラベルにはアクティブなスプリントがありません</p>
            <a routerLink="/backlog">
              <ui-button variant="primary">バックログでスプリントを開始</ui-button>
            </a>
          </div>
        }
      </div>

      <!-- 詳細パネル (カレンダーと共通) -->
      @if (store.selected(); as sel) {
        <app-detail-panel [selected]="sel" />
      }
    </div>

    <!-- 作成/編集フォーム (カレンダーと共通) -->
    @if (store.form()) {
      <app-item-form />
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

  /** 選択中のラベル (null = 未分類)。store 共有で /board・/backlog 間 + リロードをまたいで保持 */
  readonly selectedLabelId = this.store.boardLabelId;

  private readonly allTasks = signal<TaskItem[]>([]);
  readonly sprints = signal<Sprint[]>([]);
  readonly activeSprint = () => this.sprints().find((s) => s.state === 'active') ?? null;

  constructor() {
    // ラベル選択 / タスク変更 (tasksVersion) のたびにボードを再取得する
    effect(() => {
      this.store.tasksVersion(); // 依存登録 (共有フォーム/パネルの変更で再取得)
      this.load(this.selectedLabelId());
    });
  }

  ngOnInit(): void {
    this.store.loadLabels();
    this.store.loadNotes();
  }

  /** 選択ラベルのスプリントと全タスクを取得する */
  private load(labelId: number | null): void {
    forkJoin({
      sprints: this.sprintApi.getSprints(labelId),
      tasks: this.taskApi.getAllTasks(),
    })
      .pipe(
        catchError(() => {
          this.toast.error('ボードの取得に失敗しました');
          return of({ sprints: [] as Sprint[], tasks: [] as TaskItem[] });
        }),
      )
      .subscribe(({ sprints, tasks }) => {
        this.sprints.set(sprints);
        this.allTasks.set(tasks);
      });
  }

  /** アクティブスプリント所属の、指定ステータスのタスク。
   *  スプリント自体が選択ラベルで絞り込まれているため、タスクの label_id では
   *  絞り込まない (別ラベル/未ラベルの旧データも所属スプリントで正しく拾う)。 */
  tasksOf(status: Status): TaskItem[] {
    const sp = this.activeSprint();
    if (!sp) return [];
    return this.allTasks().filter((t) => t.sprint_id === sp.id && t.status === status);
  }

  isSelected(taskId: number): boolean {
    const sel = this.store.selected();
    return !!sel && sel.kind === 'task' && sel.item.id === taskId;
  }

  noteTitle(noteId: number | null): string | null {
    if (noteId == null) return null;
    return this.store.notes().find((n) => n.id === noteId)?.title ?? null;
  }

  /** カードクリックで詳細パネルを開く */
  select(task: TaskItem): void {
    this.store.select({ kind: 'task', item: task });
  }

  /** 列の空白ダブルクリックで作成フォームを開く (その列の status + スプリント) */
  createIn(status: Status, sprint: Sprint, ev: Event): void {
    if ((ev.target as HTMLElement).closest('article')) return; // カード上は無視
    this.store.openForm({
      kind: 'task',
      prefillStatus: status,
      prefillSprintId: sprint.id,
      prefillLabelId: this.selectedLabelId(),
    });
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
        // 共有ストア経由で同期 (詳細パネル更新 + tasksVersion で本画面も再取得)
        tap((updated) => this.store.syncSelected('task', updated)),
        catchError(() => {
          this.toast.error('ステータスの更新に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  completeActive(sprint: Sprint): void {
    if (!confirm(`スプリント「${sprint.name}」を完了しますか？`)) return;
    this.sprintApi
      .completeSprint(sprint.id)
      .pipe(
        tap(() => {
          this.toast.success('スプリントを完了しました');
          this.load(this.selectedLabelId());
        }),
        catchError(() => {
          this.toast.error('スプリントの完了に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  dateRange(sp: Sprint): string {
    const f = (iso: string | null) =>
      iso ? `${new Date(iso).getMonth() + 1}/${new Date(iso).getDate()}` : '';
    return `${f(sp.start_date)} – ${f(sp.end_date)}`;
  }

  fmtDue(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
