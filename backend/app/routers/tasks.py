from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..ownership import assert_label, assert_note, assert_sprint

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


def _align_label_to_sprint(db: Session, task: models.Task) -> None:
    """タスクがスプリントに属する場合、タスクのラベルをスプリントのラベルに揃える。

    「ラベル=プロジェクト」「スプリントはプロジェクトに属する」モデルを保つための不変条件。
    これにより board/backlog の表示ラベルとタスクのラベルが常に一致する。
    プール (sprint_id=null) のタスクは自分の label_id がプロジェクト帰属を表すので変更しない。
    """
    if task.sprint_id is not None:
        sprint = db.get(models.Sprint, task.sprint_id)
        if sprint is not None:
            task.label_id = sprint.label_id


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
    # 参照先 (ラベル/ノート/スプリント) の所有権を確認 (IDOR 防止)
    assert_label(db, user.id, payload.label_id)
    assert_note(db, user.id, payload.note_id)
    assert_sprint(db, user.id, payload.sprint_id)
    task = models.Task(**payload.model_dump(), user_id=user.id)
    # done を優先して done 状態に寄せる
    if task.done:
        task.status = "done"
    # 未スケジュール & スプリント未割当 & 未完了 → backlog (明示 status も上書きして不変条件を保つ)
    if task.start_at is None and task.sprint_id is None and task.status != "done":
        task.status = "backlog"
    task.done = task.status == "done"
    # スプリント所属ならラベルをスプリントに揃える (ラベル=プロジェクトの一貫性)
    _align_label_to_sprint(db, task)
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
    # 参照先 (ラベル/ノート/スプリント) を変更する場合は所有権を確認 (IDOR 防止)
    if "label_id" in data:
        assert_label(db, user.id, data["label_id"])
    if "note_id" in data:
        assert_note(db, user.id, data["note_id"])
    if "sprint_id" in data:
        assert_sprint(db, user.id, data["sprint_id"])
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
    # 未スケジュール & スプリント未割当 & 未完了 → backlog (作成時と同じ不変条件を更新でも保つ)。
    # 例: 編集フォームで開始/終了を空にしたら自動的にバックログへ落ちる。
    if task.start_at is None and task.sprint_id is None and task.status != "done":
        task.status = "backlog"
    # 不変条件: done と status を最終的に一致させる (done ⇔ status=="done")
    task.done = task.status == "done"
    # スプリント所属ならラベルをスプリントに揃える (ラベル=プロジェクトの一貫性)。
    # スプリント割当 (sprint_id 変更) でも、スプリント所属タスクのラベル単独編集でも常に成立させる。
    _align_label_to_sprint(db, task)
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
