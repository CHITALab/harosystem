# harosystem — アーキテクチャ & コーディングガイド

> 本書はシステム構成・アーキテクチャ・設計思想・コーディングルールをまとめた
> 開発者向けドキュメントです。AI アシスタント向けの要約は `CLAUDE.md` を参照。

---

## 1. システム全体構成

### 1.1 サービス構成 (Docker Compose)

| サービス | イメージ | 公開ポート | 役割 |
|---------|---------|-----------|------|
| `db` | postgres:16-alpine | (内部のみ) | データ永続化。named volume `pgdata` |
| `backend` | python:3.12-slim + uvicorn | (内部のみ) | REST API + バックグラウンド処理 |
| `frontend` | node:20-alpine (build) → nginx:alpine | 4200 (HTTP) / 4443 (HTTPS) | SPA 配信 + TLS 終端 + リバースプロキシ |

```
ブラウザ
  ├─ http://localhost:4200  ── 301 ──▶ https://localhost:4443
  └─ https://localhost:4443
        │
        Nginx (TLS 終端, 自己署名証明書)
        ├─ /api/*  → http://backend:8000  (FastAPI)
        └─ /*      → Angular SPA (index.html フォールバック)
                          │
                  backend ──▶ db (postgresql://calendar@db:5432/calendar)
```

- DB と backend はホストへポートを公開しない。外部との接点は Nginx のみ。
- フロントエンドは相対パス `/api/*` を呼ぶため、ホスト名やポートに依存しない。

### 1.2 ネットワーク MTU (重要)

`docker-compose.yml` で Docker ネットワークの MTU を **1400** に設定している。
ホストのアップリンク (USB テザリング等) が MTU 1400 の場合、ブリッジ既定の 1500 のままだと
外部サーバーへの TLS ハンドシェイクがパケットロスで**サイレントにタイムアウト**する
(ICS フィード同期が失敗する実害があった)。

```yaml
networks:
  default:
    driver_opts:
      com.docker.network.driver.mtu: 1400
```

### 1.3 運用上の注意

- backend コンテナを再作成したら `docker compose restart frontend` を実行する
  (Nginx が起動時に解決した backend の IP をキャッシュするため 502 になる)。
- `docker compose build` の成否は必ず出力で確認する (`| tail` 併用時は exit code が化ける)。

---

## 2. Nginx (frontend コンテナ)

### 2.1 役割

1. Angular SPA の静的ファイル配信
2. `/api/*` の FastAPI へのリバースプロキシ
3. HTTPS 終端 (TLS 1.2 / 1.3 のみ許可)
4. HTTP (80) → HTTPS (443) の 301 リダイレクト

### 2.2 TLS 証明書

開発環境専用の自己署名証明書を `generate-cert.sh` が Docker ビルド時に生成する
(CN=localhost / SAN=DNS:localhost,IP:127.0.0.1 / 有効期限 10 年)。
本番運用する場合は Let's Encrypt 等の正式な証明書に差し替えること。

### 2.3 プロキシヘッダー

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;   # HTTPS 経由であることを通知
```

### 2.4 SPA フォールバック

```nginx
location / { try_files $uri $uri/ /index.html; }
```

`/settings` 等の Angular Router のパスへ直接アクセス/リロードしても
index.html が返り、クライアント側でルーティングされる。

---

## 3. バックエンド (FastAPI)

### 3.1 ファイル構成と責務

```
backend/app/
├── main.py          # アプリ起動, lifespan, 起動時マイグレーション, ルーター登録
├── database.py      # SQLAlchemy engine / SessionLocal / get_db / wait_for_db
├── models.py        # ORM モデル (SQLAlchemy 2.0 Mapped 構文)
├── schemas.py       # Pydantic v2 スキーマ (バリデーションはここに集約)
├── ics.py           # ICS 生成・解析 (DB 非依存の純粋関数のみ)
├── notify.py        # Webhook 通知エンジン
└── routers/         # API ルートハンドラ (リソースごとに 1 ファイル)
    ├── events.py    tasks.py    labels.py
    ├── feeds.py     webhooks.py ics_io.py
