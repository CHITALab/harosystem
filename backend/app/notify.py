"""通知の送信処理。

main.py のバックグラウンドループから毎分 send_due_notifications() が呼ばれ、
「通知 ON かつ通知時刻 (開始/期限の notify_before_min 分前) を過ぎた」
予定/タスクを有効な全 Webhook (Discord / Slack) へ送信する。

設計メモ:
  - 二重送信防止: 送信後に notified_at を記録し、未送信のものだけを対象にする。
    日時や通知設定を変更すると notified_at はリセットされる (routers 側)。
  - 古すぎる項目 (通知時刻から 1 時間以上経過) はスキップする。
    サーバ停止中に溜まった過去分を再起動時に一斉送信しないため。
  - Webhook が 1 つも無くても notified_at は進める (アプリ内通知はフロント側で行う)。
"""

import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal

logger = logging.getLogger("uvicorn.error")

# 通知時刻からこれ以上経過していたら送らない (再起動時の一斉送信防止)
STALE_AFTER = timedelta(hours=1)


def _post_webhook(hook: models.Webhook, message: str) -> None:
    """Discord / Slack の Incoming Webhook 形式で 1 件送信する"""
    payload = {"content": message} if hook.kind == "discord" else {"text": message}
    resp = httpx.post(hook.url, json=payload, timeout=10)
    resp.raise_for_status()


def _broadcast(hooks: list[models.Webhook], message: str) -> None:
    for hook in hooks:
        try:
            _post_webhook(hook, message)
        except Exception as exc:  # 1 件の失敗で他の送信先を止めない
            logger.warning("webhook send failed (%s): %s", hook.name, exc)


def _fmt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _due_items(db: Session, now: datetime) -> list[tuple[object, str]]:
    """通知すべき (モデル, メッセージ) の一覧を作る"""
    items: list[tuple[object, str]] = []

    events = (
        db.query(models.Event)
        .filter(models.Event.notify_enabled, models.Event.notified_at.is_(None))
        .all()
    )
    for ev in events:
        at = ev.start_at - timedelta(minutes=ev.notify_before_min)
        if at <= now < at + STALE_AFTER:
            items.append(
                (ev, f"📅 予定リマインド: 「{ev.title}」 {_fmt(ev.start_at)} 開始")
            )

    tasks = (
        db.query(models.Task)
        .filter(
            models.Task.notify_enabled,
            models.Task.notified_at.is_(None),
            models.Task.done.is_(False),
            models.Task.start_at.isnot(None),
        )
        .all()
    )
    for t in tasks:
        at = t.start_at - timedelta(minutes=t.notify_before_min)
        if at <= now < at + STALE_AFTER:
            items.append((t, f"✅ タスクリマインド: 「{t.title}」 {_fmt(t.start_at)} 開始"))

    return items


def send_due_notifications() -> int:
    """通知時刻を迎えた予定/タスクを Webhook へ送る。戻り値は送信件数"""
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        items = _due_items(db, now)
        if not items:
            return 0
        hooks = db.query(models.Webhook).filter(models.Webhook.enabled).all()
        for item, message in items:
            _broadcast(hooks, message)
            item.notified_at = now  # Webhook 失敗でも再送ループにしない (ログで追う)
        db.commit()
        return len(items)
    finally:
        db.close()
