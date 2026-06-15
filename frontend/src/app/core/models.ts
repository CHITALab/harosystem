/**
 * ドメインモデル定義。
 * バックエンド (FastAPI) のレスポンス JSON と 1:1 で対応する。
 * フィールドを追加する場合は backend/app/schemas.py と揃えること。
 */

/** プロジェクトなどの分類ラベル */
export interface Label {
  id: number;
  name: string;
  color: string; // '#rrggbb'。チップの枠色・背景ティントに使われる
  /** このラベルを付けた予定/タスク新規作成時の通知既定値 */
  notify_default: boolean;
  notify_before_min_default: number;
}

/** 予定 (カレンダーイベント) */
export interface EventItem {
  id: number;
  title: string;
  content: string; // 詳細本文 (Markdown またはプレーンテキスト)
  content_type: 'md' | 'text';
  start_at: string; // ISO8601
  end_at: string; // ISO8601
  all_day: boolean;
  /** タイル個別の色 (null ならラベル色 → 既定色の順でフォールバック) */
  color: string | null;
  /** 通知 ON/OFF と通知タイミング (開始の何分前か) */
  notify_enabled: boolean;
  notify_before_min: number;
  label_id: number | null;
  label?: Label | null; // GET 時にサーバーが結合して返す
}

/** TODO タスク */
export interface TaskItem {
  id: number;
  title: string;
  content: string;
  content_type: 'md' | 'text';
  due_at: string | null; // 期限 (null = 期限なし)
  duration_min: number | null; // 作業時間 (分)。タイムグリッドでの高さになる
  done: boolean;
  /** タイル個別の色 (null ならラベル色 → 既定色の順でフォールバック) */
  color: string | null;
  /** 通知 ON/OFF と通知タイミング (期限の何分前か) */
  notify_enabled: boolean;
  notify_before_min: number;
  label_id: number | null;
  label?: Label | null;
}

/** 外部カレンダー購読 (ICS URL)。バックエンドが定期同期する */
export interface Feed {
  id: number;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
  last_synced_at: string | null;
  /** 直近の同期エラー (成功時は null)。UI で原因表示に使う */
  last_error: string | null;
}

/** 通知の送信先 (Discord / Slack の Incoming Webhook) */
export interface Webhook {
  id: number;
  name: string;
  kind: 'discord' | 'slack';
  url: string;
  enabled: boolean;
}

/** 購読フィードから取り込まれた予定 (読み取り専用) */
export interface FeedEvent {
  id: number;
  feed_id: number;
  title: string;
  content: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  feed: Feed;
}

/** 詳細パネルで選択中のアイテム (判別可能ユニオン) */
export type Selected =
  | { kind: 'event'; item: EventItem }
  | { kind: 'task'; item: TaskItem };

/** カレンダーの表示スコープ */
export type ViewMode = 'day' | 'week' | 'month';

/** 認証済みユーザー (GET /api/auth/me のレスポンス) */
export interface User {
  id: number;
  username: string;
}

/** ログインリクエスト (POST /api/auth/login のボディ) */
export interface LoginRequest {
  username: string;
  password: string;
}

/** ログインレスポンス (POST /api/auth/login の戻り値) */
export interface LoginResponse {
  access_token: string;
  token_type: string; // 'bearer'
  user_id: number;
  username: string;
}

/** 作成/編集モーダルの状態 */
export interface FormState {
  kind: 'event' | 'task';
  /** 編集対象 (新規作成のときは undefined) */
  item?: EventItem | TaskItem;
  /** 新規作成時に開始/期限へプリセットする日時 */
  prefillStart?: Date;
}
