/**
 * バックログ画面 (/backlog) — Jira 風のバックログ & スプリント計画。
 *
 * 縦積みのリストビュー:
 *   - 各スプリント (planned/active/completed) のセクション
 *   - 末尾に「Backlog」プール (sprint_id IS NULL のタスク)
 * タスク行を別セクションへドラッグ&ドロップして計画を立てる (sprint_id を更新)。
 * 各セクションでインライン作成、スプリントの作成 / 開始 / 完了 / 削除も行える。
 *
 * 並び替えはセクション間の移動のみ (リスト内の手動並び替えは対象外)。
 * データフロー (CLAUDE.md): Api が Observable を返す → pipe で整形 → Signal 反映。
 */
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, catchError, forkJoin, of, tap } from 'rxjs';
import { SprintApiService, TaskApiService } from '../../core/api';
import { StoreService } from '../../core/store.service';
import { ToastService } from '../../core/toast.service';
import { Sprint, TaskItem } from '../../core/models';
import { pad } from '../../core/util';
import { UiButtonComponent } from '../../ui/button.component';

/** ステータスごとのバッジ色 */
const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  backlog: { label: 'Backlog', color: 'text-cyber-dim' },
  todo: { label: 'Todo', color: 'text-cyber-cyan' },
  in_progress: { label: 'In Progress', color: 'text-cyber-yellow' },
  done: { label: 'Done', color: 'text-cyber-green' },
};

