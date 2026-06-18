/**
 * ノートページ (/notes) — プロジェクト (Label) に紐づく Markdown ノート管理。
 *
 * レイアウト:
 *   ┌ header (カレンダーへ戻る / 新規ノート)
 *   └ body
 *       ├ 左: ノート一覧 (ラベルで絞り込み)
 *       └ 右: エディタ (タイトル / ラベル / Markdown 本文 + プレビュー / 関連タスク)
 *
 * データフロー (CLAUDE.md の 3 層):
 *   NoteApiService / TaskApiService が Observable を返す
 *   → ここで pipe (tap/catchError) で整形
 *   → 状態は Signal で保持。ノート一覧は StoreService.notes() を共有する
 *     (タスクフォームのノート選択と同じソースを使うため)
 *
 * タスクとの紐付け (Note 1:N Task) は Task.note_id を更新して行う。
 * ノート削除時はサーバー側で note_id が SET NULL されタスク自体は残る。
 */
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, catchError, finalize, forkJoin, of, tap } from 'rxjs';
import { NoteApiService, TaskApiService } from '../../core/api';
import { StoreService } from '../../core/store.service';
import { ToastService } from '../../core/toast.service';
import { MarkdownPipe } from '../../core/markdown.pipe';
import { Note, TaskItem } from '../../core/models';
import { pad } from '../../core/util';
import { UiButtonComponent } from '../../ui/button.component';