```

**設計思想**: 層を薄く保つ。ルーター = HTTP 入出力、schemas = 検証、
models = 永続化、ics/notify = ドメインロジック。ics.py は意図的に DB 非依存
(純粋関数) にしてテストしやすくしている。

### 3.2 起動シーケンス (lifespan)

1. `wait_for_db()` — PostgreSQL の起動を待機 (最大 30 回 × 1 秒)
2. `Base.metadata.create_all()` — テーブル自動作成
3. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` — インプレースマイグレーション
4. バックグラウンドタスク起動 (`asyncio.create_task`)

### 3.3 マイグレーション戦略 (Alembic を使わない理由)

小規模プロジェクトのため、起動時に冪等な DDL を直接実行する。

- **メリット**: マイグレーションファイルの管理が不要。カラム追加が 1 行で済む
- **デメリット**: カラム削除・型変更には対応できない
- 大規模化したら Alembic を導入すること

### 3.4 同期 SQLAlchemy + asyncio.to_thread (非同期にしない理由)

DB 操作は**同期モード**。全面 async 化すると `AsyncSession` の管理が複雑になる割に、
シングルユーザー想定の本アプリでは利点がない。バックグラウンドジョブは
`asyncio.to_thread()` で同期関数をスレッドに逃がしてイベントループを塞がない。

```python
async def _periodic(name: str, interval: int, fn):
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(fn)
```

| ジョブ | 間隔 | 処理 |
|--------|------|------|
| フィード同期 | 300 秒 | 全有効フィードの ICS 再取得 → FeedEvent 全置換 |
| 通知送信 | 60 秒 | 通知時刻が来た予定/タスクを検出 → Webhook POST |

### 3.5 通知ライフサイクル

```
① 作成 (notify_enabled=True, notify_before_min=N)
② 通知ループ (60 秒ごと)
③ 条件: (開始/期限 - N分) <= now < (開始/期限 - N分) + 1h かつ notified_at IS NULL
④ 有効な全 Webhook へ POST (Discord: {"content": msg} / Slack: {"text": msg})
⑤ notified_at = now を記録 (再送防止)
⑥ 日時や通知設定を変更 → notified_at = NULL にリセット (再通知可能に)
```

- `STALE_AFTER = 1h`: サーバー停止中に通知時刻を過ぎたものを再起動時に大量送信しない
- フロントエンドの `NotificationService` も独立してブラウザ通知/トーストを出す
  (バックエンドはブラウザが閉じていても届く Webhook 担当、と役割分担)

### 3.6 フィード同期 (Full Replace 戦略)

1. `_fetch_ics(url)` で取得 — **一時的なネットワーク障害 (DNS 失敗等) は最大 3 回リトライ**。
   HTTP エラー (404 等) は URL 側の問題なのでリトライしない
2. サイズ検査 (10MB 上限) → `icalendar` でパース
3. 既存 FeedEvent を全削除 → 新規 INSERT
4. 成功: `last_synced_at` 更新・`last_error` クリア / 失敗: `last_error` に日本語メッセージ記録

**Full Replace の理由**: ICS は差分同期に対応していないため、全件入れ替えが最も単純で確実。
取得に**成功してから**削除するので、失敗時に既存データが消えることはない。

**エラーメッセージ**: `_friendly_error()` がユーザー向け日本語に変換する。
例: Google カレンダーの公開 URL が 404 → 「限定公開 URL (秘密のアドレス) を使用してください」。

### 3.7 タイムゾーンの取り扱い

- DB は全カラム `DateTime(timezone=True)` (timestamptz)。**保存は常に UTC**
- ICS の終日予定 (DATE 型) は「UTC 0:00」として保存する。
  ローカル日付への読み替えはフロントエンド側で行う (§4.7 参照)

---

## 4. フロントエンド (Angular 18)

### 4.1 ディレクトリと責務

