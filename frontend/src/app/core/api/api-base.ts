/**
 * @file api-base.ts
 * @description API通信で使用するベースURL定数を定義するファイル。
 *
 * すべてのAPIサービスはこのファイルで定義された `BASE` 定数を使って
 * エンドポイントURLを組み立てます。URLの一元管理により、
 * プロキシ先の変更やパス構造の変更に強い設計になっています。
 *
 * ## 定数一覧
 * - `BASE` — APIのルートパス（`/api`）。nginx がバックエンド（backend:8000）へプロキシする
 * - `ICS_EXPORT_URL` — ICSエクスポートのダウンロードURL。`<a href>` でそのまま使用可能
 *
 * @example
 * ```ts
 * import { BASE, ICS_EXPORT_URL } from './api-base';
 *
 * // エンドポイントの組み立て
 * const url = `${BASE}/labels`;
 *
 * // テンプレートでのダウンロードリンク
 * // <a [href]="icsExportUrl">エクスポート</a>
 * ```
 */

/**
 * APIのルートパス。
 * フロントエンドの nginx 設定（frontend/nginx.conf）によって
 * バックエンドサーバー（backend:8000）にリバースプロキシされます。
 */
export const BASE = '/api';

/**
 * ICS形式でカレンダーデータをエクスポートするためのURL。
 * `<a>` タグの `href` 属性にそのまま指定して、
 * ブラウザのデフォルトダウンロード動作でファイルを取得できます。
 */
export const ICS_EXPORT_URL = `${BASE}/ics/export`;
