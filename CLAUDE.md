# CLAUDE.md — harosystem 開発ガイド

> このファイルは AI コーディングアシスタント（Claude Code 等）がプロジェクトの
> コンテキストを理解し、一貫した品質のコードを生成するためのルールブックです。
> ジュニアエンジニアの学習資料としても活用できるよう、設計意図を丁寧に記載しています。

---

## 1. プロジェクト概要

**harosystem** はセルフホスト型のカレンダー Web アプリケーションです。
Google Calendar のようなリッチな UI を Docker 一発で立ち上げられることを目標にしています。

| 項目 | 技術 |
|------|------|
| フロントエンド | Angular 18 (Standalone Components, Signals) |
| スタイリング | Tailwind CSS 3 + SCSS (cyberpunk ダークテーマ) |
| UI ライブラリ | Angular Material (部分利用) |
| バックエンド | FastAPI (Python 3.12) |
| ORM | SQLAlchemy 2.0 (同期モード) |
| バリデーション | Pydantic v2 |
| データベース | PostgreSQL 16 |
| インフラ | Docker Compose (Nginx + 自己署名 TLS) |
| フォント | Orbitron (見出し), Share Tech Mono (本文) |

---

## 2. ディレクトリ構造

```
.
├── CLAUDE.md               # ← このファイル (AI / 開発者向けルール)
├── README.md               # プロジェクト概要・セットアップ手順
├── docs/
│   └── architecture.md     # アーキテクチャ詳細ドキュメント
├── docker-compose.yml      # サービス定義 (db, backend, frontend)
│
├── frontend/               # ===== Angular 18 SPA =====
│   ├── Dockerfile          # マルチステージビルド (Node → Nginx)
│   ├── generate-cert.sh    # 自己署名 TLS 証明書生成スクリプト
│   ├── nginx.conf          # Nginx 設定 (HTTPS + リバースプロキシ)
│   ├── package.json
│   ├── angular.json
│   ├── tailwind.config.js  # デザイントークン定義 (cyber 名前空間)
│   └── src/
│       ├── index.html      # HTML シェル (lang="ja")
│       ├── main.ts         # Angular ブートストラップ
│       ├── styles.scss     # グローバル CSS (Material テーマ, MD 描画)
│       └── app/
│           ├── app.component.ts    # ルートコンポーネント
│           ├── core/               # 共有レイヤー
│           │   ├── api/            # ★ 機能別 API サービス群
│           │   │   ├── api-base.ts         # ベース URL 定数
│           │   │   ├── label-api.service.ts
│           │   │   ├── event-api.service.ts
│           │   │   ├── task-api.service.ts
│           │   │   ├── feed-api.service.ts
│           │   │   ├── webhook-api.service.ts
│           │   │   ├── ics-api.service.ts
│           │   │   └── index.ts            # バレルファイル
│           │   ├── api.service.ts   # 後方互換バレル (→ api/index)
│           │   ├── models.ts        # TypeScript 型定義
│           │   ├── store.service.ts  # 状態管理 (Signals)
│           │   ├── settings.service.ts
│           │   ├── notification.service.ts
│           │   ├── toast.service.ts
│           │   ├── markdown.pipe.ts
│           │   └── util.ts
│           ├── features/           # ページ・機能コンポーネント
│           │   ├── calendar-page.component.ts
│           │   ├── time-grid.component.ts   # 週/日タイムグリッド
│           │   ├── month-view.component.ts  # 月表示
│           │   ├── sidebar.component.ts
│           │   ├── detail-panel.component.ts
│           │   ├── item-form.component.ts
│           │   ├── settings-page.component.ts
│           │   └── settings-drawer.component.ts
│           └── ui/                 # 再利用可能な UI パーツ
│               ├── badge.component.ts
│               ├── button.component.ts
│               ├── form-field.component.ts
│               └── modal.component.ts
│
└── backend/                # ===== FastAPI REST API =====
    ├── Dockerfile          # Python 3.12-slim + uvicorn
    ├── requirements.txt
    └── app/
        ├── main.py         # アプリ起動, ルーター登録, バックグラウンドタスク
        ├── database.py     # SQLAlchemy エンジン / セッション
        ├── models.py       # ORM モデル定義
        ├── schemas.py      # Pydantic リクエスト/レスポンススキーマ
        ├── ics.py          # ICS ファイル生成・パース
        ├── notify.py       # Webhook 通知エンジン
        └── routers/        # API ルートハンドラ
            ├── events.py
            ├── tasks.py
            ├── labels.py
            ├── notes.py
            ├── feeds.py
            ├── webhooks.py
            └── ics_io.py
```

