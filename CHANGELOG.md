# CHANGELOG — harosystem

完了タスクの退避先。`TODO.md` は未着手バックログだけに保ち、`[x]` 化（実装→動作確認→agy監査→ユーザー受け入れ）した項目はここへ移す。

---

## 認証 (Auth)

- **フロントエンド認証（JWT）の実装**
  - `AuthService`（token/user/isAuthenticated を Signal で管理、localStorage 永続化）、`authInterceptor`（Bearer 自動付与 + 401 で /login へ）、`authGuard`（CanActivateFn）、`APP_INITIALIZER` による起動時セッション復元、ログイン画面、サイドバーのログアウト。
  - バックエンドは `User` モデル + `/api/auth/login`・`/me`、全 API を `get_current_user` で保護、デフォルトユーザー `admin`/`admin` をシード。

## UI・UX 改善

- **カレンダービュー：予定/タスクタイルの横幅・余白を調整しきつさを軽減**
  - 週/日ビューのチップ内側余白を `px-1.5` → `px-2`、予定の最小高を 20px → 24px に拡大。
- **カレンダービュー：タスクカードが重なった際のカスケード配置**
  - タスクを固定全幅 (`right:2px`) から、予定と同じカスケード配置 (`cascade()`) に変更。重なっても被らず読める。
- **サイドバー：サブタスクの折りたたみ/展開（アコーディオン）**
  - サブタスクを持つ親タスクに開閉キャレット (▸/▾) を追加。
- **【バグ修正】サブタスク・アコーディオンの動作不良・操作性改善**
  - 開閉ボタンのヒット領域を `w-3` → `w-6 h-6`（中央寄せ + ホバー背景）に拡大、行を `items-center` に。`<button type="button">` 明記 + `aria-expanded` 付与。初期状態を「すべて折りたたみ」に（展開中 ID を管理する方式へ反転）。
- **カレンダービュー：選択アイテムの最前面化（z-index 動的制御）** ※後日削除（下記）
  - time-grid の予定/タスクチップに `zFor()`（選択中は z-index=50）と選択枠（シアン outline）を追加。`store.selected()` を参照。hover は `hover:!z-30`、選択中はインライン `!important` で hover に勝つ。
- **【機能削除】選択アイテムの最前面化（z-index）の撤去**
  - カスケード配置で選択アイテムが飛び出して他要素を隠し邪魔だったため削除。`zFor()` と `[style.z-index]` の `50 !important` 上書き、チップの `hover:z-30` を撤去し、z-index は素の `seg.zIndex`（カスケード順）に固定。選択枠（シアン outline）は維持。

## ノート機能 (Notes)

- **プロジェクト（Label）に紐づく Markdown ノート管理システム**
  - 専用ページ `/notes`（左=ラベル別一覧 / 右=Markdown エディタ + プレビュー + 関連タスク）。
  - バックエンドは `Note` モデル + `tasks.note_id` + `/api/notes` CRUD。`Label` 1:N `Note`、`Note` 1:N `Task`。紐付けはノート編集画面とタスク編集フォームの両方から可能。ノート削除時は `note_id` を SET NULL してタスクは残す。

## アジャイル・カンバン (Agile Board)

- **カンバン形式のタスク管理ビュー（ベース実装）**
  - タスクに `status`（backlog/todo/in_progress/done）を追加し `done` と相互同期。
- **【高度化】Jira ライクなバックログ＆スプリント管理（ラベル分離・操作系刷新）**
  - `Sprint` モデル（name/start_date/end_date/state/`label_id`）+ `Task.sprint_id`。`/api/sprints` CRUD + start/complete（アクティブ排他はラベルごとに1つ）。
  - `/board`（アクティブスプリントの 3 列）と `/backlog`（スプリント + Backlog プールの縦リスト、D&D で計画）にラベルセレクタ（単一選択 + 未分類）。
  - 作成は列の空白ダブルクリック / 「＋タスク追加」で共通の作成フォーム（status/sprint_id/label プリフィル）。カードクリックで共通の詳細パネル、詳細パネルのタイトル/本文ダブルクリックで編集。タスク変更は `store.tasksVersion` で各画面が再取得。
  - 不変条件：`sprint_id=null ⇒ status=backlog`、スプリント割当時 backlog→todo、`done ⇔ status==='done'`。スプリント完了で未完了タスクはプールへ退避。
  - セキュリティ：label_id/note_id/sprint_id の所有権検証（IDOR 防止, `ownership.py`）、予定の `end>start` 検証。
