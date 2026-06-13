/**
 * @file ics-api.service.ts
 * @description ICS（iCalendar）形式のインポート/エクスポートに関するAPI通信を担当するサービス。
 *
 * ICSはカレンダーデータの標準交換フォーマット（RFC 5545）です。
 * `.ics` ファイルのアップロードによるインポートと、
 * ダウンロードURLによるエクスポートの2つの機能を提供します。
 *
 * ## 提供するメソッド
 * - `importIcs(file)` — .ics ファイルをアップロードして予定/タスクを取り込む
 *
 * ## エクスポート
 * エクスポートは `ICS_EXPORT_URL` 定数をテンプレートの `<a href>` に
 * 設定するだけで、ブラウザのダウンロード機能で取得できます。
 * APIサービスのメソッドとしては提供していません。
 *
 * @example
 * ```ts
 * const icsApi = inject(IcsApiService);
 *
 * // ファイルインポート
 * const fileInput: HTMLInputElement = ...;
 * icsApi.importIcs(fileInput.files[0]).subscribe(result => {
 *   console.log(`${result.events}件のイベント、${result.tasks}件のタスクを取り込みました`);
 * });
 *
 * // エクスポート（テンプレート側）
 * // <a [href]="icsExportUrl">カレンダーをエクスポート</a>
 * ```
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BASE } from './api-base';

/** ICSエクスポートURLの再エクスポート（利便性のため） */
export { ICS_EXPORT_URL } from './api-base';

/**
 * ICS APIサービス。
 *
 * ICS形式のファイルインポート機能を提供します。
 * `providedIn: 'root'` により、アプリケーション全体でシングルトンとして動作します。
 */
@Injectable({ providedIn: 'root' })
export class IcsApiService {
  /** HTTP通信クライアント */
  private http = inject(HttpClient);

  /**
   * ICS（.ics）ファイルをアップロードして、予定とタスクを取り込みます。
   *
   * ファイルは `multipart/form-data` 形式で送信されます。
   * バックエンドがICSファイルを解析し、VEVENT は予定として、
   * VTODO はタスクとしてそれぞれ登録します。
   *
   * @param file - アップロードする .ics ファイル
   * @returns 取り込まれたイベント数とタスク数を返すObservable
   */
  importIcs(file: File): Observable<{ events: number; tasks: number }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ events: number; tasks: number }>(`${BASE}/ics/import`, form);
  }
}