```
frontend/src/app/
├── app.component.ts      # シェル (<router-outlet> のみ + アプリ起動時の初期化)
├── app.routes.ts         # '' → カレンダー / 'settings' → 設定 / '**' → リダイレクト
├── core/                 # 共有レイヤー (UI を持たない)
│   ├── api/              # 機能別 API サービス (event/task/label/feed/webhook/ics)
│   ├── api.service.ts    # 後方互換の再エクスポート (実体は core/api/)
│   ├── models.ts         # 型定義 (サーバーのスキーマと 1:1)
│   ├── store.service.ts  # 中央状態 (Signals) + データ取得フロー
│   ├── settings.service.ts      # ユーザー設定 (localStorage)
│   ├── notification.service.ts  # アプリ内通知 (ブラウザ通知 + トースト)
│   ├── toast.service.ts  # MatSnackBar ラッパー
│   ├── markdown.pipe.ts  # marked + DOMPurify
│   └── util.ts           # 日付ユーティリティ (純粋関数)
├── features/             # ページ・機能コンポーネント
└── ui/                   # 再利用 UI 部品 (button/badge/form-field/modal)
```

### 4.2 設計思想: HttpClient → RxJS → Signal の 3 層データフロー

```
① HttpClient — サーバー通信 (Observable<T> を返す)
② RxJS pipe  — ストリームの整形・合成・エラー処理
③ Signal     — 状態の保持とテンプレートへの反映
```

**各層の役割を混ぜないことが最重要**:

| 層 | やること | やらないこと |
|----|---------|-------------|
| API サービス | HTTP リクエスト発行、`Observable<T>` をそのまま返す | 状態保持、エラー握りつぶし |
| Store / コンポーネント | `pipe()` で整形・合成 → `signal.set()` | 直接 HTTP を呼ぶ |
| テンプレート | `signal()` / `computed()` の読み取り | subscribe、API 呼び出し |

- 状態は **Signal** (`BehaviorSubject` は使わない)。同期読み取り + テンプレート自動追跡
- 派生値は **computed** (例: `range`, `title`, `visibleFeedEvents`)
- 複数リクエストの並行は **forkJoin**、作成→再取得の連鎖は **switchMap**

### 4.3 API 層の分割

`core/api/` にドメイン単位で分割 (`event-api.service.ts` 等)。
1 ファイル肥大化を防ぎ、必要なサービスだけ `inject()` できる。
`core/api.service.ts` は既存 import を壊さないための再エクスポートで、
集約クラス `ApiService` も提供する。

### 4.4 ルーティング

Angular Router を使用。`/` = カレンダー、`/settings` = 設定。
アプリ全体で 1 回だけの初期化 (起動時ビュー適用・通知サービス起動) は
`AppComponent` のコンストラクタに置き、ページ遷移ではリセットされないようにしている。

### 4.5 ビューとドラッグ&ドロップ

| ビュー | D&D 実装 | 理由 |
|--------|---------|------|
| 月 | HTML5 Drag and Drop API | セル間移動だけなのでシンプルな API で足りる |
| 週/日 | Pointer Events + `setPointerCapture` | 15 分スナップ・リサイズに精密な制御が必要 |

週/日のドラッグは「見た目は 1px 追従、確定値は 15 分/1 日単位にスナップ」の二段構え。
重なった予定・タスクは Google カレンダー風の**カスケード表示**
(右の列ほど少し右にずらして手前に重ねる。各チップが右端まで伸びるため読みやすい)。
配置ロジックは汎用ヘルパー `cascade<T>()` に集約し、予定とタスクで共有している
(タスクは予定より手前 `z-index 20+` に積む)。

チップの表示色は **個別色 (`item.color`) > ラベル色 > 既定色** の優先順位。
背景は `color-mix()` で暗色と混ぜた不透過色にし、背面の罫線が透けないようにする。

### 4.6 キーボード操作

カレンダーページで有効 (入力フォーカス中・モーダル表示中は無効):

| キー | 動作 |
|------|------|
| ← / → | 前 / 次の期間へ |
| ↑ / ↓ | 表示モード切替 (日 ⇔ 週 ⇔ 月) |

