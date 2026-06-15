"""ICS ファイルのインポート / エクスポート。

  GET  /api/ics/export : 全予定 + 全タスクを .ics でダウンロード
  POST /api/ics/import : .ics をアップロードして予定/タスクとして取り込む
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..ics import build_ics, parse_ics

router = APIRouter()


@router.get("/export")
def export_ics(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    events = (
        db.query(models.Event)
        .filter(models.Event.user_id == user.id)
        .order_by(models.Event.start_at)
        .all()
    )
    tasks = (
        db.query(models.Task)
        .filter(models.Task.user_id == user.id)
        .order_by(models.Task.id)
        .all()
    )
    return Response(
        content=build_ics(events, tasks),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="harosystem.ics"'},
    )


MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB (巨大ファイルによるメモリ枯渇を防ぐ)


@router.post("/import", response_model=schemas.IcsImportResult)
async def import_ics(
    file: UploadFile,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "ファイルが大きすぎます (10MB 上限)")
    try:
        event_dicts, task_dicts = parse_ics(data)
    except ValueError:
        raise HTTPException(400, "ICS ファイルを解析できませんでした")

    for d in event_dicts:
        d.pop("uid", None)  # Event モデルには uid カラムが無い
        db.add(models.Event(**d, user_id=user.id))
    for d in task_dicts:
        db.add(models.Task(**d, user_id=user.id))
    db.commit()
    return schemas.IcsImportResult(events=len(event_dicts), tasks=len(task_dicts))
