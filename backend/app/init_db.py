from alembic import command
from alembic.config import Config
from app.settings import PROJECT_ROOT


def initialize_database() -> None:
    config = Config(str(PROJECT_ROOT / "backend" / "alembic.ini"))
    command.upgrade(config, "head")


if __name__ == "__main__":
    initialize_database()
    print("CityLens database migrations are up to date.")