@Component({
  selector: 'app-backlog-page',
  standalone: true,
  imports: [FormsModule, RouterLink, UiButtonComponent, NgTemplateOutlet],
  host: { class: 'flex flex-col h-screen bg-cyber-bg text-cyber-text' },
  template: `
    <header class="flex items-center gap-4 px-4 py-3 border-b border-cyber-lineStrong shrink-0 flex-wrap">
      <a routerLink="/" class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="カレンダーへ戻る">◄ CAL</a>
      <h1 class="font-head text-base tracking-[3px] uppercase text-cyber-cyan
                 drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.6)]">// Backlog</h1>
      <a routerLink="/board"
         class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="アクティブボード">BOARD ►</a>

      <!-- スプリント作成 -->
      <div class="flex items-center gap-2 ml-auto flex-wrap">
        <input class="input !py-1 !text-sm" placeholder="新規スプリント名" [(ngModel)]="newSprintName"
               (keyup.enter)="createSprint()" />
        <input type="date" class="input !py-1 !text-sm" [(ngModel)]="newStart" title="開始日" />
        <input type="date" class="input !py-1 !text-sm" [(ngModel)]="newEnd" title="終了日" />
        <ui-button variant="primary" [disabled]="!newSprintName.trim()" (click)="createSprint()">
          ＋ スプリント
        </ui-button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3 max-w-4xl w-full mx-auto">
      <!-- スプリントごとのセクション -->
      @for (sp of sprints(); track sp.id) {
        <section
          class="border border-cyber-line bg-cyber-panel"
          (dragover)="$event.preventDefault()"
          (drop)="onDrop($event, sp.id)"
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-cyber-line flex-wrap">
            <span class="font-head text-sm tracking-[2px] text-cyber-text">{{ sp.name }}</span>
            <span class="text-[11px] uppercase px-1.5 py-0.5 border" [class]="stateColor(sp.state)">
              {{ sp.state }}
            </span>
            @if (sp.start_date || sp.end_date) {
              <span class="text-[11px] text-cyber-dim">{{ dateRange(sp) }}</span>
            }
            <span class="text-xs text-cyber-dim">{{ tasksOf(sp.id).length }} 件</span>
            <div class="ml-auto flex items-center gap-1.5">
              @if (sp.state === 'planned') {
                <ui-button (click)="start(sp)">開始</ui-button>
              }
              @if (sp.state === 'active') {
                <ui-button (click)="complete(sp)">完了</ui-button>
              }
              <ui-button variant="danger" (click)="remove(sp)">削除</ui-button>
            </div>
          </div>

          <div class="p-2 flex flex-col gap-1.5 min-h-[44px]">
            @for (task of tasksOf(sp.id); track task.id) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: task }" />
            } @empty {
              <div class="text-xs text-cyber-dim px-1 py-1.5">タスクをここにドラッグ</div>
            }
            @if (creatingIn() === sp.id) {
              <input #createInput class="input !text-sm" placeholder="タイトルを入力して Enter"
                     [(ngModel)]="newTitle" (keyup.enter)="commitCreate(sp.id)"
                     (keyup.escape)="cancelCreate()" (blur)="cancelCreate()" />
            } @else {
              <button type="button" class="text-xs text-cyber-dim hover:text-cyber-cyan text-left px-1 py-1"
                      (click)="startCreate(sp.id)">＋ タスク追加</button>
            }
          </div>
        </section>
      }

      <!-- バックログプール (sprint_id null) -->
      <section
        class="border border-cyber-lineStrong bg-cyber-panel"
        (dragover)="$event.preventDefault()"
        (drop)="onDrop($event, null)"
      >
        <div class="flex items-center gap-2 px-3 py-2 border-b border-cyber-line">
          <span class="font-head text-sm tracking-[2px] uppercase text-cyber-magenta">// Backlog</span>
          <span class="text-xs text-cyber-dim ml-auto">{{ tasksOf(null).length }} 件</span>
        </div>
        <div class="p-2 flex flex-col gap-1.5 min-h-[44px]">
          @for (task of tasksOf(null); track task.id) {
            <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: task }" />
          } @empty {
            <div class="text-xs text-cyber-dim px-1 py-1.5">未着手のタスクをここにプール</div>
          }
          @if (creatingIn() === 'backlog') {
            <input #createInput class="input !text-sm" placeholder="タイトルを入力して Enter"
                   [(ngModel)]="newTitle" (keyup.enter)="commitCreate(null)"
                   (keyup.escape)="cancelCreate()" (blur)="cancelCreate()" />
          } @else {
            <button type="button" class="text-xs text-cyber-dim hover:text-cyber-cyan text-left px-1 py-1"
                    (click)="startCreate('backlog')">＋ タスク追加</button>
          }
        </div>
      </section>
    </div>

    <!-- タスク行テンプレート (スプリント/バックログ共通) -->
    <ng-template #row let-task>
      <article
        class="flex items-center gap-2 px-2.5 py-1.5 border-l-2 bg-cyber-bg3 cursor-grab text-sm
               hover:brightness-125 select-none"
        draggable="true"
        [style.border-left-color]="task.color ?? task.label?.color ?? 'transparent'"
        (dragstart)="onDragStart($event, task.id)"
      >
        <span class="flex-1 truncate" [class.line-through]="task.done" [class.opacity-50]="task.done">
          {{ task.title }}
        </span>
        <span class="text-[10px] uppercase tracking-wider shrink-0" [class]="badge(task.status).color">
          {{ badge(task.status).label }}
        </span>
        @if (task.label) {
          <span class="w-2 h-2 shrink-0" [style.background]="task.label.color" [title]="task.label.name"></span>
        }
        @if (task.start_at) {
          <span class="text-[11px] text-cyber-dim whitespace-nowrap shrink-0">{{ fmtDue(task.start_at) }}</span>
        }
      </article>
    </ng-template>
  `,
  // ng-template に *ngTemplateOutlet を使うため CommonModule の機能が必要
})
export class BacklogPageComponent {
  store = inject(StoreService);
  private sprintApi = inject(SprintApiService);
  private taskApi = inject(TaskApiService);
  private toast = inject(ToastService);

  readonly sprints = signal<Sprint[]>([]);
  private readonly allTasks = signal<TaskItem[]>([]);

  // スプリント作成フォーム
  newSprintName = '';
  newStart = '';
  newEnd = '';

  // インライン作成 (sprintId: number か 'backlog')
  readonly creatingIn = signal<number | 'backlog' | null>(null);
  newTitle = '';
  private readonly createInput = viewChild<ElementRef<HTMLInputElement>>('createInput');

  ngOnInit(): void {
    this.store.loadLabels();
    this.load();
  }

  private load(): void {
    forkJoin({
      sprints: this.sprintApi.getSprints(),
      tasks: this.taskApi.getAllTasks(),
    })
      .pipe(
        catchError(() => {
          this.toast.error('バックログの取得に失敗しました');
          return of({ sprints: [] as Sprint[], tasks: [] as TaskItem[] });
        }),
      )
      .subscribe(({ sprints, tasks }) => {
        this.sprints.set(sprints);
        this.allTasks.set(tasks);
      });
  }

