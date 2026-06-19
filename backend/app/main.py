import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

import bcrypt

from . import models, notify  # noqa: F401  (register models)
from .database import Base, engine, wait_for_db
from .routers import auth, events, feeds, ics_io, labels, notes, tasks, webhooks

logger = logging.getLogger("uvicorn.error")

FEED_SYNC_INTERVAL_SEC = 300  # 外部カレンダーの自動同期間隔 (5 分)
NOTIFY_INTERVAL_SEC = 60  # 通知判定の間隔 (1 分)

wait_for_db()
Base.metadata.create_all(bind=engine)

# lightweight in-place migrations for columns added after first release
with engine.begin() as conn:
    for ddl in (
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_min INTEGER",
        # タイル個別色 + 通知設定 (2026-06 追加)
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS color VARCHAR(20)",
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS notify_enabled BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS notify_before_min INTEGER NOT NULL DEFAULT 10",
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS color VARCHAR(20)",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notify_enabled BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notify_before_min INTEGER NOT NULL DEFAULT 10",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ",
        "ALTER TABLE feeds ADD COLUMN IF NOT EXISTS last_error VARCHAR(500)",
        # ノート機能 (2026-06 追加): タスクからノートへの紐付け
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS note_id INTEGER",
        # カンバン機能 (2026-06 追加): タスクのステータス (todo|in_progress|done)
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'todo'",
        # 既存タスクの done から status をバックフィル (done=True のものを done に)
        "UPDATE tasks SET status = 'done' WHERE done = TRUE AND status = 'todo'",
        # ラベル既定の通知設定 (2026-06 追加)
        "ALTER TABLE labels ADD COLUMN IF NOT EXISTS notify_default BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE labels ADD COLUMN IF NOT EXISTS notify_before_min_default INTEGER NOT NULL DEFAULT 10",
    ):
        conn.execute(text(ddl))

# ── 認証マイグレーション (2026-06): users テーブル + user_id FK ──
# users テーブルは create_all() で作成済み。デフォルトユーザーを挿入し、
# 既存データの帰属先とする。
with engine.begin() as conn:
    # ① デフォルトユーザーを挿入 (冪等)
    # bcrypt でデフォルトユーザーのパスワードハッシュを生成
    default_pw_hash = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()
    conn.execute(text(
        "INSERT INTO users (id, username, hashed_password) "
        "VALUES (1, 'admin', :pw) ON CONFLICT (id) DO NOTHING"
    ), {"pw": default_pw_hash})

    # ② 各テーブルに user_id カラムを追加 (nullable → バックフィル → NOT NULL)
    for table in ("labels", "events", "tasks", "feeds", "webhooks"):
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS user_id INTEGER"))
        conn.execute(text(f"UPDATE {table} SET user_id = 1 WHERE user_id IS NULL"))
        # NOT NULL 制約を付与 (すでに NOT NULL ならエラーにならない)
        conn.execute(text(
            f"ALTER TABLE {table} ALTER COLUMN user_id SET NOT NULL"
        ))
        conn.execute(text(
            f"ALTER TABLE {table} ALTER COLUMN user_id SET DEFAULT 1"
        ))
        # FK 制約を追加 (冪等: 既に存在すれば何もしない)
        conn.execute(text(f"""
            DO $$ BEGIN
                ALTER TABLE {table}
                    ADD CONSTRAINT fk_{table}_user
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """))

    # ③ labels の unique 制約を (name) → (user_id, name) に移行
    # 旧制約を安全に削除し、新しい複合制約を追加する
    conn.execute(text("""
        DO $$ BEGIN
            ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_name_key;
        EXCEPTION WHEN undefined_object THEN NULL;
        END $$;
    """))
    conn.execute(text("""
        DO $$ BEGIN
            ALTER TABLE labels
                ADD CONSTRAINT uq_labels_user_name UNIQUE (user_id, name);
        -- UNIQUE 制約は裏でインデックス (リレーション) を作るため、既存時は
        -- duplicate_object ではなく duplicate_table が送出される。両方を握る。
        EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
        END $$;
    """))

    # ④ tasks.note_id の FK 制約 (ノート削除時は SET NULL でタスクは残す)。
    # notes テーブルは create_all() で作成済みなのでこの時点で参照できる。
    conn.execute(text("""
        DO $$ BEGIN
            ALTER TABLE tasks
                ADD CONSTRAINT fk_tasks_note
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))


async def _periodic(name: str, interval_sec: int, fn) -> None:
    """同期関数 fn を interval_sec ごとにスレッドで実行する汎用ループ"""
    while True:
        try:
            # DB/HTTP は同期処理なのでスレッドへ逃がしてイベントループを塞がない
            await asyncio.to_thread(fn)
        except Exception as exc:
            logger.warning("%s loop error: %s", name, exc)
        await asyncio.sleep(interval_sec)


@asynccontextmanager
async def lifespan(_: FastAPI):
    loops = [
        asyncio.create_task(_periodic("feed sync", FEED_SYNC_INTERVAL_SEC, feeds.sync_all_feeds)),
        asyncio.create_task(
            _periodic("notify", NOTIFY_INTERVAL_SEC, notify.send_due_notifications)
        ),
    ]
    yield
    for t in loops:
        t.cancel()


app = FastAPI(title="harosystem API", lifespan=lifespan)

# 通常は nginx 経由の同一オリジンなので CORS は不要だが、
# 開発時 (ng serve :4200 → :8000 直叩き) のためにローカルのみ許可する。
# ワイルドカード許可はブラウザ起点の攻撃面を広げるため使わない。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(labels.router, prefix="/api/labels", tags=["labels"])
app.include_router(notes.router, prefix="/api/notes", tags=["notes"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(feeds.router, prefix="/api/feeds", tags=["feeds"])
app.include_router(ics_io.router, prefix="/api/ics", tags=["ics"])
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["webhooks"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
