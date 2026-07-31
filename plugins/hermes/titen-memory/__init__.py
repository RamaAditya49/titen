"""Register Titen's portable Agent Skill with Hermes."""

from pathlib import Path


def register(ctx):
    ctx.register_skill(
        "titen-memory", Path(__file__).parent / "skills" / "titen-memory" / "SKILL.md"
    )
