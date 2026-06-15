"""認証エンドポイント。

  POST /api/auth/login  : ユーザー名 + パスワードでログインし、JWT を返す
  GET  /api/auth/me      : トークンの検証 + 現在のユーザー情報を返す
"""

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models
from ..auth import create_access_token, get_current_user, verify_password
from ..database import get_db

router = APIRouter()


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str


class UserResponse(BaseModel):
    id: int
    username: str


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """ユーザー名とパスワードで認証し、JWT アクセストークンを返す"""
    user = db.query(models.User).filter(models.User.username == body.username).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ユーザー名またはパスワードが正しくありません",
        )
    token = create_access_token(user.id, user.username)
    return LoginResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
    )


@router.get("/me", response_model=UserResponse)
def me(user: models.User = Depends(get_current_user)):
    """現在のトークンが有効かを確認し、ユーザー情報を返す"""
    return UserResponse(id=user.id, username=user.username)