### 4.7 終日予定とタイムゾーン (1 日ズレ問題)

ICS の終日予定はサーバーで「UTC 0:00」として保存される。画面の日付判定は
ローカル時刻で行うため、そのまま比較すると JST (UTC+9) では翌日にはみ出して
**1 日ズレて (重複して) 見える**。このため `utcDateToLocalIso()` で UTC の年月日を
ローカル日付に読み替え、Store の `visibleFeedEvents` computed で一括正規化している。
ビュー側はこの computed だけを使うこと (`feedEvents` を直接描画しない)。

### 4.8 ローカル永続化 (localStorage)

| キー | 内容 |
|------|------|
| `neon-cal-settings` | ユーザー設定 (表示名・既定ビュー・自動更新間隔・通知既定値) |
| `neon-cal-hidden-feeds` | 非表示にしたフィード ID の配列 |

読み込み時は既定値とマージし、項目追加後も古い保存データを安全に読めるようにする。
サーバーには保存しない (ブラウザごとの個人設定という思想)。

### 4.9 テーマ (cyber 名前空間)

`tailwind.config.js` で定義。**色には意味がある**:

| 色 | 値 | 意味 |
|----|----|------|
| cyan | #00f0ff | 予定、アクセント |
| magenta | #ff2bd6 | タスク |
| green | #39ff88 | 完了、成功 |
| red | #ff3b5c | 削除、危険、現在時刻線 |
| yellow | #f5e642 | 警告 |
| dim | #6f7fa8 | 補助テキスト |

フォント: Orbitron (見出し) / Share Tech Mono (本文)。

---

## 5. データベース (PostgreSQL 16)

### 5.1 テーブル関連図

```
Label ─┬──< Event      (label_id FK, ON DELETE SET NULL)
       └──< Task       (label_id FK, ON DELETE SET NULL)

Feed ────< FeedEvent   (feed_id FK, ON DELETE CASCADE)

Webhook (独立)
```

### 5.2 主要カラム

| テーブル | 主なカラム |
|---------|-----------|
| labels | name (unique), color |
| events | title, content, content_type(md/text), start_at, end_at, all_day, **color**, **notify_enabled / notify_before_min / notified_at**, label_id, **recurrence(RRULE)** |
| tasks | title, content, content_type, start_at, end_at, done, status, color, notify_*, label_id, note_id, sprint_id |
| feeds | name, url, color, enabled, last_synced_at, **last_error** |
| feed_events | feed_id, uid, title, start_at, end_at, all_day (読み取り専用キャッシュ) |
| webhooks | name, kind(discord/slack), url, enabled |

### 5.3 設計判断

- 日時は全て `timestamptz`、UTC で保存 (表示変換はフロントエンドの責務)
- `feed_events` は外部カレンダーの**キャッシュ**。正は常に外部なので Full Replace
- `notified_at` は「通知済みマーク」。日時変更でリセットされる (routers/events.py, tasks.py)
- ラベル削除で予定は消さない (SET NULL)。フィード削除で取り込んだ予定は消す (CASCADE)

---

## 6. セキュリティ

| 項目 | 対策 |
|------|------|
| XSS | Markdown は marked → **DOMPurify** でサニタイズしてから描画 |
| SQL インジェクション | SQLAlchemy ORM のみ使用 (生 SQL は起動時 DDL だけ) |
| CORS | `http://localhost:4200` / `http://127.0.0.1:4200` のみ許可 |
| SSRF | フィード URL は http/https のみ (`webcal://` は https に変換) |
| Webhook URL | **https 必須** (Pydantic バリデータで強制) |
| 入力検証 | 色 `^#[0-9a-fA-F]{6}$`、content ≤ 100,000 字、notify_before_min 0〜10,080、タスク start_at/end_at は両方指定 or 両方 null |
| リソース上限 | ICS アップロード/フィード取得 10MB、フィード 20s・Webhook 10s タイムアウト |
| TLS | 1.2/1.3 のみ。HTTP は 301 で HTTPS へ |

