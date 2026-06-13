"""通知の送信先 (Webhook) 管理。

  GET    /api/webhooks           : 一覧
  POST   /api/webhooks           : 追加
  PUT    /api/webhooks/{id}      : 変更
  DELETE /api/webhooks/{id}      : 削除
  POST   /api/webhooks/{id}/test : テスト送信 (設定確認用)

実際の通知送信は app/notify.py のバックグラウンドループが行う。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..notify import _post_webhook

router = APIRouter()


def _get_or_404(db: Session, webhook_id: int) -> models.Webhook:
    hook = db.get(models.Webhook, webhook_id)
    if not hook:
        raise HTTPException(404, "Webhook not found")
    return hook


@router.get("", response_model=list[schemas.WebhookOut])
def list_webhooks(db: Session = Depends(get_db)):
    return db.query(models.Webhook).order_by(models.Webhook.id).all()


@router.post("", response_model=schemas.WebhookOut, status_code=201)
def create_webhook(payload: schemas.WebhookCreate, db: Session = Depends(get_db)):
    hook = models.Webhook(**payload.model_dump())
    db.add(hook)
    db.commit()
    db.refresh(hook)
    return hook


@router.put("/{webhook_id}", response_model=schemas.WebhookOut)
def update_webhook(
    webhook_id: int, payload: schemas.WebhookUpdate, db: Session = Depends(get_db)
):
    hook = _get_or_404(db, webhook_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(hook, key, value)
    db.commit()
    db.refresh(hook)
    return hook


@router.delete("/{webhook_id}", status_code=204)
def delete_webhook(webhook_id: int, db: Session = Depends(get_db)):
    hook = _get_or_404(db, webhook_id)
    db.delete(hook)
    db.commit()


@router.post("/{webhook_id}/test")
def test_webhook(webhook_id: int, db: Session = Depends(get_db)):
    hook = _get_or_404(db, webhook_id)
    try:
        _post_webhook(hook, "🔔 harosystem: テスト通知です。設定は正常です。")
    except Exception as exc:
        raise HTTPException(502, f"送信に失敗しました: {exc}")
    return {"status": "ok"}
