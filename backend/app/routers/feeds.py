"""外部カレンダー購読 (フィード)。

  GET    /api/feeds            : 購読一覧
  POST   /api/feeds            : 購読を追加 (追加直後に 1 回同期を試みる)
  PUT    /api/feeds/{id}       : 名前/URL/色/有効 を変更
  DELETE /api/feeds/{id}       : 購読を解除 (取り込んだ予定も消える)
  POST   /api/feeds/{id}/sync  : 手動で即時同期
  GET    /api/feeds/events     : 取り込み済み予定を期間で取得 (読み取り専用)

定期同期は main.py のバックグラウンドループ (sync_all_feeds) が行う。
"""

import logging
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..ics import parse_ics

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


# ICS レスポンスの上限サイズ (巨大レスポンスによるメモリ枯渇を防ぐ)
MAX_ICS_BYTES = 10 * 1024 * 1024  # 10 MB

# 取得リトライ回数と間隔 (テザリング等で DNS 解決が一時的に失敗することがあるため)
FETCH_RETRIES = 3
RETRY_WAIT_SEC = 2.0


def _fetch_ics(url: str) -> bytes:
    """ICS を取得する。一時的なネットワーク障害 (DNS 失敗等) はリトライで吸収する。

    HTTP エラー (404 等) は URL 側の問題なのでリトライしない。
    """
    last_exc: Exception | None = None
    for attempt in range(FETCH_RETRIES):
        try:
            resp = httpx.get(url, timeout=20, follow_redirects=True)
            resp.raise_for_status()
            return resp.content
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_exc = exc
            if attempt < FETCH_RETRIES - 1:
                time.sleep(RETRY_WAIT_SEC)
    raise last_exc  # type: ignore[misc]


def _friendly_error(exc: Exception) -> str:
    """同期エラーをユーザー向けの日本語メッセージに変換する"""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 404 and "/public/basic.ics" in str(exc.request.url):
            return (
                "404: カレンダーが一般公開されていません。"
                "Google カレンダーの「限定公開 URL (秘密のアドレス)」を使用してください"
            )
        return f"HTTP {code}: URL を確認してください"
    if isinstance(exc, httpx.TimeoutException):
        return "接続がタイムアウトしました。URL とネットワークを確認してください"
    if isinstance(exc, httpx.RequestError):
        return f"接続できませんでした: {type(exc).__name__}"
    if isinstance(exc, ValueError):
        return "ICS 形式として解析できませんでした"
    return str(exc)[:200]


def sync_feed(db: Session, feed: models.Feed) -> int:
    """フィードの URL から ICS を取得し、feed_events を入れ替える。戻り値は件数。

    成功/失敗を feed.last_synced_at / last_error に記録して UI から原因を追えるようにする。
    """
    try:
        content = _fetch_ics(feed.url)
        if len(content) > MAX_ICS_BYTES:
            raise ValueError("ICS が大きすぎます (10MB 上限)")
        event_dicts, _tasks = parse_ics(content)  # フィードは予定のみ取り込む
    except Exception as exc:
        db.rollback()
        feed.last_error = _friendly_error(exc)
        db.commit()
        raise

    # 全入れ替え (差分更新より単純で、外部が正なので問題ない)
    db.query(models.FeedEvent).filter(models.FeedEvent.feed_id == feed.id).delete()
    for d in event_dicts:
        d.pop("content_type", None)  # FeedEvent には無いカラム
        d.pop("recurrence", None)  # FeedEvent には無いカラム (取り込まない)
        db.add(models.FeedEvent(feed_id=feed.id, **d))
    feed.last_synced_at = datetime.now(timezone.utc)
    feed.last_error = None
    db.commit()
    return len(event_dicts)


def sync_all_feeds() -> None:
    """有効な全フィードを同期する (バックグラウンドループから呼ばれる)"""
    db = SessionLocal()
    try:
        for feed in db.query(models.Feed).filter(models.Feed.enabled).all():
            try:
                sync_feed(db, feed)
            except Exception as exc:  # 1 フィードの失敗で他を止めない
                logger.warning("feed sync failed (%s): %s", feed.name, exc)
                db.rollback()
    finally:
        db.close()


@router.get("", response_model=list[schemas.FeedOut])
def list_feeds(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(models.Feed)
        .filter(models.Feed.user_id == user.id)
        .order_by(models.Feed.id)
        .all()
    )


@router.post("", response_model=schemas.FeedOut, status_code=201)
def create_feed(
    payload: schemas.FeedCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    feed = models.Feed(**payload.model_dump(), user_id=user.id)
    db.add(feed)
    db.commit()
    db.refresh(feed)
    try:
        sync_feed(db, feed)  # 追加直後に初回同期
    except Exception as exc:
        logger.warning("initial feed sync failed (%s): %s", feed.name, exc)
        db.rollback()
    return feed


@router.put("/{feed_id}", response_model=schemas.FeedOut)
def update_feed(
    feed_id: int,
    payload: schemas.FeedUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    feed = db.get(models.Feed, feed_id)
    if not feed or feed.user_id != user.id:
        raise HTTPException(404, "Feed not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(feed, key, value)
    if "url" in data:  # URL を変えたら過去のエラー表示を引き継がない
        feed.last_error = None
    db.commit()
    db.refresh(feed)
    return feed


@router.delete("/{feed_id}", status_code=204)
def delete_feed(
    feed_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    feed = db.get(models.Feed, feed_id)
    if not feed or feed.user_id != user.id:
        raise HTTPException(404, "Feed not found")
    db.delete(feed)
    db.commit()


@router.post("/{feed_id}/sync", response_model=schemas.FeedOut)
def sync_feed_now(
    feed_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    feed = db.get(models.Feed, feed_id)
    if not feed or feed.user_id != user.id:
        raise HTTPException(404, "Feed not found")
    try:
        sync_feed(db, feed)
    except Exception:
        db.refresh(feed)
        raise HTTPException(502, f"同期に失敗しました: {feed.last_error}")
    db.refresh(feed)
    return feed


@router.get("/events", response_model=list[schemas.FeedEventOut])
def list_feed_events(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.FeedEvent)
        .join(models.Feed)
        .filter(models.Feed.enabled, models.Feed.user_id == user.id)
        .options(joinedload(models.FeedEvent.feed))
    )
    if start:
        q = q.filter(models.FeedEvent.end_at >= start)
    if end:
        q = q.filter(models.FeedEvent.start_at < end)
    return q.order_by(models.FeedEvent.start_at).all()