---

## 3. 開発環境のセットアップ

### 3.1 起動

```bash
# 初回のみ: 環境変数ファイルを作成して認証情報を設定する
cp .env.example .env

docker compose up --build -d
```

| プロトコル | URL | 説明 |
|-----------|-----|------|
| HTTPS | `https://localhost:4443` | メイン（自己署名証明書） |
| HTTP | `http://localhost:4200` | HTTPS へ自動リダイレクト |

### 3.2 自己署名証明書について

開発環境では `frontend/generate-cert.sh` が Docker ビルド時に自動実行され、
自己署名 TLS 証明書を生成します。ブラウザの警告は「続行」で無視してください。

```
CN=localhost / SAN=DNS:localhost,IP:127.0.0.1
有効期限: 10 年
```

### 3.3 よく使うコマンド

```bash
# ログ確認
docker compose logs -f

# 再ビルド (コード変更後)
docker compose up --build -d

# 停止
docker compose down

# データも含めて完全クリーン
docker compose down -v

# ヘルスチェック
curl -sk https://localhost:4443/api/health

# テスト (フロントエンド)
cd frontend && npx jest
```

---

## 4. アーキテクチャの設計方針

> **なぜこの設計なのか**を理解すると、一貫したコードが書けます。

### 4.1 フロントエンド — Angular 18

#### Standalone Components (NgModule を使わない理由)

Angular 14 以降の **Standalone Components** を全面採用しています。
NgModule は依存関係の管理が複雑になりがちなため、
コンポーネント単位で imports を宣言する方がシンプルです。

```typescript
// ✅ 良い例 — standalone コンポーネント
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  selector: 'app-example',
  template: `...`,
})
export class ExampleComponent { }
```

#### HttpClient → RxJS → Signal のデータフロー

このプロジェクトのフロントエンドは **3 層のデータフロー** で設計しています:

```
① HttpClient    — サーバーとの通信 (Observable<T> を返す)
② RxJS          — ストリームの整形・合成・エラー処理 (pipe オペレータ)
③ Signal        — テンプレートへの反映 (signal.set で描画トリガー)
```

**なぜこの設計なのか:**
- HttpClient は Angular 標準で Observable を返す。これは変えられない
- RxJS オペレータでストリームを整形すると、複数リクエストの合成・
  リトライ・エラーハンドリングを宣言的に書ける
- Signal は同期的な読み取り + テンプレート自動追跡で描画に最適

各層の役割を混ぜないことが最も重要です:

| 層 | 使うもの | やること | やらないこと |
|----|---------|---------|-------------|
| API サービス | `HttpClient` | HTTP リクエストの発行。`Observable<T>` をそのまま返す | 状態の保持、エラーの握りつぶし |
| Store / コンポーネント | `pipe()` + RxJS オペレータ | ストリームの整形・合成・エラー処理 → `signal.set()` | 直接 HTTP を呼ぶ |
| テンプレート | `signal()` / `computed()` | 値の読み取り・表示 | subscribe、API 呼び出し |

##### 具体例 1: 基本的な取得 → Signal 反映

```typescript
// ✅ 良い例 — RxJS で整形してから Signal にセット
reload(): void {
  const [start, end] = this.range();
  const labelId = this.filterLabelId();

  this.eventApi.getEvents(start, end, labelId).pipe(
    // サーバーから返った日付文字列を Date に変換
    map(events => events.map(e => ({
      ...e,
      start_at: new Date(e.start_at),
      end_at: new Date(e.end_at),
    }))),
    catchError(err => {
      this.toast.error('予定の取得に失敗しました');
      return of([]);  // エラー時は空配列で継続
    }),
  ).subscribe(events => this.events.set(events));
}

// ❌ 悪い例 — subscribe の中で整形する (ストリーム処理の利点がない)
this.eventApi.getEvents(start, end, null).subscribe(events => {
  const converted = events.map(e => ({ ...e, start_at: new Date(e.start_at) }));
  this.events.set(converted);
});
```

##### 具体例 2: 複数リクエストの並行実行