- **【緊急バグ修正】バックログ/ボードのデータ消失・UI崩壊の復旧**
  - 原因：ラベル分離の回帰。既定が先頭ラベルに着地し未ラベル(label_id=null)の既存データが非表示／board・backlog がスプリント所属に加えタスクの label_id も要求し旧データが孤立。
  - 修正：スプリント枠/ボードは sprint_id のみで表示（スプリント自体がラベル分離済み）、バックログプールのみ label_id でスコープ。既定セレクタを「未分類」に。プールへ D&D 時は label_id を表示ラベルに更新。スプリント完了時に再取得。
- **【データモデル確定 A】タスクのラベルと board/backlog のラベルを一致させる**
  - 「ラベル＝プロジェクト、スプリントはプロジェクトに属する（`task.label_id` と `sprint.label_id` の両方を持つ）」モデル A を採用（プロジェクトごとに独立したスプリントを並行で回せる）。
  - 不変条件：タスクがスプリント所属なら `task.label_id = sprint.label_id` に揃える（`_align_label_to_sprint`、作成/更新時）。
  - 既存是正マイグレーション：label 未設定スプリントを所属タスクのラベルが一意なら補完＋ラベル付きスプリントの所属タスクをスプリントのラベルへ揃える（未設定スプリントのタスクは保持しデータ消失防止）。
- **board/backlog の選択ラベルを画面遷移・リロードまたいで保持**
  - `StoreService.boardLabelId`（共有シグナル + localStorage 永続化）に集約。両ページはこれをエイリアスして共有。

## 高度な時間管理 (Advanced Time Management)

- **イベントの繰り返し（RRULE）＋終日対応**
  - `Event.recurrence`（RRULE 文字列, null=単発）。一覧取得時に表示期間へ `dateutil` で展開（仮想インスタンス、総ステップ/件数で有界化、FREQ は DAILY/WEEKLY/MONTHLY/YEARLY に制限）。フォームはプリセット中心（毎日/平日/毎週(曜日)/毎月 + 終了条件）。編集・削除はマスター=全件。ICS は RRULE で入出力。終日は既存の `all_day`。
  - ※ 既知の不具合（開始日・月曜が表示されないTZズレ）は TODO に未対応として残置。
- **タスクの時間設定方法の変更（`due_at`+`duration_min` → `start_at`+`end_at`）**
  - `Task` に `start_at`/`end_at`（null/null=未スケジュール=バックログ）を追加し旧フィールドを廃止（DBカラムは残置、既存データは start=due / end=due+duration||30分 で移行）。全ルーター・通知・ICS・カレンダー/カンバン/サイドバー/フォーム/詳細パネルを移行。D&D 移動=開始終了シフト、リサイズ=終了伸縮。サーバー側で「両方指定 or 両方null」「end>start」を検証。
- **カレンダー上での予定とタスクの統合カスケード配置**
  - time-grid の `layoutDay()` で予定とタスクを 1 つの `cascade()` にまとめて配置。同一時間帯で重なると同じクラスタとして一緒に右へずれる。
- **【バグ修正】繰り返し予定が「開始日・月曜（平日設定時）」に表示されない（タイムゾーンずれ）**
  - 原因：RRULE 展開を UTC で行い `BYDAY` の曜日が UTC 基準 → JST で全体が1日ズレ（初回＝開始日も生成されず、平日設定で月曜が抜け土曜が入る）。
  - 方針：時刻の保存/転送はすべて UTC、繰り返しの「曜日解釈」だけクライアントが渡す TZ で行う（バックエンドに固定 TZ を持たない）。
  - `recurrence.py expand_occurrences(..., tz)`：`dtstart` を `tz` に変換して展開 → 各回を UTC に戻して返却。naive datetime は UTC 補完。`events.py` に `tz` クエリ（`_resolve_tz` で長さ/文字種を制限してから `ZoneInfo` 化）。フロントは `Intl…timeZone` を送付。`tzdata` 追加。回帰テスト `backend/tests/test_recurrence.py`（+ `requirements-dev.txt`）。