  /** 指定スプリント (null = バックログプール) に属するタスク */
  tasksOf(sprintId: number | null): TaskItem[] {
    return this.allTasks().filter((t) => t.sprint_id === sprintId);
  }

  badge(status: string) {
    return STATUS_BADGE[status] ?? STATUS_BADGE['todo'];
  }

  // ---- D&D: セクション間移動で sprint_id を更新 ----
  onDragStart(e: DragEvent, taskId: number): void {
    e.dataTransfer?.setData('text/plain', String(taskId));
  }

  onDrop(e: DragEvent, sprintId: number | null): void {
    e.preventDefault();
    const id = Number(e.dataTransfer?.getData('text/plain'));
    const task = this.allTasks().find((t) => t.id === id);
    if (!task || task.sprint_id === sprintId) return;
    this.taskApi
      .updateTask(id, { sprint_id: sprintId })
      .pipe(
        tap((updated) => this.replaceTask(updated)),
        catchError(() => {
          this.toast.error('タスクの移動に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  // ---- インライン作成 ----
  startCreate(target: number | 'backlog'): void {
    this.newTitle = '';
    this.creatingIn.set(target);
    setTimeout(() => this.createInput()?.nativeElement.focus());
  }

  commitCreate(sprintId: number | null): void {
    const title = this.newTitle.trim();
    if (!title) {
      this.cancelCreate();
      return;
    }
    // sprint_id を指定。バックログ (null) は status 未指定で作成 → サーバーが backlog 化
    const payload: Partial<TaskItem> =
      sprintId == null ? { title } : { title, sprint_id: sprintId };
    this.taskApi
      .createTask(payload)
      .pipe(
        tap((created) => {
          this.allTasks.update((list) => [...list, created]);
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

  // ---- スプリント操作 ----
  createSprint(): void {
    const name = this.newSprintName.trim();
    if (!name) return;
    const payload: Partial<Sprint> = { name };
    if (this.newStart) payload.start_date = new Date(this.newStart).toISOString();
    if (this.newEnd) payload.end_date = new Date(this.newEnd).toISOString();
    this.sprintApi
      .createSprint(payload)
      .pipe(
        tap((sp) => {
          this.toast.success(`スプリント「${sp.name}」を作成しました`);
          this.newSprintName = '';
          this.newStart = '';
          this.newEnd = '';
          this.sprints.update((list) => [...list, sp]);
        }),
        catchError(() => {
          this.toast.error('スプリントの作成に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  start(sp: Sprint): void {
    this.sprintApi
      .startSprint(sp.id)
      .pipe(
        tap((updated) => {
          this.toast.success(`スプリント「${updated.name}」を開始しました`);
          this.replaceSprint(updated);
        }),
        catchError((err) => {
          this.toast.error(
            err?.status === 409
              ? '既にアクティブなスプリントがあります。先に完了させてください'
              : 'スプリントの開始に失敗しました',
          );
          return EMPTY;
        }),
      )
      .subscribe();
  }

  complete(sp: Sprint): void {
    if (!confirm(`スプリント「${sp.name}」を完了しますか？`)) return;
    this.sprintApi
      .completeSprint(sp.id)
      .pipe(
        tap((updated) => {
          this.toast.success('スプリントを完了しました');
          this.replaceSprint(updated);
        }),
        catchError(() => {
          this.toast.error('スプリントの完了に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  remove(sp: Sprint): void {
    if (!confirm(`スプリント「${sp.name}」を削除しますか？（所属タスクはバックログへ戻ります）`)) return;
    this.sprintApi
      .deleteSprint(sp.id)
      .pipe(
        tap(() => {
          this.toast.success('スプリントを削除しました');
          this.load(); // タスクの sprint_id が null に戻るので再取得
        }),
        catchError(() => {
          this.toast.error('スプリントの削除に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  // ---- 表示ヘルパー ----
  stateColor(state: string): string {
    switch (state) {
      case 'active':
        return 'text-cyber-green border-cyber-green';
      case 'completed':
        return 'text-cyber-dim border-cyber-line';
      default:
        return 'text-cyber-cyan border-cyber-cyan';
    }
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

  private replaceTask(t: TaskItem): void {
    this.allTasks.update((list) => list.map((x) => (x.id === t.id ? t : x)));
  }

  private replaceSprint(s: Sprint): void {
    this.sprints.update((list) => list.map((x) => (x.id === s.id ? s : x)));
  }
}
