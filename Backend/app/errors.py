class ContOSBackendError(Exception):
    """Base error for ContOS backend failures."""


class ConfigurationError(ContOSBackendError):
    """Raised when required configuration is missing or invalid."""


class ApifyServiceError(ContOSBackendError):
    """Raised when an Apify actor run fails."""


class LlmServiceError(ContOSBackendError):
    """Raised when LLM summarization fails."""


class RepositoryError(ContOSBackendError):
    """Raised when Supabase persistence fails."""


class PipelineError(ContOSBackendError):
    """Raised when a competitor pipeline step fails."""
