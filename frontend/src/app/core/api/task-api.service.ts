/**
 * @file task-api.service.ts
 * @description TODOタスク（TaskItem）に関するAPI通信を担当するサービス。
 *
 * タスクは期限（due_at）を持つTODOアイテムです。
 * 期限なしのタスクも存在し、取得時には `include_no_due=true` で一緒に取得します。
 *
 * ## 提供するメソッド
 * - `getTasks(start, end, labelId)` — 期間内のタスク＋期限なしタスクを取得
 * - `createTask(data)` — 新しいタスクを作成
 * - `updateTask(id, data)` — タスクを部分更新（完了状態の切り替えなど）
 * - `deleteTask(id)` — タスクを削除
 *
 * @example
 * ```ts
 * const taskApi = inject(TaskApiService);
 *
 * // 今週のタスクを取得
 * const start = new Date('2026-06-07');
 * const end = new Date('2026-06-14');
 * taskApi.getTasks(start, end, null).subscribe(tasks => {
 *   console.log(tasks);
 * });
 *
 * // タスクの完了状態を切り替え
 * taskApi.updateTask(3, { done: true }).subscribe();
 * ```
 */
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { TaskItem } from '../models';
import { BASE } from './api-base';

/**
 * タスクAPIサービス。
 *
 * TODOタスクのCRUD操作を提供します。
 * `providedIn: 'root'` により、アプリケーション全体でシングルトンとして動作します。
 */
@Injectable({ providedIn: 'root' })
export class TaskApiService {
  /** HTTP通信クライアント */
  private http = inject(HttpClient);

  /**
   * 期限が [start, end) のタスクと、期限なしタスクを取得します。
   *
   * クエリパラメータ `include_no_due=true` を常に付与することで、
   * 期限が設定されていないタスクも結果に含めます。
   * `labelId` を指定すると、そのラベルが付いたタスクだけに絞り込みます。
   *
   * @param start - 取得期間の開始日時
   * @param end - 取得期間の終了日時（この日時は含まれない）
   * @param labelId - フィルタするラベルID（nullの場合は全ラベル対象）
   * @returns タスクの配列を返すObservable
   */
  getTasks(start: Date, end: Date, labelId: number | null): Observable<TaskItem[]> {
    let params = new HttpParams()
      .set('start', start.toISOString())
      .set('end', end.toISOString())
      .set('include_no_due', true);
    if (labelId != null) params = params.set('label_id', labelId);
    return this.http.get<TaskItem[]>(`${BASE}/tasks`, { params });
  }

  /**
   * 新しいタスクを作成します。
   *
   * @param data - 作成するタスクの情報
   * @returns 作成されたタスクを返すObservable
   */
  createTask(data: Partial<TaskItem>): Observable<TaskItem> {
    return this.http.post<TaskItem>(`${BASE}/tasks`, data);
  }

  /**
   * 既存のタスクを部分更新します。
   *
   * 渡したフィールドだけが更新されます。
   * よくある使い方として、完了状態の切り替え `{ done: true }` があります。
   *
   * @param id - 更新するタスクのID
   * @param data - 更新するフィールドのみを含むオブジェクト
   * @returns 更新後のタスクを返すObservable
   */
  updateTask(id: number, data: Partial<TaskItem>): Observable<TaskItem> {
    return this.http.put<TaskItem>(`${BASE}/tasks/${id}`, data);
  }

  /**
   * 指定したIDのタスクを削除します。
   *
   * @param id - 削除するタスクのID
   * @returns 完了を通知するObservable
   */
  deleteTask(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/tasks/${id}`);
  }
}