```typescript
// ✅ 良い例 — forkJoin で並行取得し、全完了後に Signal 一括更新
reload(): void {
  const [start, end] = this.range();
  const labelId = this.filterLabelId();

  forkJoin({
    events: this.eventApi.getEvents(start, end, labelId),
    tasks:  this.taskApi.getTasks(start, end, labelId),
    feeds:  this.feedApi.getFeedEvents(start, end),
  }).pipe(
    catchError(err => {
      this.toast.error('データの取得に失敗しました');
      return EMPTY;
    }),
  ).subscribe(({ events, tasks, feeds }) => {
    this.events.set(events);
    this.tasks.set(tasks);
    this.feedEvents.set(feeds);
  });
}

// ❌ 悪い例 — 3 つの subscribe をバラバラに発火 (順序不定、エラー処理がバラバラ)
this.eventApi.getEvents(start, end, labelId).subscribe(e => this.events.set(e));
this.taskApi.getTasks(start, end, labelId).subscribe(t => this.tasks.set(t));
this.feedApi.getFeedEvents(start, end).subscribe(f => this.feedEvents.set(f));
```

##### 具体例 3: 作成 → 再取得の逐次実行

```typescript
// ✅ 良い例 — switchMap で作成成功後にリロード
saveEvent(data: Partial<EventItem>): void {
  this.eventApi.createEvent(data).pipe(
    tap(created => this.toast.success(`「${created.title}」を作成しました`)),
    switchMap(() => this.eventApi.getEvents(...this.range(), this.filterLabelId())),
    catchError(err => {
      this.toast.error('予定の作成に失敗しました');
      return EMPTY;
    }),
  ).subscribe(events => {
    this.events.set(events);
    this.closeForm();
  });
}
```

##### 具体例 4: Signal と RxJS の使い分け

```typescript
// 状態の保持 → Signal
readonly events = signal<EventItem[]>([]);
readonly loading = signal(false);

// 派生値の計算 → computed
readonly todayEvents = computed(() =>
  this.events().filter(e => isSameDay(new Date(e.start_at), new Date()))
);

// 非同期データの取得・整形 → RxJS pipe
this.eventApi.getEvents(start, end, null).pipe(
  map(events => events.filter(e => !e.all_day)),
  catchError(() => of([])),
).subscribe(events => this.events.set(events));

// ❌ Signal で非同期処理を書こうとしない
// ❌ RxJS Subject/BehaviorSubject で状態を持たない
```

#### RxJS オペレータの使い分けガイド

| オペレータ | 用途 | 例 |
|-----------|------|----|
| `map` | レスポンスデータの変換 | 日付文字列 → Date オブジェクト |
| `tap` | 副作用 (ログ、トースト通知) | `tap(() => this.toast.success('保存'))` |
| `catchError` | エラーハンドリング | `catchError(() => of([]))` |
| `switchMap` | 前のリクエスト結果を使って次のリクエスト | 作成 → リロード |
| `forkJoin` | 複数リクエストの並行実行 | events + tasks + feeds 同時取得 |
| `finalize` | 完了時の処理 (成功/失敗問わず) | `finalize(() => this.loading.set(false))` |
| `retry` | 失敗時の自動リトライ | `retry(2)` (最大2回リトライ) |
| `debounceTime` | 連続入力の間引き | 検索フィールドの入力 |
| `distinctUntilChanged` | 同じ値の連続をスキップ | フィルタ変更の重複防止 |
| `EMPTY` | 何も emit せず完了 | エラー時にストリームを終了 |
| `of(...)` | フォールバック値を emit | エラー時にデフォルト値で継続 |

#### Signals による状態管理 (BehaviorSubject を使わない理由)

Angular 16 以降の **Signals** を UI 状態の保持に使用しています。
RxJS の `BehaviorSubject` と比べて以下のメリットがあります:

- 値の読み取りが `signal()` で同期的に行える
- テンプレートで自動追跡されるため `async` パイプ不要
- `computed()` で派生値を宣言的に定義できる

```typescript
// ✅ Signal で状態管理 (このプロジェクトの方針)
events = signal<CalEvent[]>([]);
loading = signal(false);
todayEvents = computed(() =>
  this.events().filter(e => isSameDay(new Date(e.start_at), new Date()))
);

// ❌ BehaviorSubject で状態管理 (このプロジェクトでは使わない)
events$ = new BehaviorSubject<CalEvent[]>([]);
```

