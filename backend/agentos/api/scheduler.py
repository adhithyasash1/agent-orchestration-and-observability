from __future__ import annotations

import asyncio
import logging
from typing import Any

from ..runtime import run_agent

try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger
except Exception:  # pragma: no cover
    AsyncIOScheduler = None
    CronTrigger = None


logger = logging.getLogger("agentos.scheduler")


class RunScheduler:
    def __init__(self, components: Any):
        self.components = components
        self.available = AsyncIOScheduler is not None and CronTrigger is not None
        self._scheduler = (
            AsyncIOScheduler(timezone=getattr(components.settings, "scheduler_timezone", "UTC"))
            if self.available
            else None
        )
        self._run_semaphore = asyncio.Semaphore(2)

    def start(self) -> None:
        if not self.available or self._scheduler is None:
            logger.warning("APScheduler is not installed. Scheduled runs are unavailable.")
            return
        if not self._scheduler.running:
            self._scheduler.start()
        self.reload()

    def shutdown(self) -> None:
        if self._scheduler and self._scheduler.running:
            self._scheduler.shutdown(wait=False)

    def reload(self) -> None:
        if not self.available:
            return
        for schedule in self.components.traces.list_schedules():
            self.sync_schedule(schedule)

    def sync_schedule(self, schedule: dict[str, Any]) -> dict[str, Any]:
        if not self.available or self._scheduler is None:
            return schedule

        schedule_id = schedule["schedule_id"]
        existing = self._scheduler.get_job(schedule_id)
        if existing:
            self._scheduler.remove_job(schedule_id)

        if not schedule.get("enabled", True):
            return self.components.traces.update_schedule(schedule_id, next_run_at=None) or schedule

        try:
            trigger = CronTrigger.from_crontab(
                schedule["cron"],
                timezone=schedule.get("timezone") or getattr(self.components.settings, "scheduler_timezone", "UTC"),
            )
        except Exception as exc:
            self.components.traces.update_schedule(
                schedule_id,
                next_run_at=None,
                last_error=str(exc),
            )
            raise
        self._scheduler.add_job(
            self._enqueue_schedule_run,
            trigger=trigger,
            id=schedule_id,
            replace_existing=True,
            kwargs={"schedule_id": schedule_id},
        )
        job = self._scheduler.get_job(schedule_id)
        next_run_at = job.next_run_time.isoformat() if job and job.next_run_time else None
        return self.components.traces.update_schedule(
            schedule_id,
            next_run_at=next_run_at,
            last_error=None,
        ) or schedule

    def remove_schedule(self, schedule_id: str) -> None:
        if not self.available or self._scheduler is None:
            return
        if self._scheduler.get_job(schedule_id):
            self._scheduler.remove_job(schedule_id)

    async def _enqueue_schedule_run(self, schedule_id: str) -> None:
        schedule = self.components.traces.get_schedule(schedule_id)
        if not schedule or not schedule.get("enabled", True):
            return

        run_id = self.components.traces.start_run(
            schedule["user_input"],
            self.components.settings.profile,
            self.components.settings.describe()["flags"],
            prompt_version=self.components.settings.prompt_version,
            tag=schedule.get("tag"),
            session_id=schedule.get("session_id"),
            schedule_id=schedule_id,
        )
        next_run_at = None
        if self.available and self._scheduler is not None:
            job = self._scheduler.get_job(schedule_id)
            next_run_at = job.next_run_time.isoformat() if job and job.next_run_time else None

        current_count = int(schedule.get("run_count") or 0)
        self.components.traces.update_schedule(
            schedule_id,
            last_run_at=self.components.traces._now_iso(),
            next_run_at=next_run_at,
            run_count=current_count + 1,
            last_error=None,
        )

        async def runner() -> None:
            async with self._run_semaphore:
                try:
                    await run_agent(
                        schedule["user_input"],
                        llm=self.components.llm,
                        tools=self.components.tools,
                        memory=self.components.memory,
                        traces=self.components.traces,
                        config=self.components.settings,
                        run_id=run_id,
                        session_id=schedule.get("session_id"),
                        tag=schedule.get("tag"),
                    )
                    self.components.traces.update_schedule(schedule_id, last_error=None)
                except Exception as exc:  # pragma: no cover
                    logger.exception("scheduled run failed: %s", schedule_id)
                    self.components.traces.finish_run(run_id, "", 0.0, 0, 0, status="error")
                    self.components.traces.update_schedule(schedule_id, last_error=str(exc))

        asyncio.create_task(runner())
