from dataclasses import dataclass


@dataclass(frozen=True)
class ReelTranscriptionResult:
    transcript: str | None = None
    error_message: str | None = None

    @property
    def succeeded(self) -> bool:
        return bool(self.transcript and self.transcript.strip())
