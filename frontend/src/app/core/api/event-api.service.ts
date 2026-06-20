/**
 * @file event-api.service.ts
 * @description カレンダーイベント（EventItem）に関するAPI通信を担当するサービス。
 *
 * イベントは開始日時と終了日時を持つカレンダー上の予定です。
 * 終日イベントや時間指定イベントの両方を扱います。
 *
 * ## 提供するメソッド
 * - `getEvents(start, end, labelId)` — 期間内のイベント一覧を取得
 * - `createEvent(data)` — 新しいイベントを作成
 * - `updateEvent(id, data)` — イベントを部分更新（PATCH的PUT）
 * - `deleteEvent(id)` — イベントを削除
 *
 * @example
 * ```ts
 * const eventApi = inject(EventApiService);
 *
 * // 今週のイベントを取得（ラベルフィルタなし）
 * const start = new Date('2026-06-07');
 * const end = new Date('2026-06-14');
 * eventApi.getEvents(start, end, null).subscribe(events => {
 *   console.log(events);
 * });
 *
 * // イベント作成
 * eventApi.createEvent({
 *   title: '打ち合わせ',
 *   start_at: '2026-06-10T10:00:00Z',
 *   end_at: '2026-06-10T11:00:00Z',
 * }).subscribe();
 * ```
 */
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EventItem } from '../models';
import { BASE } from './api-base';

/**
 * イベントAPIサービス。
 *
 * カレンダーイベントのCRUD操作を提供します。
 * `providedIn: 'root'` により、アプリケーション全体でシングルトンとして動作します。
 */
@Injectable({ providedIn: 'root' })
export class EventApiService {
  /** HTTP通信クライアント */
  private http = inject(HttpClient);

  /**
   * 指定期間 [start, end) に重なるイベントを取得します。
   *
   * 期間は半開区間（start以上、end未満）として扱われます。
   * `labelId` を指定すると、そのラベルが付いたイベントだけに絞り込みます。
   *
   * @param start - 取得期間の開始日時
   * @param end - 取得期間の終了日時（この日時は含まれない）
   * @param labelId - フィルタするラベルID（nullの場合は全ラベル対象）
   * @returns イベントの配列を返すObservable
   */
  getEvents(start: Date, end: Date, labelId: number | null): Observable<EventItem[]> {
    let params = new HttpParams()
      .set('start', start.toISOString())
      .set('end', end.toISOString());
    if (labelId != null) params = params.set('label_id', labelId);
    return this.http.get<EventItem[]>(`${BASE}/events`, { params });
  }

  /**
   * 単一のイベント (マスター) を取得します。
   *
   * 繰り返し予定の編集時、一覧で展開された仮想インスタンスではなく
   * マスターの開始/終了・ルールを得るために使います。
   *
   * @param id - イベントID
   * @returns マスターイベントを返すObservable
   */
  getEvent(id: number): Observable<EventItem> {
    return this.http.get<EventItem>(`${BASE}/events/${id}`);
  }

  /**
   * 新しいイベントを作成します。
   *
   * @param data - 作成するイベントの情報
   * @returns 作成されたイベントを返すObservable
   */
  createEvent(data: Partial<EventItem>): Observable<EventItem> {
    return this.http.post<EventItem>(`${BASE}/events`, data);
  }

  /**
   * 既存のイベントを部分更新します。
   *
   * 渡したフィールドだけが更新され、省略したフィールドは変更されません。
   * HTTPメソッドはPUTですが、バックエンドでは部分更新として処理されます。
   *
   * @param id - 更新するイベントのID
   * @param data - 更新するフィールドのみを含むオブジェクト
   * @returns 更新後のイベントを返すObservable
   */
  updateEvent(id: number, data: Partial<EventItem>): Observable<EventItem> {
    return this.http.put<EventItem>(`${BASE}/events/${id}`, data);
  }

  /**
   * 指定したIDのイベントを削除します。
   *
   * @param id - 削除するイベントのID
   * @returns 完了を通知するObservable
   */
  deleteEvent(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/events/${id}`);
  }
}
