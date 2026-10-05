from typing import Optional, List
from sqlalchemy.orm import Session
from app.models.user import User
from app.repositories.base_repository import BaseRepository

class UserRepository(BaseRepository[User]):
    def __init__(self):
        super().__init__(User)

    def get_by_email(self, db: Session, email: str) -> Optional[User]:
        return db.query(User).filter(User.email == email).first()

    def get_all(self, db: Session, skip: int = 0, limit: int = 100) -> List[User]:
        return db.query(User).order_by(User.created_at.desc()).offset(skip).limit(limit).all()

    def update(self, db: Session, user: User) -> User:
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def update_password(self, db: Session, user: User, new_password_hash: str) -> User:
        user.password_hash = new_password_hash
        return self.update(db, user)

    def update_status(self, db: Session, user: User, is_active: bool) -> User:
        user.is_active = is_active
        return self.update(db, user)

    def delete_user(self, db: Session, user: User) -> bool:
        db.delete(user)
        db.commit()
        return True

user_repository = UserRepository()
