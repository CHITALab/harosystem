/**
 * @file feed-api.service.ts
 * @description 外部カレンダー購読（Feed）に関するAPI通信を担当するサービス。
 *
 * フィードは外部のICS URLを登録して定期的に同期する機能です。
 * GoogleカレンダーやOutlookなど、ICS形式を公開しているカレンダーを
 * 購読して予定を取り込むことができます。
 *
 * ## 提供するメソッド
 * - `getFeeds()` — 登録済みフィード一覧を取得
 * - `createFeed(data)` — 新しいフィードを登録
 * - `updateFeed(id, data)` — フィードの設定を更新（有効/無効の切り替えなど）
 * - `deleteFeed(id)` — フィードを削除
 * - `syncFeed(id)` — フィードを手動で即時同期
 * - `getFeedEvents(start, end)` — 取り込み済みの外部予定を期間で取得
 *
 * @example
 * ```ts
 * const feedApi = inject(FeedApiService);
 *
 * // フィードを登録
 * feedApi.createFeed({
 *   name: '祝日カレンダー',
 *   url: 'https://example.com/holidays.ics',
 * }).subscribe();
 *
 * // 手動同期
 * feedApi.syncFeed(1).subscribe(feed => {
 *   console.log('最終同期:', feed.last_synced_at);
 * });
 * ```
 */
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Feed, FeedEvent } from '../models';
import { BASE } from './api-base';

/**
 * フィードAPIサービス。
 *
 * 外部カレンダー購読のCRUD操作と同期機能を提供します。
 * `providedIn: 'root'` により、アプリケーション全体でシングルトンとして動作します。
 */
@Injectable({ providedIn: 'root' })
export class FeedApiService {
  /** HTTP通信クライアント */
  private http = inject(HttpClient);

  /**
   * 登録済みの全フィードを取得します。
   *
   * @returns フィードの配列を返すObservable
   */
  getFeeds(): Observable<Feed[]> {
    return this.http.get<Feed[]>(`${BASE}/feeds`);
  }

  /**
   * 新しいフィードを登録します。
   *
   * 登録後、バックエンドが定期的にICS URLを取得して予定を同期します。
   *
   * @param data - 登録するフィードの情報（name, url など）
   * @returns 作成されたフィードを返すObservable
   */
  createFeed(data: Partial<Feed>): Observable<Feed> {
    return this.http.post<Feed>(`${BASE}/feeds`, data);
  }

  /**
   * 既存のフィードの設定を更新します。
   *
   * 有効/無効の切り替え、名前の変更、URLの変更などに使用します。
   *
   * @param id - 更新するフィードのID
   * @param data - 更新するフィールドのみを含むオブジェクト
   * @returns 更新後のフィードを返すObservable
   */
  updateFeed(id: number, data: Partial<Feed>): Observable<Feed> {
    return this.http.put<Feed>(`${BASE}/feeds/${id}`, data);
  }

  /**
   * 指定したIDのフィードを削除します。
   *
   * フィードを削除すると、そのフィードから取り込まれた予定も
   * すべて削除されます。
   *
   * @param id - 削除するフィードのID
   * @returns 完了を通知するObservable
   */
  deleteFeed(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/feeds/${id}`);
  }

  /**
   * フィードを手動で即時同期します。
   *
   * 通常はバックエンドが定期的に自動同期しますが、
   * このメソッドを呼ぶことで即座に最新の予定を取り込めます。
   *
   * @param id - 同期するフィードのID
   * @returns 同期後のフィード情報を返すObservable（last_synced_at が更新される）
   */
  syncFeed(id: number): Observable<Feed> {
    return this.http.post<Feed>(`${BASE}/feeds/${id}/sync`, {});
  }

  /**
   * 取り込み済みの外部予定を期間で取得します（読み取り専用）。
   *
   * フィードから同期された予定を表示するために使用します。
   * これらの予定は読み取り専用で、編集・削除はできません。
   *
   * @param start - 取得期間の開始日時
   * @param end - 取得期間の終了日時（この日時は含まれない）
   * @returns フィードイベントの配列を返すObservable
   */
  getFeedEvents(start: Date, end: Date): Observable<FeedEvent[]> {
    const params = new HttpParams()
      .set('start', start.toISOString())
      .set('end', end.toISOString());
    return this.http.get<FeedEvent[]>(`${BASE}/feeds/events`, { params });
  }
}
