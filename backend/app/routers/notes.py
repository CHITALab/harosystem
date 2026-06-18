"""ノート (Markdown) の CRUD エンドポイント。

プロジェクト (Label) に紐づくノートを管理する。すべて認証ユーザー単位で
スコープし、他ユーザーのノートには触れられないようにする。
タスクとの紐付け (Note 1:N Task) は Task 側の note_id で表現するため、
紐付け/解除は tasks ルーターの更新 (note_id の変更) で行う。
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter()


def _attach_counts(db: Session, user_id: int, notes: list[models.Note]) -> None:
    """各ノートの紐付きタスク件数をまとめて集計し、task_count に詰める (N+1 回避)"""
    if not notes:
        return
    rows = (
        db.query(models.Task.note_id, func.count(models.Task.id))
        .filter(models.Task.user_id == user_id, models.Task.note_id.isnot(None))
        .group_by(models.Task.note_id)
        .all()
    )
    counts = dict(rows)
    for note in notes:
        note.task_count = counts.get(note.id, 0)


@router.get("", response_model=list[schemas.NoteOut])
def list_notes(
    label_id: int | None = Query(None),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.Note)
        .options(joinedload(models.Note.label))
        .filter(models.Note.user_id == user.id)
    )
    if label_id:
        q = q.filter(models.Note.label_id == label_id)
    notes = q.order_by(models.Note.updated_at.desc()).all()
    _attach_counts(db, user.id, notes)
    return notes


@router.get("/{note_id}", response_model=schemas.NoteOut)
def get_note(
    note_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = db.get(models.Note, note_id)
    if not note or note.user_id != user.id:
        raise HTTPException(404, "指定されたノートが見つかりません")
    _attach_counts(db, user.id, [note])
    return note


@router.post("", response_model=schemas.NoteOut, status_code=201)
def create_note(
    payload: schemas.NoteCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = models.Note(**payload.model_dump(), user_id=user.id)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.put("/{note_id}", response_model=schemas.NoteOut)
def update_note(
    note_id: int,
    payload: schemas.NoteUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = db.get(models.Note, note_id)
    if not note or note.user_id != user.id:
        raise HTTPException(404, "指定されたノートが見つかりません")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(note, key, value)
    db.commit()
    db.refresh(note)
    _attach_counts(db, user.id, [note])
    return note


@router.delete("/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = db.get(models.Note, note_id)
    if not note or note.user_id != user.id:
        raise HTTPException(404, "指定されたノートが見つかりません")
    # note_id は SET NULL のため、紐付くタスクは残り紐付けだけが外れる
    db.delete(note)
    db.commit()
