import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..ownership import assert_label
from ..recurrence import expand_occurrences

router = APIRouter()

# IANA タイムゾーン名に使われる文字のみ許可 (例 Asia/Tokyo, Etc/GMT+9)
_TZ_NAME_RE = re.compile(r"^[A-Za-z0-9_+\-/]+$")


def _validate_event_times(start, end) -> None:
    """予定の終了は開始より後でなければならない"""
    if end <= start:
        raise HTTPException(422, "終了は開始より後にしてください")


def _resolve_tz(tz: str | None):
    """クライアントが渡した IANA タイムゾーン文字列を tzinfo にする。

    繰り返し (BYDAY) の曜日をローカルで解釈するために使う。不正/未指定なら None
    (= UTC で展開する後方互換動作)。バックエンドに固定TZを持たず、クライアント任せにする。
    """
    # 長さ・文字種を制限してから ZoneInfo に渡す (異常に長い/不正なキーで tzdata 探索が
    # 走るのを防ぐ。正規の IANA 名は十分短く、この文字種に収まる)。
    if not tz or len(tz) > 64 or not _TZ_NAME_RE.match(tz):
        return None
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        return None


@router.get("", response_model=list[schemas.EventOut])
def list_events(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    label_id: int | None = Query(None),
    tz: str | None = Query(None, description="繰り返しの曜日解釈に使う IANA TZ (例 Asia/Tokyo)"),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.Event)
        .options(joinedload(models.Event.label))
        .filter(models.Event.user_id == user.id)
    )
    if label_id:
        q = q.filter(models.Event.label_id == label_id)

    # 単発予定: 期間に重なるものだけを抽出する
    singles = q.filter(models.Event.recurrence.is_(None))
    if start:
        singles = singles.filter(models.Event.end_at >= start)
    if end:
        singles = singles.filter(models.Event.start_at < end)
    result = [
        schemas.EventOut.model_validate(e)
        for e in singles.order_by(models.Event.start_at).all()
    ]

    # 繰り返し予定: マスターを全件取得し、表示期間へ展開する (各回は仮想インスタンス)。
    # 期間 (start/end) が無ければマスターをそのまま返す。
    masters = q.filter(models.Event.recurrence.isnot(None)).all()
    if start and end:
        zone = _resolve_tz(tz)  # クライアントのTZで曜日を解釈 (時刻は UTC のまま)
        for m in masters:
            base = schemas.EventOut.model_validate(m)
            for occ_start, occ_end in expand_occurrences(
                m.recurrence, m.start_at, m.end_at, start, end, zone
            ):
                result.append(base.model_copy(update={"start_at": occ_start, "end_at": occ_end}))
    else:
        result.extend(schemas.EventOut.model_validate(m) for m in masters)

    result.sort(key=lambda e: e.start_at)
    return result


@router.get("/{event_id}", response_model=schemas.EventOut)
def get_event(
    event_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.get(models.Event, event_id)
    if not event or event.user_id != user.id:
        raise HTTPException(404, "Event not found")
    return event


@router.post("", response_model=schemas.EventOut, status_code=201)
def create_event(
    payload: schemas.EventCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_event_times(payload.start_at, payload.end_at)
    assert_label(db, user.id, payload.label_id)  # IDOR 防止
    event = models.Event(**payload.model_dump(), user_id=user.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.put("/{event_id}", response_model=schemas.EventOut)
def update_event(
    event_id: int,
    payload: schemas.EventUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.get(models.Event, event_id)
    if not event or event.user_id != user.id:
        raise HTTPException(404, "Event not found")
    data = payload.model_dump(exclude_unset=True)
    if "label_id" in data:
        assert_label(db, user.id, data["label_id"])  # IDOR 防止
    for key, value in data.items():
        setattr(event, key, value)
    # 反映後の最終状態で開始 < 終了 を検証する
    _validate_event_times(event.start_at, event.end_at)
    # 日時や通知設定が変わったら「通知済み」をリセットして再通知の対象に戻す
    if {"start_at", "notify_enabled", "notify_before_min"} & data.keys():
        event.notified_at = None
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(
    event_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.get(models.Event, event_id)
    if not event or event.user_id != user.id:
        raise HTTPException(404, "Event not found")
    db.delete(event)
    db.commit()
