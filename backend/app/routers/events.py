from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..recurrence import expand_occurrences

router = APIRouter()


@router.get("", response_model=list[schemas.EventOut])
def list_events(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    label_id: int | None = Query(None),
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
        for m in masters:
            base = schemas.EventOut.model_validate(m)
            for occ_start, occ_end in expand_occurrences(
                m.recurrence, m.start_at, m.end_at, start, end
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
    for key, value in data.items():
        setattr(event, key, value)
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
