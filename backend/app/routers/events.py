from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

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
    if start:
        q = q.filter(models.Event.end_at >= start)
    if end:
        q = q.filter(models.Event.start_at < end)
    if label_id:
        q = q.filter(models.Event.label_id == label_id)
    return q.order_by(models.Event.start_at).all()


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
