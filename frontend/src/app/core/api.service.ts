/**
 * @file api.service.ts
 * @description API層の再エクスポートファイル（後方互換性用）。
 *
 * このファイルは、分割された `./api/` ディレクトリ内の各サービスを
 * 再エクスポートします。既存のインポートパス（`'./api.service'` や
 * `'../core/api.service'`）がそのまま動作するようにするためのファイルです。
 *
 * **実装の本体は `./api/` ディレクトリ内にあります。**
 *
 * @see {@link ./api/index.ts} — バレルファイル（全サービスの定義と再エクスポート）
 */
export {
  ApiService,
  ICS_EXPORT_URL,
  LabelApiService,
  EventApiService,
  TaskApiService,
  FeedApiService,
  WebhookApiService,
  IcsApiService,
} from './api/index';