---

## 7. コーディングルール

### 7.1 共通

- **コメントはすべて日本語**。「何をするか」より「なぜそうするか」を書く
- 識別子 (変数・関数・クラス名) と import は英語のまま
- ファイル先頭に役割を説明するドキュメントコメントを置く

### 7.2 TypeScript / Angular

| ルール | 内容 |
|--------|------|
| Standalone Components | `standalone: true`。NgModule は使わない |
| Inline Template | template/styles は TS ファイル内に書く (全体像を 1 ファイルで把握) |
| 状態 | `signal()` / `computed()` / `effect()`。BehaviorSubject 禁止 |
| 非同期 | RxJS `pipe()`。subscribe 内でのデータ整形はしない (map で整形) |
| DI | `inject()` 関数 (コンストラクタ引数 DI は使わない) |
| 制御フロー | `@if` / `@for` (Angular 17+ 構文) |
| ui/ 配下 | `input()` / `output()` の Signal API を使う |
| Strict | `tsconfig.json` の strict: true 前提で書く |

#### RxJS オペレータ使い分け

| オペレータ | 用途 |
|-----------|------|
| `map` | レスポンス変換 (日付文字列 → Date 等) |
| `tap` | 副作用 (トースト、フォームを閉じる) |
| `catchError` | エラー処理 (必ず付ける) |
| `switchMap` | 前の結果を使う逐次リクエスト (作成 → リロード) |
| `forkJoin` | 並行リクエスト (events + tasks + feeds) |
| `finalize` | 成功/失敗を問わない後処理 (loading 解除) |

#### エラーハンドリング規約 (フロントエンド)

エラーは必ず捕捉し、トーストでユーザーに通知する。

| 操作 | エラー時 | 理由 |
|------|---------|------|
| GET | `catchError(() => of([]))` | 空配列で画面を維持 |
| POST/PUT/DELETE | `catchError(() => EMPTY)` | フォームを閉じず再送可能に |

```typescript
// ✅ 定型パターン
this.api.updateEvent(id, payload).pipe(
  catchError(() => { this.toast.error('保存に失敗しました'); return EMPTY; }),
).subscribe((item) => this.store.syncSelected('event', item));
```

### 7.3 Python / FastAPI

| ルール | 内容 |
|--------|------|
| 型ヒント | 全関数に付ける (`def f(db: Session) -> list[Event]`) |
| バリデーション | Pydantic v2 スキーマに集約。ルーターでは検証しない |
| 部分更新 | `payload.model_dump(exclude_unset=True)` で送られた項目のみ反映 |
| エラー | `HTTPException(code, detail="日本語メッセージ")` |
| 外部通信 | 必ずタイムアウトとサイズ上限を設定。一時障害はリトライ |
| ループ内の失敗 | 1 件の失敗で全体を止めない (try/except + logger.warning) |

#### ステータスコード

| コード | 用途 |
|--------|------|
| 200 / 201 / 204 | 取得・更新 / 作成 / 削除 (本文なし) |
| 400 / 404 / 409 / 413 / 422 | 不正 / 未発見 / 重複 / サイズ超過 / 検証エラー (Pydantic 自動) |
| 502 | 外部サービス接続失敗 (フィード同期・Webhook テスト) |

### 7.4 テスト

- フロントエンド: Jest + jest-preset-angular。`cd frontend && npx jest`
- 純粋関数 (util.ts, ics.py) を優先的にテストする。日付・タイムゾーン境界は必ずケース化
- サービスのテストは TestBed + HttpTestingController でモック

### 7.5 変更時のチェックリスト

1. `npx jest` が全件パスすること
2. `docker compose build frontend backend` が成功すること (出力で確認)
3. `docker compose up -d` 後、`curl -sk https://localhost:4443/api/health` が ok
4. backend を再作成した場合は `docker compose restart frontend`
5. スキーマ変更時: models.py + schemas.py + main.py の DDL + frontend models.ts の 4 点セット