**RxJS は「非同期ストリームの処理」に使い、Signal は「状態の保持と描画」に使う。**
両者は競合ではなく補完関係です。

#### Signal Inputs / Outputs (新しいコンポーネント API)

UI コンポーネント（`ui/` 配下）では Angular 17 以降の新しい API を使用:

```typescript
// ✅ 新しい API (ui/ コンポーネントで使用)
kind = input.required<'event' | 'task'>();
closed = output<void>();

// ⚠️ 従来の API (features/ コンポーネントでは併用可)
@Input({ required: true }) selected!: Selected;
```

#### Inline Templates (テンプレートファイルを分離しない理由)

このプロジェクトではコンポーネントの template と styles を
TypeScript ファイル内にインラインで記述します。
ファイル数を減らし、コンポーネントの全体像を一目で把握するためです。

```typescript
@Component({
  template: `
    <div class="...">{{ title }}</div>
  `,
  styles: [`
    :host { display: block; }
  `],
})
```

#### API サービスの設計 (機能別ファイル分割)

API 通信は `core/api/` 配下に **機能ごと** にファイルを分割しています:

| ファイル | 責務 |
|---------|------|
| `api-base.ts` | ベース URL 定数、共通定義 |
| `label-api.service.ts` | ラベルの CRUD |
| `event-api.service.ts` | イベントの CRUD + 日付範囲フィルタ |
| `task-api.service.ts` | タスクの CRUD |
| `feed-api.service.ts` | 外部カレンダーフィードの管理・同期 |
| `webhook-api.service.ts` | Webhook の CRUD + テスト送信 |
| `ics-api.service.ts` | ICS ファイルのインポート |

**設計意図**: 1 ファイルに全 API を詰め込むと肥大化して見通しが悪くなるため、
ドメイン単位で分割しています。各サービスは `@Injectable({ providedIn: 'root' })`
で独立しており、必要なサービスだけを `inject()` で注入できます。

後方互換性のため `core/api.service.ts` がバレルファイルとして残っており、
既存のインポートパスはそのまま動作します。

#### テーマカラー (cyber 名前空間)

`tailwind.config.js` で定義:

```
bg:      #07070f (最も暗い背景)
bg2:     (パネル背景)
bg3:     (入力フィールド背景)
cyan:    #00f0ff (イベント、アクセント)
magenta: #ff2bd6 (タスク)
green:   #39ff88 (完了、成功)
red:     #ff3b5c (削除、危険、現在時刻線)
yellow:  #f5e642 (警告)
dim:     #6f7fa8 (薄いテキスト)
line:    rgba(0, 240, 255, 0.10) (区切り線)
```

**色の意味**: Cyan = イベント、Magenta = タスク、Green = 完了、Red = 危険/現在時刻

#### ドラッグ&ドロップ

| ビュー | 実装方式 | 理由 |
|--------|---------|------|
| 月表示 | HTML5 Drag and Drop API | セル間の移動だけなのでシンプル |
| 週/日表示 | Pointer Events + `setPointerCapture` | 時間のスナップ (15分単位) やリサイズに精密な制御が必要 |

### 4.2 バックエンド — FastAPI + SQLAlchemy

#### マイグレーション戦略 (Alembic を使わない理由)

小規模プロジェクトのため、`main.py` の起動時に直接 DDL を実行します:

```python
# main.py の lifespan 内
conn.execute(text("""
    ALTER TABLE events ADD COLUMN IF NOT EXISTS color VARCHAR(20)
"""))
```

**メリット**: Alembic の設定・マイグレーションファイル管理が不要。
**デメリット**: カラムの削除・型変更には対応できない。
大規模化した場合は Alembic 導入を検討してください。

#### 同期 SQLAlchemy + asyncio.to_thread (非同期にしない理由)

SQLAlchemy は **同期モード** で使用しています。
FastAPI 自体は非同期ですが、DB 操作をすべて async 化すると
`AsyncSession` の管理が複雑になるためです。

バックグラウンドタスク（フィード同期、通知）は
`asyncio.to_thread()` で同期関数をスレッドに逃がします:

```python
async def _periodic(name: str, interval: int, fn):
    """指定間隔で同期関数を繰り返し実行するヘルパー"""
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(fn)
```

#### バックグラウンドタスク

