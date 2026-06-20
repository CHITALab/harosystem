/**
 * @file sprint-api.service.ts
 * @description スプリント (実行期間) の API 通信を担当するサービス。
 *
 * Jira 風のバックログ/スプリント管理で使う。同時に active なスプリントは 1 つ。
 * タスクのスプリント割り当ては Task 側の sprint_id を更新して行うため、
 * 割当/解除は TaskApiService.updateTask({ sprint_id }) を使う。
 *
 * ## 提供するメソッド
 * - `getSprints()` — スプリント一覧を取得
 * - `createSprint(data)` — スプリントを作成
 * - `updateSprint(id, data)` — スプリントを部分更新
 * - `startSprint(id)` — スプリントを開始 (active 化。他に active があれば 409)
 * - `completeSprint(id)` — スプリントを完了
 * - `deleteSprint(id)` — スプリントを削除 (所属タスクはプールへ戻る)
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Sprint } from '../models';
import { BASE } from './api-base';

@Injectable({ providedIn: 'root' })
export class SprintApiService {
  private http = inject(HttpClient);

  /** スプリント一覧を取得します (作成順)。 */
  getSprints(): Observable<Sprint[]> {
    return this.http.get<Sprint[]>(`${BASE}/sprints`);
  }

  /** 新しいスプリントを作成します。 */
  createSprint(data: Partial<Sprint>): Observable<Sprint> {
    return this.http.post<Sprint>(`${BASE}/sprints`, data);
  }

  /** スプリントを部分更新します。 */
  updateSprint(id: number, data: Partial<Sprint>): Observable<Sprint> {
    return this.http.put<Sprint>(`${BASE}/sprints/${id}`, data);
  }

  /** スプリントを開始します (active 化)。 */
  startSprint(id: number): Observable<Sprint> {
    return this.http.post<Sprint>(`${BASE}/sprints/${id}/start`, {});
  }

  /** スプリントを完了します。 */
  completeSprint(id: number): Observable<Sprint> {
    return this.http.post<Sprint>(`${BASE}/sprints/${id}/complete`, {});
  }

  /** スプリントを削除します (所属タスクはバックログプールへ戻る)。 */
  deleteSprint(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/sprints/${id}`);
  }
}
