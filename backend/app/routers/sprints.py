"""スプリント (実行期間) の CRUD + 開始/完了エンドポイント。

Jira 風のバックログ/スプリント管理で使う。すべて認証ユーザー単位でスコープする。
同時に active なスプリントは 1 つだけ (start 時に他の active があれば 409)。
スプリント削除時は tasks.sprint_id が SET NULL され、タスクはバックログプールへ戻る。
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter()


def _get_owned(db: Session, user: models.User, sprint_id: int) -> models.Sprint:
    """自分のスプリントを取得する。無ければ 404"""
    sprint = db.get(models.Sprint, sprint_id)
    if not sprint or sprint.user_id != user.id:
        raise HTTPException(404, "指定されたスプリントが見つかりません")
    return sprint


@router.get("", response_model=list[schemas.SprintOut])
def list_sprints(
    label_id: int | None = Query(None),
    unlabeled: bool = Query(False),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(models.Sprint).filter(models.Sprint.user_id == user.id)
    # ラベル単位で分離: label_id 指定でそのラベル、unlabeled=true で未分類 (label_id NULL)
    if unlabeled:
        q = q.filter(models.Sprint.label_id.is_(None))
    elif label_id is not None:
        q = q.filter(models.Sprint.label_id == label_id)
    return q.order_by(models.Sprint.created_at).all()


@router.post("", response_model=schemas.SprintOut, status_code=201)
def create_sprint(
    payload: schemas.SprintCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # ラベル越境 (IDOR) 防止: 指定ラベルが自分の所有であることを確認する
    if payload.label_id is not None:
        label = db.get(models.Label, payload.label_id)
        if not label or label.user_id != user.id:
            raise HTTPException(404, "指定されたラベルが見つかりません")
    sprint = models.Sprint(**payload.model_dump(), user_id=user.id)
    db.add(sprint)
    db.commit()
    db.refresh(sprint)
    return sprint


@router.put("/{sprint_id}", response_model=schemas.SprintOut)
def update_sprint(
    sprint_id: int,
    payload: schemas.SprintUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sprint = _get_owned(db, user, sprint_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(sprint, key, value)
    db.commit()
    db.refresh(sprint)
    return sprint


@router.post("/{sprint_id}/start", response_model=schemas.SprintOut)
def start_sprint(
    sprint_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """スプリントを開始する。他に active なスプリントがあれば 409 で拒否する"""
    sprint = _get_owned(db, user, sprint_id)
    if sprint.state == "completed":
        raise HTTPException(400, "完了したスプリントは再開できません")
    # アクティブは「同じラベル内で1つ」に制限する (ラベル単位で分離管理するため)
    conflict = (
        db.query(models.Sprint)
        .filter(
            models.Sprint.user_id == user.id,
            models.Sprint.state == "active",
            models.Sprint.id != sprint_id,
            models.Sprint.label_id.is_(None)
            if sprint.label_id is None
            else models.Sprint.label_id == sprint.label_id,
        )
        .first()
    )
    if conflict:
        raise HTTPException(409, "このラベルには既にアクティブなスプリントがあります。先に完了させてください")
    sprint.state = "active"
    db.commit()
    db.refresh(sprint)
    return sprint


@router.post("/{sprint_id}/complete", response_model=schemas.SprintOut)
def complete_sprint(
    sprint_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """スプリントを完了する。未完了タスクはバックログプールへ退避する"""
    sprint = _get_owned(db, user, sprint_id)
    # 未完了タスク (done 以外) はプールへ戻す (done は履歴としてスプリントに残す)。
    # これにより完了スプリントに未完了タスクが取り残されない。
    db.query(models.Task).filter(
        models.Task.sprint_id == sprint_id,
        models.Task.status != "done",
    ).update(
        {models.Task.sprint_id: None, models.Task.status: "backlog"},
        synchronize_session=False,
    )
    sprint.state = "completed"
    db.commit()
    db.refresh(sprint)
    return sprint


@router.delete("/{sprint_id}", status_code=204)
def delete_sprint(
    sprint_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sprint = _get_owned(db, user, sprint_id)
    # sprint_id は SET NULL でプールへ戻るが status はそのまま残るため、
    # 不変条件 (sprint_id=null ⇒ status=backlog) を保つよう未完了タスクを backlog に戻す。
    # done 済みのタスクは完了状態を維持する (巻き戻さない)。
    db.query(models.Task).filter(
        models.Task.sprint_id == sprint_id,
        models.Task.status != "done",
    ).update({models.Task.status: "backlog"}, synchronize_session=False)
    db.delete(sprint)
    db.commit()