| タスク | 間隔 | 処理 |
|--------|------|------|
| フィード同期 | 300 秒 | 全有効フィードの ICS を再取得 → FeedEvent 全置換 |
| 通知送信 | 60 秒 | 未通知の予定・タスクを検出 → Webhook 送信 |

#### 通知のライフサイクル

```
① イベント作成 (notify_enabled=True, notify_before_min=10)
② バックグラウンドループ (60 秒ごと)
③ start_at - 10min <= now ?  かつ  notified_at IS NULL ?
④ Webhook POST (Discord/Slack)
⑤ notified_at = now (再送防止)
⑥ start_at を変更 → notified_at = NULL にリセット (再通知可能に)
```

`STALE_AFTER = 1h` により、サーバー再起動後の大量再送を防止。

#### フィード同期の仕組み

1. `httpx.get(url)` で ICS データ取得 (上限 10MB, タイムアウト 20s)
2. `icalendar` ライブラリでパース
3. 既存の FeedEvent を全削除 → 新規 INSERT (**Full Replace 戦略**)
4. 成功時: `last_synced_at` を更新 / 失敗時: `last_error` にエラーメッセージを記録

**Full Replace の理由**: ICS は差分同期に対応していないため、
毎回全件を取り込み直すのが最もシンプルで確実。

#### Pydantic バリデーション

- **色**: `^#[0-9a-fA-F]{6}$` の正規表現で `#rrggbb` 形式を強制
- **URL**: `http://` または `https://` のみ。`webcal://` は自動的に `https://` に変換
- **Webhook URL**: `https://` を強制
- **通知タイミング**: `notify_before_min` は 0〜10,080（最大 1 週間前）
- **タスク所要時間**: `duration_min` は 1〜1,440（最大 24 時間）
- **コンテンツ**: 最大 100,000 文字

### 4.3 インフラ — Docker Compose + Nginx

#### HTTPS (自己署名証明書)

```
ブラウザ
  │
  ├─ http://localhost:4200  → 301 → https://localhost:4443
  │
  └─ https://localhost:4443
       │
       Nginx (TLS 終端)
       ├─ /api/*  → http://backend:8000 (FastAPI)
       └─ /*      → Angular SPA (index.html フォールバック)
```

- `generate-cert.sh` が Docker ビルド時に自己署名証明書を自動生成
- TLS 1.2 / 1.3 のみ許可
- `X-Forwarded-Proto` ヘッダーでバックエンドに HTTPS 経由であることを通知

#### ネットワーク MTU

Docker ネットワークの MTU を 1400 に設定（`docker-compose.yml`）。
ホストの MTU が 1400（USB テザリング等）の場合、これを設定しないと
外部 ICS フィード取得時に TLS ハンドシェイクがパケットロスで失敗する。

---

## 5. コーディング規約

### 5.1 コメント

> **すべてのコメントは日本語で書く。**

```typescript
// ✅ 良い例
/** 指定された日付範囲のイベントを取得する */

// ❌ 悪い例
/** Get events for the given date range */
```

ただし、以下は英語のまま:
- コード識別子 (変数名、関数名、クラス名)
- import 文
- Angular デコレータのプロパティ名

### 5.2 TypeScript (フロントエンド)

| ルール | 例 |
|--------|-----|
| Standalone Components を使う | `standalone: true` |
| 状態の保持は Signals | `signal()`, `computed()`, `effect()` |
| 非同期ストリーム処理は RxJS pipe | `pipe(map(...), catchError(...))` |
| DI は `inject()` 関数 | `private api = inject(EventApiService)` |
| テンプレートは `@if` / `@for` 構文 | Angular 17+ 制御フロー |
| Strict モード | `tsconfig.json` の `strict: true` |
| API サービスは機能別ファイル | `core/api/event-api.service.ts` |

### 5.3 Python (バックエンド)

| ルール | 例 |
|--------|-----|
| 型ヒントを全関数に付ける | `def get_events(db: Session) -> list[Event]` |
| Pydantic v2 スキーマ | `class EventCreate(BaseModel)` |
| ステータスコードの使い分け | 201 (作成), 204 (削除), 404 (未発見), 409 (重複) |
| ユーザー向けエラーは日本語 | `_friendly_error()` のフィード同期エラー等 |

### 5.4 コメントの書き方ガイド

