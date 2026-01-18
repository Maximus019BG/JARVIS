from typing import Callable, Awaitable

from textual.widgets import Button


class MenuButton(Button):
    """Custom button for menu with futuristic styling."""

    def __init__(self, label: str, action: Callable[[], Awaitable[None]], **kwargs) -> None:
        super().__init__(label, **kwargs)
        self.action = action

    async def on_click(self) -> None:
        await self.action()