@Component({
  selector: 'app-notes-page',
  standalone: true,
  imports: [FormsModule, RouterLink, MarkdownPipe, UiButtonComponent],
  host: { class: 'flex flex-col h-screen bg-cyber-bg text-cyber-text' },
  template: `
    <!-- ヘッダー -->
    <header class="flex items-center gap-4 px-4 py-3 border-b border-cyber-lineStrong shrink-0">
      <a
        routerLink="/"
        class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan"
        title="カレンダーへ戻る"
      >◄ CAL</a>
      <h1 class="font-head text-base tracking-[3px] uppercase text-cyber-cyan
                 drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.6)]">// Notes</h1>
      <div class="ml-auto">
        <ui-button variant="primary" (click)="createNote()">＋ ノート</ui-button>
      </div>
    </header>

    <div class="flex-1 flex min-h-0">
      <!-- 左: ノート一覧 -->
      <aside class="w-[300px] shrink-0 border-r border-cyber-lineStrong overflow-y-auto p-3 flex flex-col gap-3">
        <!-- ラベル絞り込み -->
        <div class="flex flex-wrap gap-1.5">
          <button
            class="text-xs px-2 py-1 border"
            [class.border-cyber-cyan]="filterLabelId() === null"
            [class.text-cyber-cyan]="filterLabelId() === null"
            [class.border-cyber-line]="filterLabelId() !== null"
            (click)="filterLabelId.set(null)"
          >すべて</button>
          @for (label of store.labels(); track label.id) {
            <button
              class="text-xs px-2 py-1 border flex items-center gap-1"
              [class.border-cyber-cyan]="filterLabelId() === label.id"
              [class.border-cyber-line]="filterLabelId() !== label.id"
              (click)="filterLabelId.set(label.id)"
            >
              <span class="w-2 h-2 shrink-0" [style.background]="label.color"></span>
              {{ label.name }}
            </button>
          }
        </div>

        <!-- 一覧 -->
        @for (note of filteredNotes(); track note.id) {
          <div
            class="px-2.5 py-2 cursor-pointer border-l-2 hover:bg-cyber-cyan/5"
            [style.background]="selected()?.id === note.id ? 'rgb(var(--c-cyan) / 0.08)' : null"
            [style.border-left-color]="note.label?.color ?? 'transparent'"
            (click)="select(note)"
          >
            <div class="text-sm truncate" [class.text-cyber-cyan]="selected()?.id === note.id">
              {{ note.title }}
            </div>
            <div class="flex items-center gap-2 text-[11px] text-cyber-dim mt-0.5">
              @if (note.label) {
                <span class="truncate">{{ note.label.name }}</span>
              }
              @if (note.task_count > 0) {
                <span class="ml-auto whitespace-nowrap">🔗 {{ note.task_count }}</span>
              }
            </div>
          </div>
        } @empty {
          <div class="text-xs text-cyber-dim px-1">ノートがありません</div>
        }
      </aside>

      <!-- 右: エディタ -->
      <main class="flex-1 overflow-y-auto p-4 min-w-0">
        @if (selected(); as note) {
          <div class="flex flex-col gap-3 max-w-3xl">
            <!-- タイトル + 操作 -->
            <div class="flex items-center gap-2">
              <input
                class="input flex-1 !text-base"
                placeholder="タイトル"
                [(ngModel)]="editTitle"
              />
              <ui-button variant="primary" [disabled]="saving()" (click)="save()">
                {{ saving() ? '保存中…' : '保存' }}
              </ui-button>
              <ui-button variant="danger" (click)="remove()">削除</ui-button>
            </div>

            <!-- ラベル + 形式 + プレビュー切替 -->
            <div class="flex items-center gap-3 flex-wrap">
              <label class="flex items-center gap-1.5 text-xs text-cyber-dim uppercase tracking-wider">
                ラベル
                <select class="input !py-1 !text-sm" [(ngModel)]="editLabelId">
                  <option [ngValue]="null">（なし）</option>
                  @for (label of store.labels(); track label.id) {
                    <option [ngValue]="label.id">{{ label.name }}</option>
                  }
                </select>
              </label>
              <label class="flex items-center gap-1.5 text-xs text-cyber-dim uppercase tracking-wider">
                形式
                <select class="input !py-1 !text-sm" [(ngModel)]="editContentType">
                  <option value="md">md</option>
                  <option value="text">text</option>
                </select>
              </label>
              @if (editContentType === 'md') {
                <ui-button [active]="preview()" (click)="preview.set(!preview())">
                  {{ preview() ? '編集に戻る' : 'プレビュー' }}
                </ui-button>
              }
              <span class="text-[11px] text-cyber-dim ml-auto">更新 {{ fmtDate(note.updated_at) }}</span>
            </div>

            <!-- 本文 (編集 or プレビュー) -->
            @if (editContentType === 'md' && preview()) {
              <div class="md min-h-[300px] border border-cyber-line p-3 overflow-auto"
                   [innerHTML]="editContent | markdown"></div>
            } @else {
              <textarea
                class="input min-h-[300px] font-mono !text-sm leading-relaxed resize-y"
                placeholder="Markdown で記述できます"
                [(ngModel)]="editContent"
              ></textarea>
            }

            <!-- 関連タスク -->
            <section class="border-t border-cyber-line pt-3 flex flex-col gap-2">
              <div class="font-head text-sm tracking-[2px] uppercase text-cyber-magenta">
                // 関連タスク
              </div>
              @for (task of relatedTasks(); track task.id) {
                <div class="flex items-center gap-2 px-2.5 py-1.5 border-l-2 border-cyber-magenta/60
                            bg-cyber-bg3 text-sm">
                  <span class="flex-1 truncate" [class.line-through]="task.done"
                        [class.opacity-50]="task.done">{{ task.title }}</span>
                  <button class="text-cyber-dim hover:text-cyber-red px-1" title="紐付けを解除"
                          (click)="detach(task.id)">×</button>
                </div>
              } @empty {
                <div class="text-xs text-cyber-dim">紐付くタスクはありません</div>
              }

              <!-- 既存タスクを紐付け -->
              @if (candidates().length) {
                <select class="input !py-1.5 !text-sm mt-1"
                        [ngModel]="null" (ngModelChange)="attach($event)">
                  <option [ngValue]="null">＋ タスクを紐付け…</option>
                  @for (task of candidates(); track task.id) {
                    <option [ngValue]="task.id">{{ task.title }}</option>
                  }
                </select>
              }
            </section>
          </div>
        } @else {
          <div class="h-full flex items-center justify-center text-cyber-dim text-sm">
            左の一覧からノートを選ぶか、「＋ ノート」で作成してください
          </div>
        }
      </main>
    </div>
  `,
})
export class NotesPageComponent {
  store = inject(StoreService);
  private noteApi = inject(NoteApiService);
  private taskApi = inject(TaskApiService);
  private toast = inject(ToastService);

  /** 編集中のノート (null = 未選択) */
  readonly selected = signal<Note | null>(null);
  /** 一覧のラベル絞り込み (null = すべて) */
  readonly filterLabelId = signal<number | null>(null);
  /** Markdown プレビュー表示中か */
  readonly preview = signal(false);
  readonly saving = signal(false);
  /** 選択中ノートに紐付くタスク */
  readonly relatedTasks = signal<TaskItem[]>([]);
  /** 紐付け候補にする全タスク */
  private readonly allTasks = signal<TaskItem[]>([]);