```typescript
/**
 * イベント API サービス
 *
 * カレンダーイベントの CRUD 操作を提供する。
 * HttpClient で Observable を返し、呼び出し側が RxJS pipe で
 * ストリームを整形してから Signal にセットする。
 *
 * @example
 * // StoreService での使い方
 * private eventApi = inject(EventApiService);
 *
 * // イベント一覧を取得 → RxJS で整形 → Signal に反映
 * this.eventApi.getEvents(start, end, null).pipe(
 *   map(events => events.filter(e => !e.all_day)),
 *   catchError(err => {
 *     this.toast.error('取得に失敗しました');
 *     return of([]);
 *   }),
 * ).subscribe(events => this.events.set(events));
 */
```

### 5.5 エラーハンドリング規約

エラー処理はアプリの品質を大きく左右します。以下のルールを必ず守ってください。

#### 原則: エラーは必ず捕捉し、ユーザーに通知する

```typescript
// ✅ 良い例 — catchError でトースト通知 + フォールバック
this.eventApi.getEvents(start, end, null).pipe(
  catchError(err => {
    this.toast.error('予定の取得に失敗しました');
    console.error('[EventApi] getEvents failed:', err);
    return of([]);  // フォールバック値で画面を壊さない
  }),
).subscribe(events => this.events.set(events));

// ❌ 悪い例 — エラー処理なし (画面が壊れる / ユーザーに何も伝わらない)
this.eventApi.getEvents(start, end, null)
  .subscribe(events => this.events.set(events));
```

#### フロントエンド: 操作別エラー戦略

| 操作 | エラー時の対処 | 理由 |
|------|--------------|------|
| **読み取り (GET)** | `catchError(() => of([]))` + トースト | 空配列で画面を維持 |
| **作成 (POST)** | `catchError(() => EMPTY)` + トースト | フォームを閉じない (再送可能に) |
| **更新 (PUT)** | `catchError(() => EMPTY)` + トースト | 旧データのまま表示 |
| **削除 (DELETE)** | `catchError(() => EMPTY)` + トースト | 削除を取り消す必要なし |
| **フィード同期** | `catchError` + 詳細エラーメッセージ | ネットワーク / URL の問題を特定 |

#### フロントエンド: HTTP ステータスコード別の処理

```typescript
// ステータスコードに応じた日本語メッセージ
function httpErrorMessage(err: HttpErrorResponse): string {
  switch (err.status) {
    case 0:   return 'サーバーに接続できません';
    case 400: return '入力内容に誤りがあります';
    case 404: return '対象のデータが見つかりません';
    case 409: return '同名のデータが既に存在します';
    case 413: return 'ファイルサイズが大きすぎます';
    case 500: return 'サーバー内部エラーが発生しました';
    case 502: return 'バックエンドが応答していません';
    default:  return `通信エラー (${err.status})`;
  }
}
```

#### フロントエンド: loading 状態の管理

```typescript
// ✅ 良い例 — finalize で必ず loading を解除
readonly loading = signal(false);

reload(): void {
  this.loading.set(true);
  forkJoin({ ... }).pipe(
    catchError(err => {
      this.toast.error('データの取得に失敗しました');
      return EMPTY;
    }),
    finalize(() => this.loading.set(false)),  // 成功でも失敗でも必ず実行
  ).subscribe(data => { ... });
}
```

#### フロントエンド: subscribe の解除

```typescript
// ✅ HttpClient の Observable は自動完了するため、通常は解除不要
// ただし、コンポーネント内でストリームを保持する場合は DestroyRef を使う

private destroyRef = inject(DestroyRef);

ngOnInit(): void {
  interval(30_000).pipe(
    takeUntilDestroyed(this.destroyRef),
  ).subscribe(() => this.reload());
}
```

#### バックエンド: API エラーレスポンスの規約

```python
# ✅ 良い例 — 適切なステータスコードと日本語メッセージ
from fastapi import HTTPException

@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(404, detail="指定された予定が見つかりません")
    db.delete(event)
    db.commit()

# ✅ バリデーションエラーは Pydantic が自動で 422 を返す
# ✅ 重複エラーは 409 を返す
@router.post("/labels", status_code=201)
def create_label(body: LabelCreate, db: Session = Depends(get_db)):
    if db.query(Label).filter(Label.name == body.name).first():
        raise HTTPException(409, detail=f"ラベル '{body.name}' は既に存在します")
```

#### バックエンド: ステータスコードの使い分け

