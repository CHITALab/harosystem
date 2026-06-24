/**
 * バックログ画面 (/backlog) — Jira 風のバックログ & スプリント計画 (ラベル分離)。
 *
 * ヘッダーのラベルセレクタで「プロジェクト(ラベル)」を切り替え、選択ラベルの
 * スプリントと Backlog プールを縦に並べる。タスク行を別セクションへ D&D して計画する。
 *   - カードクリック → カレンダーと同じ詳細パネル (タイトル/本文ダブルクリックで編集)
 *   - 「＋タスク追加」→ そのセクションの status / スプリントを持つ作成フォームを開く
 *   - スプリントは選択ラベルに紐づけて作成。開始/完了/削除も可能
 *
 * タスク変更は共有の詳細パネル/フォームから StoreService に集約し、tasksVersion で再取得する。
 */
import { Component, effect, inject, signal } from '@angular/core';
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
import { DetailPanelComponent } from '../detail-panel.component';
import { ItemFormComponent } from '../item-form.component';

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
  imports: [
    FormsModule,
    RouterLink,
    UiButtonComponent,
    NgTemplateOutlet,
    DetailPanelComponent,
    ItemFormComponent,
  ],
  host: { class: 'flex flex-col h-screen bg-cyber-bg text-cyber-text' },
  template: `
    <header class="flex items-center gap-3 px-4 py-3 border-b border-cyber-lineStrong shrink-0 flex-wrap">
      <a routerLink="/" class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="カレンダーへ戻る">◄ CAL</a>
      <h1 class="font-head text-base tracking-[3px] uppercase text-cyber-cyan
                 drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.6)]">// Backlog</h1>
      <a routerLink="/board"
         class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
         title="アクティブボード">BOARD ►</a>

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

      <!-- スプリント作成 (選択ラベルに紐づく) -->
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

    <div class="flex-1 flex min-h-0">
      <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3 max-w-4xl w-full min-w-0">
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
                @if (sp.state === 'planned') { <ui-button (click)="start(sp)">開始</ui-button> }
                @if (sp.state === 'active') { <ui-button (click)="complete(sp)">完了</ui-button> }
                <ui-button variant="danger" (click)="remove(sp)">削除</ui-button>
              </div>
            </div>

            <div class="p-2 flex flex-col gap-1.5 min-h-[44px]">
              @for (task of tasksOf(sp.id); track task.id) {
                <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: task }" />
              } @empty {
                <div class="text-xs text-cyber-dim px-1 py-1.5">タスクをここにドラッグ</div>
              }
              @if (sp.state !== 'completed') {
                <button type="button" class="text-xs text-cyber-dim hover:text-cyber-cyan text-left px-1 py-1"
                        (click)="addTask(sp.id, 'todo')">＋ タスク追加</button>
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
            <button type="button" class="text-xs text-cyber-dim hover:text-cyber-cyan text-left px-1 py-1"
                    (click)="addTask(null, 'backlog')">＋ タスク追加</button>
          </div>
        </section>
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

    <!-- タスク行テンプレート (スプリント/バックログ共通) -->
    <ng-template #row let-task>
      <article
        class="flex items-center gap-2 px-2.5 py-1.5 border-l-2 bg-cyber-bg3 cursor-pointer text-sm
               hover:brightness-125 select-none"
        [class.outline]="isSelected(task.id)"
        [class.outline-1]="isSelected(task.id)"
        [style.outline-color]="isSelected(task.id) ? 'rgb(var(--c-cyan))' : null"
        [style.border-left-color]="task.color ?? task.label?.color ?? 'transparent'"
        draggable="true"
        (dragstart)="onDragStart($event, task.id)"
        (click)="select(task)"
      >
        <span class="flex-1 truncate" [class.line-through]="task.done" [class.opacity-50]="task.done">
          {{ task.title }}
        </span>
        <span class="text-[10px] uppercase tracking-wider shrink-0" [class]="badge(task.status).color">
          {{ badge(task.status).label }}
        </span>
        @if (task.start_at) {
          <span class="text-[11px] text-cyber-dim whitespace-nowrap shrink-0">{{ fmtDue(task.start_at) }}</span>
        }
      </article>
    </ng-template>
  `,
})
export class BacklogPageComponent {
  store = inject(StoreService);
  private sprintApi = inject(SprintApiService);
  private taskApi = inject(TaskApiService);
  private toast = inject(ToastService);

