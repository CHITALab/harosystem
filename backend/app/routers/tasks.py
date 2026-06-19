from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter()


@router.get("", response_model=list[schemas.TaskOut])
def list_tasks(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    label_id: int | None = Query(None),
    note_id: int | None = Query(None),
    include_no_due: bool = Query(True),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.Task)
        .options(joinedload(models.Task.label))
        .filter(models.Task.user_id == user.id)
    )
    # note_id 指定時はノート編集画面用に「紐付くタスク」を期間に関係なく返す
    if note_id is not None:
        return (
            q.filter(models.Task.note_id == note_id)
            .order_by(models.Task.done, models.Task.due_at.nulls_last())
            .all()
        )
    if start and end:
        cond = (models.Task.due_at >= start) & (models.Task.due_at < end)
        if include_no_due:
            cond = cond | models.Task.due_at.is_(None)
        q = q.filter(cond)
    if label_id:
        q = q.filter(models.Task.label_id == label_id)
    return q.order_by(models.Task.done, models.Task.due_at.nulls_last()).all()


@router.get("/{task_id}", response_model=schemas.TaskOut)
def get_task(
    task_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(models.Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(404, "Task not found")
    return task


@router.post("", response_model=schemas.TaskOut, status_code=201)
def create_task(
    payload: schemas.TaskCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = models.Task(**payload.model_dump(), user_id=user.id)
    # done と status の整合を取る (done=True を優先して done 状態に寄せる)
    if task.done:
        task.status = "done"
    elif task.status == "done":
        task.done = True
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.put("/{task_id}", response_model=schemas.TaskOut)
def update_task(
    task_id: int,
    payload: schemas.TaskUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(models.Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(404, "Task not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(task, key, value)
    # done <-> status を同期する。明示的に渡された方を優先:
    #   - カンバンの D&D は status を送る → done を追従させる
    #   - チェックボックスは done を送る → status を todo/done に追従させる
    if "status" in data:
        task.done = task.status == "done"
    elif "done" in data:
        task.status = "done" if task.done else "todo"
    # 期限や通知設定が変わったら「通知済み」をリセットして再通知の対象に戻す
    if {"due_at", "notify_enabled", "notify_before_min"} & data.keys():
        task.notified_at = None
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(models.Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(404, "Task not found")
    db.delete(task)
    db.commit()
