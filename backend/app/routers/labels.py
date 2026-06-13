from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter()


@router.get("", response_model=list[schemas.LabelOut])
def list_labels(db: Session = Depends(get_db)):
    return db.query(models.Label).order_by(models.Label.name).all()


@router.post("", response_model=schemas.LabelOut, status_code=201)
def create_label(payload: schemas.LabelCreate, db: Session = Depends(get_db)):
    if db.query(models.Label).filter(models.Label.name == payload.name).first():
        raise HTTPException(409, "Label already exists")
    label = models.Label(**payload.model_dump())
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@router.put("/{label_id}", response_model=schemas.LabelOut)
def update_label(
    label_id: int, payload: schemas.LabelCreate, db: Session = Depends(get_db)
):
    label = db.get(models.Label, label_id)
    if not label:
        raise HTTPException(404, "Label not found")
    # 同名の別ラベルとの重複を防ぐ (unique 制約違反の 500 を 409 に変換)
    dup = (
        db.query(models.Label)
        .filter(models.Label.name == payload.name, models.Label.id != label_id)
        .first()
    )
    if dup:
        raise HTTPException(409, "Label already exists")
    label.name = payload.name
    label.color = payload.color
    label.notify_default = payload.notify_default
    label.notify_before_min_default = payload.notify_before_min_default
    db.commit()
    db.refresh(label)
    return label


@router.delete("/{label_id}", status_code=204)
def delete_label(label_id: int, db: Session = Depends(get_db)):
    label = db.get(models.Label, label_id)
    if not label:
        raise HTTPException(404, "Label not found")
    db.delete(label)
    db.commit()