  /** 選択中のラベル (null = 未分類)。store 共有で /board・/backlog 間 + リロードをまたいで保持 */
  readonly selectedLabelId = this.store.boardLabelId;

  readonly sprints = signal<Sprint[]>([]);
  private readonly allTasks = signal<TaskItem[]>([]);

  // スプリント作成フォーム
  newSprintName = '';
  newStart = '';
  newEnd = '';

  constructor() {
    // ラベル選択 / タスク変更 (tasksVersion) のたびに再取得する
    effect(() => {
      this.store.tasksVersion();
      this.load(this.selectedLabelId());
    });
  }

  ngOnInit(): void {
    this.store.loadLabels();
    this.store.loadNotes();
  }

  private load(labelId: number | null): void {
    forkJoin({
      sprints: this.sprintApi.getSprints(labelId),
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

  /**
   * セクションに表示するタスク。
   *   - スプリント (sprintId != null): そのスプリント所属のタスク。スプリント自体が
   *     選択ラベルで絞り込まれているため、タスクの label_id では絞り込まない
   *     (別ラベル/未ラベルの旧データも所属スプリントで拾える)。
   *   - バックログプール (sprintId == null): スプリント未割当かつ選択ラベルのタスク
   *     (プールのタスクは label_id がプロジェクト帰属を表す)。
   */
  tasksOf(sprintId: number | null): TaskItem[] {
    if (sprintId === null) {
      const labelId = this.selectedLabelId();
      return this.allTasks().filter((t) => t.sprint_id === null && t.label_id === labelId);
    }
    return this.allTasks().filter((t) => t.sprint_id === sprintId);
  }

  isSelected(taskId: number): boolean {
    const sel = this.store.selected();
    return !!sel && sel.kind === 'task' && sel.item.id === taskId;
  }

  badge(status: string) {
    return STATUS_BADGE[status] ?? STATUS_BADGE['todo'];
  }

  /** カードクリックで詳細パネルを開く */
  select(task: TaskItem): void {
    this.store.select({ kind: 'task', item: task });
  }

  /** 「＋タスク追加」で作成フォームを開く (セクションの status / スプリント / 選択ラベル) */
  addTask(sprintId: number | null, status: 'backlog' | 'todo'): void {
    this.store.openForm({
      kind: 'task',
      prefillStatus: status,
      prefillSprintId: sprintId,
      prefillLabelId: this.selectedLabelId(),
    });
  }

  // ---- D&D: セクション間移動で sprint_id を更新 ----
  onDragStart(e: DragEvent, taskId: number): void {
    e.dataTransfer?.setData('text/plain', String(taskId));
  }

  onDrop(e: DragEvent, sprintId: number | null): void {
    e.preventDefault();
    // 完了したスプリントへのドロップは受け付けない
    if (sprintId != null && this.sprints().find((s) => s.id === sprintId)?.state === 'completed') {
      return;
    }
    const id = Number(e.dataTransfer?.getData('text/plain'));
    const task = this.allTasks().find((t) => t.id === id);
    if (!task || task.sprint_id === sprintId) return;
    // プール (sprint_id=null) へ戻す時は、現在の表示ラベルに帰属させる。
    // (他ラベルのタスクをプールに落としても、選択中ラベルのプールから消えないように)
    const patch: Partial<TaskItem> = { sprint_id: sprintId };
    if (sprintId === null) patch.label_id = this.selectedLabelId();
    this.taskApi
      .updateTask(id, patch)
      .pipe(
        tap((updated) => this.store.syncSelected('task', updated)),
        catchError(() => {
          this.toast.error('タスクの移動に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  // ---- スプリント操作 ----
  createSprint(): void {
    const name = this.newSprintName.trim();
    if (!name) return;
    const payload: Partial<Sprint> = { name, label_id: this.selectedLabelId() };
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
              ? 'このラベルには既にアクティブなスプリントがあります。先に完了させてください'
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
        tap(() => {
          this.toast.success('スプリントを完了しました');
          // サーバーが未完了タスクをプールへ退避するので、スプリント+タスクを再取得する
          this.load(this.selectedLabelId());
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
          this.load(this.selectedLabelId()); // タスクの sprint_id が null に戻るので再取得
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

  private replaceSprint(s: Sprint): void {
    this.sprints.update((list) => list.map((x) => (x.id === s.id ? s : x)));
  }
}
