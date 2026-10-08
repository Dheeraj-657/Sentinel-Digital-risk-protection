from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Callable, Iterable

DEFAULT_BUCKETS = (
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
)


class _Histogram:
    def __init__(self, buckets: Iterable[float] = DEFAULT_BUCKETS) -> None:
        self._buckets = tuple(sorted(buckets))
        self._counts = [0] * (len(self._buckets) + 1)
        self._sum = 0.0
        self._count = 0

    def observe(self, value: float) -> None:
        self._sum += value
        self._count += 1
        for i, bound in enumerate(self._buckets):
            if value <= bound:
                self._counts[i] += 1
                return
        self._counts[-1] += 1

    def render(self, name: str, labels: str) -> str:
        def with_le(le: str) -> str:
            if not labels:
                return f'{{le="{le}"}}'
            return f'{labels[:-1]},le="{le}"'

        lines = []
        cumulative = 0
        for i, bound in enumerate(self._buckets):
            cumulative += self._counts[i]
            lines.append(f'{name}_bucket{with_le(str(bound))} {cumulative}')
        lines.append(f'{name}_bucket{with_le("+Inf")} {self._count}')
        lines.append(f'{name}_sum{labels} {self._sum}')
        lines.append(f'{name}_count{labels} {self._count}')
        return "\n".join(lines)


class MetricsRegistry:
    """In-process metrics registry rendered in Prometheus text format.

    Intentionally dependency-free; swap for a real client behind the same
    interface when a metrics backend exists.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], int] = defaultdict(int)
        self._histograms: dict[tuple[str, tuple[tuple[str, str], ...]], _Histogram] = {}

    def inc_counter(self, name: str, **labels: str) -> None:
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            self._counters[key] += 1

    def observe(self, name: str, value: float, **labels: str) -> None:
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            histogram = self._histograms.get(key)
            if histogram is None:
                histogram = _Histogram()
                self._histograms[key] = histogram
            histogram.observe(value)

    def start_timer(self) -> Callable[[], float]:
        """Return a stop() callable yielding elapsed seconds (monotonic)."""
        started = time.monotonic()
        return lambda: time.monotonic() - started

    def render(self) -> str:
        with self._lock:
            lines: list[str] = []
            for (name, label_pairs), value in sorted(self._counters.items()):
                labels = self._format_labels(label_pairs)
                lines.append(f"# TYPE {name} counter")
                lines.append(f"{name}{labels} {value}")
            for (name, label_pairs), histogram in sorted(self._histograms.items()):
                labels = self._format_labels(label_pairs)
                lines.append(f"# TYPE {name} histogram")
                lines.append(histogram.render(name, labels))
            return "\n".join(lines) + "\n"

    @staticmethod
    def _format_labels(label_pairs: tuple[tuple[str, str], ...]) -> str:
        if not label_pairs:
            return ""
        inner = ",".join(f'{k}="{v}"' for k, v in label_pairs)
        return "{" + inner + "}"


metrics = MetricsRegistry()