| コード | 意味 | 使用場面 |
|--------|------|----------|
| 200 | OK | 取得・更新成功 |
| 201 | Created | リソース作成成功 |
| 204 | No Content | 削除成功 (レスポンスボディなし) |
| 400 | Bad Request | 不正なリクエスト |
| 404 | Not Found | リソースが存在しない |
| 409 | Conflict | 名前の重複等 |
| 413 | Payload Too Large | ファイルサイズ超過 |
| 422 | Unprocessable Entity | バリデーションエラー (Pydantic 自動) |
| 500 | Internal Server Error | サーバー内部エラー |
| 502 | Bad Gateway | 外部サービスへの接続失敗 (フィード同期) |

---

## 6. API エンドポイント一覧

すべてのエンドポイントは `/api` プレフィクス付き。

| リソース | パス | メソッド |
|---------|------|---------|
| ヘルスチェック | `/api/health` | GET |
| ラベル | `/api/labels` | GET, POST |
| ラベル (個別) | `/api/labels/{id}` | PUT, DELETE |
| イベント | `/api/events` | GET, POST |
| イベント (個別) | `/api/events/{id}` | GET, PUT, DELETE |
| タスク | `/api/tasks` | GET, POST |
| タスク (個別) | `/api/tasks/{id}` | GET, PUT, DELETE |
| ノート | `/api/notes` | GET, POST |
| ノート (個別) | `/api/notes/{id}` | GET, PUT, DELETE |
| フィード | `/api/feeds` | GET, POST |
| フィード (個別) | `/api/feeds/{id}` | PUT, DELETE |
| フィード同期 | `/api/feeds/{id}/sync` | POST |
| フィードイベント | `/api/feeds/events` | GET |
| Webhook | `/api/webhooks` | GET, POST |
| Webhook (個別) | `/api/webhooks/{id}` | PUT, DELETE |
| Webhook テスト | `/api/webhooks/{id}/test` | POST |
| ICS エクスポート | `/api/ics/export` | GET |
| ICS インポート | `/api/ics/import` | POST (multipart) |

---

## 7. データベース

### 7.1 接続情報

| 項目 | 値 |
|------|-----|
| RDBMS | PostgreSQL 16 (Alpine) |
| ユーザー | `${POSTGRES_USER}` (.env で設定) |
| パスワード | `${POSTGRES_PASSWORD}` (.env で設定) |
| データベース | `${POSTGRES_DB}` (.env で設定) |
| 接続文字列 | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}` |
| ボリューム | `pgdata` (Docker named volume) |

> 認証情報はリポジトリにコミットしない。`cp .env.example .env` で作成し、
> 各自の環境で値を設定すること (.env は .gitignore 済み)。

### 7.2 テーブル関連図

```
Label ─┬──< Event
       ├──< Task
       └──< Note

Note ────< Task   (note_id, ON DELETE SET NULL)

Feed ────< FeedEvent

Webhook (独立)
```

- Label → Event/Task/Note: `label_id` FK (ON DELETE SET NULL)
- Note → Task: `note_id` FK (ON DELETE SET NULL — ノート削除でタスクは残る)
- Feed → FeedEvent: `feed_id` FK (ON DELETE CASCADE)

---

## 8. 制約・制限値

| 項目 | 制限 |
|------|------|
| ICS ファイルアップロード | 10 MB |
| 外部フィード取得 | 10 MB, 20 秒タイムアウト |
| Webhook POST | 10 秒タイムアウト |
| `notify_before_min` | 0〜10,080 (最大 1 週間前) |
| `duration_min` | 1〜1,440 (最大 24 時間) |
| `content` | 最大 100,000 文字 |
| フロントエンドバンドル | initial 2MB warn / 5MB error |

---

## 9. トラブルシューティング

### 自己署名証明書のブラウザ警告

開発環境では自己署名証明書を使用するため、ブラウザが警告を表示します。
Chrome: 「詳細設定」→「localhost にアクセスする（安全ではありません）」で続行。

### 外部フィード同期が失敗する

1. `docker compose logs backend` でエラーメッセージを確認
2. MTU の不一致が原因の可能性あり（`docker-compose.yml` の MTU 設定を確認）
3. Google Calendar の場合、「限定公開 URL」を使用すること（通常の URL は 404）

### DB をリセットしたい

```bash
docker compose down -v    # ボリュームも削除
docker compose up --build -d
```