  // エディタの入力値 (選択時に選択ノートからコピーする)
  editTitle = '';
  editContent = '';
  editLabelId: number | null = null;
  editContentType: 'md' | 'text' = 'md';

  /** ラベル絞り込みを適用したノート一覧 */
  readonly filteredNotes = computed(() => {
    const labelId = this.filterLabelId();
    const notes = this.store.notes();
    return labelId == null ? notes : notes.filter((n) => n.label_id === labelId);
  });

  /** 紐付け候補 (このノートにまだ紐付いていないタスク) */
  readonly candidates = computed(() => {
    const note = this.selected();
    if (!note) return [];
    return this.allTasks().filter((t) => t.note_id !== note.id);
  });

  ngOnInit(): void {
    this.store.loadLabels();
    this.store.loadNotes();
  }

  /** ノートを選択してエディタに読み込む (未保存の編集は破棄される) */
  select(note: Note): void {
    this.selected.set(note);
    this.editTitle = note.title;
    this.editContent = note.content;
    this.editLabelId = note.label_id;
    this.editContentType = note.content_type;
    this.preview.set(false);
    this.loadTasks(note.id);
  }

  /** 選択ノートの関連タスクと、紐付け候補の全タスクを取得する */
  private loadTasks(noteId: number): void {
    forkJoin({
      related: this.taskApi.getTasksByNote(noteId),
      all: this.taskApi.getAllTasks(),
    })
      .pipe(
        catchError(() => {
          this.toast.error('タスクの取得に失敗しました');
          return of({ related: [] as TaskItem[], all: [] as TaskItem[] });
        }),
      )
      .subscribe(({ related, all }) => {
        this.relatedTasks.set(related);
        this.allTasks.set(all);
      });
  }

  /** 空のノートを作成して即座に開く */
  createNote(): void {
    this.noteApi
      .createNote({
        title: '無題のノート',
        content: '',
        content_type: 'md',
        label_id: this.filterLabelId(),
      })
      .pipe(
        tap((note) => {
          this.toast.success('ノートを作成しました');
          this.store.loadNotes();
          this.select(note);
        }),
        catchError(() => {
          this.toast.error('ノートの作成に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  /** 編集内容を保存する */
  save(): void {
    const note = this.selected();
    if (!note) return;
    this.saving.set(true);
    this.noteApi
      .updateNote(note.id, {
        title: this.editTitle.trim() || '無題のノート',
        content: this.editContent,
        content_type: this.editContentType,
        label_id: this.editLabelId,
      })
      .pipe(
        tap((updated) => {
          this.toast.success('保存しました');
          this.selected.set(updated);
          this.store.loadNotes();
        }),
        catchError(() => {
          this.toast.error('ノートの保存に失敗しました');
          return EMPTY;
        }),
        finalize(() => this.saving.set(false)),
      )
      .subscribe();
  }

  /** ノートを削除する (紐付くタスクは残る) */
  remove(): void {
    const note = this.selected();
    if (!note) return;
    if (!confirm(`ノート「${note.title}」を削除しますか？（紐付くタスクは残ります）`)) return;
    this.noteApi
      .deleteNote(note.id)
      .pipe(
        tap(() => {
          this.toast.success('ノートを削除しました');
          this.selected.set(null);
          this.store.loadNotes();
        }),
        catchError(() => {
          this.toast.error('ノートの削除に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  /** 既存タスクをこのノートに紐付ける */
  attach(taskId: number | null): void {
    const note = this.selected();
    if (!note || taskId == null) return;
    this.taskApi
      .updateTask(taskId, { note_id: note.id })
      .pipe(
        tap(() => {
          this.loadTasks(note.id);
          this.store.loadNotes(); // task_count を更新
        }),
        catchError(() => {
          this.toast.error('タスクの紐付けに失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  /** タスクの紐付けを解除する */
  detach(taskId: number): void {
    const note = this.selected();
    if (!note) return;
    this.taskApi
      .updateTask(taskId, { note_id: null })
      .pipe(
        tap(() => {
          this.loadTasks(note.id);
          this.store.loadNotes();
        }),
        catchError(() => {
          this.toast.error('紐付け解除に失敗しました');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  /** ISO 文字列を M/D HH:MM 形式に整形する */
  fmtDate(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
