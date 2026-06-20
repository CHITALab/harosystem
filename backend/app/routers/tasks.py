from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter()


def _validate_schedule(start: datetime | None, end: datetime | None) -> None:
    """タスクの開始/終了の不変条件をサーバー側で強制する。

    フロントだけでなく API 直叩き・D&D リサイズ (end_at のみ更新) でも
    「両方指定 or 両方 null」「end > start」を保証する。
    """
    if (start is None) != (end is None):
        raise HTTPException(422, "開始と終了は両方指定するか、両方未設定にしてください")
    if start is not None and end is not None and end <= start:
        raise HTTPException(422, "終了は開始より後にしてください")


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
            .order_by(models.Task.done, models.Task.start_at.nulls_last())
            .all()
        )
    if start and end:
        # 予定と同じく期間 [start, end) に重なるタスクを返す
        cond = (models.Task.start_at < end) & (models.Task.end_at > start)
        if include_no_due:
            # 未スケジュール (start_at IS NULL) のタスクも含める
            cond = cond | models.Task.start_at.is_(None)
        q = q.filter(cond)
    if label_id:
        q = q.filter(models.Task.label_id == label_id)
    return q.order_by(models.Task.done, models.Task.start_at.nulls_last()).all()


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
    _validate_schedule(payload.start_at, payload.end_at)
    task = models.Task(**payload.model_dump(), user_id=user.id)
    # 開始時刻未定 & スプリント未割当 & ステータス未指定 → バックログプールへ自動振り分け
    if (
        task.start_at is None
        and task.sprint_id is None
        and "status" not in payload.model_fields_set
    ):
        task.status = "backlog"
    # done と status の整合を取る (done=True を優先して done 状態に寄せる)
    if task.done:
        task.status = "done"
    task.done = task.status == "done"
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
    # 反映後の最終状態で開始/終了の不変条件を検証 (リサイズで end_at のみ更新でも保証)
    _validate_schedule(task.start_at, task.end_at)
    # スプリント割当の変化に応じて status を補正:
    #   - プールへ戻した (sprint_id=null) → backlog (ただし done 済みは維持して巻き戻さない)
    #   - スプリントへ割り当て & backlog だった → todo から開始 (ボードに出す)
    if "sprint_id" in data:
        if task.sprint_id is None:
            if task.status != "done":
                task.status = "backlog"
        elif task.status == "backlog":
            task.status = "todo"
    # done <-> status を同期する。明示的に渡された方を優先:
    #   - カンバンの D&D は status を送る → done を追従させる
    #   - チェックボックスは done を送る → status を todo/done に追従させる
    if "status" in data:
        task.done = task.status == "done"
    elif "done" in data:
        task.status = "done" if task.done else "todo"
    # 不変条件: done と status を最終的に一致させる (done ⇔ status=="done")
    task.done = task.status == "done"
    # 開始時刻や通知設定が変わったら「通知済み」をリセットして再通知の対象に戻す
    if {"start_at", "notify_enabled", "notify_before_min"} & data.keys():
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
